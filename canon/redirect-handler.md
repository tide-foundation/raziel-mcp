# Tide Post-Auth Redirect Handler

Tide auth uses OIDC authorization code flow. After authentication at TideCloak, the browser is redirected back to the application at the configured `redirectUri`. A real page or route must exist at that URI. Without it, the user lands on a 404 or blank page and login completion fails.

---

## Rule

**Every Tide-enabled app must have a working page or route at its configured `redirectUri`.** The Tide SDK provider must be active on that page to process the OIDC callback (extract the auth code and exchange it for tokens).

This applies whether using the default redirect path or a custom one.

**Default redirect path**: `/auth/redirect`

**ASSUMED**: The default redirect URI path convention is `/auth/redirect`. If a different path is used, the corresponding route must exist.

---

## Why This Matters

1. TideCloak redirects the browser to `redirectUri?code=...&state=...` after authentication.
2. The Tide SDK on the target page reads the URL parameters and completes the token exchange.
3. If no page exists at the redirect URI, the browser shows a 404. The SDK never runs. Login appears to fail silently.
4. If the page exists but the SDK provider is not active there, the auth code is ignored.

---

## Framework-Specific Guidance

### Vanilla JS / Vite (Static)

**Default redirect path**: `/auth/redirect`

**Required file**: `public/auth/redirect.html`

This file must include the Tide SDK initialization script so the SDK can process the callback.

```html
<!-- public/auth/redirect.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Completing login...</title>
</head>
<body>
  <p>Completing login...</p>
  <script type="module" src="/auth.js"></script>
</body>
</html>
```

**If using a custom redirectUri**: the corresponding HTML file must exist in `public/` at the matching path, and it must load the SDK.

**Verification**:
```bash
# Check the file exists
test -f public/auth/redirect.html && echo "Found" || echo "Missing"

# Check it is accessible
curl http://localhost:3000/auth/redirect.html
```

---

### React SPA (Vite)

**Default redirect path**: `/auth/redirect`

**Required**: A route that renders at `/auth/redirect` within the SPA.

React SPAs serve `index.html` for all paths when the dev server or production server has SPA fallback enabled. If SPA fallback is configured (Vite dev server does this by default), the SDK provider on the root page handles the callback automatically.

**For production builds** served by a static file server without SPA fallback, create a physical file or configure server-side rewrite rules.

**Option A — React Router route** (recommended if using React Router):

```tsx
// src/pages/AuthRedirect.tsx
export default function AuthRedirect() {
  return <p>Completing login...</p>;
}

// In your router config:
// <Route path="/auth/redirect" element={<AuthRedirect />} />
```

**Option B — Verify SPA fallback** (if not using React Router):

The Vite dev server serves `index.html` for all unmatched routes. The SDK provider on the root page processes the callback. For production, ensure your static host is configured for SPA fallback (e.g., `_redirects` file for Netlify, `vercel.json` rewrites, or nginx `try_files`).

**If using a custom redirectUri**: the matching route or SPA fallback path must resolve to a page where the SDK provider is active.

**Verification**:
```bash
# In dev mode, verify the path resolves (should return HTML, not 404)
curl http://localhost:5173/auth/redirect
```

---

### Next.js App Router

**Default redirect path**: `/auth/redirect`

**Required file**: `app/auth/redirect/page.tsx` (or `src/app/auth/redirect/page.tsx` if the project uses `src/`)

This page processes the OIDC callback using the SDK's `useAuthCallback` hook, then redirects the user:
- On success: to the `returnUrl` (where the user was before login) or home (`/`)
- On error or missing PKCE verifier (e.g. page refresh): back to home
- On direct navigation (no callback params): back to home

```tsx
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

  if (error) {
    return <p>Authentication failed: {error.message}</p>;
  }

  if (isProcessing || !isSuccess) {
    return <p>Completing login...</p>;
  }

  return <p>Redirecting...</p>;
}

export default function AuthRedirectPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <p>Loading...</p>;
  return <RedirectHandler />;
}
```

**Do not** use a bare placeholder page (e.g., `return <p>Completing login...</p>` with no callback handling). The page must actively process the OIDC callback and redirect the user.

**If using a custom redirectUri**: the corresponding App Router page must exist at the matching path.

**Verification**:
```bash
# Check the file exists (adjust for src/ if needed)
test -f app/auth/redirect/page.tsx && echo "Found" || echo "Missing"

# Check the route resolves
curl http://localhost:3000/auth/redirect
# Should return HTML, not 404
```

---

### Next.js Pages Router

**Default redirect path**: `/auth/redirect`

**Required file**: `pages/auth/redirect.tsx` (or `src/pages/auth/redirect.tsx` if the project uses `src/`)

The SDK provider in `_app.tsx` covers all pages.

```tsx
// pages/auth/redirect.tsx
export default function AuthRedirectPage() {
  return <p>Completing login...</p>;
}
```

**If using a custom redirectUri**: the corresponding Pages Router file must exist at the matching path.

**Verification**:
```bash
test -f pages/auth/redirect.tsx && echo "Found" || echo "Missing"
curl http://localhost:3000/auth/redirect
```

---

## Diagnostic: Missing Redirect Handler

**Symptom**: Login at TideCloak succeeds (credentials accepted) but the user lands on a 404 page or a blank page instead of returning to the app authenticated.

**Diagnostic steps**:

1. Check the configured `redirectUri`:
   ```bash
   # Next.js
   grep 'REDIRECT_URI' .env.local .env
   grep 'redirectUri' app/providers.tsx app/layout.tsx pages/_app.tsx 2>/dev/null

   # React/Vite
   cat public/tidecloak.json | grep redirect 2>/dev/null

   # Vanilla JS
   grep 'redirectUri' public/auth.js public/*.js 2>/dev/null
   ```

2. Check the handler exists at the redirect path:
   ```bash
   # Next.js App Router
   test -f app/auth/redirect/page.tsx || test -f src/app/auth/redirect/page.tsx

   # Next.js Pages Router
   test -f pages/auth/redirect.tsx || test -f src/pages/auth/redirect.tsx

   # React/Vite (check SPA fallback or physical file)
   curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/auth/redirect

   # Vanilla JS
   test -f public/auth/redirect.html
   ```

3. Verify the TideCloak client allows the redirect URI:
   - TideCloak Admin → Clients → {client} → Settings → Valid Redirect URIs
   - Must include the full redirect URI (e.g., `http://localhost:3000/auth/redirect`)

**Fix**: Create the missing handler file or route using the examples above. Update TideCloak client settings to include the redirect URI.

---

## Anti-Patterns

- **AP-REDIR-01**: Setting `redirectUri` to a path that does not exist in the app. Login completes at TideCloak but the user sees a 404.
- **AP-REDIR-02**: Creating the redirect page but not including the SDK provider. The page renders but the auth code is never processed.
- **AP-REDIR-03**: Assuming the redirect handler is optional. Without it, every login attempt fails to complete.
- **AP-REDIR-04**: Using `redirectUri: window.location.origin` (root) without verifying the SDK is active on the landing page. This works when the root page has the SDK but breaks if the root redirects elsewhere.

---

## Relation to Other Invariants

- **I-06 (CSP)**: Even with a correct redirect handler, CSP violations block the SWE iframe and cause login to hang.
- **I-07 (Silent SSO)**: The `silent-check-sso.html` file handles silent token refresh, not the post-auth redirect. Both are required.
- **Redirect URI mismatch**: If the URI configured in the SDK does not match the TideCloak client's Valid Redirect URIs list, TideCloak rejects the request before the redirect handler is even reached. See `diagnose-broken-login`.
