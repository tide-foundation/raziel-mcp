# Role: Security Engineer

---

## Purpose

Add client-side route guards (UI gating) and server-side API authorization (real security) to a Tide-enabled Next.js app. Ensure every protected API verifies JWTs with embedded JWKS and optionally verifies DPoP proofs.

---

## When to Trigger

- User asks to "protect routes", "protect pages", or "add auth guards"
- User asks to "protect API", "secure endpoints", or "add server-side auth"
- User asks to add JWT verification or DPoP verification
- User reports that API routes return data without authentication

### Scenario-disambiguation gate (I-17)

Before proceeding, confirm the task is route/API protection and not a different concern:

| Branch | How to resolve |
|--------|---------------|
| Protection vs setup | Is the app Tide-enabled? If not → `tide-setup` first. |
| Protection vs diagnosis | Is auth broken (401s, hangs), or does protection not exist yet? If broken → `diagnose-broken-login`. |
| Route protection vs encryption | Is the user asking about protecting routes, or about encrypting data? If encryption → `tide-rbac-and-e2ee` or `setup-forseti-e2ee`. |

---

## When NOT to Trigger

- App is not Tide-enabled (no SDK, no provider, no adapter JSON). Route to `tide-setup` skill first.
- User is asking about RBAC role hierarchies or private E2EE encryption (no sharing). Route to `tide-rbac-and-e2ee` skill.
- User is asking about shared/group encryption where multiple users decrypt the same data. Route to playbook `setup-forseti-e2ee` directly.
- User is asking about TideCloak server setup or realm configuration. Use playbook `deploy-tidecloak-docker`.

---

## Required Repo Inspection

```bash
# 1. Confirm Tide setup is complete
grep -E '@tidecloak/(nextjs|react|js)' package.json || echo "FAIL: no Tide SDK"
grep -r 'TideCloakProvider\|TideCloakContextProvider' app/layout.tsx app/providers.tsx pages/_app.tsx 2>/dev/null || echo "FAIL: no provider"
test -f data/tidecloak.json || echo "FAIL: no adapter JSON"

# 2. Check for existing route guards
grep -r 'useTideCloak\|AuthGuard\|authenticated' app/ pages/ components/ --include="*.tsx" --include="*.ts" 2>/dev/null | head -10

# 3. Check for existing API routes
find app/api pages/api -name "*.ts" -o -name "*.tsx" 2>/dev/null

# 4. Check for existing JWT verification
grep -r 'verifyTideJWT\|jwtVerify\|createLocalJWKSet' lib/auth/ --include="*.ts" 2>/dev/null

# 5. Check for auth middleware files
ls lib/auth/tideJWT.ts lib/auth/tidecloakConfig.ts lib/auth/protect.ts lib/auth/dpop.ts 2>/dev/null

# 6. Diagnose unprotected APIs
grep -rL 'verifyTideJWT\|withAuth\|withRole\|extractToken' app/api/ --include="*.ts" 2>/dev/null
# Any file listed here is an unprotected API route
```

If check 1 fails on any item, stop. Run the `tide-setup` skill first.

---

## Preconditions

- Tide setup complete (SDK installed, provider wired, adapter JSON present with `jwk` field)
- Login flow working (user can authenticate and see their name)
- At least one API route exists or will be created
- `jose` package installed (or will be installed in Step 1)

---

## Execution Workflow

This skill follows three playbooks in sequence. Each builds on the previous.

### Phase 1: Route Protection (UI Gating)

**Playbook**: `protect-routes-nextjs`

Adds client-side guards that redirect unauthenticated users. This is UX convenience only — it has zero security value for APIs.

**Key decision**: Choose the guard pattern that fits the app structure:
- Layout-based guards (App Router): protect entire sections via `app/{section}/layout.tsx`
- Page-level guards: protect individual pages
- Reusable `AuthGuard` component: wrap pages that need protection

**Critical rule**: Always check `isInitializing` before checking `authenticated` or calling `login()`. Calling `login()` before SDK init throws `"TideCloak client not initialized"`.

### Phase 2: API Protection (Server-Side JWT Verification)

**Playbook**: `protect-api-nextjs`

Creates `lib/auth/` files for JWT verification against embedded JWKS and reusable middleware. **This is where real authorization happens.** Every API route that handles sensitive data must use these. See the playbook for exact file contents.

### Phase 3: Complete JWT + DPoP Verification

**Playbook**: `verify-jwt-server-side`

**Replaces** the files created in Phase 2 with richer versions that add:
- DPoP proof verification (`lib/auth/dpop.ts`)
- `extractToken()` supporting both Bearer and DPoP schemes
- Client-role checking in `hasRole()`
- `iat` future-validation

**Important**: Phase 3 files replace Phase 2 files. Do not run both and keep duplicates. If the user only needs basic JWT verification without DPoP, Phase 2 alone is functional but degrades Tide's security guarantees.

---

## Diagnosing Existing API Code

If the app already has API routes, audit them:

| Check | Command | Fail means |
|-------|---------|-----------|
| Reads from Authorization header? | `grep -r "authorization" app/api/ --include="*.ts"` | API trusts cookies or has no auth |
| Uses embedded JWKS? | `grep -r "createLocalJWKSet" lib/auth/` | May use remote endpoint (AP-01) |
| Validates issuer + audience? | `grep -r "issuer\|audience" lib/auth/` | JWT claims not verified |
| Enforces roles after verification? | `grep -r "hasRole\|withRole\|realm_access" app/api/` | Returns data without role check |
| Verifies DPoP if present? | `grep -r "verifyDPoP\|dpop" lib/auth/` | Token replay possible |

Any failure means the API route is not properly protected. Apply the playbook sequence above.

---

## Safety Checks

- **Route proxy is not API auth.** Next.js `proxy.ts` (16+) or `middleware.ts` (≤15) runs at the edge and cannot access adapter JSON for JWT signature verification. Use it only for UI redirects. Check the installed Next.js version to determine the correct filename.
- **Use embedded JWKS only.** `createLocalJWKSet(config.jwk)` is the only supported path. `createRemoteJWKSet` is forbidden. If `jwk` is missing, fix the adapter export — do not add remote fallback. (I-04)
- **Do not preserve fake auth helpers.** If existing code has `isAuthenticated: () => true` or hardcoded role arrays, remove them and replace with real JWT verification.
- For the full safety rule set (UI gating, DPoP, forbidden shortcuts), see `adapters/AGENTS.md`.

---

## Verification Checklist

### Route Protection (Phase 1)
- [ ] Unauthenticated user redirected to TideCloak login
- [ ] After login, user returned to original page
- [ ] Protected pages show loading state during init (no flash of content)
- [ ] Public pages remain accessible without login

### API Protection (Phase 2/3)
- [ ] `curl http://localhost:3000/api/protected` returns 401 (no token)
- [ ] `curl -H "Authorization: Bearer INVALID" ...` returns 401 (bad token)
- [ ] `curl -H "Authorization: Bearer VALID_TOKEN" ...` returns 200 (good token)
- [ ] Request with wrong role returns 403
- [ ] DPoP-protected request without proof returns 401 (if Phase 3 applied)

### Cross-Layer
- [ ] Bypassing route guard (direct API call from DevTools) still returns 401/403
- [ ] Disabling JavaScript does not expose protected API data

---

## Repair Path

### JWT verification always fails (401)
1. Check adapter JSON has `jwk` field: `node -e "console.log(!!require('./data/tidecloak.json').jwk)"`
2. Check issuer matches: compare `config['auth-server-url'] + '/realms/' + config.realm` with token's `iss` claim
3. Check audience matches: compare `config.resource` with token's `azp` claim
4. Decode token at jwt.io and inspect claims
5. See playbook `diagnose-broken-login` or `canon/troubleshooting.md` T-02

### Role check always fails (403)
See `tide-rbac-and-e2ee` skill Repair Path. Role debugging is that skill's responsibility.

### DPoP verification fails
1. Confirm client sends DPoP header (check Network tab)
2. Check server clock sync (120s freshness window on `iat`)
3. Confirm `cnf.jkt` in access token matches DPoP proof thumbprint
4. Check `jti` replay cache is not rejecting fresh proofs

---

## Handoff Trace

```
[TRACE]
Scenario: <scenario>
Role: Security Engineer
Reason: <routes unprotected | APIs unprotected | DPoP not verified>
Preconditions: SDK installed, provider wired, tidecloak.json loaded
Next: IAM / Policy Engineer | Reviewer | STOP
[/TRACE]
```

---

## Do Not Do This

- **Do not use Next.js `proxy.ts` (16+) or `middleware.ts` (≤15) as your API auth layer.** It runs at the edge and cannot access adapter JSON for JWT signature verification. Use it only for UI redirects.
- **Do not use `createRemoteJWKSet` at all.** Use `createLocalJWKSet(config.jwk)` only. Remote JWKS is forbidden, not even as a fallback. If `jwk` is missing from `tidecloak.json`, route to adapter re-export (setup/bootstrap), not remote key fetching.
- **Do not skip JWT verification because route guards exist.** Route guards are trivially bypassed.
- **Do not cache DPoP proofs.** Each request needs a fresh proof. Cached proofs fail `jti` replay and `htm`/`htu` checks.
- **Do not trust the `Authorization` header without verifying the JWT signature.** Extracting the token is not the same as verifying it.
- **Do not mix auth check with data fetching in the same component.** Check `authenticated` first, then fetch. Otherwise the API call fires before auth is ready.
