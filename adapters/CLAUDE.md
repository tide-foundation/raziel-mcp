# Tide Agent Adapter — Claude Code

Compact instructions for Claude Code when working on Tide-enabled applications.

---

## Disambiguate First (I-17)

Before writing code, check whether the request maps to more than one valid path. If multiple scenarios are plausible, resolve the branch before proceeding. Do not silently default to one path.

Key branches: fresh vs existing app, self-encryption vs shared encryption, bootstrap vs app integration, diagnosis vs setup, simple RBAC vs policy governance. If unclear, ask. See `canon/invariants.md` I-17.

---

## Inspect First

Before writing or modifying code, check:

1. `package.json` — is `@tidecloak/nextjs` (or `@tidecloak/react`, `@tidecloak/js`) installed?
2. `app/layout.tsx` (or equivalent) — is `TideCloakProvider` (Next.js) or `TideCloakContextProvider` (React/Vite) present?
3. `tidecloak.json` — does it exist with `jwk`, `vendorId`, `homeOrkUrl` fields?
   - Next.js: `data/tidecloak.json` (or `CLIENT_ADAPTER` / `TIDECLOAK_CONFIG_B64` env var)
   - React/Vite / Vanilla JS: `public/tidecloak.json`
   - Wrong filename (`adapter.json`, `keycloak.json`)? Rename to `tidecloak.json`.

If 1 or 2 is missing: the app is not Tide-enabled. Stop diagnosis. Use playbook `add-auth-nextjs-fresh` or `add-auth-nextjs-existing`.

If 3 is missing: adapter JSON not exported. Direct user to TideCloak admin console. If present but wrong filename, rename to `tidecloak.json`.

---

## Source Authority

1. `canon/invariants.md` — absolute rules
2. `canon/anti-patterns.md` — what not to do
3. `playbooks/` — step-by-step procedures
4. `GAP_REGISTER.md` — remaining uncertainty

Do not guess when uncertain. Say so and cite the gap.

---

## Do Not

- Treat `hasRealmRole()` / `hasClientRole()` or route guards as authorization. They are UI gating only. The SDK hook does not export a generic `hasRole()` — use `hasRealmRole(role)` for realm roles and `hasClientRole(role, client?)` for client roles.
- Use `createRemoteJWKSet` or fetch JWKS remotely. Use embedded `config.jwk` only. If `jwk` is missing, fix the adapter export — do not fall back to remote.
- Generate local cryptographic keys for Tide operations.
- Import `Models`, `PolicySignRequest`, or other policy/model helpers from `@tidecloak/nextjs`. That package is Next.js hooks/provider only. Use `@tideorg/js` for `Models` and `heimdall-tide` for `PolicySignRequest`. Importing from `@tidecloak/nextjs` returns `undefined` at runtime.
- Call `createTideRequest()`, `requestTideOperatorApproval()`, or `executeSignRequest()` on `IAMService`. These live on `IAMService._tc` (TideCloak instance). Direct calls on `IAMService` throw `is not a function`.
- Use named ESM imports from `@tidecloak/verify` — it is CJS. Use default import with defensive interop.
- Pass `useDPoP` as a JSX prop on `TideCloakProvider` — it goes inside the config object: `config={{ ...tcConfig, useDPoP: { mode: 'strict', alg: 'ES256' } }}`. (session-002)
- Call `IAMService.secureFetch` with a relative URL — it throws. Use absolute URLs with `window.location.origin`. (session-002)
- Call `IAMService.secureFetch` without pre-setting `Authorization: Bearer <token>` — SDK only attaches DPoP proof when it detects an existing Bearer header to upgrade. Use `await IAMService.getToken()` for the managed token (async — must be awaited). (session-002, LEARNINGS-batch-005 L-07)
- Use regular `fetch` with `Bearer` header when `useDPoP` is enabled — DPoP-bound tokens require `IAMService.secureFetch` which upgrades Bearer to DPoP scheme and attaches the proof.
- Implement custom password logic. Tide uses threshold PRISM.
- Write plain-text role cookies, ad hoc auth helpers, or fake local auth.
- Skip DPoP verification on protected APIs.
- Present hidden UI as real authorization.
- Rename `selfencrypt`/`selfdecrypt` to `encrypt`/`decrypt` to enable shared decryption. Role suffix does not change the encryption model. Self-encryption is identity-bound. Shared encryption requires `IAMService.doEncrypt(data, policyBytes)` with a Forseti contract. (AP-26)
- Use master admin credentials (`admin`/`password`, `grant_type=password`, `admin-cli`) in generated app code. These are bootstrap-only — they belong in `scripts/init*.sh`, never in API routes or app code. Forward the logged-in user's token instead. (AP-41)

---

## Development Team Model

Route first, then act. Do NOT bundle all work into one pass.

**Step 1**: Inspect repo and request.
**Step 2**: **Scenario Resolver** (`tide-scenario-resolver`) determines what kind of problem this is. If ambiguous, stop and ask.
**Step 3**: Route to specialists in order:

| Role | Skill | When |
|------|-------|------|
| **Setup / Platform Engineer** | `tide-setup` | TideCloak not running or not configured |
| **Application Engineer** | `tide-integration` | SDK/provider not wired |
| **Security Engineer** | `tide-route-and-api-protection` | Routes/APIs need protection |
| **IAM / Policy Engineer** | `tide-rbac-and-e2ee` | Roles, encryption, or policy governance needed |
| **Learnings / Pack Curator** | `tide-diagnostics` | Something is broken, or learnings need extraction |
| **Reviewer / QA Engineer** | `tide-reviewer` | **Mandatory** before handing app to user |
| **Solutions Architect** | `tide-solutions-architect` | No existing path covers the request |

**Ordering**: Scenario Resolver → Setup → Application → Security → IAM/Policy → Reviewer. Pack Curator at any time. Solutions Architect when no existing path fits.

**Tracing**: Every role emits a `[TRACE]` block on entry. Reviewer emits a `[REVIEW]` block with verdict. Missing traces on multi-role tasks are a process failure. Format: `notes/handoff-trace-format.md`.

**Scenario match**: Check `reference-apps/INDEX.md` first. Scenario Resolver does this before any specialist runs.

---

## Three Layers of Protection

| Layer | Mechanism | Security value |
|-------|-----------|----------------|
| UI gating | `hasRealmRole()` / `hasClientRole()`, conditional render | None — bypass trivial |
| Route guard | `proxy.ts` (Next.js 16+) or `middleware.ts` (≤15), React Router | None for APIs — redirect only |
| API auth | `verifyTideJWT()` + role check + DPoP | Real — threshold-signed JWT |

Every protected API must have layer 3. Layers 1 and 2 are optional UX.

---

## Encryption Model Decision — CHECK THIS FIRST

**Mandatory sharing gate**: If the user's request mentions sharing, recipients, other users decrypting, cross-user access, or any indication that someone other than the encrypting user should decrypt — use policy-governed VVK encryption (`setup-forseti-e2ee`). Do NOT start with self-encryption. Self-encryption is permanently user-bound and CANNOT be upgraded to shared encryption later. The SDK call path is fundamentally different.

- **Only encrypting user decrypts?** Self-encryption. `doEncrypt`/`doDecrypt`. Roles: `_tide_{tag}.selfencrypt`/`.selfdecrypt`.
- **Multiple users decrypt same ciphertext?** Policy-governed VVK. `IAMService.doEncrypt(data, policyBytes)`. Requires Forseti + policy signing. Route to `setup-forseti-e2ee`.
- **Self-encryption fails?** Fix roles/IGA/re-login. Do NOT rename roles. See T-13, AP-26.
- **Policy commit fails?** Fix admin policy attachment. See T-14. Not a role issue.

---

## Config Artifact Rule

`tidecloak.json` is the canonical config. Provider imports it directly. Do not create `NEXT_PUBLIC_TIDECLOAK_URL` / `REALM` / `CLIENT_ID` / `REDIRECT_URI` env vars — these values are in `tidecloak.json`. Exception: `CLIENT_ADAPTER` env var for deployment.

---

## Quick Technical Reference

For code patterns and full details, see `canon/framework-matrix.md`.

- **Adapter provider ID**: `keycloak-oidc-keycloak-json` only. `tidecloak-oidc-keycloak-json` does not exist.
- **JWT verification**: `createLocalJWKSet(config.jwk)` only. `createRemoteJWKSet` is forbidden. If `jwk` is missing, re-export adapter with IGA enabled.
- **DPoP**: ES256 default, EdDSA supported. Per-request `jti` replay cache with 2-min TTL.
- **`jwk` in adapter**: Only present when IGA is enabled. Validate at startup.
- **Webpack**: Two fixes required: (1) `config.module.strictExportPresence = false` for `@tidecloak/js` re-exports (NOT `reexportExportsPresence` which is invalid), (2) `@tidecloak/react` ESM alias (`path.resolve()` to `dist/esm/index.js`). Next.js 16+: use `next dev --webpack`. (AP-42)
- **CSP**: `frame-src '*'` required globally. For DPoP, set `script-src 'unsafe-inline'` on `/tide_dpop/:path*` via `next.config.ts` `headers()` — NOT in a route handler (Next.js 16 overrides CSP on route handler responses).
- **DPoP auth page**: `public/tide_dpop_auth.html` + `next.config.ts` `rewrites()` (`/tide_dpop/:path*` → `/tide_dpop_auth.html`). Do NOT use `app/tide_dpop/[...path]/route.ts`. Do not modify the HTML — integrity-checked. HTML must match SDK version. (I-12)
- **`silent-check-sso.html`**: Must exist in `public/`. See playbook `add-auth-nextjs-fresh`.
- **Redirect handler**: Must exist at configured `redirectUri` path. Without it, login ends on 404. See `canon/redirect-handler.md`.
- **Setup order**: License → IGA → E2EE. No other sequence works. See `canon/tidecloak-bootstrap.md`.
- **Version policy**: Tide packages at `0.13.33`. No 0.99.x. See `canon/version-policy.md`.
- **Docker images**: `tidecloak-dev` is production (full protocol). `tidecloak-stg-dev` is staging. Images are under `tideorg/` org (e.g. `tideorg/tidecloak-dev:latest`), NOT `tidecloak/`. Do NOT append `start-dev` to docker run — TideCloak images have a pre-configured entrypoint.
- **`_tide_enabled`**: Declare in realm.json. Not auto-created.
- **`tide-realm-admin`**: Client role on `realm-management`, not a realm role.
- **Token refresh delay**: After IGA commit, up to 120s before roles appear in JWT.

---

## Handling Uncertainty

- Settled in canon/playbooks → use it.
- Playbook notes a caveat → preserve the caveat.
- GAP_REGISTER marks it STILL_UNRESOLVED → do not encode as resolved. Say "not yet documented".
- Deferred items (migration, multi-tenant, DR, Ragnarok) → do not include in app-building flows.
