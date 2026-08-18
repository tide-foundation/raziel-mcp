# Tide Troubleshooting Guide

Symptom-led debugging for common Tide implementation failures. Each entry includes diagnostic steps, fixes, and verification.

**Format**: Symptom → Possible Causes → Diagnostics → Fix → Verification

---

## Error-Text Lookup

**Start here.** Paste the error string you actually received. Symptom-grouped entries (T-01…T-26)
list many causes per symptom, which is the wrong index when you already have an exact message —
that flat-list-under-one-symptom shape cost a full deploy cycle on a failure that printed both
mismatched values.

Grep this file for your error text before reading anything else.

### Policy deployment / Forseti

| Error text | Cause | Fix |
|---|---|---|
| `Version is not a string` | Policy constructor: `version` missing | AP-60 — all five fields; `version: '3'` |
| `Breaking changes made to Policies. Update how you create a policy` | `version` present but `!== "3"` | AP-60 — must equal `Policy.latestVersion` |
| `ContractId is not a string` | Policy constructor: `contractId` missing | AP-60 |
| `ModelId is not a string` | Policy constructor: passed **plural** `modelIds`, or missing | AP-60 — the key is singular `modelId` |
| `KeyId is not a string` | Policy constructor: `keyId` missing | AP-60 — `keyId` IS the vendorId |
| `Params is null` | Policy constructor: `params` missing | AP-60 / AP-54 — `[key, value]` pairs |
| `object is not iterable` | `params` passed as a plain object | AP-54 |
| `Unknown contract type ''` | Contract transport built with 2 levels, not 3 | AP-64 — outer `"forseti"` wrapper |
| `Model id '...' not found in registry` | `modelId` not one of the nine built-ins, not `BasicCustom<...>` | AP-65 |
| `Could not find specified policy version: 2` | Emitting the V2 policy layout | The ORKs are **V3-only**. Do not subclass `Policy` to emit V2 (GAP-070 WITHDRAWN) |
| `Policy refers to wrong contract. Expected 'X' but policy has 'Y'` | Compare X and Y | Differ only in **case** → lowercase hex, `.toUpperCase()`. Differ entirely → contract edited after deploy, redeploy the policy |
| `VmHost.CompileFailed: ... error CS####` | Contract does not compile on the ORK | AP-67 — compile locally first ([forseti-compile-harness](../templates/forseti-compile-harness/)) |
| `'ExecutorContext' does not contain a definition for 'Data'` | Used `ctx.Data` in `ValidateExecutor` | The contexts are disjoint — capture in `ValidateData`, compare in `ValidateExecutor` |
| `Index out of range` at `Policy.From` | Stored `request.encode()` as the policy | AP-57 — store `policy.toBytes()` |
| `Policy supplied has not been signed` | VVK signature not attached before storing | AP-55 |
| `Could not fetch the realm admin policy` (app-generated) | Generic client message hiding 3 server causes | Read `body.error`. Usually: admin token absent from the dev server's shell |
| `Could not reach enough VVK ORKs (0 of N, N failed)` | Envelope-level rejection — read the **inner** bracketed error | The inner `[TIDE-ORK-...]` string is the real cause |
| `BadPolicy.ForbiddenCall:{target}` | Contract used a blocked namespace | Sandbox restrictions — see custom-contracts.md |
| `BadPolicy.EntryTypeNotFound` | Entry class not found / doesn't implement `IAccessPolicy` | AP-56 |
| `BadPolicy.BudgetExceeded` / `OutOfGasException` | Gas limit (50,000) exceeded | Reduce `ForsetiSdk.Claim`/`Log` calls |

### DPoP / auth

| Error text | Cause | Fix |
|---|---|---|
| `Refused to display … in a frame` + `nor delivers a Content Security Policy which is at least as strong` | **CSP Embedded Enforcement.** The relay path is missing `Allow-CSP-From: *`, or the rewrite is not a wildcard so the URL 404s | **Check the config, not the file** — see below. `framework-matrix.md` → Browser Prerequisites |
| `Popup DPoP verification failed to load` | **Three distinct causes.** (1) rewrite is `/tide_dpop` instead of `/tide_dpop/:path*` — the enclave requests `/tide_dpop/iss/<hex>/aud/<hex>/…`, so an exact path 404s; (2) relay path missing its CSP / `Allow-CSP-From: *`; (3) relay file is stale and posts to `window.parent` | Work them in that order: 1 and 2 are config (`next.config.ts`), 3 is the file (AP-62). **Most reports are 1 or 2, not 3.** Verify with the curl commands in `framework-matrix.md` |
| A pinned `sha256-…` appears in the CSP error and **matches your relay file** | Not a fault in the file — that is the hash the embedder **expects**. You have the **right file at the wrong address** | Fix the rewrite/headers. Do **not** go hunting a stale asset (GAP-068 is the wrong destination here) |
| Enclave refuses to frame your origin, after you "hardened" CSP | You added `frame-ancestors 'self'`. The SWE frames your own origin for silent SSO and the approval popup | Canon specifies **exactly** `frame-src 'self' *` — do not add `frame-ancestors` |
| The DPoP **popup appears every time** | Symptom, not a setting. The relay runs in an **iframe** first; when that path fails (e.g. it 404s) the SDK falls back to a popup for first-party context | No CSP setting suppresses it. Fix the iframe path (rewrite + headers); then the popup appears only when the browser genuinely blocks third-party storage |
| `Failed to construct 'URL': Invalid URL` / `TypeError: Invalid URL` | **`secureFetch` was given a RELATIVE url.** It derives the DPoP proof's `htu` with a bare `new URL()` and no base (`tidecloak.js:626-627`), so it throws before any request. Reads like a bad adapter config; it is not | AP-74 — `secureFetch(new URL(path, window.location.origin).href)` |
| 401 on your **own** API routes, with no DPoP error detail | App called its own endpoints with bare `fetch` in a DPoP realm — no `Authorization`, no proof | AP-73 — thread `secureFetch` from `useTideCloak()` into helper modules too |
| `toggle-iga` returned `{"enabled":true}` when you asked for `false` | The endpoint reads the FORM param `isIGAEnabled`; a JSON body is parsed by nothing and **fails open to true** | Form-encode and assert the response. `tidecloak-bootstrap.md` → toggle-iga |
| `{"error":…,"conflictingChangeRequestId":…}` from `toggle-iga` | Cannot toggle while change requests are pending | Drain first (`templates/shared/drain-change-requests.py`), then retry |
| `IDX10503` / `IDX10500` / signature validation failed on EVERY request after migrating | The realm now signs with **EdDSA**; the verifier is RS256-only or pinned to RS256 | AP-82 — run `templates/tidify-preflight/check-tidify.sh`; .NET specifically is T-23 |
| `invalid algorithm` / `alg not allowed` from a JWT library | An algorithm allowlist still pins RS256 | Repin to `EdDSA`; do NOT unpin (SG-13) |
| `Cannot find module './vendor-chunks/@tidecloak.js'` | Missing the `@tidecloak/react` ESM webpack alias (webpack fix 2) | AP-42 — both webpack fixes are required, always |
| `Failed to collect page data for /` immediately after `Compiled successfully` | Same as above — omitting webpack fix 2 fails **late**, and the build says "Compiled successfully" one line before failing | Apply both fixes together; neither message mentions `@tidecloak` or ESM/CJS |
| 404 on `/auth/redirect` after a successful login | The redirect handler does not exist, or was created at `/auth/callback` | The path is **`/auth/redirect`**. TideCloak redirects with `?code=…`, the browser 404s, the SDK never runs, **no error appears anywhere** (AP-REDIR-01) |
| `missingNormalization` / `Request path not normalized` | Double slash in an admin URL — the adapter's `auth-server-url` **ends with a slash** | `config['auth-server-url'].replace(/\/+$/, '')` before concatenating |
| `Must initialize request to generate unique id` | Assumed `initializeTideRequest` mutates in place | AP-59 — capture the return value |
| `IAMService.createTideRequest is not a function` | — | T-16 |
| `Cannot destructure property 'Policy' of 'Models'` | Imported from `@tidecloak/nextjs` | T-15 / AP-32 |
| `Client origin could not be verified` | — | T-21 |

### No error at all — the silent failures

These produce **no** message, which makes them the most expensive class. Nothing to grep for, so
they are listed by symptom.

| Symptom | Cause | Fix |
|---|---|---|
| Identity/claim fields all render `—` or empty; no console error | Read `tide.tokenParsed` — a keycloak-js property that does not exist on `TideCloakContextValue`; `undefined ?? {}` renders nothing | AP-69 — use `getValueFromToken(key)` / `getValueFromIdToken(key)`, and **fail closed** rather than defaulting |
| Signature never verifies, key set fetched successfully | Verifier pointed at the OIDC JWKS (RSA keys), not the realm VVK (Ed25519) | GAP-071 — see [verifiable-claims.md](verifiable-claims.md) |
| Certificate verifies but describes different content | Check 1 skipped — the file was never supplied | verifiable-claims.md — report SKIPPED, not PASS |
| Contract denies every signature | Contract compares the JWT subject; a doken has no `sub` | AP-66 — compare the vuid |
| Wrong app's static assets served | Two dev servers competing for port 3000 | Give each Tide app a distinct dev port |

---

## Diagnostic Principle: Every Layer Reports the Symptom, Not the Cause

Worth internalising before debugging anything in this stack, because it predicts where the time
goes. Across a single real deployment session, **every layer reported a symptom instead of the cause
it already knew**:

- The Policy constructor threw a **bare string** (`'Version is not a string'`) that names the failed
  guard but not the accepted shape — and validated sequentially, so each fix revealed one more.
- The DPoP relay reported **"failed to load"** for a page that returned HTTP 200 with a full body.
- A route that produced a genuinely helpful body for each of three distinct failures was wrapped in
  `if (!response.ok) throw new Error("<static text>")` — **the server's diagnosis was already
  written and never reached the person who needed it**.
- The ORK model registry printed a **.NET type name** (`ReadOnlyCollection\`1[System.String]`)
  instead of the id that failed to resolve, sending diagnosis down a wire-format dead end.
- A React screen read a **non-existent context property**, got `undefined`, defaulted it to `{}`,
  and rendered a confirmation UI with no identity and a live action button — **no error at all**.

**Two operational consequences:**

1. **Do not trust an error message's framing.** Treat "failed to load", "not found", and any message
   quoting a runtime **type name** as the outermost symptom, not the cause. Specifically: an error
   quoting a .NET/JVM type name where a value belongs is **not** reliable evidence of a wire-format
   mismatch (GAP-070 was withdrawn for exactly this reason).
2. **Always surface the inner error.** When proxying or wrapping, append `body.error` and the status
   code. When reading an ORK threshold failure, read the inner bracketed `[TIDE-ORK-...]` string.

**When writing Tide app code, make each layer say what it knows.** This costs almost nothing and is
worth more to Tide app DX than any new feature. Concretely: never discard a response body in an
error path; never default an identity field to a placeholder; throw with the accepted shape, not
just the rejected one.

(LEARNINGS-music-license-001 L-01, L-03, L-05, L-07, L-11, L-20)

---

## T-01: Login Hangs Indefinitely

**Symptom**: User clicks login, redirects to TideCloak, then hangs with spinner. No error visible. Browser tab never completes loading.

**Possible Causes**:
1. CSP blocks SWE iframe (most common)
2. SWE domain unreachable
3. Corrupted localStorage auth state
4. Missing `silent-check-sso.html`

**Diagnostics**:

```bash
# 1. Check browser console for CSP violations
# Open DevTools → Console
# Look for: "Refused to frame 'https://...' because it violates the following Content Security Policy directive"

# 2. Check CSP headers
curl -I https://app.example.com | grep -i content-security-policy

# 3. Check silent-check-sso.html exists
curl https://app.example.com/silent-check-sso.html
# Should return HTML with postMessage script

# 4. Check localStorage for stale state
# DevTools → Application → Local Storage
# Look for keys containing 'iam', 'auth', 'kc-', 'tc-'
```

**Fix**:

For CSP violation (Cause 1):
```typescript
// Next.js: next.config.js
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

// Express: server/index.ts
import helmet from 'helmet';
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      frameSrc: ["'self'", '*']
    }
  }
}));
```

For corrupted state (Cause 3):
```typescript
// Add reset handler in app initialization
const params = new URLSearchParams(window.location.search);
if (params.get('reset') === 'true') {
  Object.keys(localStorage).forEach(key => {
    if (key.includes('iam') || key.includes('auth') || key.startsWith('kc-') || key.startsWith('tc-')) {
      localStorage.removeItem(key);
    }
  });
  window.location.href = '/';
}
```

For missing silent SSO file (Cause 4):
```html
<!-- Create public/silent-check-sso.html -->
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
# Check CSP includes Tide domains
curl -I https://app.example.com | grep frame-src
# Should include frame-src '*' (required for ORK re-homing)

# Test login flow completes
# Login should redirect to TideCloak and back within 5-10 seconds
```

**Related**: Anti-Pattern AP-07, Invariants I-06, I-07

---

## T-02: JWT Verification Fails (401 Unauthorized)

**Symptom**: API calls return 401 Unauthorized despite successful login. Token appears valid in DevTools but server rejects it.

**Possible Causes**:
1. Adapter JSON missing `jwk` field (IGA not enabled or wrong export)
2. Using `createRemoteJWKSet` instead of embedded JWKS
3. Wrong `issuer` or `audience` in verification
4. Token expired (clock skew)
5. Generic Keycloak adapter instead of Tide adapter

**Diagnostics**:

```bash
# 1. Check adapter JSON has Tide extensions
jq 'has("jwk") and has("vendorId") and has("homeOrkUrl")' data/tidecloak.json
# Should output: true

jq '.jwk.keys | length' data/tidecloak.json
# Should output: 1 or more

# 2. Check JWT verification uses local JWKS only
grep -r "createLocalJWKSet\|config.jwk" lib/auth/ src/lib/auth/
# Should find local JWKS usage

# 2b. Check code does NOT use remote JWKS (forbidden for this pack)
grep -r "createRemoteJWKSet" lib/auth/ src/lib/auth/
# Should find ZERO matches. Any match is AP-01.

# 3. Decode token and check claims
# Copy token from browser DevTools → Network → request headers
echo "YOUR_TOKEN_HERE" | base64 -d | jq .
# Check iss, azp, exp, iat

# 4. Check server issuer/audience config
grep -r "issuer.*audience" server/lib/auth/
```

**Fix**:

For missing Tide adapter (Cause 5):
```bash
# Re-export adapter with Tide extensions
curl -X GET \
  "${TIDECLOAK_URL}/admin/realms/${REALM}/vendorResources/get-installations-provider?clientId=${CLIENT_ID}&providerId=keycloak-oidc-keycloak-json" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  > data/tidecloak.json

# Verify Tide fields present
jq '.jwk, .vendorId, .homeOrkUrl' data/tidecloak.json
```

For wrong JWKS source (Cause 2):
```typescript
// ❌ WRONG: remote JWKS (forbidden in this pack)
const JWKS = createRemoteJWKSet(new URL(`${issuer}/protocol/openid-connect/certs`));

// ❌ ALSO WRONG: remote as fallback
// Do not add createRemoteJWKSet as a fallback. Fix the adapter export instead.

// ✅ CORRECT: local JWKS only, fail if missing
import { loadTideConfig } from './tidecloakConfig';
const config = loadTideConfig();
if (!config.jwk) {
  throw new Error('Missing jwk in tidecloak.json. Re-export adapter with IGA enabled.');
}
const JWKS = createLocalJWKSet(config.jwk);
```

For missing `jwk` field (Cause 1):
```bash
# Re-export adapter with Tide extensions (IGA must be enabled)
curl -X GET \
  "${TIDECLOAK_URL}/admin/realms/${REALM}/vendorResources/get-installations-provider?clientId=${CLIENT_ID}&providerId=keycloak-oidc-keycloak-json" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  > data/tidecloak.json

# Verify jwk is present
jq '.jwk.keys | length' data/tidecloak.json
# If 0 or error: IGA is not enabled on the realm. Enable it first.
```

For wrong issuer/audience (Cause 3):
```typescript
const { payload } = await jwtVerify(token, JWKS, {
  issuer: `${config['auth-server-url'].replace(/\/+$/, '')}/realms/${config.realm}`,  // Must match token iss
});
// TideCloak uses azp (not aud) for client ID. aud is typically "account".
if (payload.azp !== config.resource) throw new Error('Token azp mismatch');
```

**Verification**:
```bash
# Test API call with valid token
TOKEN=$(curl -s ... | jq -r '.access_token')
curl -H "Authorization: Bearer $TOKEN" https://app.example.com/api/protected
# Should return 200, not 401
```

**Related**: Anti-Pattern AP-01, AP-13, Invariants I-03, I-04

---

## T-03: E2EE Operations Timeout

**Symptom**: `doEncrypt()` or `doDecrypt()` calls hang and eventually timeout. No error message or generic timeout error.

**Possible Causes**:
1. User missing E2EE role (`_tide_<tag>.selfencrypt` or `_tide_<tag>.selfdecrypt`)
2. Fabric connectivity issues (homeOrkUrl unreachable)
3. SWE iframe blocked (CSP issue)
4. Tag mismatch (encrypt with 'ssn', decrypt with 'SSN')
5. Offline (E2EE requires online Fabric access)

**Diagnostics**:

```bash
# 1. Check user has E2EE roles
curl "${TIDECLOAK_URL}/admin/realms/${REALM}/users/${USER_ID}/role-mappings/realm" | \
  jq '.[] | select(.name | startswith("_tide_"))'
# Should include _tide_<tag>.selfencrypt and _tide_<tag>.selfdecrypt

# 2. Check Fabric connectivity
jq -r '.homeOrkUrl' data/tidecloak.json
# Test ORK endpoint
curl https://sork1.tideprotocol.com/health  # or homeOrkUrl from adapter

# 3. Check browser console for E2EE errors
# DevTools → Console
# Look for: "Failed to load resource", "CORS error", "Timeout"

# 4. Check browser network tab for ORK requests
# DevTools → Network → Filter by tideprotocol.com
# Should see requests to ORK endpoints during encrypt/decrypt
```

**Fix**:

For missing roles (Cause 1):
```bash
# Create E2EE roles in TideCloak admin console
# Roles → Create Role
# Name: _tide_ssn.selfencrypt, _tide_ssn.selfdecrypt

# Assign to user via IGA
# Users → {user} → Role Mappings → Assign role
# (Creates change-set requiring quorum approval if IGA enabled)
```

For Fabric connectivity (Cause 2):
```bash
# Check firewall allows outbound to Tide ORKs
# Check homeOrkUrl is correct
jq -r '.homeOrkUrl' data/tidecloak.json

# Test from client environment
curl -I https://sork1.tideprotocol.com
```

For CSP issue (Cause 3):
```typescript
// Add Tide domains to CSP (see T-01)
```

For offline (Cause 5):
```typescript
// E2EE requires online access; no offline fallback
if (!navigator.onLine) {
  throw new Error('E2EE requires online connection to Fabric');
}
```

**Verification**:
```javascript
// Test encrypt/decrypt round-trip
const plaintext = 'test data';
const [ciphertext] = await iam.doEncrypt([{ data: plaintext, tags: ['test'] }]);
console.log('Encrypted:', ciphertext);  // Should complete within 2-5 seconds

const [decrypted] = await iam.doDecrypt([{ encrypted: ciphertext, tags: ['test'] }]);
console.log('Decrypted:', decrypted);  // Should match plaintext
assert(decrypted === plaintext);
```

**Related**: Anti-Pattern AP-04, Invariants I-11, [Concepts](concepts.md#threshold-e2ee-hermetic-e2ee)

---

## T-04: Silent Token Refresh Fails

**Symptom**: User forced to re-login every 10 minutes (or token expiration). No silent refresh. Session appears to expire prematurely.

**Possible Causes**:
1. Missing `silent-check-sso.html`
2. CSP blocks silent SSO iframe
3. Corrupted localStorage auth state
4. Silent SSO URL misconfigured in SDK init

**Diagnostics**:

```bash
# 1. Check silent-check-sso.html exists and is accessible
curl https://app.example.com/silent-check-sso.html
# Should return HTML with postMessage script

# 2. Check browser console during refresh
# Look for: 404 on silent-check-sso.html, CSP violation, postMessage errors

# 3. Check SDK init includes silentCheckSsoRedirectUri
grep -r "silentCheckSsoRedirectUri" src/ client/
# Should be set to {origin}/silent-check-sso.html

# 4. Check browser network tab around token expiration
# DevTools → Network → around 10-min mark
# Should see iframe request to TideCloak → redirect to silent-check-sso.html
```

**Fix**:

For missing file (Cause 1):
```html
<!-- Create public/silent-check-sso.html -->
<html>
<body>
  <script>
    parent.postMessage(location.href, location.origin);
  </script>
</body>
</html>
```

For SDK config (Cause 4) — pass the full adapter JSON from `tidecloak.json`, not destructured fields (AP-52):
```typescript
const config = await fetch('/api/config').then(r => r.json()); // full tidecloak.json
await iam.initIAM({
  ...config,
  silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
});
```

For corrupted state (Cause 3):
```typescript
// Implement reset handler (see T-01)
// Or: localStorage.clear() and reload
```

**Verification**:
```javascript
// Test silent refresh
// 1. Login successfully
// 2. Wait for token to approach expiration (check DevTools → Application → Local Storage for token exp)
// 3. Silent refresh should happen automatically without visible redirect
// 4. Check console for 'authRefreshSuccess' event

iam.on('authRefreshSuccess', () => {
  console.log('Silent refresh succeeded');
});
```

**Related**: Anti-Pattern AP-14, AP-15, Invariants I-07

---

## T-05: DPoP Verification Fails (401 or 403)

**Symptom**: API calls return 401 or 403 despite valid JWT. Error message mentions DPoP or token binding.

**Possible Causes**:
1. DPoP header missing or malformed
2. DPoP proof signature verification fails
3. `htm` or `htu` mismatch (method or URL wrong)
4. `iat` timestamp out of freshness window (>120s)
5. `jti` replayed (duplicate nonce)
6. `cnf.jkt` mismatch (token not bound to proof)

**Diagnostics**:

```bash
# 1. Check request includes DPoP header
# DevTools → Network → request → Headers
# Should have: DPoP: eyJ...

# 2. Decode DPoP proof
echo "DPOP_HEADER_VALUE" | base64 -d | jq .
# Check: typ="dpop+jwt", alg="ES256" or "EdDSA", htm, htu, iat, jti, jwk

# 3. Check server DPoP verification logic
grep -r "verifyDPoP\|DPoP.*htm\|DPoP.*htu" server/

# 4. Check server logs for DPoP error details
```

**Fix**:

For missing header (Cause 1):
```typescript
// Use SDK's secureFetch (automatically adds DPoP)
// PREREQUISITE: useDPoP must be configured on TideCloakProvider.
// Without useDPoP, secureFetch does not attach valid DPoP headers and requests fail with 401.
const response = await iam.secureFetch('/api/protected');

// Or manually add DPoP if not using SDK
const dpopProof = await generateDPoPProof('GET', '/api/protected');
const response = await fetch('/api/protected', {
  headers: {
    'Authorization': `DPoP ${token}`,
    'DPoP': dpopProof
  }
});
```

For htm/htu mismatch (Cause 3):
```typescript
// Ensure DPoP proof matches request
const method = 'POST';  // Must match actual request method
const url = 'https://app.example.com/api/users';  // Must match actual URL (no query string)

const dpopProof = await generateDPoPProof(method, url);
```

For iat freshness (Cause 4):
```typescript
// Generate fresh proof per request; do not cache
// Check server and client clocks are synchronized (NTP)
```

For jti replay (Cause 5):
```typescript
// Do not reuse DPoP proofs across requests
// Each request needs fresh proof with unique jti
```

For cnf.jkt mismatch (Cause 6):
```typescript
// Token and DPoP proof must use same key pair
// If token renewed, generate new DPoP proofs
```

**Verification**:
```bash
# Test DPoP request
TOKEN="..."
DPOP="..."
curl -H "Authorization: DPoP $TOKEN" -H "DPoP: $DPOP" https://app.example.com/api/protected
# Should return 200, not 401/403
```

**Related**: Anti-Pattern AP-06, AP-12, Invariants I-12

---

## T-06: IGA Changes Don't Apply

**Symptom**: Admin creates user or modifies role, but change doesn't take effect. No error visible.

**Possible Causes**:
1. IGA not enabled on realm
2. Change-set created but not approved
3. Change-set approved but not committed
4. Quorum not reached

**Possible Causes** (added):
5. Token not refreshed after commit — roles take up to 120s to appear in doken

**Diagnostics**:

```bash
# 1. Check IGA is enabled
curl "${TIDECLOAK_URL}/admin/realms/${REALM}" | jq '.igaEnabled // "not enabled"'
# Should output: true

# 2. Check pending change requests (current /iga/ surface — see canon/iga-change-requests-api.md)
curl "${TIDECLOAK_URL}/admin/realms/${REALM}/iga/change-requests?status=PENDING" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" | jq '.'
# Objects keyed by .id, with .status, .readyToCommit
```

**Fix**:

For IGA not enabled (Cause 1):
```bash
# Enable IGA
curl -X POST "${TIDECLOAK_URL}/admin/realms/${REALM}/tide-admin/toggle-iga" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}"
```

For a change request not approved (Cause 2):
```bash
# Authorize (approve) — CR_ID is the .id from the list above; body {} optional
curl -X POST "${TIDECLOAK_URL}/admin/realms/${REALM}/iga/change-requests/${CR_ID}/authorize" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" -H "Content-Type: application/json" -d '{}'
# 409 = you already signed (four-eyes). Tide MultiAdmin: use the {id}/approval-model enclave exchange.
# Repeat with different admin tokens until threshold reached.
```

For a change request not committed (Cause 3):
```bash
# Commit after threshold reached (readyToCommit==true); 412 if still short
curl -X POST "${TIDECLOAK_URL}/admin/realms/${REALM}/iga/change-requests/${CR_ID}/commit" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}"
```

For token not refreshed (Cause 5):
```
User must refresh token (logout/login or forceUpdateToken()) after commit.
New roles may take up to 120 seconds to appear in doken.
```

**Verification**:
```bash
# After commit, check change applied
# For user creation:
curl "${TIDECLOAK_URL}/admin/realms/${REALM}/users?username=${NEW_USERNAME}" | jq '.'
# User should exist

# For role assignment:
curl "${TIDECLOAK_URL}/admin/realms/${REALM}/users/${USER_ID}/role-mappings/realm" | jq '.[] | .name'
# Role should be in list
```

**Related**: Anti-Pattern AP-05, AP-10, Invariants I-10

---

## T-07: Account Linking Stuck

**Symptom**: New admin user clicks account linking URL, completes linking in browser, but backend poll never detects `tideUserKey` or `vuid`.

**Possible Causes**:
1. Linking URL expired (default 12h lifespan)
2. Poll timeout too short
3. Wrong user ID in poll
4. TideCloak/Fabric connectivity issue during linking

**Diagnostics**:

```bash
# 1. Check linking URL was generated correctly
# Look for lifespan parameter
echo $LINK_URL | grep -o "lifespan=[0-9]*"
# Default: 43200 (12 hours)

# 2. Check user attributes
curl "${TIDECLOAK_URL}/admin/realms/${REALM}/users/${USER_ID}" | \
  jq '.attributes.tideUserKey, .attributes.vuid'
# Should show values after linking completes

# 3. Check poll logic
grep -A 10 "poll.*tideUserKey" script/
# Verify poll interval and timeout
```

**Fix**:

For expired URL (Cause 1):
```bash
# Generate new linking URL with longer lifespan
curl -X POST \
  "${TIDECLOAK_URL}/admin/realms/${REALM}/tideAdminResources/get-required-action-link?userId=${USER_ID}&lifespan=86400" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '["link-tide-account-action"]'
```

For poll timeout (Cause 2):
```bash
# Increase poll timeout in init script
# Example from keylessh:
for i in {1..60}; do  # Poll for up to 5 minutes (60 * 5s = 300s)
  USER_KEY=$(curl -s ... | jq -r '.attributes.tideUserKey[0]')
  if [ -n "$USER_KEY" ]; then
    echo "Linked successfully"
    break
  fi
  sleep 5
done
```

**Verification**:
```bash
# After linking, verify attributes
curl "${TIDECLOAK_URL}/admin/realms/${REALM}/users/${USER_ID}" | \
  jq '.attributes | {tideUserKey, vuid}'
# Both should be non-null
```

**Related**: [Concepts](concepts.md#account-linking-onboarding), GAP-030

---

## T-08: Forseti Signing Fails

**Symptom**: `executeSignRequest()` throws error or rejects. Contract evaluation fails.

**Possible Causes**:
1. Contract compilation error (C# syntax)
2. Doken missing or expired
3. Challenge data format mismatch
4. ORK majority rejected policy
5. Gas limit exceeded (undocumented)

**Diagnostics**:

```bash
# 1. Check contract syntax
# Copy C# contract code and validate locally or via online compiler

# 2. Check doken is present
console.log(tc.doken);
# Should output JWT-shaped string, not null/undefined

# 3. Check browser console for Forseti errors
# DevTools → Console
# Look for: "Contract compilation failed", "Policy rejected", "Timeout"

# 4. Check challengeData structure matches contract expectations
console.log(signRequest.challengeData);
```

**Fix**:

For contract error (Cause 1):
```typescript
// Validate C# syntax
const contract = `
using System;
public class Policy {
  public static bool Evaluate(dynamic challenge) {
    // Ensure valid C# syntax
    return challenge.user == "admin";
  }
}
`;
```

For missing doken (Cause 2):
```typescript
// Ensure user is authenticated before creating request
if (!tc.doken) {
  await iam.doLogin({ redirectUri: window.location.origin });
}

const signRequest = await tc.createTideRequest({
  authorizer: tc.doken,  // Should be present after login
  ...
});
```

For policy rejection (Cause 4):
```typescript
// Review contract logic; ORKs may be correctly rejecting based on policy
// Example: User lacks required role, destination is blocked, etc.
// Check challengeData matches policy expectations
```

**Verification**:
```typescript
// Test successful signing
const signRequest = await tc.createTideRequest({
  contract: simplePolicyContract,
  modelName: 'BasicCustom<TEST>:BasicCustom<1>',
  authFlow: 'Policy:1',
  authorizer: tc.doken,
  challengeData: { test: true }
});

const result = await tc.executeSignRequest(signRequest);
console.log('Signature:', result.signature);  // Should be present
```

**Related**: [Concepts](concepts.md#forseti-policy-engine), Invariants I-15, GAP-007, GAP-008, GAP-018

---

## T-09: Token Expired Errors Despite Recent Login

**Symptom**: User logs in successfully, but API calls return "Token expired" within minutes. Token lifetime appears much shorter than expected.

**Possible Causes**:
1. Server and client clock skew
2. Token lifetime misconfigured in realm
3. Refresh logic not working (see T-04)
4. Token verification using wrong timezone

**Diagnostics**:

```bash
# 1. Check token claims
# Extract token from browser, decode
echo "TOKEN" | base64 -d | jq '.iat, .exp'
# iat = issued-at timestamp, exp = expiration timestamp

# Compare to current time
date +%s
# Should be between iat and exp

# 2. Check realm token lifetime
curl "${TIDECLOAK_URL}/admin/realms/${REALM}" | jq '.accessTokenLifespan'
# keylessh default: 600 (10 minutes)

# 3. Check server clock
date -u
# Should match client clock within ~60 seconds
```

**Fix**:

For clock skew (Cause 1):
```bash
# Sync server clock with NTP
sudo ntpdate -s time.nist.gov

# Or use systemd-timesyncd
sudo timedatectl set-ntp true
```

For token lifetime (Cause 2):
```bash
# Adjust realm token lifetime if needed
curl -X PUT "${TIDECLOAK_URL}/admin/realms/${REALM}" \
  -H "Content-Type: application/json" \
  -d '{"accessTokenLifespan": 1800}'  # 30 minutes

# Note: keylessh uses 600s; adjust based on app needs
```

For refresh logic (Cause 3):
```typescript
// See T-04 (Silent Token Refresh Fails)
```

**Verification**:
```bash
# Login and check token lifespan
TOKEN=$(curl -s ... | jq -r '.access_token')
echo $TOKEN | base64 -d | jq '.exp - .iat'
# Should output token lifetime in seconds (e.g., 600 for 10 min)
```

**Related**: T-04, [Concepts](concepts.md#required-roles-and-configuration)

---

## T-10: Realm Setup Fails

**Symptom**: Realm initialization via `setUpTideRealm` endpoint fails or realm missing Tide configuration.

**Possible Causes**:
1. Endpoint not available (wrong TideCloak version)
2. Missing request body fields (email, terms)
3. IGA toggle fails
4. Protocol mappers not created
5. `tidebrowser` flow not created

**Diagnostics**:

```bash
# 1. Check TideCloak version supports Tide endpoints
curl "${TIDECLOAK_URL}/admin/realms/${REALM}/vendorResources/setUpTideRealm" \
  -X POST -I
# Should return 200 or 400, not 404

# 2. Check request body (must be form-urlencoded, NOT JSON)
curl -X POST "${TIDECLOAK_URL}/admin/realms/${REALM}/vendorResources/setUpTideRealm" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "email=admin@example.com&isRagnarokEnabled=true"

# 3. Check realm configuration after setup
curl "${TIDECLOAK_URL}/admin/realms/${REALM}" | jq '.browserFlow, .defaultRoles'
# browserFlow should be 'tidebrowser'
# defaultRoles should include '_tide_enabled'

# 4. Check protocol mappers
curl "${TIDECLOAK_URL}/admin/realms/${REALM}/client-scopes" | \
  jq '.[] | select(.name=="roles") | .protocolMappers[] | select(.name | contains("tide"))'
```

**Fix**:

For endpoint unavailable (Cause 1):
```bash
# Verify TideCloak version
curl "${TIDECLOAK_URL}/admin/serverinfo" | jq '.systemInfo.version'
# Should be TideCloak version, not vanilla Keycloak
```

For manual realm configuration:
```json
// Import realm JSON with Tide defaults (based on keylessh realm.json)
{
  "realm": "myrealm",
  "browserFlow": "tidebrowser",
  "defaultRoles": ["_tide_enabled", "offline_access", "uma_authorization"],
  "accessTokenLifespan": 600,
  "ssoSessionIdleTimeout": 1800,
  "ssoSessionMaxLifespan": 36000,
  "roles": {
    "realm": [
      {"name": "_tide_enabled"}
    ]
  },
  "protocolMappers": [
    {
      "name": "Tide User Key Mapper",
      "protocol": "openid-connect",
      "protocolMapper": "oidc-usermodel-attribute-mapper",
      "config": {
        "user.attribute": "tideUserKey",
        "claim.name": "tideuserkey",
        "jsonType.label": "String",
        "id.token.claim": "true",
        "access.token.claim": "true"
      }
    },
    {
      "name": "VUID Mapper",
      "protocol": "openid-connect",
      "protocolMapper": "oidc-usermodel-attribute-mapper",
      "config": {
        "user.attribute": "vuid",
        "claim.name": "vuid",
        "jsonType.label": "String",
        "id.token.claim": "true",
        "access.token.claim": "true"
      }
    }
  ]
}
```

**Verification**:
```bash
# Check realm has Tide defaults
curl "${TIDECLOAK_URL}/admin/realms/${REALM}" | \
  jq '{browserFlow, defaultRoles, accessTokenLifespan}'
# Should match Tide configuration
```

**Related**: [Concepts](concepts.md#realm-initialization), Invariants I-14

---

## T-10b: Init Script Fails with "Invalid json representation for RoleRepresentation"

**Symptom**: `npm run init` (or `bootstrap-tidecloak.sh`) fails with:
```
{"error":"Invalid json representation for RoleRepresentation. Unrecognized field \"error\" at line 1 column 12."}
```

**Cause**: The script tries to assign `tide-realm-admin` to the admin user before the user creation change request is approved. With IGA enabled, the user is not queryable until committed. The role lookup returns `{"error":"..."}`, which is then passed as the body of the role mapping POST.

**Diagnostics**:
```bash
# Check if user exists
TOKEN="$(get_token)"
curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/users?username=admin" \
  -H "Authorization: Bearer $TOKEN" | jq '.[0].id'
# If null: user change request was not approved

# Check pending change requests (current /iga/ surface)
curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/iga/change-requests?status=PENDING" \
  -H "Authorization: Bearer $TOKEN" | jq length
# If > 0: approve them first (authorize + commit — see canon/iga-change-requests-api.md)
```

**Fix**: Approve user creation change request between user creation and role assignment:
```bash
# After creating user, BEFORE looking up user ID:
sleep 2
approve_and_commit users

# Then proceed with user ID lookup and role assignment
```

Also validate the role lookup result before using it:
```bash
ROLE_JSON=$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/clients/$CLIENT_UUID/roles/tide-realm-admin" \
  -H "Authorization: Bearer $TOKEN")
if echo "$ROLE_JSON" | jq -e '.error' > /dev/null 2>&1; then
  echo "ERROR: tide-realm-admin role not found: $ROLE_JSON"
  exit 1
fi
```

**Verification**: Re-run `npm run init` after fixing. The role assignment step should succeed without errors.

**Related**: [initialize-admin-and-link-account](../playbooks/initialize-admin-and-link-account.md) Step 1b

---

## T-11: Adapter JSON Export Fails

**Symptom**: Adapter JSON downloaded from TideCloak missing `jwk`, `vendorId`, or `homeOrkUrl` fields.

**Possible Causes**:
1. Using generic Keycloak adapter endpoint instead of Tide endpoint
2. Wrong `providerId` parameter
3. Client not properly configured in TideCloak

**Diagnostics**:

```bash
# 1. Check adapter JSON contents
jq 'keys' data/tidecloak.json
# Should include: jwk, vendorId, homeOrkUrl

jq 'has("jwk") and has("vendorId") and has("homeOrkUrl")' data/tidecloak.json
# Should output: true

# 2. Check export endpoint used
# Correct endpoint:
# GET /admin/realms/{realm}/vendorResources/get-installations-provider?clientId={clientId}&providerId=keycloak-oidc-keycloak-json  (realm-level; client is a query param)
```

**Fix**:

```bash
# Use correct Tide adapter export endpoint
curl -X GET \
  "${TIDECLOAK_URL}/admin/realms/${REALM}/vendorResources/get-installations-provider?clientId=${CLIENT_ID}&providerId=keycloak-oidc-keycloak-json" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -o data/tidecloak.json

# Verify Tide extensions present
jq '{jwk: (.jwk.keys | length), vendorId, homeOrkUrl}' data/tidecloak.json
# Should show all three fields
```

**Verification**:
```bash
# Validate adapter JSON structure
jq '
  if (has("jwk") and has("vendorId") and has("homeOrkUrl")) then
    "Valid Tide adapter"
  else
    "Invalid: missing Tide extensions"
  end
' data/tidecloak.json
```

**Related**: Anti-Pattern AP-13, Invariants I-05, I-13

---

## T-12: Policy Signing / Forseti Errors

**Symptom**: ORK rejects with "Index out of range", "Policy supplied has not been signed", "Policy refers to wrong contract", or similar errors during policy operations.

> **If you have an exact error string, use the [Error-Text Lookup](#error-text-lookup) instead.**
> The cause list below is a flat enumeration under one symptom; it is the wrong index when the error
> already names the failure. Cause 8 (lowercase hash) sat in this list and still cost a full deploy
> cycle, because nothing connected the message to it.

**Possible Causes** (client-side, before the network):

1. Policy constructor shape — missing `version`/`contractId`/`modelId`/`keyId`/`params`, or the **plural** `modelIds` key. Throws a **bare string**, sequentially, one per wrong field (AP-60)
2. `modelId` not one of the nine registered models and not `BasicCustom<Name>:BasicCustom<Version>` (AP-65)
3. Contract transport built with **two** nested levels instead of three — missing the outer `"forseti"` wrapper (AP-64)
4. `contractId` is lowercase hex; the ORKs compare case-sensitively. `.toUpperCase()` at the point of computation (L-14)
5. `contractId` no longer matches the contract source — the contract was edited after deployment, even a comment (L-19)
6. Contract does not compile on the ORK — compile locally first (AP-67)
7. Destructuring `{ ApprovalType, ExecutionType }` from `Models.Policy` instead of `Models` (`Models.Policy` is the Policy class, not a namespace)
8. Building the request manually with `BaseTideRequest` + `TideMemory` instead of using `PolicySignRequest.New(policy)` from `heimdall-tide` — which also builds the contract transport correctly
9. Not decoding `createTideRequest` result via `BaseTideRequest.decode()` before passing to approval
10. Calling `addPolicy(policy.toBytes())` during `BaseTideRequest` construction (attaching unsigned policy)
11. Using `modelId: "any"`. For E2EE use `["PolicyEnabledEncryption:1", "PolicyEnabledDecryption:1"]`; for a custom contract use the `BasicCustom<...>` form
12. Admin policy bytes are base64 text passed as raw bytes instead of decoded
13. Admin policy looked up as `admin-policy`; the name is **`tide-realm-admin`**, and a `?? policies[0]` fallback hides the miss (AP-63)
14. Admin token absent from the shell the dev server was started in — the route 503s and the client usually reports a generic message (L-05/L-07)

**Causes 1–6 are all catchable client-side before any network call.** Run the
[pre-flight checklist](custom-contracts.md#pre-flight-checklist-all-client-side-no-network) — causes
2, 3, 4 and 6 fail at the **threshold signature**, after the enclave operator approval, so each
attempt costs an approval cycle.

**Diagnostics**:

```bash
# 1. Check imports are correct
grep -n "Models.Policy" src/
# If you see: const { ApprovalType } = Models.Policy → WRONG
# Should be:  const { Policy, ApprovalType, ExecutionType, BaseTideRequest } = Models;

# 2. Check PolicySignRequest source
grep -n "PolicySignRequest" src/
# Should use: PolicySignRequest.New(policy) from 'heimdall-tide'
# NOT: manual BaseTideRequest + TideMemory construction

# 3. Check BaseTideRequest.decode is called after createTideRequest
grep -A 2 "createTideRequest" src/
# Should see: BaseTideRequest.decode(await tc.createTideRequest(...))

# 4. Check addPolicy is NOT called before approval
grep -B 5 "addPolicy" src/
# addPolicy should appear AFTER requestTideOperatorApproval, not before

# 5. Check modelId in Policy constructor
grep -A 5 "new Policy" src/
# Should see: modelId: ["PolicyEnabledEncryption:1", "PolicyEnabledDecryption:1"]
# NOT: modelId: "any"

# 6. Check admin policy bytes are properly decoded
grep -A 3 "adminPolicy\|policyBytes" src/
# If bytes start with [65, 81, 65, 65, ...] (ASCII for "AQAA..."),
# you are passing base64 text as byte values instead of decoding
```

**Fix**:

For wrong imports (Cause 1):
```typescript
// ❌ WRONG — Models.Policy is the class itself, not a namespace
const { ApprovalType, ExecutionType } = Models.Policy;
// Results in: Cannot read properties of undefined (reading 'IMPLICIT')

// ✅ CORRECT
const { Models } = await import("@tideorg/js");
const { Policy, ApprovalType, ExecutionType, BaseTideRequest } = Models;
```

For manual request construction (Cause 2):
```typescript
// ❌ WRONG — manual construction produces bytes ORK cannot parse
const request = new BaseTideRequest();
request.setDraft(TideMemory.CreateFromArray([policy.toBytes(), contractBytes]));

// ✅ CORRECT — use PolicySignRequest.New from heimdall-tide
const { PolicySignRequest } = await import("heimdall-tide");
const policyRequest = PolicySignRequest.New(policy);
policyRequest.addForsetiContractToUpload(CONTRACT_SOURCE);
policyRequest.setCustomExpiry(604800);
```

For missing decode (Cause 3):
```typescript
// ❌ WRONG — passing raw bytes without decode
const raw = await tc.createTideRequest(policyRequest.encode());
const approvals = await tc.requestTideOperatorApproval([
  { id: "policy", request: raw }  // raw bytes cause serialization errors
]);

// ✅ CORRECT — decode then re-encode
const initialized = BaseTideRequest.decode(
  await tc.createTideRequest(policyRequest.encode())
);
const approvals = await tc.requestTideOperatorApproval([
  { id: "policy", request: initialized.encode() }
]);
```

For premature addPolicy (Cause 4):
```typescript
// ❌ WRONG — attaching unsigned policy before approval
tideRequest.addPolicy(policy.toBytes());
const result = await tc.createTideRequest(tideRequest.encode());

// ✅ CORRECT — attach signed admin policy AFTER approval
const approved = BaseTideRequest.decode(approvals[0].request);
const adminPolicyBytes = await fetchAdminPolicyFromTideCloak(token);
approved.addPolicy(adminPolicyBytes);
const signatures = await tc.executeSignRequest(approved.encode(), true);
```

For wrong modelId (Cause 5):
```typescript
// ❌ WRONG
const policy = new Policy({
  modelId: "any",  // ORK fails with "Index out of range" in Policy.From
  // ...
});

// ✅ CORRECT
const policy = new Policy({
  modelId: ["PolicyEnabledEncryption:1", "PolicyEnabledDecryption:1"],
  // ...
});
```

For base64 admin policy bytes (Cause 6):
```typescript
// ❌ WRONG — passing base64 string characters as byte values
const policyBytes = new TextEncoder().encode(base64String);
// Results in bytes like [65, 81, 65, 65, ...] (ASCII for "AQAA...")

// ✅ CORRECT — decode base64 to actual bytes
const policyBytes = Uint8Array.from(atob(base64String), c => c.charCodeAt(0));
```

**Verification**:
```typescript
// Test the full policy signing flow
const { Models } = await import("@tideorg/js");
const { Policy, ApprovalType, ExecutionType, BaseTideRequest } = Models;
const { PolicySignRequest } = await import("heimdall-tide");

const policy = new Policy({
  version: "3",
  contractId: contractHash,
  modelId: ["PolicyEnabledEncryption:1", "PolicyEnabledDecryption:1"],
  keyId: vendorId,
  approvalType: ApprovalType.IMPLICIT,
  executionType: ExecutionType.EXECUTE_ON_APPROVE,
  params: new Map([["Role", roleName]]),
});

const policyRequest = PolicySignRequest.New(policy);
policyRequest.addForsetiContractToUpload(CONTRACT_SOURCE);
const initialized = BaseTideRequest.decode(
  await tc.createTideRequest(policyRequest.encode())
);
// Should not throw "Index out of range" or other serialization errors

const approvals = await tc.requestTideOperatorApproval([
  { id: "enc-policy", request: initialized.encode() }
]);
console.log('Approval status:', approvals[0].status);
// Should be "approved", not an error
```

**Anti-pattern**: Do NOT try to debug ORK byte serialization errors by inspecting raw bytes. Instead, copy the exact working pattern from the forseti-crypto-quickstart reference implementation. If the flow deviates from the 5-step pattern (create policy, create request, approve via popup, attach admin policy, execute), start over from the reference.

**Related**: T-08, Anti-Pattern AP-04, Invariants I-15, [Concepts](concepts.md#forseti-policy-engine)

---

## T-15: Package-Boundary Import Failure (Models/PolicySignRequest from Wrong Package)

**Symptom**: `Cannot destructure property 'Policy' of 'Models' as it is undefined` or similar destructuring failures when setting up policy signing.

**Root Cause**: `Models`, `PolicySignRequest`, `BaseTideRequest`, `ApprovalType`, and `ExecutionType` were imported from `@tidecloak/nextjs`. That package is the Next.js hooks/provider layer. It does NOT export these symbols. They are `undefined` at runtime.

**Diagnostics**:

```bash
# Check for wrong import source
grep -n "@tidecloak/nextjs" src/ | grep -i "Models\|PolicySignRequest\|BaseTideRequest\|ApprovalType\|ExecutionType"
# ANY match = wrong package

# Check dynamic imports
grep -n 'import("@tidecloak/nextjs")' src/
# If this appears in policy-signing code, it's the problem
```

**Fix**: Import `Models` from `@tideorg/js` and `PolicySignRequest` from `heimdall-tide`:

```typescript
// ❌ WRONG — @tidecloak/nextjs does not export these
const { Models, PolicySignRequest } = await import("@tidecloak/nextjs");

// ✅ CORRECT — use the source packages
const { Models } = await import("@tideorg/js");
const { PolicySignRequest } = await import("heimdall-tide");
const { Policy, ApprovalType, ExecutionType, BaseTideRequest } = Models;
```

**Package-boundary rule**: `@tidecloak/nextjs` exports `TideCloakProvider`, `useTideCloak`, `useAuthCallback`, guard components. It does NOT export `Models`, `PolicySignRequest`, or any policy/model helpers. Those come from `@tideorg/js` and `heimdall-tide`.

**Related**: [Concepts: SDK Internals](concepts.md#sdk-internals)

---

## T-16: `IAMService.createTideRequest is not a function`

**Symptom**: `IAMService.createTideRequest is not a function` (or same for `requestTideOperatorApproval`, `executeSignRequest`) during policy signing.

**Root Cause**: `createTideRequest`, `requestTideOperatorApproval`, and `executeSignRequest` are methods on the underlying **TideCloak** instance, not on `IAMService` directly. The TideCloak instance is accessible at `IAMService._tc`.

**Diagnostics**:

```bash
# Check for direct IAMService calls that should go through _tc
grep -n "IAMService\.createTideRequest\|IAMService\.requestTideOperatorApproval\|IAMService\.executeSignRequest" src/
# ANY match = wrong call target
```

**Fix**:

```typescript
// ❌ WRONG — these methods do not exist on IAMService
await IAMService.createTideRequest(request);
await IAMService.requestTideOperatorApproval(requests);
await IAMService.executeSignRequest(request, true);

// ✅ CORRECT — access the underlying TideCloak instance via _tc
const tc = IAMService._tc;
await tc.createTideRequest(request);
await tc.requestTideOperatorApproval(requests);
await tc.executeSignRequest(request, true);
```

**Method locations**:

| Method | Lives on | NOT on |
|--------|----------|--------|
| `createTideRequest()` | `IAMService._tc` (TideCloak) | `IAMService` |
| `requestTideOperatorApproval()` | `IAMService._tc` (TideCloak) | `IAMService` |
| `executeSignRequest()` | `IAMService._tc` (TideCloak) | `IAMService` |
| `doEncrypt()` / `doDecrypt()` | `IAMService` | — |
| `getToken()` / `getUserInfo()` | `IAMService` | — |

**Related**: [Playbook: setup-forseti-e2ee](../playbooks/setup-forseti-e2ee.md), [Concepts: SDK Internals](concepts.md#sdk-internals)

---

## Common Error Messages

| Error | Cause |
|-------|-------|
| "Policy supplied has not been signed" | Admin policy not attached in step 3, or policy bytes are unsigned |
| "Policy refers to wrong contract" | contractId hash doesn't match deployed contract source. Hash comparison is case-sensitive — ORK stores uppercase hex. Use `.toUpperCase()` if computing locally, or fetch `contractHash` from the API. |
| "Model does not have a policy passed with it" | `addPolicy()` was skipped or admin policy bytes are null |
| "Index out of range" in `Policy.From` | Admin policy bytes are base64 text passed as raw bytes instead of decoded |
| "IAccessPolicy could not be found" | Contract missing `using Ork.Forseti.Sdk;` |
| "vendordecrypt voucher not allowed" | User missing `_tide_{tag}.selfdecrypt` role |
| "Missing role 'group-member:...'" | Doken doesn't have the role, need logout/login or `forceUpdateToken()` after IGA approval |
| "Unexpected token '<'" on config load | `configFilePath` used instead of `configUrl`, or `tidecloak.json` not in `public/` |
| "TideCloak client not initialized" | `login()` called before SDK finished initializing, check `isInitializing` before guards |
| `requiresApprovalPopup: true` | Backend cannot auto-approve, must open approval enclave in admin's browser |
| `Cannot destructure property 'Policy' of 'Models' as it is undefined` | `Models` imported from `@tidecloak/nextjs` (wrong package). Import from `@tideorg/js` instead. See T-15. |
| `IAMService.createTideRequest is not a function` | `createTideRequest` (and `requestTideOperatorApproval`, `executeSignRequest`) live on `IAMService._tc` (TideCloak), not `IAMService`. See T-16. |
| `Cannot destructure 'verifyTideCloakToken'` | Very old `@tidecloak/verify` (single-export build); upgrade — current versions ship dual CJS/ESM exports and a plain named import works. Note arg order is `(config, token, allowedRoles?)`. |
| "Tide realm setup failed" / "Could not set up the Tide realm" | `setUpTideRealm` expects `Content-Type: application/x-www-form-urlencoded` with `email` (`@FormParam`), not JSON. (There is no explicit email-null guard; a missing/blank email surfaces as a downstream setup failure.) |
| "Could not find configuration for Required Action" | Missing Tide env vars (`SYSTEM_HOME_ORK`, `USER_HOME_ORK`, `THRESHOLD_T`, `THRESHOLD_N`, `PAYER_PUBLIC`) from Docker |
| AccessDeniedException on H2 | Data directory mounted as project root or wrong permissions; mount `./data` subdirectory and `chown 1000:1000` |
| `"User has not been given any access to '${tag}'"` | User lacks `_tide_{tag}.selfencrypt` or `.selfdecrypt` role for self-encryption. Fatal — assign role, then re-login. |
| `"[TIDECLOAK] No doken found"` | Missing delegated token for encryption. Retryable — re-auth may fix. |
| `"enclave.networkFailure"` | ORK unreachable. Retryable — transient network issue. |
| `"enclave.throttled"` | Rate limited by ORK. Retryable — backoff and retry. |
| `"enclave.thresholdTimeoutFailure"` | Not enough ORK responses before timeout. Retryable — transient. |
| `"Mismatch between session key private and Doken session key public"` | Session key mismatch. Fatal — re-login required. |
| `"DPoP is set to strict mode but the server does not advertise DPoP support"` | DPoP strict mode enabled but server lacks `dpop_signing_alg_values_supported`. Fatal — fix server config or DPoP mode. |
| `"DPoP requires IndexedDB for secure key storage"` | IndexedDB unavailable in browser environment. Fatal — environment limitation. |
| `NetworkError` (with `.response`) | Server responded with invalid HTTP status. Retryable — transient. Only custom error class in SDK. |

---

## T-13: Self-Encryption Fails — Do Not Rename Roles

**Symptom**: `doEncrypt` or `doDecrypt` fails with "User has not been given any access" or similar. Agent considers renaming `_tide_{tag}.selfencrypt` to `_tide_{tag}.encrypt`.

**Root cause**: This is a self-encryption setup problem, not a signal to switch encryption models.

**Diagnostics**:
```bash
# 1. Check self-encryption roles exist
curl -s "$TIDECLOAK_URL/admin/realms/$REALM/roles" \
  -H "Authorization: Bearer $TOKEN" | jq '.[].name' | grep '_tide_'

# 2. Check roles are in default composite
curl -s "$TIDECLOAK_URL/admin/realms/$REALM/roles/default-roles-$REALM" \
  -H "Authorization: Bearer $TOKEN" | jq '.composites.realm'

# 3. Check IGA change requests are approved
curl -s "$TIDECLOAK_URL/admin/realms/$REALM/iga/change-requests?status=PENDING" \
  -H "Authorization: Bearer $TOKEN" | jq length
# Should be 0. If > 0, authorize and commit (canon/iga-change-requests-api.md).

# 4. Check user's JWT has the roles
# Decode token and check realm_access.roles
```

**Fix**: Fix the self-encryption setup. Do NOT rename roles.

1. Create missing roles: `_tide_{tag}.selfencrypt`, `_tide_{tag}.selfdecrypt`
2. Add to default composite
3. Approve IGA change requests
4. User must re-login (roles propagate on next token refresh, up to 120s)

**Forbidden**: Renaming `selfencrypt` to `encrypt` or `selfdecrypt` to `decrypt`. The role suffix does not change the encryption model. The SDK call path (`doEncrypt` from `useTideCloak()` vs `IAMService.doEncrypt(data, policyBytes)`) determines self vs shared. See AP-26.

**When shared encryption IS needed**: If multiple users must decrypt the same ciphertext, this is a different encryption model entirely. Route to playbook `setup-forseti-e2ee`. It requires a Forseti contract, policy signing, and `IAMService.doEncrypt(data, signedPolicyBytes)`.

---

## T-14: Policy Commit Fails Due to Missing Admin Policy

**Symptom**: `executeSignRequest` or policy commit fails with "Policy supplied has not been signed" or "Model does not have a policy passed with it".

**Root cause**: The admin authorizer policy was not attached to the request before commit.

**Diagnostics**:
```bash
# 1. Check the role-policies endpoint is reachable (admin bearer required)
curl -s -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  "${TIDECLOAK_URL}/admin/realms/${REALM}/iga/role-policies"
# Should return a JSON array of records; each carries the signed bytes in its `policy` field.
# NOTE: the old public GET /realms/{realm}/tide-policy-resources/admin-policy endpoint
# is NOT present on current main; do not rely on it.

# 2. Check URL construction (common: double slash from trailing slash in auth-server-url)
echo "${TIDECLOAK_URL}/admin/realms/${REALM}/iga/role-policies"
# Must not contain // between host and path (except after protocol)

# 3. Check if addPolicy was called AFTER approval, not before
grep -B 5 "addPolicy" src/
# addPolicy must appear after requestTideOperatorApproval, not during request construction
```

**Fix**:

1. **Fetch the signed admin policy from the correct endpoint** (server-side, admin bearer token):
   ```
   GET /admin/realms/{realm}/iga/role-policies
   ```
   The signed policy bytes live in each record's `policy` field. Not: the public
   `GET /realms/{realm}/tide-policy-resources/admin-policy` endpoint (not on current main),
   nor `GET /admin/realms/{realm}/tide-admin/realm-policy` (returns `{ status: "none" }`).

2. **Decode the base64 `policy` field**:
   ```js
   const records = await res.json();
   const b64 = records[0].policy;            // signed bytes, base64-encoded
   const raw = Buffer.from(b64, "base64");
   const bytes = new Uint8Array(raw);
   ```
   If bytes start with `[65, 81, 65, 65, ...]` (ASCII for "AQAA"), you are passing base64 text as raw bytes.

3. **Attach after approval, not during construction**:
   ```js
   // Step 3 of 5-step flow: AFTER requestTideOperatorApproval
   const approved = BaseTideRequest.decode(approvalResults[0].request);
   approved.addPolicy(adminPolicyBytes);  // HERE — after approval
   ```

4. **URL normalization**: Strip trailing slashes from `auth-server-url` before constructing endpoint URLs:
   ```js
   const baseUrl = config["auth-server-url"].replace(/\/+$/, "");
   const rolePoliciesUrl = `${baseUrl}/admin/realms/${config.realm}/iga/role-policies`;
   ```

**This is a bootstrap/policy-flow failure, not a role issue.** Do not attempt to fix by renaming roles or switching encryption models.

---

## Common Diagnostic Commands

### Check Auth State
```javascript
// Browser console
console.log('Authenticated:', iam.authenticated);
console.log('User:', await iam.getUserInfo());
console.log('Token:', await iam.getToken());
console.log('Doken:', tc?.doken);
```

### Check Roles
```bash
# Server-side
curl "${TIDECLOAK_URL}/admin/realms/${REALM}/users/${USER_ID}/role-mappings/realm" | \
  jq '.[] | .name'
```

### Check Fabric Connectivity
```bash
# From adapter JSON
HOME_ORK=$(jq -r '.homeOrkUrl' data/tidecloak.json)
curl -I $HOME_ORK
# Should return 200 or 30x
```

### Check CSP Headers
```bash
curl -I https://app.example.com | grep -i content-security-policy
```

### Check Browser Network Tab
```text
DevTools → Network → Filter:
- "tidecloak" - Auth requests to TideCloak
- "tideprotocol.com" - ORK/Fabric requests
- "dauth.me" - SWE iframe requests

Look for: 404s, CORS errors, timeouts
```

### Check Browser Console
```text
DevTools → Console → Filter errors
Common Tide errors:
- "CSP violation" → T-01
- "Failed to verify JWT" → T-02
- "E2EE timeout" → T-03
- "DPoP verification failed" → T-05
- "Contract compilation failed" → T-08
```

---

## Symptom Index

| Symptom | Troubleshooting Entry |
|---------|----------------------|
| Login hangs indefinitely | T-01 |
| 401 Unauthorized on API calls | T-02, T-05 |
| E2EE encrypt/decrypt timeouts | T-03 |
| Silent refresh fails, frequent re-login | T-04 |
| DPoP verification errors | T-05 |
| Admin changes don't apply | T-06 |
| Account linking stuck | T-07 |
| Forseti signing fails | T-08 |
| Token expired errors | T-09 |
| Realm setup fails | T-10 |
| Adapter JSON missing fields | T-11 |
| Policy signing / Forseti ORK rejections | T-12 |

---

## When to Check Source Material

If troubleshooting entries don't resolve the issue:

1. Check [Gap Register](../GAP_REGISTER.md) for known unresolved questions
2. Review [Anti-Patterns](anti-patterns.md) for common mistakes
3. Verify [Invariants](invariants.md) are not violated
4. Consult keylessh exemplar for implementation patterns
5. Check TideCloak Admin Console audit trail for event errors

---

## Escalation Path

If issue persists after troubleshooting:

1. Collect diagnostics:
   - Browser console errors
   - Network tab filtered by "tidecloak", "tideprotocol"
   - Server logs around failure time
   - Adapter JSON contents (redact sensitive fields)
   - Realm configuration (defaultRoles, browserFlow, token lifetimes)

2. Check if gap is documented:
   - Search [Gap Register](../GAP_REGISTER.md) for similar issue
   - Review [Assumptions](../notes/assumptions.md) for related uncertainties

3. Create minimal reproduction:
   - Simplest code that triggers issue
   - Environment details (framework, TideCloak version, browser)

4. Document as new gap if unresolved

---

## T-17: pnpm `ERR_PNPM_NO_MATCHING_VERSION` for Tide Packages

**Symptom**: `pnpm add @tidecloak/react` or `pnpm install` fails with `ERR_PNPM_NO_MATCHING_VERSION`.

**Root cause**: pnpm's `minimum-release-age` setting in `.npmrc` blocks recently-published packages. Tide's entire dependency tree (`@tidecloak/*`, `heimdall-tide`, `@tideorg/*`) is published on the same cadence and all hit this gate.

**Fix**: Add exclusions to `.npmrc`:
```ini
minimum-release-age-exclude[]=@tidecloak/*
minimum-release-age-exclude[]=heimdall-tide
minimum-release-age-exclude[]=@tideorg/*
minimum-release-age-exclude[]=asgard-tide
```

**Verification**: `pnpm add @tidecloak/react` resolves without version errors.

VERIFIED (TIDE_LEARNINGS-001 L-05).

---

## T-18: IGA Change-Request Approval May Require Admin Console UI (Tide MultiAdmin)

**Symptom**: REST-based `POST /iga/change-requests/{id}/authorize` succeeds but `commit` fails (or the CR never reaches `readyToCommit`) with "Could not find authorization signature."

**Root cause**: In Tide MultiAdmin mode, approval is a cryptographic operation requiring the admin's Tide doken and ORK interaction — a bare `authorize` is not enough; the admin must complete the two-phase `{id}/approval-model` enclave exchange. FirstAdmin/Tideless mode signs server-side on `authorize`, so bootstrap works headless.

**When this happens**: Typically once the realm is in Tide MultiAdmin mode (a `tide-realm-admin` exists and IGA requires the cryptographic round-trip). The bootstrap script's `approve_all_pending` works during initial FirstAdmin bootstrap but a headless `authorize` fails for subsequent MultiAdmin operations.

**Fix**: Complete the enclave step — `GET`/`POST /iga/change-requests/{id}/approval-model` with the SDK/enclave, or approve from the TideCloak admin console UI (`http://localhost:8080/admin/master/console/#/{realm}` → Change Requests).

**Verification**: After approval, `GET /iga/change-requests?status=PENDING` returns `[]`.

VERIFIED (TIDE_LEARNINGS-001 L-11).

---

## T-19: TideCloak 500 Error Masked as CORS Error in Browser

**Symptom**: Browser console shows "CORS header 'Access-Control-Allow-Origin' missing" on a TideCloak request (typically the token endpoint). The app appears to have a CORS misconfiguration.

**Root cause**: TideCloak (Keycloak-based) does not include CORS headers on error responses (especially 500 Internal Server Error). The browser blocks the response due to missing CORS headers and reports it as a CORS error, hiding the real server-side failure.

**Diagnostics**:
1. Open DevTools → Network tab
2. Find the failing request to TideCloak
3. Check the actual HTTP status code (ignore the console error message)
4. If status is 500: the issue is server-side, not CORS
5. Check TideCloak container logs: `docker logs <container>` for the real error

**Common 500 causes**:
- ORK PreSign failure — on a stale realm, recreate it. Actual PreSign error strings on current ORK include: `"Tide user authentication data provided but no valid authentication method found within"` and `"DPoP thumbprint in requested token does not match with what the tide user approved"` (`ork: TidecloakSessionStartTokenSignRequest.cs`). (The older `Provided TideAuthData OR PreviousTokenAuthorization` string is no longer emitted.)
- Database connection failure
- Realm misconfiguration after incomplete bootstrap

**Fix**: Resolve the underlying server-side error. CORS headers will appear on successful responses. Do not add CORS workarounds for what is actually a 500 error.

**Verification**: After fixing the server error, the request returns 200 with proper CORS headers.

VERIFIED (LEARNINGS-ratidefy-batch-001 L-15).

---

## T-20: Admin API Returns 401 Despite Valid Roles (Missing JWT kid)

**Symptom**: Token has all admin roles (`realm-admin`, `manage-users`, `view-users`, etc.), token is not expired, but admin REST API returns `{"error":"HTTP 401 Unauthorized"}`. TideCloak logs show `kid is null, cant find public key: realm={0}`.

**Possible Causes**:
1. JWT header has no `kid` field — realm's EdDSA signing key configuration is broken
2. Token signed with ORK threshold EdDSA but no `kid` reference for admin API to look up the verification key

**Diagnostics**:

```bash
# Decode the JWT header
echo '<token>' | cut -d. -f1 | base64 -d 2>/dev/null | jq .
# If output shows {"alg":"EdDSA","typ":"JWT"} with NO "kid" field — that's the problem
```

**Fix**: Recreate the TideCloak realm. The `kid` issue is a realm-level configuration problem that cannot be fixed on existing tokens. A new realm will issue tokens with proper `kid` in the JWT header.

**Verification**: After recreating the realm, decode a new token's header — it should include `"kid": "some-key-id"`.

VERIFIED (Ratidefy SaaS — ratidefy-sign realm had missing kid, recreated as ratidefy-sign-2).

---

## T-21: Enclave Error "Client origin could not be verified"

**Symptom**: Tide enclave popup appears and immediately closes. Browser console shows `[HEIMDALL] Recieved enclave error: Client origin could not be verified`.

**Possible Causes**:
1. `CustomAdminUIDomain` not set on Tide IDP
2. IDP settings not signed after setting `CustomAdminUIDomain`
3. `client-origin-auth` key in adapter config is malformed or missing the origin URL

**Diagnostics**:

```bash
# Check CustomAdminUIDomain
TOKEN=$(curl -s -X POST "$TC_URL/realms/master/protocol/openid-connect/token" \
  -d "username=admin&password=$PASS&grant_type=password&client_id=admin-cli" | jq -r .access_token)
curl -s "$TC_URL/admin/realms/$REALM/identity-provider/instances/tide" \
  -H "Authorization: Bearer $TOKEN" | jq '.config.CustomAdminUIDomain'

# Check adapter config for client-origin-auth key
# The key MUST include the origin URL: "client-origin-auth-https://myapp.com"
# NOT a hash/signature as the key suffix
```

**Fix**:
1. Set `CustomAdminUIDomain` to the app origin (e.g., `https://myapp.com`)
2. Sign the IDP settings: `POST /admin/realms/{realm}/vendorResources/sign-idp-settings`
3. Ensure adapter config `client-origin-auth` key includes the origin URL, not just the signature value

**Verification**: Enclave popup appears and stays open for user interaction.

VERIFIED (Ratidefy SaaS — IDP settings unsigned, client-origin-auth key had signature instead of origin URL).

---

## T-22: IGA Role Assignment Stuck in DRAFT (Unsignable Change Request)

**Symptom**: Role assigned to user via admin API, change request created, but sign/commit returns 200 without actually signing. Role remains in DRAFT state permanently.

**Possible Causes**:
1. Role assigned before the user linked their Tide account — IGA requires a Tide doken for change request signing
2. The master admin token can create change requests but cannot sign them without a Tide identity

**Diagnostics**:
1. Check TideCloak admin → realm → Users → target user → Role Mapping tab
2. If role shows "DRAFT" badge, the change request was never signed
3. Check if user has a federated identity (Identity Provider Links tab)

**Fix**: 
1. Delete the DRAFT change request
2. Ensure the user links their Tide account first (via invite link)
3. Then assign the role — the change request can now be signed

**Prevention**: In automated provisioning, split into two phases:
- Phase A: Create realm, user, generate invite link (no role assignment)
- Phase B: After user links Tide account, assign role and approve change request

**Verification**: Role shows "ACTIVE" status in TideCloak admin after sign+commit.

VERIFIED (Ratidefy SaaS — provisioner assigned tide-realm-admin before account linking, creating permanent DRAFT).

---

## T-23: ASP.NET Core JWT Validation Fails on Tidecloak EdDSA Tokens

**Symptoms:**
- `IDX10503: Signature validation failed`
- `IDX10500: Signature validation failed. No security keys were provided`
- 401 on every request despite a valid `Authorization: Bearer <token>`

**Cause:** `Microsoft.IdentityModel.Tokens` does not ship EdDSA. The `Tide.Asgard.AspNetCore.Authentication` SDK ships an EdDSA `SignatureProvider` in `Tide.Asgard.Core`, but you have to wire it in by setting `IssuerSigningKey = Utils.GetEd25519IssuerKey(builder.Configuration)`.

The asgard `Example/Program.cs` has that exact line **commented out** at line 17. Copying the Example verbatim leaves you with no EdDSA support; the README form at lines 117-139 is the correct wiring.

**Fix:**
```csharp
builder.Services.AddKeycloakWebApiAuthentication(builder.Configuration, options =>
{
    options.RequireHttpsMetadata = false;
    options.TokenValidationParameters.IssuerSigningKey =
        Utils.GetEd25519IssuerKey(builder.Configuration);
});
```

**Verification:** Tokens with `alg=EdDSA` validate. Logs at Debug for `Keycloak.AuthServices` show the validation chain completing.

VERIFIED (asgard `README.md:117-139` vs `Example/Program.cs:17`).

See [playbooks/protect-aspnet-core-asgard.md](../playbooks/protect-aspnet-core-asgard.md).

---

## T-24: ASP.NET Core Token Exchange Throws NotImplementedException

**Symptoms:**
- `ITokenExchangeService.ExchangeToken(...)` throws `NotImplementedException` from the asgard SDK.
- Worked before; broke after enabling DPoP on the browser SPA.

**Cause:** `TokenExchangeService.ExchangeToken` inspects the inbound `Authorization` header. Bearer tokens are routed to a fully-implemented path. DPoP-tagged requests are routed to `ExchangeDPoPToken`, which is a stub (`throw new NotImplementedException()` at the top of the method). The same applies to the "Doken" auth scheme (`ExchangeTideDoken` stub). The internal `ValidateExchangeProof` helper is also a stub.

The most common trigger is uncommenting `useDPoP: { mode: "strict", alg: "EdDSA" }` in the SPA's `kc.init({...})` call. The moment the SPA starts sending `Authorization: DPoP <token>` + `DPoP: <proof>` headers, every controller that calls `ExchangeToken` 500s.

**Fix:** Disable browser DPoP until the SDK ships a DPoP-aware exchange path. The DPoP proof-validation service (`DPoPProofValidationService`) is fully implemented for **inbound** DPoP, but its registration helper `.WithDPoP(...)` is commented out — so DPoP today requires manual service wiring on inbound requests AND no DPoP on token exchange.

**Verification:** With `useDPoP` disabled, exchange succeeds. With DPoP on, the 500 is reproducible.

VERIFIED (asgard `TokenExchangeService.cs:28-35` routes to stub at line 93).

---

## T-25: ASP.NET Core 401 with Audience Mismatch

**Symptoms:**
- 401 on every browser-issued request despite a valid token.
- Token decodes correctly but `aud` claim does not include the backend client ID.

**Cause:** The browser's public client (`browser-login-page`) issues tokens with itself as the audience. The .NET backend's confidential client (`backend`) rejects tokens that do not list `backend` in `aud`.

**Fix:** Add an audience mapper to the browser client's dedicated client scope.

- Realm -> Clients -> `browser-login-page` -> Client scopes -> `browser-login-page-dedicated` -> Add mapper -> By configuration -> Audience.
- Name: `backend-mapper`. Included Client Audience: `backend`. Save.

**Verification:** Decode an SPA-issued token (e.g. at jwt.io); confirm `aud` array contains `backend`.

VERIFIED (asgard `README.md:55-62`).

---

## T-26: Login Fails at the Token Exchange — DPoP Not Fully Wired

**Symptoms** (any of these, all from the same root cause):
- `POST /realms/{realm}/protocol/openid-connect/token` returns **400** `{"error":"invalid_request","error_description":"DPoP proof is missing"}`.
- The same call returns an unexplained **500** after an SDK upgrade.
- The browser console reports a **CORS** failure on the token endpoint. This is usually a *symptom, not the cause*: error responses omit CORS headers, so any rejected request surfaces as a CORS error. Read the **Network tab's Response body**, not the console message.
- Login redirects back to `/auth/redirect` repeatedly (200 each time) but no authenticated API call ever fires.

**Cause:** `templates/shared/realm.json.template` sets `"dpop.bound.access.tokens": "true"`, so **DPoP is enabled server-side by default**. The realm demands a proof. If the client half is missing or partial, the exchange fails. DPoP is lockstep (I-12) — it is not optional for template-bootstrapped realms.

**Diagnosis — check all four pieces:**

```bash
grep -q "useDPoP" app/providers.tsx  && echo "1 provider OK"   || echo "1 MISSING useDPoP"
test -f public/tide_dpop_auth.html   && echo "2 page OK"       || echo "2 MISSING tide_dpop_auth.html"
grep -q "tide_dpop" next.config.*    && echo "3 rewrite OK"    || echo "3 MISSING /tide_dpop rewrite"
curl -s -D - -o /dev/null "http://localhost:3000/tide_dpop/iss/a/aud/b/tide_dpop_auth.html" \
  | grep -i "content-security-policy"
#   want: default-src 'self'; script-src 'unsafe-inline'
#   if you see the generic app CSP instead, the rule ORDER is wrong (see fix 4)
```

Confirm the server side really does want DPoP:

```bash
curl -s "$TIDECLOAK_URL/admin/realms/$REALM/clients?clientId=$CLIENT" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[0].attributes["dpop.bound.access.tokens"]'   # → "true"
```

**Fix:**
1. Add `useDPoP: { mode: 'strict', alg: 'ES256' }` **inside** the `config` object (not as a JSX prop).
2. Install the **known-good** `tide_dpop_auth.html` into `public/`:
   ```bash
   # From the MCP (cannot hand you the stale copy):  tide_dpop_asset
   # Or from any pack template:
   cp <pack>/templates/nextjs-customer-portal/public/tide_dpop_auth.html public/

   sha256sum public/tide_dpop_auth.html
   # expect 9d7844b938f0a2565fa910d3d30e9b8797cbfd6e0b73d59d804169a089aea757  (9120 bytes)
   grep -q "window.opener" public/tide_dpop_auth.html && echo "correct copy"
   ```
   The enclave integrity-checks this file, so do not restyle it — but the correct copy **does**
   contain `window.opener`. See the reversal note below.
3. Add the `/tide_dpop/:path*` → `/tide_dpop_auth.html` rewrite.
4. Add the DPoP CSP **after** any generic CSP rule — the last matching rule wins for a header key, so a generic `/:path*` rule placed later silently overrides it.
5. Switch API calls to `secureFetch` (absolute URLs only). A plain `fetch` with a Bearer header carries no proof and will be rejected.

### ⚠️ REVERSED 2026-08-17 — this entry previously had it exactly backwards

It said the canonical file was the **7183-byte** copy that posts only to `window.parent`, that a copy
containing `window.opener` was "drift", and it told you to assert `grep -c "window.opener" # want 0`.

**That is inverted.** The 2026-08-06 note concluded that the pack templates "had silently drifted to a
modified 9121-byte variant while the exemplar held the canonical 7183-byte file" — and on that basis
the templates were reverted **to the broken file**. The 9120-byte copy with
`targetWindow = window.opener || window.parent` is the **correct, current** one.

**Why the stale copy fails**: the relay runs in an **iframe** first and needs unpartitioned IndexedDB
via `document.requestStorageAccess({ indexedDB: true })`. When that fails, the SDK falls back to a
**popup** opened with `window.open()`. In a popup `window.parent === window`, so a
`window.parent.postMessage` page **messages itself** — the opener never receives `pageLoaded`, and you
get `TIDE-SWE-UNHANDLED` or `Popup DPoP verification failed to load`.

Confirmed by an independent user report (2026-08-17) who hit `TIDE-SWE-UNHANDLED` in Chrome, traced it
to `window.parent` in a popup, and fixed it with `window.opener || window.parent` — arriving
independently at the pack's known-good file.

**If all four pieces are correct and it still fails**, check the copy:

```bash
sha256sum public/tide_dpop_auth.html
# 9d7844b938f0a2565fa910d3d30e9b8797cbfd6e0b73d59d804169a089aea757  = known-good (9120 bytes)
# e725df1231f0050117de1a95948c3da3aca2757282ffdf65821940e668d95756  = STALE (7183) -> this bug
grep -q "window.opener" public/tide_dpop_auth.html || echo "STALE COPY — replace it"

<pack>/scripts/check-dpop-asset.sh .        # checks every copy under a tree
```

⚠️ **Do not source this file from `sources/example-app-keylessh/public/`** — the keylessh repo contains
**both** copies and the one at its repo root is the stale one. Its `client/public/` copy is the good
one. Take it from the MCP (`tide_dpop_asset`) or a pack template instead.

The file is not shipped in the `@tidecloak/*` packages, so if you have the known-good copy and it
still fails after an SDK bump, ask the Tide team for the build matching your SDK version.

**Do not "fix" this by removing `useDPoP` alone.** The server still demands proofs and login stays broken. Disabling DPoP requires flipping the client attribute to `false` as well, which on an IGA realm is a change request — and after the realm goes multiAdmin, a human enclave approval.

See `playbooks/add-auth-nextjs-fresh.md` (Step 4) for the full configuration, and I-12.
