// Content-consistency checks: catch doctrine drift a protocol test can't see.
// These are the regression gate for reconciliations like the IGA API migration.
import { PACK_ROOT, packRead, packExists, listDir, walkFiles, Checks } from "./harness.mjs";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const existsSyncSafe = (p) => { try { return readFileSync(p, "utf8") !== null; } catch { return false; } };
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

  // 1b. No realm template may declare a `tide-*` protocol-mapper provider.
  //     MEASURED on tideorg/tidecloak-dev:latest (the production image): /admin/serverinfo lists
  //     24 openid-connect protocolMapperTypes and NONE contains "tide". `tide-roles-mapper` does
  //     not exist, and a realm import declaring it returns 201 Created with the mapper SILENTLY
  //     DROPPED — so roles go missing from tokens with no error anywhere. Stock types only:
  //     oidc-usermodel-attribute-mapper, oidc-hardcoded-claim-mapper, oidc-usermodel-*-role-mapper.
  //     See AP-80 / canon/tidecloak-bootstrap.md. sources/ is a bounded audit record and exempt.
  //     Scope: realm-template and script files only. Markdown is EXCLUDED on purpose — canon has to
  //     be able to show the wrong form in order to warn against it (AP-80 quotes it verbatim), and a
  //     gate that forbids documenting an anti-pattern is worse than no gate.
  const badMapper = [];
  for (const d of activeDirs) {
    for (const f of walkFiles(join(PACK_ROOT, d), [".json", ".template", ".sh"])) {
      readFileSync(f, "utf8").split("\n").forEach((ln, i) => {
        if (/"protocolMapper"\s*:\s*"tide-[^"]*"/.test(ln)) badMapper.push(`${rel(f)}:${i + 1}`);
      });
    }
  }
  c.ok(
    'no realm template declares a "tide-*" protocolMapper (no such provider exists — AP-80)',
    badMapper.length === 0,
    badMapper.join("  "),
  );

  // 1d. No hardcoded master-admin password in active scripts/docs. It belongs in .env, and the
  //     script must FAIL when unset — a default password is a hardcoded credential with extra
  //     steps, and it also lands in shell history, CI logs and `ps` output (AP-41).
  //     Allowed: a variable expansion ("$VAR" / ${VAR}) or an empty assignment in a template.
  const PW_VARS = "(?:KC_BOOTSTRAP_ADMIN_PASSWORD|KC_ADMIN_PASSWORD|KEYCLOAK_ADMIN_PASSWORD)";
  const okValue = (v) =>
    v.startsWith('"$') || v.startsWith("$") || v.startsWith("${") || v === '""' || v === "''";
  //  - Runnable files (.sh/.yml/.json/.template/.example): ANY literal assignment is a leak.
  //  - Markdown: only the COPYABLE `-e VAR=literal` docker form. Prose must be able to quote the
  //    wrong shape in order to warn against it — the same reason gate 1b excludes .md.
  const pwLeaks = [];
  for (const d of activeDirs) {
    for (const f of walkFiles(join(PACK_ROOT, d), [".sh", ".yml", ".yaml", ".json", ".template", ".example"])) {
      const re = new RegExp(PW_VARS + "\\s*=\\s*(\\S+)");
      readFileSync(f, "utf8").split("\n").forEach((ln, i) => {
        const m = re.exec(ln);
        if (m && !okValue(m[1])) pwLeaks.push(`${rel(f)}:${i + 1}`);
      });
    }
    for (const f of walkFiles(join(PACK_ROOT, d), [".md"])) {
      // canon/anti-patterns.md is definitionally the place that QUOTES wrong forms in order to
      // forbid them — AP-41's ❌ block shows this exact literal. Exempt that one file rather than
      // weakening the rule for every playbook and template, where copyable snippets actually live.
      if (rel(f) === "canon/anti-patterns.md") continue;
      const re = new RegExp("-e\\s+" + PW_VARS + "=(\\S+)");
      readFileSync(f, "utf8").split("\n").forEach((ln, i) => {
        const m = re.exec(ln);
        if (m && !okValue(m[1])) pwLeaks.push(`${rel(f)}:${i + 1}`);
      });
    }
  }
  c.ok(
    "no hardcoded master-admin password in active scripts or docs (AP-41 — use .env)",
    pwLeaks.length === 0,
    pwLeaks.join("  "),
  );

  // 1e. If a template tells you to put a secret in .env, .env must be gitignored there.
  const envUnignored = [];
  for (const tdir of listDir("templates")) {
    const base = join(PACK_ROOT, "templates", tdir);
    const hasEnvDoc = ["\.env.example", "\.env.template"].some((n) =>
      existsSyncSafe(join(base, n.replace("\\", ""))),
    );
    if (!hasEnvDoc) continue;
    const gi = packRead(`templates/${tdir}/.gitignore`) ?? "";
    if (!/^\.env\s*$/m.test(gi)) envUnignored.push(`templates/${tdir}/.gitignore`);
  }
  c.ok(
    "every template that ships a .env example also gitignores .env",
    envUnignored.length === 0,
    envUnignored.join("  "),
  );

  // 1f. No claim that migrating to TideCloak needs no code changes, and no promise that a
  //     Keycloak/OIDC app is automatically tidifiable. Tidifying flips the token algorithm to EdDSA
  //     (measured), so RS256-only verifiers 401 on every request — AP-82. canon/anti-patterns.md and
  //     canon/tidify-compatibility.md are exempt: their job is quoting the wrong claim to forbid it.
  const overclaimRe = /no code changes (are )?(needed|required)|drop-in (migration|replacement) (from|for) keycloak|works with any keycloak/i;
  const overclaims = [];
  for (const d of ["canon", "playbooks", "reference-apps", "prompts", "adapters", "skills"]) {
    for (const f of walkFiles(join(PACK_ROOT, d), [".md"])) {
      const r = rel(f);
      if (r === "canon/anti-patterns.md" || r === "canon/tidify-compatibility.md") continue;
      readFileSync(f, "utf8").split("\n").forEach((ln, i) => {
        if (overclaimRe.test(ln)) overclaims.push(`${r}:${i + 1}`);
      });
    }
  }
  c.ok(
    "no 'no code changes needed' / drop-in-tidification claim (AP-82 — EdDSA changes the verifier)",
    overclaims.length === 0,
    overclaims.join("  "),
  );

  // 1g. Nothing may tell you to SOURCE tide_dpop_auth.html from the stale copy, or assert that
  //     window.opener must be ABSENT. The keylessh repo carries BOTH copies and the one at its repo
  //     ROOT is the stale 7183-byte version that posts to window.parent — which fails in a popup with
  //     TIDE-SWE-UNHANDLED. A hash check over FILES cannot catch prose telling you to fetch the wrong
  //     file, which is how this survived: the templates were correct and the playbook still pointed
  //     at the broken copy. Reported by a user 2026-08-17. AP-62/GAP-068.
  //     canon/troubleshooting.md is exempt: its reversal note quotes the wrong instruction to correct it.
  const dpopBad = [];
  for (const d of ["canon", "playbooks", "reference-apps", "skills", "prompts", "adapters", "templates"]) {
    for (const f of walkFiles(join(PACK_ROOT, d), [".md", ".sh"])) {
      const r = rel(f);
      if (r === "canon/troubleshooting.md") continue;
      readFileSync(f, "utf8").split("\n").forEach((ln, i) => {
        // sourcing from the keylessh REPO ROOT public/ (its client/public/ copy is the good one)
        if (/example-app-keylessh\/public\/tide_dpop_auth\.html/.test(ln)) {
          dpopBad.push(`${r}:${i + 1} (stale source path)`);
        }
        // asserting window.opener is absent / must not be added
        if (/(!\s*grep[^\n]*window\.opener|window\.opener[^\n]{0,40}#\s*want 0|do not add[^\n]{0,30}window\.opener|never\s+`?window\.opener)/i.test(ln)) {
          dpopBad.push(`${r}:${i + 1} (asserts window.opener absent — inverted)`);
        }
      });
    }
  }
  c.ok(
    "nothing sources tide_dpop_auth.html from the stale copy or asserts window.opener is absent (AP-62)",
    dpopBad.length === 0,
    dpopBad.join("  "),
  );

  // 1h. No hardcoded TideCloak cluster version in a Skycloak create body, and never the tag
  //     `latest`. A pin does not fail — it keeps provisioning an old build forever, so nothing
  //     signals it went stale; and Skycloak validates the version against
  //     ^[0-9]+\.[0-9]+(\.[0-9]+)?$, so `latest` is rejected outright. The version must be
  //     DISCOVERED (templates/shared/skycloak-latest-version.sh). AP-84.
  //     Exempt: the discovery script itself (it defines the floor), the anti-pattern entry, and
  //     canon/hosting-options.md — the last two must quote the wrong form in order to forbid it.
  const pinned = [];
  const versionExempt = new Set([
    "templates/shared/skycloak-latest-version.sh",
    "canon/anti-patterns.md",
    "canon/hosting-options.md",
  ]);
  for (const d of ["canon", "playbooks", "skills", "prompts", "adapters", "templates", "reference-apps"]) {
    for (const f of walkFiles(join(PACK_ROOT, d), [".md", ".sh"])) {
      const r = rel(f);
      if (versionExempt.has(r)) continue;
      readFileSync(f, "utf8").split("\n").forEach((ln, i) => {
        // a create body naming the cluster type AND a literal version
        if (/"type"\s*:\s*"tidecloak"/.test(ln) && /"version"\s*:\s*"[0-9]/.test(ln)) {
          pinned.push(`${r}:${i + 1} (hardcoded cluster version — discover it)`);
        }
        if (/"version"\s*:\s*"latest"/.test(ln)) {
          pinned.push(`${r}:${i + 1} ("latest" is not a valid Skycloak version)`);
        }
      });
    }
  }
  c.ok(
    "no hardcoded/`latest` TideCloak cluster version in a Skycloak create body (AP-84 — discover it)",
    pinned.length === 0,
    pinned.join("  "),
  );

  // 1i. Nothing may source the Skycloak cluster VERSION from Docker Hub. Skycloak exact-matches
  //     against a server-side allowlist (SupportedTideCloak -> ErrInvalidClusterVersion), so the
  //     newest published tag is frequently un-provisionable. Reading tags instead of asking the API
  //     is what made clusters keep coming up old: newest 400s, the walk-down loop absorbs it, and
  //     you land on something ancient with no error. AP-84.
  //     Exempt: the discovery script (Docker Hub is its --check lag diagnostic only) and the
  //     anti-pattern/canon entries, which must quote the wrong source to forbid it.
  const hubSourced = [];
  const hubExempt = new Set([
    "templates/shared/skycloak-latest-version.sh",
    "canon/anti-patterns.md",
    "canon/hosting-options.md",
    "playbooks/provision-tidecloak-skycloak.md",
  ]);
  for (const d of ["canon", "playbooks", "skills", "prompts", "adapters", "templates", "reference-apps"]) {
    for (const f of walkFiles(join(PACK_ROOT, d), [".md", ".sh"])) {
      const r = rel(f);
      if (hubExempt.has(r)) continue;
      readFileSync(f, "utf8").split("\n").forEach((ln, i) => {
        if (/hub\.docker\.com[^\n]*tidecloak/.test(ln)) {
          hubSourced.push(`${r}:${i + 1} (Docker Hub is not Skycloak's version list)`);
        }
      });
    }
  }
  c.ok(
    "no file sources the Skycloak cluster version from Docker Hub (AP-84 — ask the API)",
    hubSourced.length === 0,
    hubSourced.join("  "),
  );

  // 1j. The pack must not repeat the unverified negative that caused AP-84's second mistake.
  //     `GET /clusters/supported-versions?type=tidecloak` and `GET /clusters/versions` both exist;
  //     claiming otherwise is what sent the previous author to Docker Hub for a substitute.
  const noEndpoint = [];
  for (const d of ["canon", "playbooks", "skills", "prompts", "adapters", "templates"]) {
    for (const f of walkFiles(join(PACK_ROOT, d), [".md", ".sh"])) {
      const r = rel(f);
      if (r === "canon/anti-patterns.md" || r === "canon/hosting-options.md") continue;
      readFileSync(f, "utf8").split("\n").forEach((ln, i) => {
        // Allow a line that quotes the claim in order to retract it — that is how the
        // correction is taught. Only an unretracted assertion is a failure.
        const retracts = /that was wrong|is wrong|was never verified|no longer true|older pack docs|incorrect/i.test(ln);
        if (/(is|are)\s+no\s+versions?\s+endpoint/i.test(ln) && !retracts) {
          noEndpoint.push(`${r}:${i + 1} (false — /clusters/supported-versions exists)`);
        }
      });
    }
  }
  c.ok(
    "nothing claims Skycloak has no versions endpoint (AP-84 — it does, behind the API key)",
    noEndpoint.length === 0,
    noEndpoint.join("  "),
  );

  // 1k. Nothing may loop the cluster-create over the version list, retrying downward. The list now
  //     comes from Skycloak itself, so every entry is one it claims to support -- a
  //     `400 invalid cluster version` means something is inconsistent, not that an older build will
  //     do. Retrying downward is only ever a downgrade, and it is what kept clusters coming up old
  //     with no error reaching the operator. Take the newest, create once, fail loudly. AP-84.
  const walkDown = [];
  for (const d of ["canon", "playbooks", "skills", "prompts", "adapters", "templates", "reference-apps"]) {
    for (const f of walkFiles(join(PACK_ROOT, d), [".md", ".sh"])) {
      const r = rel(f);
      readFileSync(f, "utf8").split("\n").forEach((ln, i) => {
        if (/for\s+\w+\s+in\s+\$\([^)]*skycloak-latest-version\.sh[^)]*--list/.test(ln)) {
          walkDown.push(`${r}:${i + 1} (looping the create over --list downgrades silently)`);
        }
      });
    }
  }
  c.ok(
    "no create-cluster loop that retries down the version list (AP-84 — newest or fail)",
    walkDown.length === 0,
    walkDown.join("  "),
  );

  // 1l. Enclave branding geometry must not describe the WRONG render mechanism. Measured from the
  //     live enclave stylesheet and confirmed by hit-testing the element: the logo container is
  //     `border-radius: 50%` + `background-size: cover` on a white plate. An earlier revision said
  //     the logo was fitted into a box with `object-contain`, which is the opposite behaviour --
  //     `contain` fits and never crops, `cover` fills and crops, and neither describes the circular
  //     mask that actually cuts the corners off. That wording told users to pad for the wrong shape.
  const brandWrong = [];
  for (const d of ["canon", "playbooks", "skills", "prompts", "adapters", "templates", "reference-apps"]) {
    for (const f of walkFiles(join(PACK_ROOT, d), [".md", ".py", ".sh"])) {
      const r = rel(f);
      readFileSync(f, "utf8").split("\n").forEach((ln, i) => {
        if (/object-contain/.test(ln) && /logo|enclave|brand/i.test(ln)) {
          brandWrong.push(`${r}:${i + 1} (logo uses background-size: cover + a circular mask)`);
        }
      });
    }
  }
  c.ok(
    "branding docs describe the real logo render (circular crop + cover, not object-contain)",
    brandWrong.length === 0,
    brandWrong.join("  "),
  );

  // 1m. The branding guidance must actually mention the circular crop. It is the single fact that
  //     changes what a user should draw, and it was missing entirely until measured.
  const brandingDocs = ["templates/enclave-branding/README.md", "templates/enclave-branding/IMAGE-PROMPT.md"];
  const missingCircle = brandingDocs.filter((f) => {
    const t = packRead(f) || "";
    return !/border-radius:\s*50%/.test(t) || !/circle|circular/i.test(t);
  });
  c.ok(
    "branding docs state the circular crop (border-radius: 50%)",
    missingCircle.length === 0,
    missingCircle.join("  "),
  );

  // 1n. The branding flow must exist and must lead with ASKING the user. The real-world failure is
  //     not a broken upload -- it is that nobody offers, so every app ships with Tide's logo on its
  //     login screen. The tool description and the flow doc both have to carry the question.
  const flowDoc = packRead("templates/enclave-branding/BRANDING-FLOW.md") || "";
  c.ok(
    "BRANDING-FLOW.md exists and tells the agent to ask the user first",
    flowDoc.length > 0 && /ask/i.test(flowDoc) && /branding\/(logo|background)/i.test(flowDoc),
    flowDoc ? "present but missing the ask or the drop path" : "missing",
  );
  const brandingTool = (packRead("mcp-server/src/server.ts") || "");
  c.ok(
    "tide_branding tells the agent to ask before generating",
    /ASK THE USER FIRST/.test(brandingTool),
    "server.ts tide_branding response must lead with the question",
  );

  // 1o. Every --kind the generator accepts must be documented, and vice versa. A kind that exists in
  //     code but not in the docs never gets picked; one documented but absent is a crash.
  const gen = packRead("templates/enclave-branding/make-branding.py") || "";
  const kindBlock = gen.slice(gen.indexOf("KINDS = {"), gen.indexOf("}", gen.indexOf("KINDS = {")));
  const codeKinds = [...kindBlock.matchAll(/^\s*"([a-z]+)":/gm)].map((m) => m[1]).sort();
  const undocumented = codeKinds.filter((k) => !flowDoc.includes("`" + k + "`"));
  c.ok(
    "every generator --kind is documented in BRANDING-FLOW.md",
    codeKinds.length > 0 && undocumented.length === 0,
    codeKinds.length === 0 ? "could not parse KINDS" : `undocumented: ${undocumented.join(", ")}`,
  );

  // 1c. Every shipped realm template must still carry the tideUserKey + vuid attribute mappers,
  //     so "remove tide-roles-mapper" can never be satisfied by deleting the Tide claims wholesale.
  const realmTemplates = [];
  for (const d of activeDirs) {
    for (const f of walkFiles(join(PACK_ROOT, d), [".json", ".template"])) {
      if (/realm.*\.json(\.template)?$/.test(rel(f))) realmTemplates.push(f);
    }
  }
  const missingClaims = [];
  for (const f of realmTemplates) {
    const src = readFileSync(f, "utf8");
    const hasUserKey = /"user\.attribute"\s*:\s*"tideUserKey"/.test(src);
    const hasVuid = /"user\.attribute"\s*:\s*"vuid"/.test(src);
    if (!hasUserKey || !hasVuid) {
      missingClaims.push(`${rel(f)}(${!hasUserKey ? " tideUserKey" : ""}${!hasVuid ? " vuid" : ""})`);
    }
  }
  c.ok(
    "realm templates found to check for Tide claim mappers",
    realmTemplates.length > 0,
    `found ${realmTemplates.length}`,
  );
  c.ok(
    "every realm template maps tideUserKey and vuid (stock attribute mappers)",
    missingClaims.length === 0,
    missingClaims.join("  "),
  );

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
      "The reference DPoP page does NOT contain window.opener, so it is the stale 7183-byte copy. " +
      "In a popup window.parent === window, so that page messages itself and login fails with " +
      "TIDE-SWE-UNHANDLED. Do not 'restore' templates to match it — see AP-62 and AP-83.");
    // Anchor to the known-good hash as well, so 'all copies agree' can never mean 'all copies are
    // equally wrong'. Bidirectional: catches a revert TO the bad version, not just drift away.
    const dpopHash = createHash("sha256").update(dpopCanonical, "utf8").digest("hex");
    c.ok("canonical DPoP page matches the known-good sha256",
      dpopHash === "9d7844b938f0a2565fa910d3d30e9b8797cbfd6e0b73d59d804169a089aea757",
      `got ${dpopHash} (9120-byte popup-safe copy expected). A matching hash is the only check that ` +
      `survives every copy being swapped at once.`);
    for (const { p, body } of dpopTemplates) {
      if (body) c.ok(`${p} matches the canonical DPoP page`, body === dpopCanonical,
        "DPoP page differs from the reference. Do NOT assume the template is the wrong one — decide by " +
        "BEHAVIOUR: the correct page uses `window.opener || window.parent` so it works in the popup " +
        "fallback (AP-83). Get the right bytes from the MCP (`tide_dpop_asset`) or " +
        "sources/example-app-tidecloak-test-cases/.../tide_dpop_auth.html. NEVER from " +
        "sources/example-app-keylessh/public/ — that repo holds BOTH copies and its root one is stale (AP-62).");
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
