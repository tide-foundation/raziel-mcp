// Content-consistency checks: catch doctrine drift a protocol test can't see.
// These are the regression gate for reconciliations like the IGA API migration.
import { PACK_ROOT, packRead, packExists, listDir, walkFiles, Checks } from "./harness.mjs";
import { readFileSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { RESTRICTED } from "../dist/server.js";

const parseJsonSafe = (t) => { try { return JSON.parse(t || ""); } catch { return null; } };
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
  //     MEASURED on tideorg/tidecloak-dev:latest: /admin/serverinfo lists
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
        // ...including the prose forms that outlived the first correction in three skill files:
        // "(no `window.opener`)", "must contain no `window.opener`", "adding `window.opener` ... fails".
        if (/(!\s*grep[^\n]*window\.opener|window\.opener[^\n]{0,40}#\s*want 0|do not add[^\n]{0,30}window\.opener|never\s+`?window\.opener|(\(|—\s*)no\s+`?window\.opener`?\)|contain no\s+`?window\.opener|adding\s+`?window\.opener`?[^\n]{0,40}fails)/i.test(ln)) {
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

  // 1t. Both end-user-facing decisions must be asked PROACTIVELY at the same checkpoint, not left
  //     as reactive "when the user brings it up" instructions. Branding and post-signup details are
  //     the only two things the END USER sees, and both defaults are bad -- Tide's logo on someone
  //     else's login screen, and an unstyled Keycloak form showing a 64-hex username. Branding was
  //     reactive-only for exactly this reason and never got offered; the user had to point it out.
  // Slice from `instructions: [` to the FIRST terminator AFTER it -- not the first in the file.
  // Another array in server.ts (END_USER_ASK) also ends with `].join("\n")`, and searching from
  // index 0 picked that one up, silently producing an empty block and three false failures.
  const instrStart = brandingTool.indexOf("instructions: [");
  const instrEnd = brandingTool.indexOf("].join(\"\\n\")", instrStart);
  const instrBlock = instrStart === -1 ? "" : brandingTool.slice(instrStart, instrEnd);
  const checkpoint = /ONCE A REALM IS BOOTSTRAPPED[\s\S]{0,2000}/.exec(instrBlock)?.[0] ?? "";
  c.ok(
    "server instructions ask about BRANDING proactively after bootstrap",
    /tide_branding/.test(checkpoint) && /brand the login screen/i.test(checkpoint),
    "the post-bootstrap checkpoint must offer branding, not wait to be asked",
  );
  c.ok(
    "server instructions ask about POST-SIGNUP DETAILS proactively after bootstrap",
    /tide_onboarding/.test(checkpoint) && /no name or email/i.test(checkpoint),
    "the post-bootstrap checkpoint must offer the profile form, not wait to be asked",
  );
  c.ok(
    "the post-bootstrap checkpoint asks both in ONE message and only once",
    /both of these/i.test(checkpoint) && /once per session|ask once/i.test(checkpoint),
    "asking twice, or nagging every turn, is its own failure",
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

  // 1p. Nothing may tell you to synthesise a placeholder email for a Tide user. Tide asserts only a
  //     username (the vuid), so the gap is real and faking it is the tempting fix -- but the fake is
  //     indistinguishable from a real address downstream, collides with Keycloak's email-uniqueness
  //     constraint, and destroys the "never set" signal. Tide does not need email for recovery
  //     (password reset happens in the enclave). AP-85. The anti-pattern entry and the onboarding
  //     doc are exempt: both must quote the wrong fix in order to forbid it.
  const fakeEmail = [];
  const emailExempt = new Set([
    "canon/anti-patterns.md",
    "templates/skip-idp-review/ONBOARDING.md",
    "templates/skip-idp-review/README.md",
  ]);
  for (const d of ["canon", "playbooks", "skills", "prompts", "adapters", "templates", "reference-apps"]) {
    for (const f of walkFiles(join(PACK_ROOT, d), [".md", ".sh", ".py", ".ts", ".tsx"])) {
      const r = rel(f);
      if (emailExempt.has(r)) continue;
      readFileSync(f, "utf8").split("\n").forEach((ln, i) => {
        // A STATIC bootstrap address (ADMIN_EMAIL=admin@example.com, the licensing email) is fine
        // and common. What AP-85 forbids is MINTING one PER USER. So require evidence of
        // per-user construction: an interpolation/concat next to an address, or an explicit
        // instruction to generate a unique email.
        // `${ADMIN_EMAIL:-admin@example.com}` is a shell DEFAULT, not construction. The tell for
        // the real anti-pattern is a PER-USER identifier interpolated into the local part.
        const perUser = "(vuid|uuid|guid|user_?id|userId|sub|random|uniq\\w*|counter|index)";
        const constructed =
          new RegExp("(\\$\\{|\\+|%s|\\{\\})[^\\n@]{0,24}" + perUser + "[^\\n@]{0,24}@[a-z0-9.-]+\\.[a-z]{2,}", "i").test(ln)
          || new RegExp(perUser + "[^\\n@]{0,16}@[a-z0-9.-]*(example|placeholder|invalid|test)", "i").test(ln);
        const instructed = /(generat|synthes|mint|fabricat)\w*[^\n]{0,30}(unique|random|per-user|placeholder|fake|dummy)?[^\n]{0,20}email/i.test(ln)
          && /(unique|random|per-user|placeholder|fake|dummy|vuid|uuid)/i.test(ln);
        const retracted = /never|do not|don'?t|avoid|instead of|rather than|forbid|AP-85/i.test(ln);
        if ((constructed || instructed) && !retracted) {
          fakeEmail.push(`${r}:${i + 1} (AP-85 — leave it empty and collect it in-app)`);
        }
      });
    }
  }
  c.ok(
    "nothing tells you to generate a placeholder email for a Tide user (AP-85)",
    fakeEmail.length === 0,
    fakeEmail.join("  "),
  );

  // 1q. The post-signup guidance must lead with the DIAGNOSTIC, not a fix. Four mechanisms render a
  //     similar form and each needs a different change; applying the wrong one leaves the page and
  //     alters something unintended. Measured: a correctly provisioned Tide realm has none active.
  const skipReadme = packRead("templates/skip-idp-review/README.md") || "";
  // 1r. Keycloak's KEYCLOAK_ROLE.DESCRIPTION is VARCHAR(255). A 289-char role description failed an
  //     ENTIRE realm import with an opaque HTTP 500 -- the cause appears only in the container log,
  //     which users then destroy by deleting the container. The pack encourages rich,
  //     self-documenting descriptions, so this cap has to be enforced mechanically.
  //     (LEARNINGS-vialproof-001 L-01.)
  const longDesc = [];
  const walkJson = (o, file, path = "") => {
    if (o && typeof o === "object") {
      for (const [k, v] of Object.entries(o)) {
        if (k === "description" && typeof v === "string" && v.length > 255) {
          longDesc.push(`${file}${path}/${k}: ${v.length} chars (cap 255)`);
        }
        walkJson(v, file, `${path}/${k}`);
      }
    }
  };
  for (const d of ["templates", "reference-apps"]) {
    for (const f of walkFiles(join(PACK_ROOT, d), [".json", ".template"])) {
      let parsed;
      try { parsed = JSON.parse(readFileSync(f, "utf8")); } catch { continue; }
      walkJson(parsed, rel(f));
    }
  }
  c.ok(
    "no realm-JSON description exceeds Keycloak's 255-char column (whole import 500s)",
    longDesc.length === 0,
    longDesc.join("  "),
  );

  // 1s. `UID` is READONLY in bash. Assigning to it prints "UID: readonly variable", keeps the OLD
  //     value, and CONTINUES -- so a bootstrap splices an empty/wrong id into a URL and grants 404
  //     silently. Combined with discarding output, the failure is invisible until the realm has
  //     already flipped to multiAdmin and the repair needs an enclave approval.
  //     (LEARNINGS-vialproof-001 L-04/L-05.)
  const uidAssign = [];
  for (const d of ["templates", "playbooks", "reference-apps", "skills", "adapters", "prompts", "canon"]) {
    for (const f of walkFiles(join(PACK_ROOT, d), [".sh", ".md"])) {
      const r = rel(f);
      if (r === "canon/anti-patterns.md") continue;
      readFileSync(f, "utf8").split("\n").forEach((ln, i) => {
        if (/(^|[^A-Za-z0-9_])UID=(?!=)/.test(ln) && !/readonly|do not|never|AP-86/i.test(ln)) {
          uidAssign.push(`${r}:${i + 1} (UID is readonly in bash — use USER_ID)`);
        }
      });
    }
  }
  // 1u. Every bootstrap that creates a realm must turn OFF the first-broker-login profile page, and
  //     must do it BEFORE toggle-iga. Tide asserts only a username, so the stock default stops every
  //     new user on an unstyled Keycloak form showing a 64-hex vuid. Leaving that as a fix people
  //     apply afterwards means it ships wrong by default -- which is exactly what happened.
  //     After IGA is enabled the same write is governed: 202 + a pending change request, not applied.
  const bootstraps = [
    "templates/shared/bootstrap-tidecloak.sh",
    "templates/nextjs-customer-portal/scripts/init-tidecloak.sh",
    "templates/nextjs-e2ee-vault/scripts/init-tidecloak.sh",
  ];
  const noSkip = [], wrongOrder = [];
  for (const b of bootstraps) {
    const t = packRead(b);
    if (t === null) continue;
    if (!/idp-review-profile/.test(t) || !/update\.profile\.on\.first\.login/.test(t)) {
      noSkip.push(b);
      continue;
    }
    const at = t.indexOf("idp-review-profile");
    const iga = t.indexOf("toggle-iga");
    if (iga !== -1 && at > iga) wrongOrder.push(`${b} (must run BEFORE toggle-iga)`);
  }
  // 1w. The two end-user decisions must be printed by the BOOTSTRAP SCRIPT itself, not left to MCP
  //     `instructions`. Instructions are advisory: they reach the agent only if the server is built
  //     from current source AND the session was restarted, and a client may summarise them away.
  //     Both questions were being skipped in practice for exactly that reason -- the user reported
  //     never being asked. Script stdout goes straight to the operator every run.
  const asksInOutput = [];
  for (const b of [
    "templates/shared/bootstrap-tidecloak.sh",
    "templates/nextjs-customer-portal/scripts/init-tidecloak.sh",
    "templates/nextjs-e2ee-vault/scripts/init-tidecloak.sh",
  ]) {
    const t = packRead(b);
    if (t === null) continue;
    const brands = /BRANDING/.test(t) && /brand-tidecloak\.sh/.test(t);
    // Keyed on the ASK and on the tool that builds the page -- NOT on the component filename.
    // The scripts deliberately no longer name the file, because telling the user to copy it is
    // the thing gate 1y forbids.
    const details = /NEW-USER DETAILS/.test(t) && /tide_onboarding|WRITES the/.test(t);
    if (!brands || !details) {
      asksInOutput.push(`${b}${brands ? "" : " (no branding ask)"}${details ? "" : " (no new-user-details ask)"}`);
    }
  }
  // 1x. The two questions must be attached to the step that BLOCKS on a human -- the admin invite
  //     link, where the script polls until someone opens it in a browser. Printed anywhere else an
  //     agent batching human interaction to the end simply answers them itself and reports the
  //     decisions afterwards, which is what happened three times running. AP-87.
  const bs = packRead("templates/shared/bootstrap-tidecloak.sh") || "";
  const askAt = bs.indexOf("WHILE YOU ARE HERE");
  const linkAt = bs.indexOf("Open this link in a browser");
  const pollAt = bs.indexOf("Waiting for admin to link Tide account");
  // 1y. tide_onboarding must EMIT the component, not tell the user to copy a template. "cp this
  //     file" is not creating the page: the agent still has to notice it, adapt the fields, and wire
  //     it up, and each of those is somewhere to stop. Reported as "mcp should create the page".
  const srv = packRead("mcp-server/src/server.ts") || "";
  // 1z. Agents WRITE THEIR OWN init script per app -- they do not run the pack's. So the requirement
  //     to print the two questions at the invite link has to live in the material they read while
  //     writing it: canon/tidecloak-bootstrap.md and every reference-app bootstrap sequence. Putting
  //     it only in the pack's own scripts reached nobody, which is why the same "decisions I made
  //     without asking" report arrived four builds running. AP-87.
  const bootCanon = packRead("canon/tidecloak-bootstrap.md") || "";
  c.ok(
    "bootstrap canon requires the invite-link ask in scripts the agent writes (AP-87)",
    /AP-87/.test(bootCanon) && /WHILE YOU ARE HERE/.test(bootCanon) && /WAIT for the answer/i.test(bootCanon),
    "canon/tidecloak-bootstrap.md must carry the banner and the ask-and-wait rule",
  );
  const seqMissing = [];
  for (const f of walkFiles(join(PACK_ROOT, "reference-apps"), [".md"])) {
    const r = rel(f);
    if (!r.endsWith("bootstrap-sequence.md")) continue;
    const t = readFileSync(f, "utf8");
    if (/invite/i.test(t) && !/AP-87/.test(t)) seqMissing.push(r);
  }
  c.ok(
    "every reference-app bootstrap sequence carries the invite-link ask requirement",
    seqMissing.length === 0,
    seqMissing.join("  "),
  );

  // 2a. tide_dpop_auth.html must be COPIED, never regenerated. It is a relay page the enclave loads
  //     during login, integrity-relevant to the byte, and an agent asked to reproduce 9 KB of HTML
  //     will silently normalise quotes, indentation or line endings. The tool must therefore lead
  //     with an absolute-path `cp` plus a mandatory hash check, and only fall back to a listing.
  //     Note the inversion risk here is the OPPOSITE of tide_onboarding, where emitting the file is
  //     correct: that component is meant to be customised, this one must not be touched at all.
  const dpopSrc = packRead("mcp-server/src/server.ts") || "";
  const dpopIdx = dpopSrc.indexOf('"tide_dpop_asset"');
  const dpopBlock = dpopIdx === -1 ? "" : dpopSrc.slice(dpopIdx, dpopIdx + 6000);
  // 2b. The two end-user questions must lead the RESPONSE of every bootstrap-shaped tool, above the
  //     document. Five builds running ended with the agent deciding both itself and reporting them
  //     as "decisions I made without asking" (AP-87). Every previous placement -- MCP instructions,
  //     the pack's own scripts, a playbook section, canon -- was somewhere the agent either did not
  //     read or read as background. A tool response it must call to build the realm is the last
  //     position left. Matched on playbook NAME, so unrelated playbooks stay clean.
  const srvSrc = packRead("mcp-server/src/server.ts") || "";
  c.ok(
    "END_USER_ASK exists and demands asking, not deciding",
    /const END_USER_ASK = \[/.test(srvSrc) &&
      /TWO QUESTIONS YOU MUST ASK/.test(srvSrc) &&
      /Do not choose/.test(srvSrc) &&
      /tide_onboarding/.test(srvSrc) &&
      /tide_branding/.test(srvSrc),
    "the block must name both tools and forbid deciding on the user's behalf",
  );
  c.ok(
    "every bootstrap-shaped tool response leads with it",
    // Both now leave through deliver(), which puts `lead` above part 1 of the document.
    /const BOOTSTRAP_LEAD = LICENSE_ASK \+ END_USER_ASK;/.test(srvSrc) &&
      /deliver\([^\n]*tide_scenario_bootstrap[^\n]*\{ lead: BOOTSTRAP_LEAD \}\)/.test(srvSrc) &&
      /lead: isBootstrap \? BOOTSTRAP_LEAD : ""/.test(srvSrc),
    "tide_scenario_bootstrap and bootstrap playbooks must both prepend it",
  );
  // Every playbook that generates an invite link is a realm bootstrap and must carry the ask.
  const askPattern = srvSrc.match(/const isBootstrap =\s*\n?\s*\/([^/]+)\/i\.test\(name\)/)?.[1];
  const missedPlaybooks = [];
  if (askPattern) {
    const re = new RegExp(askPattern, "i");
    for (const f of walkFiles(join(PACK_ROOT, "playbooks"), [".md"])) {
      const base = rel(f).replace(/^playbooks\//, "").replace(/\.md$/, "");
      const t = readFileSync(f, "utf8");
      if (/get-required-action-link/.test(t) && !re.test(base)) missedPlaybooks.push(base);
    }
  }
  c.ok(
    "no invite-link playbook is left out of the bootstrap ask",
    askPattern !== undefined && missedPlaybooks.length === 0,
    missedPlaybooks.join("  "),
  );

  // 2c. Nothing may teach that verifying the JWT signature alone is sufficient when tokens carry
  //     cnf.jkt. That was the pack's guidance, carried a "CORRECT" marker, and is exploitable: a
  //     bare-Bearer replay of a sender-constrained token returned 200 on a live deployment. The
  //     "secureFetch sends a non-RFC-9449 format" premise is false -- measured against
  //     @tidecloak/js@0.14.20, the proof is an ordinary compact JWS. AP-43.
  //     Retractions are allowed: the correction has to quote the claim to reverse it.
  const dpopSkip = [];
  for (const d of ["canon", "playbooks", "skills", "adapters", "prompts", "reference-apps", "templates"]) {
    for (const f of walkFiles(join(PACK_ROOT, d), [".md"])) {
      const r = rel(f);
      readFileSync(f, "utf8").split("\n").forEach((ln, i) => {
        const teaches =
          /skip (the )?dpop proof|no need to re-verify the proof|verify jwt signature only|dpop proof verification is optional|optional defense-in-depth/i.test(ln) ||
          (/tide-specific format/i.test(ln) && !/false|wrong|was not|claim/i.test(ln));
        const retracts =
          /was (false|wrong|inverted)|previously|corrected|do not|never|AP-43|exploitable|read that failure|original report|conclusion/i.test(ln);
        if (teaches && !retracts) dpopSkip.push(`${r}:${i + 1} (AP-43 — the proof MUST be verified)`);
      });
    }
  }
  c.ok(
    "nothing teaches that a cnf.jkt token needs no proof verification (AP-43)",
    dpopSkip.length === 0,
    dpopSkip.join("  "),
  );
  c.ok(
    "a tested DPoP proof verifier ships with the pack",
    packExists("templates/dpop-verify/verifyDpop.ts") &&
      packExists("templates/dpop-verify/verifyDpop.test.mjs") &&
      /calculateJwkThumbprint/.test(packRead("templates/dpop-verify/verifyDpop.ts") || "") &&
      /x-forwarded-host/.test(packRead("templates/dpop-verify/verifyDpop.ts") || ""),
    "verifier must check the thumbprint and reconstruct htu behind a proxy",
  );

  // 2d. The pack's own snippets must not send `password=password` -- that is AP-41, its own rule.
  const hardcodedPw = [];
  for (const d of ["playbooks", "templates", "canon", "reference-apps", "skills"]) {
    for (const f of walkFiles(join(PACK_ROOT, d), [".md", ".sh"])) {
      const r = rel(f);
      if (r === "canon/anti-patterns.md") continue;
      readFileSync(f, "utf8").split("\n").forEach((ln, i) => {
        if (/password=password\b/.test(ln) && !/never|do not|don'?t|wrong|AP-41|\*\*Mistake\*\*|❌/i.test(ln)) {
          hardcodedPw.push(`${r}:${i + 1} (AP-41 — read KC_BOOTSTRAP_ADMIN_PASSWORD)`);
        }
      });
    }
  }
  c.ok(
    "no pack snippet sends a hardcoded password=password (AP-41)",
    hardcodedPw.length === 0,
    hardcodedPw.join("  "),
  );

  c.ok(
    "tide_dpop_asset leads with a byte-exact copy, not 'write this verbatim'",
    /COPY IT, do not retype it/.test(dpopBlock) &&
      /cp "\$\{sourcePath\}"/.test(dpopBlock) &&
      /sha256sum/.test(dpopBlock) &&
      /Fallback listing/.test(dpopBlock),
    "the tool must emit cp + sha256sum first and mark the listing as a fallback",
  );

  c.ok(
    "tide_onboarding emits a finished component to write (not a cp instruction)",
    /WRITE THIS FILE NOW/.test(srv) && /componentPath/.test(srv) && /mount\[fw\]/.test(srv),
    "the tool must return built file content plus a mounting snippet",
  );
  const cpTold = [];
  for (const b of [
    "templates/shared/bootstrap-tidecloak.sh",
    "templates/nextjs-customer-portal/scripts/init-tidecloak.sh",
    "templates/nextjs-e2ee-vault/scripts/init-tidecloak.sh",
  ]) {
    const t = packRead(b);
    if (t && /cp templates\/onboarding-modal/.test(t)) cpTold.push(b);
  }
  c.ok(
    "no bootstrap tells the user to cp the onboarding component themselves",
    cpTold.length === 0,
    cpTold.join("  "),
  );

  c.ok(
    "the two questions sit at the invite-link human checkpoint (AP-87)",
    askAt !== -1 && linkAt !== -1 && pollAt !== -1 && askAt > linkAt && askAt < pollAt,
    `link=${linkAt} ask=${askAt} poll=${pollAt} — the ask must fall between the link and the wait`,
  );
  c.ok(
    "that block tells the agent to ASK and WAIT, not decide",
    /ask these as QUESTIONS and wait/i.test(bs) && /Do not pick for the user/i.test(bs),
    "an agent will otherwise choose for the user and report it afterwards",
  );

  c.ok(
    "bootstrap scripts PRINT both end-user questions (not left to MCP instructions)",
    asksInOutput.length === 0,
    asksInOutput.join("  "),
  );

  c.ok(
    "every realm bootstrap disables the first-broker-login profile page",
    noSkip.length === 0,
    noSkip.join("  "),
  );
  c.ok(
    "that step runs before toggle-iga (after IGA it is a governed write, not applied)",
    wrongOrder.length === 0,
    wrongOrder.join("  "),
  );

  // 1v. The shipped realm template must not mark email/firstName/lastName REQUIRED. Tide never
  //     supplies them, so a required attribute re-arms the same page even with the flow step above.
  const profTpl = packRead("templates/shared/realm.json.template") || "";
  const requiredAttrs = [...profTpl.matchAll(/\\"name\\":\\"(email|firstName|lastName)\\"[^}]{0,400}?\\"required\\"/g)]
    .map((m) => m[1]);
  c.ok(
    "realm template marks no Tide-absent attribute as required (would re-arm the signup page)",
    requiredAttrs.length === 0,
    `required: ${requiredAttrs.join(", ")}`,
  );

  c.ok(
    "no shell snippet assigns to UID (readonly in bash — silent empty-id grants)",
    uidAssign.length === 0,
    uidAssign.join("  "),
  );

  c.ok(
    "post-signup guidance leads with the diagnostic, not a blind fix",
    /diagnose-post-signup-page\.sh/.test(skipReadme) &&
      skipReadme.indexOf("diagnose-post-signup-page.sh") < skipReadme.indexOf("skip-review-profile.sh"),
    "README must run the diagnostic before offering a fix",
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
  //     @tidecloak/js ships it only from 0.14.34, and the pack copy is what older SDKs and the
  //     hosted /pack route hand out, so nothing else catches drift here.
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

  // 4c. The files the asset tools READ must be in every shipped artifact. templates/ was in neither
  //     the Docker image nor the npm package, so on mcp.tide.org and under `npx @tideorg/mcp`
  //     tide_dpop_asset, tide_branding and tide_onboarding all returned "not found" errors --
  //     MEASURED against the live server 2026-10-07. This gate passed throughout, because it runs
  //     from a checkout where the files exist. So check the ARTIFACT definitions, not the disk.
  const dockerfile = packRead("Dockerfile") || "";
  c.ok("Dockerfile copies templates/ into the image", /^COPY\s+templates\/\s+\.\/templates\/\s*$/m.test(dockerfile),
    "tide_dpop_asset / tide_branding / tide_onboarding read templates/ at runtime");
  const pkgFiles = parseJsonSafe(packRead("package.json"))?.files ?? [];
  c.ok("package.json `files` ships templates/", pkgFiles.includes("templates/"), `files=${JSON.stringify(pkgFiles)}`);
  // Every path the server reads from disk at runtime must sit under a shipped directory.
  const shippedDirs = pkgFiles.filter((f) => f.endsWith("/")).map((f) => f.slice(0, -1));
  const runtimeReads = [...(packRead("mcp-server/src/server.ts") || "").matchAll(/"(templates|scripts|canon|playbooks|skills|prompts|adapters|reference-apps)\/[^"]*"/g)]
    .map((m) => m[0].slice(1, -1));
  const unshipped = [...new Set(runtimeReads)].filter((p) => !shippedDirs.some((d) => p.startsWith(d + "/")) && !pkgFiles.includes(p));
  c.ok("every pack path named in server.ts is inside a shipped directory", unshipped.length === 0, unshipped.join("  "));
  for (const copied of [...dockerfile.matchAll(/^COPY\s+(\S+)\s/gm)].map((m) => m[1].replace(/\/$/, ""))) {
    if (copied.startsWith("mcp-server")) continue;
    c.ok(`Dockerfile COPY source exists: ${copied}`, packExists(copied), "the image build fails on a missing COPY source");
  }
  // The public product repo is regenerated from an allowlist; a path the Dockerfile copies but the
  // allowlist omits breaks the image build THERE, not here. (The script is absent in that repo.)
  const syncScript = packRead("scripts/sync-to-raziel.sh");
  if (syncScript) {
    const publish = syncScript.slice(syncScript.indexOf("PUBLISH=("), syncScript.indexOf("\n)", syncScript.indexOf("PUBLISH=(")));
    const notSynced = [...dockerfile.matchAll(/^COPY\s+(\S+)\s/gm)].map((m) => m[1].replace(/\/$/, ""))
      .filter((p) => !p.startsWith("mcp-server"))
      .filter((p) => !new RegExp("(^|\\s)" + p.split("/")[0].replace(/\./g, "\\.") + "(\\s|$)").test(publish) && !publish.includes(p));
    c.ok("everything the Dockerfile copies is in the sync-to-raziel allowlist", notSynced.length === 0, notSynced.join("  "));
  }

  // 4d. A realm is licensed to an EMAIL under Tide's TERMS & CONDITIONS, and both must come from
  //     the user (AP-90). Tide's own flows prompt for them; the pack defaulted the email to
  //     admin@yourorg.com and never mentioned the terms. Enforced where it cannot be skipped: the
  //     scripts refuse to run, every realm-setup response leads with the ask, and the material an
  //     agent reads while writing its OWN init script carries the rule.
  const TERMS = "https://tide.org/legal";
  const licBootstraps = [
    "templates/shared/bootstrap-tidecloak.sh",
    "templates/nextjs-customer-portal/scripts/init-tidecloak.sh",
    "templates/nextjs-e2ee-vault/scripts/init-tidecloak.sh",
  ];
  for (const b of licBootstraps) {
    const t = packRead(b) || "";
    const gateAt = t.indexOf("TIDE_TERMS_ACCEPTED");
    // Everything executable (helpers, container start, API calls) sits below this marker; the
    // behavioural check further down proves nothing runs before the gate.
    const firstAction = t.indexOf("# --- Helpers ---");
    c.ok(`${b} checks licence email + terms before it does anything`,
      t.includes(TERMS) && t.includes("TIDE_LICENSE_EMAIL") && gateAt !== -1 && firstAction !== -1 && gateAt < firstAction,
      `gate=${gateAt} firstAction=${firstAction}`);
    c.ok(`${b} carries no default email`, !/ADMIN_EMAIL="\$\{ADMIN_EMAIL:-[^}]*@/.test(t) && !/LICENSE_EMAIL:-[^}$]*@/.test(t));
    c.ok(`${b} sends the user's address to setUpTideRealm`, /email=\$ADMIN_EMAIL|email=\$LICENSE_EMAIL|email=\$TIDE_LICENSE_EMAIL/.test(t));
  }
  // Behaviour, not text: run each script with no terminal. It must stop, say why, and start nothing.
  if (process.platform !== "win32") {
    const cases = [
      ["nothing supplied", {}],
      ["email but no acceptance", { TIDE_LICENSE_EMAIL: "owner@tide.org" }],
      ["acceptance but no email", { TIDE_TERMS_ACCEPTED: "yes" }],
      ["a placeholder email", { TIDE_LICENSE_EMAIL: "admin@example.com", TIDE_TERMS_ACCEPTED: "yes" }],
      ["the old default via ADMIN_EMAIL", { ADMIN_EMAIL: "admin@yourorg.com", TIDE_TERMS_ACCEPTED: "yes" }],
      ["acceptance spelled anything but yes", { TIDE_LICENSE_EMAIL: "owner@tide.org", TIDE_TERMS_ACCEPTED: "true" }],
    ];
    for (const b of licBootstraps) {
      const refused = [];
      for (const [label, env] of cases) {
        const cwd = mkdtempSync(join(tmpdir(), "tide-lic-"));
        const run = spawnSync("bash", [join(PACK_ROOT, b)], {
          cwd, input: "", encoding: "utf8", timeout: 20000,
          // PATH without docker/sudo on purpose is not possible portably; the gate runs before either.
          env: { PATH: process.env.PATH, HOME: cwd, KC_BOOTSTRAP_ADMIN_PASSWORD: "x", TIDECLOAK_URL: "http://127.0.0.1:1", ...env },
        });
        const out = (run.stdout || "") + (run.stderr || "");
        if (run.status !== 2 || !out.includes(TERMS) || !/ASK THE USER/.test(out) || /Cleaning previous state|Starting TideCloak|==> /.test(out)) {
          refused.push(`${label}: exit=${run.status} out=${out.slice(0, 80).replace(/\n/g, " ")}`);
        }
      }
      c.ok(`${b} refuses to run without the user's email and agreement (6 cases)`, refused.length === 0, refused.join("  ||  "));
    }
  }
  // No snippet anywhere may license a realm to a literal address.
  const literalEmail = [];
  for (const d of ["canon", "playbooks", "reference-apps", "templates", "skills", "adapters", "prompts"]) {
    for (const f of walkFiles(join(PACK_ROOT, d), [".md", ".sh", ".template", ".example"])) {
      const r = rel(f);
      if (r === "canon/anti-patterns.md") continue; // AP-90 quotes the wrong form to forbid it
      readFileSync(f, "utf8").split("\n").forEach((ln, i) => {
        if (/email=[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/.test(ln) || /ADMIN_EMAIL:-[^}]*@/.test(ln)) literalEmail.push(`${r}:${i + 1}`);
      });
    }
  }
  c.ok("no snippet licenses a realm to a literal or default email (AP-90)", literalEmail.length === 0, literalEmail.join("  "));
  // Every document that shows a setUpTideRealm CALL must state the rule, so it cannot be copied without it.
  const callsWithoutRule = [];
  for (const d of ["canon", "playbooks", "reference-apps"]) {
    for (const f of walkFiles(join(PACK_ROOT, d), [".md"])) {
      const t = readFileSync(f, "utf8");
      if (/vendorResources\/setUpTideRealm/.test(t) && /email=/.test(t) && !(t.includes(TERMS) || /AP-90/.test(t))) callsWithoutRule.push(rel(f));
    }
  }
  c.ok("every doc that shows the licensing call states the ask-first rule", callsWithoutRule.length === 0, callsWithoutRule.join("  "));
  const bootCanonLic = packRead("canon/tidecloak-bootstrap.md") || "";
  c.ok("bootstrap canon carries the rule and the fail-closed block for scripts the agent writes",
    bootCanonLic.includes(TERMS) && /AP-90/.test(bootCanonLic) && /TIDE_TERMS_ACCEPTED/.test(bootCanonLic) && /exit 2/.test(bootCanonLic) && /Only the user can agree/.test(bootCanonLic));
  const seqNoLic = [];
  for (const f of walkFiles(join(PACK_ROOT, "reference-apps"), [".md"])) {
    if (!rel(f).endsWith("bootstrap-sequence.md")) continue;
    const t = readFileSync(f, "utf8");
    const at = t.indexOf(TERMS);
    if (at === -1 || !/AP-90/.test(t) || at > t.indexOf("## Phase 1")) seqNoLic.push(rel(f));
  }
  c.ok("every reference-app bootstrap sequence asks for email + terms before Phase 1", seqNoLic.length === 0, seqNoLic.join("  "));
  c.ok("AP-90 exists and is classified", /^## AP-90:/m.test(packRead("canon/anti-patterns.md") || "") && /^\| AP-90 \|/m.test(packRead("canon/anti-patterns.md") || ""));
  for (const e of ["templates/shared/.env.template", "templates/nextjs-customer-portal/.env.example", "templates/nextjs-e2ee-vault/.env.example"]) {
    const t = packRead(e) || "";
    c.ok(`${e} documents both variables and leaves them EMPTY`, /^TIDE_LICENSE_EMAIL=\s*$/m.test(t) && /^TIDE_TERMS_ACCEPTED=\s*$/m.test(t) && t.includes(TERMS));
  }

  // 4e. Source-audit regressions (2026-10-07). Each of these was in the pack, was wrong against the
  //     projects' own source on every build, and several left an app unprotected while appearing
  //     to work. A line that quotes the wrong form in order to warn against it is allowed.
  const docDirs = ["canon", "playbooks", "skills", "adapters", "prompts", "reference-apps", "templates"];
  const scan = (exts, test, allow) => {
    const hits = [];
    for (const d of docDirs) {
      for (const f of walkFiles(join(PACK_ROOT, d), exts)) {
        readFileSync(f, "utf8").split("\n").forEach((ln, i) => {
          if (test(ln) && !(allow && allow.test(ln))) hits.push(`${rel(f)}:${i + 1}`);
        });
      }
    }
    return hits;
  };
  const WARNS = /protects NOTHING|earlier revision|Earlier revision|not real|NOT valid|NOT bulk|matches nothing|authorizes? (zero|ZERO)|do NOT|Do NOT|❌|silently|ignored/;

  // createTideCloakProxy takes ONE options object. Passed the adapter directly, protectedRoutes is
  // empty and every request passes unverified, with no error.
  let bad = scan([".md", ".ts", ".tsx"], (ln) => /createTideCloak(Proxy|Middleware)\(\s*[A-Za-z_][\w.]*\s*\)/.test(ln), WARNS);
  c.ok("no createTideCloakProxy(<adapter>) call — it protects nothing", bad.length === 0, bad.join("  "));

  // Neither provider has a useDPoP / initOptions PROP. As a sibling prop it is ignored and DPoP stays off.
  bad = scan([".md", ".ts", ".tsx"], (ln) => /<TideCloak\w*Provider[^>]*\s(useDPoP|initOptions)=/.test(ln) || /^\s*(useDPoP|initOptions)=\{/.test(ln), WARNS);
  c.ok("no provider example passes useDPoP / initOptions as a JSX prop", bad.length === 0, bad.join("  "));

  // CREATE / DELETE are not action types; that filter authorizes nothing and returns 200.
  bad = scan([".md", ".sh", ".py"], (ln) => /actionTypeIn"?\s*:\s*\[\s*"CREATE"\s*,\s*"DELETE"\s*\]/.test(ln), WARNS);
  c.ok('no copyable bulk-authorize with actionTypeIn ["CREATE","DELETE"]', bad.length === 0, bad.join("  "));

  // The invite-link query parameters are the OIDC names; camelCase ones are silently ignored.
  bad = scan([".md", ".sh"], (ln) => /get-required-action-link|userId=/.test(ln) && /[?&](redirectUri|clientId)=/.test(ln) && !/get-installations-provider/.test(ln), WARNS);
  c.ok("invite-link examples use redirect_uri / client_id", bad.length === 0, bad.join("  "));

  // tidecloak-dev is a development build wired to the production network, not "the production image".
  bad = scan([".md", ".sh"], (ln) => /\bIS\*{0,2} the production image|\*\*is\*\* the production image/.test(ln), /Earlier revisions/);
  c.ok('nothing calls tidecloak-dev "the production image"', bad.length === 0, bad.join("  "));

  // These statuses do not exist; APPROVED means committed.
  bad = scan([".md"], (ln) => /^\|\s*`(DRAFT|ACTIVE)`\s*\|/.test(ln));
  c.ok("no change-request status table lists DRAFT or ACTIVE", bad.length === 0, bad.join("  "));

  // The DPoP popup error comes from the ORK enclave, not tide-js.
  bad = scan([".md", ".sh"], (ln) => /tide-js\s+reports/.test(ln));
  c.ok('the DPoP popup error is not attributed to tide-js', bad.length === 0, bad.join("  "));

  // Offboarding has no createChangeRequest({type:'FABRIC_OFFBOARDING'}) API.
  bad = scan([".md"], (ln) => /type:\s*'FABRIC_OFFBOARDING'/.test(ln), WARNS);
  c.ok("no invented FABRIC_OFFBOARDING change-request call", bad.length === 0, bad.join("  "));

  // A drain must never approve these as a side effect: a stray second toggle-iga queues DISABLE_IGA.
  const drains = [
    "templates/shared/bootstrap-tidecloak.sh",
    "templates/nextjs-customer-portal/scripts/init-tidecloak.sh",
    "templates/nextjs-e2ee-vault/scripts/init-tidecloak.sh",
    "templates/shared/drain-change-requests.py",
  ];
  for (const d of drains) {
    const t = packRead(d) || "";
    c.ok(`${d} never drains DISABLE_IGA / DELETE_REALM / OFFBOARD_REALM`,
      t.includes("DISABLE_IGA") && t.includes("DELETE_REALM") && t.includes("OFFBOARD_REALM") &&
      !/jq -r 'if type=="array" then \.\[\]\.id else empty end'/.test(t));
  }
  // A 200 from setUpTideRealm is not proof of a licence (NEED_PAYMENT is also a 200), and toggle-iga
  // must not be called on a realm that already has IGA on.
  for (const b of licBootstraps) {
    const t = packRead(b) || "";
    const call = t.slice(t.indexOf("vendorResources/setUpTideRealm\" \\"), t.indexOf("vendorResources/setUpTideRealm\" \\") + 500);
    c.ok(`${b} reads the setUpTideRealm response instead of discarding it`,
      /NEED_PAYMENT/.test(t) && /SETUP_CODE/.test(t) && !/isRagnarokEnabled=true" > \/dev\/null/.test(call), call.slice(0, 120));
    const stateAt = t.indexOf(".attributes.isIGAEnabled");
    const toggleAt = t.indexOf("tide-admin/toggle-iga\" \\");
    c.ok(`${b} reads the IGA state before calling toggle-iga`, stateAt !== -1 && toggleAt !== -1 && stateAt < toggleAt, `state=${stateAt} toggle=${toggleAt}`);
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
    // A scenario built on a custom contract is manifest-only in the public tree (scripts/redact-public.mjs).
    c.ok(`scenario '${app}' has scenario.md`, packExists(`reference-apps/${app}/scenario.md`) || RESTRICTED.scenarios.includes(app));
  }

  // 7. Playbooks recommended by tide_choose_playbook actually exist as files.
  const server = packRead("mcp-server/src/server.ts") || "";
  const recommended = [...server.matchAll(/name:\s*"([a-z0-9-]+)",\s*reason:/g)].map((m) => m[1]);
  for (const p of new Set(recommended)) {
    c.ok(`recommended playbook '${p}' exists`, packExists(`playbooks/${p}.md`) || RESTRICTED.playbooks.includes(p), "referenced by choose_playbook but file missing");
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
  // Accept either the inline literal or the VERSION constant it was refactored into --
  // the constant exists so the instructions block can stamp the version it is serving.
  const serverVer =
    serverTs.match(/name:\s*"@tideorg\/mcp",\s*version:\s*"([\d.]+)"/)?.[1] ??
    serverTs.match(/^const VERSION = "([\d.]+)";/m)?.[1];
  const rootVer = parseJson("package.json")?.version;
  const mcpPkgVer = parseJson("mcp-server/package.json")?.version;
  const pluginVer = plugin?.version;
  const versions = { serverTs: serverVer, rootPkg: rootVer, mcpPkg: mcpPkgVer, pluginJson: pluginVer };
  const allMatch = serverVer && [rootVer, mcpPkgVer, pluginVer].every((v) => v === serverVer);
  c.ok("versions are in sync across server.ts / package.json / plugin.json", allMatch, JSON.stringify(versions));

  // The `groups` mapper (claim name mandated by Tide) must ship in every realm the pack creates, BEFORE
  // IGA, so the enable-IGA adopt-scan attests it with no approval (MEASURED 2026-10-15). Full path on,
  // so same-named subgroups under different parents never collapse into one value. RelationshipAttestation
  // Group subjects compare against exactly this claim (ORK Doken.GroupExists: exact string match).
  const groupsMapperOk = (json) => {
    try {
      const d = JSON.parse(json);
      return (d.clients ?? []).every((c) => (c.protocolMappers ?? []).some((m) =>
        m.protocolMapper === "oidc-group-membership-mapper" && m.config?.["claim.name"] === "groups" &&
        m.config?.["access.token.claim"] === "true" && m.config?.["full.path"] === "true"));
    } catch { return false; }
  };
  for (const t of ["templates/shared/realm.json.template", "templates/nextjs-customer-portal/scripts/realm.json.template", "templates/nextjs-e2ee-vault/scripts/realm.json.template"]) {
    c.ok(`${t} ships the "groups" mapper (access token, full path) on every client`, groupsMapperOk(packRead(t) ?? ""));
  }
  const deployPb = packRead("playbooks/deploy-tidecloak-docker.md") ?? "";
  c.ok("deploy-tidecloak-docker's inline realm template carries the groups mapper",
       /"protocolMapper": "oidc-group-membership-mapper"[\s\S]{0,200}"claim\.name": "groups"[\s\S]{0,40}"full\.path": "true"/.test(deployPb));

  // RelationshipAttestation:1 checks realm roles `_tide_encryptor` / `_tide_decryptor` (names fixed by
  // the ORK contract). Every realm the pack creates declares them, and never in the default composite.
  for (const t of ["templates/shared/realm.json.template", "templates/nextjs-customer-portal/scripts/realm.json.template", "templates/nextjs-e2ee-vault/scripts/realm.json.template"]) {
    let d = null;
    try { d = JSON.parse(packRead(t) ?? ""); } catch { d = null; }
    const realmRoles = (d?.roles?.realm ?? []).map((r) => r.name);
    const defaults = (d?.roles?.realm ?? []).find((r) => /^default-roles-/.test(r.name))?.composites?.realm ?? [];
    c.ok(`${t} declares _tide_encryptor and _tide_decryptor (not in default-roles)`,
      realmRoles.includes("_tide_encryptor") && realmRoles.includes("_tide_decryptor") &&
      !defaults.includes("_tide_encryptor") && !defaults.includes("_tide_decryptor"));
  }

  // T-27: the enclave pop-up-blocked notice and registerPopupErrorCallback. Published only in the
  // 0.14.41-staging packages (2026-10-16); `latest` 0.14.34 still stalls silently.
  const tsDoc = packRead("canon/troubleshooting.md") ?? "";
  const t27 = tsDoc.slice(tsDoc.indexOf("## T-27"));
  c.ok("T-27 documents the pop-up-blocked notice and registerPopupErrorCallback with its release status",
       tsDoc.includes("## T-27") && /registerPopupErrorCallback/.test(t27) && /0\.14\.41-staging/.test(t27) &&
       /`latest` \(`0\.14\.34`\) does not/.test(t27) && /Pop-ups are currently blocked/.test(t27));
  c.ok("T-27 warns against a no-op popup error callback", /no-op/.test(t27));
  c.ok("T-27 has a quick-lookup row", /\| Approve \/ sign \/ an enclave action silently does nothing/.test(tsDoc));
  c.ok("T-27 carries no Asgard-specific guidance", !/asgard/i.test(t27));

  return c.results;
}
