# Prompt: Security Gap Analysis of an Existing System

Copy-paste this to an AI coding agent to audit an existing application for identity, key-management, authorization, and data-exposure gaps — and map each gap to the Tide capability that removes it. Works on systems with no Tide involvement at all.

This is an **advisory, read-only** analysis. It does not modify the target.

---

## The Prompt

> Perform a security gap analysis of this system. You are acting as the **Security Analyst** role from the Tide agent pack. Do not modify any code. Produce a report; do not begin remediation until I approve it.
>
> **First, confirm scope**: state exactly what you will inspect (repo, running instance, config) and that this is my own system or an authorized engagement. Read-only.
>
> **Load the doctrine**: read `canon/security-gap-mapping.md` (the SG-01 … SG-18 gap table) and `skills/tide-security-analyst/SKILL.md`. If you have the Tide MCP server, call `tide_security_analysis` to load them at once.
>
> **Two tiers**: run the **static** sweep (code/config/schema) always. Only run the **runtime confirmation** tier — sending live probes to confirm findings — if I confirm I own or am authorized to test the target, and then strictly per `canon/security-runtime-probes.md` (non-destructive, no exploitation, my own test account only). If I have not authorized live testing, stay static-only and keep findings tagged INFERRED.
>
> **Inventory the trust architecture first** (before pattern-matching), answering from the code/config:
> 1. Identity — how are users authenticated, where do credentials live?
> 2. Authority — how are tokens/sessions signed, who holds the signing key?
> 3. Authorization — where is the access decision made: client, server, or both?
> 4. Data — what sensitive data exists, and who can read it in the clear?
>
> **Run the full gap sweep**: work through SG-01 … SG-12 exhaustively. For each, run the detection commands from `canon/security-gap-mapping.md` against the target and record hits. Do NOT sample APIs (SG-05) — enumerate every route and diff against the routes that actually verify. Also collect anything matching the "Out of scope" table.
>
> **Every finding must have**:
> - A named **trust concentration** — the single party or artifact that, once compromised, defeats the control. "Uses passwords" is not a finding; "password verification collapses to one database + one server process" is.
> - **Evidence** — a file:line, config value, schema column, or HTTP observation — tagged VERIFIED (observed), INFERRED (implied by code), or ASSUMED (my statement, unconfirmed).
> - A **severity** (CRITICAL / HIGH / MEDIUM / INFO) based on blast radius under a single compromise.
> - The **Tide replacement**, cited from `canon/feature-mapping.md` or `canon/invariants.md`, with its sourcing tag.
> - The **remediation playbook sequence** (verify each playbook exists via `tide_list playbooks`).
> - The **limits** — the honesty note: what the Tide replacement does NOT cover.
>
> **Be honest**: include a non-empty "Not Addressed by Tide" section for anything you find that Tide doesn't fix (injection, XSS, CSRF, vulnerable dependencies, rate limiting, infra hardening). Never present Tide as fixing these. An honest analysis is more credible than an inflated one.
>
> **Report in the format** defined in `skills/tide-security-analyst/SKILL.md` (Report Format section): trust-architecture summary, findings most-severe-first, gap interactions, out-of-scope section, then a recommended remediation sequence with the execution role to engage first (per I-18).
>
> **Do not**: modify code, run TideCloak bootstrap, install the SDK, or start fixing anything. Report only. When I approve findings, hand off to the execution roles (Setup → Application → Security → IAM/Policy → Reviewer).

---

## Acceptance Criteria

- [ ] Scope and authorization confirmed before inspection
- [ ] Trust architecture (identity / authority / authorization / data) documented
- [ ] All of SG-01 … SG-18 checked, not sampled (or non-applicability stated per SG)
- [ ] Every finding names a trust concentration and carries evidence with a confidence tag
- [ ] Runtime tier run only if authorized; probed findings carry a Runtime confirmation line; unprobed findings stay INFERRED
- [ ] Every Tide-replacement claim cites `canon/feature-mapping.md` or `canon/invariants.md`
- [ ] Every remediation names a playbook that exists in `playbooks/`
- [ ] Non-empty "Not Addressed by Tide" section (or explicit "none found in scope")
- [ ] No finding claims Tide fixes an out-of-scope gap class
- [ ] Remediation sequence provided with first execution role named
- [ ] No code was modified; the analysis is read-only
