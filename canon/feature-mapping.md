# Tide Feature Mapping

Maps Tide SDK features to their actual security properties and implementation requirements.

**Critical Rule**: UI gating is NOT authorization. Protected routes are NOT protected APIs. Clearly distinguish client-side convenience from server-side enforcement.

---

## Authentication Features

### Login / SSO / Logout

**SDK surface**:
- `doLogin()`, `doLogout()` (Vanilla JS)
- `useTideCloak().login()`, `useTideCloak().logout()` (React/Next.js)

**What it looks like**: Standard OIDC login flow with redirect to TideCloak.

**What is actually Tide-specific**:
- Password verification is threshold (PRISM across T+ ORKs) **VERIFIED**
- No password hash stored anywhere **VERIFIED**
- Each ORK verifies password challenge independently **VERIFIED**
- Attacker compromising TideCloak server cannot learn passwords **VERIFIED**

**What is generic OIDC**:
- Redirect flow (authorization code grant)
- Token endpoint calls
- Cookie/session management
- Silent SSO via iframe

**Agent implication**:
- Standard SDK methods work; do not implement custom password flows
- Login redirect, token exchange, refresh are OIDC standard
- Threshold verification is transparent to SDK consumer
- **Do not present login UX as the differentiator**; backend threshold verification is the actual Tide feature

**Verification**:
```javascript
// Login succeeds
await iam.doLogin({ redirectUri: window.location.origin });
// Check token is present
const token = await iam.getToken();
assert(token !== null);
```

**Common confusion**: Login UI looks like any OIDC provider. The difference is server-side: TideCloak delegates password verification to Fabric, not database check.

---

### Silent SSO Token Refresh

**SDK surface**:
- `silent-check-sso.html` in `public/`
- Automatic refresh via SDK

**What it looks like**: Standard OIDC silent refresh via hidden iframe.

**What is Tide-specific**: None. This is standard Keycloak silent SSO.

**Agent implication**:
- Required file: `public/silent-check-sso.html` **VERIFIED**
- Corrupted state detection pattern from keylessh **VERIFIED** (keylessh `AuthContext.tsx`):
  ```javascript
  // Check for stale auth state on startup
  const storageKeys = Object.keys(localStorage);
  const hasIamData = storageKeys.some(k => k.includes('iam') || k.includes('auth'));
  if (hasIamData && !initSuccess) {
    // Offer reset via ?reset=true
    window.location.href = '/?reset=true';
  }
  ```

**Failure modes**:
- CSP blocks iframe: silent refresh fails, requires full re-login
- Stale localStorage: IAM init hangs, 10s timeout triggers error
- Network timeout: falls back to full redirect

---

### Account Linking (Admin Onboarding)

**What it is**: New admin users must link their Tide account to activate threshold features. **VERIFIED** (keylessh `init-tidecloak.sh`)

**Workflow**:
1. Create user in TideCloak admin console
2. Generate linking URL via `POST /admin/realms/{realm}/users/{user-id}/tideAdminResources/get-required-action-link` with `lifespan=43200` (12 hours) **VERIFIED**
3. User opens link, completes linking in browser
4. Poll user attributes for `tideUserKey` and `vuid`
5. When both present, linking complete

**Agent implication**:
- Required action: `link-tide-account-action` **VERIFIED** (keylessh `realm.json`)
- Linking URL is time-limited (default 12 hours)
- Whether mandatory for non-admin users is unclear **PARTIALLY_RESOLVED** (GAP-030)

**Verification**:
```bash
# Poll for completion
USER_KEY=$(curl -s ... /admin/realms/myrealm/users/$USER_ID | jq -r '.attributes.tideUserKey[0]')
if [ -n "$USER_KEY" ]; then echo "Linked"; fi
```

---

## Authorization Features

### Role-Based Route Protection (Client-Side)

**SDK surface**:
- `useTideCloak().hasRealmRole(roleName)` — check realm roles
- `useTideCloak().hasClientRole(roleName, clientId?)` — check client roles
- `iam.hasRealmRole(roleName)` / `iam.hasClientRole(roleName, clientId?)`

The SDK hook does not export a generic `hasRole()`. Use `hasRealmRole` for realm roles and `hasClientRole` for client roles. `tide-realm-admin` is a client role on `realm-management` — use `hasClientRole('tide-realm-admin', 'realm-management')`, not `hasRealmRole`.

**What it looks like**: Protected routes that check user roles before rendering components.

**What is actually happening**: UI gating only. This is client-side convenience, NOT server-side authorization.

**Security property**: **NONE**. An attacker can bypass by modifying client code or replaying tokens.

**Agent implication**:
- **DO NOT** rely on `hasRealmRole()` / `hasClientRole()` for API authorization
- **DO** use them for UI/UX decisions (show/hide buttons, render different components)
- **DO** implement server-side role verification for protected APIs (see JWT Verification below)

**Example**:
```javascript
// CLIENT-SIDE (UI gating only)
if (useTideCloak().hasRealmRole('admin')) {
  return <AdminPanel />;  // Attacker can bypass
}

// SERVER-SIDE (real authorization)
app.get('/api/admin/users', (req, res) => {
  const jwt = verifyJWT(req.headers.authorization);  // Verify signature
  if (!jwt.realm_access.roles.includes('admin')) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  // Proceed with admin operation
});
```

**Common confusion**: SDK docs show role checks for route protection without emphasizing this is UI-only. Do not treat UI gating as authorization.

---

### JWT Verification (Server-Side Authorization)

**What it is**: Real authorization. Verifies threshold-signed JWT on server-side before granting API access.

**Tide-specific properties**:
- JWT signed by VVK threshold protocol (T+ ORKs) **VERIFIED**
- Signature verified against embedded JWKS from adapter JSON (local-only, no remote fallback) **VERIFIED** (keylessh `tideJWT.ts`). If `jwk` is missing, this is a setup failure — re-export adapter with IGA enabled.
- Each VVK ORK independently verified claims before partial-signing **VERIFIED**

**Server-side verification pattern** **VERIFIED** (keylessh `server/lib/auth/tideJWT.ts`):
```typescript
import { createLocalJWKSet, jwtVerify } from 'jose';
import { loadTideConfig } from './tidecloakConfig';

const config = loadTideConfig();
// Use embedded JWKS only (I-04). Do not use createRemoteJWKSet.
const JWKS = createLocalJWKSet(config.jwk);

async function verifyTideJWT(token: string) {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: config['auth-server-url'].replace(/\/+$/, '') + '/realms/' + config.realm,
  });

  // TideCloak uses azp (not aud) for client ID
  if (payload.azp !== config.resource) throw new Error('Token azp mismatch');

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) throw new Error('Token expired');
  if (payload.iat > now + 60) throw new Error('Token issued in future');

  return payload;
}
```

**Agent implication**:
- **DO NOT** fetch JWKS from `{realm}/protocol/openid-connect/certs`; use adapter JSON
- **DO** verify `iss` (issuer), `azp` (authorized party), `exp`, `iat`
- **DO** check roles in `realm_access.roles` or `resource_access` after signature verification
- Adapter JSON field: `jwk: { keys: JWK[] }` (only present when IGA enabled)

**Verification**:
```bash
# Extract public key from adapter JSON
jq '.jwk.keys[0]' data/tidecloak.json
# Verify JWT signature against this key
```

**Common confusion**: SDK docs mention `@tidecloak/verify` package but do not emphasize embedded JWKS usage. Authentication API docs omit this entirely.

---

### DPoP Token Binding (API Security)

**What it is**: RFC 9449 standard. Binds access tokens to client key pair. Server must verify proof on every request. **VERIFIED** (keylessh `server/auth.ts`)

**Tide-specific configuration** **VERIFIED** (vendor confirmation, GAP-032 resolved):
```typescript
// ES256 is the default and recommended for new projects
useDPoP: { mode: 'strict', alg: 'ES256' }
// EdDSA also supported (with automatic browser fallback)
useDPoP: { mode: 'strict', alg: 'EdDSA' }
```

**Client-side** (automatic via SDK):
- SDK generates ephemeral key pair
- Each request includes `DPoP` header with fresh proof
- Proof signs HTTP method + URL + timestamp + nonce
- Algorithm negotiated via server's `dpop_signing_alg_values_supported` OIDC metadata

**Server-side verification pattern** **VERIFIED** (keylessh `server/auth.ts`):
1. Extract `DPoP` header
2. Verify JWT: `typ: "dpop+jwt"`, `alg` matches expected (ES256 or EdDSA)
3. Verify signature against `jwk` in proof
4. Check `htm` matches HTTP method
5. Check `htu` matches request URL (ignore query string)
6. Check `iat` freshness (120s window)
7. Check `jti` not replayed (2-min TTL in-memory cache)
8. Extract access token, verify `cnf.jkt` matches proof thumbprint

**Agent implication**:
- DPoP is per-request; do not cache headers
- Server must maintain `jti` replay cache with TTL
- DPoP is required for Tide's full security guarantees **VERIFIED** (vendor confirmation, GAP-032 resolved)

**Verification**:
```bash
# Request with DPoP
curl -H "Authorization: DPoP $TOKEN" -H "DPoP: $PROOF" https://api.example.com/protected
# Server verifies proof before granting access
```

**Common confusion**: DPoP is NOT bearer token. Replaying `Authorization` header without fresh `DPoP` proof fails.

---

## E2EE Features

### Choosing the Encryption Model

**Decision tree** — answer before writing any encryption code:

| Question | If yes | If no |
|----------|--------|-------|
| Does only the encrypting user need to decrypt? | **Self-encryption**. Use `doEncrypt`/`doDecrypt` from `useTideCloak()`. Roles: `_tide_{tag}.selfencrypt`/`.selfdecrypt`. | Continue below. |
| Do multiple users need to decrypt the same ciphertext? | **Policy-governed VVK encryption**. Use `IAMService.doEncrypt(data, signedPolicyBytes)`. Requires Forseti contract + signed policy + voucher gates + contract role. See playbook `setup-forseti-e2ee`. | Self-encryption is sufficient. |

**These are different SDK call paths, different bootstrap flows, and different security models.** Switching from self-encryption to policy-governed encryption is not a role rename. It requires:
1. A Forseti contract deployed to the ORK network
2. A Policy object constructed and signed via the 5-step flow
3. Admin policy attached before commit
4. Signed policy bytes stored server-side
5. `IAMService.doEncrypt(data, policyBytes)` instead of `doEncrypt(data, tags)`

**If self-encryption fails** (e.g., "User has not been given any access"), fix the self-encryption setup:
- Check `_tide_{tag}.selfencrypt`/`.selfdecrypt` roles exist and are assigned
- Check user has re-logged in after role assignment
- Check IGA change requests are approved and committed
- Do NOT rename roles to `_tide_{tag}.encrypt`/`.decrypt` — this does not fix anything (AP-26)

### Encrypt / Decrypt (Self-Encryption)

**SDK surface**:
- `doEncrypt([{ data: plaintext, tags: [tag] }])` → array of ciphertexts
- `doDecrypt([{ encrypted: ciphertext, tags: [tag] }])` → array of plaintexts

**What it looks like**: Standard E2EE with application-side key management.

**What is actually Tide-specific**:
- Session key encrypted via CVK threshold across ORKs **VERIFIED**
- Decryption requires live Fabric threshold participation **VERIFIED**
- Plaintext never exists on server, admin console, or any ORK **VERIFIED**
- Enforcement is cryptographic: Fabric won't decrypt without role proof in JWT **VERIFIED**

**Tag-based role enforcement** **VERIFIED** (e2ee.md):
- Role pattern: `_tide_<tag>.selfencrypt`, `_tide_<tag>.selfdecrypt`
- Admin creates roles in TideCloak console
- Tag names are fully application-defined, no reserved prefixes or values. Case-sensitive, passed to ORK as-is (UTF-8, no normalization), max ~237 chars for self-encryption. **VERIFIED** (vendor confirmation, batch-02 Q-10, A-26 resolved). For policy-based encryption, tags are opaque data passed to the Forseti contract — no `_tide_` roles needed.
- User must have matching role for encrypt/decrypt to succeed
- Role check is embedded in JWT; Fabric verifies before threshold-decrypting session key

**Agent implication**:
- Both `Uint8Array` (binary) and string inputs supported **VERIFIED** (vendor confirmation, GAP-013 resolved)
- No application-level max payload size. Payloads <32 bytes use ElGamal; >=32 bytes use hybrid AES-256-GCM + ElGamal. Practical ceiling ~28.6 MB (Kestrel default). **VERIFIED** (vendor confirmation, GAP-013 resolved)
- Ciphertext is a TideMemory-serialized envelope. Base64 string when input was string, raw `Uint8Array` when input was `Uint8Array`. Overhead ~157B / ~217B before base64. Versioned (v1), stable. **VERIFIED** (vendor confirmation, batch-02 Q-05, A-28 resolved)
- Requires online Fabric access; no offline decryption **VERIFIED**
- Both `selfencrypt` AND `selfdecrypt` roles needed to round-trip **INFERRED** (A-27)

**Workflow**:
1. Admin creates roles: `_tide_ssn.selfencrypt`, `_tide_ssn.selfdecrypt`
2. Admin assigns roles to users via IGA approval
3. User calls `doEncrypt([{ data: '123-45-6789', tags: ['ssn'] }])` → ciphertext stored in app DB
4. User calls `doDecrypt([{ encrypted: ciphertext, tags: ['ssn'] }])` → Fabric checks JWT for `_tide_ssn.selfdecrypt` role → threshold-decrypts session key → plaintext returned

**Verification**:
```javascript
const [ciphertext] = await iam.doEncrypt([{ data: 'secret data', tags: ['test'] }]);
assert(ciphertext !== 'secret data');
const [plaintext] = await iam.doDecrypt([{ encrypted: ciphertext, tags: ['test'] }]);
assert(plaintext === 'secret data');
```

**Common confusion**: E2EE is NOT client-side encryption with server key storage. Decryption requires live Fabric threshold. Do not implement offline decrypt fallback.

**Common confusion**: Renaming `_tide_{tag}.selfencrypt` to `_tide_{tag}.encrypt` does NOT switch from self-encryption to shared encryption. The role suffix is a naming convention. The SDK call path (`doEncrypt` vs `IAMService.doEncrypt(data, policyBytes)`) determines the encryption model. See AP-26 in `canon/anti-patterns.md`.

---

## Governance Features

### IGA Quorum Approval

> **⚠️ API SURFACE MIGRATION — confirmed by Tide 2026-07-07 (GAP-065).** The change-request endpoints have moved to iga-core's **`/admin/realms/{realm}/iga/change-requests/...`** surface, which **replaces** the legacy `/tide-admin/change-set/...` surface shown below. New shape: the mutating write is captured (HTTP 202 + a change-request id); approve per-id with `POST .../iga/change-requests/{id}/authorize` (200/403/409 — 409 = four-eyes re-sign) then `POST .../iga/change-requests/{id}/commit` (200/403/409/412/404 — 412 = quorum unmet); reject with `POST .../{id}/deny`; batch with `POST /iga/change-requests/bulk-authorize`; list with `GET /iga/change-requests?status=PENDING`; in Tide mode the enclave step is `GET`/`POST .../{id}/approval-model`. Enabling IGA is unchanged: `POST /tide-admin/toggle-iga` (realm attr `isIGAEnabled="true"`). **Also note the two-mode split** (`iga.attestor`): Tide (`=tide`, cryptographic VVK/VRK→ORK sealing) vs Tideless (`=simple`/unset, username attestation, server-enforced, NO crypto). See `canon/security-gap-mapping.md` (SG-07/SG-14/SG-16 + IGA-model note). **Full endpoint spec + payloads + the bootstrap approve/commit loop: `canon/iga-change-requests-api.md`.** The workflow and verification examples below now use the new surface; the legacy `/tide-admin/change-set/...` paths are retained only in the old→new mapping for reference.

**What it is**: Admin changes require multi-admin approval sealed by VVK threshold signatures. **VERIFIED** (IGA.mdx, SetupIGA.md, keylessh `init-tidecloak.sh`)

**Change-request workflow** (legacy surface shown — see migration banner above; new surface is `/iga/change-requests/...`) **VERIFIED for legacy** (CHANGE_REQUEST_API.md, all exemplar init scripts):
1. **Create**: Admin action triggers draft creation automatically (DRAFT/PENDING)
2. **Approve**: legacy `POST .../tide-admin/change-set/sign/batch` → new `POST .../iga/change-requests/{id}/authorize`
3. **Enclave** (MultiAdmin / Tide mode): decode `changeSetDraftRequests`, present to enclave, submit via legacy `POST .../tideAdminResources/add-review` → new `POST .../iga/change-requests/{id}/approval-model`
4. **Commit**: legacy `POST .../tide-admin/change-set/commit/batch` → new `POST .../iga/change-requests/{id}/commit`

**Quorum formula**: `max(1, floor(TotalAdmins * 0.7))` **VERIFIED** (SetupIGA.md). Note: this is the IGA admin quorum, distinct from the SSH policy `threshold` (per-role signing approval count).

**What is Tide-specific**:
- Approval is cryptographic, not procedural **VERIFIED**
- VVK ORKs seal approved changes with threshold signatures (Authorization Proofing) **VERIFIED**
- VVK ORKs verify future JWT claims against these proofs **VERIFIED**
- No single admin can bypass **VERIFIED**
- Two signing modes: FirstAdmin (VRK, no popup) vs MultiAdmin (enclave challenge) **VERIFIED** (CHANGE_REQUEST_API.md)

**What is generic workflow**:
- Change request tracking
- Approval UI
- Audit trail

**Agent implication**:
- Enable IGA via `POST /admin/realms/{realm}/tide-admin/toggle-iga` **VERIFIED** (all exemplar init scripts)
- Canonical ordering: license → IGA → E2EE (only valid sequence) **VERIFIED** (vendor confirmation, batch-02 Q-04, A-21/A-22 resolved)
- After commit, token refresh required for roles to appear in doken (up to 120s delay) **VERIFIED** (test-cases F3)
- Change requests have a 1-month (2628000s) cryptographic expiry enforced by the Tide enclave. No automatic DB cleanup — stale drafts persist until cancelled. Not configurable. **VERIFIED** (vendor confirmation, batch-02 Q-08, A-25 resolved)
- **Draft-triggering scope** **VERIFIED** (vendor confirmation, GAP-041 resolved): When IGA is enabled on a non-master realm, 18 specific admin API actions create change-set drafts. Not all mutating endpoints create drafts. Operations fall into two categories: DRAFT (requires quorum sign/commit) and ACTIVE (auto-approved, audit-only). Role creation gets ACTIVE status — no sign/commit needed. Role assignment to users gets DRAFT status — sign/commit required.

**Verification** (current `/iga/change-requests/...` surface — see `canon/iga-change-requests-api.md`):
```bash
# List pending change requests (all types, single call)
curl "${TIDECLOAK_URL}/admin/realms/${REALM}/iga/change-requests?status=PENDING" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" | jq '.[].id'
# Authorize (approve) one CR — body optional; FirstAdmin/Tideless signs server-side
curl -X POST "${TIDECLOAK_URL}/admin/realms/${REALM}/iga/change-requests/${CR_ID}/authorize" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" -d '{}'
# Commit (409/412 if not PENDING / under threshold or unmet dependency)
curl -X POST "${TIDECLOAK_URL}/admin/realms/${REALM}/iga/change-requests/${CR_ID}/commit" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}"
# Batch approve during bootstrap:
#   POST .../iga/change-requests/bulk-authorize  -d '{"actionTypeIn":["CREATE","DELETE"],"limit":100}'
```

**Common confusion**: IGA docs read as "approval workflow" without emphasizing threshold signatures. This is NOT procedural approval; it is cryptographic enforcement.

---

### Forseti Policy Enforcement

**What it is**: Programmable C# contracts executed in every ORK sandbox. Majority of ORKs must approve for operation to proceed. **VERIFIED** (Forseti.mdx, tier2-protocol-forseti.mdx, keylessh `sshPolicy.ts`)

**SDK surface**:
```typescript
const signRequest = await tc.createTideRequest({
  contract: "using System; ...",  // C# code
  modelName: "BasicCustom<APP>:BasicCustom<1>",
  authFlow: "Policy:1",
  authorizer: tc.doken,
  challengeData: { ... }
});
const result = await tc.executeSignRequest(signRequest);
```

**What is Tide-specific**:
- Real C# contract execution in every ORK **VERIFIED**
- Sandbox enforces namespace restrictions **VERIFIED** (Forseti.mdx)
- No single ORK can bypass; majority enforcement **VERIFIED**
- Compromised ORK cannot override policy **VERIFIED**

**What is generic**:
- Contract compilation and packaging (application-side)

**Agent implication**:
- Sandbox: five-layer security model with namespace block-list, gas metering (default 50,000 gas) **VERIFIED** (vendor confirmation, GAP-008 resolved)
- Contract debugging: `PolicyDecision.Deny("message")` propagates to client. Internal ORK errors still opaque (GAP-018).
- Doken accessed via `tc.doken` **VERIFIED** (keylessh `tideSsh.ts`)
- Doken `exp` copied from SSO access token; auto-refreshed with token refresh **VERIFIED** (vendor confirmation, GAP-017 resolved)

**Verification**:
```javascript
const result = await tc.executeSignRequest(signRequest);
assert(result.signature !== null);  // ORKs approved and signed
```

**Common confusion**: Forseti is NOT authorization middleware config. Real compiled C# executes in distributed ORK sandboxes.

---

## Infrastructure Features

### Adapter JSON Configuration

**What it is**: Config file with Tide extensions for embedded JWKS, vendor ID, home ORK endpoint. **VERIFIED** (keylessh `tidecloakConfig.ts`)

**Tide-specific fields**:
- `jwk: { keys: JWK[] }` - Local JWT verification **VERIFIED**
- `vendorId: string` - Tide vendor identifier **VERIFIED**
- `homeOrkUrl: string` - Home ORK endpoint **VERIFIED**

**Generic Keycloak fields**:
- `realm`, `auth-server-url`, `ssl-required`, `resource`, `public-client`, `confidential-port`

**Export endpoint** **VERIFIED** (vendor confirmation, GAP-044 resolved):
```
GET /admin/realms/{realm}/vendorResources/get-installations-provider?clientId={client-uuid}&providerId=keycloak-oidc-keycloak-json
```

This is the **realm-level** endpoint; the client is passed as the `clientId={uuid}` query param, NOT as a `/clients/{id}/` path segment (the per-client path returns a minimal adapter missing `jwk`). There is a single provider ID: `keycloak-oidc-keycloak-json`. The string `tidecloak-oidc-keycloak-json` does not exist in the codebase. TideCloak enriches the adapter JSON via this vendor endpoint by post-processing the standard provider output to inject Tide-specific fields.

**Loading locations** **VERIFIED** (keylessh configs):
- File: `data/tidecloak.json`
- Env var: `CLIENT_ADAPTER` (JSON string)
- Env var: `TIDECLOAK_CONFIG_B64` (base64)

**Agent implication**:
- `jwk` field is only present when IGA is enabled on the realm. Validate at startup.
- Do not use generic Keycloak adapter parsers; Tide extensions required

**Verification**:
```bash
jq '.jwk, .vendorId, .homeOrkUrl' data/tidecloak.json
# All three fields must be present
```

---

### CSP for SWE Iframe

**What it is**: Content Security Policy whitelist for SWE iframe to function. **VERIFIED** (keylessh `server/index.ts`)

**Required CSP directive** **VERIFIED** (vendor confirmation, GAP-028 resolved):
```
frame-src 'self' *
```

`frame-src '*'` is required because users can re-home their SWE session to any ORK. No fixed domain list.

**Failure symptom**: SWE iframe silently fails; login hangs, E2EE operations timeout, no visible errors (check browser console for CSP violations).

**Verification**:
```bash
# Check response headers
curl -I https://app.example.com | grep -i content-security-policy
# Verify frame-src includes Tide domains
```

---

### Realm Initialization

**What it is**: Automated realm setup with Tide defaults. **VERIFIED** (keylessh `init-tidecloak.sh`, `realm.json`)

**Setup endpoint** **VERIFIED** (vendor confirmation, GAP-029 strengthened):
```
POST /admin/realms/{realm}/vendorResources/setUpTideRealm
Content-Type: application/x-www-form-urlencoded
Params: email (string, required), isRagnarokEnabled (boolean, optional, defaults true)
Response: 200 with raw licensing JSON as text/plain
```
The endpoint creates the Tide IDP, `tide-vendor-key` component, provisions a free-tier license via the ORK network, and generates the initial VVK/VRK keys. Exactly two parameters — no hidden or undocumented ones. Sending a JSON body (instead of `x-www-form-urlencoded`) causes the setup to fail with `"Tide realm setup failed"` / `"Could not set up the Tide realm"`.

**Tide realm defaults** **VERIFIED** (keylessh `realm.json`):
- Default roles: `_tide_enabled`, `offline_access`, `uma_authorization`
- Browser flow: `tidebrowser` (replaces standard Keycloak flow)
- Token lifetimes: `accessTokenLifespan: 600`, `ssoSessionIdleTimeout: 1800`, `ssoSessionMaxLifespan: 36000`
- Protocol mappers: `tideUserKey`→`tideuserkey`, `vuid`→`vuid`, Tide IGA Role Mapper
- Required action: `link-tide-account-action`

**Agent implication**:
- Protocol mappers are auto-created on client creation **VERIFIED** (vendor confirmation, GAP-036 resolved)
- `tidebrowser` flow: confirmed across 4 exemplar realm.json files **VERIFIED**
- Token lifetimes: `accessTokenLifespan: 600` confirmed across all exemplar realm.json files **VERIFIED**
- Declare `_tide_enabled` in realm.json template — `setUpTideRealm` does not create it **VERIFIED** (vendor confirmation, GAP-031 resolved)

**Verification**:
```bash
# Check realm configuration
curl .../admin/realms/myrealm | jq '.browserFlow, .accessTokenLifespan'
```

---

## Feature Comparison: Generic vs Tide-Specific

| Feature | Generic OIDC | Tide-Specific | Enforcement Location |
|---------|-------------|---------------|---------------------|
| Login redirect flow | ✓ | - | Client + TideCloak |
| Password verification | ✓ (DB hash) | ✓ (threshold PRISM) | Fabric ORKs |
| JWT signing | ✓ (server key) | ✓ (threshold VVK) | Fabric ORKs |
| JWT verification | ✓ (remote JWKS) | ✓ (embedded JWKS, local-only) | Application server |
| Token refresh | ✓ | - | Client + TideCloak |
| Role-based UI gating | ✓ | - | Client (NOT real authorization) |
| Role-based API authorization | ✓ | ✓ (threshold-verified roles) | Application server + Fabric |
| E2EE | - | ✓ (threshold decrypt) | Fabric ORKs |
| Admin approval workflow | ✓ (procedural) | ✓ (threshold signatures) | Fabric ORKs |
| Policy enforcement | - | ✓ (Forseti contracts) | Fabric ORKs |
| DPoP token binding | ✓ (RFC 9449) | ✓ (ES256 default, EdDSA supported) | Application server |

---

## Protected Routes vs Protected APIs

### Protected Routes (Client-Side)

**What they are**: UI components that check auth state before rendering.

**Security property**: UI convenience only. Attacker can bypass by modifying client code.

**Example**:
```javascript
// Next.js middleware (runs client-side or edge)
if (!session || !session.roles.includes('admin')) {
  return NextResponse.redirect('/login');
}
```

**Agent implication**: Use for UX decisions, NOT security enforcement.

---

### Protected APIs (Server-Side)

**What they are**: API endpoints that verify JWT signature and claims before granting access.

**Security property**: Real authorization. Threshold-signed JWT cannot be forged.

**Example**:
```javascript
app.get('/api/admin/users', async (req, res) => {
  try {
    const jwt = await verifyTideJWT(extractToken(req));
    if (!jwt.realm_access.roles.includes('admin')) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    // Proceed with admin operation
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
});
```

**Agent implication**: Always verify JWT on server-side for protected operations.

---

## UI Gating vs Real Authorization

| Aspect | UI Gating | Real Authorization |
|--------|-----------|-------------------|
| **Location** | Client-side | Server-side |
| **Purpose** | UX decisions (show/hide buttons) | Security enforcement |
| **Bypass risk** | High (modify client code) | Low (threshold signatures) |
| **Tide involvement** | None (standard React patterns) | Yes (threshold JWT verification) |
| **Example** | `if (hasRealmRole('admin')) <AdminButton />` | `verifyJWT(token) && hasRole(jwt, 'admin')` |

**Critical rule**: Never rely on UI gating for security. Always verify on server-side.

---

## Status Legend

- **VERIFIED** - Directly sourced from documentation or keylessh exemplar
- **INFERRED** - Strongly implied by source material
- **ASSUMED** - Operator guidance where sources are silent
- **REQUIRES_RUNTIME_VALIDATION** - Single-app evidence; needs confirmation
- **STILL_UNRESOLVED** - Open gap
- **PARTIALLY_RESOLVED** - Partial evidence; gaps remain
