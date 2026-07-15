# Protect Routes in Next.js (Client-Side UI Gating)

Implement client-side route guards that redirect unauthenticated users to login.

**CRITICAL**: This is UI gating only, NOT real authorization. Protected routes can be bypassed. For API protection, see [protect-api-nextjs.md](protect-api-nextjs.md).

---

## When to Use

- Want to hide pages from unauthenticated users (UX improvement)
- Want to redirect to login if user not authenticated
- Want to show different UI based on authentication status

**Do not use** for:
- Protecting sensitive APIs (use server-side JWT verification)
- Preventing unauthorized access to data (use server-side checks)
- Security enforcement (route guards are UI convenience only)

---

## Prerequisites

- Tide authentication installed ([add-auth-nextjs-fresh.md](add-auth-nextjs-fresh.md))
- `TideCloakProvider` wrapping app
- Login flow working

---

## Security Warning

**Route protection is NOT authorization.**

Client-side route guards can be bypassed:
- User disables JavaScript
- User modifies client code
- User directly calls APIs bypassing UI

**Real authorization** happens server-side with JWT verification.

See [canon/feature-mapping.md Protected Routes vs Protected APIs](../canon/feature-mapping.md#protected-routes-vs-protected-apis) for distinction.

See [canon/invariants.md I-08](../canon/invariants.md#i-08-ui-gating-is-not-authorization) for security rule.

---

## Files to Inspect First

```bash
# Check router type
ls -la app/ 2>/dev/null && echo "App Router" || echo "Pages Router"

# List pages/routes to protect
find app/ pages/ -name "page.tsx" -o -name "*.tsx" 2>/dev/null | grep -v "_app\|_document\|layout"

# Check Next.js version to determine correct request interception filename
NEXT_MAJOR=$(node -e "try{console.log(require('next/package.json').version.split('.')[0])}catch{console.log('unknown')}" 2>/dev/null)
echo "Next.js major: $NEXT_MAJOR"
# 16+ → proxy.ts | 15 or earlier → middleware.ts
cat proxy.ts 2>/dev/null || cat middleware.ts 2>/dev/null
```

---

## Implementation Patterns

### App Router: Layout-Based Guards

**When**: Protect entire section (e.g., `/dashboard/*`, `/admin/*`)

Create protected layout:

```typescript
// app/dashboard/layout.tsx
'use client';

import { useTideCloak } from '@tidecloak/nextjs';
import { useEffect } from 'react';

export default function DashboardLayout({
  children
}: {
  children: React.ReactNode
}) {
  const { authenticated, isInitializing, login } = useTideCloak();

  useEffect(() => {
    if (!isInitializing && !authenticated) {
      login();
    }
  }, [isInitializing, authenticated, login]);

  // Block render until SDK is ready and user is authenticated
  if (isInitializing || !authenticated) {
    return <div>Checking authentication...</div>;
  }

  return <>{children}</>;
}
```

**Why `isInitializing`**: The SDK is not ready immediately. Calling `login()` before initialization completes throws `"TideCloak client not initialized"`. Always gate on `isInitializing` before calling `login()`. See [canon/anti-patterns.md AP-28](../canon/anti-patterns.md#ap-28-calling-login-before-sdk-initialization).

All pages under `app/dashboard/` are now gated.

**Pros**: One file protects entire section
**Cons**: Shared layout means all pages share UI chrome

---

### App Router: Page-Level Guards

**When**: Protect individual pages, not entire section

```typescript
// app/profile/page.tsx
'use client';

import { useTideCloak } from '@tidecloak/nextjs';
import { useEffect } from 'react';

export default function ProfilePage() {
  const { authenticated, isInitializing, getValueFromIdToken, login } = useTideCloak();

  useEffect(() => {
    if (!isInitializing && !authenticated) {
      login();
    }
  }, [isInitializing, authenticated, login]);

  if (isInitializing || !authenticated) {
    return <div>Redirecting to login...</div>;
  }

  return (
    <div>
      <h1>Profile: {getValueFromIdToken("preferred_username")}</h1>
      {/* page content */}
    </div>
  );
}
```

**Pros**: Fine-grained control per page
**Cons**: Repeat guard logic in every protected page

---

### App Router: Reusable Guard Component

**When**: Many pages need same protection logic

Create guard component:

```typescript
// components/AuthGuard.tsx
'use client';

import { useTideCloak } from '@tidecloak/nextjs';
import { useEffect } from 'react';
import type { ReactNode } from 'react';

export function AuthGuard({ children }: { children: ReactNode }) {
  const { authenticated, isInitializing, login } = useTideCloak();

  useEffect(() => {
    if (!isInitializing && !authenticated) {
      login();
    }
  }, [isInitializing, authenticated, login]);

  if (isInitializing || !authenticated) {
    return <div>Redirecting to login...</div>;
  }

  return <>{children}</>;
}
```

Use in pages:

```typescript
// app/profile/page.tsx
import { AuthGuard } from '@/components/AuthGuard';

export default function ProfilePage() {
  return (
    <AuthGuard>
      <h1>Profile</h1>
      {/* page content */}
    </AuthGuard>
  );
}
```

**Pros**: Reusable, consistent behavior
**Cons**: Extra component wrapper

---

### Pages Router: getServerSideProps Redirect

**When**: Pages Router, want server-side redirect before render

```typescript
// pages/dashboard.tsx
import { GetServerSidePropsContext } from 'next';

export async function getServerSideProps(context: GetServerSidePropsContext) {
  // Note: This checks cookies, not Tide JWT validity
  // For real auth, verify JWT server-side
  const hasCookie = context.req.cookies['some-auth-cookie'];

  if (!hasCookie) {
    return {
      redirect: {
        destination: '/login',
        permanent: false
      }
    };
  }

  return {
    props: {}
  };
}

export default function DashboardPage() {
  return <div>Dashboard</div>;
}
```

**Warning**: This pattern checks cookie presence, not JWT validity. Not real authorization. Server-side JWT verification required for API protection.

---

### Pages Router: Client-Side Guard

```typescript
// pages/profile.tsx
import { useTideCloak } from '@tidecloak/nextjs';
import { useEffect } from 'react';

export default function ProfilePage() {
  const { authenticated, isInitializing, getValueFromIdToken, login } = useTideCloak();

  useEffect(() => {
    if (!isInitializing && !authenticated) {
      login();
    }
  }, [isInitializing, authenticated, login]);

  if (isInitializing || !authenticated) {
    return <div>Redirecting...</div>;
  }

  return <div>Profile: {getValueFromIdToken("preferred_username")}</div>;
}
```

---

## Role-Based Route Guards (UI Only)

Show/hide UI elements based on roles.

**CRITICAL**: This is UI gating only. API must verify roles server-side.

```typescript
// app/admin/page.tsx
'use client';

import { useTideCloak } from '@tidecloak/nextjs';
import { useEffect } from 'react';

export default function AdminPage() {
  const { authenticated, isInitializing, hasRealmRole, login } = useTideCloak();

  useEffect(() => {
    if (!isInitializing && !authenticated) {
      login();
    }
  }, [isInitializing, authenticated, login]);

  if (isInitializing || !authenticated) {
    return <div>Checking authentication...</div>;
  }

  // UI gating: hide admin panel if user lacks role
  if (!hasRealmRole('admin')) {
    return (
      <div>
        <h1>Access Denied</h1>
        <p>You do not have admin privileges.</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Admin Panel</h1>
      {/* admin content */}
    </div>
  );
}
```

**Attacker can bypass**: Modify client code to skip `hasRealmRole()` check. Real protection happens in API routes.

---

## Verification Checklist

### Route Protection

- [ ] Unauthenticated user redirected to Tide login
- [ ] After login, user redirected back to original URL
- [ ] Protected pages not accessible without auth
- [ ] Public pages (login, home) still accessible

### Role-Based UI

- [ ] Admin-only UI elements hidden for non-admin users
- [ ] User sees appropriate UI for their role
- [ ] No errors when user lacks expected role

### UX Quality

- [ ] No flash of protected content before redirect (loading state shown)
- [ ] Return URL preserved after login (user sent to page they requested)
- [ ] Consistent behavior across all protected routes

### Security (Negative Test — requires [protect-api-nextjs.md](protect-api-nextjs.md) completed first)

- [ ] ✅ API calls from browser DevTools return 401 without valid JWT (even if route guard bypassed)
- [ ] ✅ Disabling JavaScript and accessing protected route still protected by API-level auth
- [ ] ✅ Modifying client code to skip route guard does NOT bypass API protection

**If any security checks fail**, API protection is missing or broken. Complete [protect-api-nextjs.md](protect-api-nextjs.md) first.

---

## Common Failures

### Flash of Protected Content

**Symptom**: User briefly sees protected content before redirect to login.

**Cause**: Auth state checked after component renders.

**Fix**: Show loading state while checking auth:
```typescript
if (!authenticated) {
  return <div>Checking authentication...</div>;
}
```

---

### Infinite Redirect Loop

**Symptom**: Page redirects to login, login redirects to page, infinite loop.

**Cause**: Login page itself has auth guard.

**Fix**: Exclude login/public pages from guards:
```typescript
// Do NOT add guard to login page
// app/login/page.tsx
export default function LoginPage() {
  // No AuthGuard here
  return <div>Login</div>;
}
```

---

### Return URL Lost After Login

**Symptom**: User redirected to login, but after login sent to home instead of original page.

**Cause**: Return URL not preserved.

**Fix**: Tide SDK handles this automatically via the redirect URIs configured in TideCloak and `tidecloak.json`. Verify the redirect URI in TideCloak client settings matches the app's actual URL.

---

### Role Check Always Fails

**Symptom**: `hasRealmRole('admin')` always returns false even for admin users.

**Cause**: Role name mismatch or role not in token.

**Fix**:
```typescript
// Verify role name — decode the token to inspect claims
const { getValueFromToken } = useTideCloak();
const realmAccess = getValueFromToken("realm_access");
console.log('User roles:', realmAccess?.roles);
// Check if 'admin' is in the array

// Verify role assigned in TideCloak
// Admin Console → Users → {user} → Role Mappings
```

---

## Repair Path

If route protection broken:

1. **Verify auth works**:
   ```typescript
   // Add to protected page.
   // Note: useTideCloak() has no `user` object — read claims via
   // getValueFromIdToken / getValueFromToken.
   const { authenticated, getValueFromIdToken } = useTideCloak();
   console.log('Auth:', authenticated, 'User:', getValueFromIdToken('preferred_username'));
   // Should log: Auth: true, User: "<username>"
   ```

2. **Check provider wraps app**:
   ```bash
   # Verify TideCloakProvider in layout or _app
   grep -r "TideCloakProvider" app/layout.tsx pages/_app.tsx
   ```

3. **Test in incognito**:
   - Clear browser state may not be complete
   - Incognito ensures fresh session

4. **Verify API protection separate**:
   ```bash
   # Call protected API directly (bypass UI)
   curl http://localhost:3000/api/admin/users
   # Should return 401 even if route guard bypassed
   ```

If API returns data without JWT, route guards are meaningless. Fix API protection first.

---

## Do Not Do This

### ❌ Do Not Rely on Route Guards for Security

```typescript
// ❌ WRONG: Route guard as only protection
// app/admin/page.tsx - guarded
// app/api/admin/users/route.ts - NO JWT verification

export async function GET() {
  // Assumes only admins can reach this because route is guarded
  return Response.json({ users: [...] });
}
```

**Why**: Attacker calls API directly, bypassing route guard. No security.

**Correct**: Verify JWT in API. See [protect-api-nextjs.md](protect-api-nextjs.md).

---

### ❌ Do Not Hand-Roll a Cookie-Presence Check in proxy.ts / middleware.ts

```typescript
// ❌ WRONG: hand-written proxy/middleware that only checks a cookie exists
// proxy.ts (or middleware.ts in legacy projects)
import { NextResponse } from 'next/server';

export function middleware(req) {
  const token = req.cookies.get('token');
  if (!token) {
    return NextResponse.redirect('/login');
  }
}
```

**Why this hand-rolled version is wrong**:
1. Checks cookie presence, not JWT validity
2. No signature verification against the adapter's embedded `jwk`
3. Not real authorization

**Use the shipped helper instead.** `@tidecloak/nextjs/server` exports `createTideCloakProxy` (Next.js 16+, Node runtime) and `createTideCloakMiddleware` (Edge, legacy), which DO verify the token via `verifyTideCloakToken`:
```typescript
// proxy.ts (Next.js 16+)  — createTideCloakMiddleware for middleware.ts on ≤15
import { createTideCloakProxy } from '@tidecloak/nextjs/server';
import tcConfig from './data/tidecloak.json';

export default createTideCloakProxy(tcConfig);
export const config = { matcher: ['/dashboard/:path*', '/admin/:path*'] };
```

Even with a verifying proxy, keep server-side JWT verification inside API routes as the authoritative enforcement point (route interception governs page navigation, not direct API calls).

**Version rule**: Next.js 16+ uses `proxy.ts`. Next.js 15 and earlier use `middleware.ts`. Check the installed version before creating or looking for this file. See [canon/framework-matrix.md](../canon/framework-matrix.md#request-interception--route-protection-ui-only).

**Correct**: Client-side route guards (or `createTideCloakProxy`) for UX, server-side JWT verification for security.

---

### ❌ Do Not Mix Auth Check with Data Fetching

```typescript
// ❌ WRONG: Auth check in same component as data fetch
export default function DashboardPage() {
  const { authenticated } = useTideCloak();
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch('/api/dashboard').then(r => r.json()).then(setData);
  }, []);

  if (!authenticated) {
    return <div>Login required</div>;
  }

  return <div>{data?.message}</div>;
}
```

**Why**: API call fires before auth check completes. API receives unauthenticated request.

**Correct**: Check auth first, then fetch:
```typescript
useEffect(() => {
  if (authenticated) {
    fetch('/api/dashboard').then(r => r.json()).then(setData);
  }
}, [authenticated]);
```

Or use SDK's `secureFetch()` (if available) which adds auth headers automatically.

---

## Known Uncertainties

None specific to route protection. Inherits uncertainties from auth setup (CSP, DPoP, etc.). See [add-auth-nextjs-fresh.md Known Uncertainties](add-auth-nextjs-fresh.md#known-uncertainties).

---

## Next Steps

After route protection working:

1. [Protect APIs](protect-api-nextjs.md) - Server-side JWT verification (REQUIRED for security). **Must complete before RBAC.**
2. [Add RBAC](add-rbac-nextjs.md) - Role-based access control (depends on API protection)
3. [Diagnose broken login](diagnose-broken-login.md) - If route guards fail

---

## References

- [canon/feature-mapping.md](../canon/feature-mapping.md#protected-routes-vs-protected-apis) - Route vs API protection
- [canon/invariants.md I-08](../canon/invariants.md#i-08-ui-gating-is-not-authorization) - UI gating is not authorization
- [canon/anti-patterns.md AP-02](../canon/anti-patterns.md#ap-02-relying-on-client-side-role-checks-for-authorization) - Client-side auth mistakes
- [protect-api-nextjs.md](protect-api-nextjs.md) - Real API protection
