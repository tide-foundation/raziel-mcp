# Verify JWT Server-Side (Complete Implementation)

Complete guide to implementing server-side JWT verification for Tide.

---

## When to Use

- Implementing API authentication
- Need complete JWT verification code
- Want production-ready implementation
- Referenced by other playbooks

---

## Prerequisites

- Adapter JSON exported from TideCloak
- Adapter JSON has `jwk` field (required for Tide's JWT verification model)
- Node.js project (Next.js or Express)

---

## Recommended First: the Shipped `verifyTideCloakToken` Helper

Before hand-rolling anything, know that Tide ships a one-call verifier. `@tidecloak/verify` exports `verifyTideCloakToken`, re-exported via `@tidecloak/nextjs/server`:

```typescript
import { verifyTideCloakToken } from '@tidecloak/nextjs/server'; // or '@tidecloak/verify'
import tcConfig from '../data/tidecloak.json';

// Arg order: (config, token, allowedRoles=[]) — config FIRST.
const payload = await verifyTideCloakToken(tcConfig, token, ['admin']);
// payload = decoded claims on success, `false` on any failure.
```

It does local-JWKS signature verification (embedded `jwk`), issuer + `azp` validation, time-claim checks with `clockTolerance`, and optional role enforcement across realm and client roles. For the majority of API-protection needs this is all you require — see [protect-api-nextjs.md](protect-api-nextjs.md).

The complete manual implementation below is the **"under the hood" alternative**. Reach for it when you need something `verifyTideCloakToken` does not do: app-side DPoP proof re-verification, distinct 401 vs 403 responses, `iat` future-dating rejection, or an Express integration.

---

## Complete Implementation (Manual)

If you already created `lib/auth/tidecloakConfig.ts`, `lib/auth/tideJWT.ts`, and `lib/auth/protect.ts` from [protect-api-nextjs.md](protect-api-nextjs.md), the versions below **replace** them. This playbook adds DPoP verification, client-role checking in `hasRole`, `extractToken` (supports both Bearer and DPoP schemes), and `iat` future-validation.

### Step 1: Install Dependencies

```bash
npm install jose
```

`jose` library: industry-standard JWT verification.

---

### Step 2: Adapter JSON Loader

```typescript
// lib/auth/tidecloakConfig.ts
import { readFileSync } from 'fs';
import { join } from 'path';

export interface TidecloakConfig {
  realm: string;
  'auth-server-url': string;
  'ssl-required': string;
  resource: string;
  'public-client': boolean;
  'confidential-port': number;
  jwk: { keys: any[] };  // Required: Embedded JWKS for local verification
  vendorId?: string;
  homeOrkUrl?: string;
}

export function loadTideConfig(): TidecloakConfig {
  // Priority: env var > file
  if (process.env.CLIENT_ADAPTER) {
    return JSON.parse(process.env.CLIENT_ADAPTER);
  }

  const configPath = join(process.cwd(), 'data', 'tidecloak.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));

  if (!config.jwk) {
    throw new Error(
      'Adapter JSON missing jwk field. ' +
      'This field is required for Tide JWT verification. ' +
      'Export via Tide-specific endpoint (providerId=keycloak-oidc-keycloak-json), not generic Keycloak adapter.'
    );
  }

  return config;
}
```

---

### Step 3: JWT Verification

```typescript
// lib/auth/tideJWT.ts
import { jwtVerify, createLocalJWKSet } from 'jose';
import type { JWTPayload, JWTVerifyOptions } from 'jose';
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
      throw new Error(
        'Adapter JSON missing jwk field. ' +
        'This field is required for Tide JWT verification. ' +
        'Export via Tide-specific endpoint (providerId=keycloak-oidc-keycloak-json), not generic Keycloak adapter.'
      );
    }
    _jwks = createLocalJWKSet(_config.jwk);
  }
  return { config: _config, JWKS: _jwks! };
}

export async function verifyTideJWT(token: string): Promise<JWTPayload> {
  const { config, JWKS } = getConfig();
  const options: JWTVerifyOptions = {
    issuer: `${config['auth-server-url'].replace(/\/+$/, '')}/realms/${config.realm}`,
  };

  const { payload } = await jwtVerify(token, JWKS, options);

  // TideCloak access tokens use azp (authorized party) for the client ID.
  // The aud claim typically contains "account", not the client ID.
  if (payload.azp !== config.resource) {
    throw new Error('Token azp does not match client');
  }

  const now = Math.floor(Date.now() / 1000);

  if (payload.exp && payload.exp < now) {
    throw new Error('Token expired');
  }

  if (payload.iat && payload.iat > now + 60) {
    throw new Error('Token issued in future');
  }

  return payload;
}

export function hasRole(payload: JWTPayload, role: string): boolean {
  // Check realm roles
  const realmRoles = (payload.realm_access as any)?.roles || [];
  if (realmRoles.includes(role)) {
    return true;
  }

  // Check client roles
  const resourceAccess = payload.resource_access as any;
  if (resourceAccess) {
    for (const client of Object.values(resourceAccess)) {
      const clientRoles = (client as any)?.roles || [];
      if (clientRoles.includes(role)) {
        return true;
      }
    }
  }

  return false;
}

export function extractToken(authHeader: string | null): string {
  if (!authHeader) {
    throw new Error('Missing Authorization header');
  }

  if (authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  if (authHeader.startsWith('DPoP ')) {
    return authHeader.substring(5);
  }

  throw new Error('Invalid Authorization header format');
}
```

---

### Step 4: DPoP Verification (Optional Defense-in-Depth)

**Caveat: App-side DPoP proof re-verification is incompatible with `secureFetch`.** When the client uses `IAMService.secureFetch` from `@tidecloak/js`, the DPoP proofs it sends are in a Tide-specific format, not standard RFC 9449 compact JWS. Calling `jwtVerify()` on the `dpop` header fails with `401: Invalid Compact JWS`. DPoP binding is already enforced at TideCloak during token issuance — the `cnf.jkt` claim in the JWT proves the token was DPoP-bound. **JWT signature verification via embedded JWKS (VVK) is the primary security layer.** VERIFIED (LEARNINGS-batch-005 L-06).

**If your app uses `secureFetch`**: Skip this step. The `withAuth` middleware from Step 5 should check for `cnf.jkt` presence (proving DPoP binding at issuance) but should NOT attempt to re-verify the DPoP proof itself. Remove or disable the `verifyDPoP()` call in `withAuth`.

**If your app uses manual DPoP (not `secureFetch`)**: The verification below applies. When the `TideCloakProvider` has `useDPoP={{ mode: 'strict', alg: 'ES256' }}`, TideCloak binds access tokens with a `cnf.jkt` claim.

```typescript
// lib/auth/dpop.ts
import { jwtVerify, decodeJwt, importJWK } from 'jose';
import { createHash } from 'crypto';

const jtiCache = new Map<string, number>();
const JTI_TTL_MS = 2 * 60 * 1000;  // 2 minutes

export async function verifyDPoP(
  req: { method: string; url: string; headers: Headers },
  accessToken: string
): Promise<void> {
  const dpopHeader = req.headers.get('dpop');
  if (!dpopHeader) {
    throw new Error('DPoP header missing');
  }

  // Parse the DPoP proof header (not the access token)
  const parts = dpopHeader.split('.');
  if (parts.length !== 3) throw new Error('Invalid DPoP JWT structure');

  const headerJson = JSON.parse(
    Buffer.from(parts[0], 'base64url').toString()
  );

  // Validate typ and alg from the DPoP proof header
  if (headerJson.typ !== 'dpop+jwt') {
    throw new Error('Invalid DPoP type');
  }

  const supportedAlgs = ['ES256', 'EdDSA'];
  if (!supportedAlgs.includes(headerJson.alg)) {
    throw new Error(`Unsupported DPoP algorithm: ${headerJson.alg}`);
  }

  // Must have jwk in proof header
  const jwk = headerJson.jwk;
  if (!jwk) throw new Error('Missing jwk in DPoP header');

  // Verify signature using the embedded public key
  const publicKey = await importJWK(jwk, headerJson.alg);
  const { payload } = await jwtVerify(dpopHeader, publicKey);

  // Verify htm (HTTP method)
  if (payload.htm !== req.method) {
    throw new Error('DPoP htm mismatch');
  }

  // Verify htu (HTTP URI, no query string)
  const url = new URL(req.url);
  const expectedHtu = `${url.protocol}//${url.host}${url.pathname}`;
  if (payload.htu !== expectedHtu) {
    throw new Error('DPoP htu mismatch');
  }

  // Verify iat freshness (120s window)
  const now = Math.floor(Date.now() / 1000);
  const iat = payload.iat as number;
  if (iat < now - 120 || iat > now + 120) {
    throw new Error('DPoP iat out of range');
  }

  // Verify jti not replayed
  const jti = payload.jti as string;
  if (!jti || jtiCache.has(jti)) {
    throw new Error('DPoP jti missing or replayed');
  }
  jtiCache.set(jti, Date.now() + JTI_TTL_MS);

  // Purge expired jtis periodically
  if (jtiCache.size > 1000) {
    const cutoff = Date.now();
    jtiCache.forEach((expiry, key) => {
      if (expiry < cutoff) jtiCache.delete(key);
    });
  }

  // Verify cnf.jkt binding: access token's cnf.jkt must match
  // the JWK Thumbprint (RFC 7638) of the DPoP proof's public key
  const tokenPayload = decodeJwt(accessToken);
  const expectedJkt = computeJwkThumbprint(jwk);

  if ((tokenPayload.cnf as any)?.jkt !== expectedJkt) {
    throw new Error('DPoP cnf.jkt mismatch — token not bound to this key');
  }
}

/**
 * Compute JWK Thumbprint per RFC 7638.
 * Uses canonical JSON with alphabetically sorted required members only.
 */
function computeJwkThumbprint(jwk: any): string {
  let canonical: string;
  if (jwk.kty === 'EC') {
    canonical = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}","y":"${jwk.y}"}`;
  } else if (jwk.kty === 'OKP') {
    canonical = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}"}`;
  } else if (jwk.kty === 'RSA') {
    canonical = `{"e":"${jwk.e}","kty":"${jwk.kty}","n":"${jwk.n}"}`;
  } else {
    throw new Error(`Unsupported key type for JWK thumbprint: ${jwk.kty}`);
  }
  return createHash('sha256').update(canonical).digest('base64url');
}
```

---

### Step 5: Middleware (Next.js App Router)

```typescript
// lib/auth/protect.ts
import { NextRequest } from 'next/server';
import { verifyTideJWT, hasRole, extractToken } from './tideJWT';
import { verifyDPoP } from './dpop';
import type { JWTPayload } from 'jose';

type AuthHandler = (req: NextRequest, jwt: JWTPayload) => Promise<Response>;

export function withAuth(handler: AuthHandler) {
  return async (req: NextRequest) => {
    const authHeader = req.headers.get('authorization');

    try {
      const token = extractToken(authHeader);
      const jwt = await verifyTideJWT(token);

      // DPoP binding check: if cnf.jkt is present, TideCloak bound
      // this token with DPoP at issuance. This proves the token was
      // DPoP-bound — no further proof verification is needed when
      // using secureFetch (its proofs are Tide-specific, not RFC 9449).
      //
      // If you use manual DPoP (not secureFetch), uncomment the
      // verifyDPoP call below to also verify the proof.
      //
      // const cnfJkt = (jwt as any).cnf?.jkt;
      // if (cnfJkt) {
      //   if (!req.headers.get('dpop')) {
      //     return Response.json(
      //       { error: 'DPoP proof required for DPoP-bound token' },
      //       { status: 401 }
      //     );
      //   }
      //   await verifyDPoP(req, token);
      // }

      return handler(req, jwt);
    } catch (err) {
      console.error('Auth failed:', err);
      return Response.json(
        { error: err instanceof Error ? err.message : 'Unauthorized' },
        { status: 401 }
      );
    }
  };
}

export function withRole(role: string, handler: AuthHandler) {
  return withAuth(async (req, jwt) => {
    if (!hasRole(jwt, role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    return handler(req, jwt);
  });
}
```

---

### Step 6: Express Middleware

```typescript
// server/auth.ts (Express)
import express from 'express';
import { verifyTideJWT, hasRole, extractToken } from './lib/auth/tideJWT';
import { verifyDPoP } from './lib/auth/dpop';

export async function authenticate(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const authHeader = req.headers.authorization;

  try {
    const token = extractToken(authHeader ?? null);
    const jwt = await verifyTideJWT(token);

    // DPoP enforcement: if token has cnf.jkt, it is DPoP-bound.
    // Server must verify the DPoP proof. Without proof, reject.
    const cnfJkt = (jwt as any).cnf?.jkt;
    if (cnfJkt) {
      if (!req.headers.dpop) {
        return res.status(401).json({ error: 'DPoP proof required for DPoP-bound token' });
      }
      await verifyDPoP(req as any, token);
    }

    req.user = jwt;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

export function requireRole(role: string) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.user || !hasRole(req.user, role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

// Usage
app.get('/api/admin/users', authenticate, requireRole('admin'), (req, res) => {
  res.json({ users: [...] });
});
```

---

## Verification Checklist

- [ ] Valid JWT verified successfully
- [ ] Expired JWT rejected
- [ ] Malformed JWT rejected
- [ ] Wrong issuer rejected
- [ ] Wrong audience rejected
- [ ] Role check works
- [ ] DPoP-bound token (has `cnf.jkt`) without DPoP proof header is rejected (401)
- [ ] DPoP-bound token with valid DPoP proof is accepted
- [ ] DPoP proof with wrong `htm` (method) is rejected
- [ ] DPoP proof with wrong `htu` (URL) is rejected
- [ ] Replayed DPoP `jti` is rejected

---

## Common Failures

See [canon/troubleshooting.md T-02](../canon/troubleshooting.md#t-02-jwt-verification-fails-401-unauthorized).

---

## Known Uncertainties

None. All critical requirements documented above.

---

## References

- [protect-api-nextjs.md](protect-api-nextjs.md) - API protection guide
- [canon/invariants.md I-03, I-04](../canon/invariants.md) - JWT verification rules
- keylessh: `server/lib/auth/tideJWT.ts`, `server/auth.ts` (DC-01, DC-02)
