// Protocol smoke tests: the server starts, exposes the expected tools/prompts,
// and each tool returns non-empty, correct-looking content.
import { mkClient, callTool, Checks, PACK_ROOT } from "./harness.mjs";
import { readServablePackFile, listServablePackFiles, splitIntoParts, PART_BUDGET } from "../dist/server.js";
import { listDir, packRead } from "./harness.mjs";
import { createHash } from "node:crypto";

const EXPECTED_TOOLS = [
  "tide_list", "tide_canon", "tide_playbook", "tide_skill", "tide_prompt",
  "tide_adapter", "tide_list_scenarios", "tide_scenario", "tide_scenario_manifest",
  "tide_scenario_roles", "tide_scenario_bootstrap", "tide_choose_scenario",
  "tide_choose_playbook", "tide_security_analysis", "tide_hosting", "tide_gaps", "tide_blast_radius",
  "tide_branding", "tide_dpop_asset", "tide_onboarding", "tide_scaffold", "tide_doctor",
];
const EXPECTED_PROMPTS = [
  "tide-build-app", "tide-secure-existing", "tide-build-from-scenario",
  "tide-security-analysis", "tide-mcp-qa",
];

export async function run() {
  const c = new Checks("protocol");
  const client = await mkClient();

  // --- Tools & prompts present ---
  const toolDefs = (await client.listTools()).tools;
  const tools = toolDefs.map((t) => t.name);
  for (const t of EXPECTED_TOOLS) c.ok(`tool present: ${t}`, tools.includes(t), `not in [${tools.join(", ")}]`);
  const extraTools = tools.filter((t) => !EXPECTED_TOOLS.includes(t));
  c.ok("no unexpected tools", extraTools.length === 0, `unexpected: ${extraTools.join(", ")} (update EXPECTED_TOOLS if intentional)`);

  // --- Directory readiness: every tool must be annotated read-only ---
  // (required for the Claude connector directory; all pack tools are read-only)
  for (const t of toolDefs) {
    c.ok(`tool annotated readOnlyHint: ${t.name}`, t.annotations?.readOnlyHint === true, `annotations=${JSON.stringify(t.annotations ?? null)}`);
  }

  const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
  for (const p of EXPECTED_PROMPTS) c.ok(`prompt present: ${p}`, prompts.includes(p), `not in [${prompts.join(", ")}]`);

  // --- Representative tool calls return meaningful content ---
  let r;

  r = await callTool(client, "tide_list", { category: "all" });
  c.ok("tide_list(all) returns content", !r.isError && r.text.length > 80, r.text.slice(0, 120));

  r = await callTool(client, "tide_security_analysis");
  c.ok("security_analysis covers SG-01..SG-18", r.text.includes("SG-01") && r.text.includes("SG-18"));
  c.ok("security_analysis includes runtime probes", r.text.includes("Runtime Confirmation Probes"));
  c.ok("security_analysis includes out-of-scope honesty", /out of scope|does NOT fix/i.test(r.text));

  r = await callTool(client, "tide_hosting");
  c.ok("hosting includes Skycloak API base", r.text.includes("api.skycloak.io"));
  c.ok("hosting states the trust model", /trust model/i.test(r.text));
  c.ok("hosting flags GAP-066 (not turnkey)", r.text.includes("GAP-066"));

  r = await callTool(client, "tide_canon", { name: "iga-change-requests-api" });
  c.ok("iga-change-requests-api canon readable", !r.isError && r.text.includes("/iga/change-requests") && r.text.includes("bulk-authorize"));

  r = await callTool(client, "tide_choose_playbook", { situation: "we want a managed hosted tidecloak, no infrastructure" });
  c.ok("choose_playbook routes hosted -> skycloak", r.text.includes("provision-tidecloak-skycloak"));

  r = await callTool(client, "tide_choose_scenario", { situation: "build an organisation password manager" });
  c.ok("choose_scenario returns a match", !r.isError && r.text.length > 20);

  r = await callTool(client, "tide_gaps");
  c.ok("gaps registers GAP-065 as resolved", r.text.includes("GAP-065") && r.text.includes("RESOLVED_BY_VENDOR"));

  // --- Server instructions must survive the client ---
  // Claude Code truncates server instructions at roughly 2000 characters (MEASURED 2026-10-07: a
  // 6.8 KB block arrived cut mid-sentence and the agent never saw the second half). Anything that
  // must reach the agent unconditionally has to fit; everything else belongs in a tool response.
  const instr = client.getInstructions() ?? "";
  c.ok("server instructions fit under the 2000-char client limit", instr.length > 0 && instr.length <= 2000, `length=${instr.length}`);
  c.ok("instructions send a build to the chooser and name the DPoP tool",
    /tide_choose_scenario/.test(instr) && /tide_choose_playbook/.test(instr) && /tide_dpop_asset/.test(instr) && /tide_blast_radius/.test(instr));

  // --- The chooser returns a work order, not just names ---
  // A list of playbook names left every mandatory piece to be discovered by reading the playbooks;
  // users had to ask for the DPoP page by name. The first call of any build must carry them.
  r = await callTool(client, "tide_choose_playbook", { situation: "add login to a new Next.js app" });
  c.ok("choose_playbook (new app) returns the work order",
    /Work order/.test(r.text) && /tide_dpop_asset/.test(r.text) && /tide_hosting/.test(r.text) &&
    /tide_branding/.test(r.text) && /tide_onboarding/.test(r.text) && /verify-jwt-server-side/.test(r.text),
    r.text.slice(0, 200));
  c.ok("work order tells a local caller where the pack files are", r.text.includes(PACK_ROOT));
  c.ok("a new-app request does not get the tidify warning", !/EdDSA/.test(r.text));

  r = await callTool(client, "tide_choose_scenario", { situation: "build an organisation password manager" });
  c.ok("choose_scenario returns the work order", /Work order/.test(r.text) && /tide_dpop_asset/.test(r.text));

  r = await callTool(client, "tide_choose_playbook", { situation: "our existing app already uses Keycloak, add Tide" });
  c.ok("an existing Keycloak app gets the EdDSA / tidify check up front",
    /EdDSA/.test(r.text) && /check-tidify\.sh/.test(r.text) && /NOT TIDIFIABLE/.test(r.text), r.text.slice(0, 200));

  r = await callTool(client, "tide_choose_playbook", { situation: "login broken, popup is blank" });
  c.ok("a pure diagnosis gets the DPoP pointer, not the build work order",
    /diagnose-broken-login/.test(r.text) && /tide_dpop_asset/.test(r.text) && !/Work order/.test(r.text), r.text.slice(0, 200));

  // --- Asset tools work, and name files the CALLER can reach ---
  const GOOD = "9d7844b938f0a2565fa910d3d30e9b8797cbfd6e0b73d59d804169a089aea757";
  r = await callTool(client, "tide_dpop_asset");
  c.ok("tide_dpop_asset returns the known-good page", !r.isError && r.text.includes("known-good") && r.text.includes(GOOD), r.text.slice(0, 160));
  c.ok("tide_dpop_asset copies from the installed SDK first", r.text.includes("cp node_modules/@tidecloak/js/tide_dpop_auth.html public/tide_dpop_auth.html"));
  r = await callTool(client, "tide_branding", { realm: "demo" });
  c.ok("tide_branding returns a runnable command", !r.isError && r.text.includes(`${PACK_ROOT}/templates/enclave-branding/brand-tidecloak.sh`), r.text.slice(0, 160));
  r = await callTool(client, "tide_onboarding", { fields: ["firstName"] });
  c.ok("tide_onboarding returns the component", !r.isError && /WRITE THIS FILE NOW/.test(r.text) && !/cp templates\/onboarding-modal/.test(r.text), r.text.slice(0, 160));

  // The hosted transport passes publicBaseUrl. A path on the server's disk is useless to that
  // caller: this is what made the hosted DPoP tool tell agents to `cp /app/templates/...`.
  const hosted = await mkClient({ publicBaseUrl: "https://mcp.example.test/", packArchive: true });
  for (const [tool, args] of [["tide_dpop_asset", {}], ["tide_branding", { realm: "demo" }], ["tide_onboarding", {}], ["tide_hosting", {}],
    ["tide_choose_playbook", { situation: "add login to a new Next.js app" }]]) {
    const h = await callTool(hosted, tool, args);
    c.ok(`hosted ${tool} never names a path on the server's disk`, !h.isError && !h.text.includes(PACK_ROOT), h.text.slice(0, 160));
  }
  let h = await callTool(hosted, "tide_dpop_asset");
  c.ok("hosted tide_dpop_asset falls back to a byte-exact download",
    h.text.includes('curl -fsSL "https://mcp.example.test/pack/templates/nextjs-customer-portal/public/tide_dpop_auth.html"'));
  h = await callTool(hosted, "tide_choose_playbook", { situation: "add login to a new Next.js app" });
  c.ok("hosted work order says how to fetch the pack files",
    h.text.includes('curl -fsSL "https://mcp.example.test/pack/templates.tgz" | tar -xz -C .tide-pack') && h.text.includes(".tide-pack/templates/dpop-verify/verifyDpop.ts"));
  h = await callTool(hosted, "tide_branding", { realm: "demo" });
  c.ok("hosted tide_branding runs the script from the fetched copy", h.text.includes(".tide-pack/templates/enclave-branding/brand-tidecloak.sh"));
  await hosted.close();

  // --- What the HTTP transport may serve ---
  const page = readServablePackFile("templates/nextjs-customer-portal/public/tide_dpop_auth.html");
  c.ok("servable: the DPoP page is returned byte-exact", !!page && createHash("sha256").update(page).digest("hex") === GOOD);
  for (const bad of ["../package.json", "templates/../../package.json", "templates/../mcp-server/package.json", "canon/invariants.md",
    "scripts/bump-version.mjs", "templates", "templates/shared/.env", "templates/x/node_modules/y.js", "templates/forseti-compile-harness/obj/a.json", "/etc/passwd"]) {
    c.ok(`servable: refuses ${bad}`, readServablePackFile(bad) === null);
  }
  const servable = listServablePackFiles();
  c.ok("servable: the archive list holds templates and the DPoP checker, and nothing else",
    servable.length > 50 && servable.includes("scripts/check-dpop-asset.sh") &&
    servable.every((f) => f.startsWith("templates/") || f === "scripts/check-dpop-asset.sh") &&
    !servable.some((f) => /(^|\/)(obj|node_modules|\.env)(\/|$)/.test(f)),
    `count=${servable.length}`);

  // --- Routing: a request reaches the right playbook ---
  // Keywords used to match as substrings, so the token `pr` (from git-pr-signing-service) matched
  // "protect", "express", "prototype" and "production", and `new` matched "renew". Four playbooks
  // were not reachable from the chooser at all. Each row is a request that was MEASURED misrouted.
  const head = (text) => text.split("\n---")[0];
  const routes = [
    ["protect my ASP.NET Core API with Tide", ["protect-aspnet-core-asgard"], ["Scenario match", "protect-api-nextjs"]],
    ["I have a .NET backend, how do I verify Tide tokens", ["protect-aspnet-core-asgard", "verify-jwt-server-side"], ["protect-api-nextjs"]],
    ["express api that checks tide tokens", ["protect-api-nextjs", "verify-jwt-server-side"], ["Scenario match"]],
    ["build a rapid prototype of a chat app", [], ["Scenario match"]],
    ["deploy to production", ["deploy-tidecloak-docker"], ["Scenario match"]],
    ["renew my subscription page", [], ["add-auth-nextjs-fresh**"]],
    ["we use NextAuth today and want to move to TideCloak", ["migrate-from-existing-auth", "add-auth-nextjs-existing"], ["deploy-tidecloak-docker"]],
    ["users are missing roles in their token", ["diagnose-missing-roles-or-claims"], ["add-rbac-nextjs", "Work order"]],
    ["login popup is blank", ["diagnose-broken-login"], ["add-auth-nextjs-fresh", "Work order"]],
    ["create the first admin and link their Tide account", ["initialize-admin-and-link-account"], []],
    ["set up roles and policies for encrypted fields", ["configure-e2ee-roles-and-policies"], []],
    ["build a React Vite internal dashboard with Tide login", ["add-auth-nextjs-fresh", "react-vite-internal-dashboard"], ["No exact scenario"]],
    ["add login to our existing app", ["add-auth-nextjs-existing"], ["add-auth-nextjs-fresh**"]],
    ["build an organisation password manager", ["Scenario match: organisation-password-manager"], []],
    ["keyless ssh signing", ["Scenario match: policy-governed-signing"], []],
  ];
  for (const [situation, want, never] of routes) {
    const res = await callTool(client, "tide_choose_playbook", { situation });
    const full = res.text;
    const h = head(full);
    const missing = want.filter((w) => !full.includes(w));
    const present = never.filter((n) => (n === "Work order" ? full.includes(n) : h.includes(n)));
    c.ok(`routes: "${situation}"`, !res.isError && missing.length === 0 && present.length === 0,
      `missing=[${missing}] unwanted=[${present}] got: ${h.slice(0, 200).replace(/\n/g, " | ")}`);
  }
  // Every playbook must be reachable from the chooser's own rules or a scenario manifest.
  const serverSrc = packRead("mcp-server/src/server.ts") || "";
  const ruled = new Set([...serverSrc.matchAll(/name:\s*"([a-z0-9-]+)",\s*reason:/g)].map((m) => m[1]));
  const unreachable = listDir("playbooks").map((f) => f.replace(/\.md$/, "")).filter((p) => !ruled.has(p));
  c.ok("every playbook is reachable from tide_choose_playbook", unreachable.length === 0, unreachable.join(", "));
  // A manifest may name a playbook that does not exist yet; the response must say so, not list it bare.
  r = await callTool(client, "tide_choose_scenario", { situation: "sign git commits with a verified badge" });
  const bare = [...r.text.matchAll(/^- ([a-z0-9-]+)\s*$/gm)].map((m) => m[1]).filter((p) => !listDir("playbooks").includes(p + ".md"));
  c.ok("a scenario never lists a non-existent playbook as if it existed", !r.isError && bare.length === 0, bare.join(", "));

  // --- Every response fits the client's result limit ---
  // Claude Code rejects a tool result over about 25k tokens: the agent gets an error and a file path.
  // MEASURED 2026-10-07 on tide_blast_radius (129 KB). Walk EVERY document the server can return.
  const LIMIT = PART_BUDGET + 1500; // only the part banner and footer ride on top of a part
  const oversize = [];
  let multi = 0;
  const walk = async (tool, args) => {
    let res = await callTool(client, tool, args);
    if (res.isError) { oversize.push(`${tool}(${JSON.stringify(args)}) ERROR`); return; }
    if (res.text.length > LIMIT) oversize.push(`${tool}(${JSON.stringify(args)}) ${res.text.length}`);
    const m = /\*\*Part 1 of (\d+)\*\*/.exec(res.text.slice(0, 4000));
    if (!m) return;
    multi++;
    for (let k = 2; k <= Number(m[1]); k++) {
      res = await callTool(client, tool, { ...args, part: k });
      if (res.isError || res.text.length > LIMIT || !res.text.includes(`Part ${k} of ${m[1]}`)) oversize.push(`${tool} part ${k}: ${res.isError ? "ERROR" : res.text.length}`);
    }
    res = await callTool(client, tool, { ...args, part: Number(m[1]) + 1 });
    if (!res.isError) oversize.push(`${tool}: a part past the end did not error`);
  };
  for (const f of listDir("canon").filter((f) => f.endsWith(".md"))) await walk("tide_canon", { name: f.replace(/\.md$/, "") });
  for (const f of listDir("playbooks").filter((f) => f.endsWith(".md"))) await walk("tide_playbook", { name: f.replace(/\.md$/, "") });
  for (const f of listDir("skills")) await walk("tide_skill", { name: f });
  for (const f of listDir("adapters").filter((f) => f.endsWith(".md"))) await walk("tide_adapter", { name: f.replace(/\.md$/, "") });
  for (const f of listDir("prompts").filter((f) => f.endsWith(".md"))) await walk("tide_prompt", { name: f.replace(/\.md$/, "") });
  for (const sc of listDir("reference-apps").filter((n) => !n.endsWith(".md"))) {
    for (const tool of ["tide_scenario", "tide_scenario_bootstrap", "tide_scenario_roles", "tide_scenario_manifest"]) await walk(tool, { name: sc });
  }
  for (const tool of ["tide_security_analysis", "tide_blast_radius", "tide_hosting", "tide_dpop_asset", "tide_branding", "tide_onboarding", "tide_gaps"]) await walk(tool, {});
  c.ok("no tool response exceeds the client result limit", oversize.length === 0, oversize.join("  "));
  c.ok("oversized documents are delivered in parts", multi >= 5, `multi-part documents: ${multi}`);

  // Splitting must lose nothing and must not cut a code fence in half.
  const splitBad = [];
  for (const rel of ["canon/anti-patterns.md", "canon/breach-precedents.md", "skills/tide-red-team/SKILL.md", "GAP_REGISTER.md", "canon/troubleshooting.md"]) {
    const src = packRead(rel) || "";
    const parts = splitIntoParts(src);
    if (parts.join("") !== src) splitBad.push(`${rel}: parts do not reassemble`);
    if (parts.some((p) => p.length > PART_BUDGET)) splitBad.push(`${rel}: a part is over budget`);
    if (parts.some((p) => (p.match(/^\s*```/gm) || []).length % 2 !== 0)) splitBad.push(`${rel}: a part ends inside a code fence`);
    if (parts.length < 2) splitBad.push(`${rel}: expected to need splitting`);
  }
  c.ok("splitting is lossless, within budget, and never inside a code fence", splitBad.length === 0, splitBad.join("  "));

  // The first part must still lead with what the tool leads with, and tell the agent to continue.
  r = await callTool(client, "tide_blast_radius");
  c.ok("tide_blast_radius part 1 says how to get the rest", !r.isError && /Part 1 of \d+/.test(r.text) && /part: 2/.test(r.text) && /read all \d+ parts/.test(r.text), r.text.slice(0, 200));
  r = await callTool(client, "tide_playbook", { name: "bootstrap-realm-from-template" });
  const qLic = r.text.indexOf("BEFORE ANY TIDE REALM IS SET UP");
  const qUser = r.text.indexOf("TWO QUESTIONS YOU MUST ASK");
  const body = r.text.indexOf("# Bootstrap Realm from Template");
  c.ok("a bootstrap playbook leads with the licence ask, then the two end-user questions, then the document",
    !r.isError && qLic !== -1 && qLic < 20 && qUser > qLic && body > qUser, `licence=${qLic} endUser=${qUser} body=${body}`);
  r = await callTool(client, "tide_playbook", { name: "protect-api-nextjs" });
  c.ok("a non-bootstrap playbook does not carry them", !r.isError && !/TWO QUESTIONS YOU MUST ASK/.test(r.text));

  // Targeted reads: other documents point at single entries ("see AP-62"); fetching 147 KB to read one is waste.
  r = await callTool(client, "tide_canon", { name: "anti-patterns", section: "AP-62" });
  c.ok("tide_canon section returns just that entry", !r.isError && /^## AP-62/m.test(r.text) && r.text.length < 20000 && !/^## AP-63/m.test(r.text), `${r.text.length} chars: ${r.text.slice(0, 80)}`);
  r = await callTool(client, "tide_canon", { name: "anti-patterns", section: "no-such-heading-xyz" });
  c.ok("an unknown section errors and lists the headings", r.isError && /AP-01/.test(r.text));
  r = await callTool(client, "tide_canon", { name: "anti-patterns" });
  c.ok("part 1 of a long canon file offers the section index", /Pass `section`/.test(r.text) && /AP-88/.test(r.text.slice(0, 12000)));

  // --- Licence email + Terms & Conditions are asked before any realm is set up (AP-90) ---
  const TERMS = "https://tide.org/legal";
  const asksLicence = (t) => t.includes(TERMS) && /Which email address should manage your Tide licence/.test(t) && /Only the user can agree/.test(t);
  c.ok("instructions tell the agent to ask for the email and show the terms first",
    instr.includes(TERMS) && /email address should manage their Tide licence/.test(instr) && /never accept for them/i.test(instr) &&
    instr.indexOf(TERMS) < instr.indexOf("tide_hosting"), "must come before the hosting step");
  const setupResponses = [
    ["tide_hosting", {}],
    ["tide_playbook", { name: "bootstrap-realm-from-template" }],
    ["tide_playbook", { name: "start-tidecloak-dev" }],
    ["tide_playbook", { name: "deploy-tidecloak-docker" }],
    ["tide_playbook", { name: "provision-tidecloak-skycloak" }],
    ["tide_playbook", { name: "initialize-admin-and-link-account" }],
    ...listDir("reference-apps").filter((n) => !n.endsWith(".md")).map((n) => ["tide_scenario_bootstrap", { name: n }]),
  ];
  for (const [tool, args] of setupResponses) {
    const res = await callTool(client, tool, args);
    const at = res.text.indexOf("BEFORE ANY TIDE REALM IS SET UP");
    c.ok(`${tool}(${args.name ?? ""}) LEADS with the licence-email and terms ask`, !res.isError && at !== -1 && at < 20 && asksLicence(res.text.slice(0, 2500)), res.text.slice(0, 100));
  }
  for (const situation of ["add login to a new Next.js app", "build an organisation password manager", "deploy to production"]) {
    const res = await callTool(client, "tide_choose_playbook", { situation });
    const order = res.text.slice(res.text.indexOf("Work order"));
    c.ok(`work order step 1 is email + terms: "${situation}"`,
      /\n1\. \*\*Licence email and Terms & Conditions/.test(order) && order.includes(TERMS) && order.indexOf(TERMS) < order.indexOf("tide_hosting"), order.slice(0, 200));
  }
  r = await callTool(client, "tide_playbook", { name: "protect-api-nextjs" });
  c.ok("a playbook that sets up no realm does not carry the ask", !/BEFORE ANY TIDE REALM IS SET UP/.test(r.text));

  // --- Graceful error handling ---
  r = await callTool(client, "tide_canon", { name: "definitely-not-a-real-canon-file" });
  c.ok("unknown canon returns isError", r.isError === true);

  await client.close();
  return c.results;
}
