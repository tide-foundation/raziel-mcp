// DEPLOYING a custom Forseti contract is not self-service. A contract decides what the network will
// sign, so an open one can be written to sign anything; putting one onto a realm or the network is
// experimental, test-network only, and done by the Tide team. Writing and compile-checking a
// contract stay public. This server must not be what shows a member of the public the upload step.
//
// The first check is the gate: walk EVERY response the public server can give and fail the build if
// an upload step is in any of them. Everything after it checks how the restriction is expressed -
// that the agent is told up front, and that nothing else was lost.
import { mkClient, callTool, Checks, PACK_ROOT, packRead, listDir, walkFiles } from "./harness.mjs";
import { RESTRICTED, RESTRICTED_MARKER, RESTRICTED_NOTICE, TIDE_CONTACT, redactRestricted, readServablePackFile, listServablePackFiles } from "../dist/server.js";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const listDirAbs = (d) => (existsSync(d) ? readdirSync(d) : []);
const leaksIn = (text) => text.split("\n").filter((l) => RESTRICTED_MARKER.test(l));

export async function run() {
  const c = new Checks("restricted");
  const pub = await mkClient();
  const hosted = await mkClient({ publicBaseUrl: "https://mcp.example.test", packArchive: true });
  const internal = await mkClient({ internal: true });

  // --- THE GATE: nothing the public server says contains contract-authoring material -----------
  const requests = [];
  for (const f of listDir("canon").filter((f) => f.endsWith(".md"))) requests.push(["tide_canon", { name: f.replace(/\.md$/, "") }]);
  for (const f of listDir("playbooks").filter((f) => f.endsWith(".md"))) requests.push(["tide_playbook", { name: f.replace(/\.md$/, "") }]);
  for (const f of listDir("skills")) requests.push(["tide_skill", { name: f }]);
  for (const f of listDir("adapters").filter((f) => f.endsWith(".md"))) requests.push(["tide_adapter", { name: f.replace(/\.md$/, "") }]);
  for (const f of listDir("prompts").filter((f) => f.endsWith(".md"))) requests.push(["tide_prompt", { name: f.replace(/\.md$/, "") }]);
  for (const sc of listDir("reference-apps").filter((n) => !n.endsWith(".md"))) {
    for (const t of ["tide_scenario", "tide_scenario_bootstrap", "tide_scenario_roles", "tide_scenario_manifest"]) requests.push([t, { name: sc }]);
  }
  for (const t of ["tide_security_analysis", "tide_blast_radius", "tide_hosting", "tide_dpop_asset", "tide_branding", "tide_onboarding", "tide_gaps", "tide_list_scenarios", "tide_doctor", "tide_scaffold"]) requests.push([t, {}]);
  requests.push(["tide_list", { category: "all" }]);
  // Section lookups must not be a way round it.
  for (const section of ["Contract", "Forseti", "ValidateData", "Sandbox", "Deploying", "PolicyParam", "AP-60", "AP-88"]) {
    requests.push(["tide_canon", { name: "anti-patterns", section }], ["tide_canon", { name: "troubleshooting", section }], ["tide_canon", { name: "concepts", section }]);
  }
  const asks = [
    "attest that this user was added to my close friends group", "deploy a custom contract to sign documents",
    "write a forseti contract", "how do I upload a contract to the realm", "sign git commits with a verified badge",
    "keyless ssh signing", "prove I created this artwork with a timestamp", "share encrypted data with my team",
    "add login to a new Next.js app", "build an organisation password manager", "deploy policy", "custom contract",
  ];
  for (const situation of asks) requests.push(["tide_choose_playbook", { situation }], ["tide_choose_scenario", { situation }]);

  const leaks = [];
  let seen = 0;
  for (const client of [pub, hosted]) {
    for (const [tool, args] of requests) {
      let r = await callTool(client, tool, args);
      const texts = [r.text];
      const parts = /\*\*Part 1 of (\d+)\*\*/.exec(r.text.slice(0, 6000));
      for (let k = 2; parts && k <= Number(parts[1]); k++) texts.push((await callTool(client, tool, { ...args, part: k })).text);
      for (const t of texts) {
        seen++;
        const bad = leaksIn(t);
        if (bad.length) leaks.push(`${tool}(${JSON.stringify(args)}): ${bad[0].slice(0, 90)}`);
      }
    }
  }
  for (const p of (await pub.listPrompts()).prompts) {
    for (const sc of [...RESTRICTED.scenarios, "organisation-password-manager"]) {
      const a = {};
      for (const x of p.arguments ?? []) a[x.name] = x.name === "framework" ? "nextjs" : sc;
      try {
        const g = await pub.getPrompt({ name: p.name, arguments: a });
        seen++;
        const bad = leaksIn(g.messages.map((m) => m.content.text).join("\n"));
        if (bad.length) leaks.push(`prompt ${p.name}(${sc}): ${bad[0].slice(0, 90)}`);
      } catch (e) { leaks.push(`prompt ${p.name}(${sc}) threw: ${e.message}`); }
    }
  }
  c.ok(`no public response carries contract-authoring material (${seen} responses, stdio and hosted)`, leaks.length === 0, leaks.slice(0, 6).join("  ||  "));

  // Tool SCHEMAS are read by the agent too.
  const schemas = JSON.stringify((await pub.listTools()).tools);
  c.ok("tool schemas carry no upload step", leaksIn(schemas).length === 0);
  const instr = pub.getInstructions() ?? "";
  c.ok("the instructions say deployment is not self-service, and still fit the client limit",
    /DEPLOYING a custom Forseti contract is NOT self-service/.test(instr) && /never upload it/.test(instr) && instr.length <= 2000, `length=${instr.length}`);

  const BANNER = /\*\*Deploying a custom Forseti contract is not self-service\.\*\*/;
  const saysSo = (t) => BANNER.test(t) && /Do not upload it yourself/.test(t) && t.includes(TIDE_CONTACT) && /write the contract/.test(t);

  // --- writing a contract stays public; the upload step does not ---------------------------------
  let r = await callTool(pub, "tide_canon", { name: "custom-contracts" });
  c.ok("the authoring reference is served, and says up front that deployment goes to the Tide team",
    !r.isError && /IAccessPolicy/.test(r.text) && saysSo(r.text) && r.text.search(BANNER) < 3000, r.text.slice(0, 100));
  r = await callTool(pub, "tide_canon", { name: "custom-contracts", section: "Upload Contract" });
  c.ok("asking for the upload section by name does not return it", leaksIn(r.text).length === 0 && !/manage-realm.*scriptable/.test(r.text), r.text.slice(0, 160));
  r = await callTool(pub, "tide_playbook", { name: "deploy-forseti-policy" });
  c.ok("the deployment playbook keeps compiling and policy construction, without the upload",
    !r.isError && saysSo(r.text) && /Compile the contract locally/.test(r.text) && !/Upload the contract source/.test(r.text) && leaksIn(r.text).length === 0, r.text.slice(0, 100));
  r = await callTool(pub, "tide_playbook", { name: "setup-forseti-e2ee" });
  const whole = [r.text];
  const nParts = Number(/\*\*Part 1 of (\d+)\*\*/.exec(r.text.slice(0, 6000))?.[1] ?? 1);
  for (let k = 2; k <= nParts; k++) whole.push((await callTool(pub, "tide_playbook", { name: "setup-forseti-e2ee", part: k })).text);
  const e2ee = whole.join("\n");
  c.ok("a signing-flow code block keeps its code and marks the one line that was withheld",
    saysSo(e2ee) && /PolicySignRequest/.test(e2ee) && /\(withheld: the contract is uploaded by the Tide team/.test(e2ee) && /Self-Encryption/.test(e2ee) && leaksIn(e2ee).length === 0);

  // --- a scenario built on a contract is served, and says so first ----------------------------------
  for (const sc of RESTRICTED.contractScenarios) {
    for (const tool of ["tide_scenario", "tide_scenario_manifest", "tide_scenario_roles", "tide_scenario_bootstrap"]) {
      r = await callTool(pub, tool, { name: sc });
      c.ok(`${tool}(${sc}) is served and says the contract is deployed by the Tide team`,
        !r.isError && saysSo(r.text) && r.text.length > 1500 && leaksIn(r.text).length === 0, r.text.slice(0, 100));
    }
    r = await callTool(pub, "tide_scenario_bootstrap", { name: sc });
    c.ok(`tide_scenario_bootstrap(${sc}) still LEADS with the licence ask, then the deployment note`,
      r.text.indexOf("BEFORE ANY TIDE REALM IS SET UP") < 20 && r.text.search(BANNER) > 0 && r.text.search(BANNER) < 4000);
  }
  const routed = [
    ["attest that this user was added to my close friends group", "attestation"],
    ["prove I created this artwork with a timestamp", "attested-provenance-registry"],
    ["keyless ssh signing", "policy-governed-signing"],
  ];
  for (const [situation, sc] of routed) {
    for (const tool of ["tide_choose_scenario", "tide_choose_playbook"]) {
      r = await callTool(pub, tool, { situation });
      c.ok(`${tool} routes "${situation}" to ${sc}, with the deployment note first`,
        new RegExp(`cenario match: ${sc}`).test(r.text) && saysSo(r.text) && r.text.search(BANNER) < 50, r.text.slice(0, 120).replace(/\n/g, " | "));
    }
  }
  r = await callTool(pub, "tide_choose_playbook", { situation: "attest that this user was added to my close friends group" });
  c.ok("the build still gets its work order", /Work order/.test(r.text) && /tide_scaffold/.test(r.text));
  for (const situation of ["deploy a custom contract to sign documents", "deploy policy for my app"]) {
    r = await callTool(pub, "tide_choose_playbook", { situation });
    c.ok(`choose_playbook answers "${situation}" with the playbook AND the deployment note`,
      /deploy-forseti-policy/.test(r.text) && saysSo(r.text), r.text.slice(0, 160).replace(/\n/g, " | "));
  }
  r = await callTool(pub, "tide_list_scenarios");
  c.ok("the scenario list marks the scenarios whose contract the Tide team deploys",
    RESTRICTED.contractScenarios.every((sc) => new RegExp(`- ${sc} .*its Forseti contract is deployed by the Tide team`).test(r.text)) &&
    !/organisation-password-manager.*Tide team/.test(r.text) && !/iga-admin-governance.*Tide team/.test(r.text));

  // --- everything else still works --------------------------------------------------------------
  r = await callTool(pub, "tide_choose_playbook", { situation: "add login to a new Next.js app" });
  c.ok("an ordinary build is untouched: work order, no deployment note", /Work order/.test(r.text) && /tide_scaffold/.test(r.text) && !BANNER.test(r.text) && !/withheld/i.test(r.text));
  r = await callTool(pub, "tide_playbook", { name: "verify-jwt-server-side" });
  c.ok("a playbook with no upload step is served whole", !/withheld/i.test(r.text) && !BANNER.test(r.text) && /verifyDpop/.test(r.text));
  r = await callTool(pub, "tide_gaps");
  c.ok("the gap register loses its upload rows, not the register", r.text.length > 20000 && leaksIn(r.text).length === 0, `${r.text.length} chars`);
  r = await callTool(pub, "tide_playbook", { name: "bootstrap-realm-from-template" });
  c.ok("a bootstrap playbook still LEADS with the licence ask", r.text.indexOf("BEFORE ANY TIDE REALM IS SET UP") < 20);

  // --- redactRestricted itself --------------------------------------------------------------------
  const clean = "# Title\n\nA contract implements IAccessPolicy and is compiled locally.\n\n## Section\n\n- a\n- b\n";
  c.ok("text about WRITING a contract is returned unchanged", redactRestricted(clean).text === clean && redactRestricted(clean).removed === 0);
  const table = "## Endpoints\n\n| Path | Use |\n|---|---|\n" + Array.from({ length: 30 }, (_, i) => `| /e${i} | use ${i} |`).join("\n") + "\n| POST /iga/forseti-contracts | upload |\n";
  let red = redactRestricted(table);
  c.ok("one upload row in a long table removes the row, not the table", red.removed === 1 && /\| \/e29 \|/.test(red.text) && leaksIn(red.text).length === 0);
  red = redactRestricted("## Step 6: Upload the contract source (scriptable)\n\nplain words only\n\n## Step 7: Roles\n\nkeep me\n");
  c.ok("a section whose heading announces the upload goes entirely, and the next one stays",
    !/plain words only/.test(red.text) && /keep me/.test(red.text) && /Withheld/.test(red.text) && !/Upload the contract source/.test(red.text));
  red = redactRestricted("## Deploy\n\nBefore.\n\n```\nPOST /admin/realms/{realm}/iga/forseti-contracts\n{ \"contractCode\": \"...\" }\n```\n\nAfter.\n");
  c.ok("a code block that IS the upload goes; the prose around it stays", /Before\./.test(red.text) && /After\./.test(red.text) && /Withheld/.test(red.text) && !/POST/.test(red.text));
  const flow = ["## Sign", "", "```typescript", ...Array.from({ length: 9 }, (_, i) => `const step${i} = ${i};`), "  request.addForsetiContractToUpload(SOURCE);", "await sign(request);", "```", ""].join("\n");
  red = redactRestricted(flow);
  c.ok("a long code block with one upload line keeps the rest and marks the line",
    /const step8 = 8;/.test(red.text) && /await sign\(request\);/.test(red.text) && /^  \/\/ \(withheld: the contract is uploaded by the Tide team/m.test(red.text) && leaksIn(red.text).length === 0);
  red = redactRestricted(flow.replace("```typescript", "```bash"));
  c.ok("in a shell block the mark is a shell comment", /^  # \(withheld:/m.test(red.text));
  const once = redactRestricted(packRead("canon/custom-contracts.md") || packRead("canon/troubleshooting.md") || "").text;
  c.ok("redaction is idempotent and leaves no marker behind", redactRestricted(once).removed === 0 && leaksIn(once).length === 0);

  // --- downloads: the contract templates are public, and none of them carries the upload ----------
  const servable = listServablePackFiles(false);
  c.ok("the contract template and the compile harness are downloadable",
    servable.includes("templates/attestation/AttestationContract.cs") && servable.includes("templates/forseti-compile-harness/check.sh") && servable.includes("templates/shared/tide-doctor.sh"));
  // /pack serves files raw, with no redaction pass - so what is servable must already be clean.
  const dirty = servable.filter((f) => /\.(md|ts|tsx|js|mjs|sh|py|cs|ya?ml|json|html)$/.test(f) && leaksIn(readServablePackFile(f, false)?.toString("utf8") ?? "").length);
  c.ok("no downloadable file carries an upload step", dirty.length === 0, dirty.slice(0, 6).join("  "));

  // --- the lever: a name added to RESTRICTED is refused whole -----------------------------------
  // Nothing is listed today. This keeps the mechanism honest for the day something is.
  c.ok("the notice names the rule, the contact and what is still allowed",
    /Deploying a custom Forseti contract is not self-service/.test(RESTRICTED_NOTICE) && /Do \*\*not\*\* upload/.test(RESTRICTED_NOTICE) &&
    /Do \*\*not\*\* reconstruct/.test(RESTRICTED_NOTICE) && RESTRICTED_NOTICE.includes(TIDE_CONTACT) && /What you can do/.test(RESTRICTED_NOTICE));
  RESTRICTED.canon.push("custom-contracts"); RESTRICTED.scenarios.push("attestation"); RESTRICTED.templateDirs.push("templates/attestation");
  try {
    const strict = await mkClient();
    r = await callTool(strict, "tide_canon", { name: "custom-contracts" });
    c.ok("a listed document is refused with the notice", !r.isError && r.text.includes(RESTRICTED_NOTICE) && !/IAccessPolicy/.test(r.text) && r.text.length < 2500, r.text.slice(0, 100));
    r = await callTool(strict, "tide_canon", { name: "custom-contracts", part: 2 });
    c.ok("... and cannot be reached through `part`", r.text.includes(RESTRICTED_NOTICE));
    r = await callTool(strict, "tide_scenario_bootstrap", { name: "attestation" });
    c.ok("a listed scenario is refused with the notice", r.text.includes(RESTRICTED_NOTICE) && r.text.length < 3000);
    r = await callTool(strict, "tide_choose_scenario", { situation: "attest that this user was added to my close friends group" });
    c.ok("a listed scenario is still recognised by the chooser, then refused", /Attestation/.test(r.text) && r.text.includes(RESTRICTED_NOTICE) && !/Work order/.test(r.text));
    r = await callTool(strict, "tide_list", { category: "all" });
    c.ok("a listed document is not advertised", !/\bcustom-contracts\b/.test(r.text) && !JSON.stringify((await strict.listTools()).tools).includes("custom-contracts"));
    c.ok("a listed template directory is not downloadable",
      readServablePackFile("templates/attestation/AttestationContract.cs", false) === null && !listServablePackFiles(false).some((f) => f.startsWith("templates/attestation/")));
    await strict.close();
  } finally {
    RESTRICTED.canon.pop(); RESTRICTED.scenarios.pop(); RESTRICTED.templateDirs.pop();
  }

  // --- the Tide team's build is unaffected --------------------------------------------------------
  r = await callTool(internal, "tide_canon", { name: "custom-contracts" });
  const internalParts = [r.text];
  const nInt = Number(/\*\*Part 1 of (\d+)\*\*/.exec(r.text.slice(0, 6000))?.[1] ?? 1);
  for (let k = 2; k <= nInt; k++) internalParts.push((await callTool(internal, "tide_canon", { name: "custom-contracts", part: k })).text);
  // Only where the step exists on disk: the public tree is redacted at rest, so there is nothing to lift.
  if (leaksIn(packRead("canon/custom-contracts.md") || "").length) {
    c.ok("internal: the upload step is served, with no note", /iga\/forseti-contracts/.test(internalParts.join("\n")) && !BANNER.test(internalParts.join("\n")));
  }
  c.ok("internal: the instructions carry no restriction line", !/NOT self-service/.test(internal.getInstructions() ?? ""));

  // --- the public ARTIFACTS do not contain the material at all (layer 3) -------------------------
  // A runtime filter protects the hosted server. The npm package and the public repo are files on a
  // stranger's disk, where a filter can be switched off - so the files themselves must be clean.
  const pkg = JSON.parse(packRead("package.json") || "{}");
  const filesList = pkg.files ?? [];
  const mustExclude = [...RESTRICTED.canon.map((n) => `canon/${n}.md`), ...RESTRICTED.playbooks.map((n) => `playbooks/${n}.md`),
    ...RESTRICTED.scenarios.map((n) => `reference-apps/${n}/*.md`), ...RESTRICTED.templateDirs.map((d) => d + "/")];
  const notNegated = mustExclude.filter((p) => !filesList.includes("!" + p));
  c.ok("package.json `files` excludes every path listed for whole removal", notNegated.length === 0, notNegated.join("  "));
  const dockerignore = packRead(".dockerignore") || "";
  const notIgnored = mustExclude.map((p) => p.replace(/\/$/, "")).filter((p) => !dockerignore.split("\n").includes(p));
  c.ok(".dockerignore keeps every path listed for whole removal out of the image", notIgnored.length === 0, notIgnored.join("  "));
  const sync = packRead("scripts/sync-to-raziel.sh");
  if (sync !== null) c.ok("the public-repo sync runs the redaction over what it publishes", /redact-public\.mjs/.test(sync));

  if (process.platform !== "win32" && existsSync(join(PACK_ROOT, "scripts/redact-public.mjs"))) {
    // Run the real script over a copy of the published folders, then look for anything left.
    const tree = mkdtempSync(join(tmpdir(), "tide-pub-"));
    const dirs = ["canon", "playbooks", "skills", "prompts", "adapters", "reference-apps", "templates"];
    for (const d of dirs) cpSync(join(PACK_ROOT, d), join(tree, d), { recursive: true, filter: (s) => !/node_modules|\/obj(\/|$)|\/bin(\/|$)/.test(s) });
    for (const f of ["GAP_REGISTER.md", "README.md", "CHANGELOG.md"]) if (existsSync(join(PACK_ROOT, f))) cpSync(join(PACK_ROOT, f), join(tree, f));
    const run = spawnSync("node", [join(PACK_ROOT, "scripts/redact-public.mjs"), tree], { encoding: "utf8", timeout: 60000 });
    c.ok("redact-public.mjs runs", run.status === 0, (run.stderr || run.stdout || "").slice(0, 200));
    const left = [];
    for (const d of dirs) {
      for (const f of walkFiles(join(tree, d), [".md", ".cs", ".ts", ".mjs", ".sh", ".py", ".yaml", ".csproj"])) {
        const rel = f.slice(tree.length + 1);
        if (leaksIn(readFileSync(f, "utf8")).length) left.push(rel);
      }
    }
    for (const f of ["GAP_REGISTER.md"]) if (existsSync(join(tree, f)) && leaksIn(readFileSync(join(tree, f), "utf8")).length) left.push(f);
    c.ok("after redaction, no published file carries an upload step", left.length === 0, left.slice(0, 8).join("  "));
    c.ok("after redaction, the authoring reference and the contract template are still there",
      /IAccessPolicy/.test(readFileSync(join(tree, "canon/custom-contracts.md"), "utf8")) && existsSync(join(tree, "templates/attestation/AttestationContract.cs")) && existsSync(join(tree, "playbooks/deploy-forseti-policy.md")));
    const gone = mustExclude.filter((p) => !p.includes("*")).map((p) => p.replace(/\/$/, "")).filter((p) => existsSync(join(tree, p)));
    for (const sc of RESTRICTED.scenarios) for (const f of listDirAbs(join(tree, "reference-apps", sc))) if (f !== "manifest.yaml") gone.push(`reference-apps/${sc}/${f}`);
    c.ok("anything listed for whole removal is deleted from the public tree", gone.length === 0, gone.join("  "));
    const stubs = RESTRICTED.scenarios.filter((s) => !/^title:\s*\S/m.test(existsSync(join(tree, "reference-apps", s, "manifest.yaml")) ? readFileSync(join(tree, "reference-apps", s, "manifest.yaml"), "utf8") : ""));
    c.ok("a scenario listed for removal keeps its manifest, so a request is still recognised", stubs.length === 0, stubs.join("  "));
    const again = spawnSync("node", [join(PACK_ROOT, "scripts/redact-public.mjs"), "--check", tree], { encoding: "utf8", timeout: 60000 });
    c.ok("a redacted tree passes `redact-public.mjs --check`", again.status === 0, (again.stderr || again.stdout || "").slice(0, 200));
  }

  // --- the doctor says so when it finds one in an app ---------------------------------------------
  if (process.platform !== "win32") {
    const app = mkdtempSync(join(tmpdir(), "tide-doc-"));
    cpSync(join(PACK_ROOT, "templates/nextjs-customer-portal"), app, { recursive: true, filter: (s) => !/node_modules|\/\.next/.test(s) });
    mkdirSync(join(app, "data"), { recursive: true });
    writeFileSync(join(app, "data/tidecloak.json"), JSON.stringify({ realm: "d", "auth-server-url": "http://x", resource: "c", vendorId: "v", jwk: { keys: [] }, "client-origin-auth-http://localhost:3000": "s" }));
    mkdirSync(join(app, "forseti"), { recursive: true });
    writeFileSync(join(app, "forseti/My.cs"), "public class Contract : IAccessPolicy { }\n");
    const out = spawnSync("bash", [join(PACK_ROOT, "templates/shared/tide-doctor.sh"), "--app", app, "--check"], { encoding: "utf8", timeout: 30000 });
    mkdirSync(join(app, "scripts"), { recursive: true });
    writeFileSync(join(app, "scripts/deploy.sh"), ["curl -X POST \"$TC/admin/realms/$REALM/iga/", "forseti-contracts\" -d @c.json\n"].join(""));
    const out2 = spawnSync("bash", [join(PACK_ROOT, "templates/shared/tide-doctor.sh"), "--app", app, "--check"], { encoding: "utf8", timeout: 30000 });
    c.ok("the doctor warns when an app uploads a contract itself", /WARN\s+this app uploads a Forseti contract/.test(out2.stdout) && /not self-service/.test(out2.stdout));
    c.ok("the doctor says a contract in the app is fine to write and is deployed by the Tide team",
      /WARN\s+this app contains a custom Forseti contract/.test(out.stdout) && /writing it is fine/.test(out.stdout) && /Tide team/.test(out.stdout), out.stdout.split("\n").filter((l) => /WARN|FAIL/.test(l)).join(" | ").slice(0, 200));
  }

  await pub.close(); await hosted.close(); await internal.close();
  return c.results;
}
