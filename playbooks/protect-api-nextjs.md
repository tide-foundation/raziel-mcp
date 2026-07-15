# Protect API Routes in Next.js (Server-Side JWT Verification)

Implement real authorization using server-side JWT verification.

**CRITICAL**: This is where actual security enforcement happens. Route guards are UI only. APIs must verify JWTs.

---

## When to Use

- Protecting API routes that return sensitive data
- Enforcing authorization before data mutations
- Verifying user identity server-side
- Enforcing role-based access control

**Always use** for any API that requires authentication.

---

## Prerequisites

- Tide authentication installed ([add-auth-nextjs-fresh.md](add-auth-nextjs-fresh.md))
- Adapter JSON with `jwk` field (present when IGA is enabled on the realm)
- API routes to protect (App Router: `app/api/*/route.ts`, Pages Router: `pages/api/*.ts`)

---

## Security Model

### Tide JWT Verification

1. Extract JWT from `Authorization` header
2. Verify signature using **embedded JWKS from adapter JSON** (not remote endpoint)
3. Validate `iss` (issuer), `azp` (authorized party), `exp`, `iat`
4. Extract roles from `realm_access.roles` and `resource_access`
5. Enforce role requirements

**Required**: Tide adapter JSON includes the `jwk` field with embedded JWKS. This enables local JWT verification without network calls. The embedded JWKS is present due to Tide's non-rotating vendor-verifiable key (VVK) model, which locks the system to trust one pre-defined public key, preventing token forgery even if the IAM is compromised.

---

## Files to Create

1. `lib/auth/tidecloakConfig.ts` - Load adapter JSON
2. `lib/auth/tideJWT.ts` - JWT verification logic
3. `lib/auth/protect.ts` - Reusable auth middleware (optional)
4. Update API routes with auth checks

See [verify-jwt-server-side.md](verify-jwt-server-side.md) for complete implementation.

---

## Diagnose Existing API Routes

If you already have API routes and need to check whether they are correctly protected, run through this checklist:

```bash
# 1. Does it read from Authorization header (not cookies)?
grep -r "headers.*authorization\|Authorization" app/api/ --include="*.ts"
# FAIL if: reads from cookies, session, or has no auth check at all

# 2. Does it verify JWT with embedded JWKS (not remote endpoint)?
grep -r "createLocalJWKSet\|verifyTideJWT\|jwtVerify" lib/auth/ --include="*.ts"
# FAIL if: uses createRemoteJWKSet (forbidden), dictionary lookup, or no verification

# 3. Does it validate issuer and audience?
grep -r "issuer\|audience" lib/auth/ --include="*.ts"
# FAIL if: no issuer/audience check in verification options

# 4. Does it enforce roles after verification?
grep -r "hasRole\|withRole\|realm_access" app/api/ lib/auth/ --include="*.ts"
# FAIL if: returns data without any role check after JWT is verified
```

Any FAIL means the API route is not properly protected. Use the implementation below to fix it.

---

## Recommended: Use the Shipped `verifyTideCloakToken` Helper

Tide ships a server-side verification helper — you do not have to hand-roll JWKS verification. `@tidecloak/nextjs/server` re-exports `verifyTideCloakToken` from `@tidecloak/verify`:

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
  const token = authHeader.replace(/^(Bearer|DPoP) /, '');

  // Signature (arg order): verifyTideCloakToken(config, token, allowedRoles=[])
  // config is FIRST. Pass roles to enforce them; [] to just verify the token.
  const payload = await verifyTideCloakToken(tcConfig, token, ['admin']);
  if (!payload) {
    // Returns false on any failure (bad signature, issuer, azp, expiry, or role).
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  return Response.json({ users: [...] });
}
```

`verifyTideCloakToken`:
- verifies the signature against the adapter's embedded `jwk` (local JWKS — no network call),
- validates the issuer (`auth-server-url` + `/realms/<realm>`) and `azp` (against `config.resource`),
- checks time claims with a small `clockTolerance`,
- optionally enforces `allowedRoles` (matches across `realm_access.roles` and `resource_access[client].roles`),
- returns the decoded payload on success, `false` on failure.

Prefer this for standard API protection. The manual `jose` implementation below is the **under-the-hood alternative** — use it when you need custom behavior the helper does not cover (e.g. app-side DPoP proof re-verification, separate 401-vs-403 semantics, or `iat` future-validation). See [verify-jwt-server-side.md](verify-jwt-server-side.md).

---

## Quick Implementation — Manual (App Router)

This section creates minimal versions of `lib/auth/tidecloakConfig.ts`, `lib/auth/tideJWT.ts`, and `lib/auth/protect.ts`. If you also follow [verify-jwt-server-side.md](verify-jwt-server-side.md), its richer versions **replace** these files (adds DPoP verification, client-role checking, `extractToken`, and `iat` validation).

### Step 0: Install Dependencies

```bash
npm install jose
```

---

### Step 1: Load Adapter JSON

```typescript
// lib/auth/tidecloakConfig.ts
import { readFileSync } from 'fs';
import { join } from 'path';

export interface TidecloakConfig {
  realm: string;
  'auth-server-url': string;
  resource: string;
  jwk: { keys: any[] };  // Tide extension: embedded JWKS for local JWT verification
  vendorId?: string;
  homeOrkUrl?: string;
}

export function loadTideConfig(): TidecloakConfig {
  // Priority: env var > file
  if (process.env.CLIENT_ADAPTER) {
    return JSON.parse(process.env.CLIENT_ADAPTER);
  }

  const configPath = join(process.cwd(), 'data', 'tidecloak.json');
  return JSON.parse(readFileSync(configPath, 'utf-8'));
}
```

---

### Step 2: Create JWT Verification

```typescript
// lib/auth/tideJWT.ts
import { jwtVerify, createLocalJWKSet } from 'jose';
import type { JWTPayload } from 'jose';
import { loadTideConfig } from './tidecloakConfig';

// Lazy initialization — do NOT load config at module level.
// Next.js 16 evaluates module-level code during `next build` for static
// page generation. If tidecloak.json doesn't exist yet (placeholder or
// pre-bootstrap), eager loading throws at build time.
let _jwks: ReturnType<typeof createLocalJWKSet> | null = null;
let _config: ReturnType<typeof loadTideConfig> | null = null;

function getConfig() {
  if (!_config) {
    _config = loadTideConfig();
    if (!_config.jwk) {
      throw new Error('Adapter JSON missing jwk field');
    }
    _jwks = createLocalJWKSet(_config.jwk);
  }
  return { config: _config, JWKS: _jwks! };
}

export async function verifyTideJWT(token: string): Promise<JWTPayload> {
  const { config, JWKS } = getConfig();
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `${config['auth-server-url'].replace(/\/+$/, '')}/realms/${config.realm}`,
  });

  // TideCloak access tokens use azp (authorized party) for the client ID.
  // The aud claim typically contains "account", not the client ID.
  if (payload.azp !== config.resource) {
    throw new Error('Token azp does not match client');
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw new Error('Token expired');
  }

  return payload;
}

export function hasRole(payload: JWTPayload, role: string): boolean {
  const realmRoles = (payload.realm_access as any)?.roles || [];
  return realmRoles.includes(role);
}
```

**Install dependency**:
```bash
npm install jose
```

---

### Step 3: Protect API Route

```typescript
// app/api/users/route.ts
import { NextRequest } from 'next/server';
import { verifyTideJWT, hasRole } from '@/lib/auth/tideJWT';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Accept both Bearer and DPoP schemes.
  // When useDPoP is enabled, secureFetch upgrades Bearer to DPoP.
  let token: string;
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (authHeader.startsWith('DPoP ')) {
    token = authHeader.substring(5);
  } else {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const jwt = await verifyTideJWT(token);

    // Optional: Enforce role
    if (!hasRole(jwt, 'admin')) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Proceed with protected operation
    return Response.json({ users: [...] });
  } catch (err) {
    console.error('JWT verification failed:', err);
    return Response.json({ error: 'Invalid token' }, { status: 401 });
  }
}
```

---

## Reusable Middleware Pattern

Create middleware for consistent auth:

```typescript
// lib/auth/protect.ts
import { NextRequest } from 'next/server';
import { verifyTideJWT, hasRole } from './tideJWT';
import type { JWTPayload } from 'jose';

type AuthenticatedHandler = (
  req: NextRequest,
  jwt: JWTPayload
) => Promise<Response>;

export function withAuth(handler: AuthenticatedHandler) {
  return async (req: NextRequest) => {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Accept both Bearer and DPoP schemes.
    // When useDPoP is enabled, secureFetch upgrades Bearer to DPoP.
    let token: string;
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (authHeader.startsWith('DPoP ')) {
      token = authHeader.substring(5);
    } else {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
      const jwt = await verifyTideJWT(token);
      return handler(req, jwt);
    } catch (err) {
      return Response.json({ error: 'Invalid token' }, { status: 401 });
    }
  };
}

export function withRole(role: string, handler: AuthenticatedHandler) {
  return withAuth(async (req, jwt) => {
    if (!hasRole(jwt, role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    return handler(req, jwt);
  });
}
```

**Use in routes**:

```typescript
// app/api/admin/users/route.ts
import { withRole } from '@/lib/auth/protect';

export const GET = withRole('admin', async (req, jwt) => {
  return Response.json({ users: [...] });
});

export const POST = withRole('admin', async (req, jwt) => {
  const body = await req.json();
  // Create user
  return Response.json({ success: true });
});
```

---

## Pages Router (pages/api)

```typescript
// pages/api/users.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyTideJWT, hasRole } from '@/lib/auth/tideJWT';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Accept both Bearer and DPoP schemes
  let token: string;
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (authHeader.startsWith('DPoP ')) {
    token = authHeader.substring(5);
  } else {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const jwt = await verifyTideJWT(token);

    if (!hasRole(jwt, 'admin')) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json({ users: [...] });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}
```

---

## DPoP Verification (Required When useDPoP Is Configured)

**Required for Tide's full security guarantees**: DPoP (Demonstration of Proof-of-Possession) prevents session hijacking and provides phishing-resistant authentication.

When `useDPoP` is configured on the client-side `TideCloakProvider`, the access token contains a `cnf.jkt` claim binding it to the DPoP key. The server **must** verify the DPoP proof for these tokens. A DPoP-bound token sent without a valid proof is a stolen or replayed token — reject it with 401.

See [verify-jwt-server-side.md DPoP section](verify-jwt-server-side.md#step-4-dpop-verification-required-for-full-security) for complete implementation.

---

## Verification Checklist

### API Protection

- [ ] Unauthenticated request returns 401
- [ ] Invalid JWT returns 401
- [ ] Expired JWT returns 401
- [ ] Valid JWT returns 200
- [ ] Wrong role returns 403
- [ ] Correct role returns 200

### Server-Side Tests

```bash
# Test without token
curl http://localhost:3000/api/users
# Should return 401

# Test with valid token (get from browser DevTools)
TOKEN="eyJ..."
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/users
# Should return 200 + data

# Test with malformed token
curl -H "Authorization: Bearer invalid" http://localhost:3000/api/users
# Should return 401
```

---

## Common Failures

### "Adapter JSON missing jwk field"

**Cause**: Using generic Keycloak adapter instead of Tide adapter.

**Fix**: Re-export adapter via Tide-specific endpoint using `providerId=keycloak-oidc-keycloak-json`. The `jwk` field is present when IGA is enabled on the realm. If absent, verify IGA is enabled and re-export. See [add-auth-nextjs-fresh.md Step 2](add-auth-nextjs-fresh.md#step-2-export-adapter-json-from-tidecloak).

---

### JWT Verification Always Fails

**Cause**: Wrong JWKS source or issuer mismatch.

**Fix**: See [canon/troubleshooting.md T-02](../canon/troubleshooting.md#t-02-jwt-verification-fails-401-unauthorized).

---

### Role Check Always Fails

**Fix**: See [diagnose-missing-roles-or-claims.md](diagnose-missing-roles-or-claims.md).

---

## Do Not Do This

### ❌ Do Not Use Remote JWKS Endpoint

```typescript
// ❌ WRONG: Fetch JWKS from remote endpoint (forbidden)
const JWKS = createRemoteJWKSet(
  new URL(`${issuer}/protocol/openid-connect/certs`)
);

// ❌ ALSO WRONG: Remote as fallback
try { await jwtVerify(token, localJWKS); }
catch { await jwtVerify(token, createRemoteJWKSet(certsUrl)); }
```

**Why**: Tide JWTs must be verified against embedded JWKS from adapter JSON only. `createRemoteJWKSet` is forbidden. If `jwk` is missing, fix the adapter export — do not add remote fallback. See [canon/invariants.md I-04](../canon/invariants.md#i-04) and [canon/anti-patterns.md AP-01](../canon/anti-patterns.md#ap-01-treating-tide-as-generic-oidc).

---

### ❌ Do Not Skip JWT Verification

```typescript
// ❌ WRONG: Trust client-side auth state
export async function GET(req) {
  // Assumes route guard blocked unauthenticated users
  return Response.json({ sensitiveData: [...] });
}
```

**Why**: Route guards can be bypassed. See [canon/invariants.md I-03](../canon/invariants.md#i-03-server-side-jwt-verification-required).

---

## Known Uncertainties

None. All critical requirements documented above.

---

## Next Steps

1. [Add RBAC](add-rbac-nextjs.md) - Implement role hierarchies
2. [Verify JWT server-side](verify-jwt-server-side.md) - Complete JWT verification guide
3. [Diagnose missing roles](diagnose-missing-roles-or-claims.md) - Fix role issues

---

## References

- [verify-jwt-server-side.md](verify-jwt-server-side.md) - Complete implementation
- [canon/invariants.md I-03, I-04](../canon/invariants.md) - JWT verification rules
- [canon/anti-patterns.md AP-01, AP-02](../canon/anti-patterns.md) - Auth mistakes
- keylessh: `server/lib/auth/tideJWT.ts` (DC-01)
