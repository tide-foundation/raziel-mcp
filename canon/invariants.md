# Tide Security and Operational Invariants

Rules that must never be violated in Tide implementations. Each invariant includes verification steps and consequences of violation.

**Critical**: These are not recommendations. They are requirements for Tide's security properties to hold.

---

## I-01: Never-Whole-Key Invariant

**Rule**: Cryptographic keys never exist in complete form at any point in their lifecycle, except during Ragnarok (Fabric offboarding). **VERIFIED** (whitepaper tier1-article3, Architecture.md)

**What this means**:
- Do not generate keys locally
- Do not request complete keys from Fabric
- Do not assemble key shards
- Do not store complete keys
- Do not export complete keys

**Sole exception**: Ragnarok deliberately reconstructs keys for offboarding. This is a one-way, quorum-approved, irreversible operation.

**Verification**:
```bash
# Check codebase for key generation
grep -r "generateKey\|crypto.subtle.generateKey\|keygen" src/
# Should find ZERO local key generation for Tide operations

# Check for key assembly
grep -r "assembleShards\|combineKeys\|reconstructKey" src/
# Should find ZERO except in Ragnarok-specific code
```

**Consequence of violation**: Single point of compromise. Attacker gaining access to assembled key can forge tokens, decrypt data, bypass all threshold enforcement.

**Related invariants**: I-02 (Threshold), I-09 (No Single Bypass)

---

## I-02: Threshold Enforcement

**Rule**: All cryptographic operations require T or more ORK participation. No operation succeeds with fewer than threshold ORKs. **VERIFIED** (tier1-article2, Threat-model.md)

**What this means**:
- Authentication (PRISM) requires T+ ORKs to verify password
- JWT signing (VVK) requires T+ ORK partial signatures
- E2EE decryption requires T+ ORKs to threshold-decrypt session key
- IGA approval sealing requires T+ ORK partial signatures
- Forseti policy enforcement requires majority of ORKs to approve

**Threshold is deployment-configurable** **VERIFIED** (keylessh `start.sh`):
- Mainnet: T=14 of N=20
- Test: T=3 of N=5
- Custom: Set via `TIDE_VENDOR_THRESHOLD_SIGNING` / `TIDE_VENDOR_THRESHOLD_TOTAL`

**Do not hardcode 14/20**.

**Verification**:
```bash
# Check environment configuration
echo $TIDE_VENDOR_THRESHOLD_SIGNING
echo $TIDE_VENDOR_THRESHOLD_TOTAL

# Check adapter JSON does not hardcode threshold
jq '.threshold // "not hardcoded"' data/tidecloak.json
```

**Consequence of violation**: Compromising fewer than T ORKs allows attacker to forge tokens, decrypt data, or bypass policy.

**Related invariants**: I-01 (Never-Whole-Key), I-09 (No Single Bypass)

---

## I-03: Server-Side JWT Verification Required

**Rule**: Protected APIs must verify JWT signature and claims server-side. Client-side role checks are UI gating only, not authorization. **VERIFIED** (keylessh `tideJWT.ts`)

**What this means**:
- Do not rely on client-side `hasRealmRole()` / `hasClientRole()` for API authorization
- Do not trust client-side auth state
- Do not skip JWT verification because "the client already checked"
- Do verify signature, issuer, audience, expiration, issued-at, roles server-side

**Server-side verification pattern** **VERIFIED** (keylessh `server/lib/auth/tideJWT.ts`):
```typescript
import { jwtVerify, createLocalJWKSet } from 'jose';
import { loadTideConfig } from './tidecloakConfig';

const config = loadTideConfig();
const JWKS = createLocalJWKSet(config.jwk);  // Embedded JWKS

export async function verifyTideJWT(token: string) {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `${config['auth-server-url'].replace(/\/+$/, '')}/realms/${config.realm}`,
  });

  // TideCloak access tokens use azp (authorized party) for the client ID.
  // The aud claim contains "account", not the client ID.
  if (payload.azp !== config.resource) throw new Error('Token azp mismatch');

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) throw new Error('Token expired');
  if (payload.iat > now + 60) throw new Error('Token issued in future');

  return payload;
}

// Usage in API route
app.get('/api/admin/users', async (req, res) => {
  const jwt = await verifyTideJWT(extractToken(req));
  if (!jwt.realm_access.roles.includes('admin')) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  // Proceed
});
```

**Verification**:
```bash
# Check API routes verify JWT
grep -A 10 "app\.get\|app\.post\|export async function GET" server/ | grep "verifyJWT\|jwtVerify"
# Every protected route should include verification

# Check routes do NOT rely solely on middleware auth
grep -r "hasRole\|checkRole" server/routes/ | grep -v "after verifyJWT"
# Role checks must come AFTER JWT verification, not instead of
```

**Consequence of violation**: Attacker can call protected APIs by bypassing client-side checks. No server-side enforcement = no authorization.

**Related invariants**: I-04 (Embedded JWKS), I-08 (UI Gating Not Authorization)

---

## I-04: Embedded JWKS Verification (Local-Only)

**Rule**: JWT verification must use embedded JWKS from adapter JSON. Do not use `createRemoteJWKSet`. Do not fetch keys from the remote OIDC certs endpoint. If the `jwk` field is missing from `tidecloak.json`, this is a setup/bootstrap failure — stop and fix the export, do not fall back to remote key fetching.

**What this means**:
- Adapter JSON contains `jwk: { keys: JWK[] }` field (EdDSA public key). It is emitted whenever the realm has a Tide vendor key; it is NOT gated on IGA being enabled.
- Use `createLocalJWKSet(config.jwk)` from `jose`
- If `config.jwk` is missing, throw an error. The fix is to re-export the adapter from TideCloak with IGA enabled, not to fetch keys remotely.
- Also validate `azp` matches `config.resource`

**Why**: Embedded JWKS avoids network dependency. Remote JWKS fetching weakens the security model by introducing a network path that could be intercepted or spoofed. Missing `jwk` means IGA is not enabled or the adapter was exported incorrectly — both are configuration problems that must be fixed at the source. DPoP proof verification is separate — per RFC 9449, the proof is verified against the ephemeral `jwk` in its own header (no JWKS endpoint involved).

**Forbidden**: `createRemoteJWKSet` must not be used in Tide verification flows. Do not add it as a fallback. Do not import it. If verification fails with `ERR_JWKS_NO_MATCHING_KEY`, the adapter JSON is stale — re-export it from TideCloak.

**Note on the shipped `@tidecloak/verify`**: the packaged `verifyTideCloakToken` DOES fall back to `createRemoteJWKSet` when `config.jwk` is absent (`tidecloak-js: packages/tidecloak-verify/src/TideJWT.js`). That fallback is exactly the network path this invariant forbids. Therefore the operative rule for Tide apps is: **always pass `config.jwk` so verification uses the local JWKS; never let it fall through to the remote path.** A missing `jwk` is a setup failure to fix at the source, not a code path to rely on. This is intentional security doctrine — the pack is deliberately stricter than the SDK default.

**Required pattern**:
```typescript
import { createLocalJWKSet, jwtVerify } from 'jose';
import { loadTideConfig } from './tidecloakConfig';

const config = loadTideConfig();
if (!config.jwk) {
  throw new Error(
    'Missing jwk in tidecloak.json. Re-export adapter from TideCloak with IGA enabled.'
  );
}
const JWKS = createLocalJWKSet(config.jwk);

export async function verifyTideJWT(token: string) {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `${config['auth-server-url'].replace(/\/+$/, '')}/realms/${config.realm}`,
  });
  if (payload.azp !== config.resource) throw new Error('Token azp mismatch');
  return payload;
}
```

**Verification**:
```bash
# Check adapter JSON has jwk field
jq '.jwk.keys | length' data/tidecloak.json
# Should output number of keys (>= 1)

# Check code uses local JWKS only (no remote)
grep -r "createLocalJWKSet\|config.jwk" lib/auth/ src/lib/auth/
# Should find local JWKS usage

# Check code does NOT use remote JWKS
grep -r "createRemoteJWKSet" lib/auth/ src/lib/auth/
# Should find ZERO matches
```

**Consequence of violation**: `createRemoteJWKSet` introduces a network dependency and a potential interception point. Missing `jwk` is a setup problem — remote fetching masks it instead of fixing it.

**Related invariants**: I-03 (Server-Side Verification), I-05 (Adapter JSON Required)

**Note**: The `jwk` field is present whenever the realm has a Tide vendor key (it is not gated on IGA). Validate at startup. If missing, the fix is TideCloak bootstrap / re-exporting the adapter, not remote JWKS.

---

## I-05: Adapter JSON Configuration Required

**Rule**: Adapter JSON with Tide extensions (`jwk`, `vendorId`, `homeOrkUrl`) must be present and loaded at the correct location. **VERIFIED** (keylessh `tidecloakConfig.ts`)

**Canonical filename**: `tidecloak.json`. Do not use `adapter.json`, `keycloak.json`, or other names.

**What this means**:
- Export adapter JSON from TideCloak via the realm-level endpoint `GET /admin/realms/{realm}/vendorResources/get-installations-provider?clientId={clientId}&providerId=keycloak-oidc-keycloak-json`. The client is a **query parameter** (`clientId=`), NOT a `/clients/{id}/` path segment. `keycloak-oidc-keycloak-json` is the only valid provider ID (`tidecloak-oidc-keycloak-json` does not exist).
- Store at the correct location for the framework (see below)
- Load at startup
- Validate presence of Tide extensions

**Framework-specific locations**:

| Framework | Location | Why |
|-----------|----------|-----|
| Next.js (server-side) | `data/tidecloak.json` | Read from filesystem by `loadTideConfig()` at server startup. Not publicly exposed. Client-side SDK gets config via `configUrl="/api/config"` API route. |
| React/Vite SPA | `public/tidecloak.json` | Served as static asset. SDK loads via `configUrl="/tidecloak.json"`. |
| Vanilla JS | `public/tidecloak.json` | Same as React/Vite — served as static asset via dev server. |
| Any (env var) | `CLIENT_ADAPTER` or `TIDECLOAK_CONFIG_B64` | Override for containerized or CI deployment. Takes priority over file. |

**Loading priority for server-side** (Next.js, Express) **VERIFIED** (keylessh `tidecloakConfig.ts`):
1. `process.env.CLIENT_ADAPTER` (JSON string)
2. `process.env.TIDECLOAK_CONFIG_B64` (base64-encoded JSON)
3. `data/tidecloak.json` (file)

**Loading for client-side SDK** (`TideCloakContextProvider`):
- The SDK fetches adapter JSON from the `configUrl` prop. **Default is `/adapter.json`** — this will 404 unless you set `configUrl` explicitly.
- The prop is `configUrl`, NOT `configFilePath`. Wrong prop falls through to the default `/adapter.json`.
- **Next.js**: Config is in `data/tidecloak.json` (server-side, not in `public/`). Create an API route at `app/api/config/route.ts` that calls `loadTideConfig()` and returns the JSON. Set `configUrl="/api/config"` on the provider.
- **React/Vite**: Config is in `public/tidecloak.json`. Set `configUrl="/tidecloak.json"` on the provider.

**Required fields**:
- Standard Keycloak: `realm`, `auth-server-url`, `resource`, `ssl-required`, `public-client`, `confidential-port`
- Tide extensions: `jwk`, `vendorId`, `homeOrkUrl`

**Verification**:
```bash
# Check adapter JSON exists (check both possible locations)
test -f data/tidecloak.json && echo "Found at data/" || echo "Not in data/"
test -f public/tidecloak.json && echo "Found at public/" || echo "Not in public/"

# Check for wrong filenames
ls data/adapter.json data/keycloak.json public/adapter.json public/keycloak.json 2>/dev/null && echo "WRONG FILENAME — rename to tidecloak.json"

# Validate Tide extensions present (adjust path as needed)
jq 'has("jwk") and has("vendorId") and has("homeOrkUrl")' data/tidecloak.json
# Should output: true
```

**Consequence of violation**: Server cannot verify JWTs (missing `jwk`). Client cannot connect to Fabric (missing `homeOrkUrl`). Licensing may fail (missing `vendorId`). Wrong filename or wrong location causes silent load failure.

**Related invariants**: I-04 (Embedded JWKS)

---

## I-06: CSP Whitelist for SWE Iframe

**Rule**: Content-Security-Policy must include `frame-src '*'` for SWE iframe. Without it, SWE iframe silently fails. **VERIFIED** (vendor confirmation, GAP-028 resolved)

**Required CSP directive**:
```
frame-src 'self' *
```

**Why `frame-src '*'`**: Users can re-home their SWE session to any ORK they trust. There is no fixed domain list. The vendor confirmed `frame-src '*'` is required for ORK re-homing.

**Additional CSP for E2EE / ORK enclaves**: When using E2EE operations (`doEncrypt`/`doDecrypt`), the ORK enclave iframe also requires `connect-src` (for ORK fetch) and `script-src 'unsafe-inline'` (for ORK enclave scripts). For environments with strict CSP (e.g., Electron apps, custom CSP headers), ensure all three directives allow ORK domains:
- `frame-src: 'self' *` (or `https://*.tideprotocol.com`)
- `connect-src: 'self' https://*.tideprotocol.com` (if restricting connect-src)
- `script-src: 'unsafe-inline'` (on the enclave route only, via `next.config.ts` `headers()`)

For standard Next.js apps with the default permissive CSP (`frame-src 'self' *`), the ORK iframe works without additional changes. This matters primarily for apps with custom restrictive CSP policies. VERIFIED (TIDE_LEARNINGS-001 L-17).

**Failure symptom**: Login hangs, E2EE operations timeout, no visible errors. Check browser console for CSP violations: `Refused to frame 'https://...' because it violates the following Content Security Policy directive: "frame-src 'self'"`.

**Implementation examples**:

Next.js (`next.config.js`):
```javascript
module.exports = {
  async headers() {
    return [{
      source: '/:path*',
      headers: [{
        key: 'Content-Security-Policy',
        value: "frame-src 'self' *"
      }]
    }]
  }
}
```

Express (via helmet):
```typescript
import helmet from 'helmet';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      frameSrc: ["'self'", '*']
    }
  }
}));
```

**Verification**:
```bash
# Check response headers
curl -I https://app.example.com | grep -i content-security-policy

# Should include frame-src 'self' *
```

**Consequence of violation**: SWE iframe cannot load. All Tide cryptographic operations fail. Login hangs indefinitely. E2EE encrypt/decrypt timeout.

**Related invariants**: I-07 (Silent SSO File Required)

---

## I-07: Silent SSO File Required

**Rule**: Static file `public/silent-check-sso.html` must exist for silent token refresh. **VERIFIED** (SDK how-to guides, keylessh)

**File content** **VERIFIED**:
```html
<html>
<body>
  <script>
    parent.postMessage(location.href, location.origin);
  </script>
</body>
</html>
```

**Why**: OIDC silent refresh uses hidden iframe. TideCloak redirects to this file, which posts message back to parent window with updated auth state.

**Failure symptom**: Silent refresh fails. User forced to full re-login on token expiration. Session appears to expire prematurely.

**Verification**:
```bash
# Check file exists
test -f public/silent-check-sso.html && echo "Exists" || echo "Missing"

# Check file is publicly accessible
curl https://app.example.com/silent-check-sso.html
# Should return HTML with postMessage script
```

**Consequence of violation**: Silent token refresh fails. User experience degraded; frequent forced re-logins. Not a security issue, but operational failure.

**Related invariants**: I-06 (CSP Whitelist)

---

## I-08: UI Gating Is Not Authorization

**Rule**: Client-side role checks (`hasRealmRole()`, `hasClientRole()`, route guards, conditional rendering) are UI convenience only. They are NOT authorization. **VERIFIED** (AGENTS.md, CLAUDE.md)

**What this means**:
- The SDK hook exports `hasRealmRole(role)` and `hasClientRole(role, client?)`. There is no generic `hasRole()` on the hook.
- `hasRealmRole()` checks `realm_access.roles`. `hasClientRole()` checks `resource_access.{client}.roles`.
- These are for show/hide buttons, render different components — not authorization.
- Route middleware is for redirecting unauthenticated users to login.
- Neither protects APIs; both are easily bypassed.
- Real authorization happens server-side via JWT verification (I-03).

**Example of violation**:
```typescript
// WRONG: API relies on client-side role check
app.get('/api/admin/users', (req, res) => {
  // Assumes client already checked role
  return res.json({ users: [...] });
});
```

**Correct pattern**:
```typescript
// CORRECT: Server verifies JWT and role
app.get('/api/admin/users', async (req, res) => {
  const jwt = await verifyTideJWT(extractToken(req));
  if (!jwt.realm_access.roles.includes('admin')) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return res.json({ users: [...] });
});
```

**Verification**:
```bash
# Check API routes do NOT trust client
grep -r "hasRole\|checkRole" server/routes/ | grep -v "verifyJWT"
# Should find ZERO API routes that check roles without verifying JWT first

# Check client-side role checks are UI-only
grep -r "hasRole" src/components/ | grep -v "button\|render\|display"
# Client-side role checks should only affect UI, not security decisions
```

**Consequence of violation**: Attacker can bypass client-side checks and call protected APIs directly. No real authorization = no security.

**Related invariants**: I-03 (Server-Side Verification)

---

## I-09: No Single Point of Bypass

**Rule**: No single admin, server, ORK node, or process can bypass Tide's threshold enforcement. **VERIFIED** (tier1-article2, Threat-model.md, IGA.mdx)

**What this means**:
- Compromising TideCloak server does not allow token forgery (VVK signing is threshold across ORKs)
- Compromising one admin does not allow unauthorized changes (IGA requires quorum)
- Compromising one ORK does not allow key extraction or policy bypass (threshold T required)
- Compromising application server does not allow data decryption (E2EE session keys are threshold-decrypted by Fabric)

**Security assumption**: System remains secure if fewer than 30% of ORKs compromised (honest minority). On mainnet: <7 of 20 ORKs. **VERIFIED** (Threat-model.md)

**Verification**:
```bash
# Check no local key generation (I-01)
grep -r "generateKey\|keygen" src/ server/

# Check no admin bypass in IGA workflow
grep -r "bypassIGA\|skipApproval\|adminOverride" server/

# Check JWT verification does not have admin bypass
grep -r "if.*admin.*skip.*verify" server/
```

**Consequence of violation**: Single point of compromise defeats all Tide security properties. Threshold enforcement collapses to single-party trust.

**Related invariants**: I-01 (Never-Whole-Key), I-02 (Threshold), I-10 (IGA Quorum)

---

## I-10: IGA Quorum Enforcement

**Rule**: Admin changes to roles, users, clients require quorum approval sealed by VVK threshold signatures. No single admin can act unilaterally. **VERIFIED** (IGA.mdx, SetupIGA.md, keylessh `init-tidecloak.sh`)

**Quorum formula**: `max(1, floor(TotalAdmins * 0.7))` **VERIFIED** (SetupIGA.md). This is the cryptographic quorum in **Tide mode** (`iga.attestor=tide`). In **Tideless mode** (`iga.attestor=simple`/unset) the same quorum count is enforced by TideCloak server logic with a username attestation and no cryptography — see `canon/security-gap-mapping.md` IGA-model note.

> **⚠️ API SURFACE MIGRATION — confirmed by Tide 2026-07-07 (GAP-065).** The change-request endpoints have moved to **`/admin/realms/{realm}/iga/change-requests/...`** (iga-core), which **replaces** the legacy `/tide-admin/change-set/...` paths below. New surface: approve `POST .../iga/change-requests/{id}/authorize` (409 = four-eyes re-sign), commit `POST .../iga/change-requests/{id}/commit` (412 = quorum unmet), reject `POST .../{id}/deny`, batch `POST /iga/change-requests/bulk-authorize`, list `GET /iga/change-requests?status=PENDING`, Tide-mode enclave step `POST .../{id}/approval-model`. Enabling IGA is unchanged (`POST /tide-admin/toggle-iga`). **Full endpoint spec, payloads, and the bootstrap approve/commit loop: `canon/iga-change-requests-api.md`.** Bootstrap scripts and the examples below now use the new surface; verify against the live instance (bootstrap loop is REQUIRES_RUNTIME_VALIDATION).

**Change-request workflow** (legacy surface — see migration banner) **VERIFIED for legacy** (CHANGE_REQUEST_API.md):
1. Create: Admin action triggers draft creation automatically
2. Approve: legacy `POST .../tide-admin/change-set/sign/batch` → new `POST .../iga/change-requests/{id}/authorize` (MultiAdmin/Tide mode returns enclave challenge)
3. Commit: legacy `POST .../tide-admin/change-set/commit/batch` → new `POST .../iga/change-requests/{id}/commit`

**What this means**:
- Single admin cannot create, modify, or delete users
- Single admin cannot assign or revoke roles
- Single admin cannot modify clients or realm settings
- All changes enter approval queue (DRAFT → PENDING → APPROVED → ACTIVE)
- Quorum of admins must approve
- Approved changes sealed by threshold signatures
- After commit, token refresh required for roles to propagate (up to 120s)

**Enable IGA** **VERIFIED** (all exemplar init scripts):
```bash
curl -X POST "${TIDECLOAK_URL}/admin/realms/${REALM}/tide-admin/toggle-iga" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}"
```

**Verification**:
```bash
# Check IGA is enabled
curl "${TIDECLOAK_URL}/admin/realms/${REALM}" | jq '.igaEnabled'
# Should output: true

# Attempt admin change without approval
curl -X POST "${TIDECLOAK_URL}/admin/realms/${REALM}/users" -d '{...}'
# Should return 202 (captured as a change request), not immediate user creation

# Check pending change requests (current /iga/ surface — see canon/iga-change-requests-api.md)
curl "${TIDECLOAK_URL}/admin/realms/${REALM}/iga/change-requests?status=PENDING" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" | jq '.[].id'
# Should list pending change request ids
```

**Consequence of violation**: Single compromised admin can create backdoor accounts, grant unauthorized roles, bypass all governance. IGA enforcement collapses to single-admin trust.

**Related invariants**: I-09 (No Single Bypass)

Change requests carry a cryptographic expiry enforced by the Tide enclave; after the window, signing is rejected, and there is no automatic DB cleanup (stale drafts persist until cancelled). Note: `2628000s` (~1 month) is the VRK rotation period (`vrkRotationPeriodSeconds`, `ork` TaskConstants), NOT a per-change-request expiry constant — do not conflate the two. The exact CR expiry is enclave-side and was not confirmed as a hardcoded value in the extension repos on main.

---

## I-11: E2EE Requires Online Fabric Access

**Rule**: Hermetic E2EE decryption requires live Fabric threshold participation. No offline decryption. No server-side decryption. **VERIFIED** (hermetic-e2ee.md, tier2-protocol-hermetic-e2ee.mdx)

**What this means**:
- `doDecrypt()` sends request to Fabric ORKs
- Fabric threshold-decrypts session key
- Plaintext recovered client-side only
- No caching of decrypted session keys
- No offline fallback

**Why**: Session keys are encrypted via CVK threshold. Decryption requires T+ ORKs to participate. No single party (client, server, or ORK) can decrypt alone.

**Verification**:
```bash
# Check no local session key cache
grep -r "cacheSessionKey\|storeSessionKey" src/ client/
# Should find ZERO session key caching

# Check E2EE calls do not have offline fallback
grep -r "doDecrypt" src/ | grep -i "offline\|fallback\|cache"
# Should find ZERO offline decrypt fallback
```

**Consequence of violation**: Offline decryption requires storing session keys locally, defeating threshold enforcement. Server-side decryption requires exposing plaintext to server, defeating E2EE.

**Related invariants**: I-02 (Threshold), I-09 (No Single Bypass)

No application-level max payload size **VERIFIED** (vendor confirmation, GAP-013 resolved). Hybrid scheme: <32 bytes ElGamal, >=32 bytes AES-256-GCM + ElGamal. Practical ceiling ~28.6 MB (Kestrel default). Ciphertext is a TideMemory-serialized envelope (SerializedField v1), base64 when string input, raw `Uint8Array` when binary input. Overhead ~157B (small) / ~217B (large) before base64. Format versioned (v1), stable. **VERIFIED** (vendor confirmation, batch-02 Q-05, A-28 resolved).

---

## I-12: DPoP Token Binding (Bidirectional Lockstep)

**Rule**: DPoP is **ENABLED and ENFORCED by default** in the TideCloak SDK. `useDPoP` defaults to `{ mode: 'strict' }` in `IAMService` — it is opt-OUT, not opt-in. Disabling it requires setting `useDPoP: false` (or `{ mode: 'auto' }`) explicitly, and in strict mode init fails if the realm does not advertise DPoP support. **VERIFIED** (`tidecloak-js: packages/tidecloak-js/src/IAMService.js` — "DPoP is enabled and ENFORCED by default across all TideCloak SDKs").

**Server/client must agree (lockstep)**:
- **Server-side** (realm template): `"dpop.bound.access.tokens": "true"` on the OIDC client, and the realm must advertise `dpop_signing_alg_values_supported`. Because the client defaults to strict, a realm that does not advertise DPoP makes SDK init fail.
- **Client-side** (provider config): the SDK default is `useDPoP: { mode: 'strict', alg: 'ES256' }`. To weaken/disable, set `useDPoP` explicitly. `useDPoP` goes inside the config object, NOT as a JSX prop on the provider. VERIFIED (session-002).
  - Server off, client left at default strict → init fails ("server does not advertise DPoP support"). Set `useDPoP: false` or enable DPoP on the realm.
  - Server on, client set to `false` → proofs not generated; token endpoint returns 400 "DPoP proof is missing".

**`tide_dpop_auth.html` required** (when DPoP is enabled):
- Copy `tide_dpop_auth.html` to `public/`. This file is loaded by the Tide enclave during login to prove DPoP key possession to the ORKs. **Do not modify it** — its content is integrity-checked.
- The SDK requests `/tide_dpop/iss/<hex-issuer>/aud/<hex-client>/tide_dpop_auth.html`. This path does not map to the static file, so you must rewrite it.
- **Use `next.config.ts` `rewrites()` to map `/tide_dpop/:path*` → `/tide_dpop_auth.html`**. Set CSP via `headers()` config targeting the `/tide_dpop/:path*` source: `script-src 'unsafe-inline'` and `Allow-CSP-From: *`.
- **Do NOT use a route handler** (`app/tide_dpop/[...path]/route.ts`). Next.js 16 dev server injects its own hash-based CSP on route handler responses, overriding the `script-src 'unsafe-inline'` header. Static files served via rewrites are not processed through this pipeline. VERIFIED (LEARNINGS-batch-005 L-04).
- **Do NOT validate issuer/client hex params in the handler**. The enclave already integrity-checks the HTML. Server-side issuer/client validation is defense-in-depth but when it fails (config loading timing, path resolution), it prevents login entirely by returning 400 before the HTML loads. VERIFIED (LEARNINGS-batch-005 L-03).
- **The HTML must match the SDK version**. The only source is the pack template — the file is NOT shipped inside `@tidecloak/*` npm packages. If the pack template is stale and the enclave rejects it, contact the Tide team for the updated file. VERIFIED (LEARNINGS-batch-005 L-05, LEARNINGS-batch-007 L-03).
- Without this: DPoP login fails with `Tide user did not provided a dpop bound token` or `Popup DPoP verification failed to load`. VERIFIED (learning-batch-004, L-07).

**`secureFetch` requirements** (when DPoP is enabled):
- Use `IAMService.secureFetch` with `await IAMService.getToken()` for the managed token. **`getToken()` is async** — must be awaited. `secureFetch` attaches DPoP proofs when it sees `Authorization: Bearer <managed-token>`. VERIFIED (LEARNINGS-batch-005 L-07).
- URLs must be **absolute** — relative paths throw. VERIFIED (session-002).
- **Recommended**: Use an `appFetch` wrapper. See `canon/anti-patterns.md`.

**What this means** **VERIFIED** (vendor confirmation, GAP-032 resolved):
- Client-side: SDK generates ephemeral key pair, includes `DPoP` header with each request
- Server-side: Verify DPoP proof signature, method, URL, timestamp, nonce, thumbprint match
- Supported algorithms: ES256 (default) and EdDSA. ES384/ES512 declared in types but not implemented.

**Server-side verification pattern** **VERIFIED** (keylessh `server/auth.ts`):
1. Extract `DPoP` header
2. Verify JWT: `typ: "dpop+jwt"`, `alg` matches expected (ES256 or EdDSA)
3. Verify signature against `jwk` in proof
4. Check `htm` (HTTP method) matches request method
5. Check `htu` (HTTP URI) matches request URL (ignore query string)
6. Check `iat` timestamp (120s freshness window)
7. Check `jti` not replayed (2-min TTL in-memory cache)
8. Extract access token, verify `cnf.jkt` matches DPoP proof thumbprint

**Why**: DPoP prevents token replay attacks. Stolen access token is useless without corresponding private key to generate fresh proofs.

**Verification**:
```bash
# Check DPoP is configured client-side
grep -r "useDPoP.*strict" src/ client/
# Should find DPoP configuration if enabled

# Check server verifies DPoP if header present
grep -r "verifyDPoP\|DPoP.*header" server/
# Should find DPoP verification in auth middleware
```

**Consequence of violation**: Attacker can replay stolen access tokens without DPoP proof. Token binding defeats replay attacks.

DPoP is required for Tide's full security guarantees **VERIFIED** (vendor confirmation, GAP-032 resolved). ES256 is the default algorithm; EdDSA is also supported.

---

## I-13: Adapter JSON Tide Extensions Required

**Rule**: Adapter JSON must include Tide extensions (`jwk`, `vendorId`, `homeOrkUrl`). Generic Keycloak adapter is insufficient. **VERIFIED** (keylessh `tidecloakConfig.ts`)

**What this means**:
- Export adapter from TideCloak via the realm-level `GET /admin/realms/{realm}/vendorResources/get-installations-provider?clientId={clientId}&providerId=keycloak-oidc-keycloak-json` (client is a query param; `keycloak-oidc-keycloak-json` is the only valid provider ID)
- Do not use generic Keycloak adapter export
- Do not manually construct adapter JSON without Tide extensions
- `jwk` field is emitted whenever the realm has a Tide vendor key (NOT gated on IGA)

**Required Tide extensions**:
- `jwk: { keys: JWK[] }` - Embedded JWKS for local JWT verification
- `vendorId: string` - Tide vendor identifier
- `homeOrkUrl: string` - Home ORK endpoint

**Verification**:
```bash
# Check Tide extensions present
jq 'has("jwk") and has("vendorId") and has("homeOrkUrl")' data/tidecloak.json
# Should output: true

# Check jwk contains keys
jq '.jwk.keys | length' data/tidecloak.json
# Should output: number >= 1
```

**Consequence of violation**: JWT verification fails (missing `jwk`). Client cannot connect to Fabric (missing `homeOrkUrl`). Licensing may fail (missing `vendorId`).

**Related invariants**: I-04 (Embedded JWKS), I-05 (Adapter JSON Required)

**Note**: The `jwk` field is present whenever the realm has a Tide vendor key (not gated on IGA). Validate at startup.

---

## I-14: Realm Requires `_tide_enabled` Role

**Rule**: All Tide users must have `_tide_enabled` role in their default composite role set. Without it, Tide cryptographic operations fail. **VERIFIED** (vendor confirmation, GAP-031 resolved)

**What this means**:
- `setUpTideRealm` runs after realm import and does not auto-create `_tide_enabled`
- Declare `_tide_enabled` in the realm template so the role already exists when setup continues
- Default roles must include `_tide_enabled`
- Users created inherit `_tide_enabled` automatically

**Realm setup** **VERIFIED** (keylessh `realm.json`):
```json
{
  "defaultRoles": ["_tide_enabled", "offline_access", "uma_authorization"],
  "roles": {
    "realm": [
      { "name": "_tide_enabled", "composite": false }
    ]
  }
}
```

**Verification**:
```bash
# Check realm default roles
curl "${TIDECLOAK_URL}/admin/realms/${REALM}" | jq '.defaultRoles'
# Should include "_tide_enabled"

# Check user has role
curl "${TIDECLOAK_URL}/admin/realms/${REALM}/users/${USER_ID}/role-mappings/realm" | jq '.[] | select(.name=="_tide_enabled")'
# Should output role object
```

**Consequence of violation**: Tide operations fail with unclear errors. Login may succeed but E2EE, Forseti, and threshold operations fail.

Vendor guidance: universally required. Declare in realm.json template.

---

## I-15: Forseti Contracts Execute in Every ORK

**Rule**: Forseti policy contracts execute in distributed ORK sandboxes. Majority of ORKs must approve for operation to proceed. No single ORK can bypass. **VERIFIED** (Forseti.mdx, tier2-protocol-forseti.mdx, keylessh `sshPolicy.ts`)

**What this means**:
- Contract is C# code compiled and executed on each ORK
- Each ORK independently evaluates policy
- Majority approval required (not threshold T; simple majority)
- Compromised ORK cannot override policy
- No client-side or server-side policy bypass

**Contract submission**: `tc.createTideRequest` takes a single **pre-encoded `Uint8Array`** (a `BaseTideRequest` you build and `.encode()`), NOT a `{ contract, modelName, authFlow, ... }` object. Build the request first, then submit its encoding (see AP-53). The C# contract source is carried inside the request's draft.
```typescript
// Build a BaseTideRequest (name, version, authFlow, draft), then encode it.
const request = new BaseTideRequest(name, version, "Policy:1", draft);
const initializedBytes = await tc.createTideRequest(request.encode());
const result = await tc.executeSignRequest(initializedBytes);
```

**Verification**:
```bash
# Check contract is real C# code, not config
grep -r "createTideRequest" src/ | grep "contract:"
# Contract field should contain C# source, not JSON config

# Check no local policy evaluation bypass
grep -r "bypassPolicy\|skipPolicy" src/ server/
# Should find ZERO policy bypass logic
```

**Consequence of violation**: Policy enforcement collapses to single-party trust. Compromised client or server can bypass policy. No distributed enforcement.

**Related invariants**: I-02 (Threshold), I-09 (No Single Bypass)

**Sandbox model** **VERIFIED** (vendor confirmation, GAP-008 resolved): Five-layer security (Roslyn compilation, IL vetting with namespace block-list, AssemblyLoadContext isolation, VmHost process isolation, gas metering at 50,000 gas default). Block-list: `System.IO`, `System.Net`, `System.Diagnostics`, `System.Threading`, `System.Reflection`, `System.Runtime.InteropServices`, `System.Reflection.Emit`, `Microsoft.Win32`, plus `System.Console` and `System.Runtime.CompilerServices.Unsafe`. Non-deterministic calls blocked by default. Gas metering: `Claim(key)` = 5 gas, `Log(message)` = 25 gas, `OutOfGasException` when exhausted.

**Remaining open questions**: Contract debugging opaque **PARTIALLY_RESOLVED** (GAP-018).

---

## I-16: Post-Auth Redirect Handler Required

**Rule**: A real page or route must exist at the configured `redirectUri` path, and the Tide SDK provider must be active on that page. Without it, login completes at TideCloak but the user lands on a 404. **ASSUMED** (operational requirement of OIDC authorization code flow)

**Default redirect path**: `/auth/redirect`

**What this means**:
- The OIDC flow redirects the browser to `redirectUri?code=...&state=...` after authentication
- The Tide SDK on the target page reads URL parameters and completes token exchange
- If no page exists at that path, the browser shows a 404 and login silently fails
- If the page exists but lacks the SDK provider, the auth code is never processed

**Framework-specific handlers**:
- Vanilla JS / Vite: `public/auth/redirect.html` (must include SDK script)
- React SPA: route at `/auth/redirect` (or SPA fallback to index.html)
- Next.js App Router: `app/auth/redirect/page.tsx` (or `src/app/auth/redirect/page.tsx`)
- Next.js Pages Router: `pages/auth/redirect.tsx` (or `src/pages/auth/redirect.tsx`)

**Verification**:
```bash
# Check the redirect path returns HTML, not 404
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/auth/redirect
# Should return 200, not 404
```

**Consequence of violation**: Login completes at TideCloak but the user sees a 404 or blank page. The SDK never processes the auth code. Authentication appears broken despite correct credentials.

**Full guidance**: See [canon/redirect-handler.md](redirect-handler.md) for framework-specific examples, diagnostics, and anti-patterns.

**Related invariants**: I-06 (CSP), I-07 (Silent SSO)

---

## Summary of Invariants

| ID | Invariant | Verification Frequency | Failure Severity |
|----|-----------|----------------------|------------------|
| I-01 | Never-Whole-Key | Code review | **CRITICAL** |
| I-02 | Threshold Enforcement | Deployment config check | **CRITICAL** |
| I-03 | Server-Side JWT Verification | Every API route | **CRITICAL** |
| I-04 | Embedded JWKS | Server startup | **HIGH** |
| I-05 | Adapter JSON Required | Server startup | **CRITICAL** |
| I-06 | CSP Whitelist | Deployment check | **HIGH** |
| I-07 | Silent SSO File | Deployment check | **MEDIUM** |
| I-08 | UI Gating Not Authorization | Code review | **CRITICAL** |
| I-09 | No Single Bypass | Architecture review | **CRITICAL** |
| I-10 | IGA Quorum | Realm config check | **HIGH** |
| I-11 | E2EE Online Access | Code review | **HIGH** |
| I-12 | DPoP Verification | Every API request (if enabled) | **HIGH** |
| I-13 | Tide Extensions in Adapter | Server startup | **CRITICAL** |
| I-14 | `_tide_enabled` Role | Realm setup | **MEDIUM** |
| I-15 | Forseti Distributed Execution | Architecture review | **HIGH** |
| I-16 | Post-Auth Redirect Handler | Deployment check | **MEDIUM** |

**Failure severity**:
- **CRITICAL**: Violation defeats Tide's core security properties
- **HIGH**: Violation creates exploitable security weakness
- **MEDIUM**: Violation degrades user experience or operational reliability

---

## Invariant Violation Detection

### At Development Time
- Code review checklist against invariants I-01, I-08, I-09, I-11, I-15
- Static analysis for local key generation, policy bypass, single-admin paths

### At Deployment Time
- Validate adapter JSON has Tide extensions (I-04, I-05, I-13)
- Check CSP includes Tide domains (I-06)
- Verify `silent-check-sso.html` exists (I-07)
- Verify post-auth redirect handler exists at `redirectUri` path (I-16)
- Confirm IGA enabled if using governance (I-10)
- Check `_tide_enabled` role in default roles (I-14)
- Verify threshold configuration (I-02)

### At Runtime
- Monitor JWT verification failures (I-03)
- Monitor DPoP verification failures (I-12)
- Monitor Fabric connectivity (I-02, I-11)
- Monitor quorum enforcement (I-10)

---

## I-17: Scenario-Disambiguation Gate

**Rule**: If a request can map to more than one valid scenario, skill, or playbook path, the agent must resolve the ambiguity before writing code, creating roles, running bootstrap, or selecting a playbook. **VERIFIED** (session-001: agent silently chose self-encryption when request required policy-governed encryption).

**What this means**:
- Before actioning, identify whether multiple scenario paths are plausible
- If yes, resolve via explicit evidence from the repo or request, or ask the user
- Only then select the playbook/skill/template path
- If the scenario remains unresolved, surface the ambiguity — do not guess

**Known multi-scenario branch points**:

| Branch | Option A | Option B | Discriminating question |
|--------|----------|----------|------------------------|
| App state | Fresh app (no auth) | Existing app (has auth) | Does the project have an existing auth system? |
| Infrastructure | Generated app (has init script) | Manual / BYO TideCloak | Does `package.json` have an `"init"` script? Is TideCloak already running? |
| TideCloak hosting | Self-hosted (Docker/K8s) | Partner-hosted (Skycloak, managed) | Does the team want to run auth infra, or use a managed instance? See `canon/hosting-options.md`. Does not change app wiring; changes bootstrap. |
| Encryption model | Self-encryption (private, user-bound) | Policy-governed VVK (shared, cross-user) | Do other users need to decrypt the same ciphertext? |
| App scope | Single-user private app | Organisation / team / shared app | Are there multiple users who share data or resources? |
| Task type | Diagnosis (something is broken) | Setup (something needs building) | Is the app partially working, or not started? |
| Auth complexity | Simple RBAC (role checks) | Policy/governance flow (IGA, Forseti) | Does the app need multi-admin approval, policy signing, or contract-governed access? |
| Signing vs encryption | Threshold signing (Forseti contracts authorize signatures) | Encryption (self or shared) | Does the app produce cryptographic signatures, or encrypt/decrypt data? |
| "Use staging" | Docker image only (`tidecloak-stg-dev`) | Docker image + npm tags (WRONG) | "Staging" means the ORK staging network (Docker image). npm packages always use stable versions. VERIFIED (LEARNINGS-batch-005 L-02). |

**This is a pre-action gate.** It runs before code generation, role setup, bootstrap steps, or playbook execution. It is not a warning in a safety-check section after the path is already chosen.

**Anti-pattern**: Agent receives "add encryption" request, silently chooses self-encryption, builds the feature, then discovers the user wanted sharing. The entire encryption integration must be redone because self-encryption cannot be upgraded to shared encryption. (session-001, AP-24, AP-26)

**Consequence of violation**: Wrong architecture. Wrong roles. Wrong SDK calls. Wrong bootstrap steps. Rework is not incremental — it is a full redo of the affected layer.

**Related invariants**: I-03 (server-side JWT required), I-08 (UI gating is not auth)

---

## I-18: Development Team Execution Model

**Rule**: The agent operates as a virtual development team with named roles. The Tech Lead routes. Specialists do scoped work. The Reviewer checks before handoff. No role does work that belongs to another role.

**Team**:

| Role | Skill | Owns |
|------|-------|------|
| Tech Lead | (adapter front-door) | Inspection, sequencing, stopping on ambiguity |
| Scenario Resolver | `tide-scenario-resolver` | Determining problem type before build work begins |
| Setup / Platform Engineer | `tide-setup` | TideCloak bootstrap, realm, licensing, IGA, adapter export |
| Application Engineer | `tide-integration` | SDK, provider, config, redirect handler, CSP, DPoP auth page, webpack |
| Security Engineer | `tide-route-and-api-protection` | Route guards, API protection, JWT/DPoP verification |
| IAM / Policy Engineer | `tide-rbac-and-e2ee` | Roles, encryption, policy signing, Forseti contracts |
| Solutions Architect | `tide-solutions-architect` | Pattern exploration within pack constraints |
| Reviewer / QA Engineer | `tide-reviewer` | Compliance checking, invariant validation, anti-pattern detection |
| Learnings / Pack Curator | `tide-diagnostics` | Troubleshooting, findings, learnings, regression proposals |

**Ordering**: Scenario Resolver → Setup → Application → Security → IAM/Policy → Reviewer. Pack Curator at any point. Solutions Architect when no existing path fits.

**Handoff rules**:
- Scenario Resolver runs before any specialist. No implementation without a resolved scenario.
- Setup must complete before Application (TideCloak must be running).
- Application must complete before Security (SDK must be wired).
- Security must complete before IAM/Policy (JWT verification must exist).
- Reviewer is **mandatory** before handing the app to the user. No implementation is delivered without a review pass. If rejected, the named specialist fixes the issue, then Reviewer runs again.
- Solutions Architect proposes within constraints. Does not override doctrine.
- Pack Curator extracts lessons after builds. Proposes regressions and pack updates.

**Anti-pattern**: Skipping the Scenario Resolver. Implementation before scenario resolution leads to wrong paths.

**Anti-pattern**: One role doing all work in a single pass.

**Anti-pattern**: Reviewer acting as a second builder.

**Anti-pattern**: Solutions Architect silently promoting a new pattern into default pack behavior.

---

## Status Legend

- **VERIFIED** - Directly sourced from documentation or keylessh exemplar
- **INFERRED** - Strongly implied by source material
- **ASSUMED** - Operator guidance where sources are silent
- **REQUIRES_RUNTIME_VALIDATION** - Single-app evidence; needs confirmation
- **STILL_UNRESOLVED** - Open gap
- **PARTIALLY_RESOLVED** - Partial evidence; gaps remain
