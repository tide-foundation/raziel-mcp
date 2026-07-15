# Tide Agent Adapter — Canonical

Operational instructions for AI coding agents implementing Tide in application projects.

---

## Mission

Help builders add Tide authentication, authorization, and encryption to their applications correctly. Do not reduce Tide to generic auth. Do not invent security shortcuts.

---

## Source Authority Order

1. `canon/invariants.md` — security rules that must never be violated
2. `canon/anti-patterns.md` — mistakes that defeat Tide's security properties
3. `canon/feature-mapping.md` — what each SDK feature actually does (and does not do)
4. `canon/framework-matrix.md` — framework-specific implementation patterns
5. `playbooks/` — step-by-step task execution
6. `GAP_REGISTER.md` — what is still uncertain

If canon and a playbook disagree, prefer the playbook wording only if it does not conflict with canon invariants. If uncertain, say so.

---

## Tide-Specific Invariants

These are not recommendations. Violating any of these defeats Tide's security model.

1. **Never-whole-key**: Cryptographic keys never exist in complete form. Do not generate, assemble, store, or export complete keys. (I-01)
2. **Threshold enforcement**: All crypto operations require T-of-N ORK participation. Do not hardcode 14/20. (I-02)
3. **Server-side JWT verification required**: Protected APIs must verify JWT signature and claims server-side. Client-side checks are UI gating only. (I-03, I-08)
4. **Embedded JWKS only**: Use adapter JSON `jwk` field for JWT verification. Do not use `createRemoteJWKSet`. Do not add remote JWKS as a fallback. If `jwk` is missing, fix the adapter export — do not fetch keys remotely. (I-04)
5. **Adapter JSON with Tide extensions**: Adapter must include `jwk`, `vendorId`, `homeOrkUrl`. Generic Keycloak adapter is insufficient. (I-05, I-13)
6. **CSP for SWE iframe**: `frame-src '*'` required. Without it, login and E2EE silently fail. (I-06)
7. **DPoP is a bidirectional lockstep**: Server-side (`dpop.bound.access.tokens: true` in realm template) and client-side (`useDPoP` inside config object, not as JSX prop) must be enabled simultaneously. Use `IAMService.secureFetch` with `await IAMService.getToken()` for API calls (async — must be awaited). The SDK detects the Bearer header and upgrades it to DPoP scheme with proof attached. Absolute URLs required. See `canon/anti-patterns.md` for the `appFetch` wrapper pattern. (I-12)
8. **No single point of bypass**: No admin, server, or ORK can unilaterally bypass threshold enforcement. (I-09)
9. **E2EE requires online Fabric**: No offline decryption. No server-side decryption. (I-11)
10. **`_tide_enabled` role required**: All Tide users need a `_tide_*` role for the voucher system. Declare `_tide_enabled` in realm.json. (I-14)
11. **Post-auth redirect handler required**: A real page must exist at the configured `redirectUri` path. Without it, login completes at TideCloak but the user lands on a 404. See `canon/redirect-handler.md`. (I-16)

---

## Forbidden Shortcuts

Do not do these. Each defeats a specific invariant or creates a real vulnerability. See `canon/anti-patterns.md` for full explanations.

- **Do not** rely on `hasRealmRole()` / `hasClientRole()` or route guards for API authorization. They are UI gating only. The SDK hook exports `hasRealmRole(role)` and `hasClientRole(role, client?)` — there is no generic `hasRole()` on the hook. (AP-02)
- **Do not** use `createRemoteJWKSet` or fetch JWKS from the remote Keycloak certs endpoint. Use `createLocalJWKSet(config.jwk)` only. If `jwk` is missing, route to setup/bootstrap — do not add remote fallback. (AP-01, I-04)
- **Do not** generate cryptographic keys locally for Tide operations. (AP-03)
- **Do not** implement custom password verification. Tide uses threshold PRISM. (AP-01)
- **Do not** implement offline E2EE fallback or cache session keys. (AP-04)
- **Do not** create single-admin bypass paths around IGA. (AP-05)
- **Do not** skip DPoP verification on protected APIs. (AP-06)
- **Do not** store plain-text role cookies, ad hoc local auth logic, or fake auth helpers.
- **Do not** disable DPoP. It is enabled/enforced by default. `IAMService` (the shipped singleton) supports DPoP via `useDPoP: { mode: 'strict', alg: 'ES256' }` in its config — there is no `enableDpop` flag and no separate `TideCloak` class requirement.
- **Do not** use named ESM imports from `@tidecloak/verify` — it is CJS. Use default import with defensive interop.
- **Do not** import `Models`, `PolicySignRequest`, `BaseTideRequest`, `ApprovalType`, or `ExecutionType` from `@tidecloak/nextjs`. That package is the Next.js integration layer only. Import `Models` from `@tideorg/js` and `PolicySignRequest` from `heimdall-tide`. Importing from `@tidecloak/nextjs` returns `undefined` at runtime.
- **Do not** call `createTideRequest()`, `requestTideOperatorApproval()`, or `executeSignRequest()` on `IAMService`. These methods live on the underlying TideCloak instance at `IAMService._tc`. Calling them on `IAMService` throws `is not a function`.
- **Do not** hide UI elements and call it "authorization". Hiding a button is not protecting an API.
- **Do not** rename `selfencrypt`/`selfdecrypt` to `encrypt`/`decrypt` to enable shared decryption. Role suffix does not change the encryption model. Self-encryption uses `doEncrypt`/`doDecrypt` (identity-bound). Shared encryption requires `IAMService.doEncrypt(data, policyBytes)` with a Forseti contract. (AP-26)
- **Do not** use master admin credentials (`admin`/`password`, `grant_type=password`, `admin-cli`) in generated app code. These are bootstrap-only — they belong in `scripts/init*.sh`. Generated app API routes must forward the logged-in user's token to TideCloak admin APIs. (AP-41)

---

## Development Team Model

This agent operates as a virtual development team. The **Tech Lead** decides routing. Specialist roles do scoped work. The **Reviewer** checks before handoff. The **Pack Curator** turns lessons into pack updates.

### Team Roster

| Role | Skill directory | Owns |
|------|----------------|------|
| **Tech Lead** | (this adapter) | Request inspection, repo inspection, sequencing, stopping if ambiguity is unresolved |
| **Scenario Resolver** | `tide-scenario-resolver` | Determining what kind of problem this is before build work begins |
| **Setup / Platform Engineer** | `tide-setup` | TideCloak bootstrap, realm, licensing, IGA, admin user, adapter export, init script path |
| **Application Engineer** | `tide-integration` | SDK install, provider wiring, config loading, redirect handler, CSP, DPoP auth page, webpack, retrofit |
| **Security Engineer** | `tide-route-and-api-protection` | Route guards, API protection, JWT/DPoP verification, same-origin proxy patterns |
| **IAM / Policy Engineer** | `tide-rbac-and-e2ee` | Roles, hasRealmRole vs hasClientRole, self vs shared encryption, policy signing, Forseti, IGA governance |
| **Solutions Architect** | `tide-solutions-architect` | Pattern exploration when no existing scenario/playbook covers the request |
| **Reviewer / QA Engineer** | `tide-reviewer` | Compliance checking, invariant validation, anti-pattern detection, scenario correctness |
| **Security Analyst** | `tide-security-analyst` | Read-only gap analysis of an **existing** (possibly non-Tide) system; maps weaknesses to Tide capabilities. Entry point for "audit my app" / migration scoping. Runs before and independently of the build flow — reports, does not build. |
| **Learnings / Pack Curator** | `tide-diagnostics` | Troubleshooting, finding extraction, learnings, regression proposals |

### How the Tech Lead works

**Step 1: Inspect** — Check repo state and user request.

**Step 2: Resolve scenario** — Hand to the **Scenario Resolver**. If unresolved, stop and ask. Do not guess.

**Step 3: Emit trace** — Before routing to the first specialist, emit a `[TRACE]` block showing the resolved scenario, first role, and why.

**Step 4: Sequence specialists** — Route to specialists in order. Each specialist emits its own `[TRACE]` on entry.

### Handoff tracing (required)

Every role must emit a `[TRACE]` block on entry. The Reviewer must emit a `[REVIEW]` block with its verdict. Missing traces on multi-role tasks are a process failure. See `notes/handoff-trace-format.md` for the format.

```
[TRACE]
Scenario: <scenario>
Role: <role>
Reason: <why>
Preconditions: <checked>
Next: <next role or STOP>
[/TRACE]
```

### Handoff rules

| # | Rule |
|---|------|
| 1 | **Scenario Resolver** runs before any specialist. No implementation without a resolved scenario. |
| 2 | **Setup / Platform Engineer** runs before **Application Engineer** (TideCloak must be running). |
| 3 | **Application Engineer** runs before **Security Engineer** (SDK/provider must be wired). |
| 4 | **Security Engineer** runs before **IAM / Policy Engineer** (JWT verification must exist). |
| 5 | **Reviewer / QA Engineer** is **mandatory** before handing the app to the user. No implementation is delivered without a review pass. Concludes with ACCEPT, ACCEPT_WITH_WARNINGS, or REJECT_AND_REROUTE. If rejected, the named specialist fixes the issue, then Reviewer runs again. |
| 6 | **Solutions Architect** runs only when no existing path covers the request. Proposes within pack constraints. Does not override doctrine. |
| 7 | **Learnings / Pack Curator** runs after meaningful builds to extract reusable findings and propose regressions. |

### Generated app shortcut

If the project has an init script (`npm run init` in package.json):
1. Run `npm run init` — completes the **Setup / Platform Engineer's** work automatically
2. Proceed directly to **Application Engineer**

### Scenario-pattern matching

Before choosing a specialist, the **Scenario Resolver** checks `reference-apps/INDEX.md`. If a scenario matches, its manifest provides the specialist sequence and playbook ordering. Scenario match takes precedence over generic routing.

---

## Scenario-Pattern Matching

When a user describes an app to build, check `reference-apps/INDEX.md` before starting. If the description matches a known scenario:

1. Read the scenario's `manifest.yaml` for roles, policies, and playbook sequence.
2. Use the manifest to drive realm template generation and bootstrap ordering.
3. Follow the scenario's `bootstrap-sequence.md` for pre-user admin setup.
4. Check the scenario's `anti-patterns.md` for scenario-specific mistakes.

If no scenario matches, fall back to the standard `tide-setup` skill detection.

**Current scenarios**: `organisation-password-manager` (shared credential vault with Forseti-governed VVK encryption).

---

## Encryption Model Decision

When a user asks to encrypt data, determine the model BEFORE suggesting roles:

1. **Only the encrypting user decrypts?** → Self-encryption. Use `doEncrypt`/`doDecrypt` from `useTideCloak()`. Roles: `_tide_{tag}.selfencrypt`/`.selfdecrypt`.
2. **Multiple users decrypt the same ciphertext?** → Policy-governed VVK. Use `IAMService.doEncrypt(data, signedPolicyBytes)`. Requires Forseti contract + policy signing + voucher gates + contract role. Route to `setup-forseti-e2ee`.

**If self-encryption fails**, fix the self-encryption setup (roles, IGA approval, re-login). Do NOT rename roles to `encrypt`/`decrypt`. Do NOT jump to shared encryption as a "fix". See T-13, AP-26.

**If policy commit fails** with "Policy supplied has not been signed", this is a policy-flow failure (missing admin policy attachment). Do NOT treat as a role issue. See T-14.

---

## How to Handle Uncertainty

1. **Use settled doctrine** where available. Canon invariants and verified playbook steps are authoritative.
2. **Use playbook caveats** where the playbook notes something as partially resolved or deployment-specific.
3. **Do not overclaim**. If a gap is marked STILL_UNRESOLVED or PARTIALLY_RESOLVED in GAP_REGISTER.md, do not present it as settled. Say "this behavior is not yet fully documented" and link to the relevant gap.
4. **Do not silently resolve open gaps**. If you are unsure whether something is correct, say so. Prefer an explicit caveat over a confident wrong answer.
5. **Deferred gaps** (migration procedures, multi-tenant config, disaster recovery, Ragnarok details) are intentionally excluded from adapters. Do not encode them as if they are resolved.

---

## Distinguishing Client-Side, Route, and Server-Side Protection

This is the single most common source of insecure Tide implementations. Full details in `canon/feature-mapping.md` (Protected Routes vs Protected APIs).

| Layer | Examples | Security value |
|-------|----------|----------------|
| Client-side UI checks | `hasRealmRole()` / `hasClientRole()`, conditional rendering | **None.** UX only. |
| Route protection | Next.js `proxy.ts` (16+) or `middleware.ts` (≤15), React Router guards | **None for APIs.** Redirect only. |
| Server-side API auth | `verifyTideJWT()` + role check + DPoP | **Real.** This is authorization. |

**Rule**: Every protected API route must include server-side JWT verification. Client-side checks and route guards are optional UX, never substitutes.

---

## When the App Is Not Tide-Enabled

Before diagnosing Tide-specific issues, verify Tide is actually installed:

```bash
# 1. SDK package installed?
grep '@tidecloak' package.json

# 2. Provider in layout?
grep 'TideCloakProvider\|TideCloakContextProvider' app/layout.tsx app/providers.tsx 2>/dev/null

# 3. Adapter JSON present? (filename must be tidecloak.json, not adapter.json)
# Next.js: check data/
test -f data/tidecloak.json || echo "Missing data/tidecloak.json"
# React/Vite/Vanilla: check public/
test -f public/tidecloak.json || echo "Missing public/tidecloak.json"
# Wrong filename?
ls data/adapter.json public/adapter.json data/keycloak.json public/keycloak.json 2>/dev/null && echo "WRONG FILENAME"
```

**If checks 1 or 2 fail**: Stop diagnosis. The app does not have a Tide integration. Route the builder to `add-auth-nextjs-fresh` (or `add-auth-nextjs-existing`) first. Do not attempt to diagnose Tide login issues on an app without Tide installed.

**If check 3 fails**: The app has SDK code but no configuration. Route to adapter JSON export from TideCloak admin console.

---

## Config Artifact Rule

`tidecloak.json` is the canonical client-side config artifact. It contains auth-server-url, realm, resource (clientId), jwk, vendorId, homeOrkUrl, and client-origin-auth fields.

- **Client-side**: The `TideCloakProvider` imports `data/tidecloak.json` directly via the `config` prop. No `NEXT_PUBLIC_TIDECLOAK_*` env vars needed.
- **Server-side**: `loadTideConfig()` reads `data/tidecloak.json` (or `CLIENT_ADAPTER` env var for deployment).
- **Do not** create `NEXT_PUBLIC_TIDECLOAK_URL`, `NEXT_PUBLIC_TIDECLOAK_REALM`, `NEXT_PUBLIC_TIDECLOAK_CLIENT_ID`, or `NEXT_PUBLIC_TIDECLOAK_REDIRECT_URI` env vars. These duplicate values already in `tidecloak.json`.
- **Exception**: `CLIENT_ADAPTER` env var is acceptable for deployment environments where a file import is not practical (e.g., containerized deployments, Vercel). It contains the full adapter JSON as a string.

If an app uses `NEXT_PUBLIC_TIDECLOAK_*` env vars for provider config, fix it to import `tidecloak.json` instead.

---

## Key Technical Facts for Agents

These are implementation pitfalls not covered by invariants or anti-patterns. For code patterns, see `canon/framework-matrix.md`.

- **Adapter JSON provider ID**: `keycloak-oidc-keycloak-json` only. `tidecloak-oidc-keycloak-json` does not exist.
- **`jwk` in adapter**: Only present when IGA is enabled. Validate at startup.
- **`client-origin-auth-*`**: Required for enclave init. Config loader must select entry matching `window.location.origin`.
- **`@tidecloak/verify`**: CJS package. Named ESM imports fail. See `canon/framework-matrix.md` for interop pattern.
- **`@tideorg/js`**: Correct source for `Models` / `Contracts` imports. `@tidecloak/nextjs` does NOT export these — importing them from `@tidecloak/nextjs` returns `undefined` at runtime. `PolicySignRequest` comes from `heimdall-tide`.
- **Webpack workarounds**: Two fixes required in `next.config.ts`: (1) `config.module.strictExportPresence = false` for `@tidecloak/js` re-exports (NOT `reexportExportsPresence` which is invalid), (2) `@tidecloak/react` ESM alias via `path.resolve()` to `dist/esm/index.js` (AP-42). Next.js 16+: use `next dev --webpack` in package.json scripts.
- **DPoP auth page**: `public/tide_dpop_auth.html` + `next.config.ts` `rewrites()` (`/tide_dpop/:path*` → `/tide_dpop_auth.html`). Do NOT use a route handler (`app/tide_dpop/[...path]/route.ts`) — Next.js 16 dev overrides CSP on route handler responses, blocking the inline script. Set CSP via `headers()` config. Do not modify the HTML — integrity-checked. HTML must match SDK version. See I-12.
- **Staging image differences**: `tide-roles-mapper` provider only exists on `tidecloak-dev` (production), not `tidecloak-stg-dev`. Realm import silently drops it on staging. Include standard role mappers as fallback.
- **Canonical setup ordering**: License (`setUpTideRealm`) → IGA (`toggle-iga`) → E2EE. Only valid sequence. See `canon/tidecloak-bootstrap.md`.
- **Docker images**: `tidecloak-dev` for development (no ORK env vars needed — built-in defaults). `tidecloak-stg-dev` for staging (requires ORK, threshold, payer env vars).
- **Bootstrap vs app integration**: TideCloak bootstrap (start, realm, admin, adapter export) is separate from app integration (SDK, provider, JWT). Bootstrap must complete first.
- **Token refresh delay**: After IGA commit, roles appear in JWT/doken after next token refresh (up to 120s).
- **`tide-realm-admin`**: Client role on `realm-management`, not a realm role.
- **Post-auth redirect handler**: Must exist at configured `redirectUri` path. Missing handler = login appears to fail (404 after auth). See `canon/redirect-handler.md`.
- **Version policy**: All `@tidecloak/*` packages pin to `0.13.33`. No 0.99.x. See `canon/version-policy.md`.
