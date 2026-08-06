# Add Tide Auth to Fresh Next.js Project

Manual setup for integrating Tide authentication into a new Next.js application.

---

## When to Use

- Starting a new Next.js project (App Router or Pages Router)
- Need threshold password authentication (BYOiD)
- Need threshold JWT signing (VVK)
- Need optional E2EE or IGA features later
- Have a running TideCloak instance

**Do not use** if you already have an existing Next.js app with auth. See [add-auth-nextjs-existing.md](add-auth-nextjs-existing.md) instead.

---

## Prerequisites

### Running Services

- TideCloak instance accessible (local or remote)
- TideCloak realm created and configured
- TideCloak client created in realm
- IGA enabled on realm (see [canon/concepts.md](../canon/concepts.md#iga-identity-governance--administration))

### Local Environment

- Node.js 18+
- Next.js 13+ installed. For automated/agent builds, prefer `npm init -y && npm install next react react-dom typescript @types/react @types/node` over `npx create-next-app@latest` — the latter has interactive prompts (React Compiler, etc.) that may block automation. VERIFIED (LEARNINGS-batch-009 L-04).
- TypeScript project recommended (all code examples use `.tsx`). If your project has no `tsconfig.json`, Next.js auto-generates one on first `npm run dev`.
- Package manager (npm, yarn, pnpm)

### Required Information

- TideCloak URL (e.g., `https://tidecloak.example.com`)
- Realm name
- Client ID
- Adapter JSON exported from TideCloak

---

## Files to Inspect First

Before starting, confirm these exist:

```bash
# Next.js project structure
ls -la
# Should show: package.json, next.config.js, app/ or pages/

# Check Next.js version
cat package.json | grep '"next"'
# Should be 13.0.0 or higher

# Check router type
ls -la app/ 2>/dev/null && echo "App Router" || echo "Pages Router"
```

---

## Files to Create/Edit

### Step Overview

1. Install SDK package
2. Create adapter JSON storage location
3. Add environment variables
4. Create provider component (App Router) or wrap `_app` (Pages Router)
5. Create silent SSO file
6. Create post-auth redirect handler
7. Configure CSP (observed requirement from keylessh)
8. Verify login flow

---

## Exact Step Sequence

### Step 1: Install Tide SDK

```bash
npm install @tidecloak/nextjs
```

**Resolve the version, do not hardcode it**: run `npm view @tidecloak/nextjs version` and pin exactly what it returns. If npm is unreachable, use `0.14.17` (last version verified end-to-end by the pack). Never assume `1.0.0`, never use a `0.99.x` pre-release, and never install below `0.14.17`. **Match the SDK version to the TideCloak server version** — they share a numbering line, and a mismatch stales `tide_dpop_auth.html` (see T-26).

**Next.js 16+ bundler**: Next.js 16 defaults to Turbopack. The Tide SDK requires webpack for `strictExportPresence = false` and `@tidecloak/react` ESM alias. Update `package.json` scripts:
```json
"scripts": {
  "dev": "next dev --webpack",
  "build": "next build --webpack"
}
```
Without `--webpack`, `next build` fails with: `"This build is using Turbopack, with a webpack config and no turbopack config"`. VERIFIED (LEARNINGS-session-003 L-02).

---

### Step 2: Export Adapter JSON from TideCloak

**Via Admin Console**:
1. Login to TideCloak Admin Console
2. Navigate to: Clients → {your-client} → Installation
3. Select format: "Tide OIDC JSON" (NOT "Keycloak OIDC JSON")
4. Download file

**Via API** (Tide vendor endpoint — NOT the standard Keycloak installation path):
```bash
# First get the client UUID
CLIENT_UUID=$(curl -s "${TIDECLOAK_URL}/admin/realms/${REALM}/clients?clientId=${CLIENT_NAME}" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" | jq -r '.[0].id')

# Export via vendorResources (returns jwk, vendorId, homeOrkUrl)
curl -s "${TIDECLOAK_URL}/admin/realms/${REALM}/vendorResources/get-installations-provider?clientId=${CLIENT_UUID}&providerId=keycloak-oidc-keycloak-json" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  > data/tidecloak.json
```

**Do NOT use** the standard Keycloak path (`/clients/{id}/installation/providers/keycloak-oidc-keycloak-json`) — it returns a minimal adapter missing `jwk`, `vendorId`, and `homeOrkUrl`. VERIFIED (LEARNINGS-batch-008 L-04).

**Store adapter JSON**:
```bash
# Create data directory
mkdir -p data

# Move downloaded adapter to data/tidecloak.json
mv ~/Downloads/tidecloak.json data/

# Verify Tide extensions present
node -e "const c = require('./data/tidecloak.json'); console.log('Has jwk:', !!c.jwk); console.log('Has vendorId:', !!c.vendorId); console.log('Has homeOrkUrl:', !!c.homeOrkUrl);"
# Should output: Has jwk: true, Has vendorId: true, Has homeOrkUrl: true
```

**Required**: The `jwk` field contains the embedded JWKS for local JWT verification. This field is present in Tide adapter exports due to Tide's non-rotating vendor-verifiable key (VVK) model. The system is locked to trust one pre-defined public key, ensuring that even if the IAM is compromised, it cannot forge valid tokens.

---

### Step 3: Store Adapter JSON

The adapter JSON exported in Step 2 is the provider's config. Store it where the app can import it:

```bash
# Add to .gitignore
echo "data/tidecloak.json" >> .gitignore  # Contains sensitive config
```

**Note**: The `TideCloakProvider` takes the adapter JSON directly as a `config` prop. No environment variables are needed for the provider. Environment variables are only needed for the init script and server-side config loading.

---

### Step 4a: Provider Setup (App Router)

Create `app/providers.tsx`:
```typescript
// app/providers.tsx
'use client';

import { TideCloakProvider } from '@tidecloak/nextjs';
import tcConfig from '../../data/tidecloak.json';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TideCloakProvider
      config={{ ...tcConfig, useDPoP: { mode: 'strict', alg: 'ES256' } }}
    >
      {children}
    </TideCloakProvider>
  );
}
```

**`useDPoP` goes inside the config object**, not as a separate JSX prop. The `TideCloakProvider` only accepts `config` and `children`. VERIFIED (session-002).

### DPoP is ON by default — configure it or login breaks

**`templates/shared/realm.json.template` sets `"dpop.bound.access.tokens": "true"` on the client.** If you bootstrapped from that template — which every pack playbook does — DPoP is **already enabled server-side**. It is not opt-in. An app that skips the client-side half does not "just work without DPoP"; it fails at the token exchange.

**DPoP is a bidirectional lockstep requirement** (I-12):
1. **Server-side**: the client attribute `"dpop.bound.access.tokens": "true"` (on by default from the template).
2. **Client-side**: `useDPoP` in the config object, plus the three supporting pieces below.
3. **Both must be set simultaneously.** Server-side without client-side → token endpoint returns **400 "DPoP proof is missing"**. Client-side without server-side → proofs generated but ignored.

All **four** pieces are required together. Missing any one breaks login, usually with a misleading error:

| # | Piece | Where |
|---|---|---|
| 1 | `useDPoP: { mode: 'strict', alg: 'ES256' }` **inside** `config` | `app/providers.tsx` |
| 2 | `tide_dpop_auth.html` | `public/` |
| 3 | rewrite `/tide_dpop/:path*` → `/tide_dpop_auth.html` | `next.config.ts` |
| 4 | CSP + `Allow-CSP-From` on `/tide_dpop/:path*` | `next.config.ts` |

**`tide_dpop_auth.html`:**
- Copy it from a pack template (`templates/*/public/tide_dpop_auth.html`) into `public/`. The Tide enclave loads it during login to prove DPoP key possession to the ORKs. **Do not modify it** — its content is integrity-checked. VERIFIED (learning-batch-004, L-07).
- **The HTML must match the SDK version.** It is NOT shipped inside the `@tidecloak/*` npm packages, so upgrading the SDK does not update it — a mismatch is a real failure mode after a version bump. The only sources are the pack template and the Tide team. If the enclave rejects it (`Popup DPoP verification failed to load`), or the token exchange returns an unexplained **500** after an SDK upgrade, suspect this file first. VERIFIED (LEARNINGS-batch-005 L-05, LEARNINGS-batch-007 L-03).
- The enclave requests it at `/tide_dpop/iss/<hex-issuer>/aud/<hex-client>/tide_dpop_auth.html`, which does not map to the static file — hence the rewrite. Note the **SDK itself never references this path**; the enclave fetches it from your origin, so grepping the SDK for `tide_dpop` finds nothing and proves nothing.
- **Do NOT use a route handler** (`app/tide_dpop/[...path]/route.ts`). Next.js injects a hash-based CSP on route-handler responses that blocks the page's inline script. Static files via rewrites are unaffected. VERIFIED (LEARNINGS-batch-005 L-04).
- **Do NOT validate the issuer/client hex params.** The enclave already integrity-checks the HTML; server-side validation that fails returns 400 before the HTML loads, killing the popup. VERIFIED (LEARNINGS-batch-005 L-03).

**CSP rule order matters — put the `/tide_dpop` rule LAST.** Both rules match `/tide_dpop/*`, and for a given header key the **last matching rule wins**. A generic `/:path*` CSP placed *after* the DPoP rule silently overrides it. VERIFIED 2026-08-06.

```typescript
// next.config.ts
async rewrites() {
  return [{ source: '/tide_dpop/:path*', destination: '/tide_dpop_auth.html' }];
},
async headers() {
  return [
    { // generic app CSP — SWE iframe may load from any ORK the user re-homes to
      source: '/:path*',
      headers: [{ key: 'Content-Security-Policy', value: "frame-src 'self' *" }],
    },
    { // MUST come after the generic rule or it gets overridden
      source: '/tide_dpop/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'unsafe-inline'" },
        { key: 'Allow-CSP-From', value: '*' },
      ],
    },
  ];
},
```

**Verify all four before debugging anything else:**

```bash
grep -q "useDPoP" app/providers.tsx           && echo "1 provider OK"
test -f public/tide_dpop_auth.html            && echo "2 page OK"
grep -q "tide_dpop" next.config.*             && echo "3 rewrite OK"
# 4: the DPoP-specific CSP must survive, not the generic one:
curl -s -D - -o /dev/null "http://localhost:3000/tide_dpop/iss/a/aud/b/tide_dpop_auth.html" \
  | grep -i "content-security-policy"
#   want: default-src 'self'; script-src 'unsafe-inline'    (NOT frame-src 'self' *)
```

**`secureFetch` usage rules** (required once DPoP is on — a plain `fetch` with a Bearer header has no proof and is rejected):
- `secureFetch` is available directly on the `useTideCloak()` hook, and also as `IAMService.secureFetch` from `@tidecloak/js`. VERIFIED against `@tidecloak/react` `0.14.17` types.
- It requires **absolute URLs** — relative paths throw. Wrap it: ``const api = (p, init) => secureFetch(`${window.location.origin}${p}`, init)``.
- If you use `IAMService.secureFetch` with a manual token, **`getToken()` returns a Promise** — you must `await` it. Without `await` the header becomes `Bearer [object Promise]` and the server rejects with `JWSInvalid: Invalid Compact JWS`. VERIFIED (LEARNINGS-batch-005 L-07).

**Turning DPoP off is a governed change.** Removing `useDPoP` client-side alone does not disable it — the server still demands proofs, and login breaks with the 400. You must also flip the client attribute to `false`, which on an IGA realm is a change request. After the realm goes multiAdmin that needs a human enclave approval. Keep DPoP on unless you have a specific reason.

Edit `app/layout.tsx`:
```typescript
// app/layout.tsx
import { Providers } from './providers';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

---

### Step 4b: Provider Setup (Pages Router)

Edit `pages/_app.tsx`:
```typescript
// pages/_app.tsx
import type { AppProps } from 'next/app';
import { TideCloakProvider } from '@tidecloak/nextjs';
import tcConfig from '../data/tidecloak.json';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <TideCloakProvider
      config={{ ...tcConfig, useDPoP: { mode: 'strict', alg: 'ES256' } }}
    >
      <Component {...pageProps} />
    </TideCloakProvider>
  );
}
```

---

### Step 5: Create Silent SSO File

**Required for silent token refresh** (VERIFIED):
```bash
# Create public/silent-check-sso.html
mkdir -p public
cat > public/silent-check-sso.html << 'EOF'
<html>
<body>
  <script>
    parent.postMessage(location.href, location.origin);
  </script>
</body>
</html>
EOF
```

**Why required**: OIDC silent refresh uses hidden iframe. TideCloak redirects to this file during refresh. Without it, silent refresh fails and users are forced to re-login. See [canon/invariants.md I-07](../canon/invariants.md#i-07-silent-sso-file-required).

---

### Step 6: Create Post-Auth Redirect Handler

**Required for login completion** (I-16). After authentication at TideCloak, the browser redirects back to the app at the configured `redirectUri`. A real page must exist at that path. See [canon/redirect-handler.md](../canon/redirect-handler.md).

**App Router** — create `app/auth/redirect/page.tsx`:
```typescript
// app/auth/redirect/page.tsx
"use client";

import { useAuthCallback } from "@tidecloak/nextjs";
import { useEffect, useState } from "react";

// Separated so useAuthCallback only runs after hydration (avoids SSR window error).
function RedirectHandler() {
  const { isProcessing, isSuccess, error } = useAuthCallback({
    onSuccess: (returnUrl) => {
      window.location.assign(returnUrl || "/");
    },
    onError: () => {
      window.location.assign("/");
    },
    onMissingVerifierRedirectTo: "/",
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("code") && !params.has("error")) {
      window.location.assign("/");
    }
  }, []);

  if (error) return <p>Authentication failed: {error.message}</p>;
  if (isProcessing || !isSuccess) return <p>Completing login...</p>;
  return <p>Redirecting...</p>;
}

export default function AuthRedirectPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <p>Loading...</p>;
  return <RedirectHandler />;
}
```

The `useAuthCallback` hook processes the OIDC callback (code exchange) and calls `onSuccess` with the `returnUrl`. On error or missing PKCE verifier (page refresh during login), it redirects back to home.

**Do not** use a bare placeholder page with no callback handling. The page must actively process the callback and redirect.

**Pages Router** — create `pages/auth/redirect.tsx` (same pattern, adapted for Pages Router).

**Also update TideCloak client settings**:
- TideCloak Admin → Clients → {client} → Settings
- Valid Redirect URIs: add `http://localhost:3000/auth/redirect`

**Failure if missing**: Login completes at TideCloak but the user lands on a 404. The SDK never processes the auth code. See [canon/redirect-handler.md](../canon/redirect-handler.md) for diagnostics.

---

### Step 7: Configure CSP for SWE Iframe

**Required**: The SWE (Secure Web Enclave) iframe must be allowed to load from any Tide ORK host because users can re-home their sessions to their preferred ORK. By Tide's security design, while a platform vendor may designate a home ORK, users can override this choice and switch to any ORK they trust.

**For development**, use a permissive CSP:

Edit `next.config.js`:
```javascript
// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "frame-src 'self' *"
          }
        ]
      }
    ];
  }
};

module.exports = nextConfig;
```

**For production**, you may restrict to known Tide domains, but understand this limits user choice of ORK:
```javascript
value: "frame-src 'self' https://*.tideprotocol.com https://*.dauth.me"
```

**Failure symptom if missing**: Login hangs indefinitely. Browser console shows CSP violation: `Refused to frame 'https://...' because it violates the following Content Security Policy directive`. See [canon/troubleshooting.md T-01](../canon/troubleshooting.md#t-01-login-hangs-indefinitely).

---

### Step 8: Create Login Component

Create basic login UI:

**App Router** (`app/page.tsx`):
```typescript
// app/page.tsx
'use client';

import { useTideCloak } from '@tidecloak/nextjs';

export default function HomePage() {
  const { authenticated, getValueFromIdToken, login, logout } = useTideCloak();

  if (!authenticated) {
    return (
      <div>
        <h1>Welcome</h1>
        <button onClick={login}>Login with Tide</button>
      </div>
    );
  }

  return (
    <div>
      <h1>Welcome, {getValueFromIdToken("preferred_username")}</h1>
      <button onClick={logout}>Logout</button>
    </div>
  );
}
```

**Pages Router** (`pages/index.tsx`):
```typescript
// pages/index.tsx
import { useTideCloak } from '@tidecloak/nextjs';

export default function HomePage() {
  const { authenticated, getValueFromIdToken, login, logout } = useTideCloak();

  if (!authenticated) {
    return (
      <div>
        <h1>Welcome</h1>
        <button onClick={login}>Login with Tide</button>
      </div>
    );
  }

  return (
    <div>
      <h1>Welcome, {getValueFromIdToken("preferred_username")}</h1>
      <button onClick={logout}>Logout</button>
    </div>
  );
}
```

---

### Step 9: Test Login Flow

```bash
# Start dev server
npm run dev

# Open browser to http://localhost:3000
# Click "Login with Tide"
# Should redirect to TideCloak login page
# Enter credentials
# Should redirect back to app, showing "Welcome, {username}"
```

---

## Verification Checklist

After completing all steps, verify:

### Client-Side

- [ ] Login button visible when unauthenticated
- [ ] Click login redirects to TideCloak
- [ ] Enter credentials and submit
- [ ] Redirect back to app within 5-10 seconds
- [ ] User name displays correctly
- [ ] Logout button visible when authenticated
- [ ] Click logout clears session and shows login button again

### Browser Console

- [ ] No CSP violations (`frame-src` errors)
- [ ] No 404 on `silent-check-sso.html`
- [ ] No 404 on redirect handler path (`/auth/redirect`)
- [ ] No CORS errors
- [ ] No "Failed to load resource" for Tide domains

### Browser DevTools → Network

- [ ] Redirect to TideCloak `/auth` endpoint
- [ ] Redirect back to app with `code` parameter
- [ ] Token exchange request to TideCloak `/token` endpoint
- [ ] Requests to `*.tideprotocol.com` or `*.dauth.me` (SWE iframe)

### Browser DevTools → Application → Local Storage

- [ ] Keys starting with `kc-` or `tc-` present after login
- [ ] JWT token stored (decode at jwt.io to verify claims)

---

## Common Failures

### Login Hangs Indefinitely

**Symptom**: Redirect to TideCloak succeeds, but redirect back never completes. Spinner forever.

**Cause**: CSP blocks SWE iframe (most common).

**Fix**: Check browser console for CSP violation. Add Tide domains to CSP in `next.config.js` (Step 6).

**See**: [canon/troubleshooting.md T-01](../canon/troubleshooting.md#t-01-login-hangs-indefinitely)

---

### 404 on silent-check-sso.html

**Symptom**: Silent refresh fails after 10 minutes. User forced to re-login.

**Cause**: Missing `public/silent-check-sso.html`.

**Fix**: Create file (Step 5). Verify accessible at `http://localhost:3000/silent-check-sso.html`.

**See**: [canon/troubleshooting.md T-04](../canon/troubleshooting.md#t-04-silent-token-refresh-fails)

---

### "Cannot find module @tidecloak/nextjs"

**Symptom**: Import error on `TideCloakContextProvider`.

**Cause**: Package not installed or not on public npm registry.

**Fix**: Verify `npm install @tidecloak/nextjs` succeeds. Check `package.json` includes `@tidecloak/nextjs` in dependencies. Contact Tide team if package unavailable.

---

### Config Not Loading

**Symptom**: Provider fails to initialize, auth-server-url undefined.

**Cause**: `data/tidecloak.json` missing or not imported by provider.

**Fix**:
- Verify `data/tidecloak.json` exists: `test -f data/tidecloak.json`
- Verify `providers.tsx` imports it: `import tcConfig from '../../data/tidecloak.json'`
- Verify provider uses `config={tcConfig}`, not `NEXT_PUBLIC_TIDECLOAK_*` env vars
- Restart dev server (`npm run dev`)

---

### Redirect URI Mismatch

**Symptom**: TideCloak error: "Invalid redirect_uri".

**Cause**: Client in TideCloak not configured with app's redirect URI.

**Fix**:
1. TideCloak Admin → Clients → {your-client} → Settings
2. Add to "Valid Redirect URIs": `http://localhost:3000/*`
3. Add to "Valid Post Logout Redirect URIs": `http://localhost:3000/*`
4. Save

---

## Repair Path

If setup fails completely:

1. **Clear state**:
   ```bash
   # Browser: DevTools → Application → Local Storage → Clear All
   # Or visit: http://localhost:3000?reset=true (if implemented)
   ```

2. **Verify TideCloak is reachable**:
   ```bash
   curl ${TIDECLOAK_URL}/realms/${REALM}/.well-known/openid-configuration
   # Should return JSON with auth endpoints
   ```

3. **Verify adapter JSON is valid**:
   ```bash
   node -e "console.log(require('./data/tidecloak.json'))"
   # Should output valid JSON
   ```

4. **Check Next.js logs**:
   ```bash
   npm run dev
   # Watch for errors during startup
   ```

5. **Test in incognito**:
   - Clear browser state may not be complete
   - Incognito ensures fresh session

6. **Consult troubleshooting**:
   - [canon/troubleshooting.md](../canon/troubleshooting.md)
   - [canon/anti-patterns.md](../canon/anti-patterns.md)

---

## Do Not Do This

### ❌ Scaffold Command (Alternative)

```bash
# Alternative: Automated scaffold
npm init @tidecloak/nextjs@latest <myApp>
```

**About**: The scaffold command automates realm creation, IGA setup, client configuration, and adapter export. It prompts for TideCloak URL, realm name, client name, admin credentials, and operator email for license activation. The process creates a complete Next.js app with Tide auth pre-configured.

**Why manual setup is preferred here**: Manual setup is more inspectable and educational. Scaffold is useful for quick starts but obscures the individual configuration steps. Choose based on your learning goals.

---

### ❌ Do Not Skip CSP Configuration

```javascript
// ❌ WRONG: No CSP or missing Tide domains
// SWE iframe will be blocked
```

**Why**: Browser blocks cross-origin iframes by default. SWE cannot load without CSP whitelist. Login hangs forever with no visible error. See [canon/anti-patterns.md AP-07](../canon/anti-patterns.md#ap-07-missing-csp-whitelist).

---

### ❌ Do Not Skip silent-check-sso.html

```bash
# ❌ WRONG: Missing silent SSO file
# Silent refresh will fail
```

**Why**: Silent token refresh requires this file. Without it, users forced to re-login every 10 minutes (or token expiration). See [canon/anti-patterns.md AP-15](../canon/anti-patterns.md#ap-15-skipping-silent-check-ssohtml).

---

### ❌ Do Not Store Secrets in Client-Side Env Vars

```bash
# ❌ WRONG: Client secret in NEXT_PUBLIC_ var
NEXT_PUBLIC_CLIENT_SECRET=secret123
```

**Why**: `NEXT_PUBLIC_` vars are bundled into client JavaScript. Visible to all users. Tide uses public clients (no client secret). If you have a confidential client, use server-side env vars only.

---

### ❌ Do Not Implement Custom Login Flow

```typescript
// ❌ WRONG: Custom password submission
async function handleLogin(username: string, password: string) {
  const response = await fetch(`${tidecloakUrl}/token`, {
    method: 'POST',
    body: new URLSearchParams({ username, password, grant_type: 'password' })
  });
}
```

**Why**: Tide authentication is threshold-verified (PRISM). Custom password flows bypass threshold enforcement. Use SDK's `login()` method. See [canon/anti-patterns.md AP-14](../canon/anti-patterns.md#ap-14-implementing-custom-token-refresh-logic).

---

## Known Uncertainties

### Required `_tide_*` Role

Each user must have at least one role starting with `_tide_` (e.g., `_tide_enabled`) for Tide operations to work. This is required for the vendor to fund Tide operations through the voucher system. Users without a `_tide_*` role will have their Tide requests rejected because no voucher will be assigned.

**Setup**: Ensure your realm's default roles include at least one `_tide_*` role, or assign such roles manually to users.

---

## Next Steps

After login works, follow this sequence:

1. [Protect routes](protect-routes-nextjs.md) - Client-side route guards (UI gating only)
2. [Protect APIs](protect-api-nextjs.md) - Server-side JWT verification (real authorization). **Required before RBAC.**
3. [Add RBAC](add-rbac-nextjs.md) - Role-based access control (depends on API protection)

---

## References

- [canon/concepts.md](../canon/concepts.md) - Tide core concepts
- [canon/framework-matrix.md](../canon/framework-matrix.md) - Next.js implementation patterns
- [canon/invariants.md](../canon/invariants.md) - Security rules (I-06, I-07)
- [canon/anti-patterns.md](../canon/anti-patterns.md) - Common mistakes (AP-07, AP-14, AP-15)
- [canon/troubleshooting.md](../canon/troubleshooting.md) - Symptom-led debugging (T-01, T-04)
- keylessh exemplar: `sources/example-app-keylessh/` (DC-04, DC-09)
