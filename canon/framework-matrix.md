# Tide Framework Implementation Matrix

Framework-specific implementation guidance. Organized by priority: Next.js → React → Vanilla JS.

**Rule**: Focus on reusable patterns from keylessh exemplar (LIKELY_REUSABLE_PATTERN), not app-specific SSH logic.

---

## Next.js Implementation

### Prerequisites

**Verified requirements** (tidecloak-nextjs-tutorial-quickstart.md):
- Next.js 13+ (App Router or Pages Router)
- Node.js 18+
- TideCloak instance running
- IGA enabled on realm **VERIFIED** (vendor confirmation, batch-02 Q-04). Canonical ordering: license → IGA → E2EE.

### Package Installation

```bash
npm install @tidecloak/nextjs
```

For Forseti policy-governed encryption or threshold signing, also install:
```bash
npm install @tideorg/js heimdall-tide asgard-tide
```

### SDK Package Layer Map

The Tide SDK is split across multiple packages. Each exports different classes. Importing from the wrong package causes undefined exports or runtime errors.

| Package | Key exports | Used for |
|---------|------------|----------|
| `@tidecloak/js` | `IAMService`, `TideCloak`, `Tools` (re-exports `TideMemory`), `Models` (re-exports `BaseTideRequest`, `Policy`, `ApprovalType`, `ExecutionType`, `Doken`) | Auth, admin API, context, core primitives |
| `@tidecloak/nextjs` | `TideCloakProvider`, `TideCloakContextProvider`, `useTideCloak`, `Authenticated`, `Unauthenticated`, `HasRealmRole`, `HasClientRole` | Next.js provider and hooks. Does NOT export `Models`, `PolicySignRequest`, or signing classes |
| `@tidecloak/nextjs/server` | `createTideCloakProxy`, `createTideCloakMiddleware`, `verifyTideCloakToken`, `createDpopRoute` (re-export merged 2026-10-07; check your installed version) | Server-only helpers. The proxy/middleware are NOT exported from the package root |
| `@tidecloak/react` | `TideCloakContextProvider`, `useTideCloak`, `AdminAPI` | React provider. It does NOT export `TideCloakProvider` (prefer `@tidecloak/nextjs` for Next.js) |
| `@tideorg/js` | `BaseTideRequest`, `Policy`, `TideMemory`, `Doken` | Core primitives (prefer accessing via `@tidecloak/js` re-exports to avoid ESM issues) |
| `asgard-tide` | `BasicCustomRequest`, `DynamicPayloadCustomRequest` | Building ORK signing requests. NOT in `@tidecloak/js` or `@tideorg/js` |
| `heimdall-tide` | `PolicySignRequest`, `RequestEnclave`, `ApprovalEnclave` | Policy deployment, enclave UI |

**Critical import rules**:
- `BasicCustomRequest` comes from `asgard-tide` only. Not from `@tideorg/js` or `@tidecloak/js`. VERIFIED (LEARNINGS-ratidefy-batch-001 L-11).
- `PolicySignRequest` comes from `heimdall-tide`. VERIFIED (LEARNINGS-ratidefy-batch-001 L-12).
- `Models` from `@tidecloak/nextjs` returns `undefined` at runtime. Import from `@tidecloak/js` or `@tideorg/js`.
- `secureFetch` and `getToken` must come from the `useTideCloak()` hook, NOT from static `IAMService` import. The static class is not connected to the React provider's auth state. Exception: `(IAMService as any)._tc` works for ORK signing operations. VERIFIED (LEARNINGS-ratidefy-batch-001 L-20).

See [SDK Internals](concepts.md#sdk-internals) for architecture details.

### Webpack Workarounds (Required)

> **Possibly no longer needed — DIFFERS ON `main`, not re-built.** On `tidecloak-js` `main` the
> packages write `{"type":"commonjs"}` / `{"type":"module"}` markers into their `dist` folders, the
> published `@tidecloak/react` CJS build is real CommonJS, and the vendor's own Next 16 scaffold runs
> on Turbopack with an empty `next.config.js` and plain `next dev`. That removes the stated reason for
> both fixes below. Nobody has built this pack's templates without them, so they stay until someone
> does: confirm with a build against the SDK version you install before deleting them.

Two webpack fixes are required for `@tidecloak/*` packages in Next.js:

1. **`strictExportPresence: false`** — `@tidecloak/js` has incomplete re-exports from `heimdall-tide`. Without this, webpack errors on missing re-exports. Note: the property is `config.module.strictExportPresence` (boolean), NOT `reexportExportsPresence` (which is not a valid webpack 5 property). VERIFIED (learning-batch-004, L-04).

2. **`@tidecloak/react` ESM alias** — `@tidecloak/react`'s CJS dist (`dist/cjs/index.js`) contains ESM `import` syntax. When `@tidecloak/nextjs` does `require("@tidecloak/react")`, webpack follows the CJS path and fails. Force resolution to the ESM dist. Use `path.resolve()` (not `require.resolve()` which throws `ERR_PACKAGE_PATH_NOT_EXPORTED`). Without this, the login page shows a redirect loop — the provider fails silently and auth state never initializes. VERIFIED (learning-batch-003, L-04).

```typescript
import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config) => {
    // Fix 1: @tidecloak/js incomplete re-exports — suppress strict export checking
    config.module.strictExportPresence = false;

    // Fix 2: @tidecloak/react CJS dist contains ESM syntax
    config.resolve.alias = {
      ...config.resolve.alias,
      "@tidecloak/react": path.resolve(
        __dirname,
        "node_modules/@tidecloak/react/dist/esm/index.js"
      ),
    };

    return config;
  },
};
```

**Next.js 16+**: Turbopack is the default bundler. Since this webpack config is required for `@tidecloak/*`, use `next dev --webpack` in `package.json` scripts:

```json
"scripts": {
  "dev": "next dev --webpack"
}
```

Without `--webpack`, Next.js 16 errors with "This build is using Turbopack, with a `webpack` config and no `turbopack` config."

**VERIFIED** (forseti-crypto-quickstart `next.config.ts`, Next.js 16.2.1 runtime error)

### Scaffold Command

```bash
npm init @tidecloak/nextjs@latest
```

**RESOLVED_BY_VENDOR** (GAP-005): Scaffolds Next.js app with interactive prompts for realm/client creation, IGA setup, admin user linking. Use manual setup if scaffold behavior is unclear.

---

### Client-Side Setup (App Router)

**Provider setup**:

There are two provider patterns depending on how the adapter JSON is loaded:

**Pattern A: Import config directly (recommended for Next.js)**:
```typescript
// app/providers.tsx
'use client';

import { TideCloakProvider } from '@tidecloak/nextjs';
import tcConfig from '../../data/tidecloak.json';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TideCloakProvider config={tcConfig}>
      {children}
    </TideCloakProvider>
  );
}
```

**Pattern B: Fetch config from URL** (when `tidecloak.json` is in `public/`):
```typescript
// app/providers.tsx
'use client';

import { TideCloakContextProvider } from '@tidecloak/nextjs';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TideCloakContextProvider configUrl="/tidecloak.json">
      {children}
    </TideCloakContextProvider>
  );
}
```

**Critical**: `TideCloakContextProvider` uses the `configUrl` prop, NOT `configFilePath`. The `useTideCloak()` hook returns flat properties (`authenticated`, `login`, `logout`, `secureFetch`, `getToken`, `hasRealmRole`, etc.) — NOT a `tc` wrapper object. VERIFIED (LEARNINGS-ratidefy-batch-001 L-19).

⚠️ **`secureFetch` requires an ABSOLUTE url and is not otherwise distinguishable from `fetch`.**
`secureFetch('/api/x')` throws `Failed to construct 'URL': Invalid URL` from inside the SDK before any
request — it derives the DPoP `htu` with a bare `new URL()` and no base. And bare `fetch('/api/x')` to
your own DPoP-guarded API is a silent 401. The only correct combination is `secureFetch` **with an
absolute url**, and neither failure points at it (AP-73/AP-74):

```typescript
const absoluteUrl = (path: string) => new URL(path, window.location.origin).href;
await secureFetch(absoluteUrl('/api/policy/contract'));
```

Thread `secureFetch` from the hook **into helper modules** rather than letting them call `fetch`.

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

The provider reads all config (auth-server-url, realm, resource/clientId, redirect URIs) from `data/tidecloak.json`. Do not duplicate these values into `NEXT_PUBLIC_TIDECLOAK_*` env vars.

**DPoP configuration** — ⚠️ **the two providers take different prop shapes. Do not mix them.**

| Component | From | Props |
|---|---|---|
| `TideCloakProvider` | `@tidecloak/nextjs` | **`{ config, children }` ONLY.** Init options must be folded **into `config`** |
| `TideCloakContextProvider` | `@tidecloak/react` | `config`, `configUrl`, `authMode`, `adapter` and callbacks. **No `useDPoP` or `initOptions` prop.** Options go in `config`, which is merged over the adapter fetched from `configUrl` |

```typescript
// @tidecloak/nextjs — TideCloakProvider. Its type is { config: Record<string, any>; children: ReactNode }
<TideCloakProvider config={{ ...tcConfig, useDPoP: { mode: 'strict', alg: 'ES256' } }}>

// @tidecloak/react — TideCloakContextProvider: options ALSO go inside `config`.
// It is merged over the adapter JSON fetched from configUrl.
<TideCloakContextProvider configUrl="/tidecloak.json" config={{ useDPoP: { mode: 'strict', alg: 'ES256' } }}>
```

⚠️ Passing `useDPoP` or `initOptions` as a **sibling prop** to EITHER provider **silently does
nothing** — neither type declares them, so they are ignored rather than rejected, and the app runs
with plain bearer tokens. Fold them into `config`. VERIFIED 2026-10-07 against `tidecloak-js` `main`:
`TideCloakProvider` props are `{ config, children }`; `TideCloakContextProviderProps` has no
`useDPoP` / `initOptions` (`packages/tidecloak-react/src/contexts/TideCloakContextProvider.tsx`).
An earlier revision of this file showed them as sibling props on the React provider; that left DPoP off.

**DPoP is opt-in on the client.** With no `useDPoP` in `config` the SDK issues plain bearer tokens and
says nothing. Modes are `'strict'` and `'auto'`: `strict` throws at init if the realm does not
advertise DPoP; `auto` silently runs without it. Use `strict`.

ES256 is the default and recommended algorithm. ES384, ES512 and EdDSA are also supported. DPoP is required for Tide's full security guarantees — and needs the relay page and CSP wiring in **Browser Prerequisites** below.

---

### Client-Side Auth State Access

```typescript
// app/components/UserInfo.tsx
'use client';
import { useTideCloak } from '@tidecloak/nextjs';

export function UserInfo() {
  const { authenticated, getValueFromIdToken, login, logout, hasRealmRole } = useTideCloak();

  if (!authenticated) {
    return <button onClick={login}>Login</button>;
  }

  return (
    <div>
      <p>Welcome {getValueFromIdToken('preferred_username')}</p>
      {hasRealmRole('admin') && <AdminButton />}  {/* UI gating only */}
      <button onClick={logout}>Logout</button>
    </div>
  );
}
```

**Critical**: `hasRealmRole()` and `hasClientRole()` are UI gating, NOT real authorization. The SDK hook exports `hasRealmRole(role)` for realm roles and `hasClientRole(role, client?)` for client roles. There is no generic `hasRole()` on the hook. See [Protected Routes vs Protected APIs](feature-mapping.md#protected-routes-vs-protected-apis).

---

### Server-Side JWT Verification (App Router)

**Pattern** (tidecloak-nextjs-reference.md, keylessh `server/lib/auth/tideJWT.ts`):

```typescript
// app/api/admin/users/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyTideJWT } from '@/lib/auth/tideJWT';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // With DPoP on, secureFetch sends `Authorization: DPoP <token>`, not `Bearer`. Accept both
    // schemes here, then verify the proof (see DPoP Verification below) when the token has cnf.jkt.
    const jwt = await verifyTideJWT(authHeader.replace(/^(Bearer|DPoP) /i, ''));

    // Check role
    if (!jwt.realm_access?.roles?.includes('admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Proceed with admin operation
    return NextResponse.json({ users: [...] });
  } catch (err) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }
}
```

**`verifyTideJWT()` implementation** **VERIFIED** (keylessh `server/lib/auth/tideJWT.ts`):

```typescript
// lib/auth/tideJWT.ts
import { jwtVerify, createLocalJWKSet } from 'jose';
import type { JWTPayload } from 'jose';
import { loadTideConfig } from './tidecloakConfig';

const config = loadTideConfig();
if (!config.jwk) throw new Error('Missing jwk in tidecloak.json. Re-export adapter with IGA enabled.');
const JWKS = createLocalJWKSet(config.jwk);  // Local only. Do not use createRemoteJWKSet.

export async function verifyTideJWT(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `${config['auth-server-url'].replace(/\/+$/, '')}/realms/${config.realm}`,
  });

  // TideCloak access tokens use azp (authorized party) for the client ID.
  if (payload.azp !== config.resource) {
    throw new Error('Token azp does not match client');
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw new Error('Token expired');
  }

  return payload;
}
```

**`loadTideConfig()` implementation** **VERIFIED** (keylessh `server/lib/auth/tidecloakConfig.ts`):

```typescript
// lib/auth/tidecloakConfig.ts
import { readFileSync } from 'fs';

interface TideConfig {
  realm: string;
  'auth-server-url': string;
  resource: string;
  'ssl-required': string;
  'public-client': boolean;
  'confidential-port': number;
  jwk: { keys: any[] };  // Tide extension
  vendorId: string;      // Tide extension
  homeOrkUrl: string;    // Tide extension
}

export function loadTideConfig(): TideConfig {
  // Priority: env var > file
  if (process.env.CLIENT_ADAPTER) {
    return JSON.parse(process.env.CLIENT_ADAPTER);
  }
  if (process.env.TIDECLOAK_CONFIG_B64) {
    return JSON.parse(Buffer.from(process.env.TIDECLOAK_CONFIG_B64, 'base64').toString());
  }
  return JSON.parse(readFileSync('data/tidecloak.json', 'utf-8'));
}
```

**Agent implication**:
- Use embedded JWKS from adapter JSON only. Do not use `createRemoteJWKSet`. Do not fetch from `{realm}/protocol/openid-connect/certs`. If `jwk` is missing, the realm has no Tide vendor key yet: finish `setUpTideRealm` and re-export the adapter. (I-04)
- `jwk` is present once the realm has a `tide-vendor-key` component with an EdDSA key. It is NOT gated on IGA (VERIFIED 2026-10-07, `tidecloak-idp-extensions` `VendorResource.java`). Validate at startup.
- ⚠️ **`verifyTideCloakToken` does not enforce this for you.** When `config.jwk` is absent it silently falls back to `createRemoteJWKSet(<issuer>/protocol/openid-connect/certs)`. Assert `config.jwk` yourself before calling it. It also returns `null` for a bad token AND for an infrastructure failure, and verifies the JWT only — no DPoP proof, no `cnf.jkt`. VERIFIED 2026-10-07, `tidecloak-js` `packages/tidecloak-verify/src/TideJWT.js`.

### Server-Side JWT Verification via `@tidecloak/verify`

**Alternative pattern** **VERIFIED** (keylessh exemplar):

The `@tidecloak/verify` package provides a higher-level verification function. It ships a proper dual `exports` map (`import` → ESM, `require` → CJS), so a plain named import works in both ESM and CJS callers.

```typescript
// @tidecloak/verify ships dual exports — use a plain named import
import { verifyTideCloakToken } from '@tidecloak/verify';

// config = parsed tidecloak.json adapter config
// token = raw JWT string (without "Bearer " prefix)
// allowedRoles = string[] of required realm roles (empty array to skip role check)
const payload = await verifyTideCloakToken(config, token, allowedRoles);
```

**Note**: Older docs wrapped this in a defensive `const _mod = (TideJWT as any)?.default ?? TideJWT` interop dance against a single-export build. That is no longer required — the package now ships a dual `exports` map, so the plain named import above works. Do not reintroduce the dance; if a named import genuinely fails, you are on a very old version and should upgrade.

**Express middleware using `@tidecloak/verify`:**

```typescript
import { verifyTideCloakToken } from '@tidecloak/verify';

async function authenticate(req, res, next) {
  // `Bearer <token>` or, with DPoP on, `DPoP <token>` — do not assume a 7-character prefix.
  const token = req.headers.authorization?.replace(/^(Bearer|DPoP) /i, '');
  if (!token) return res.status(401).json({ message: "No token" });

  try {
    const payload = await verifyTideCloakToken(config, token, []);
    req.user = {
      id: payload.sub,
      username: payload.preferred_username,
      email: payload.email,
      roles: payload.realm_access?.roles || [],
    };
    next();
  } catch (error) {
    res.status(401).json({ message: "Token verification failed" });
  }
}

app.use("/api/*", authenticate);
```

---

### DPoP Verification (Server-Side)

**Pattern** **VERIFIED** (keylessh `server/auth.ts`):

```typescript
// lib/auth/dpop.ts
import { jwtVerify, decodeJwt, decodeProtectedHeader } from 'jose';
import { createHash } from 'crypto';

const jtiCache = new Map<string, number>();  // jti -> expiry timestamp
const JTI_TTL_MS = 2 * 60 * 1000;  // 2 minutes

export async function verifyDPoP(
  req: Request,
  accessToken: string
): Promise<void> {
  const dpopHeader = req.headers.get('dpop');
  if (!dpopHeader) {
    throw new Error('DPoP header missing');
  }

  // `typ`, `alg` and `jwk` live in the JWS PROTECTED HEADER, not the payload. Reading them with
  // decodeJwt() (payload) makes this check throw on every proof. Use decodeProtectedHeader (jose).
  const unverified = decodeProtectedHeader(dpopHeader);
  if (unverified.typ !== 'dpop+jwt') {
    throw new Error('Invalid DPoP type');
  }
  // The SDK can sign ES256, ES384, ES512 or EdDSA.
  if (!['ES256', 'ES384', 'ES512', 'EdDSA'].includes(String(unverified.alg))) {
    throw new Error('Invalid DPoP algorithm');
  }

  // Verify signature
  const jwk = unverified.jwk as any;
  const { payload } = await jwtVerify(dpopHeader, await importJWK(jwk));

  // Verify htm and htu
  const url = new URL(req.url);
  if (payload.htm !== req.method) {
    throw new Error('DPoP htm mismatch');
  }
  if (payload.htu !== `${url.protocol}//${url.host}${url.pathname}`) {
    throw new Error('DPoP htu mismatch');
  }

  // Verify iat freshness (120s window)
  const now = Math.floor(Date.now() / 1000);
  if (!payload.iat || payload.iat < now - 120 || payload.iat > now + 120) {
    throw new Error('DPoP iat out of range');
  }

  // Verify jti not replayed
  const jti = payload.jti as string;
  if (jtiCache.has(jti)) {
    throw new Error('DPoP jti replayed');
  }
  jtiCache.set(jti, Date.now() + JTI_TTL_MS);

  // Clean expired jtis
  const expiredKeys = Array.from(jtiCache.entries())
    .filter(([_, expiry]) => expiry < Date.now())
    .map(([key, _]) => key);
  expiredKeys.forEach(key => jtiCache.delete(key));

  // Verify cnf.jkt in access token matches DPoP proof
  const tokenPayload = decodeJwt(accessToken);
  const expectedJkt = createHash('sha256').update(JSON.stringify(jwk)).digest('base64url');
  if (tokenPayload.cnf?.jkt !== expectedJkt) {
    throw new Error('DPoP jkt mismatch');
  }
}
```

**Agent implication**:
- DPoP verification is per-request; maintain in-memory `jti` cache with TTL
- DPoP is required for Tide's full security guarantees **VERIFIED** (vendor confirmation, GAP-032 resolved). ES256 default.

---

### E2EE Usage (Client-Side)

```typescript
'use client';
import { useTideCloak } from '@tidecloak/nextjs';

export function EncryptedForm() {
  const { doEncrypt, doDecrypt } = useTideCloak();

  async function handleSubmit(plaintext: string) {
    // Encrypt before sending to server
    const [ciphertext] = await doEncrypt([{ data: plaintext, tags: ['ssn'] }]);
    await fetch('/api/users', {
      method: 'POST',
      body: JSON.stringify({ ssn: ciphertext }),
    });
  }

  async function handleLoad(ciphertext: string) {
    // Decrypt after receiving from server
    const [plaintext] = await doDecrypt([{ encrypted: ciphertext, tags: ['ssn'] }]);
    console.log(plaintext);
  }

  return <form onSubmit={...}>...</form>;
}
```

**Agent implication**:
- Requires roles: `_tide_ssn.selfencrypt`, `_tide_ssn.selfdecrypt`
- Both `Uint8Array` (binary) and string inputs supported **VERIFIED** (vendor confirmation, GAP-013 resolved)
- Requires online Fabric access **VERIFIED**

---

### Silent SSO Setup

**Required file** **VERIFIED** (tidecloak-nextjs-how-to-guide.md):

```html
<!-- public/silent-check-sso.html -->
<html>
<body>
  <script>
    parent.postMessage(location.href, location.origin);
  </script>
</body>
</html>
```

**Corrupted state recovery pattern** **VERIFIED** (keylessh `client/src/contexts/AuthContext.tsx`, `main.tsx`):

```typescript
// app/layout.tsx or pages/_app.tsx
import { useEffect } from 'react';

export default function RootLayout({ children }) {
  useEffect(() => {
    // Check for corrupted auth state on startup
    const params = new URLSearchParams(window.location.search);
    if (params.get('reset') === 'true') {
      // Clear all auth state
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.includes('iam') || key.includes('auth')) {
          localStorage.removeItem(key);
        }
      });
      window.location.href = '/';
      return;
    }

    // Detect stale state: has IAM data but init failed
    const hasIamData = Object.keys(localStorage).some(k =>
      k.includes('iam') || k.includes('auth')
    );

    // If init timeout (10s) and stale data exists, offer reset
    setTimeout(() => {
      if (hasIamData && !tideCloakContext.authenticated) {
        console.warn('Stale auth state detected. Append ?reset=true to clear.');
      }
    }, 10000);
  }, []);

  return <TideCloakContextProvider>{children}</TideCloakContextProvider>;
}
```

**Agent implication**: Defensive pattern from keylessh; not SDK-provided.

---

### Browser Prerequisites — Three Files and One Config, All Required

**Before first login, all three files must exist.** Each one, omitted, fails **silently** — no error
in the console, no failed request, no clue pointing at the missing piece.

| File | Omitting it causes |
|---|---|
| `public/silent-check-sso.html` | silent SSO / token refresh fails |
| `public/tide_dpop_auth.html` | `Popup DPoP verification failed to load`; the relay 404s |
| `app/auth/redirect/page.tsx` | TideCloak redirects with `?code=…`, the app 404s, the SDK never runs, **no error appears anywhere** |

The redirect path is **`/auth/redirect`** — not `/auth/callback`, which is what almost every other
OIDC integration uses and the name an agent reaches for by default. The page must **process** the
callback with `useAuthCallback`, not merely render text, and must be gated on mount because the hook
touches `window` and throws during SSR. See [redirect-handler.md](redirect-handler.md), AP-REDIR-01/02.

#### The complete `next.config.ts` — copy this whole block

Four pieces. Three of the four are individually easy to get subtly wrong, and every wrong version
produces the *same* misleading error. This is VERIFIED against a live server (see the verification
command below), not reasoned about.

```ts
async headers() {
  return [
    {
      // I-06: frame-src '*' is required for the SWE iframe and ORK re-homing.
      // Do NOT add `frame-ancestors 'self'`. It looks like routine hardening and it BREAKS
      // the enclave, which frames your own origin for silent SSO and the approval popup.
      source: "/:path*",
      headers: [{ key: "Content-Security-Policy", value: "frame-src 'self' *" }],
    },
    {
      // MUST come AFTER the catch-all: for a given header key the later matching rule wins.
      source: "/tide_dpop/:path*",
      headers: [
        { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'unsafe-inline'" },
        { key: "Allow-CSP-From", value: "*" },
      ],
    },
  ];
},
async rewrites() {
  // WILDCARD `:path*`, not `/tide_dpop`. A static rewrite, NOT a route handler.
  return [{ source: "/tide_dpop/:path*", destination: "/tide_dpop_auth.html" }];
},
```

**1. The rewrite must be a WILDCARD.** The relay page parses `iss` and `aud` **out of its own URL
path**:

```js
const paths = new URL(window.location.href).pathname.split("/");
const iss = hexToStr(paths[paths.indexOf("iss") + 1]);
const aud = hexToStr(paths[paths.indexOf("aud") + 1]);
```

So the enclave requests `/tide_dpop/iss/<hex>/aud/<hex>/tide_dpop_auth.html`. An exact-path
`source: "/tide_dpop"` matches none of that, the URL 404s, and a 404 page cannot satisfy the
embedder's pinned-script CSP.

**2. The relay path needs `Allow-CSP-From: *`.** This is **CSP Embedded Enforcement**: the embedder
sets a `csp` attribute on the iframe, and the framed document must either deliver an at-least-as-strong
policy *or* opt in with `Allow-CSP-From`. Omitting it is precisely what refuses the frame.

**3. Static rewrite, never a route handler.** The Next dev server injects its own hash-based CSP on
route-handler responses, which blocks the relay's inline script. Static rewrites bypass that pipeline.

> **MEASURED 2026-10-07, not yet reconciled with the rule above** (Next.js 16.4.0, `@tidecloak/js`
> 0.14.34, `createDpopRoute` from `@tidecloak/js/dpop-route` in `app/tide_dpop/[...path]/route.ts`):
>
> - With **no** `next.config` header rules, the route handler served the page byte-exact with its own
>   hash-pinned CSP and `Allow-CSP-From: *`, in `next dev` and `next start`. No injected CSP appeared.
> - With the catch-all `/:path*` CSP rule this pack recommends, the served CSP was the **catch-all's**
>   (`frame-src 'self' *`): a `next.config` header rule replaces a CSP set by the handler. Excluding
>   the path from the catch-all (`source: "/((?!tide_dpop/).*)"`) restored the handler's CSP.
>
> These are served-header measurements only. **No login was run through a route handler**, so the
> rewrite stays the instruction (it is the path verified by real logins). Upstream documents the
> route handler as the supported setup from 0.14.34; switching the pack needs a live login first.

**4. Order the specific rule last.** For the same header key, the later matching rule wins — path
specificity does **not** decide it. Exactly one `Content-Security-Policy` header is sent per response.

#### Verify it — do not reason about it

Rule ordering and header merging are not reliably predictable by reading config. Read the wire:

```bash
# catch-all path -> frame-src
curl -sS -D - -o /dev/null http://localhost:3000/ | grep -i content-security-policy
# expect: Content-Security-Policy: frame-src 'self' *

# relay path -> its own CSP *and* the opt-in header
curl -sS -D - -o /dev/null \
  "http://localhost:3000/tide_dpop/iss/6161/aud/6262/tide_dpop_auth.html" \
  | grep -iE "^(HTTP|content-security-policy|allow-csp-from)"
# expect: HTTP/1.1 200 OK
#         Content-Security-Policy: default-src 'self'; script-src 'unsafe-inline'
#         Allow-CSP-From: *

# and the body must be the real relay, not a 404 page
curl -sS "http://localhost:3000/tide_dpop/iss/6161/aud/6262/tide_dpop_auth.html" | grep -c window.opener
# expect: 3   (0 means a stale relay copy — see AP-62)
```

VERIFIED on Next.js 15.3.3 and 16.3.0 against a live dev server, 2026-08-10 — but **use 16.x**:
15.3.3 carries a published advisory (CVE-2025-66478) and `npm i next@15.3.3` now prints a deprecation
warning. The pack templates pin `^16.0.0`. 16.3.0 needed no changes beyond what is already documented
here (`next dev --webpack` / `next build --webpack`, plus the two mandatory `@tidecloak/*` webpack
workarounds). Both the pack templates
and two working apps use exactly this configuration.

> **REFUTED — do not "simplify" this to one CSP for all paths.** It was reported that the catch-all
> rule always overrides the per-path one regardless of order, and that the fix was to drop the
> `/tide_dpop` entry entirely. Measured on a live server, the per-path rule **wins** when ordered last:
> `/` served `frame-src 'self' *` while `/tide_dpop/iss/…/tide_dpop_auth.html` served
> `default-src 'self'; script-src 'unsafe-inline'` **and** `Allow-CSP-From: *`, as exactly one CSP
> header. Collapsing to a single policy would also delete `Allow-CSP-From`, which is the very header
> the CSP error says is missing — so that "simplification" reintroduces the bug it is trying to avoid.
> If you see the catch-all winning, your specific rule is ordered **first**; move it last and re-read
> the header. (LEARNINGS-agent-quorum-001 L-08, refuted.)

#### Reading the failure correctly

```
Refused to display 'http://localhost:3000/' in a frame. The embedder requires it to
enforce the following Content Security Policy: 'default-src 'none'; script-src 'self'
'sha256-utc6UrebuHOyLd/2aiMXS/p1EDy9UZBDe/XEMKDw9Mc='; ...'. However, the frame neither
accepts that policy using the Allow-CSP-From header nor delivers a Content Security
Policy which is at least as strong as that one.

[Tide] TIDE-SWE-UNHANDLED — Popup DPoP verification failed to load
```

⚠️ **The `sha256-` in that error is the hash of the relay file's inline script, and it MATCHING your
copy EXONERATES the file.** It is the hash the embedder expects to find. A match means you have the
**right file at the wrong address** — look at the rewrite and the headers, not at the file. This error
sends almost everyone to hunt a stale `tide_dpop_auth.html` (a real, separate failure — AP-62/GAP-068)
and that is the wrong destination when the file is fine.

**The popup is a symptom, not a setting.** The relay runs in an **iframe** first and needs
unpartitioned IndexedDB via `document.requestStorageAccess({ indexedDB: true })`. When that path fails
— including when the iframe 404s — the SDK falls back to a **popup**, which has first-party context.
So "the popup appears every time" means *the iframe path is broken*; no CSP setting suppresses it.
Once the rewrite and headers are right, the popup should appear only when the browser genuinely blocks
third-party storage access.

**The relay URL is built on the TideCloak side and loaded by the enclave.** The Tide IdP builds
`<client origin>/tide_dpop/iss/<hex issuer>/aud/<hex client id>` from the login request's
`redirect_uri`, and the enclave appends `/tide_dpop_auth.html?version=1&openerOrigin=<enclave origin>`
(VERIFIED 2026-10-07, `tidecloak-idp-extensions` `TideIdentityProvider.java` and the ORK enclave's
`CMKOnlyEnclave.js`). `lib/tidecloak.js` itself never mentions the path, but from `@tidecloak/js`
0.14.34 the SDK ships the page and probes this URL at init when `useDPoP` is set, logging a console
error on a 404.

---

### Request Interception / Route Protection (UI Only)

Next.js 16+ uses `proxy.ts` (or `src/proxy.ts`) for request interception. Next.js 15 and earlier use `middleware.ts`. Check the project's Next.js version before choosing the filename.

**Version detection**:
```bash
# Detect Next.js major version from the installed package
NEXT_MAJOR=$(node -e "try{console.log(require('next/package.json').version.split('.')[0])}catch{console.log('unknown')}" 2>/dev/null)
# 16+ → proxy.ts | 15 or earlier → middleware.ts
```

```typescript
// proxy.ts (Next.js 16+) — called middleware.ts in Next.js 15 and earlier
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  // WARNING: This is UI gating only, NOT real authorization
  const session = req.cookies.get('SESSION_COOKIE_NAME');

  if (!session && req.nextUrl.pathname.startsWith('/admin')) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/admin/:path*',
};
```

**Critical**: Proxy/middleware route protection is UI gating. Always verify JWT server-side in API routes.

**Version rule**: Next.js 16+ uses `proxy.ts`. Next.js 15 and earlier use `middleware.ts`. Always check the project's installed Next.js version before creating or renaming this file. If migrating from `middleware.ts` to `proxy.ts`, rename the file. Next.js provides a codemod for automated migration.

**Do not confuse** `proxy.ts` (Next.js request interception at the edge) with `lib/auth/protect.ts` (Tide auth helper with `withAuth`/`withRole`). They are unrelated files with different purposes.

---

## React (Vite/CRA) Implementation

### Prerequisites

**Verified requirements** (tidecloak-react-tutorial-quickstart.md):
- React 18+
- Vite or Create React App
- TideCloak instance running
- IGA enabled on realm **VERIFIED** (vendor confirmation, batch-02 Q-04). Canonical ordering: license → IGA → E2EE.

### Package Installation

```bash
npm install @tidecloak/react
```

**INFERRED** (A-11): Package assumed on public npm registry.

---

### SDK API Reference

**`useTideCloak()` hook** **VERIFIED** (SDK documentation, operational exemplars):

```tsx
import { useTideCloak, Authenticated, Unauthenticated } from '@tidecloak/react';

const {
  authenticated,    // boolean - is user logged in
  login,            // () => void - redirect to TideCloak login
  logout,           // () => void - log out
  token,            // string - raw JWT access token
  tokenExp,         // number - token expiry timestamp
  refreshToken,     // () => Promise - refresh the token
  getValueFromToken,     // (key: string) => any - read JWT claim
  getValueFromIdToken,   // (key: string) => any - read ID token claim
  hasRealmRole,          // (role: string) => boolean
  hasClientRole,         // (role: string, client?: string) => boolean
  isInitializing,        // boolean - SDK still loading
  doEncrypt,             // E2EE encrypt
  doDecrypt,             // E2EE decrypt
  IAMService,            // direct access to IAMService
} = useTideCloak();
```

**Guard components:**

```tsx
<Authenticated>   {/* renders only when logged in */}
<Unauthenticated> {/* renders only when logged out */}
```

**Critical**: `hasRealmRole()` and `hasClientRole()` are UI gating, NOT real authorization. Server must verify JWT.

**Anti-pattern**: `tide-realm-admin` is a **client role** on the `realm-management` client, not a realm role. Use `hasClientRole("tide-realm-admin", "realm-management")`, not `hasRealmRole("tide-realm-admin")`.

**Anti-pattern**: Do not call `login()` before the SDK has initialized. Check `isInitializing` at the top of the component tree, BEFORE `<Authenticated>` / `<Unauthenticated>` guards render. See Provider Setup below.

---

### Provider Setup

**Anti-pattern**: The prop is `configUrl`, NOT `configFilePath`. Using the wrong prop falls through to the default `/adapter.json`, which does not exist, and Vite returns the HTML index page instead (`SyntaxError: Unexpected token '<'`).

```typescript
// src/main.tsx (Vite) or src/index.tsx (CRA)
import React from 'react';
import ReactDOM from 'react-dom/client';
import { TideCloakContextProvider } from '@tidecloak/react';
import App from './App';

// Config file must be in public/tidecloak.json — do NOT import as a JS module
// DPoP is OPT-IN: without useDPoP the SDK issues plain bearer tokens, silently. It goes inside
// `config` — the provider has no `useDPoP` or `initOptions` prop. There is no `enableDpop` flag.
const options = { useDPoP: { mode: 'strict', alg: 'ES256' } };

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TideCloakContextProvider
      configUrl="/tidecloak.json"
      config={options}
    >
      <App />
    </TideCloakContextProvider>
  </React.StrictMode>
);
```

**`isInitializing` guard pattern** **VERIFIED** (SDK documentation, operational exemplars):

`<Unauthenticated>` renders during initialization because the user is not yet authenticated. This exposes child components before the SDK is ready. Block the entire tree first:

```tsx
import { useTideCloak, Authenticated, Unauthenticated } from '@tidecloak/react';

function App() {
  return (
    <TideCloakContextProvider configUrl="/tidecloak.json" config={{ useDPoP: { mode: 'strict', alg: 'ES256' } }}>
      <AppContent />
    </TideCloakContextProvider>
  );
}

function AppContent() {
  const { isInitializing } = useTideCloak();
  if (isInitializing) return <p>Initializing TideCloak...</p>;
  return (
    <>
      <Authenticated><UserContent /></Authenticated>
      <Unauthenticated><LoginPage /></Unauthenticated>
    </>
  );
}
```

**Common failure**: Calling `login()` before initialization completes produces `TideCloak client not initialized - call initIAM() first`.

---

### Auth State Access

```typescript
// src/components/UserInfo.tsx
import { useTideCloak } from '@tidecloak/react';

export function UserInfo() {
  const { authenticated, getValueFromIdToken, login, logout, hasRealmRole, doEncrypt, doDecrypt } = useTideCloak();

  if (!authenticated) {
    return <button onClick={login}>Login</button>;
  }

  return (
    <div>
      <p>Welcome {getValueFromIdToken('preferred_username')}</p>
      {hasRealmRole('admin') && <AdminPanel />}  {/* UI gating only */}
      <button onClick={logout}>Logout</button>
    </div>
  );
}
```

---

### Auth Bridge Pattern (keylessh)

**Pattern** **VERIFIED** (keylessh `client/src/contexts/AuthContext.tsx`):

Syncs IAMService (Vanilla JS) state into React context for apps using both.

```typescript
// src/contexts/AuthContext.tsx
import { createContext, useContext, useEffect, useState } from 'react';
import { TideCloakContextProvider } from '@tidecloak/react';
import { IAMService } from '@tidecloak/js';

interface AuthContextType {
  authenticated: boolean;
  user: any | null;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const iam = IAMService; // singleton, direct import — do NOT call getInstance()

    // Listen to IAM events
    iam.on('tokenExpired', () => {
      setAuthenticated(false);
      setUser(null);
    });

    iam.on('authRefreshSuccess', async () => {
      const token = await iam.getToken();
      if (token) {
        setAuthenticated(true);
        setUser(await iam.getUserInfo());
      }
    });

    iam.on('authRefreshError', () => {
      setAuthenticated(false);
      setUser(null);
    });

    // Initial state
    iam.getToken().then(token => {
      if (token) {
        setAuthenticated(true);
        iam.getUserInfo().then(setUser);
      }
    });
  }, []);

  return (
    <AuthContext.Provider value={{ authenticated, user, login: iam.doLogin, logout: iam.doLogout }}>
      <TideCloakContextProvider>{children}</TideCloakContextProvider>
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext)!;
```

**Agent implication**: Bridge pattern is keylessh-specific; not SDK-prescribed. Use when integrating with existing IAMService code.

---

### Silent SSO Setup (React)

Same as Next.js:

```html
<!-- public/silent-check-sso.html -->
<html>
<body>
  <script>
    parent.postMessage(location.href, location.origin);
  </script>
</body>
</html>
```

---

### Backend Integration (Express)

**Pattern** **VERIFIED** (keylessh `server/auth.ts`, `server/index.ts`):

```typescript
// server/auth.ts
import express from 'express';
import { verifyTideJWT } from './lib/auth/tideJWT';
import { verifyDPoP } from './lib/auth/dpop';

export function requireAuth(requiredRole?: string) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    // secureFetch sends `DPoP <token>` when DPoP is on; a Bearer-only check rejects every such request.
    if (!authHeader || !/^(Bearer|DPoP) /i.test(authHeader)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.replace(/^(Bearer|DPoP) /i, '');

    try {
      // Verify DPoP if present
      if (req.headers.dpop) {
        await verifyDPoP(req, token);
      }

      // Verify JWT
      const jwt = await verifyTideJWT(token);

      // Check role if required
      if (requiredRole && !jwt.realm_access?.roles?.includes(requiredRole)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      req.user = jwt;
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  };
}

// Usage
app.get('/api/admin/users', requireAuth('admin'), (req, res) => {
  res.json({ users: [...] });
});
```

---

### CSP Configuration (React/Express)

**Required** **VERIFIED** (vendor confirmation, GAP-028 resolved):

```typescript
// server/index.ts
import helmet from 'helmet';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      frameSrc: ["'self'", '*'],
    },
  },
}));
```

`frame-src '*'` required for ORK re-homing. No fixed domain list.

---

## Vanilla JS Implementation

### Prerequisites

**Verified requirements** (tidecloak-js-tutorial.md):
- Modern browser (ES6+)
- TideCloak instance running
- IGA enabled on realm **VERIFIED** (vendor confirmation, batch-02 Q-04). Canonical ordering: license → IGA → E2EE.

### Package Installation

```bash
npm install @tidecloak/js
```

**INFERRED** (A-11): Package assumed on public npm registry.

---

### IAMService Initialization

```typescript
// src/auth.ts
import { IAMService } from '@tidecloak/js';

// IAMService is a pre-instantiated singleton — use it directly.
// Do NOT call IAMService.getInstance() — it does not exist.
const iam = IAMService;

// Pass the FULL adapter JSON from tidecloak.json, not a subset.
// Do NOT destructure into {url, realm, clientId} — initIAM reads
// "auth-server-url", "realm", "resource", "vendorId", "homeOrkUrl", etc.
const config = await fetch('/api/config').then(r => r.json());
await iam.initIAM({ ...config, useDPoP: { mode: 'strict', alg: 'ES256' } });
```

---

### Event-Driven Auth State

```typescript
// Listen to auth events
iam.on('tokenExpired', () => {
  console.log('Token expired, redirecting to login');
  iam.doLogin();   // optional string returnUrl; the redirect URI comes from config.redirectUri
});

iam.on('authRefreshSuccess', async () => {
  console.log('Token refreshed');
  const user = await iam.getUserInfo();
  updateUI(user);
});

iam.on('authRefreshError', (error) => {
  console.error('Refresh failed', error);
  iam.doLogin();   // optional string returnUrl; the redirect URI comes from config.redirectUri
});
```

**Agent implication**: Error handling from keylessh pattern **VERIFIED** (keylessh `AuthContext.tsx`).

---

### Login / Logout

`doLogin(returnUrl?: string)` takes an optional return path, not an options object, and `doLogout()`
takes nothing. The redirect URI is `config.redirectUri`, defaulting to `<origin>/auth/redirect`.
`IAMService` has **no `getUserInfo()`** on `tidecloak-js` `main`; examples in this file that call it
predate that — read identity from the token claims instead. VERIFIED 2026-10-07,
`packages/tidecloak-js/src/IAMService.js`.

```typescript
// Login
document.getElementById('login-btn').addEventListener('click', () => {
  iam.doLogin();   // optional string returnUrl; the redirect URI comes from config.redirectUri
});

// Logout
document.getElementById('logout-btn').addEventListener('click', () => {
  iam.doLogout();  // takes no arguments
});
```

---

### Role Checks (UI Gating Only)

```typescript
const hasAdminRole = iam.hasRealmRole('admin');

if (hasAdminRole) {
  document.getElementById('admin-panel').style.display = 'block';
} else {
  document.getElementById('admin-panel').style.display = 'none';
}
```

**Critical**: This is UI gating, NOT authorization. Server must verify JWT.

---

### Secure API Calls

```typescript
// Using secureFetch (SDK-provided DPoP-aware fetch)
const response = await iam.secureFetch('/api/admin/users', {
  method: 'GET',
  headers: {
    'Content-Type': 'application/json',
  },
});

const users = await response.json();
```

**Agent implication**: `secureFetch()` automatically adds `Authorization` and `DPoP` headers.

---

### E2EE (Vanilla JS)

```typescript
// Encrypt
const plaintext = 'sensitive data';
const [ciphertext] = await iam.doEncrypt([{ data: plaintext, tags: ['ssn'] }]);

// Send to server
await iam.secureFetch('/api/users', {
  method: 'POST',
  body: JSON.stringify({ ssn: ciphertext }),
});

// Decrypt
const response = await iam.secureFetch('/api/users/123');
const data = await response.json();
const [plaintext] = await iam.doDecrypt([{ encrypted: data.ssn, tags: ['ssn'] }]);
```

---

### Silent SSO Setup (Vanilla JS)

Same file as React/Next.js:

```html
<!-- public/silent-check-sso.html -->
<html>
<body>
  <script>
    parent.postMessage(location.href, location.origin);
  </script>
</body>
</html>
```

---

## Framework Comparison Matrix

| Feature | Next.js | React | Vanilla JS | Notes |
|---------|---------|-------|------------|-------|
| **Package** | `@tidecloak/nextjs` | `@tidecloak/react` | `@tidecloak/js` | INFERRED (A-11) |
| **Provider** | `<TideCloakContextProvider>` | `<TideCloakContextProvider>` | `IAMService` (singleton, direct import) | VERIFIED |
| **Auth state** | `useTideCloak()` hook | `useTideCloak()` hook | Event listeners | VERIFIED |
| **Login/Logout** | Hook methods | Hook methods | `doLogin()` / `doLogout()` | VERIFIED |
| **E2EE** | Hook methods | Hook methods | `doEncrypt()` / `doDecrypt()` | VERIFIED |
| **Server-side JWT** | API routes | Express middleware | N/A (client-only) | VERIFIED (keylessh) |
| **DPoP verification** | API routes | Express middleware | N/A (client-only) | VERIFIED (keylessh) |
| **CSP setup** | `next.config.js` headers | Express `helmet()` | HTML meta tag | VERIFIED (keylessh) |
| **Silent SSO** | `public/silent-check-sso.html` | `public/silent-check-sso.html` | `public/silent-check-sso.html` | VERIFIED |
| **Route protection** | Middleware (UI only) | React Router guards (UI only) | Manual checks (UI only) | VERIFIED |
| **API protection** | `verifyTideJWT()` in routes | `requireAuth()` middleware | Server-side separate | VERIFIED (keylessh) |

---

## Common Patterns Across Frameworks

### Adapter JSON Loading

All frameworks need server-side config:

```typescript
// Priority: env var > file
function loadTideConfig() {
  if (process.env.CLIENT_ADAPTER) {
    return JSON.parse(process.env.CLIENT_ADAPTER);
  }
  if (process.env.TIDECLOAK_CONFIG_B64) {
    return JSON.parse(Buffer.from(process.env.TIDECLOAK_CONFIG_B64, 'base64').toString());
  }
  return JSON.parse(fs.readFileSync('data/tidecloak.json', 'utf-8'));
}
```

**VERIFIED** (keylessh `tidecloakConfig.ts`, bridge configs).

---

### Token Extraction (Server-Side)

```typescript
function extractToken(req: Request): string {
  const authHeader = req.headers.get('authorization') || req.headers.authorization;
  // `Bearer <token>`, or `DPoP <token>` when the client has DPoP on (secureFetch sends the latter).
  const m = /^(Bearer|DPoP) (.+)$/i.exec(authHeader ?? '');
  if (!m) {
    throw new Error('Missing or invalid Authorization header');
  }
  return m[2];
}
```

---

### Required Realm Roles

All frameworks require user has `_tide_enabled` role **VERIFIED** (vendor confirmation, GAP-031 resolved). Declare `_tide_enabled` in the realm.json template — `setUpTideRealm` does not create it automatically.

---

## Framework-Specific Gaps

### Next.js

- Scaffold command behavior **RESOLVED_BY_VENDOR** (GAP-005)
- App Router vs Pages Router differences undocumented **ASSUMED**
- Middleware CSP enforcement vs `next.config.js` headers unclear **ASSUMED**

### React

- CRA vs Vite configuration differences undocumented **ASSUMED**
- Auth bridge pattern (IAMService + React Context) not SDK-prescribed **VERIFIED** (keylessh pattern)

### Vanilla JS

- No server-side patterns (pure client library)
- Module bundler compatibility (Webpack, Rollup, Vite) undocumented **ASSUMED**

---

## Post-Auth Redirect Handler

Every Tide-enabled app must have a working page at its configured `redirectUri`. See [canon/redirect-handler.md](redirect-handler.md) for full doctrine.

| Framework | Default path | Handler location |
|-----------|-------------|-----------------|
| Vanilla JS / Vite | `/auth/redirect` | `public/auth/redirect.html` (must include SDK script) |
| React SPA | `/auth/redirect` | Route component or SPA fallback |
| Next.js App Router | `/auth/redirect` | `app/auth/redirect/page.tsx` |
| Next.js Pages Router | `/auth/redirect` | `pages/auth/redirect.tsx` |

---

## .NET / ASP.NET Core (via asgard)

ASP.NET Core APIs integrate with TideCloak through the **Tide.Asgard.AspNetCore** SDK rather than stock `Microsoft.AspNetCore.Authentication.OpenIdConnect`. The asgard SDK supplies the EdDSA `SignatureProvider` (Microsoft.IdentityModel.Tokens does not ship EdDSA) and an OAuth 2.0 Token Exchange client tuned for Tidecloak.

Out of scope for the current pack priority (Next.js > React > Vanilla per [AGENTS.md](../AGENTS.md)). This section exists so an agent asked about C# / ASP.NET Core routes the work to the right playbook instead of inventing OIDC wiring.

### Packages

| Package | Source | Purpose | Status |
|---------|--------|---------|--------|
| `Tide.Asgard.AspNetCore.Authentication` (v0.1.0) | `github.com/tide-foundation/asgard` — consume via `<ProjectReference>` until NuGet publication is verified | JWT bearer wiring, Ed25519 issuer-key extraction (`Utils.GetEd25519IssuerKey`), Token Exchange client (`AddTokenExchange`, `ITokenExchangeService`) | VERIFIED |
| `Tide.Asgard.Core` (v0.1.0) | Same repo | EdDSA `SignatureProvider` / `SecurityKey` on top of `Microsoft.IdentityModel.Tokens 8.15.0` and `BouncyCastle.Cryptography 2.6.2` | VERIFIED |
| `Tide.Asgard.AspNetCore.DPoP` | Same repo, no `<PackageId>` | DPoP proof-validation primitives. Validator is implemented (~540 lines), but `.WithDPoP(...)` registration is commented out at HEAD | OBSERVED_PATTERN |

### Wiring (canonical form)

Use the README form, not the Example's `Program.cs` — the Example has the `IssuerSigningKey` line commented out:

```csharp
builder.Services.AddKeycloakWebApiAuthentication(builder.Configuration, options =>
{
    options.RequireHttpsMetadata = false;
    options.TokenValidationParameters.IssuerSigningKey =
        Utils.GetEd25519IssuerKey(builder.Configuration);
});

builder.Services.AddTokenExchange(builder.Configuration); // optional, RFC 8693
```

`appsettings.json` must put the backend client's adapter config under a section literally named `Keycloak` — the section name is hardcoded in `Keycloak.AuthServices` and in `AddTokenExchange(IConfiguration)`.

### What the SDK does NOT do

- **Policy / contract signing or testing.** The TypeScript `asgard-tide` npm package (different artifact, same repo) handles wire-format models. There is no C# equivalent in the .NET SDK.
- **Forseti contract enforcement.** Forseti contracts run as C# inside the ORK sandbox, not in your .NET API. See [custom-contracts.md](custom-contracts.md).
- **Browser DPoP** is plumbed but not active. `useDPoP` on the SPA crashes Token Exchange (the DPoP path throws `NotImplementedException`).

### Full procedure

See [playbooks/protect-aspnet-core-asgard.md](../playbooks/protect-aspnet-core-asgard.md).

### Status note

PUC-092, PUC-093, PUC-094, PUC-095 in `notes/pack-update-candidates.md` planned ASP.NET Core docs around stock OpenIdConnect middleware. The asgard SDK supersedes those plans for the JWT-validation and token-exchange paths. The playbook references that supersession explicitly.

---

## Key Dependencies

> **Resolve versions at build time** — `npm view <pkg> version`. The numbers below are a 2026-08-06 snapshot; if npm is unreachable, default to `0.14.17`, and never install below it. Match the SDK version to the TideCloak server version. See `canon/version-policy.md`.

| Package | Stable version | Purpose |
|---------|---------------|---------|
| `@tidecloak/js` | 0.14.17 | Core SDK (vanilla JS) |
| `@tidecloak/react` | 0.14.17 | React hooks and guards |
| `@tidecloak/nextjs` | 0.14.17 | Next.js provider and hooks |
| `@tidecloak/verify` | 0.14.17 | Server-side JWT verification (CJS) |
| `heimdall-tide` | 0.14.17 | Policy signing, BasicCustomRequest |
| `@tideorg/js` | 0.14.17 | Models, Contracts (Forseti) |
| `asgard-tide` | 0.14.17 | Vendor validation |
| `Tide.Asgard.AspNetCore.Authentication` (.NET) | 0.1.0 | ASP.NET Core JWT bearer + Token Exchange. NuGet publication unverified — consume via `<ProjectReference>` from `github.com/tide-foundation/asgard`. See [.NET / ASP.NET Core](#net--aspnet-core-via-asgard). |
| `Tide.Asgard.Core` (.NET) | 0.1.0 | EdDSA `SignatureProvider` for `Microsoft.IdentityModel.Tokens`. Same repo, same caveat. |

All Tide packages are pre-1.0. Pin to exact versions in templates. See [canon/version-policy.md](version-policy.md) for the full version policy.

---

## Status Legend

- **VERIFIED** - Directly sourced from documentation or keylessh exemplar
- **INFERRED** - Strongly implied by source material
- **ASSUMED** - Operator guidance where sources are silent
- **REQUIRES_RUNTIME_VALIDATION** - Single-app evidence; needs confirmation
- **STILL_UNRESOLVED** - Open gap
