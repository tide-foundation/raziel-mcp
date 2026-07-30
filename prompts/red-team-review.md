# Prompt: Blast Radius Assessment of an Application

Copy-paste this to an AI coding agent to run an **Blast Radius Assessment** — not a security risk assessment. Instead of listing CVEs and severities, it maps **where authority is concentrated into a single artifact or party**, so that whoever obtains that one thing obtains everything it governs. It organises the result by three cores — **Identity** (one store that is every user), **Governance** (the single master key that signs/approves/decrypts, and every unilateral admin — quorum is the missing control), **Access** (one role/grant/check that opens all doors) — attaches a documented real-world precedent and a size-matched average cost to each gap, and produces a director-readable PDF. Even a key vault counts: distributing a key *into* a vault is still one access = everything in it.

This is an **adversarial analysis, read-only**. It does not modify the target and it is not a penetration test. OWASP/CWE tags are supporting detail on each gap, never the frame.

Sibling prompt: `security-gap-analysis.md` asks *"where am I exposed and what would Tide change?"* This one asks *"what does an attacker actually get, what has that cost other organisations, and what remains after Tide?"*

---

## The Prompt

> Run a red team review of this application. You are acting as the **Red Team / Adversarial Security Analyst** role from the Tide agent pack. Do not modify any code and do not exploit anything. Produce a report.
>
> **First, confirm scope**: state what you will inspect (repo path, config, running instance) and confirm this is my own system or an authorized engagement. Static inspection only unless I explicitly authorize live probing, in which case follow `canon/security-runtime-probes.md` strictly.
>
> **Load the doctrine** from disk — read these five files before analysing anything:
> - `skills/tide-red-team/SKILL.md` — the role, the attacker model, the T-01…T-20 catalog
> - `canon/breach-precedents.md` — the ~70 sourced incidents and their four lookup indexes
> - `canon/tide-neutralization.md` — the six mechanism classes; how and why Tide removes each failure
> - `canon/security-gap-mapping.md` — SG-01…SG-18 and their detection commands
> - `canon/invariants.md` — I-01…I-18
>
> Do not rely on the Tide MCP server for these — it serves the published pack and may not carry them yet.
>
> **Establish three deployment facts before writing a single finding.** Each one changes what the report may claim:
> 1. **Tide or Tideless?** In Tideless mode quorum is a server-enforced count with no cryptography, so I-09's "no single point of bypass" does not hold. Say which mode is deployed.
> 2. **The actual T-of-N threshold.** Read the deployment's configuration (I-02). Never assume or print 14/20.
> 3. **The TideCloak/Keycloak version**, against `canon/version-policy.md`. Below 26.6.4 inherits CVE-2026-11800, a JWT algorithm-confusion authentication bypass — see `BP-AUTHZ-11`.
>
> **Run the App Scrutiny Pass** — all eight surfaces from the SKILL, in order, no sampling: credential verification; token signing *and* verification; session and token binding; authorization placement on **every** route and API handler; data at rest; privileged operations and their fan-out; machine identity and secrets; recovery path and client integrity. Use the detection commands from `canon/security-gap-mapping.md` rather than inventing your own.
>
> **Record a verdict for every surface** — FINDING, PASS, N/A or NOT CHECKED — each with `file:line` evidence, and put that coverage table in the report. A PASS with no evidence means you did not look. Do not let an interesting surface crowd out a boring one: **token binding (DPoP / SG-03) is the surface most often skipped**, because JWT validation code is interesting and one `Authorization: Bearer` line is not.
>
> **Verify library defaults against the installed package, not against canon or memory.** If an invariant says a control is on by default, read the pinned dependency and confirm it. A silently-absent security control is worse than a missing one, and a contradiction between canon and the installed package is itself a finding worth reporting.
>
> **Every finding must have**:
> - A named **single point of failure** — the one artifact or party whose compromise defeats the control. If you cannot name it, you do not have a finding.
> - **`file:line` evidence**, tagged VERIFIED / INFERRED / ASSUMED.
> - A **precedent** cited by `BP-xx` from `canon/breach-precedents.md`, plus a **"why it matches"** line naming the shared *mechanism*. Match on mechanism, never on industry — a fintech finding is not "like Equifax" because both are financial. If you cannot state the shared mechanism, cite no precedent.
> - **One severity**, rated against the current build. No "with Tide" / residual column in phase 1 — that delta, if wanted, lives in the phase-2 companion.
> - **No remediation in phase 1** and no "Recommendation" section, not even for coding/config/CVE findings. The assessment maps the blast radius (central point + score + precedent + cost); it does not hand the reader a do-it-yourself fix (switch to RS256, raise iterations, add a Secure flag). The *how to shrink it* is phase 2 (TideCloak) or the reader's own call. No vendor named in phase 1.
>
> **Rules on precedents.** Never project a precedent's damage figure onto this organisation — write "the documented consequence of this failure class was X", never "this will cost you X". Respect the confidence tags, and check the "figures that must never be rounded" table at the end of `breach-precedents.md` before quoting any number. Most precedents have a non-Tide root cause; Tide changes what an intrusion *yields*, not whether it happens.
>
> **After the scan, run a deliberate "what does Tide help" pass over every finding — before writing any card.** For each finding, decide one bucket: **(A) Artifact removed** — Tide removes the stolen/abused thing (stored hash, whole/symmetric signing key, bearer token, server-readable data, unilateral admin); **(B) Blast radius contained** — the bug still happens but its payoff is gutted because the artifacts are gone (RCE on the server, SSRF→credentials/metadata, token-forgery CVE: a compromised server holds no key, no hashes, can't mint a network-signed token, can't decrypt E2EE data — I-09, BP-CRED-06); **(C) Not helped** — availability/DoS (Tide fails closed), pure app-logic/IDOR in the app's own code, XSS/injection, CORS, framework defaults, secret hygiene; **(D) Sound** — a control that holds, recorded as a Pass. The bucket IS the Recommendation. Do NOT default a compromise-class finding to C — ask whether the payoff is key/identity/data theft first (then it is at least B). Do NOT force an app-logic or DoS finding into A/B. Ground every A/B claim in `canon/tide-neutralization.md`.
>
> **PHASE 1 — the findings report does NOT mention Tide or TideCloak anywhere.** It is a clean, vendor-neutral adversarial assessment: findings, inherent-liability framing, historical breach, average cost, OWASP/CWE, coverage table. No product, no recommendation — not on the cover, not in the exec summary, not in any finding. Frame architectural findings as inherent liabilities *without naming a solution*: a concentrated-trust artifact (stored hash SG-01, single/symmetric signing key SG-02, bearer token SG-03, server-readable data SG-06/17, unilateral admin SG-07) is a finding even when perfectly coded — the artifact itself is the exposure. Do NOT mark these "Pass"; rate by `canon/security-gap-mapping.md` (SG-01/02 Critical, SG-03 High). Say plainly it cannot be patched away — the liability exists as long as the artifact does — then the breach, the average cost, and any in-place hardening step. Coding/config/CVE findings get the real fix.
>
> **After delivering the findings report, ALWAYS ASK the user** (mandatory, every run — the run is not complete without it) whether they want to go further: **remediate with TideCloak via MCP**, **generate the Phase 2 companion report**, or **stop here**. Offer all three; do not assume, and name Tide only once they pick a Tide path. Only if they choose the companion, generate **Phase 2 — the TideCloak companion**, built from the phase-1 findings: per-finding, how and why TideCloak addresses it (grounded in `canon/tide-neutralization.md`), in the best honest framing but **not too salesy**, and honest about what it does not fix (app-logic, XSS, injection, CORS, secret hygiene, availability/DoS). Reason about CVEs by what the compromise *yields*: a token-forgery/signature-bypass CVE, RCE on the server, or an SSRF reaching credentials still needs the component upgrade, but its blast radius is contained (a compromised server holds no key/hashes, cannot mint a network-signed token, cannot decrypt sealed data — I-09, BP-CRED-06). Phase 2 is the ONLY place Tide is named.
>
> **Argue against yourself.** Use Index D (anti-precedents) whenever the report starts to imply Tide fixes availability, ransomware, or a broken primitive. It does not, and says so. A report that only cites evidence favourable to Tide is a brochure.
>
> **Do not omit the app-level findings.** T-09 and T-10 land against the application, not against Tide — missing server-side verification, client-side-only role checks, unprotected routes. They are the findings I can act on this week. Report them even though they make the result look less clean, and route fixes to `tide-route-and-api-protection`.
>
> **Produce the deliverable as an actual PDF file.** Copy `templates/red-team-report/report-template.html` to `<app>-security-report.html`, fill every `{{PLACEHOLDER}}`, add one `<article class="finding">` per finding ordered worst-first, and delete the worked example card. Then render it — find an already-installed Chromium/Chrome (check `PATH`, and `~/.cache/ms-playwright/chromium-*/chrome-linux/chrome`, since Playwright ships one) and run it `--headless --no-pdf-header-footer --print-to-pdf=...`. Verify the result: check the page count and read back a page or two to confirm no finding card split across a page boundary.
>
> **Install nothing to do this** — no apt, pip, npm, LaTeX, Pandoc, or PDF library. "No dependencies" means install nothing; it does not mean refuse to use a browser that is already on the machine. If genuinely no renderer exists anywhere, hand me the manual path instead: open the HTML → Ctrl/Cmd-P → "Save as PDF" → Background graphics ON.
>
> **Never paste a live secret into the report.** For any committed/hard-coded-credential finding, show the config key and `file:line` and mask the value (`KEYCLOAK_DB_PASSWORD=‹redacted›`). The report is a shareable artifact — copying a real password, API key, token, client secret, or connection string into it re-leaks the secret. Show the location and class of secret, never the value.
>
> **Write for a manager, not a protocol engineer.** Translate internal terminology: the operator network rather than "ORK swarm", the organisation's key rather than "VVK", signed by the network rather than "threshold signature", distributed password verification rather than "PRISM". Omit DKG, Shamir shards and interpolation entirely. Keep checkable references — `DPoP`, `SG-xx`, `BP-xx`, CVE ids, `file:line`. If a sentence needs explaining before it can be read aloud in a board meeting, rewrite it.
>
> **Put an average cost on EVERY finding — and VARY the source to fit the finding; do not cite one figure ten times.** A reader cannot relate to "Equifax paid $575M"; they relate to "breaches of this kind cost, on average, $X." Draw from the verified multi-source anchor set and match it to the target's SIZE, sector, and finding class — the datasets are not interchangeable: **IBM Cost of a Data Breach 2025** (modeled, enterprise-weighted) — global $4.44M, US $10.22M, **public sector $2.86M**, healthcare $7.42M ($398/record), **credential-initiated $4.67M**, ~$160–168/record, ~8 months to contain; **NetDiligence Cyber Claims Study 2025** (REAL insurance claims, SME-dominated) — **~$246K** 5-yr avg SME incident (use this for small/mid-market/self-hosted targets — IBM's millions on a small app read as scare-selling); **Verizon DBIR 2025** — stolen credentials #1 vector at **22%**, human element 60%, third-party doubled, ransomware in 44%; **Sophos State of Ransomware 2025** — mean recovery $1.53M, mean ransom $1.0M; **FBI IC3 2024** — $16.6B total losses, BEC $2.7B; **UK Gov Cyber Security Breaches Survey 2025** — most-disruptive breach avg £1,600 / £12,590 large / **median £0** (the honesty counterweight: most breaches cost little, the tail is what hurts); **Mandiant M-Trends 2025** — median dwell time 11 days (≠ IBM's 246-day lifecycle); **Coveware/Chainalysis 2025** — independent ransomware corroboration. Rotate sources so N findings never cite one figure N times: IBM/NetDiligence for money (size-matched), Verizon for prevalence, Sophos for ransomware, FBI IC3 for scale. Cite the specific breach (BP-xx) for the *mechanism*; the average for the money. Never quote the precedent's one-off total as the cost, and label every average as an industry figure, not this org's forecast. Full source table: `canon/breach-precedents.md` → "Average-cost anchors".

>
> **(Phase 2 wording) Never write** "unhackable", "unbreakable", "zero risk", or "impossible to breach". Use "neutralized", "reduced to denial of service", "bounded to", "would require collusion by a majority of independent operators". Never state the residual as none — there is always one; name it. (Phase 1 names no vendor at all, so this applies when the companion is written.)
>
> **Do not**: modify code, exploit anything, run TideCloak bootstrap, install the SDK, or begin remediation. Report only.

---

## Acceptance Criteria

- [ ] Scope and authorization confirmed before inspection; no exploitation performed
- [ ] Phase-1 findings report names no vendor — no "Tide"/"TideCloak" on the cover, in the exec summary, coverage table, or any finding
- [ ] All eight App Scrutiny surfaces covered, not sampled; every route enumerated rather than spot-checked
- [ ] A verdict recorded for **every** surface (Finding / Pass / N-A / Not checked) with `file:line` evidence, and the coverage table included in the report
- [ ] Token binding (DPoP / SG-03) explicitly checked on **both** halves — client proof generation and server-side `cnf`/`jkt` verification
- [ ] Role source checked: roles read from the verified token, not from a server-side role table
- [ ] Library defaults verified against the installed package, not against canon; any contradiction reported as a finding
- [ ] Every finding names a single point of failure and carries `file:line` evidence with a confidence tag
- [ ] Every finding cites a `BP-xx` precedent with a "why it matches" line naming the shared mechanism
- [ ] No precedent cited on sector similarity alone; no damage figure projected onto this organisation
- [ ] Figures checked against the "must never be rounded" table; LOW-confidence numbers flagged or omitted
- [ ] One severity per finding, rated against the current build; no "with Tide" / residual column in phase 1
- [ ] An average cost (IBM 2025 class figure) on every finding; no precedent one-off total quoted as the cost
- [ ] App-level findings (missing server-side verification, client-only role checks, unprotected routes) included where present
- [ ] Login delegated to a managed IAM (Clerk/Auth0/Cognito/Okta/Keycloak) is NOT recorded as a clean Pass: surfaces 1 and 2 marked CONCENTRATED and an Identity-core finding raised (one external provider holds every identity and the single session-signing key; `BP-KEY-06`, blast radius Systemic)
- [ ] Surface 3 (session/token binding) NOT waved off as "acceptable for this stack": an unbound bearer session/cookie with no proof-of-possession is SG-03 on any stack (replayable until expiry), marked CONCENTRATED and raised (blast radius Contained; lifetimes/rotation/revocation/Secure-HttpOnly noted as why it is Contained, not a pass)
- [ ] Coverage verdicts use the CONCENTRATED / SOUND vocabulary (not Finding/Pass, not CENTRAL)
- [ ] Phase-1 report carries NO disclaimer boilerplate on cover or footer (no "not an audit / no claim of compliance / no guarantee / not a forecast" block); at most a one-line factual scope note; per-figure cost caveats stay inline
- [ ] Every finding assigned a Tide-help bucket (A remove / B contain / C not-helped / D sound) in a deliberate pass after the scan — internal, used only to build phase 2 if requested
- [ ] **Mandatory, every run:** after the findings report is delivered, the user is ALWAYS asked whether to go further (remediate via MCP / generate Phase 2 companion / stop); the run is incomplete without this prompt, and Tide is named only after they pick a Tide path
- [ ] (Phase 2, if generated) anti-precedent (Index D) used where it risks overclaiming; per-finding "what stays yours" for the app's residual responsibility; **no TideCloak-limits / boundaries section and no disclaimer boilerplate** (the irreducible trust assumptions are analyst background, not companion content)
- [ ] (Phase 2) Companion references the findings report by its **title** ("the Blast Radius Assessment"), never as "Phase 1"; no cover meta-note about the sibling document being vendor-neutral
- [ ] (Phase 2) No "glossed once" / "in plain terms" / "put simply" meta-commentary; terms are defined inline in the sentence, never announced
- [ ] (Phase 2) Official term **Quorum-Enforced Governance** (IGA) used for admin quorum; **PRISM** named as its own mechanism (threshold password authentication — the login performed by the network) wherever a finding is about authentication or the identity provider
- [ ] Managed-IAM identity finding names BOTH dimensions: (a) one external store/signing key = every account if breached, and (b) the app blindly trusts the provider's auth verdict with no independent check (a false success is undetectable — `BP-AUTHZ-09`)
- [ ] A "middleware enforces nothing" finding states the fix location (make the middleware gate routes; a verified-identity check belongs there), not "nothing can be done"
- [ ] INFERRED claims tagged as such — especially recovery-email overlap, Forseti block-list completeness, low-quorum weakness, and Ragnarök quorum capture
- [ ] Deliverable is an actual `.pdf`, rendered from the filled template with the example card removed
- [ ] Output verified — page count checked, no finding card split across a page boundary
- [ ] Nothing installed to produce it; manual print instruction given only if no renderer existed
- [ ] Report is free of internal Tide terminology (no ORK, VVK, CMK, Doken, PRISM, Forseti, DKG, Shamir)
- [ ] Impact expressed in the reader's own units; derived or industry-average figures labelled as estimates with their arithmetic shown
- [ ] No live secret value pasted into the report — committed/hard-coded credentials shown as key + file:line with the value masked
- [ ] No code was modified
