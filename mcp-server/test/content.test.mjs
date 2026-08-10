// Content-consistency checks: catch doctrine drift a protocol test can't see.
// These are the regression gate for reconciliations like the IGA API migration.
import { PACK_ROOT, packRead, packExists, listDir, walkFiles, Checks } from "./harness.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const rel = (abs) => abs.replace(PACK_ROOT, "").replace(/\\/g, "/").replace(/^\//, "");

export async function run() {
  const c = new Checks("content");

  // 1. No stray legacy IGA endpoints in ACTIVE guidance/scripts.
  //    Allowed: old->new mapping labels (lines that also name the new surface or say "legacy/replaces").
  const legacyRe = /tide-admin\/change-set\/(sign|commit|cancel|counts|all|users|roles|clients|groups)/;
  const allowRe = /legacy|replaces|→|->|iga\/change-requests|migration/i;
  const activeDirs = ["canon", "playbooks", "templates", "reference-apps"];
  const leaks = [];
  for (const d of activeDirs) {
    for (const f of walkFiles(join(PACK_ROOT, d), [".md", ".sh"])) {
      readFileSync(f, "utf8").split("\n").forEach((ln, i) => {
        if (legacyRe.test(ln) && !allowRe.test(ln)) leaks.push(`${rel(f)}:${i + 1}`);
      });
    }
  }
  c.ok("no stray legacy /tide-admin/change-set endpoints in active files", leaks.length === 0, leaks.join("  "));

  // 2. No unresolved merge-conflict markers in pack content.
  //    Unambiguous git markers only ("<<<<<<< " / ">>>>>>> "); the bare "=======" line
  //    is skipped because it collides with markdown setext underlines. Vendored and
  //    untracked build dirs (node_modules, vscode-extension/, .git) are not pack content.
  const markerRe = /^(<{7} |>{7} )/;
  const skipSeg = /(^|\/)(node_modules|vscode-extension|\.git|dist)(\/|$)/;
  const scanTargets = [
    ...activeDirs.map((d) => join(PACK_ROOT, d)),
    join(PACK_ROOT, "mcp-server", "src"),
    join(PACK_ROOT, "mcp-server", "test"),
    join(PACK_ROOT, "evals"),
  ];
  const markers = [];
  for (const base of scanTargets) {
    for (const f of walkFiles(base, [".md", ".sh", ".ts", ".mjs", ".yaml"])) {
      if (skipSeg.test(rel(f))) continue;
      readFileSync(f, "utf8").split("\n").forEach((ln, i) => {
        if (markerRe.test(ln)) markers.push(`${rel(f)}:${i + 1}`);
      });
    }
  }
  c.ok("no merge-conflict markers", markers.length === 0, markers.join("  "));

  // 3. The new IGA reference exists and the core canon points at it.
  c.ok("canon/iga-change-requests-api.md exists", packExists("canon/iga-change-requests-api.md"));
  c.ok("feature-mapping references the IGA API ref", (packRead("canon/feature-mapping.md") || "").includes("iga-change-requests-api"));
  c.ok("invariants I-10 references the IGA API ref", (packRead("canon/invariants.md") || "").includes("iga-change-requests-api"));

  // 4. Bootstrap scripts use the new /iga/change-requests surface, NOT the legacy
  //    /tide-admin/change-set calls. They must authorize per-id: bulk-authorize with
  //    actionTypeIn:["CREATE","DELETE"] matches no real action type (real ones are
  //    granular — CREATE_USER, DELETE_REALM, GRANT_ROLES, ADOPT_*), so it silently
  //    authorizes ZERO change requests and still returns 200. VERIFIED live 2026-08-06.
  const scripts = [
    "templates/nextjs-customer-portal/scripts/init-tidecloak.sh",
    "templates/nextjs-e2ee-vault/scripts/init-tidecloak.sh",
    "templates/shared/bootstrap-tidecloak.sh",
    "playbooks/deploy-tidecloak-docker.md",
  ];
  for (const s of scripts) {
    const t = packRead(s) || "";
    c.ok(`${s} authorizes change requests per-id`, t.includes("/iga/change-requests/$id/authorize"), "missing per-id authorize call");
    c.ok(`${s} commits change requests`, t.includes("/iga/change-requests/$id/commit"), "missing commit call");
    c.ok(`${s} avoids the no-op CREATE/DELETE actionTypeIn filter`, !t.includes('"actionTypeIn":["CREATE","DELETE"]'), "uses a filter that authorizes zero CRs");
    // Only flag real invocations — comments legitimately mention the superseded surface.
    const legacyCall = t.split("\n").some(
      (ln) => ln.includes("/tide-admin/change-set/") && !ln.trimStart().startsWith("#")
    );
    c.ok(`${s} does not call the legacy change-set surface`, !legacyCall, "legacy change-set call present");
  }

  // 4b. tide_dpop_auth.html must be byte-identical across every template and the
  //     canonical exemplar. The Tide enclave integrity-checks this file, so ANY local
  //     modification makes login fail with an unexplained 500 at the token exchange.
  //     It is not shipped in the @tidecloak/* npm packages, so nothing else catches drift.
  //     Canonical = the popup-safe page that posts to `window.opener || window.parent`
  //     with a self-post guard (AP-62 / GAP-068); scripts/check-dpop-asset.sh is the
  //     authority. The exemplar lives in sources/ (private — not synced or shipped); when
  //     it is absent (public repo / CI clone) we cross-check the shipped templates against
  //     each other, so drift is caught in every environment.
  const DPOP_REF = "sources/example-app-tidecloak-test-cases/test-app/public/tide_dpop_auth.html";
  const dpopRef = packRead(DPOP_REF);
  const dpopTemplates = [
    "nextjs-e2ee-vault", "nextjs-customer-portal",
    "react-vite-internal-dashboard", "vanilla-js-secure-form",
  ].map((tpl) => {
    const p = `templates/${tpl}/public/tide_dpop_auth.html`;
    const body = packRead(p);
    c.ok(`${p} exists`, !!body, "template must ship the DPoP page");
    return { p, body };
  });
  const dpopCanonical = dpopRef || dpopTemplates.find((t) => t.body)?.body;
  if (dpopCanonical) {
    c.ok("DPoP page is the popup-safe variant (window.opener || window.parent)",
      dpopCanonical.includes("window.opener"),
      "canonical DPoP page must post to window.opener || window.parent — see AP-62 / check-dpop-asset.sh");
    for (const { p, body } of dpopTemplates) {
      if (body) c.ok(`${p} matches the canonical DPoP page`, body === dpopCanonical,
        "DPoP page has drifted — the enclave integrity-checks it; copy the exemplar verbatim");
    }
  }

  // 5. Security gap mapping is complete: SG-01 .. SG-18 all present.
  const sg = packRead("canon/security-gap-mapping.md") || "";
  for (let i = 1; i <= 18; i++) {
    const id = "SG-" + String(i).padStart(2, "0");
    c.ok(`${id} present in security-gap-mapping`, sg.includes(`## ${id}`));
  }

  // 6. Every reference-app scenario has manifest.yaml + scenario.md.
  for (const app of listDir("reference-apps").filter((n) => !n.endsWith(".md"))) {
    c.ok(`scenario '${app}' has manifest.yaml`, packExists(`reference-apps/${app}/manifest.yaml`));
    c.ok(`scenario '${app}' has scenario.md`, packExists(`reference-apps/${app}/scenario.md`));
  }

  // 7. Playbooks recommended by tide_choose_playbook actually exist as files.
  const server = packRead("mcp-server/src/server.ts") || "";
  const recommended = [...server.matchAll(/name:\s*"([a-z0-9-]+)",\s*reason:/g)].map((m) => m[1]);
  for (const p of new Set(recommended)) {
    c.ok(`recommended playbook '${p}' exists`, packExists(`playbooks/${p}.md`), "referenced by choose_playbook but file missing");
  }

  // 8. GAP register summary arithmetic: category counts sum to the stated Total.
  const gap = packRead("GAP_REGISTER.md") || "";
  const summaryStart = gap.indexOf("## Status Summary");
  if (summaryStart >= 0) {
    const block = gap.slice(summaryStart, summaryStart + 1200);
    const rows = [...block.matchAll(/^\|\s*([A-Z_]+)\s*\|\s*(\d+)\s*\|/gm)].map((m) => Number(m[2]));
    const totalM = block.match(/\|\s*\*\*Total\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|/);
    if (rows.length && totalM) {
      const sum = rows.reduce((a, b) => a + b, 0);
      c.ok("GAP register counts sum to Total", sum === Number(totalM[1]), `sum ${sum} != Total ${totalM[1]}`);
    } else {
      c.ok("GAP register summary parseable", false, "could not parse status rows / total");
    }
  } else {
    c.ok("GAP register has a Status Summary", false);
  }

  // 9. Honesty invariants: the anti-overclaim guards are present where they must be.
  c.ok("hosting canon keeps the Tideless-IGA caveat", /Tideless/.test(packRead("canon/hosting-options.md") || ""));
  c.ok("security analyst skill forbids out-of-scope overclaim (AP-SEC-1)", (packRead("skills/tide-security-analyst/SKILL.md") || "").includes("AP-SEC-1"));

  // 10. Directory / distribution readiness.
  c.ok("PRIVACY.md exists (required for Claude connector directory)", packExists("PRIVACY.md"));
  const parseJson = (p) => { try { return JSON.parse(packRead(p) || ""); } catch { return null; } };
  const plugin = parseJson(".claude-plugin/plugin.json");
  const market = parseJson(".claude-plugin/marketplace.json");
  c.ok(".claude-plugin/plugin.json parses", plugin !== null);
  c.ok("plugin.json name is raziel", plugin?.name === "raziel");
  c.ok("plugin.json declares the MCP server", !!plugin?.mcpServers && Object.keys(plugin.mcpServers).length > 0);
  c.ok(".claude-plugin/marketplace.json parses", market !== null);
  c.ok("marketplace lists the raziel plugin", Array.isArray(market?.plugins) && market.plugins.some((p) => p.name === "raziel"));
  const src = market?.plugins?.find((p) => p.name === "raziel")?.source;
  c.ok("marketplace plugin source is a relative './' path", typeof src === "string" && src.startsWith("./"), `source=${JSON.stringify(src)}`);
  c.ok("marketplace name is not an Anthropic-reserved name", !["claude-plugins-official", "claude-plugins-community", "claude-community", "anthropic-plugins", "first-party-plugins"].includes(market?.name));

  // 11. Version coherence: server.ts, npm packages, and plugin.json must all agree
  //     (npx @tideorg/mcp, the hosted deploy, and the plugin all read from these).
  const serverTs = packRead("mcp-server/src/server.ts") || "";
  const serverVer = serverTs.match(/name:\s*"@tideorg\/mcp",\s*version:\s*"([\d.]+)"/)?.[1];
  const rootVer = parseJson("package.json")?.version;
  const mcpPkgVer = parseJson("mcp-server/package.json")?.version;
  const pluginVer = plugin?.version;
  const versions = { serverTs: serverVer, rootPkg: rootVer, mcpPkg: mcpPkgVer, pluginJson: pluginVer };
  const allMatch = serverVer && [rootVer, mcpPkgVer, pluginVer].every((v) => v === serverVer);
  c.ok("versions are in sync across server.ts / package.json / plugin.json", allMatch, JSON.stringify(versions));

  return c.results;
}
