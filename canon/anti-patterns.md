# Tide Anti-Patterns

Common mistakes that defeat Tide's security properties or cause operational failures. Each anti-pattern includes why it's wrong and the correct approach.

**Critical**: These mistakes reduce Tide to generic auth, introduce security vulnerabilities, or break core functionality.

---

## AP-01: Treating Tide as Generic OIDC

**What it looks like**:
- Implementing custom password verification logic
- Using standard Keycloak JWKS endpoint
- Skipping adapter JSON Tide extensions
- Treating login flow as "just OAuth2/OIDC"

**Why it's wrong**:
- Tide authentication is threshold-verified (PRISM), not server-checked
- JWT signing is threshold protocol (VVK), not single-server signing
- Adapter JSON contains embedded JWKS and Fabric endpoints
- Treating Tide as generic OIDC loses all threshold enforcement

**Consequence**: Collapse to single-point-of-trust. Threshold security properties lost.

**Correct approach**:
```typescript
// ❌ WRONG: Fetch JWKS from remote endpoint
const JWKS = createRemoteJWKSet(new URL(`${issuer}/protocol/openid-connect/certs`));

// ❌ ALSO WRONG: Remote JWKS as fallback
try { await jwtVerify(token, localJWKS); }
catch { await jwtVerify(token, createRemoteJWKSet(certsUrl)); }

// ✅ CORRECT: Use embedded JWKS from adapter JSON, fail if missing
import { loadTideConfig } from './tidecloakConfig';
const config = loadTideConfig();
if (!config.jwk) throw new Error('Missing jwk in tidecloak.json. Re-export adapter.');
const JWKS = createLocalJWKSet(config.jwk);
```

**Related**: [Collapse Risk Register](../notes/source-audit.md#collapse-risk-register), Invariants I-04, I-05

---

## AP-02: Relying on Client-Side Role Checks for Authorization

**What it looks like**:
```typescript
// ❌ WRONG: API trusts client-side role check
if (useTideCloak().hasRealmRole('admin')) {
  // Show admin button
}

app.get('/api/admin/users', (req, res) => {
  // Assumes client already checked role
  return res.json({ users: [...] });
});
```

**Why it's wrong**:
- `hasRealmRole()` / `hasClientRole()` are UI gating, not authorization
- Attacker can bypass by calling API directly
- Client-side checks are easily modified
- No server-side enforcement = no security

**Note**: The SDK hook exports `hasRealmRole(role)` and `hasClientRole(role, client?)`. There is no generic `hasRole()` on the hook. Use `hasRealmRole` for realm roles, `hasClientRole` for client roles.

**Consequence**: Unauthorized access to protected APIs. Attacker can impersonate admin.

**Correct approach**:
```typescript
// ✅ CORRECT: UI gating for UX (realm role)
if (useTideCloak().hasRealmRole('admin')) {
  return <AdminButton />;  // Show/hide UI element
}

// ✅ CORRECT: Server-side authorization
app.get('/api/admin/users', async (req, res) => {
  const jwt = await verifyTideJWT(extractToken(req));
  if (!jwt.realm_access.roles.includes('admin')) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return res.json({ users: [...] });
});
```

**Related**: Invariants I-03, I-08, [Feature Mapping](feature-mapping.md#protected-routes-vs-protected-apis)

---

## AP-03: Generating Keys Locally

**What it looks like**:
```typescript
// ❌ WRONG: Local key generation for Tide operations
const keyPair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify']
);
// Use keyPair for Tide operations
```

**Why it's wrong**:
- Tide keys are born fragmented across ORKs (DKG)
- Local key generation defeats never-whole-key invariant
- Single point of compromise; attacker can extract complete key
- Threshold enforcement requires distributed key shards

**Consequence**: All Tide security properties lost. Attacker with local key can forge tokens, decrypt data, bypass policy.

**Correct approach**:
```typescript
// ✅ CORRECT: Delegate to SDK/Fabric
const ciphertext = await iam.doEncrypt([{ data: plaintext, tags: ['tag'] }]);
const signature = await tc.executeSignRequest(signRequest);

// Keys never exist locally; operations use Fabric threshold protocols
```

**Related**: Invariants I-01, I-02, I-09, [Concepts](concepts.md#never-whole-key-model-ineffable-cryptography)

---

## AP-04: Implementing Offline E2EE Fallback

**What it looks like**:
```typescript
// ❌ WRONG: Cache session keys for offline decrypt
let cachedSessionKey;

async function offlineDecrypt(ciphertext) {
  if (!navigator.onLine && cachedSessionKey) {
    return decryptLocally(ciphertext, cachedSessionKey);
  }
  return iam.doDecrypt([{ encrypted: ciphertext, tags: ['tag'] }]);
}
```

**Why it's wrong**:
- E2EE session keys are threshold-decrypted by Fabric
- Caching session keys defeats threshold enforcement
- Offline decryption requires complete key locally
- No Fabric participation = no threshold security

**Consequence**: Session keys exposed client-side. Attacker can decrypt all data with cached key. Threshold security lost.

**Correct approach**:
```typescript
// ✅ CORRECT: Require online Fabric access
async function decrypt(ciphertext) {
  if (!navigator.onLine) {
    throw new Error('E2EE requires online Fabric access');
  }
  return iam.doDecrypt([{ encrypted: ciphertext, tags: ['tag'] }]);
}

// Handle offline state at application level, not E2EE level
```

**Related**: Invariants I-02, I-11, [Concepts](concepts.md#threshold-e2ee-hermetic-e2ee)

---

## AP-05: Single-Admin Bypass Paths

**What it looks like**:
```typescript
// ❌ WRONG: Admin override that skips IGA approval
app.post('/api/admin/emergency-create-user', async (req, res) => {
  const jwt = await verifyTideJWT(extractToken(req));
  if (jwt.realm_access.roles.includes('superadmin')) {
    // Skip IGA approval for emergency
    await createUserDirectly(req.body);
    return res.json({ success: true });
  }
});
```

**Why it's wrong**:
- IGA quorum enforcement prevents single-admin abuse
- Bypass paths defeat threshold governance
- "Emergency" paths are first attack vector
- Compromised superadmin can bypass all controls

**Consequence**: Single compromised admin can create backdoor accounts, grant unauthorized roles, bypass governance. IGA collapses to single-admin trust.

**Correct approach**:
```typescript
// ✅ CORRECT: All admin changes go through TideCloak admin API (IGA-governed)
// Creating a user via the standard admin endpoint automatically generates a
// change-set when IGA is enabled. There is no explicit "createChangeRequest" API.
app.post('/api/admin/create-user', async (req, res) => {
  const jwt = await verifyTideJWT(extractToken(req));
  if (!jwt.realm_access.roles.includes('admin')) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Call TideCloak admin API — IGA creates a draft change-set automatically
  await fetch(`${TIDECLOAK_URL}/admin/realms/${REALM}/users`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(req.body)
  });

  // Admin must then approve via /iga/change-requests/{id}/authorize
  // and commit via /iga/change-requests/{id}/commit (canon/iga-change-requests-api.md)
  return res.json({ status: 'pending_approval' });
});

// No bypass; even emergency changes require quorum
```

**Related**: Invariants I-09, I-10, [Concepts](concepts.md#iga-identity-governance--administration)

---

## AP-06: Skipping DPoP Verification

**What it looks like**:
```typescript
// ❌ WRONG: Accept access token without DPoP proof
app.get('/api/protected', async (req, res) => {
  const jwt = await verifyTideJWT(extractToken(req));
  // Missing DPoP verification
  return res.json({ data: [...] });
});
```

**Why it's wrong** (if DPoP is enabled):
- DPoP binds token to client key pair
- Without verification, stolen tokens can be replayed
- Attacker doesn't need private key to use token
- Token binding security property lost

**Consequence**: Token replay attacks succeed. Stolen access token is usable from any client.

**Correct approach**:
```typescript
// ✅ CORRECT: Verify DPoP if header present
app.get('/api/protected', async (req, res) => {
  const token = extractToken(req);

  // Verify DPoP if present
  if (req.headers.dpop) {
    await verifyDPoP(req, token);
  }

  const jwt = await verifyTideJWT(token);
  return res.json({ data: [...] });
});
```

**Note**: DPoP is not merely "supported" — it is **ENABLED and ENFORCED by default** in the TideCloak SDK (`useDPoP` defaults to `{ mode: 'strict' }`). Treat DPoP as on unless it has been explicitly disabled (`useDPoP: false`). Skipping server-side DPoP handling when the SDK default is in force will break every request. ES256 is the default algorithm; EdDSA also supported. **VERIFIED** (`tidecloak-js: packages/tidecloak-js/src/IAMService.js`).

**Related**: Invariants I-12, [Concepts](concepts.md#dpop-demonstration-of-proof-of-possession)

---

## AP-07: Missing CSP Whitelist

**What it looks like**:
```typescript
// ❌ WRONG: No CSP or overly restrictive frame-src
// Default CSP:
// Content-Security-Policy: frame-src 'self'

// Or no CSP headers at all
```

**Why it's wrong**:
- SWE loads via iframe from Tide domains
- Browser blocks cross-origin iframes without CSP whitelist
- SWE cannot load; all Tide operations fail silently
- Login hangs, E2EE timeouts, no visible errors

**Failure symptom**: Check browser console: `Refused to frame 'https://...' because it violates the following Content Security Policy directive: "frame-src 'self'"`.

**Consequence**: Complete Tide failure. Login broken. E2EE broken. No threshold operations work.

**Correct approach**:
```typescript
// ✅ CORRECT: frame-src '*' required for ORK re-homing
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      frameSrc: ["'self'", '*']
    }
  }
}));
```

**Related**: Invariants I-06, [Concepts](concepts.md#swe-secure-web-enclave)

---

## AP-08: Hardcoding 14/20 Threshold

**What it looks like**:
```typescript
// ❌ WRONG: Hardcoded threshold
const REQUIRED_ORKS = 14;
const TOTAL_ORKS = 20;

if (approvals.length < REQUIRED_ORKS) {
  throw new Error('Insufficient ORK approvals');
}
```

**Why it's wrong**:
- Threshold is deployment-configurable via env vars
- Mainnet: 14/20, Test: 3/5, Custom: varies
- Hardcoding breaks test environments
- Code cannot adapt to different Fabric configurations

**Consequence**: Code fails in test/dev environments with different threshold. Deployment inflexibility.

**Correct approach**:
```typescript
// ✅ CORRECT: Read threshold from config/env
const THRESHOLD = parseInt(process.env.TIDE_VENDOR_THRESHOLD_SIGNING || '3');
const TOTAL = parseInt(process.env.TIDE_VENDOR_THRESHOLD_TOTAL || '5');

if (approvals.length < THRESHOLD) {
  throw new Error(`Insufficient ORK approvals (got ${approvals.length}, need ${THRESHOLD})`);
}
```

**Related**: Invariants I-02, [Concepts](concepts.md#fabric-cybersecurity-fabric)

---

## AP-09: Treating BYOiD as Federated Login

**What it looks like**:
```markdown
<!-- ❌ WRONG: Docs that conflate BYOiD with OAuth2 federated login -->
"TideCloak supports Bring Your Own Identity, allowing users to log in with their existing accounts from Google, Microsoft, or other identity providers."
```

**Why it's wrong**:
- BYOiD is threshold password authentication (PRISM), not federated login
- Users bring their password, not an external identity
- No integration with Google/Microsoft/OAuth2 providers (unless via Keycloak federation, which is separate)
- Confusion leads to wrong implementation expectations

**Consequence**: Developer expects to configure OAuth2 providers. Actual BYOiD setup (PRISM threshold auth) is missed. Documentation misleads.

**Correct description**:
```markdown
<!-- ✅ CORRECT: Emphasize threshold password auth -->
"TideCloak uses threshold password authentication (BYOiD). User passwords are verified across T+ ORKs using PRISM (Threshold Oblivious Pseudorandom Function). No password hash is stored anywhere; no single party learns the password."
```

**Related**: [Concepts](concepts.md#threshold-password-authentication-byoid), [Terminology Map](../notes/terminology-map.md#terms-often-confused-with-generic-auth)

---

## AP-10: Treating IGA as Procedural Approval

**What it looks like**:
```markdown
<!-- ❌ WRONG: Docs that downplay threshold signatures -->
"IGA provides an approval workflow where admin changes require multi-admin sign-off before taking effect."
```

**Why it's wrong**:
- IGA approval is sealed by VVK threshold signatures, not procedural tracking
- Emphasis on "workflow" obscures cryptographic enforcement
- Sounds like generic approval system, not threshold-secured governance
- Developer may implement procedural bypass ("emergency override")

**Consequence**: IGA implemented as procedural workflow with bypass paths. Cryptographic enforcement lost.

**Correct description**:
```markdown
<!-- ✅ CORRECT: Emphasize threshold signatures -->
"IGA enforces quorum approval via VVK threshold signatures. Admin changes require max(1, floor(N*0.7)) approvals, sealed by threshold cryptography. No single admin can bypass; compromised admin cannot act unilaterally. Approval is cryptographic, not procedural."
```

**Related**: Invariants I-10, [Concepts](concepts.md#iga-identity-governance--administration)

---

## AP-11: Client-Side Policy Enforcement

**What it looks like**:
```typescript
// ❌ WRONG: Forseti policy logic implemented client-side
function checkSSHPolicy(user, destination) {
  if (user.role === 'admin' || destination.startsWith('dev-')) {
    return true;  // Allow
  }
  return false;
}

if (checkSSHPolicy(currentUser, targetServer)) {
  await connectSSH(targetServer);
}
```

**Why it's wrong**:
- Forseti contracts execute in distributed ORK sandboxes, not client
- Client-side checks are easily bypassed
- No majority enforcement; single client can override
- Policy becomes suggestion, not enforcement

**Consequence**: Policy bypass. Attacker modifies client code to skip checks. No distributed enforcement.

**Correct approach**:
```typescript
// ✅ CORRECT: Submit contract to Fabric for distributed execution.
// createTideRequest takes a single pre-encoded Uint8Array (a BaseTideRequest),
// NOT an object literal. Build the request, encode it, then submit (see AP-53).
const request = new BaseTideRequest(name, version, 'Policy:1', draft); // draft carries the C# contract
const initializedBytes = await tc.createTideRequest(request.encode());

const result = await tc.executeSignRequest(initializedBytes);
// ORKs have independently evaluated policy; majority approved or rejected
```

**Related**: Invariants I-15, [Concepts](concepts.md#forseti-policy-engine)

---

## AP-12: Caching DPoP Headers

**What it looks like**:
```typescript
// ❌ WRONG: Reuse DPoP proof across requests
let cachedDPoPHeader;

async function apiCall(endpoint) {
  if (!cachedDPoPHeader) {
    cachedDPoPHeader = await generateDPoPProof();
  }

  return fetch(endpoint, {
    headers: {
      'Authorization': `DPoP ${token}`,
      'DPoP': cachedDPoPHeader  // Reused across requests
    }
  });
}
```

**Why it's wrong**:
- DPoP proof includes `htm` (HTTP method) and `htu` (HTTP URI)
- Each request requires fresh proof matching method and URL
- Cached proof fails verification on different endpoints
- `jti` replay protection rejects reused proofs

**Consequence**: DPoP verification fails. API calls rejected with 401.

**Correct approach**:
```typescript
// ✅ CORRECT: Generate fresh DPoP proof per request
async function apiCall(endpoint, method = 'GET') {
  const dpopProof = await generateDPoPProof(method, endpoint);  // Fresh for each request

  return fetch(endpoint, {
    method,
    headers: {
      'Authorization': `DPoP ${token}`,
      'DPoP': dpopProof
    }
  });
}

// Or use SDK's secureFetch — but it is NOT a drop-in fetch replacement.
// secureFetch has three requirements:
// 1. useDPoP must be in the config object (not as a JSX prop)
// 2. URLs must be absolute (new URL() throws on relative paths)
// 3. Authorization: Bearer <token> must be pre-set (SDK upgrades to DPoP scheme)
```

**Pitfall:** `useDPoP` as a JSX prop on `TideCloakProvider`. The provider only accepts `config` and `children`. `useDPoP` must be merged into the config object: `config={{ ...tcConfig, useDPoP: { mode: 'strict', alg: 'ES256' } }}`. VERIFIED (session-002).

**Pitfall:** `secureFetch('/api/vault')` — relative URL. The SDK calls `new URL(url)` internally, which throws `TypeError: Invalid URL` on relative paths. Always use absolute URLs: `secureFetch(\`\${window.location.origin}/api/vault\`)`. VERIFIED (session-002).

**Pitfall:** `secureFetch(url)` without pre-setting `Authorization: Bearer <token>`. The SDK only upgrades to DPoP scheme when it detects an existing Bearer token. Without it, the request is sent as plain fetch with no auth headers. VERIFIED (session-002).

**Pitfall:** Using regular `fetch` with `Bearer` header when `useDPoP` IS configured. DPoP-bound tokens require DPoP proof headers. Sending a DPoP-bound token as `Bearer` causes TideCloak to reject the request.

**Recommended `appFetch` wrapper** for DPoP-enabled apps:
```typescript
// lib/appFetch.ts
import { IAMService } from '@tidecloak/js';

export async function appFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${window.location.origin}${path}`;
  const token = await IAMService.getToken();
  return IAMService.secureFetch(url, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
  });
}
```

**Why this pattern**: `IAMService.secureFetch` detects the `Authorization: Bearer` header and upgrades it to `Authorization: DPoP <token>` while attaching the DPoP proof. Without the pre-set Bearer header, the SDK sends a plain fetch with no auth. Without the absolute URL, `new URL()` throws. This wrapper handles both requirements.

**Related**: Invariants I-12, [Concepts](concepts.md#dpop-demonstration-of-proof-of-possession)

---

## AP-13: Using Adapter JSON Without Tide Extensions

**What it looks like**:
```typescript
// ❌ WRONG: Export generic Keycloak adapter
// Admin Console → Clients → myclient → Installation → Keycloak OIDC JSON

// Result: Missing jwk, vendorId, homeOrkUrl
{
  "realm": "myrealm",
  "auth-server-url": "https://tidecloak.example.com",
  "resource": "myclient",
  ...
  // No Tide extensions
}
```

**Why it's wrong**:
- JWT verification requires embedded JWKS (`jwk` field)
- Client SDK needs Fabric endpoint (`homeOrkUrl`)
- Licensing uses vendor identifier (`vendorId`)
- Generic adapter is insufficient for Tide operations

**Consequence**: JWT verification fails. Client cannot connect to Fabric. Operations fail with unclear errors.

**Correct approach**:
```bash
# ✅ CORRECT: Export Tide adapter with extensions
curl -X GET \
  "${TIDECLOAK_URL}/admin/realms/${REALM}/vendorResources/get-installations-provider?clientId=${CLIENT_ID}&providerId=keycloak-oidc-keycloak-json" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  > data/tidecloak.json
# Note: realm-level endpoint; the client is a query param (clientId=), NOT a /clients/{id}/ path segment.

# Verify Tide extensions present
jq 'has("jwk") and has("vendorId") and has("homeOrkUrl")' data/tidecloak.json
# Should output: true
```

**Related**: Invariants I-04, I-05, I-13, [Concepts](concepts.md#adapter-json)

---

## AP-14: Implementing Custom Token Refresh Logic

**What it looks like**:
```typescript
// ❌ WRONG: Reimplement token refresh
async function refreshToken() {
  const refreshToken = localStorage.getItem('refresh_token');
  const response = await fetch(`${tidecloakUrl}/realms/${realm}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId
    })
  });
  const tokens = await response.json();
  localStorage.setItem('access_token', tokens.access_token);
}
```

**Why it's wrong**:
- SDK already handles token refresh (including PRISM verification)
- Custom logic may skip silent SSO, causing visible redirects
- Manual token storage is error-prone
- May miss DPoP token binding renewal

**Consequence**: Token refresh fails. User forced to re-login. Corrupted auth state.

**Correct approach**:
```typescript
// ✅ CORRECT: Let SDK handle refresh
// SDK automatically refreshes via silent SSO iframe
// Listen to refresh events if needed
iam.on('authRefreshSuccess', () => {
  console.log('Token refreshed automatically');
});

iam.on('authRefreshError', (err) => {
  console.error('Refresh failed, re-login required', err);
  iam.doLogin({ redirectUri: window.location.origin });
});
```

**Related**: [Concepts](concepts.md#silent-sso-token-refresh), [Framework Matrix](framework-matrix.md#silent-sso-setup)

---

## AP-15: Skipping `silent-check-sso.html`

**What it looks like**:
```bash
# ❌ WRONG: Missing silent SSO file
ls public/
# index.html, logo.png, ...
# No silent-check-sso.html
```

**Why it's wrong**:
- Silent token refresh requires hidden iframe
- TideCloak redirects to `/silent-check-sso.html` during refresh
- 404 on this file breaks silent refresh
- User forced to full re-login on every token expiration

**Consequence**: Silent refresh fails. Session appears to expire prematurely. Frequent forced re-logins. Poor UX.

**Correct approach**:
```html
<!-- ✅ CORRECT: Create public/silent-check-sso.html -->
<html>
<body>
  <script>
    parent.postMessage(location.href, location.origin);
  </script>
</body>
</html>
```

**Verification**:
```bash
curl https://app.example.com/silent-check-sso.html
# Should return HTML with postMessage script
```

**Related**: Invariants I-07, [Framework Matrix](framework-matrix.md#silent-sso-setup)

---

## AP-16: Treating Hermetic E2EE as Client-Side Encryption

**What it looks like**:
```markdown
<!-- ❌ WRONG: Docs that imply client-side encryption with server key storage -->
"Hermetic E2EE encrypts data on the client side before sending to the server. Encryption keys are stored securely on the TideCloak server."
```

**Why it's wrong**:
- E2EE session keys are threshold-encrypted via CVK, not stored on server
- Decryption requires live Fabric threshold participation
- "Keys stored on server" defeats E2EE definition
- Plaintext never exists on server, Fabric, or ORKs

**Consequence**: Developer implements client-side encryption with server key storage. Threshold E2EE not used. Security property lost.

**Correct description**:
```markdown
<!-- ✅ CORRECT: Emphasize threshold decryption and no server access -->
"Threshold E2EE (Hermetic E2EE) encrypts data client-side using session keys. Session keys are threshold-encrypted via CVK shards across ORKs. Decryption requires live Fabric threshold participation. Plaintext exists only on user's device; no server, admin, or ORK can decrypt."
```

**Related**: Invariants I-11, [Concepts](concepts.md#threshold-e2ee-hermetic-e2ee)

---

## AP-17: Implementing Ragnarok Without Quorum

**What it looks like**:
```typescript
// ❌ WRONG: Single-admin Ragnarok trigger
app.post('/api/admin/ragnarok', async (req, res) => {
  const jwt = await verifyTideJWT(extractToken(req));
  if (jwt.realm_access.roles.includes('superadmin')) {
    await executeFabricOffboarding();  // No quorum check
    return res.json({ success: true });
  }
});
```

**Why it's wrong**:
- Ragnarok is the sole deviation from never-whole-key invariant
- Reconstructs keys locally; irreversible
- Requires nested threshold quorum for this reason
- Single-admin path defeats governance

**Consequence**: Single compromised admin can trigger irreversible offboarding. Keys reconstructed without quorum approval.

**Correct approach**:
```typescript
// ✅ CORRECT: Ragnarok via IGA quorum approval
// Admin creates change-set for Ragnarok
const changeSet = await createChangeRequest({
  type: 'FABRIC_OFFBOARDING',
  data: { realm: realmId }
});

// Requires quorum approval (same as other admin changes)
// Sealed by threshold signatures before execution
// Irreversible; must have maximum scrutiny
```

**Related**: Invariants I-10, [Concepts](concepts.md#ragnarok-fabric-offboarding)

---

## AP-18: Mixing Tide Roles with Application Roles

**What it looks like**:
```typescript
// ❌ WRONG: Confuse Tide system roles with app roles
const tideRoles = ['_tide_enabled', '_tide_ssn.selfencrypt'];
const appRoles = ['admin', 'editor', 'viewer'];

// Check Tide role for app authorization
if (jwt.realm_access.roles.includes('_tide_ssn.selfencrypt')) {
  // Grant admin access (WRONG)
  return <AdminPanel />;
}
```

**Why it's wrong**:
- Tide roles (`_tide_*`) control cryptographic access (E2EE tags)
- Application roles (`admin`, `editor`) control feature access
- `_tide_ssn.selfencrypt` means "can encrypt SSN field", not "is admin"
- Mixing role types breaks security model

**Consequence**: User with E2EE role gains unintended app privileges. Authorization broken.

**Correct approach**:
```typescript
// ✅ CORRECT: Separate Tide roles from app roles
// Tide E2EE role check
const canEncryptSSN = jwt.realm_access.roles.includes('_tide_ssn.selfencrypt');

// App authorization role check
const isAdmin = jwt.realm_access.roles.includes('admin');

if (canEncryptSSN) {
  // Allow SSN encryption only
  await iam.doEncrypt([{ data: plaintext, tags: ['ssn'] }]);
}

if (isAdmin) {
  // Allow admin features
  return <AdminPanel />;
}
```

**Related**: [Concepts](concepts.md#tag-based-e2ee-roles), [Feature Mapping](feature-mapping.md#e2ee-features)

---

## AP-19: Storing or Handling Passwords Server-Side

**What it looks like**:
```typescript
// ❌ WRONG: Backend receives and validates password
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await db.findUser(username);
  if (await bcrypt.compare(password, user.passwordHash)) {
    return res.json({ token: generateToken(user) });
  }
});
```

**Why it's wrong**:
- TideCloak uses PRISM zero-knowledge verification
- Passwords never leave the browser; verification happens across ORKs
- Server receiving a password means Tide auth is bypassed entirely
- Re-creates single-point-of-trust the architecture eliminates

**Consequence**: Password exposed to server operator. Zero-knowledge property destroyed. Tide threshold authentication bypassed.

**Correct approach**:
```typescript
// ✅ CORRECT: Let TideCloak SDK handle authentication
// Frontend triggers login via SDK
const { login } = useTideCloak();
login({ redirectUri: window.location.origin });

// Backend only verifies the resulting JWT
app.get('/api/protected', async (req, res) => {
  const jwt = await verifyTideJWT(extractToken(req));
  // Password never touches this server
});
```

**Related**: Invariants I-01, I-02, [Concepts](concepts.md#threshold-password-authentication-byoid)

---

## AP-20: Decoding JWT Without Signature Verification

**What it looks like**:
```typescript
// ❌ WRONG: Decode without verify
import jwt_decode from 'jwt-decode';
const claims = jwt_decode(token);
if (claims.realm_access.roles.includes('admin')) {
  // Trust unverified claims
}
```

**Why it's wrong**:
- Decoded-but-unverified JWT is meaningless; anyone can forge claims
- Tide JWTs are VVK threshold-signed; verification proves distributed consensus
- Skipping verification collapses threshold trust to zero trust

**Consequence**: Attacker crafts JWT with arbitrary claims. All authorization decisions compromised.

**Correct approach**:
```typescript
// ✅ CORRECT: Always verify signature against embedded JWKS.
// Named import works (the package ships dual CJS/ESM exports on current versions).
import { verifyTideCloakToken } from "@tidecloak/verify";

// Argument order is (config, token, allowedRoles?) — CONFIG FIRST, then the token.
const verified = await verifyTideCloakToken(tidecloakConfig, token);
// Only trust claims from verified token
```

**Related**: Invariants I-04, I-05, AP-01

---

## AP-21: Storing Dokens Server-Side

**What it looks like**:
```typescript
// ❌ WRONG: Persist Doken on server
app.post('/api/store-session', async (req, res) => {
  const { doken } = req.body;
  await redis.set(`doken:${userId}`, doken);
});
```

**Why it's wrong**:
- Dokens are session-bound to the SWE's ephemeral key
- A Doken cannot be used from a different context than the one that created it
- Storing is pointless (unusable) and a leak risk
- Compromised Doken store exposes session metadata

**Consequence**: Leaked Dokens with no operational benefit. False sense of session persistence.

**Correct approach**:
```typescript
// ✅ CORRECT: Let SDK manage Doken lifecycle in-browser
// Dokens live only in the SWE context
// Server uses JWTs for authorization, not Dokens
const { doken } = useTideCloak(); // Browser-only, never sent to server
```

**Related**: [Concepts](concepts.md#swe-secure-web-enclave)

---

## AP-22: Decrypting on the Server

**What it looks like**:
```typescript
// ❌ WRONG: Server-side decryption
app.get('/api/records/:id', async (req, res) => {
  const encrypted = await db.getRecord(req.params.id);
  const plaintext = await serverDecrypt(encrypted, serverKey);
  return res.json({ data: plaintext });
});
```

**Why it's wrong**:
- Hermetic E2EE means plaintext exists only in the user's browser
- Server decryption is standard server-side encryption, not E2EE
- Server operator gains access to plaintext, defeating the security model
- Threshold decryption requires live Fabric participation from the client

**Consequence**: E2EE property destroyed. Server operator can read all data. No better than standard encryption.

**Correct approach**:
```typescript
// ✅ CORRECT: Decrypt only in the browser via SDK
const plaintext = await iam.doDecrypt([{ encrypted: ciphertext, tags: ['medical'] }]);
// Plaintext never leaves the browser
// Server stores and serves only ciphertext
```

**Related**: Invariants I-11, AP-04, AP-16, [Concepts](concepts.md#threshold-e2ee-hermetic-e2ee)

---

## AP-23: Skipping Tags or Reusing a Single Tag for All Encrypted Data

**What it looks like**:
```typescript
// ❌ WRONG: No tag
const encrypted = await iam.doEncrypt([{ data: plaintext, tags: [] }]);

// ❌ WRONG: Same tag for everything
const encSSN = await iam.doEncrypt([{ data: ssn, tags: ['data'] }]);
const encMedical = await iam.doEncrypt([{ data: medicalRecord, tags: ['data'] }]);
const encNotes = await iam.doEncrypt([{ data: internalNotes, tags: ['data'] }]);
```

**Why it's wrong**:
- Tags define who can decrypt; no tag means no access control
- One tag for all data means anyone with that role decrypts everything
- Different data sensitivity levels require different tags mapped to different roles
- Granular access control is the entire point of tag-based E2EE

**Consequence**: No field-level access control. Any user with the single decrypt role reads all encrypted data regardless of sensitivity.

**Correct approach**:
```typescript
// ✅ CORRECT: Meaningful tags per sensitivity level
const encSSN = await iam.doEncrypt([{ data: ssn, tags: ['ssn'] }]);           // _tide_ssn.selfdecrypt
const encMedical = await iam.doEncrypt([{ data: record, tags: ['medical'] }]); // _tide_medical.selfdecrypt
const encNotes = await iam.doEncrypt([{ data: notes, tags: ['notes'] }]);      // _tide_notes.selfdecrypt
// Each tag has separate encrypt/decrypt roles with different user assignments
```

**Related**: AP-18, [Concepts](concepts.md#tag-based-e2ee-roles)

---

## AP-24: Using Self-Encryption for Shared Data Between Users

**What it looks like**:
```typescript
// ❌ WRONG: Encrypt with doEncrypt, expect other users to doDecrypt
// User A encrypts
const ciphertext = await iam.doEncrypt([{ data, tags: ['shared'] }]);
await api.saveSharedDoc(ciphertext);

// User B tries to decrypt (FAILS even with _tide_shared.selfdecrypt role)
const plaintext = await iam.doDecrypt([{ encrypted: ciphertext, tags: ['shared'] }]);
```

**Why it's wrong**:
- Self-encryption (`doEncrypt`/`doDecrypt` without policy) binds ciphertext to the encrypting user's identity
- Another user with the same `selfdecrypt` role cannot decrypt data encrypted by someone else
- Sharing between users requires policy-governed VVK encryption with a Forseti contract

**Consequence**: Other users cannot decrypt shared data. Silent decryption failures. Data appears locked to the creator.

**Correct approach**:
```typescript
// ✅ CORRECT: Use policy-governed encryption for shared data
const ciphertext = await iam.doEncrypt(data, signedPolicyBytes);
// VVK (organizational key) encrypts; Forseti contract controls who can decrypt
// Any user whose role passes the contract's ValidateExecutor can decrypt
```

**Related**: AP-11, [Concepts](concepts.md#threshold-e2ee-hermetic-e2ee)

---

## AP-25: Using `_tide_*` Roles in Forseti ValidateExecutor

**What it looks like**:
```csharp
// ❌ WRONG: Checking voucher gate role in contract (also: role lives on the doken, not a "user")
public PolicyDecision ValidateExecutor(ExecutorContext ctx) {
    return ctx.Doken.HasRole("_tide_medical.selfdecrypt")
        ? PolicyDecision.Allow() : PolicyDecision.Deny("no");
}
```

**Why it's wrong**:
- `_tide_{tag}.selfencrypt/selfdecrypt` roles are voucher gates only; they enable the ORK operation type
- Forseti contracts should check regular realm roles for access control decisions
- To restrict who can decrypt, remove the regular role from users, not the voucher gate roles
- Mixing voucher gates with policy logic conflates two separate layers

**Consequence**: Access control logic tied to wrong role type. Revoking a voucher gate disables the entire operation rather than just the policy decision.

**Correct approach**:
```csharp
// ✅ CORRECT: Check a regular realm role on the executor's doken (DokenDto.HasRole),
// not a "user" object. The role check target is the doken, per Ork.Forseti.Sdk.
public PolicyDecision ValidateExecutor(ExecutorContext ctx) {
    return ctx.Doken.HasRole("shared-data-access")
        ? PolicyDecision.Allow() : PolicyDecision.Deny("not allowed");
}
// Voucher gate roles (_tide_*) are assigned separately to enable the ORK operation
```

**Related**: AP-18, AP-11

---

## AP-26: Renaming Self-Encryption Roles to Enable Shared Decryption

**What it looks like**:
```typescript
// ❌ WRONG: Replace selfencrypt/selfdecrypt with encrypt/decrypt
// expecting this to make ciphertext decryptable by other users
// Before (correct for self-encryption):
//   _tide_vault.selfencrypt / _tide_vault.selfdecrypt
// After (incorrect "fix"):
//   _tide_vault.encrypt / _tide_vault.decrypt
const ciphertext = await doEncrypt([{ data: secret, tags: ['vault'] }]);
// Still uses doEncrypt from useTideCloak() — still self-encryption
// Changing role names does not change the encryption model
```

**Why it's wrong**:
- The `doEncrypt`/`doDecrypt` calls on `useTideCloak()` always perform self-encryption regardless of the role suffix
- Changing `selfencrypt` → `encrypt` in the role name does not switch the encryption model
- Self-encryption binds ciphertext to the encrypting user's CVK. The role suffix is a naming convention; the SDK call path determines the encryption model.
- To switch from self-encryption to shared encryption, you must change the SDK call to `IAMService.doEncrypt(data, signedPolicyBytes)`, deploy a Forseti contract, and sign a policy

**Consequence**: App appears to support shared access but does not. Other users still cannot decrypt. Data locked to creator. Silent failures.

**Correct approach**:
- For self-encryption (user-private data): keep `_tide_{tag}.selfencrypt` / `_tide_{tag}.selfdecrypt` and use `doEncrypt`/`doDecrypt` from `useTideCloak()`
- For shared encryption: use generic voucher gates (e.g., `_tide_x.selfencrypt`/`_tide_x.selfdecrypt`), add a regular realm role for the Forseti contract (e.g., `shared-data-access`), deploy a Forseti contract, sign the policy, and call `IAMService.doEncrypt(data, signedPolicyBytes)`
- These are different SDK call paths and different bootstrap flows — not a role rename

**Related**: AP-24, [Concepts](concepts.md#self-encryption-vs-policy-governed-vvk-encryption)

---

## AP-27: Using `configFilePath` Instead of `configUrl`

**What it looks like**:
```tsx
// ❌ WRONG: Wrong prop name
<TideCloakContextProvider configFilePath="/tidecloak.json">
  <App />
</TideCloakContextProvider>
```

**Why it's wrong**:
- `TideCloakContextProvider` accepts `configUrl`, not `configFilePath`
- Wrong prop name falls through to the default `/adapter.json`, which does not exist
- Vite serves the HTML index page instead of JSON
- Results in `SyntaxError: Unexpected token '<', "<!doctype "... is not valid JSON`

**Consequence**: SDK initialization fails. Cryptic JSON parse error. Application cannot start.

**Correct approach**:
```tsx
// ✅ CORRECT (React/Vite): Use configUrl pointing to public/tidecloak.json
<TideCloakContextProvider configUrl="/tidecloak.json">
  <App />
</TideCloakContextProvider>

// ✅ CORRECT (Next.js): Use configUrl pointing to API route that serves data/tidecloak.json
<TideCloakContextProvider configUrl="/api/config">
  <App />
</TideCloakContextProvider>
```

**Note**: The SDK default `configUrl` is `/adapter.json`, not `/tidecloak.json`. Always set `configUrl` explicitly. For Next.js, config lives in `data/tidecloak.json` (server-side); serve it via an API route at `app/api/config/route.ts`.

**Related**: AP-13

---

## AP-28: Calling login() Before SDK Initialization

**What it looks like**:
```tsx
// ❌ WRONG: Guards render during init, exposing login too early
function App() {
  return (
    <TideCloakContextProvider configUrl="/tidecloak.json">
      <Authenticated><Dashboard /></Authenticated>
      <Unauthenticated><LoginPage /></Unauthenticated>
    </TideCloakContextProvider>
  );
}

function LoginPage() {
  const { login } = useTideCloak();
  // login() called before SDK ready → "TideCloak client not initialized"
  return <button onClick={login}>Login</button>;
}
```

**Why it's wrong**:
- `<Unauthenticated>` renders during initialization (user is not yet authenticated)
- Child components get exposed before SDK is ready
- Calling `login()` before `initIAM()` completes throws an error
- The SDK exposes `isInitializing` (not `initialized`) to gate this

**Consequence**: Runtime error. Login button crashes the app on click.

**Correct approach**:
```tsx
// ✅ CORRECT: Block the tree until SDK is ready
function AppContent() {
  const { isInitializing } = useTideCloak();
  if (isInitializing) return <p>Initializing TideCloak...</p>;
  return (
    <>
      <Authenticated><Dashboard /></Authenticated>
      <Unauthenticated><LoginPage /></Unauthenticated>
    </>
  );
}
```

**Related**: AP-14, AP-15

---

## AP-29: Using hasRealmRole for tide-realm-admin

**What it looks like**:
```typescript
// ❌ WRONG: Checking as realm role
if (useTideCloak().hasRealmRole('tide-realm-admin')) {
  return <AdminPanel />;
}
// Always returns false; admin UI never shows
```

**Why it's wrong**:
- `tide-realm-admin` is a client role on the `realm-management` client, not a realm role
- `hasRealmRole()` checks `realm_access.roles` in the JWT
- The role lives under `resource_access["realm-management"].roles`
- Using the wrong check means admins never see admin UI

**Consequence**: Admin functionality invisible. Developers assume role assignment is broken.

**Correct approach**:
```typescript
// ✅ CORRECT: Check as client role on realm-management
if (useTideCloak().hasClientRole('tide-realm-admin', 'realm-management')) {
  return <AdminPanel />;
}
```

**Related**: AP-02, AP-18

---

## AP-30: (Resolved) @tidecloak/verify Import Style

**Status**: The old CJS-only interop workaround is **no longer required** on current versions. `@tidecloak/verify` now ships a proper dual `exports` map (`import` → ESM, `require` → CJS), so a plain named import works in both ESM and CJS callers.

**Correct approach**:
```typescript
// ✅ CORRECT: Plain named import (works in ESM and CJS on current versions)
import { verifyTideCloakToken } from "@tidecloak/verify";
// CJS callers: const { verifyTideCloakToken } = require("@tidecloak/verify");

// Argument order is (config, token, allowedRoles?) — config FIRST (see AP-20).
const payload = await verifyTideCloakToken(tidecloakConfig, token);
```

Do NOT reintroduce the `const _mod = (TideJWT as any)?.default ?? TideJWT` dance — it targeted an older single-export build. If a named import genuinely fails, you are on a very old version; upgrade rather than adding interop shims.

**Related**: AP-01, AP-20

---

## AP-31: Bypassing Change Request Workflow

**What it looks like**:
```typescript
// ❌ WRONG: Direct DB write for role assignment
app.post('/api/admin/assign-role', async (req, res) => {
  await db.query('INSERT INTO user_role_mapping (user_id, role_id) VALUES ($1, $2)',
    [req.body.userId, req.body.roleId]);
  return res.json({ success: true });
});
```

**Why it's wrong**:
- All role/permission changes must go through IGA draft/approve/commit lifecycle
- Direct DB writes do not produce VVK-signed authorization proofs
- ORKs reject JWTs that do not match a signed proof
- Bypasses quorum governance entirely

**Consequence**: Users get roles in DB but JWTs lack valid proofs. ORKs reject operations. Governance defeated.

**Correct approach**:
```typescript
// ✅ CORRECT: Use IGA change request API
const changeRequest = await adminClient.changeRequests.create({
  type: 'ROLE_ASSIGNMENT',
  userId: req.body.userId,
  roleId: req.body.roleId
});
// Change request goes through draft → approve (quorum) → commit
```

**Related**: AP-05, AP-10, Invariants I-09, I-10

---

## AP-32: Destructuring ApprovalType/ExecutionType from Models.Policy

**What it looks like**:
```typescript
// ❌ WRONG: Destructure from Models.Policy (it's a class, not a namespace)
const { ApprovalType, ExecutionType } = Models.Policy;
// ApprovalType is undefined
// TypeError: Cannot read properties of undefined (reading 'IMPLICIT')
```

**Why it's wrong**:
- `Models.Policy` is the Policy class itself
- `ApprovalType` and `ExecutionType` are direct exports from `Models`, not nested under `Policy`
- Destructuring from the class yields `undefined` for both

**Consequence**: Runtime TypeError. Policy construction fails.

**Correct approach**:
```typescript
// ✅ CORRECT: Destructure from Models directly
const { Policy, ApprovalType, ExecutionType, BaseTideRequest } = Models;
const policy = new Policy(
  ApprovalType.IMPLICIT,
  ExecutionType.SIGN,
  // ...
);
```

**Related**: AP-11

---

## AP-33: Building PolicySignRequest Manually

**What it looks like**:
```typescript
// ❌ WRONG: Manual construction with BaseTideRequest + TideMemory
const request = new BaseTideRequest();
request.setModelId("Policy:1");
const memory = new TideMemory();
memory.write(policy.toBytes());
request.setPayload(memory.toBytes());
```

**Why it's wrong**:
- The ORK's `PolicySignRequestFactory` expects a specific internal structure
- Manual construction produces bytes the ORK cannot parse
- `PolicySignRequest.New()` from `heimdall-tide` handles the correct serialization

**Consequence**: ORK rejects the request with parse errors. Policy signing fails.

**Correct approach**:
```typescript
// ✅ CORRECT: Use the factory method
import { PolicySignRequest } from "heimdall-tide";
const signRequest = PolicySignRequest.New(policy);
```

**Related**: AP-11

---

## AP-34: Mounting Project Root as H2 Data Volume

**What it looks like**:
```yaml
# ❌ WRONG: docker-compose.yml
volumes:
  - .:/opt/keycloak/data/h2
```

**Why it's wrong**:
- Docker writes H2 database files as a different user (UID 1000)
- Mounting project root causes `AccessDeniedException`
- Database files mixed with source code
- Container cannot start or corrupts on write

**Consequence**: TideCloak container fails to start. `AccessDeniedException` on H2 database files.

**Correct approach**:
```yaml
# ✅ CORRECT: Use a dedicated data subdirectory
volumes:
  - ./data:/opt/keycloak/data/h2
# Also ensure correct ownership:
# mkdir -p ./data && sudo chown -R 1000:1000 ./data
```

**Related**: AP-07

---

## AP-35: Skipping or Reordering Initialization Sequence

**What it looks like**:
```bash
# ❌ WRONG: Skip license activation, jump to IGA
curl -X POST "$KC_URL/admin/realms" -d '{"realm":"myrealm","enabled":true}'
curl -X POST "$KC_URL/admin/realms/myrealm/tide-admin/toggle-iga"
# Missing: setUpTideRealm, approve/commit, user creation, invite link...
```

**Why it's wrong**:
- The initialization sequence is strict: (1) create realm, (2) setUpTideRealm with email, (3) enable IGA, (4) approve/commit client change requests, (5) create admin user + assign role, (6) generate invite link, (7) approve/commit user change requests, (8) update CustomAdminUIDomain, (9) download adapter config
- Skipping steps or reordering causes silent failures
- `setUpTideRealm` activates the license and VRK; without it, nothing else works

**Consequence**: Silent failures. Missing VRK. IGA toggle fails. Invite links not generated. Adapter config incomplete.

**Correct approach**:
```bash
# ✅ CORRECT: Follow exact sequence
# 1. Create realm
# 2. POST /admin/realms/{realm}/vendorResources/setUpTideRealm (form-urlencoded, with email)
# 3. POST /admin/realms/{realm}/tide-admin/toggle-iga   (NOT /vendorResources/toggle-iga)
# 4. Approve + commit client change requests (iga/change-requests/{id}/authorize|commit)
# 5. Create admin user + assign tide-realm-admin
# 6. Generate invite link + wait for account linking
# 7. Approve + commit user change requests
# 8. Update CustomAdminUIDomain
# 9. Download adapter config
```

**Related**: AP-13, AP-27

---

## AP-36: Omitting Tide Environment Variables from Docker

**What it looks like**:
```yaml
# ❌ WRONG: Incomplete docker-compose.yml
services:
  tidecloak:
    image: tideorg/tidecloak-dev:latest
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: admin
      KC_BOOTSTRAP_ADMIN_PASSWORD: admin
    # Missing: SYSTEM_HOME_ORK, USER_HOME_ORK, THRESHOLD_T, THRESHOLD_N,
    #          PAYER_PUBLIC, KC_HOSTNAME
```

**Why it's wrong**:
- Without `SYSTEM_HOME_ORK` and `USER_HOME_ORK`, the Tide IdP provider does not initialize
- Without `THRESHOLD_T` and `THRESHOLD_N`, threshold parameters are undefined
- Required actions like `link-tide-account-action` never register
- Init script fails with "Could not find configuration for Required Action"

**Consequence**: TideCloak starts but Tide features are non-functional. Init scripts fail. No invite links. No threshold operations.

**Correct approach**:
```yaml
# ✅ CORRECT: All required environment variables
services:
  tidecloak:
    image: tideorg/tidecloak-dev:latest
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: admin
      KC_BOOTSTRAP_ADMIN_PASSWORD: admin
      KC_HOSTNAME: localhost
      SYSTEM_HOME_ORK: "https://orkeyedev01-g2.australiaeast.cloudapp.azure.com:443"
      USER_HOME_ORK: "https://orkeyedev01-g2.australiaeast.cloudapp.azure.com:443"
      THRESHOLD_T: "3"
      THRESHOLD_N: "5"
      PAYER_PUBLIC: "<your-payer-public-key>"
```

**Related**: AP-35, AP-08

---

## AP-37: Auto-Approving IGA Role Assignments from Backend

**What it looks like**:
```typescript
// ❌ WRONG: Backend tries to complete approval programmatically
app.post('/api/admin/quick-approve', async (req, res) => {
  const { changeRequestId } = req.body;
  await adminClient.changeRequests.approve(changeRequestId);
  await adminClient.changeRequests.commit(changeRequestId);
  return res.json({ success: true });
});
```

**Why it's wrong**:
- Role assignments that produce VVK-signed UserContexts require the approval enclave in the admin's browser
- The backend receives `requiresApprovalPopup: true` and cannot complete the signing
- VVK signing is a threshold operation that must involve the SWE
- Programmatic approval bypasses the cryptographic ceremony

**Consequence**: Approval call returns `requiresApprovalPopup: true` but signing never completes. Change request stuck. If somehow bypassed, JWTs lack valid proofs.

**Correct approach**:
```typescript
// ✅ CORRECT: Build frontend approval UI
// Backend exposes pending change requests
app.get('/api/admin/pending', async (req, res) => {
  const pending = await adminClient.changeRequests.list({ status: 'PENDING' });
  return res.json(pending);
});

// Frontend presents approval UI; admin's browser enclave handles signing
// Use batch endpoints for efficiency
await fetch('/api/admin/sign/batch', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${adminToken}`, 'DPoP': dpopProof },
  body: JSON.stringify({ changeRequestIds })
});
// Approval popup appears in admin's browser → SWE performs threshold signing
```

**Related**: AP-05, AP-10, AP-31, Invariants I-09, I-10

---

## AP-38: Duplicating tidecloak.json Config into NEXT_PUBLIC Env Vars

**What it looks like**:
```bash
# .env.local
NEXT_PUBLIC_TIDECLOAK_URL=http://localhost:8080
NEXT_PUBLIC_TIDECLOAK_REALM=my-app
NEXT_PUBLIC_TIDECLOAK_CLIENT_ID=my-app-client
NEXT_PUBLIC_TIDECLOAK_REDIRECT_URI=http://localhost:3000/auth/redirect
```

```tsx
// ❌ WRONG: Provider reads env vars instead of tidecloak.json
<TideCloakContextProvider
  authServerUrl={process.env.NEXT_PUBLIC_TIDECLOAK_URL}
  realm={process.env.NEXT_PUBLIC_TIDECLOAK_REALM}
  clientId={process.env.NEXT_PUBLIC_TIDECLOAK_CLIENT_ID}
  redirectUri={process.env.NEXT_PUBLIC_TIDECLOAK_REDIRECT_URI}
/>
```

**Why it's wrong**:
- `tidecloak.json` already contains `auth-server-url`, `realm`, `resource` (clientId), and all Tide-specific fields
- Duplicating these into env vars creates two sources of truth
- Env vars can drift from the actual adapter JSON exported from TideCloak
- `NEXT_PUBLIC_*` env vars expose config in client-side bundles unnecessarily

**Consequence**: Config drift between env vars and adapter JSON. Debugging breaks because the two sources disagree. New developers add env vars instead of exporting the adapter.

**Correct approach**:
```tsx
// ✅ CORRECT: Import tidecloak.json directly
import tcConfig from '../../data/tidecloak.json';

<TideCloakProvider config={tcConfig}>
  {children}
</TideCloakProvider>
```

For deployment without a file: use `CLIENT_ADAPTER` env var containing the full JSON. Do not split it into individual vars.

**Related**: I-05, I-13

---

## AP-39: Appending `start-dev` to TideCloak Docker Run

**What it looks like**:
```bash
# ❌ WRONG: Appending start-dev command
docker run -d --name tidecloak \
  -p 8080:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME="${KC_BOOTSTRAP_ADMIN_USERNAME:-admin}" \
  -e KC_BOOTSTRAP_ADMIN_PASSWORD="$KC_BOOTSTRAP_ADMIN_PASSWORD" \
  tideorg/tidecloak-dev:latest start-dev
```

**Why it's wrong**:
- TideCloak images are NOT vanilla Keycloak. The entrypoint is pre-configured.
- Passing `start-dev` overrides the container's built-in entrypoint/command and breaks Tide-specific initialization.
- This is a Keycloak convention (`kc.sh start-dev`) that does not apply to TideCloak Docker images.

**Consequence**: Container may start in wrong mode, fail to initialize Tide providers, or exit immediately.

**Correct approach**:
```bash
# ✅ CORRECT: No command argument — image handles startup internally
sudo docker run -d --name tidecloak \
  -v ./data:/opt/keycloak/data/h2 \
  -p 8080:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME="${KC_BOOTSTRAP_ADMIN_USERNAME:-admin}" \
  -e KC_BOOTSTRAP_ADMIN_PASSWORD="$KC_BOOTSTRAP_ADMIN_PASSWORD" \
  tideorg/tidecloak-dev:latest
```

Do not append `start-dev`, `start`, or any other command to `docker run` for TideCloak images.

**Related**: AP-36

---

## AP-40: Using Wrong Docker Org for TideCloak Images

**What it looks like**:
```bash
# ❌ WRONG: tidecloak/ org does not exist
docker run -d tideorg/tidecloak-dev:latest    # ← this is correct
docker run -d tidecloak/tidecloak-dev:latest   # ← WRONG org name
```

**Why it's wrong**:
- TideCloak images are published under the `tideorg` Docker Hub organization, not `tidecloak`.
- AI agents frequently hallucinate `tidecloak/tidecloak-dev` because the product is called TideCloak.
- `docker pull tidecloak/tidecloak-dev` will fail with "repository does not exist".

**Consequence**: Image pull fails. Container never starts.

**Correct approach**:
```bash
# ✅ CORRECT: tideorg/ org, and tidecloak-dev is the only supported image
docker run -d tideorg/tidecloak-dev:latest
```

The org is `tideorg`, not `tidecloak`. And `tidecloak-dev` — despite the suffix — IS the production image; `tidecloak-stg-dev` is an internal pre-release build and is not supported.

**Related**: AP-39

---

## Anti-Pattern Detection Checklist

### Code Review
- [ ] No local key generation for Tide operations (AP-03)
- [ ] No client-side policy enforcement (AP-11)
- [ ] No single-admin bypass paths (AP-05)
- [ ] No offline E2EE fallbacks (AP-04)
- [ ] No hardcoded 14/20 threshold (AP-08)
- [ ] No cached DPoP headers (AP-12)
- [ ] Server-side JWT verification on all protected APIs (AP-02)
- [ ] Embedded JWKS used, not remote endpoint (AP-01)
- [ ] No `createRemoteJWKSet` import or usage (AP-01)
- [ ] No server-side password handling (AP-19)
- [ ] JWT signature always verified, never just decoded (AP-20)
- [ ] Dokens never stored server-side (AP-21)
- [ ] No server-side decryption of E2EE data (AP-22)
- [ ] Meaningful unique tags on every encrypted field (AP-23)
- [ ] Self-encryption not used for shared data (AP-24)
- [ ] `_tide_*` roles not used in Forseti ValidateExecutor (AP-25)
- [ ] No non-deterministic calls in Forseti contracts (AP-26)
- [ ] `hasClientRole` used for tide-realm-admin, not `hasRealmRole` (AP-29)
- [ ] Default import used for @tidecloak/verify (AP-30)
- [ ] No direct DB writes bypassing change requests (AP-31)
- [ ] `ApprovalType`/`ExecutionType` destructured from `Models`, not `Models.Policy` (AP-32)
- [ ] `PolicySignRequest.New()` used, not manual construction (AP-33)
- [ ] No backend auto-approval of IGA role assignments (AP-37)
- [ ] Policy constructed with all five fields and **singular** `modelId` (AP-60)
- [ ] No hand-written Models/Policy type diverging from the runtime constructor (AP-61)
- [ ] `modelId` is a registered id or `BasicCustom<...>`; `request.id() === policy.modelIds[0]` (AP-65)
- [ ] Contract transport has the outer `"forseti"` level (AP-64)
- [ ] `contractId` is UPPERCASE SHA-512 hex, `/^[0-9A-F]{128}$/` (L-14)
- [ ] Admin policy matched by name `tide-realm-admin`, no `?? policies[0]` (AP-63)
- [ ] Contract identity checks compare the **vuid**, not the JWT subject (AP-66)
- [ ] Contract compiles locally against the stub harness before deploy (AP-67)
- [ ] No `tokenParsed` (or other keycloak-js property) read off the TideCloak context (AP-69)
- [ ] Identity fields **fail closed** — no `?? '—'` on a confirmation screen (AP-69)
- [ ] No error path discards the server's response body (see troubleshooting Diagnostic Principle)
- [ ] No issuer-hosted `/verify` returning a bare verdict (AP-68)
- [ ] Migration compatibility gated on **EdDSA** support before being promised (AP-82)
- [ ] No install step sources a runtime artifact from `sources/`; correctness decided by behaviour (AP-83)
- [ ] `/tide_dpop/:path*` rewrite is a **wildcard**, static (not a route handler) (AP-70)
- [ ] CSP is exactly `frame-src 'self' *` — no `frame-ancestors` added (AP-71)
- [ ] Relay path serves its own CSP **and** `Allow-CSP-From: *`, verified with `curl -D -` (AP-70/71)
- [ ] No admin mutation trusts a `2xx` — drain, then read back (AP-72)
- [ ] Role checks require `{client, role}` pairs, not bare role names (AP-75)
- [ ] `modelId` is not a bare `Custom<X>:Custom<1>`; EXPLICIT flows pre-wrap with `Custom<…>` (AP-76/77)
- [ ] No `as any` + `!` in the deployment path; `Models` and `Tools` destructured separately (AP-78)
- [ ] No realm template declares a `tide-*` protocolMapper — no such provider exists (AP-80)

### Deployment Check
- [ ] CSP includes Tide domains (AP-07)
- [ ] `silent-check-sso.html` exists (AP-15)
- [ ] Adapter JSON has Tide extensions (AP-13)
- [ ] DPoP verification implemented if enabled (AP-06)
- [ ] `tide_dpop_auth.html` present AND known-good — run `scripts/check-dpop-asset.sh` (AP-62)
- [ ] `/tide_dpop/:path*` route + CSP wired (missing page 404s the popup; worse than stale)
- [ ] `configUrl` prop used, not `configFilePath` (AP-27)
- [ ] SDK initialization gate before login (AP-28)
- [ ] No `NEXT_PUBLIC_TIDECLOAK_*` env vars duplicating tidecloak.json (AP-38)
- [ ] Data volume is `./data`, not project root (AP-34)
- [ ] Initialization sequence followed in correct order (AP-35)
- [ ] All Tide environment variables present in Docker config (AP-36)

### Documentation Review
- [ ] Tide not described as generic OIDC (AP-01)
- [ ] BYOiD not conflated with federated login (AP-09)
- [ ] IGA not downplayed as procedural workflow (AP-10)
- [ ] E2EE not described as client-side encryption (AP-16)
- [ ] UI gating vs authorization clearly distinguished (AP-02)

---

## Severity Classification

| Anti-Pattern | Security Impact | Operational Impact | Detection Difficulty |
|--------------|----------------|-------------------|---------------------|
| AP-01 | **CRITICAL** | High | Medium |
| AP-02 | **CRITICAL** | Low | Easy |
| AP-03 | **CRITICAL** | High | Easy |
| AP-04 | **HIGH** | Medium | Medium |
| AP-05 | **CRITICAL** | Low | Medium |
| AP-06 | **HIGH** | Low | Easy |
| AP-07 | **HIGH** | **CRITICAL** | Easy |
| AP-08 | Low | **HIGH** | Easy |
| AP-09 | **HIGH** (misleading) | Medium | Hard |
| AP-10 | **HIGH** (misleading) | Medium | Hard |
| AP-11 | **CRITICAL** | Low | Medium |
| AP-12 | Low | **HIGH** | Easy |
| AP-13 | **HIGH** | **CRITICAL** | Easy |
| AP-14 | Low | **HIGH** | Medium |
| AP-15 | Low | **HIGH** | Easy |
| AP-16 | **HIGH** (misleading) | Low | Hard |
| AP-17 | **CRITICAL** | **CRITICAL** | Medium |
| AP-18 | **HIGH** | Low | Medium |
| AP-19 | **CRITICAL** | Low | Easy |
| AP-20 | **CRITICAL** | Low | Easy |
| AP-21 | Medium | Low | Easy |
| AP-22 | **CRITICAL** | Low | Easy |
| AP-23 | **HIGH** | Low | Medium |
| AP-24 | **HIGH** | Medium | Hard |
| AP-25 | **HIGH** | Low | Medium |
| AP-26 | **HIGH** | **HIGH** | Medium |
| AP-27 | Low | **CRITICAL** | Easy |
| AP-28 | Low | **HIGH** | Easy |
| AP-29 | Low | **HIGH** | Easy |
| AP-30 | Low | **CRITICAL** | Easy |
| AP-31 | **CRITICAL** | Medium | Medium |
| AP-32 | Low | **HIGH** | Easy |
| AP-33 | Low | **HIGH** | Medium |
| AP-34 | Low | **CRITICAL** | Easy |
| AP-35 | **HIGH** | **CRITICAL** | Medium |
| AP-36 | Medium | **CRITICAL** | Easy |
| AP-37 | **CRITICAL** | **HIGH** | Medium |
| AP-60 | Low | **HIGH** | Easy — throws a bare string immediately |
| AP-61 | Low | **HIGH** | **Hard** — typechecks clean; that is the defect |
| AP-62 | Medium | **CRITICAL** | **Hard** — blank popup is normal, page returns 200 |
| AP-63 | **HIGH** | Medium | **Hard** — correct until a second policy exists |
| AP-64 | Low | **CRITICAL** | **Hard** — fails after the enclave approval |
| AP-65 | Low | **CRITICAL** | **Hard** — fails after the enclave approval |
| AP-66 | **HIGH** | **HIGH** | **Hard** — denies every signature, post-approval |
| AP-67 | Low | **HIGH** | Easy — once the harness exists |
| AP-68 | **CRITICAL** | Low | Medium — the endpoint "works" |
| AP-69 | **HIGH** | Medium | **Hard** — fails silently, no error anywhere |
| AP-70 | Low | **CRITICAL** | **Hard** — the error blames the relay file, not the URL |
| AP-71 | Low | **CRITICAL** | **Hard** — reads as a Tide bug, is self-inflicted |
| AP-72 | Medium | **CRITICAL** | **Hard** — 2xx + green log + empty realm |
| AP-73 | Medium | **HIGH** | Medium — 401s appear only once DPoP is on |
| AP-74 | Low | **HIGH** | **Hard** — error names nothing in your code |
| AP-75 | **HIGH** | **HIGH** | **Hard** — UI and API gates agree, wrongly |
| AP-76 | Low | **CRITICAL** | **Hard** — fails after the approval, with a misleading type name |
| AP-77 | Low | **CRITICAL** | **Hard** — the exemplar it copies works, for a reason that does not transfer |
| AP-78 | Low | **CRITICAL** | **Hard** — throws AFTER the network signed |
| AP-79 | Low | **CRITICAL** | Easy once known — irreversible when not |
| AP-80 | Medium | **HIGH** | **Hard** — 201 Created, mapper silently dropped, roles vanish with no error |
| AP-82 | Low | **CRITICAL** | Easy to check, easy to promise wrongly — every request 401s after the swap |
| AP-83 | Medium | **CRITICAL** | **Very hard** — the wrong conclusion looks rigorous and gets recorded as VERIFIED |
| AP-84 | High | Medium | **Very hard** — a pin never fails, and the obvious fix (Docker Hub) preserves the bug as a silent downgrade |
| AP-85 | Medium | Medium | Easy to check, and the fake data is indistinguishable from real data once written |
| AP-86 | High | **HIGH** | **Very hard** — failure and discovery are far apart, and the evidence is deleted before anyone looks |
| AP-87 | High | Low | **Hard** — the agent does the work well and reports it, so nothing looks broken |

> AP-38 through AP-59 predate this table and are not classified here. Treat the omission as a known
> gap in this section, not as an assessment of low severity.

**Impact levels**:
- **CRITICAL**: Defeats core Tide security properties or causes complete failure
- **HIGH**: Creates exploitable weakness or major operational failure
- **Medium**: Degrades security or reliability
- **Low**: Minor issue or inconvenience

---

## Recovery from Anti-Patterns

### If AP-01 detected (Generic OIDC treatment / remote JWKS)
1. Remove all `createRemoteJWKSet` imports and usage
2. Replace with `createLocalJWKSet(config.jwk)` using embedded JWKS from adapter JSON
3. Add guard: `if (!config.jwk) throw new Error('Missing jwk in tidecloak.json')`
4. Verify adapter has `jwk`, `vendorId`, `homeOrkUrl` fields
5. If `jwk` is missing, re-export adapter from TideCloak with IGA enabled — do not add remote fallback
6. Review all auth code for Tide-specific patterns

### If AP-02 detected (Client-side authorization)
1. Add `verifyTideJWT()` to all protected API routes
2. Move role checks server-side
3. Keep client-side `hasRealmRole()` / `hasClientRole()` for UI gating only

### If AP-03 detected (Local key generation)
1. Remove all local key generation code
2. Replace with SDK operations (`doEncrypt`, `executeSignRequest`)
3. Verify keys never assembled locally

### If AP-05 detected (Single-admin bypass)
1. Remove bypass paths
2. Route all admin changes through IGA change-set API
3. Document that no emergency override exists

### If AP-07 detected (Missing CSP)
1. Add CSP with Tide domain whitelist
2. Test SWE iframe loads successfully
3. Monitor browser console for CSP violations

### If AP-13 detected (Wrong adapter format)
1. Re-export adapter via Tide-specific endpoint
2. Verify `jwk`, `vendorId`, `homeOrkUrl` present
3. Replace generic adapter in all environments

### If AP-19 detected (Server-side password handling)
1. Remove all password fields from API request handlers
2. Ensure login is delegated entirely to TideCloak SDK
3. Backend must only verify JWTs, never receive credentials

### If AP-22 detected (Server-side decryption)
1. Move all decryption to the browser via `iam.doDecrypt()`
2. Server stores and serves ciphertext only
3. Verify no plaintext exists in server logs or responses

### If AP-31 detected (Direct DB writes)
1. Replace all direct DB role/permission writes with IGA change request API
2. Verify all changes go through draft/approve/commit lifecycle
3. Audit DB for rows not backed by VVK-signed proofs

### If AP-35 detected (Wrong init sequence)
1. Reset the realm (delete and recreate)
2. Follow the exact 9-step initialization sequence
3. Verify each step completes before proceeding to the next

### If AP-36 detected (Missing Docker env vars)
1. Add all required variables: `SYSTEM_HOME_ORK`, `USER_HOME_ORK`, `THRESHOLD_T`, `THRESHOLD_N`, `PAYER_PUBLIC`, `KC_HOSTNAME`
2. Restart the container
3. Verify `link-tide-account-action` is registered in Required Actions

---

## AP-41: Using Master Admin Credentials in Generated App Code

> ### ⚠️ Corollary: the password itself belongs in `.env`, and a DEFAULT is still hardcoded
>
> AP-41 is usually read as "don't call the master token endpoint from app code". It also covers the
> credential's *storage*, and the most common violation in bootstrap tooling is subtler than a literal
> secret:
>
> ```bash
> # ❌ all three are hardcoded credentials
> -d "username=admin&password=password&grant_type=password&client_id=admin-cli"
> -e KC_BOOTSTRAP_ADMIN_PASSWORD=password
> KC_ADMIN_PASSWORD="${KC_ADMIN_PASSWORD:-password}"      # a DEFAULT is the same thing
> ```
>
> A default password is a hardcoded credential with extra steps: it ships to whoever runs the script
> next, and it silently becomes the real password on every machine where nobody set the variable.
>
> ```bash
> # ✅ read from the environment (loading .env if present), and FAIL when unset
> if [ -f ".env" ]; then set -a; . "./.env"; set +a; fi
> if [ -z "${KC_BOOTSTRAP_ADMIN_PASSWORD:-}" ]; then
>   echo "ERROR: KC_BOOTSTRAP_ADMIN_PASSWORD is not set. cp .env.template .env and set it." >&2
>   exit 1
> fi
> curl ... --data-urlencode "password=$KC_BOOTSTRAP_ADMIN_PASSWORD"   # survives & = + in the value
> ```
>
> **Confirm `.env` is gitignored BEFORE telling anyone to put a secret in it.** Start from
> `templates/shared/.env.template`. Beyond local Docker, inject from a secret manager rather than a
> file. And remember the token minted from this credential lives **~60 seconds** — mint on demand
> server-side; never export one and assume it lasts.
>
> A literal on a command line also lands in shell history, CI logs and `ps` output, so the exposure is
> wider than the file you put it in.
>
> **Regression gates** (`mcp-server` content tests): a literal assignment in any active script/config
> fails; a copyable `-e KC_BOOTSTRAP_ADMIN_PASSWORD=<literal>` in docs fails; and any template shipping
> a `.env.example`/`.env.template` must gitignore `.env`. All three verified to fail on reintroduction.

**What it looks like**:
```typescript
// ❌ WRONG: API route fetches users with hardcoded master credentials
const tokenRes = await fetch(`${tcUrl}/realms/master/protocol/openid-connect/token`, {
  method: 'POST',
  body: new URLSearchParams({
    grant_type: 'password',
    username: 'admin',
    password: 'password',
    client_id: 'admin-cli',
  }),
});
```

**Why it's wrong**:
- Master credentials (`admin`/`password`) are bootstrap-only. They should only appear in `scripts/init-tidecloak.sh`.
- Hardcoding them in API routes leaks bootstrap secrets into the running app.
- It bypasses the logged-in user's authorization scope — the app acts as a superadmin for every request.
- It breaks when credentials change.

**Correct approach**: Forward the logged-in user's token to TideCloak admin APIs:
```typescript
// ✅ CORRECT: Use the logged-in user's token
const userToken = req.headers.get('authorization')?.replace('Bearer ', '');
const res = await fetch(`${tcUrl}/admin/realms/${realm}/users`, {
  headers: { Authorization: `Bearer ${userToken}` },
});
```

For client-side code, call same-origin API proxies instead of direct cross-origin TideCloak calls.

**Verification**: `grep -r "grant_type=password\|username=admin\|password=password" app/ src/ lib/ --include="*.ts" --include="*.tsx"` should return zero matches outside of `scripts/init*.sh`.

VERIFIED (learning-batch-003, L-03).

---

## AP-42: Missing @tidecloak/react ESM Webpack Alias

**What it looks like**: Login page shows a redirect loop. Provider fails silently. `useTideCloak()` returns undefined. No clear error message.

**Root cause**: `@tidecloak/react`'s CJS dist (`dist/cjs/index.js`) contains ESM `import` statements. When `@tidecloak/nextjs` does `require("@tidecloak/react")`, webpack follows the CJS path and hits ESM syntax.

**Correct approach**: Add webpack alias in `next.config.ts`:
```typescript
import path from "path";
// inside webpack config:
config.resolve.alias = {
  ...config.resolve.alias,
  "@tidecloak/react": path.resolve(
    __dirname,
    "node_modules/@tidecloak/react/dist/esm/index.js"
  ),
};
```

Use `path.resolve()`, NOT `require.resolve()` — the latter throws `ERR_PACKAGE_PATH_NOT_EXPORTED` because the package's `exports` field is misconfigured.

This is required in addition to the `strictExportPresence = false` fix. See `canon/framework-matrix.md` for the complete webpack config.

VERIFIED (learning-batch-003, L-04).

---

## AP-43: Re-Verifying DPoP Proofs on App API Routes When Using secureFetch

**What it looks like**:
```typescript
// ❌ WRONG: Attempt RFC 9449 DPoP proof verification on secureFetch requests
import { jwtVerify, importJWK } from 'jose';

const dpopHeader = req.headers.get('dpop');
const { payload } = await jwtVerify(dpopHeader, publicKey);  // Throws: Invalid Compact JWS
```

**Why it's wrong**:
- `secureFetch` from `@tidecloak/js` sends DPoP proofs in a Tide-specific format, not standard RFC 9449 compact JWS
- `jwtVerify()` rejects the non-standard format with `401: Invalid Compact JWS`
- DPoP binding is already enforced at TideCloak during token issuance — the `cnf.jkt` claim proves binding
- JWT signature verification via embedded JWKS (VVK) is the primary security layer

**Consequence**: All API requests via `secureFetch` return 401. Login works but no API calls succeed.

**Correct approach**:
```typescript
// ✅ CORRECT: Verify JWT signature only. cnf.jkt proves DPoP binding at issuance.
const jwt = await verifyTideJWT(token);
// The presence of cnf.jkt confirms TideCloak bound this token with DPoP.
// No need to re-verify the proof on the app side.
```

**When to use DPoP proof verification**: Only if your app sends manual DPoP proofs (not via `secureFetch`). If using `secureFetch`, skip DPoP proof verification entirely.

VERIFIED (LEARNINGS-batch-005, L-06).

**Related**: I-12, [verify-jwt-server-side.md](../playbooks/verify-jwt-server-side.md) Step 4

---

## AP-44: Using In-Memory Stores in Next.js API Routes

**What it looks like**:
```typescript
// ❌ WRONG: Module-level Map in API route
const vaultStore = new Map<string, any>();

export async function POST(req: NextRequest) {
  vaultStore.set(key, value);  // Stored in memory
}

export async function GET(req: NextRequest) {
  return Response.json(vaultStore.get(key));  // Empty after hot reload
}
```

**Why it's wrong**:
- Next.js App Router in dev mode reimports modules on every file change (hot reload)
- Module-level variables reset on reimport — all in-memory state is lost
- POST stores data, but the next GET returns empty because the Map was reset
- This affects `Map`, `Array`, `Set`, or any module-level mutable state

**Consequence**: Data loss between requests during development. POST succeeds, GET returns 404/empty. Appears as intermittent bug.

**Correct approach**:
```typescript
// ✅ CORRECT: Use filesystem for state that must survive between requests
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(process.cwd(), 'data');
mkdirSync(DATA_DIR, { recursive: true });

function readStore(): Record<string, any> {
  try {
    return JSON.parse(readFileSync(join(DATA_DIR, 'store.json'), 'utf-8'));
  } catch { return {}; }
}

function writeStore(data: Record<string, any>): void {
  writeFileSync(join(DATA_DIR, 'store.json'), JSON.stringify(data, null, 2));
}
```

For production, use a database. For demos and dev, filesystem is sufficient and survives hot reload.

VERIFIED (LEARNINGS-batch-005, L-08).

**Related**: None (general Next.js dev behavior, not Tide-specific)

---

## AP-45: Rejecting DPoP-Upgraded Authorization Headers on Server

**What it looks like**:
```typescript
// ❌ WRONG: Only accepts Bearer scheme
if (!authHeader.startsWith('Bearer ')) {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}
const token = authHeader.substring(7);
```

**Why it's wrong**:
- When `useDPoP` is enabled, `IAMService.secureFetch` upgrades `Authorization: Bearer <token>` to `Authorization: DPoP <token>`
- Server middleware that only checks for `Bearer` silently rejects all DPoP-upgraded requests with 401
- The client sees the request "succeed" (no thrown error) but the API returns 401, so data operations fail

**Consequence**: All API calls via `secureFetch` return 401 when DPoP is enabled. Data appears to save on the frontend but is silently rejected by the server.

**Correct approach**:
```typescript
// ✅ CORRECT: Accept both Bearer and DPoP schemes
let token: string;
if (authHeader.startsWith('Bearer ')) {
  token = authHeader.substring(7);
} else if (authHeader.startsWith('DPoP ')) {
  token = authHeader.substring(5);
} else {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}
```

Or use `extractToken()` from the template which handles both schemes.

VERIFIED (LEARNINGS-session-003, L-01).

**Related**: I-12, AP-43

---

## AP-46: Eager Config Loading in Next.js Server Modules

**What it looks like**:
```typescript
// ❌ WRONG: Module-level config loading
const config = loadTideConfig();
const JWKS = createLocalJWKSet(config.jwk);
```

**Why it's wrong**:
- Next.js 16 evaluates module-level code during `next build` for static page generation
- If `tidecloak.json` doesn't exist yet or has no `jwk` field, the build crashes
- This happens before the app runs — the config may not be ready at build time

**Consequence**: `next build --webpack` fails with "Adapter JSON missing jwk field" even though the config will exist at runtime.

**Correct approach**:
```typescript
// ✅ CORRECT: Lazy initialization on first use
let _config: ReturnType<typeof loadTideConfig> | null = null;
let _jwks: ReturnType<typeof createLocalJWKSet> | null = null;

function getConfig() {
  if (!_config) {
    _config = loadTideConfig();
    _jwks = createLocalJWKSet(_config.jwk);
  }
  return { config: _config, JWKS: _jwks! };
}
```

VERIFIED (LEARNINGS-session-003, L-03).

**Related**: None (general Next.js build behavior)

---

## AP-47: Calling Admin API Without Required Permissions

TideCloak admin endpoints (`/admin/realms/{realm}/users`, etc.) require the calling user to have appropriate admin permissions — client roles on `realm-management` such as `tide-realm-admin`, `view-users`, `manage-users`, etc. If a user lacks the required permissions, the API returns 403. This is authorization working as intended. Ensure the user has the correct roles assigned before calling admin endpoints.

VERIFIED (LEARNINGS-batch-006, L-07).

**Related**: AP-41 (master admin credentials in app code)

---

## AP-48: Re-encoding doEncrypt Output as Bytes

**What it looks like**:
```typescript
// ❌ WRONG: Treat doEncrypt result as bytes
const encrypted = await IAMService.doEncrypt([{ data: plaintext, tags: [tag] }]);
const bytes = new TextEncoder().encode(encrypted[0]);
const stored = btoa(String.fromCharCode(...bytes));
// Double-encoded → doDecrypt throws "RangeError: Index out of range"
```

**Why it's wrong**:
- `doEncrypt` returns **base64 strings**, not `Uint8Array`
- Re-encoding the string as bytes produces double-encoded ciphertext
- `doDecrypt` cannot parse the result

**Consequence**: Encryption appears to succeed. Decryption fails with `RangeError: Index out of range`.

**Correct approach**:
```typescript
// ✅ CORRECT: Store the string directly
const encrypted = await IAMService.doEncrypt([{ data: plaintext, tags: [tag] }]);
const ciphertext = String(encrypted[0]); // already base64
// Store ciphertext as-is in database

// ✅ CORRECT: Decrypt by passing the stored string back
const decrypted = await IAMService.doDecrypt([{ encrypted: ciphertext, tags: [tag] }]);
```

**Type check**: `typeof encrypted[0] === "string"` must be true. If it's not a string, something is wrong.

**`doDecrypt` return type caveat**: `IAMService.doDecrypt` may return `Uint8Array[]` instead of `string[]` for policy-governed decryption. The `useTideCloak()` convenience `doDecrypt` is typed as `string[]` but the underlying `IAMService` call may differ. Use defensive decoding:
```typescript
const result = await IAMService.doDecrypt([{ encrypted: ciphertext, tags: [tag] }]);
const plaintext = result[0] instanceof Uint8Array
  ? new TextDecoder().decode(result[0])
  : String(result[0]);
```
VERIFIED (LEARNINGS-batch-006 L-08, LEARNINGS-batch-007 L-05).

**Related**: None

---

## AP-49: Replacing Existing Server Auth Instead of Layering Tide

**What it looks like**: Removing the existing app's authentication system (phone auth, email auth, server registration) entirely and replacing it with Tide login. All existing server APIs start returning 401 because the server expects its original credentials.

**Why it's wrong**: Many apps have server-side infrastructure (messaging, storage, notifications) tightly coupled to their original auth system. Removing it breaks the app's core functionality. Tide authentication gates access to the app and protects keys at rest — it doesn't replace server-side session management.

**Correct approach**: Layer Tide on top of the existing auth. Use a "gate" pattern:
1. App start → Tide login required (gate component wraps the app)
2. If Tide authenticated but no server registration → show original registration flow
3. If both authenticated → full app access
4. On subsequent launches → Tide auto-refreshes, server credentials persist → straight to app

Tide is an access gate, not a replacement for existing server auth. VERIFIED (TIDE_LEARNINGS-001 L-19).

**Related**: Playbook `add-auth-nextjs-existing`

---

## AP-50: Passing Uint8Array to doEncrypt/doDecrypt Instead of Array-of-Objects

**What it looks like**:
```typescript
// ❌ WRONG: Raw data, not wrapped in array-of-objects
const result = await doEncrypt(myBytes);
// Throws: "Pass array as parameter" or "All entries must be an object"
```

**Why it's wrong**: `doEncrypt` and `doDecrypt` expect `Array<{data, tags}>` and `Array<{encrypted, tags}>` respectively. Raw data or plain arrays throw.

**Correct approach**:
```typescript
// ✅ CORRECT: Array of objects with data and tags
const encrypted = await doEncrypt([{ data: myString, tags: ['mytag'] }]);
const ciphertext = String(encrypted[0]); // base64 string

const decrypted = await doDecrypt([{ encrypted: ciphertext, tags: ['mytag'] }]);
```

**String-in/string-out pattern**: Always pass data as strings (base64 for binary). String input → base64 encrypted string output. Avoids Uint8Array serialization issues during storage. For binary data:
```typescript
const base64 = btoa(String.fromCharCode(...myBytes));
const encrypted = await doEncrypt([{ data: base64, tags: ['keys'] }]);
// Store encrypted[0] as string
```

The tag must match realm roles: tag `'keys'` requires `_tide_keys.selfencrypt` and `_tide_keys.selfdecrypt`.

VERIFIED (TIDE_LEARNINGS-001 L-15, L-23).

**Related**: AP-48

---

## AP-51: Calling IAMService.getInstance()

`IAMService` from `@tidecloak/js` is a pre-instantiated singleton. The import IS the instance. Do not call `IAMService.getInstance()` — it does not exist and throws `is not a function`. Use `IAMService` directly. VERIFIED (ripple-learnings L-06).

---

## AP-52: Passing Destructured Config to initIAM

Do not pass `{ url, realm, clientId }` to `initIAM()`. The SDK reads `config["auth-server-url"]`, `config.realm`, `config.resource`, `config.vendorId`, `config.homeOrkUrl`, and `config["client-origin-auth-" + origin]`. Pass the full adapter JSON object from `tidecloak.json`. VERIFIED (ripple-learnings L-07).

---

## AP-53: Passing JSON Object to createTideRequest

`createTideRequest(encoded)` takes a single `Uint8Array` — a pre-encoded `BaseTideRequest`. Do not pass `{ contract, modelName, authFlow, ... }`. Build the request with `new BaseTideRequest(name, version, authFlow, draft)`, call `request.encode()`, then pass the result. VERIFIED (ripple-learnings L-08).

---

## AP-54: Policy Params as Plain Object

`new Policy({ params: { key: value } })` throws "object is not iterable". The `PolicyParameters` constructor calls `new Map(data)` which needs `[key, value]` pairs. Use: `params: [['Role', 'myRole'], ['Resource', 'myResource']]`. VERIFIED (ripple-learnings L-11).

---

## AP-55: Storing Raw Signature Instead of policy.toBytes()

After `executeSignRequest`, the result is the VVK signature array. Do not store this directly as the "signed policy." Set `policy.signature` to the signature bytes, then call `policy.toBytes()` to get the serialized policy with signature attached. The ORK expects the full serialized Policy, not just the signature. VERIFIED (ripple-learnings L-16).

---

## AP-56: Wrong Forseti Contract Namespace

Do not use `using Tide.Ork.Classes.Forseti;` or `using Tide.Forseti;` — these namespaces do not exist. The correct namespace is `using Ork.Forseti.Sdk;`. The contract class must implement `IAccessPolicy`; the class NAME is not fixed — the ORK resolves the entry type from the request's stored `EntryType` (`asm.GetType(req.EntryType)`), so `Contract` is only a convention, not a requirement. Method signatures use context objects: `ValidateData(DataContext ctx)` (always called), `ValidateApprovers(ApproversContext ctx)` (when approvalType == EXPLICIT), `ValidateExecutor(ExecutorContext ctx)` (when executorType == PRIVATE). Use `PolicyDecision.Allow()` not `PolicyDecision.Approve()`. VERIFIED (`ork: Ork.Forseti.Sdk/Contracts/IAccessPolicy.cs`, entry-type resolution in `Ork.Forseti.VmHost/Program.cs`).

---

## AP-57: Storing request.encode() Instead of policy.toBytes() for Signing

Do not store the output of `PolicySignRequest.encode()` or `BaseTideRequest.encode()` as the policy bytes for later signing requests. `encode()` includes the full request envelope (authorization data, signatures, expiry) plus the policy. The ORK's `addPolicy()` expects only the serialized `Policy` object from `policy.toBytes()`.

**Error when wrong**: `System.ArgumentOutOfRangeException: Index out of range` at `Ork.Shared.Models.Contracts.Policy.From(ReadOnlyMemory data)` during ORK PreSign.

**Correct**:
```typescript
// Store raw policy bytes (after VVK signature is attached)
policy.signature = vvkSignatureBytes;
const signedPolicyBytes = policy.toBytes();  // Store THIS
```

**Wrong**:
```typescript
const encoded = initializedRequest.encode();  // Includes auth envelope — DO NOT store as policy
```

Related: AP-55 (storing raw signature instead of policy.toBytes()). AP-57 is the inverse error — storing too much instead of too little. VERIFIED (LEARNINGS-ratidefy-batch-001 L-13).

---

## AP-58: Using Static IAMService for secureFetch/getToken in React/Next.js Apps

Do not import `IAMService` from `@tidecloak/js` and call `IAMService.getToken()` or `IAMService.secureFetch()` when using `@tidecloak/nextjs`'s `TideCloakContextProvider`. The static `IAMService` class is not initialized by the React provider — its token and auth state are null.

**Error when wrong**: 403 Forbidden on all TideCloak admin API calls, or null/invalid tokens.

**Correct**:
```typescript
const { secureFetch, getToken } = useTideCloak();
// Pass to utility functions that need authenticated fetch
initAdmin(secureFetch, getToken);
```

**Wrong**:
```typescript
import { IAMService } from '@tidecloak/js';
const token = await IAMService.getToken();  // Returns null — not connected to React provider
```

**Exception**: `(IAMService as any)._tc` works for ORK signing operations (doken, `createTideRequest`, `executeSignRequest`) because the React provider does initialize the internal `_tc` instance. But `IAMService.getToken()` and `IAMService.secureFetch()` do not route through the provider. VERIFIED (LEARNINGS-ratidefy-batch-001 L-20).

---

## AP-59: Assuming initializeTideRequest Mutates In Place

The `initializeTideRequest` function from the `useTideCloak()` React context returns a **new initialized object**. It does NOT mutate the original request. Calling `encode()` or `getUniqueId()` on the original object after initialization fails.

**Error when wrong**: `Must initialize request to generate unique id` or `encode()` returns uninitialized data.

**Correct**:
```typescript
const initialized = await initializeTideRequest(policyRequest);
const bytes = initialized.encode();  // Use returned object
const id = initialized.getUniqueId();
```

**Wrong**:
```typescript
await initializeTideRequest(policyRequest);
const bytes = policyRequest.encode();  // FAILS — original not initialized
```

VERIFIED (LEARNINGS-ratidefy-batch-001 L-25).

---

## AP-60: Constructing a Policy with `modelIds`, or Without `version`/`keyId`

`new Policy({...})` requires five fields — `version`, `contractId`, `modelId`, `keyId`, `params` —
and validates them **sequentially**, throwing a **bare string** (not an `Error`) on the first
mismatch. Fixing one reveals the next, so a wrong shape costs one round trip per wrong field.

The key is **singular `modelId`**. The constructor reads `data["modelId"]` but populates a class
field named `modelIds`, so the plural is what appears in editors, logs and `Policy.from()` — and
passing `modelIds:` is silently ignored, yielding `ModelId is not a string`.

**Wrong**:
```typescript
const policy = new Policy({
  contractId: hash,
  modelIds: ['MyModel:1'],   // plural key — ignored; also an unregistered id (AP-65)
  approvalType: ApprovalType.EXPLICIT,
  executionType: ExecutionType.PRIVATE,
  params: [['Role', 'admin']],
});
// throws the bare string 'Version is not a string'
```

**Correct**:
```typescript
const policy = new Policy({
  version: '3',                                    // Policy.latestVersion
  contractId: hash,                                // uppercase SHA-512 hex
  modelId: 'BasicCustom<MyModel>:BasicCustom<1>',  // SINGULAR
  keyId: vendorId,                                 // keyId IS the vendorId
  approvalType: ApprovalType.EXPLICIT,
  executionType: ExecutionType.PRIVATE,
  params: [['Role', 'admin']],
});
```

VERIFIED against `@tideorg/js/dist/Models/Policy.js` (0.14.20). Full field table and throw-string
map in [custom-contracts.md](custom-contracts.md). GAP-067. (LEARNINGS-music-license-001 L-01)

---

## AP-61: Hand-Writing a Models Type That Does Not Mirror the Runtime Constructor

Because `Models` reaches apps through a dynamic import that must be cast
(`as unknown as {...}`), apps declare their own constructor types. A type written from **intent**
rather than from the library describes the shape the code *wants*, so `tsc --noEmit` passes on a
call that is guaranteed to throw at runtime. This is the actual cause of AP-60: not the mistake,
but the absence of anything to check it against.

**Wrong**:
```typescript
type PolicyCtor = new (cfg: { contractId: string; modelIds: string[]; /* ... */ }) => any;
// Clean typecheck. Throws 'Version is not a string' at runtime.
```

**Correct**: write the mirror from `Models/Policy.js`'s guard clauses, field by field, and grep for
locally-declared `PolicyCtor`/`PolicyConfig` types to diff them against the constructor. Better:
push for an exported `PolicyConfig` (GAP-067).

VERIFIED (LEARNINGS-music-license-001 L-02).

---

## AP-62: A DPoP Relay Page That Assumes Iframe Context

`tide_dpop_auth.html` relays `postMessage` to whoever opened it. Older copies do:

```js
window.parent.postMessage({ type: "pageLoaded" }, openerOrigin);   // ❌
```

Correct in an **iframe**. In a **popup** — which is what `_popupDPoPFallback` → `_openDPoPPopup`
opens — `window.parent === window`, so the page messages *itself*, the opener never receives
`pageLoaded`, and tide-js reports `Popup DPoP verification failed to load`.

**Correct** (present in newer copies):
```js
const targetWindow = window.opener || window.parent;   // popup has opener, iframe has parent
if (!targetWindow || targetWindow === window) { /* surface it — do not post to self */ }
```

**Two things make this hard to diagnose**: the popup is legitimately **blank** (the page is
script-only, with markup on the storage-blocked error path only), so the normal appearance looks
like a load failure; and the reported error says "failed to load" for a page that returned HTTP 200
with a full body.

**Check**: fetch the served asset and assert it contains `window.opener` and no bare
`window.parent.postMessage`. The asset is distributed by copy-paste with no version marker, so an
app can be arbitrarily stale (GAP-068) — and two dev servers competing for port 3000 will serve
each other's `public/`, which produces this symptom from an unrelated project's copy.

VERIFIED (LEARNINGS-music-license-001 L-03/L-04/L-08). ⚠️ **Do not source this file from `sources/`** — `example-app-keylessh` holds BOTH copies and its repo-root one is the stale version. Take it from the MCP (`tide_dpop_asset`) or a pack template. The reasoning error that made the stale copy look canonical is **AP-83**.

---

## AP-63: Falling Back to `policies[0]` When a Named Lookup Misses

```typescript
const admin = policies.find((p) => p.name === "admin-policy") ?? policies[0];   // ❌
```

Two defects. The name is wrong — `GET /admin/realms/{realm}/iga/role-policies` returns the realm
admin policy as **`tide-realm-admin`** — and the fallback hides it. This works today purely because
exactly one policy is returned; add a second and it silently selects the wrong one, deploying under
the wrong authority.

**Correct**:
```typescript
const matches = policies.filter((p) => p.name === 'tide-realm-admin');
if (matches.length !== 1) throw new Error(`Expected 1 tide-realm-admin policy, got ${matches.length}`);
```

A named lookup that misses is a bug, not a case to default through. VERIFIED against a live realm
(LEARNINGS-music-license-001 L-06).

---

## AP-64: Building the Contract Transport Without the Outer `"forseti"` Wrapper

The Forseti contract transport is **three** nested levels and the outermost carries the contract
type:

```
contractTransport = [ "forseti",       [ <empty>, [ source, "Contract" ] ] ]
draft             = [ policy.toBytes(), contractTransport ]
```

Build two levels and every ORK answers `Unknown contract type ''` — an *empty* type, because the
ORK read position 0 of a structure one level too shallow and found the middle level's leading
`new Uint8Array(0)`.

`TideMemory.CreateFromArray` accepts any nesting, so nothing client-side objects, and the failure
lands at the threshold signature **after** the enclave approval — every attempt costs an operator
approval cycle.

**Correct**: use `PolicySignRequest.New(policy).addForsetiContractToUpload(source)` from
`heimdall-tide`, which builds this nesting (VERIFIED, 0.14.20). If hand-rolling, assert
`draft.GetValue(1).GetValue(0)` decodes to `"forseti"` before submitting. GAP-069.
(LEARNINGS-music-license-001 L-09)

---

## AP-65: Inventing a Model Id Instead of Using a Registered One or `BasicCustom<...>`

A policy's `modelId` looks like a free-form label and is in fact a lookup key into a fixed
nine-model registry (`@tideorg/js/dist/Models/ModelRegistry.js`, `modelBuildersMap`) plus one
naming convention. Nothing client-side validates it; the check runs on every ORK **after** an
operator approval, and answers `Model id '...' not found in registry`.

**Wrong**: `modelId: 'OriginAttestation:1'` — plausible, unregistered, rejected.

**Correct**: one of `Offboard:1`, `RotateVRK:1`, `TestInit:1`, `Policy:1`, `HederaTx:1`,
`PolicyEnabledEncryption:1`, `PolicyEnabledDecryption:1`, `ServerCert:1`, `AttestationUnit:1` — or
the custom form `BasicCustom<Name>:BasicCustom<Version>`, built with `BasicCustomRequest` from
`asgard-tide`.

⚠️ **Do not borrow `AttestationUnit:1` for an attestation app.** It carries IGA governance changes
and its human-readable title is `"Governance change"`, so it puts the wrong card in front of the
enclave approver.

**Check** (pure client-side): assert `modelId` is in the nine, or matches
`/^BasicCustom<.+>:BasicCustom<.+>$/`, **and** that `request.id() === policy.modelIds[0]`.

VERIFIED (LEARNINGS-music-license-001 L-11/L-13). See [custom-contracts.md](custom-contracts.md)
for the three competing wrapper conventions (GAP-072).

---

## AP-66: Binding a Contract Check to the JWT Subject Rather Than the VUID

A doken carries **no `sub` claim**. `DokenDto.UserId` returns `Payload.Vuid`, so a contract
comparing against an OIDC subject can never pass, no matter where the subject is placed in the
payload. The policy denies every signature — discovered only after an operator approval.

**Correct**: carry both, and label which is enforced where.

| Field | Enforced by | Purpose |
|---|---|---|
| `creator.vuid` | the ORK network, byte-compared against the doken | authorship |
| `creator.subject` | your own server, at submission time | display, DB linkage |

Put the vuid in the wire payload at a fixed offset; leave the subject in the JSON. If the two are
silently swapped, a verifier's "header agrees with payload" check fails on a valid certificate,
which reads as a broken signature. VERIFIED (LEARNINGS-music-license-001 L-16).

---

## AP-67: Deploying a Forseti Contract Without Compiling It Locally First

Contracts are compiled by the ORK **at request time**, so a typo or a wrong context property
surfaces as `VmHost.CompileFailed` after an operator approval has been spent:

```
VmHost.CompileFailed: (210,41): error CS1061: 'ExecutorContext' does not contain
a definition for 'Data'
```

A stub project with the right **shapes** catches this in under a second. Behaviour is irrelevant —
shape errors are exactly what `VmHost.CompileFailed` reports.

**Correct**: `dotnet build` against [templates/forseti-compile-harness/](../templates/forseti-compile-harness/)
before every deploy, and in CI. Every Forseti app should ship one.

Related: the context split — `ValidateData` sees `ctx.Data`, `ValidateExecutor` sees `ctx.Doken`,
neither sees both. VERIFIED (LEARNINGS-music-license-001 L-17).

---

## AP-68: An Issuer-Hosted `/verify` Endpoint That Returns VALID/INVALID

A verification endpoint hosted by the party that issued the claim is **worthless to a third
party**: anyone able to forge the attestation can forge the verdict. Verification that routes
through the issuer is not verification.

**Wrong**: `POST https://issuer.example/verify` → `{ "valid": true }`.

**Correct**: publish the **evidence**, not a verdict.
- Serve the certificate as an independent, self-contained JSON object — downloadable, CORS-open,
  `content-disposition: attachment`.
- Ship a verifier that runs entirely on the recipient's machine or in their browser.
- Never serve the verifying key beside the signature.
- Have the verifier state which checks it could **not** run, rather than reporting a bare
  "verified".

A related trap: human-readable fields added to the certificate *wrapper* sit **outside** the
signature, where anyone can edit them. That is only safe if every verifier refuses a certificate
whose readable owner block disagrees with the signed payload — otherwise the convenience becomes
the attack.

See [verifiable-claims.md](verifiable-claims.md) for the six checks. VERIFIED — forging the
readable label on a validly-signed certificate passes the signature check and fails the
cross-check. (LEARNINGS-music-license-001 L-15)

---

## AP-69: Reading keycloak-js Properties Off the TideCloak React Context

The value from `useTideCloak()` is **not** a keycloak-js instance. Some names carry over
(`authenticated`, `token`, `login`, `logout`, `hasRealmRole`) and some do not, which is exactly what
makes this dangerous: the API looks familiar enough to guess at.

`tokenParsed` does **not** exist on `TideCloakContextValue`. Reading it yields `undefined`, and the
usual defensive idioms turn that into a successful render of nothing:

**Wrong**:
```typescript
const tide = useTideCloak();
const claims = tide.tokenParsed ?? {};        // ❌ undefined → {} → every field renders "—"
const name = claims.preferred_username ?? '—';
```

**Correct** — the context exposes accessor *functions*, not a parsed object:
```typescript
const { getValueFromToken, getValueFromIdToken } = useTideCloak();
const name = getValueFromToken('preferred_username');    // access token
const email = getValueFromIdToken('email');              // ID token
```

`TideCloakContextValue` provides `getValueFromToken(key)`, `getValueFromIdToken(key)`, and the raw
`token` / `idToken` strings. VERIFIED against `@tidecloak/react`
`dist/types/contexts/TideCloakContextProvider.d.ts`.

**The severity is in the silence.** There is no error, no warning, and no failed request — just an
empty value flowing into the UI. On a screen whose entire job is confirming *who* is making a
claim, that is the worst available behaviour: it renders no identity and still offers the action.

**Fail closed in the UI too.** A confirmation screen that cannot resolve the identity it is
confirming must block the action, not render a placeholder:

```typescript
const vuid = getValueFromToken('vuid');
if (!vuid) return <Error>Cannot confirm your identity — refusing to attest.</Error>;
// only now render the Attest button
```

Treat `?? '—'` on an identity field as a code smell: it converts a wrong API call into a
plausible-looking screen. Prefer throwing, or rendering an explicit error, over defaulting.

VERIFIED (LEARNINGS-music-license-001 L-20). Related: AP-29 (role-check API confusion), AP-58
(static `IAMService` not wired to the React provider).

---

## AP-70: Exact-Path `/tide_dpop` Rewrite Instead of the Wildcard

The DPoP relay parses `iss` and `aud` **out of its own URL path**:

```js
const paths = new URL(window.location.href).pathname.split("/");
const iss = hexToStr(paths[paths.indexOf("iss") + 1]);
const aud = hexToStr(paths[paths.indexOf("aud") + 1]);
```

So the enclave requests `/tide_dpop/iss/<hex>/aud/<hex>/tide_dpop_auth.html`.

**Wrong**: `{ source: "/tide_dpop", destination: "/tide_dpop_auth.html" }` — matches none of that. The
URL 404s, and a 404 page cannot satisfy the embedder's pinned-script CSP.

**Correct**: `{ source: "/tide_dpop/:path*", destination: "/tide_dpop_auth.html" }`, as a **static
rewrite, never a route handler** (the Next dev server injects a hash-based CSP on route-handler
responses, blocking the inline script).

**The error blames the wrong thing.** It quotes a `sha256-…` of the relay's inline script, so everyone
goes hunting a stale `tide_dpop_auth.html` (AP-62). **If that hash MATCHES your file, the file is
correct** — it is the hash the embedder expects, and you have the right file at the wrong address.

Verify on the wire, not by reading config:
```bash
curl -sS -D - -o /dev/null "http://localhost:3000/tide_dpop/iss/6161/aud/6262/tide_dpop_auth.html" \
  | grep -iE "^(HTTP|content-security-policy|allow-csp-from)"
```

VERIFIED on Next.js 15.3.3 and 16.3.0 (LEARNINGS-agent-quorum-001 L-07). Prefer **16.x** — 15.3.3 is
superseded by CVE-2025-66478. Full config:
[framework-matrix.md](framework-matrix.md) → Browser Prerequisites.

---

## AP-71: Adding `frame-ancestors` (or Anything Else) to the Tide CSP

Canon specifies **exactly** `frame-src 'self' *`. That is the whole policy, and additions are what
break it.

Adding `frame-ancestors 'self'` reads as routine hardening. It breaks the enclave: the SWE frames
**your own origin** for silent SSO and the approval popup, and a same-origin-only ancestor policy
refuses that with

```
Refused to display 'http://localhost:3000/' in a frame. The embedder requires it to
enforce the following Content Security Policy: ...
```

— which reads as a Tide bug rather than as self-inflicted CSP.

Relatedly, the relay path needs `Allow-CSP-From: *` (CSP Embedded Enforcement). Omitting it is exactly
what refuses the frame, and the error text *names the header* and is still easy to miss.

**Do not "simplify" to one CSP for all paths** in order to avoid rule-ordering questions — that also
deletes `Allow-CSP-From`. Order the `/tide_dpop` rule **last** (for a given header key the later
matching rule wins; path specificity does not decide it) and **verify by reading the served header**.

VERIFIED (LEARNINGS-agent-quorum-001 L-07; L-08 refuted by measurement).

---

## AP-72: Inferring Success From a 2xx When IGA Is Enabled

**With IGA enabled, a `2xx` from an admin endpoint means ACCEPTED, not APPLIED.**

Observed on TideCloak-dev / Keycloak 26.7.0 — both of these are **governed writes**, contrary to the
older ACTIVE/DRAFT guidance:

```
POST /admin/realms/{realm}/clients/{uuid}/roles
→ 202 {"status":"PENDING","actionType":"CREATE_ROLE"}
GET  /admin/realms/{realm}/clients/{uuid}/roles
→ []                                    # the role does not exist yet

PUT  /admin/realms/{realm}/users/{id}   (attributes.tideInvitable=["true"])
→ 204                                   # looks like success
GET  /admin/realms/{realm}/users/{id}
→ "attributes": null                    # it did not apply
```

**Wrong**: create six roles, see six `2xx`, move on. Every later lookup fails against an empty list,
and the visible symptom (`role not found` during role *assignment*) points at the assignment step
rather than the creation step several stages earlier.

**Correct**: mutate → **drain** → **read back and assert**. `201` and `202` mean different things and
only one of them means the entity exists. Use
[templates/shared/drain-change-requests.py](../templates/shared/drain-change-requests.py).

⚠️ For the silent attribute case, do **not** chase `unmanagedAttributePolicy`. It is a real and
well-known cause of dropped attributes, so it is the natural next hypothesis — and here it is a dead
end that leaves you *more* confused, because `/users/profile` will show it `ENABLED` and look fine.

VERIFIED (LEARNINGS-agent-quorum-001 L-01/L-02). See [concepts.md](concepts.md) IGA section.

---

## AP-73: Calling Your Own API With Bare `fetch` in a DPoP Realm

In a DPoP-enabled realm, an app calling **its own** endpoints with plain `fetch` sends no
`Authorization` and no DPoP proof, so a guard that requires `Authorization: DPoP <token>` returns
**401** on every call — including from inside SDK helper modules, where it is least visible.

**Wrong** (from a signing-helper module, which is exactly where it hides):
```typescript
const contractSource = await fetch('/api/policy/contract').then(r => r.text());
await fetch(`/api/actions/${id}/approval/tide`, { method: 'POST', body });
```

**Correct** — thread `secureFetch` from the hook into the helpers rather than reaching for a static
import:
```typescript
export type SecureFetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function contributeApproval(
  id: string, payloadB64: string,
  IAMService: unknown, secureFetch: SecureFetch,   // <- passed in from the component
) { /* ... */ }
```

**Why this is easy to miss**: AP-58 already says "use the `useTideCloak()` hook, not static
`IAMService.secureFetch`". A reader who threads `IAMService` correctly *feels compliant* while still
calling `fetch` for the app's own endpoints. **AP-58 is about where the session comes from; AP-73 is
about which fetch you use at all.**

It also hides well in "simulation" or non-DPoP modes, where bare `fetch` works fine — the 401s appear
only once the realm is DPoP-enabled. VERIFIED (LEARNINGS-tidewater-001 L-03).

---

## AP-74: Passing a Relative URL to `secureFetch`

`secureFetch` is named and documented as a drop-in for `fetch`, and is one **in every respect except
this**. There are **two** throw sites, both a bare `new URL()` with **no base**:

- `@tidecloak/js/dist/esm/lib/tidecloak.js:626-627` — deriving the origin for the resource-server nonce
- `@tidecloak/js/dist/esm/lib/tidecloak-dpop.js:390-393` — deriving the proof's `htu` claim:
  ```javascript
  htu: (() => {
      const urlObj = new URL(url);              // no base argument
      return urlObj.origin + urlObj.pathname;   // note: NO query, NO fragment
  })(),
  ```

⚠️ **Sibling fact for server-side DPoP verification**: `htu` is `origin + pathname` **only**. A
server-side comparison against the full request URL fails on any request carrying a query string. The
pack's verification guidance already says this (`framework-matrix.md`, `concepts.md`, `invariants.md`,
`feature-mapping.md` all specify "ignore query string") — keep it that way.

The relevant code:

```javascript
const urlString = url instanceof URL ? url.href : url.toString();
const origin = new URL(urlString).origin;      // throws on '/api/policy/contract'
```

So the first same-origin call written the obvious way throws **before any network activity**, from
inside the SDK, with a message that names nothing in your code:

```
Failed to construct 'URL': Invalid URL          # Chrome
TypeError: Invalid URL                          # Node
```

It reads like a malformed adapter config, and that is where the hunt goes. It cannot be caught by
types either — the signature takes a `string`.

**Correct** — resolve at the call site:
```typescript
export function absoluteUrl(path: string): string {
  return new URL(path, window.location.origin).href;
}
await secureFetch(absoluteUrl('/api/policy/contract'));
```

### AP-73 and AP-74 together are a trap with no safe-looking exit

Relative paths are the normal way to call your own API, so both obvious choices fail, differently:

| What you write | What happens |
|---|---|
| `fetch('/api/x')` | silent **401** from the DPoP guard (AP-73) |
| `secureFetch('/api/x')` | **TypeError** that sounds like a config problem (AP-74) |
| `secureFetch(absoluteUrl('/api/x'))` | ✅ the only correct combination |

**Neither failure points at the answer.** If you are wiring an app's own API through `secureFetch` —
which is what the pack tells you to do — this is the single most likely first-run failure.

Also required: `useDPoP` must be inside the **config object** (AP-52/AP-69 context), and
`Authorization: Bearer <token>` must be pre-set, since the SDK only upgrades to the DPoP scheme when it
sees an existing Bearer token.

VERIFIED against the shipped SDK source and reproduced in Node (LEARNINGS-tidewater-001 L-04;
previously recorded as a sub-pitfall of AP-45, promoted here because it was not findable where it bites).

---

## AP-75: A Role-Check Helper That Takes a Bare Role Name

**A role name is not an identity — `{client, role}` is.** A helper whose signature is
`hasRole(role: string)` invites the caller to check the right role against the wrong client, and both
the UI gate and the API gate will then agree, wrongly.

The canonical instance: **`tide-realm-admin` lives on the `realm-management` client**, so a check
scoped to your app's own client can never see it, no matter what the user holds.

**Wrong** — scoped to the app client:
```typescript
const ra = claims.resource_access as Record<string, { roles?: string[] }>;
return ra?.[config.resource]?.roles ?? [];        // config.resource === "my-app"
// ...then hasClientRole('release-engineer', 'my-app') on a page that deploys a policy
```

Against a real admin token:
```
resource_access:
  realm-management: [ …, "tide-realm-admin", "realm-admin", "manage-realm", … ]
  account:          [ "manage-account", … ]
# my-app: ABSENT — the admin holds no app-client role at all
```

**Correct** — require pairs, and echo what the token actually carries on refusal:
```typescript
export const REALM_ADMIN = { client: 'realm-management', role: 'tide-realm-admin' };
export function withAnyClientRole(required: RoleRequirement[], handler: Handler) { /* … */ }
// on 403, include: has: { "realm-management": [...], "account": [...] }
```

Echoing the full `resource_access` map turns *"403 but I **am** the admin"* into a one-look diagnosis.

**Two compounding mistakes worth separating**, because only one is a config error:
1. the wrong client was inspected — a code defect;
2. the bootstrap gave the admin **no app-client role by design** (admin deploys the policy; others
   ship and approve), so the gate could never pass for exactly the person the page was built for. **A
   gate that cannot pass for its intended user is a design error, not a config one.**

Related: AP-29 (use `hasClientRole` for `tide-realm-admin`, not `hasRealmRole`). AP-75 is the
generalisation — the helper's *shape* is what permits the bug.
VERIFIED (LEARNINGS-deploy-gate-001 L-02).

---

## AP-76: Declaring a Bare `Custom<X>:Custom<1>` Model Id

**NETWORK-VERIFIED rejection.** All 20 ORKs refuse it at `executeSignRequest` — *after* the operator
approval has been spent:

```
TideError[TIDE-TIDEJS-NET-THRESHOLD_FAILURE]: Could not reach enough VVK ORKs (0 of 20, 20 failed)
  [TIDE-ORK-INTERNAL-UNEXPECTED] Model id
    'System.Collections.ObjectModel.ReadOnlyCollection`1[System.String]' not found in registry
```

`Custom<...>` is the **enclave card's** wrapper, matched against the request's raw `name` field. It is
**not** an ORK model identity. The ORKs want the `BasicCustom<...>`-shaped `id()`.

⚠️ **Read past the .NET type name.** `ReadOnlyCollection\`1[System.String]` where a model id belongs is
an **ORK-side message-formatting artifact** — it prints the whole model collection instead of the entry
that failed to resolve. It is **not** evidence of a wire-format or policy-version skew. Anyone seeing
it for the first time is strongly tempted to go hunting a V2/V3 layout problem, which is a documented
dead end (see `custom-contracts.md` → Refuted Theories). **Confirmed twice now**, in independent runs.
The message means only: *this model id is not resolvable.*

**Correct**: for `ApprovalType.EXPLICIT`, use `BasicCustomRequest` with the name/version pre-wrapped in
`Custom<...>`, so the raw name satisfies the card and `id()` satisfies the ORKs. See
[custom-contracts.md](custom-contracts.md) → "TWO consumers read the request".
VERIFIED (LEARNINGS-deploy-gate-001 L-03).

---

## AP-77: Copying keylessh's `BasicCustomRequest` Constructor Arguments

keylessh passes an **already-wrapped** name into the constructor:

```typescript
const name    = "BasicCustom<SSH>";      // keylessh/client/src/lib/tideSsh.ts
const version = "BasicCustom<1>";
new BasicCustomRequest(name, version, …)
```

Since `BasicCustomRequest.id()` wraps again, this yields
`BasicCustom<BasicCustom<SSH>>:BasicCustom<BasicCustom<1>>` — not what canon's table predicts from
unwrapped arguments, and not what the raw-name card regex matches either.

**The pre-wrap is not the mistake** — it is required for any EXPLICIT-approval custom model. The
mistake is the **inner token**: it wraps with `BasicCustom<...>`, which no consumer matches, instead of
`Custom<...>`, which the card renderer does.

keylessh works because it uses `ApprovalType.IMPLICIT`, where **no card is ever built**, so the
difference never surfaces. That makes it a working exemplar and a bad template for an
approval-bearing app.

**Correct**: derive all three identities from one constant and let assertions settle it —
`/^Custom<.+>$/` on the name (card) and `/^BasicCustom<.+>:BasicCustom<.+>$/` on `id()` (ORKs).
VERIFIED (LEARNINGS-deploy-gate-001 L-03/L-04).

---

## AP-78: Reaching Through `as any` With `!` in the Deployment Path

`Models` and `Tools` are **sibling** exports, not nested:

```typescript
// @tideorg/js/dist/index.d.ts
export * as Models from './Models';
export * as Tools  from './Tools';
```

So `Models.Tools` is `undefined`.

**Wrong** — and it compiles, because `as any` erases the type and `!` suppresses the last signal:
```typescript
policy.signature = new (Models as any).Tools!.TideMemory(vvk.length);
```

**Correct** — destructure both namespaces explicitly, at the top of the function:
```typescript
const { Models, Tools } = await import('@tidecloak/js');
const { TideMemory } = Tools as any;
policy.signature = new TideMemory(vvk.length);
```

**Why this one is disproportionately expensive**: the only use of `TideMemory` in the deployment path
is **attaching the VVK signature**, which happens *after* `executeSignRequest` returns successfully. So
the throw lands immediately after the network has threshold-signed the policy — **the approval and the
signature are both already spent** — and the error (`Cannot read properties of undefined`) names
neither.

The general rule: in the deployment path, do not combine `as any` with `!`. A missing export should
fail loudly and early, not after the expensive part succeeded.
VERIFIED (LEARNINGS-deploy-gate-001 L-04a).

---

## AP-79: Running a Full Dev Bootstrap Script on a Container Hosting Other Realms

`templates/shared/bootstrap-tidecloak.sh` Step 0 is a **destructive wipe** that runs before any
confirmation:

```bash
docker stop tidecloak; docker rm tidecloak
sudo rm -f ./data/keycloakdb*
```

The script is documented as a full dev bootstrap, so this is a sharp edge rather than a bug — but it
is the obvious thing to reach for when adding **one** realm, and a TideCloak container commonly hosts
several. Running it then destroys every realm on the box, and a realm cannot be un-flipped from
multiAdmin, so some of them may not be cheaply rebuildable.

**The script now refuses** when the running instance holds realms besides `master`, unless
`FORCE_WIPE=1` is set explicitly. To bootstrap an additional realm on a live container, skip Step 0
and assert the target realm does not already exist.

VERIFIED (LEARNINGS-deploy-gate-001 L-06).

---

## AP-80: Declaring a `tide-*` Protocol Mapper in a realm.json

**There is no Tide-specific protocol-mapper provider.** `tide-roles-mapper` does not exist — not on
the production image, not on staging.

MEASURED against `tideorg/tidecloak-dev:latest`, 2026-08-11:

```
GET /admin/serverinfo  ->  protocolMapperTypes["openid-connect"]
# 24 providers registered. NONE contains "tide".
```

**The failure is silent, which is what makes it expensive:**

```
POST /admin/realms      (client.protocolMappers[].protocolMapper = "tide-roles-mapper")
→ 201 Created                       # no error, no warning, no hint
→ GET .../protocol-mappers/models   # the mapper is simply NOT THERE
```

The realm imports "successfully" and the mapper is **silently dropped**. If anything depended on it
for role claims, roles are missing from every token with **nothing anywhere saying why** — and the
natural diagnosis ("IGA isn't propagating roles", "the commit didn't land") sends you somewhere
unrelated for hours.

**Wrong**:
```json
{ "name": "tide-roles", "protocol": "openid-connect",
  "protocolMapper": "tide-roles-mapper",
  "config": { "access.token.claim": "true" } }
```

**Correct** — stock provider types, which is all Tide ever uses:

| Claim(s) | Source | Mapper type |
|---|---|---|
| `realm_access.roles` | default **`roles`** client scope | `oidc-usermodel-realm-role-mapper` |
| `resource_access.<client>.roles` | default **`roles`** client scope | `oidc-usermodel-client-role-mapper` |
| `tideuserkey` | **`tide-claims`** scope (from `setUpTideRealm`) | `oidc-usermodel-attribute-mapper` |
| `vuid` | **`tide-claims`** scope | `oidc-usermodel-attribute-mapper` |
| `t\.uho` | **`tide-claims`** scope | `oidc-hardcoded-claim-mapper` |

Roles need **no** mapper declaration at all: `roles` is a **default** client scope. Declaring the
`tideUserKey`/`vuid` attribute mappers inline on the client (as the pack templates do) is harmless
belt-and-braces. **What is never fine is naming a `tide-*` provider type.**

⚠️ **This corrects two earlier pack claims.** LEARNINGS-batch-004 L-06 / RB-024 said the provider
exists on the prod image and is dropped only on staging — **disproved**, it is absent on prod too.
LEARNINGS-batch-006 prescribed *using* `tide-roles-mapper` to fix missing role claims — that
instruction would have produced exactly the symptom it was meant to cure.

**Regression gate**: `mcp-server` content tests fail if any active realm template declares a
`"protocolMapper": "tide-*"`, or if a realm template stops mapping `tideUserKey`/`vuid` — so
"remove the bad mapper" can never be satisfied by deleting the Tide claims wholesale. Verified to
fail in both directions.

VERIFIED by direct measurement 2026-08-11.

---

## AP-81: Inferring the Forseti SDK Surface From a Simplified Example

The ORK's C# compiler is precise, and it runs **at request time** — so an invented API shape surfaces
as `VmHost.CompileFailed` **after an operator approval has been spent**. The most common inventions,
all observed in one real build:

| Written | Reality |
|---|---|
| `foreach (DataItem d in ctx.Data)` | **No `DataItem` type.** `ctx.Data` is `ReadOnlyMemory<byte>` — a nested TideMemory, read with `GetValue(i)` / `TryGetValue(i, out …)` |
| `ctx.Data` in `ValidateExecutor` | Only on `DataContext`. Thread state through an instance field |
| `decision.IsAllowed` | No such member on `PolicyDecision` **or** on the `Decision` chain — you *return* a decision, never inspect it |
| `ctx.Data == null` | `ReadOnlyMemory<byte>` is a **struct** → `error CS0019`. Probe with `TryGetValue(0, out _)` |
| `ctx.Data[0]` | No indexer. `GetValue(0)` for a child, `.Span[0]` for a raw byte |
| `Decision.X(…).And(Decision.Y(…))` | No `.And()` combinator — **chaining is the conjunction** |
| `using Ork.Forseti.Sdk;` alone | **Six** usings required (add `Cryptide.Tools`, `Ork.Shared.Models.Contracts`, `System`, `System.Collections.Generic`, `System.Text`) |

**Encrypt and decrypt have different payload layouts.** Tags start at index **2** for
`PolicyEnabledEncryption:1` and index **3** for `PolicyEnabledDecryption:1`. Reading the wrong offset
silently collects the wrong strings as "tags", so the contract then allows or denies on garbage.
Branch on `ctx.RequestId` first and deny anything unexpected.

**Do not infer the surface. Two things make it checkable:**

```bash
templates/forseti-compile-harness/check.sh --self-test    # stubs vs two DEPLOYED contracts
templates/forseti-compile-harness/check.sh path/to/MyContract.cs
```

The harness reproduces every error above locally in about a second. Its stubs are self-tested against
`sources/example-app-forseti-crypto-quickstart/.../forsetiContract.ts` and
`sources/example-app-tidecloak-test-cases/.../forsetiDecryptionContract.ts` — **read those two files
before writing a contract.** They are working, deployed, and they are the surface.

⚠️ **The pack was a source of this.** Its examples showed one using directive, `ctx.Data == null`, a
`.And(…)` combinator and a 4-argument `RequireAnyWithRole`; the harness stubs typed `ctx.Data` as
`byte[]` and gave `PolicyDecision` an `IsAllowed`. All corrected 2026-08-11, and
`check-docs.sh` now compiles every contract example in the pack so a simplified example cannot drift
back into fiction. VERIFIED (LEARNINGS from a real ORK compile failure).

---

## AP-82: Assuming a Keycloak-Compatible App Can Be Tidified

**"It uses Keycloak, so it will work" is false.** Tidifying a realm **changes the token signature
algorithm from RS256 to EdDSA**, and a large amount of otherwise Keycloak-compatible software cannot
verify an Ed25519 signature.

MEASURED on `tideorg/tidecloak-dev:latest`:

| Realm | `defaultSignatureAlgorithm` | Ed25519 (OKP) key |
|---|---|---|
| non-Tide (`master`, `myrealm`) | `RS256` | absent |
| **Tide-enabled** (`iga.attestor=tide`) | **`EdDSA`** | **present** |

Clients carry no explicit signature attribute, so they **inherit the realm default** — every token the
app receives becomes `alg: EdDSA`.

**This is not a setting to revert.** Tide's signing *is* threshold Ed25519 across the ORK network.
Forcing the realm back to RS256 would mean the TideCloak server holding a whole signing key and
signing tokens by itself — the exact property the migration exists to remove (I-02, I-09). **The
verifier changes; the realm cannot.**

**VERIFIED blockers:**

| Verifier | EdDSA | Evidence |
|---|---|---|
| Node `jsonwebtoken` | **NO** | allowlist is `HS*/RS*/ES*/PS*`; zero occurrences of `EdDSA`/`ed25519` in the shipped bundle |
| Node `jwks-rsa` | n/a — **remote** JWKS + RS256 | violates I-04/AP-01 as well |
| .NET `Microsoft.IdentityModel.Tokens` | **NO** | T-23; `Tide.Asgard.Core` ships an EdDSA `SignatureProvider` precisely because the stock stack lacks one |
| Node `jose` | yes | the path the pack prescribes |

Two failure modes, and the second is sneakier: **no Ed25519 implementation** (everything 401s), or a
correct implementation **pinned to RS256** (`algorithms: ['RS256']`). Pinning is good hygiene (SG-13),
so **repin to EdDSA — never unpin**, or the verifier will accept whatever the token claims.

⚠️ **The blocker most migrations die on is not in the repo.** Anything else validating the JWT — an API
gateway, a managed serverless authorizer, a proxy terminating auth, a SaaS consuming your tokens — must
also do EdDSA, and is usually outside the app team's control. **The pack asserts nothing about specific
products**: support is version- and edition-dependent, and a wrong claim is worse than none. Test the
real deployment with a real EdDSA token.

**Wrong**: "Same SDK, same OIDC protocol, no code changes needed." (This was in the pack's own
migration playbook, and it is the reason this entry exists.) At minimum the JWKS source changes;
usually DPoP and the `/auth/redirect` handler; often the JWT library itself. And the SDK surface is
`@tidecloak/*`, which only partially overlaps `keycloak-js` (AP-69).

**Correct**: run the gate, then classify and say why.

```bash
templates/tidify-preflight/check-tidify.sh /path/to/app
```

| Verdict | Meaning |
|---|---|
| **FULLY TIDIFIABLE** | EdDSA-capable verifier under your control, adapter JWKS, DPoP wired, browser-based |
| **PARTIALLY TIDIFIABLE** | Interactive paths move; some surface cannot (usually machine-to-machine, or a gateway you do not control). **Name the excluded surface** |
| **NOT TIDIFIABLE (as built)** | A verifier you cannot change, a headless-only auth model, or a fixed third-party JWT consumer. Say what would have to change |

A partial migration is a legitimate outcome. **Presenting it as complete is the failure** — the excluded
surface keeps its original exposure, and a security write-up implying otherwise is wrong in the
direction that matters.

Full gate incl. non-EdDSA constraints: [tidify-compatibility.md](tidify-compatibility.md).
VERIFIED by measurement 2026-08-13.

---

## AP-83: Treating a `sources/` Exemplar as Authoritative for a Shipped Artifact's VERSION

The pack's own rule says *"treat `sources/` as the main authority"* — and that is right for **how Tide
works**: the API surface, the protocol, the security model. It is **wrong for the version of a runtime
artifact**, and following it there has already broken a real login.

**A vendored repo is a snapshot.** It can be stale, and it can hold **several copies of the same file
at different versions**. `sources/example-app-keylessh` contains **two** `tide_dpop_auth.html` files —
the one at its repo root is the broken 7183-byte copy; the good one is under `client/public/`.

### What went wrong, concretely

Someone compared the shipped templates against that exemplar, found a difference, and concluded:

> *"both pack templates had silently drifted to a modified 9121-byte variant while the exemplar held
> the canonical 7183-byte file"*

Every step of that is a reasonable-looking inference and the conclusion is **exactly backwards**. The
templates were then **reverted to the broken file**, the conclusion was recorded as **VERIFIED**, and
four documents began telling users to install it — including a verification step that **passed the
broken file and failed the correct one**. A user's login failed with `TIDE-SWE-UNHANDLED`.

### The rule

| Wrong | Right |
|---|---|
| "It differs from the exemplar, so it drifted" | Differing is **equally** evidence the exemplar is old |
| Deciding by file size, age, or provenance | Deciding by **behaviour against the current runtime** |
| Restoring a working file to match `sources/` | Keeping what **works**, and hash-gating it |
| One exemplar = the canonical copy | A repo may hold several versions — check which one the app actually serves |

**Ask what the artifact must DO, then check which copy does it.** Here: the relay must work when the
SDK falls back to a popup, where `window.parent === window`. Only the copy using
`window.opener || window.parent` can. That question settles it in one step; provenance never does.

### Detecting it

- Hash-gate the artifact the pack **ships**, in both directions (a gate that only detects "changed"
  will happily accept a revert **to** the bad version).
- **Also gate the prose.** `scripts/check-dpop-asset.sh` hashes files and reported all four templates
  green while **four documents** told readers to fetch the broken copy from `sources/`. A
  file-integrity check cannot catch guidance pointing elsewhere.
- Treat a `sources/` path in *install* instructions as a smell: ship from `templates/`, or serve the
  bytes from the MCP (`tide_dpop_asset`) where there is only one copy to get.

VERIFIED by a user report, 2026-08-17. Related: AP-62 (the symptom), GAP-068, `CLAUDE.md` → "Use only
bounded sources".

---

## Status Legend

- **VERIFIED** - Directly sourced from documentation or keylessh exemplar
- **INFERRED** - Strongly implied by source material
- **REQUIRES_RUNTIME_VALIDATION** - Single-app evidence; needs confirmation

---

## AP-84: Sourcing the Hosted TideCloak Cluster Version From Anywhere But Skycloak

**Severity: High. Blast radius: you silently provision an old build, and the "fix" can preserve the bug.**

Two mistakes, one after the other. The second is the instructive one.

**Mistake 1 — hardcoding the version.** The provisioning playbook posted
`{"type":"tidecloak", ..., "version":"0.14.17"}`. Correct on 2026-08-06; three releases stale by
2026-08-18. A pin is a bad failure precisely because it *never fails*: the cluster provisions,
licensing succeeds, the app works, so nothing signals the number aged out. Compare a wrong URL,
which breaks immediately and gets fixed.

**Mistake 2 — replacing the pin with the wrong source.** The fix read Docker Hub tags for
`tideorg/tidecloak` and took the newest. Clusters still came up old, and the reason is that
**Skycloak does not consult Docker Hub at all**:

```go
// internal/clusters/service.go
supportedVersions := s.GetSupportedVersionsByType(cluster.Type)   // → SupportedTideCloak
for _, v := range supportedVersions { if v == cluster.Version { versionSupported = true } }
if !versionSupported { return nil, ErrInvalidClusterVersion }     // → 400 invalid cluster version
```

Exact match against a **server-side allowlist**. A tag can be the newest thing Tide published and be
un-provisionable because Skycloak has not added it. The walk-down loop then did its job perfectly and
made things worse: newest 400s → try next → land on something old, silently. **A retry loop over the
wrong list converts a loud failure into a quiet downgrade.**

**Mistake 3 — keeping the walk-down after fixing the source.** Once the list comes from Skycloak,
every entry is a version Skycloak said it supports, so a `400 invalid cluster version` means
something is inconsistent — not that you should settle for an older build. Retrying downward is only
ever a downgrade. **Take the newest and fail if it fails.** A fallback is only correct when the
thing you fell back from was never authoritative.

**The list has an endpoint. Earlier pack revisions claimed it didn't, and that claim caused the bug:**

```
GET /clusters/supported-versions?type=tidecloak    → ["0.14.20", ...]
GET /clusters/versions                             → {"keycloak":[...],"tidecloak":[...]}
```

Both require the API key. "There is no versions endpoint" was never verified — it was inferred from
the endpoint not being in the public docs, and it sent the next author looking for a substitute.
**An unverified negative is how a wrong source gets adopted.**

**Do this:** ask Skycloak, sort numerically, take the newest, and create once —
`templates/shared/skycloak-latest-version.sh`. The `0.14.17` floor never *selects* an older version;
it only refuses to return one, so that a catalogue topping out at a known-broken build is reported
rather than provisioned. The newest eligible version is the newest version whenever the newest is at
or above the floor. Docker Hub keeps exactly one legitimate use: `--check`
reports whether Skycloak's catalogue is behind what Tide published, which is actionable (ask Skycloak
to add it). It never picks a version.

**Remaining traps:**

1. **`latest` is not an accepted value.** Skycloak validates `^[0-9]+\.[0-9]+(\.[0-9]+)?$` and
   rejects the tag outright.
2. **Sort numerically, and check your reverse applied.** As strings `"0.9.8" > "0.14.20"`, so a
   naive sort picks a sub-floor version, which fails as `TIDE-IDPEXT-VENDOR-KEYGEN_FAILED` — an
   error that reads as key generation and is really licensing. In `sort`, a **global `-r` is
   silently overridden by per-key flags**:

   ```
   sort -t. -k1,1n  -k2,2n  -k3,3n  -r   → 0.9.8, 0.14.17, 0.14.19, 0.14.20   # WRONG, both ways
   sort -t. -k1,1nr -k2,2nr -k3,3nr      → 0.14.20, 0.14.19, 0.14.17, 0.9.8   # right
   ```

   The wrong form looks reversed and isn't, so `head -1` returns the *oldest* eligible version. Do
   not trust the endpoint's documented "newest to oldest" ordering either — sort what you receive.
3. **Never read the allowlist from a Skycloak source checkout.** The checkout on this machine lists
   `SupportedTideCloak = ["0.11.7"]` while production provisions `0.14.17`. A checkout is a
   snapshot — use it to learn the *mechanism*, never the *values*. This is **AP-83** again, and it
   is the third time that rule has bitten in this repo.

**When Skycloak's newest is genuinely old, say so.** The allowlist is server-side; no client change
moves it. Do not lower the floor to compensate — `0.13.13` ships a broken automation client and
`0.14.11` fails licensing. Report the gap and ask Skycloak to add the version.

**Honesty rule:** the floor is VERIFIED by testing the matrix. Anything above it is **ASSUMED good**
until re-tested. If a new version provisions and then fails licensing, drop one and report it; do
not re-pin.

**Related:** AP-HOST-2, AP-83.

---

## AP-85: Generating a Placeholder Email to Complete a Tide User's Profile

**Severity: Medium. Blast radius: junk contact data you cannot distinguish from real data.**

Tide's IdP asserts **only a username** — the vuid:

```java
BrokeredIdentityContext identity = new BrokeredIdentityContext(userId, providerConfig);
identity.setUsername(userId);       // no email, no firstName, no lastName
```

So a brokered signup can hit Keycloak's Account Information form, and the tempting fix is to
synthesise a unique address (`user-a3f9c2@example.invalid`) so validation passes.

**Don't. Leave email empty and collect it in-app afterwards.**

1. **It is indistinguishable from a real address downstream.** Billing, support, exports, incident
   mail — everything treats it as a contact, and eventually something sends to it. If the domain is
   real or becomes real, that is a leak to a stranger.
2. **It collides.** Keycloak enforces email uniqueness unless `duplicateEmailsAllowed` is true
   (VERIFIED `false` on a live Tide realm). Duplicates fail user creation with an error that never
   mentions email.
3. **It destroys the "never set" signal.** When the user supplies a real address you need to tell
   "absent" from "junk". An empty field carries that for free.
4. **Tide does not need email for recovery.** Password reset happens in the Secure Web Enclave, not
   by email link — the usual reason to demand an address at signup does not apply.

The username needs no generation either: the vuid is already unique and stable.

**Also do not assume which page you are seeing.** Four mechanisms render a similar form —
`idp-review-profile`, `VERIFY_PROFILE`, default required actions, and a stale action already on an
existing user — with four different fixes, and a realm-level change never clears the fourth. Run
`templates/skip-idp-review/diagnose-post-signup-page.sh`. A correctly provisioned Tide realm has
**none** of them active (VERIFIED read-only on a live realm: only `link-tide-account-action` and
`idp_link`, both non-default, and no required user-profile attributes), so if a page still appears
it is probably the **account console** — a redirect-URI problem, not a form.

**And when you do save the details, use the Account API with the user's own token**, not the Admin
API from your backend: that needs admin credentials in app runtime (**AP-41**) and, on a governed
realm, an admin write returns `202` and creates a change request — so the save appears to succeed and
silently does nothing until it is approved.

**Related:** AP-41. Procedure: `templates/skip-idp-review/ONBOARDING.md`.

---

## AP-86: Silencing a Bootstrap Write, and Restarting the App Mid-Enclave-Flow

Four failures from one build (LEARNINGS-vialproof-001), all sharing a shape: **the moment of failure
and the moment you find out are far apart, and the evidence is gone by then.**

### Never `>/dev/null` a governed write during bootstrap

A role grant POSTed with output discarded failed silently. The script then granted
`tide-realm-admin` and drained — flipping the realm to **multiAdmin**. The repair is now a different
class of problem from the miss:

```
POST /iga/change-requests/{id}/authorize
409 {"error":"MULTIADMIN_REQUIRES_APPROVAL_ENCLAVE","message":"multiAdmin change requests must be
     approved via the approval enclave (POST /iga/change-requests/{id}/approve); the simple
     authorize/commit path cannot sign a multiAdmin change request."}
POST /iga/change-requests/{id}/commit
412 {"error":"QUORUM_NOT_MET","message":"Approve to quorum before committing — need 1 more approval"}
```

**End the grant step with a verification read** — `GET /users/{id}/role-mappings` — and assert every
expected role is present. The multiAdmin flip is a one-way door; everything you forgot before it
becomes a human enclave approval for the life of the realm.

Good news for the repair: **only the approval is enclave-gated.** REST grant → pending `GRANT_ROLES`
CR → human approves in the console → **REST commit works fine** once quorum is met. A
poll-then-auto-commit watcher removes the second human step.

Same rule for `setUpTideRealm`: capture the body and status, abort unless 2xx, and assert
`GET /identity-provider/instances/tide` returns alias `tide` **before** handing anyone an invite
link. Otherwise the first symptom is Keycloak's *"We are sorry… internal server error"* page in a
human's browser — the least debuggable place possible.

### `UID` is readonly in bash

```
/bin/bash: line 8: UID: readonly variable
{"error":"User not found"}      # POST /users//role-mappings/... — empty id spliced in
```

Bash **refuses the assignment and continues**, so the variable keeps its old value and every later
grant 404s against a malformed URL. Use `USER_ID`. Enforced by a content gate.

### Role descriptions are capped at 255 characters

`KEYCLOAK_ROLE.DESCRIPTION` is `VARCHAR(255)`. A 289-char description fails the **entire realm
import** with an opaque HTTP 500; the cause appears only in the container log:

```
org.hibernate.exception.DataException: could not execute batch
[Value too long for column "DESCRIPTION CHARACTER VARYING(255)": "...(289)"]
```

The pack encourages rich, self-documenting descriptions — keep them under the cap. Enforced by a
content gate over shipped realm JSON.

### Never restart the app server while an enclave flow is in progress

```
Submitting to the ORK network…
Awaiting operator approval in the Tide enclave…
Executing threshold signature…
✗ Failed to fetch
```

An agent restarted the Next.js dev server while the human was mid-approval. The signing pipeline
needs the app origin to stay up (the DPoP relay under `/tide_dpop/`, SDK round-trips), so the flow
dies with a bare `Failed to fetch` **after the approval is spent — and approvals are not
refundable.**

Corollary for agents: `pkill -f "next dev"` **kills the agent's own shell**, because the pattern
matches its own command line (exit 144). Kill by port instead: `fuser -k 3000/tcp`.

### Do not delete a broken container

On the first error page the instinct is `docker rm` and redeploy. That destroys `docker logs` — the
only place Keycloak writes the actual cause of the two failures above. Print this next to every
invite link:

> If this link shows an error page, **leave the container running** and capture
> `docker logs <name>`. Deleting the container destroys the diagnosis.

(The surviving H2 `.trace.db` holds only benign first-boot migration noise — `Column
"T.LAST_MODIFIED_TIMESTAMP" not found`, `MIGRATION_MODEL not found (this database is empty)`. Do not
chase those.)

---

## AP-87: Deciding a User-Facing Choice and Reporting It Afterwards

**Severity: Medium. Blast radius: the user's product looks and behaves how the agent guessed.**

Observed three times in a row on the same two questions — branding, and what to collect from new
users. The pack put both in the MCP `instructions` block, the bootstrap output, and the playbook.
The agent then did both things *well* — generated a fitting mark, built a skippable in-app modal that
asked for no email and invented none — and told the user afterwards:

> **Two decisions I made — flag if you'd like them changed**

That is not a failure of capability. It is an agent optimising for *"everything that can be done
without a human is done"*, which is usually the right instinct and is exactly wrong for a choice
about how someone else's product looks.

**Why the obvious fixes did not work**

- **MCP `instructions` are advisory.** They also only reach a session that connected *after* the
  server was rebuilt — a server is a process started at connect time, so an updated build on disk
  changes nothing for a live session (see `mcp-server/verify-live.sh`).
- **Printing the question in bootstrap output** is skipped by an agent batching all human
  interaction to the end.
- **A playbook step** is read as documentation, not as a stop.

**What to do instead: attach the question to a step that already blocks on a human.**

In a Tide bootstrap that is the **admin invite link** — the script stops and polls until someone
opens it in a browser. The human is present and idle by construction. Both questions are printed
there, with an explicit instruction to the agent to ask and *wait*, because that is the only moment
where asking costs the user nothing.

**The general rule:** a question the user must answer belongs at an existing human checkpoint, not at
the point the information is first needed. If a workflow has no such checkpoint, the question will be
answered by whoever is present — and that is the agent.

**And when there is genuinely no checkpoint**, prefer a default that is *cheap to reverse* and say so
in one line, rather than a silent decision reported as done. Branding and profile fields both qualify:
re-running `brand-tidecloak.sh` replaces the art, and a profile modal is a component you can change.

### Why putting it in the pack's own scripts reached nobody

Four builds in a row reported *"decisions I made without asking"*. The fix kept being applied to
`templates/shared/bootstrap-tidecloak.sh` — and **agents do not run that script.** They write their
own `init-tidecloak.sh` per app, adapted to that app's realm, roles and container. Undertow's was
hand-written and correct; it simply never contained the banner, because the banner lived in a file
nothing read.

**The rule this generalises to:** guidance only reaches generated code if it lives where the agent
reads *while generating* — `canon/tidecloak-bootstrap.md` and the reference-app
`bootstrap-sequence.md` files — not in an example script it will never execute. If you find yourself
patching a shipped script to change agent behaviour, check first whether agents run it at all.

**Related:** the same "guidance existed, nothing surfaced it" shape as AP-86.
