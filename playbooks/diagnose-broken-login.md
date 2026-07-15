# Diagnose Broken Login

Symptom-led troubleshooting for login failures.

---

## Pre-Flight: Is Tide Actually Installed?

Before diagnosing specific symptoms, verify a real Tide integration exists:

```bash
# 1. SDK installed?
grep '@tidecloak/nextjs' package.json
# If missing: npm install @tidecloak/nextjs

# 2. Provider in layout?
grep 'TideCloakProvider\|Providers' app/layout.tsx
# If missing: no Tide provider wrapping the app

# 3. Config file present?
test -f data/tidecloak.json && echo "Found" || echo "Missing"
# If missing: export adapter JSON from TideCloak Admin Console
```

**If check 1 or 2 fails**, stop. The app does not have a Tide integration. Complete [add-auth-nextjs-fresh.md](add-auth-nextjs-fresh.md) (or [add-auth-nextjs-existing.md](add-auth-nextjs-existing.md) for existing apps) first, then return here.

**If only check 3 fails**, export the adapter JSON from TideCloak Admin Console and place it at `data/tidecloak.json`. DPoP is configured per-client in TideCloak Admin, not in the provider props. See [add-auth-nextjs-fresh.md Step 2](add-auth-nextjs-fresh.md#step-2-export-adapter-json-from-tidecloak).

---

## Pre-Flight: Is Adapter Config Present and Correctly Located?

Before symptom-specific debugging, verify the adapter config file:

```bash
# Filename must be tidecloak.json (not adapter.json, not keycloak.json)

# Next.js (server-side):
test -f data/tidecloak.json && echo "Found data/tidecloak.json" || echo "Missing"

# React/Vite or Vanilla JS (client-side):
test -f public/tidecloak.json && echo "Found public/tidecloak.json" || echo "Missing"

# Wrong filename?
ls data/adapter.json data/keycloak.json public/adapter.json public/keycloak.json 2>/dev/null && echo "WRONG FILENAME — rename to tidecloak.json"

# Does code point to the right path?
grep -r 'configUrl\|tidecloak\.json\|adapter\.json' app/providers.tsx src/main.tsx public/auth.js 2>/dev/null
```

**If file is missing**: Export from TideCloak admin console. See [add-auth-nextjs-fresh.md Step 2](add-auth-nextjs-fresh.md#step-2-export-adapter-json-from-tidecloak).

**If wrong filename**: Rename to `tidecloak.json`. The SDK does not look for `adapter.json` or `keycloak.json`.

**If wrong location**: Next.js server-side code reads from `data/tidecloak.json`. React/Vite/Vanilla JS client-side SDK fetches from `public/tidecloak.json` via `configUrl`. See [canon/invariants.md I-05](../canon/invariants.md#i-05-adapter-json-configuration-required).

---

## Symptom: Login Hangs Indefinitely

**What you see**: Click login, redirect to TideCloak, enter credentials, spinner forever.

**Diagnostic steps**:

```bash
# 1. Check browser console
# Look for: "Refused to frame" CSP error

# 2. Check CSP headers
curl -I http://localhost:3000 | grep -i content-security-policy

# 3. Check silent SSO file
curl http://localhost:3000/silent-check-sso.html
# Should return HTML
```

**Fix**: Add Tide domains to CSP. See [add-auth-nextjs-fresh.md Step 6](add-auth-nextjs-fresh.md#step-6-configure-csp-for-swe-iframe).

**Full guide**: [canon/troubleshooting.md T-01](../canon/troubleshooting.md#t-01-login-hangs-indefinitely).

---

## Symptom: Login Succeeds but User Lands on 404

**What you see**: Credentials accepted at TideCloak, but browser shows 404 or blank page after redirect.

**Diagnostic**:
```bash
# Check redirect URI in adapter config
jq '.["auth-server-url"], .resource' data/tidecloak.json 2>/dev/null

# Check redirect handler exists
# App Router:
test -f app/auth/redirect/page.tsx && echo "Found" || echo "Missing"
# Pages Router:
test -f pages/auth/redirect.tsx && echo "Found" || echo "Missing"
```

**Fix**: Create the redirect handler at the configured redirect path. See [canon/redirect-handler.md](../canon/redirect-handler.md) for framework-specific examples and [add-auth-nextjs-fresh.md Step 6](add-auth-nextjs-fresh.md#step-6-create-post-auth-redirect-handler).

---

## Symptom: Redirect URI Mismatch

**What you see**: TideCloak error page: "Invalid redirect_uri".

**Diagnostic**:
```bash
# Check client config
# TideCloak Admin → Clients → {client} → Settings → Valid Redirect URIs
```

**Fix**: Add app URL to valid redirect URIs:
- `http://localhost:3000/*` (dev)
- `https://app.example.com/*` (prod)

---

## Symptom: Cannot Find Module @tidecloak/nextjs

**What you see**: Import error on SDK package.

**Diagnostic**:
```bash
cat package.json | grep tidecloak
# Should show: "@tidecloak/nextjs": "..."
```

**Fix**:
```bash
npm install @tidecloak/nextjs
```

All `@tidecloak` packages are available on public npm registry.

---

## Symptom: Config Not Loading

**What you see**: Provider fails to initialize, or auth-server-url / realm / clientId are undefined.

**Diagnostic**:
```bash
# Check tidecloak.json exists at the correct path
test -f data/tidecloak.json && echo "Found" || echo "MISSING — export from TideCloak admin"

# Check it has required Tide fields
node -e "const c=require('./data/tidecloak.json'); console.log('realm:', c.realm, 'url:', c['auth-server-url'], 'jwk:', !!c.jwk)"

# Check provider imports it
grep "tidecloak.json" app/providers.tsx src/app/providers.tsx 2>/dev/null
```

**Fix**: The app should load config from `data/tidecloak.json`, not from `NEXT_PUBLIC_TIDECLOAK_*` env vars. If `providers.tsx` uses env vars instead of importing the JSON file, replace with:
```typescript
import tcConfig from '../../data/tidecloak.json';
// ...
<TideCloakProvider config={tcConfig}>
```

Do not create `NEXT_PUBLIC_TIDECLOAK_URL`, `NEXT_PUBLIC_TIDECLOAK_REALM`, `NEXT_PUBLIC_TIDECLOAK_CLIENT_ID`, or `NEXT_PUBLIC_TIDECLOAK_REDIRECT_URI` env vars. These values are in `tidecloak.json`.

---

## Symptom: Silent Refresh Fails

**What you see**: User logged out after 10 minutes.

**Diagnostic**:
```bash
# Check silent SSO file
curl http://localhost:3000/silent-check-sso.html
# Should return HTML

# Check browser console for 404
# DevTools → Console → Filter: silent-check-sso
```

**Fix**: Create `public/silent-check-sso.html`. See [add-auth-nextjs-fresh.md Step 5](add-auth-nextjs-fresh.md#step-5-create-silent-sso-file).

**Full guide**: [canon/troubleshooting.md T-04](../canon/troubleshooting.md#t-04-silent-token-refresh-fails).

---

## Symptom: Infinite Redirect Loop

**What you see**: Page redirects to login, login redirects to page, repeat forever.

**Diagnostic**: Check if login page has auth guard.

**Fix**: Remove auth guard from login/public pages:
```typescript
// app/login/page.tsx
export default function LoginPage() {
  // NO AuthGuard here
  return <div>Login</div>;
}
```

---

## Symptom: CORS Errors

**What you see**: Browser console: "CORS policy: No 'Access-Control-Allow-Origin'".

**Diagnostic**: Check TideCloak client Web Origins.

**Fix**:
1. TideCloak Admin → Clients → {client} → Settings
2. Web Origins: Add `http://localhost:3000` and `https://app.example.com`
3. Save

---

## Quick Diagnostic Checklist

Run these in order:

- [ ] TideCloak reachable: `curl ${TIDECLOAK_URL}/.well-known/openid-configuration`
- [ ] Adapter config filename is `tidecloak.json` (not `adapter.json` or `keycloak.json`)
- [ ] Adapter config at correct location: `data/tidecloak.json` (Next.js) or `public/tidecloak.json` (React/Vite/Vanilla)
- [ ] Adapter JSON valid: `jq 'has("jwk") and has("vendorId") and has("homeOrkUrl")' data/tidecloak.json`
- [ ] Env vars set: `cat .env.local | grep NEXT_PUBLIC`
- [ ] CSP configured: `curl -I http://localhost:3000 | grep CSP`
- [ ] Silent SSO file: `curl http://localhost:3000/silent-check-sso.html`
- [ ] Redirect handler exists at configured redirectUri path
- [ ] Browser console clean (no errors)

---

## References

- [canon/troubleshooting.md](../canon/troubleshooting.md) - Complete troubleshooting
- [add-auth-nextjs-fresh.md](add-auth-nextjs-fresh.md) - Setup checklist
