# Tide Agent Adapter — Replit / Beginner

Instructions for AI coding agents helping beginner builders add Tide to their apps. Prioritize safety, clarity, and small correct steps.

---

## Before You Touch Any Code

**Disambiguate first.** If the request could mean multiple things (self-encryption vs shared, fresh app vs existing, setup vs diagnosis), resolve the ambiguity before writing code. Ask the user if needed. Do not silently pick one path.

**Inspect first.** Do not edit until you understand the current state.

### Check 1: Is Tide installed?

```bash
grep '@tidecloak' package.json
```

If no result: the app does not use Tide yet. Go to **"App Is Not Tide-Enabled"** below.

### Check 2: Is the provider set up?

```bash
grep 'TideCloakProvider\|TideCloakContextProvider' app/layout.tsx app/providers.tsx 2>/dev/null
```

If no result: Tide SDK is installed but not wired in. Use playbook `add-auth-nextjs-fresh`.

### Check 3: Does adapter JSON exist?

The file must be named `tidecloak.json`. Not `adapter.json`. Not `keycloak.json`.

```bash
# Next.js: check data/
test -f data/tidecloak.json && echo "Found" || echo "Missing in data/"
# React/Vite or Vanilla JS: check public/
test -f public/tidecloak.json && echo "Found" || echo "Missing in public/"
# Wrong filename?
ls data/adapter.json public/adapter.json 2>/dev/null && echo "WRONG NAME — rename to tidecloak.json"
```

If missing: the builder has not exported their configuration from TideCloak. They need to do that before any Tide code will work.

---

## If the App Is Not Tide-Enabled

**Stop.** Do not try to diagnose login issues, fix auth errors, or add features.

The app needs setup first. Two paths:

**Generated app (default)**: If the project has an init script (`npm run init` in package.json):
```
npm install
npm run init    # starts TideCloak, creates realm, exports tidecloak.json
npm run dev
```

**Manual bootstrap (no init script)**: Direct the builder to:
1. Get TideCloak running:
   - `start-tidecloak-dev` — start the Docker container
   - `bootstrap-realm-from-template` — create realm and enable IGA
   - `initialize-admin-and-link-account` — create admin, link account, export adapter JSON
2. Add Tide auth to their app (playbook: `add-auth-nextjs-fresh`)

Everything else depends on bootstrap completing first. TideCloak must be running with a configured realm before app integration.

---

## Core Safety Rules

These are firm. Do not bend them for convenience.

### 1. Hiding UI is not authorization

Showing or hiding a button based on a role check (`hasRealmRole('admin')`) does **not** protect anything. Anyone can call the API directly and bypass the UI. The SDK exports `hasRealmRole(role)` for realm roles and `hasClientRole(role, client?)` for client roles — there is no generic `hasRole()` on the hook.

**Real authorization** means verifying the JWT token on the server, in every API route that returns or modifies sensitive data.

### 2. Protected APIs need server-side verification

Every API route that handles sensitive data must:
- Extract the JWT from the `Authorization` header
- Verify the signature using embedded JWKS from adapter JSON
- Check the role claims on the verified token
- Return 401 or 403 if verification fails

Use playbook `protect-api-nextjs` for the full procedure.

### 3. Do not invent auth

Do not create:
- Your own login system alongside Tide
- Plain-text role cookies
- Local role-checking middleware that skips JWT verification
- Fake auth helpers that always return true

Tide handles authentication and provides threshold-signed JWTs. Your job is to verify those JWTs server-side.

### 4. Do not skip DPoP

DPoP binds the access token to the browser session. Without it, stolen tokens can be replayed. Playbook `add-auth-nextjs-fresh` covers DPoP provider configuration.

---

## Choosing What to Do

Pick the smallest correct playbook for the builder's current need.

| Builder says... | Use this playbook |
|----------------|-------------------|
| "I want to add login to my app" | `add-auth-nextjs-fresh` |
| "My app already has auth, I want Tide" | `add-auth-nextjs-existing` |
| "I want to protect certain pages" | `protect-routes-nextjs` |
| "I want to protect my API" | `protect-api-nextjs` |
| "I need admin vs user roles" | `add-rbac-nextjs` |
| "Login is broken" | `diagnose-broken-login` |
| "Roles aren't showing up" | `diagnose-missing-roles-or-claims` |

### Bootstrap sequence (if TideCloak not running)

**If init script exists**: `npm run init` handles everything.

**If no init script** (manual):
1. `start-tidecloak-dev` — start TideCloak
2. `bootstrap-realm-from-template` — create realm
3. `initialize-admin-and-link-account` — set up admin, export adapter JSON

### Standard build sequence for a new app

1. `add-auth-nextjs-fresh` — get login working
2. `protect-routes-nextjs` — redirect unauthorized users (UI only)
3. `protect-api-nextjs` — real server-side protection
4. `verify-jwt-server-side` — complete JWT + DPoP code
5. `add-rbac-nextjs` — role-based access control

Bootstrap must complete before the build sequence. Do not skip step 3. Steps 1 and 2 alone provide zero API security.

---

## Preserve Existing App Behavior

When adding Tide to an existing app:

- Do not remove existing routes or pages
- Do not restructure the project layout unless required
- Add Tide as a layer — provider wrapping the app, verification in API routes
- Keep changes minimal and reversible
- Test that existing non-auth functionality still works after each step

---

## What These Terms Mean

| Term | Plain meaning |
|------|--------------|
| **UI gating** | Showing/hiding buttons based on login state. Not real security. |
| **Route guard** | Redirecting to login page if not logged in. Not real API security. |
| **Server-side JWT verification** | Checking the cryptographic signature of the token on the server. This is real security. |
| **Adapter JSON** | A config file exported from TideCloak containing keys and endpoints your app needs. |
| **DPoP** | A security feature that ties your access token to your browser session so it can't be stolen and reused. |
| **IGA** | Multi-admin approval system. Admin changes need multiple approvals before they take effect. |
| **SWE iframe** | An invisible browser frame that handles cryptographic operations. If CSP blocks it, login hangs. |
| **Redirect handler** | A page at your app's redirect URI that receives the auth code after login. Without it, login looks broken. |

---

## Common Mistakes (and Fixes)

### "Login hangs forever"

Usually a CSP issue. The SWE iframe is being blocked.

Fix: set CSP `frame-src '*'` in your app configuration. See playbook `diagnose-broken-login`.

### "I added role checks but anyone can still access the API"

You added UI gating, not real authorization. The `hasRealmRole()` / `hasClientRole()` check only hides buttons — it does not protect the API endpoint.

Fix: add server-side JWT verification to the API route. See playbook `protect-api-nextjs`.

### "Import error with @tidecloak/verify"

The package is CJS, not ESM. Named imports like `import { verifyTideCloakToken }` will fail. See `canon/framework-matrix.md` for the correct default-import interop pattern.

### "Missing jwk field in adapter JSON"

IGA is not enabled on the realm. The `jwk` field only appears when IGA is active. Enable IGA via TideCloak admin console, then re-export adapter JSON.

### "Build error with @tidecloak/js in Next.js"

Webpack needs a config workaround for incomplete re-exports. See `canon/framework-matrix.md` (Webpack Workaround section).

---

## Quick Reference

- **CSP**: `frame-src '*'` required. Without it, login hangs.
- **`silent-check-sso.html`**: Must be in `public/` folder.
- **Redirect handler**: A page must exist at your app's redirect URI path (default `/auth/redirect`). Without it, login ends on a 404. See `canon/redirect-handler.md`.
- **Setup order**: License first, then IGA, then E2EE. No shortcuts.
- **`_tide_enabled` role**: Must exist in realm.json. Not auto-created.
- **DPoP**: ES256 is the default. Always enable it.
- **Adapter JSON**: Export from TideCloak using provider ID `keycloak-oidc-keycloak-json`.

---

## Review Before Handoff

Before handing completed work to the user, check:
- [ ] Protected APIs verify JWT server-side (not just UI gating)
- [ ] `createLocalJWKSet` used, not `createRemoteJWKSet`
- [ ] DPoP configured on both server (realm template) and client (provider config)
- [ ] No hardcoded admin credentials in generated app code
- [ ] Bootstrap is fully complete (user with `tideUserKey` exists, adapter exported)

---

## When You Are Not Sure

- If the playbook covers it, follow the playbook.
- If the playbook adds a caveat, preserve the caveat in your output.
- If you cannot find the answer in canon or playbooks, say "I'm not sure about this — it may not be documented yet" rather than guessing.
- Do not present unresolved items as settled facts.
