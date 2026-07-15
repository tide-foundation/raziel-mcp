# Add Tide Auth to Existing Next.js Project

Manual setup for integrating Tide authentication into an existing Next.js application, potentially with existing auth.

---

## When to Use

- Have existing Next.js app (App Router or Pages Router)
- Want to migrate to Tide from another auth provider
- Want to add Tide alongside existing auth (migration period)
- Have existing routes, components, and state management
- Have an existing app with no auth yet (skip Steps 1-2; the rest applies as-is)

**Do not use** if starting fresh. See [add-auth-nextjs-fresh.md](add-auth-nextjs-fresh.md) instead.

---

## Prerequisites

### Existing App Assessment

Before proceeding, understand your existing setup:

```bash
# Check router type
ls -la app/ 2>/dev/null && echo "App Router" || echo "Pages Router"

# Check for existing auth
grep -r "auth\|login\|session" pages/ app/ components/ --include="*.tsx" --include="*.ts" | head -20
# Note any existing auth providers, middleware, or session management

# Check for existing request interception (proxy.ts for Next.js 16+, middleware.ts for 15 and earlier)
ls -la proxy.ts middleware.ts 2>/dev/null

# Check dependencies
cat package.json | grep -E "(auth|session|jwt)"
# Note existing auth packages
```

### Running Services

- TideCloak instance accessible
- TideCloak realm created and configured
- TideCloak client created
- IGA enabled on realm

### Required Information

- TideCloak URL
- Realm name
- Client ID
- Adapter JSON exported

---

## Migration Strategy Decision

Choose one:

### Option A: Clean Migration (Recommended)

Remove existing auth entirely, replace with Tide.

**Pros**: Simpler, no conflicts, full Tide integration
**Cons**: Requires re-authentication for all users
**When**: Existing auth is simple or can be deprecated

### Option B: Parallel Auth (Temporary)

Run both auth systems during migration.

**Pros**: Gradual migration, test with subset of users
**Cons**: Complex, two auth flows, potential conflicts
**When**: Large user base, need phased rollout

**This playbook focuses on Option A (Clean Migration).**

---

## Files to Inspect First

```bash
# Existing auth patterns
grep -r "useAuth\|useSession\|getServerSideProps.*session" app/ pages/ --include="*.tsx" --include="*.ts"

# Existing request interception
cat proxy.ts 2>/dev/null || cat middleware.ts 2>/dev/null

# Existing _app or layout
cat pages/_app.tsx 2>/dev/null
cat app/layout.tsx 2>/dev/null

# Existing API routes with auth
find pages/api/ app/api/ -name "*.ts" -o -name "*.tsx" 2>/dev/null | xargs grep -l "auth\|session\|jwt"
```

---

## Files to Edit

1. Remove/replace existing auth provider
2. Install Tide SDK
3. Add Tide provider
4. Update auth checks in components
5. Update API route protection
6. Add silent SSO file (if missing)
7. Configure CSP

---

## Exact Step Sequence

### Step 1: Backup Current Auth Setup

```bash
# Create backup branch
git checkout -b backup-before-tide
git add .
git commit -m "Backup before Tide migration"
git checkout main  # or your working branch
git checkout -b add-tide-auth
```

**Document existing auth**:
```bash
# List all files using existing auth
grep -r "useAuth\|useSession\|signIn\|signOut" . --include="*.tsx" --include="*.ts" > auth-migration-checklist.txt

# Review this file to plan replacements
```

---

### Step 2: Remove Existing Auth Dependencies

```bash
# Example: Remove NextAuth (adjust for your auth provider)
npm uninstall next-auth

# Or Auth0
npm uninstall @auth0/nextjs-auth0

# Or Clerk
npm uninstall @clerk/nextjs

# Verify removal
cat package.json | grep -E "(auth|session)"
```

---

### Step 3: Install Tide SDK

```bash
npm install @tidecloak/nextjs
```

---

### Step 4: Export and Store Adapter JSON

Same as fresh setup. See [add-auth-nextjs-fresh.md Step 2](add-auth-nextjs-fresh.md#step-2-export-adapter-json-from-tidecloak).

```bash
mkdir -p data
# Download adapter JSON to data/tidecloak.json
# Verify Tide extensions present
```

---

### Step 5: Update Environment Variables

Edit `.env.local`:
```bash
# Remove old auth vars (e.g., NEXTAUTH_SECRET, AUTH0_CLIENT_SECRET)

# Tide connection details are read from data/tidecloak.json (adapter config),
# not from environment variables. Remove any old auth env vars.
```

---

### Step 6: Replace Auth Provider

#### App Router

**Before** (example with NextAuth):
```typescript
// app/layout.tsx
import { SessionProvider } from 'next-auth/react';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
```

**After** (Tide):
```typescript
// app/layout.tsx
import { Providers } from './providers';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

Create `app/providers.tsx`:
```typescript
// app/providers.tsx
'use client';

import { TideCloakProvider } from '@tidecloak/nextjs';
import tcConfig from '../data/tidecloak.json';

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

**DPoP** requires both server-side config (client attribute `"dpop.bound.access.tokens": "true"`) AND client-side config (`useDPoP` prop). Without `useDPoP`, `secureFetch` does not attach DPoP proofs and API calls fail with 401. See [add-auth-nextjs-fresh.md Step 4a](add-auth-nextjs-fresh.md#step-4a-provider-setup-app-router) for details.

#### Pages Router

**Before**:
```typescript
// pages/_app.tsx
import { SessionProvider } from 'next-auth/react';

export default function App({ Component, pageProps }) {
  return (
    <SessionProvider>
      <Component {...pageProps} />
    </SessionProvider>
  );
}
```

**After**:
```typescript
// pages/_app.tsx
import { TideCloakProvider } from '@tidecloak/nextjs';
import tcConfig from '../data/tidecloak.json';

export default function App({ Component, pageProps }) {
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

### Step 7: Update Component Auth Checks

Replace existing auth hooks with Tide hooks.

**Before** (NextAuth):
```typescript
import { useSession, signIn, signOut } from 'next-auth/react';

export function ProfileButton() {
  const { data: session } = useSession();

  if (!session) {
    return <button onClick={() => signIn()}>Login</button>;
  }

  return <button onClick={() => signOut()}>Logout</button>;
}
```

**After** (Tide):
```typescript
import { useTideCloak } from '@tidecloak/nextjs';

export function ProfileButton() {
  // useTideCloak() has no `user` object. Read claims via getValueFromIdToken /
  // getValueFromToken (e.g. getValueFromIdToken('preferred_username')).
  const { authenticated, login, logout } = useTideCloak();

  if (!authenticated) {
    return <button onClick={login}>Login</button>;
  }

  return <button onClick={logout}>Logout</button>;
}
```

**Batch find-and-replace**:
```bash
# Find all uses of old auth hook
grep -r "useSession\|useAuth" components/ app/ pages/ --include="*.tsx" --include="*.ts" | cut -d: -f1 | sort -u

# Update each file manually or with sed (review carefully)
```

---

### Step 8: Update API Route Protection

**Before** (NextAuth API route):
```typescript
// pages/api/users.ts or app/api/users/route.ts
import { getServerSession } from 'next-auth';

export async function GET(req) {
  const session = await getServerSession();
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }
  return Response.json({ users: [...] });
}
```

**After** (Tide - server-side JWT verification):

Tide ships a server-side verification helper. `@tidecloak/nextjs/server` exports `verifyTideCloakToken(config, token, allowedRoles?)` (re-exported from `@tidecloak/verify`). Use it instead of hand-rolling JWKS verification.

**Quick pattern** (supported helper):
```typescript
// app/api/users/route.ts
import { NextRequest } from 'next/server';
import { verifyTideCloakToken } from '@tidecloak/nextjs/server';
import tcConfig from '../../../data/tidecloak.json';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Accepts "Bearer <jwt>" or "DPoP <jwt>"
  const token = authHeader.replace(/^(Bearer|DPoP) /, '');

  // Arg order is (config, token, allowedRoles) — config FIRST.
  const payload = await verifyTideCloakToken(tcConfig, token, []);
  if (!payload) {
    return Response.json({ error: 'Invalid token' }, { status: 401 });
  }
  return Response.json({ users: [...] });
}
```

`verifyTideCloakToken` verifies the signature against the adapter's embedded `jwk` (local JWKS), checks the issuer/`azp`, and optionally enforces `allowedRoles`. It returns the decoded payload on success and `false` on failure.

**If you need the manual version** (or DPoP proof re-verification): see [verify-jwt-server-side.md](verify-jwt-server-side.md), which shows the same checks hand-rolled with `jose` in `lib/auth/tideJWT.ts`.

---

### Step 9: Update proxy.ts / middleware.ts (If Exists)

Check for existing request interception:
```bash
ls -la proxy.ts middleware.ts 2>/dev/null
```

Check the installed Next.js version to determine the correct filename:
```bash
NEXT_MAJOR=$(node -e "try{console.log(require('next/package.json').version.split('.')[0])}catch{console.log('unknown')}" 2>/dev/null)
# 16+ → proxy.ts | 15 or earlier → middleware.ts
```

Next.js 16+ uses `proxy.ts`. Next.js 15 and earlier use `middleware.ts`. If migrating from `middleware.ts` to `proxy.ts`, rename the file.

**Before** (NextAuth middleware):
```typescript
// middleware.ts (Next.js ≤15) or proxy.ts (Next.js 16+)
export { default } from 'next-auth/middleware';

export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*']
};
```

**After** (Tide options):

Option A — **use the Tide-provided proxy/middleware helpers.** `@tidecloak/nextjs/server` ships `createTideCloakProxy` (Next.js 16+ `proxy.ts`, Node runtime) and `createTideCloakMiddleware` (Edge `middleware.ts`, still supported). These replace a NextAuth-style middleware export and perform real token verification via `verifyTideCloakToken`:
```typescript
// proxy.ts (Next.js 16+)  — or middleware.ts on 15 and earlier
import { createTideCloakProxy } from '@tidecloak/nextjs/server';
import tcConfig from './data/tidecloak.json';

export default createTideCloakProxy(tcConfig);

export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*'],
};
```

Option B — **remove proxy.ts / middleware.ts** and rely on the client-side provider for UX gating plus server-side JWT verification in each API route (Step 8). Do this if you do not want request-interception at all.

**Warning**: A plain, hand-written `proxy.ts` / `middleware.ts` that only checks cookie presence is UI gating only, NOT real authorization. The `createTideCloakProxy` / `createTideCloakMiddleware` helpers above DO verify the token, but you should still verify JWTs inside API routes (Step 8) as the authoritative enforcement point. See [canon/feature-mapping.md](../canon/feature-mapping.md#protected-routes-vs-protected-apis).

If you want client-side route guards, implement in component:
```typescript
// app/dashboard/layout.tsx
'use client';

import { useTideCloak } from '@tidecloak/nextjs';
import { useEffect } from 'react';

export default function DashboardLayout({ children }) {
  const { authenticated, isInitializing, login } = useTideCloak();

  useEffect(() => {
    if (!isInitializing && !authenticated) {
      login();
    }
  }, [isInitializing, authenticated, login]);

  if (isInitializing || !authenticated) {
    return <div>Checking authentication...</div>;
  }

  return <>{children}</>;
}
```

**Why `isInitializing`**: Calling `login()` before the SDK finishes initializing throws `"TideCloak client not initialized"`. Always gate on `isInitializing`. See [canon/anti-patterns.md AP-28](../canon/anti-patterns.md#ap-28-calling-login-before-sdk-initialization).

---

### Step 10: Add Post-Auth Redirect Handler

Check if exists:
```bash
# App Router
test -f app/auth/redirect/page.tsx || test -f src/app/auth/redirect/page.tsx

# Pages Router
test -f pages/auth/redirect.tsx || test -f src/pages/auth/redirect.tsx
```

If missing, create the handler. See [add-auth-nextjs-fresh.md Step 6](add-auth-nextjs-fresh.md#step-6-create-post-auth-redirect-handler) for exact file contents and [canon/redirect-handler.md](../canon/redirect-handler.md) for framework-specific details.

Ensure the redirect URI in `data/tidecloak.json` matches the handler path (e.g., `http://localhost:3000/auth/redirect`). This is configured when exporting the adapter JSON from TideCloak Admin Console.

---

### Step 11: Add Silent SSO File

Check if exists:
```bash
ls -la public/silent-check-sso.html
```

If missing, create:
```bash
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

---

### Step 12: Configure CSP

Check existing CSP:
```bash
grep -r "Content-Security-Policy\|frame-src" next.config.js next.config.ts proxy.ts middleware.ts 2>/dev/null
```

Add Tide domains to `frame-src`:

**If CSP exists**, update `frame-src` to permit any ORK host:
```javascript
// next.config.js
const nextConfig = {
  async headers() {
    return [{
      source: '/:path*',
      headers: [{
        key: 'Content-Security-Policy',
        value: [
          // Existing CSP directives
          "frame-src 'self' *",  // Allow any ORK (users can re-home sessions)
          // ... other directives
        ].join(' ')
      }]
    }];
  }
};
```

**Why `*`**: The SWE iframe must permit any Tide ORK host because users can re-home their sessions to any ORK they trust. This is a core Tide security design feature.

**For production**, you may restrict to known domains, but this limits user choice:
```javascript
"frame-src 'self' https://*.tideprotocol.com https://*.dauth.me"
```

**If CSP missing**, see [add-auth-nextjs-fresh.md Step 6](add-auth-nextjs-fresh.md#step-6-configure-csp-for-swe-iframe) for complete setup.

---

### Step 13: Update TideCloak Client Configuration

In TideCloak Admin Console:

1. Clients → {your-client} → Settings
2. **Valid Redirect URIs**: Add all app URLs
   ```
   http://localhost:3000/*
   https://app.example.com/*
   ```
3. **Valid Post Logout Redirect URIs**: Same as above
4. **Web Origins**: Add for CORS
   ```
   http://localhost:3000
   https://app.example.com
   ```
5. Save

---

### Step 14: Test Migration

```bash
# Clear browser state (old auth cookies/tokens)
# DevTools → Application → Storage → Clear site data

# Start dev server
npm run dev

# Test flows:
# 1. Visit protected route (should redirect to Tide login)
# 2. Login with Tide credentials
# 3. Verify redirect back to app
# 4. Verify protected content accessible
# 5. Logout
# 6. Verify redirect to login
```

---

## Verification Checklist

### Login Flow

- [ ] Unauthenticated user redirected to Tide login
- [ ] Credentials accepted
- [ ] Redirect back to original URL
- [ ] Auth state preserved across page refreshes

### Component Rendering

- [ ] All components using auth hooks render correctly
- [ ] User info displays (name, email, etc.)
- [ ] Role-based UI elements show/hide appropriately (UI gating)

### API Protection

- [ ] Protected API routes reject unauthenticated requests (401)
- [ ] Protected API routes accept valid Tide JWTs (200)
- [ ] Role-based API routes enforce role checks (403 if wrong role)

### Session Management

- [ ] Silent token refresh works (no forced re-login after 10 min)
- [ ] Logout clears session completely
- [ ] Multiple tabs stay synchronized (all logout together)

### No Conflicts

- [ ] No errors from old auth packages
- [ ] No duplicate providers in React tree
- [ ] No conflicting middleware
- [ ] No old auth API routes responding

---

## Common Failures

### Old Auth Tokens Cached

**Symptom**: App shows logged in but APIs return 401. Or infinite redirect loop.

**Cause**: Browser still has old auth cookies/tokens.

**Fix**:
```bash
# Browser: DevTools → Application → Storage → Clear site data
# Or incognito window for clean test
```

---

### Missing API JWT Verification

**Symptom**: APIs still check old auth. Or no auth check at all.

**Cause**: Forgot to update API routes from old auth to Tide JWT verification.

**Fix**: Review all API routes. Replace old auth checks with Tide JWT verification. See [verify-jwt-server-side.md](verify-jwt-server-side.md).

---

### Component Import Errors

**Symptom**: `Cannot find module 'next-auth/react'` after uninstall.

**Cause**: Components still import old auth package.

**Fix**:
```bash
# Find all old imports
grep -r "from 'next-auth\|from \"next-auth" . --include="*.tsx" --include="*.ts"

# Update to Tide imports
# Old: import { useSession } from 'next-auth/react';
# New: import { useTideCloak } from '@tidecloak/nextjs';
```

---

### Proxy / Middleware Conflicts

**Symptom**: Routes protected by proxy/middleware but Tide auth not checked.

**Cause**: Old auth proxy or middleware still active.

**Fix**: Remove or update `proxy.ts` (or legacy `middleware.ts`). Either switch it to Tide's `createTideCloakProxy` / `createTideCloakMiddleware` from `@tidecloak/nextjs/server` (Step 9, Option A), or remove it and rely on client-side route guards plus server-side JWT verification (Step 8).

---

### User Data Mismatch

**Symptom**: App expects `session.user.id` but Tide provides `user.sub`.

**Cause**: Different auth providers use different claim names.

**Fix**: Update components to use Tide SDK accessors:
```typescript
const { getValueFromToken, getValueFromIdToken, hasRealmRole } = useTideCloak();

// Old: session.user.id
// New: getValueFromToken("sub")

// Old: session.user.email
// New: getValueFromIdToken("email")

// Old: session.user.name
// New: getValueFromIdToken("preferred_username")

// Old: session.user.role check
// New: hasRealmRole("admin")
```

Or create adapter:
```typescript
function adaptTideUser(tc: ReturnType<typeof useTideCloak>) {
  return {
    id: tc.getValueFromToken("sub"),
    email: tc.getValueFromIdToken("email"),
    name: tc.getValueFromIdToken("preferred_username"),
  };
}
```

---

## Repair Path

If migration blocked:

1. **Rollback option**:
   ```bash
   git checkout backup-before-tide
   npm install
   # Old auth restored
   ```

2. **Isolate issue**:
   - Test Tide auth in minimal page first
   - Gradually migrate pages/components
   - Keep old auth working in parallel temporarily

3. **Verify each layer**:
   - Client-side auth state (DevTools → Components → TideCloakContext)
   - API protection (curl with JWT, verify 200 vs 401)
   - Silent refresh (wait 10 min, verify no re-login)

4. **Check migration checklist**:
   ```bash
   cat auth-migration-checklist.txt
   # Did you update every file listed?
   ```

---

## Do Not Do This

### ❌ Do Not Run Two Auth Providers Simultaneously (Long-Term)

```typescript
// ❌ WRONG: Both providers active
<SessionProvider>
  <TideCloakProvider config={tcConfig}>
    {children}
  </TideCloakProvider>
</SessionProvider>
```

**Why**: Conflicts, confusion, security risks. One auth system should be authoritative. Parallel auth only acceptable during short migration period with clear boundaries.

---

### ❌ Do Not Keep Old Auth API Routes Active

```typescript
// ❌ WRONG: Old NextAuth API still responding
// pages/api/auth/[...nextauth].ts still exists
```

**Why**: Creates backdoor. If old auth has vulnerabilities or uses weaker security, attackers can exploit it. Remove completely.

---

### ❌ Do Not Mix Auth Checks in Same Component

```typescript
// ❌ WRONG: Checking both old and new auth
const { data: oldSession } = useSession();
const { authenticated } = useTideCloak();

if (oldSession || authenticated) {
  return <ProtectedContent />;
}
```

**Why**: Ambiguous authority. Which auth is trusted? If one is compromised, both paths are vulnerable. Choose one.

---

### ❌ Do Not Skip Server-Side Migration

```typescript
// ❌ WRONG: Updated client-side but APIs still use old auth
// UI uses Tide, APIs check NextAuth session
```

**Why**: Broken. Client sends Tide JWT, server expects old session cookie. All API calls fail. Must migrate both client and server together.

---

## Known Uncertainties

Same as fresh setup. See [add-auth-nextjs-fresh.md Known Uncertainties](add-auth-nextjs-fresh.md#known-uncertainties).

Additional migration-specific:

### User Migration

User accounts from old auth must be re-created in TideCloak realm or imported. Account migration procedures not covered in SDK docs. Contact Tide team for user migration guidance.

### Session Transition

Existing logged-in users will be logged out during migration. No automatic session transfer. Plan maintenance window or communicate to users.

---

## Next Steps

After migration complete:

1. [Protect routes](protect-routes-nextjs.md) - Standardize route protection
2. [Protect APIs](protect-api-nextjs.md) - Verify all API protection migrated correctly
3. [Add RBAC](add-rbac-nextjs.md) - Add role-based access control
4. Clean up old auth remnants:
   ```bash
   # Remove backup branch after testing
   git branch -D backup-before-tide

   # Remove old auth config files
   rm auth.config.ts  # or whatever your old auth used
   ```

---

## References

- [add-auth-nextjs-fresh.md](add-auth-nextjs-fresh.md) - Fresh setup steps
- [verify-jwt-server-side.md](verify-jwt-server-side.md) - API protection implementation
- [canon/concepts.md](../canon/concepts.md) - Tide core concepts
- [canon/anti-patterns.md](../canon/anti-patterns.md) - Migration pitfalls
- [canon/troubleshooting.md](../canon/troubleshooting.md) - Debug failed migration
