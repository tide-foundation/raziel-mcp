# Tide Core Concepts

Agent-operable definitions of Tide's cryptographic model and architecture.

**Rule**: Official Tide documentation uses marketing-heavy terminology. This file uses agent-facing names with official terms in parentheses.

---

## Never-Whole-Key Model (Ineffable Cryptography)

**What it is**: Cryptographic keys never exist in complete form at any point in their lifecycle. Keys are born fragmented, used blind, and destroyed atomically. **VERIFIED** (whitepaper tier1-article2, Architecture.md)

**Why it matters**: No single point of compromise can extract a complete key. No admin, server, ORK node, or attacker can forge tokens or decrypt data alone.

**How it works**:
- Keys generated via Distributed Key Generation (DKG) across ORK nodes using Nested Shamir Secret Sharing
- Each ORK holds one shard; threshold T ORKs must cooperate for any operation
- Shards never leave their ORK; operations use threshold signatures and blind protocols
- Only exception: Ragnarok (Fabric offboarding) deliberately reconstructs keys locally

**Agent implication**: Do not implement local key generation, storage, or backup. All cryptographic operations delegate to Fabric via TideCloak.

---

## Fabric (Cybersecurity Fabric)

**What it is**: Decentralized network of ORK nodes that collectively perform cryptographic operations. **VERIFIED** (intro.md, Architecture.md)

**Official name**: "Cybersecurity Fabric" is marketing. Use "Fabric" or "ORK network" in code and docs.

**Deployment configurations**:
- Mainnet: 20 ORKs, T=14 threshold **VERIFIED** (whitepaper tier1-article2)
- Test: 5 ORKs, T=3 threshold **VERIFIED** (keylessh `start.sh`)
- Threshold is configurable via `TIDE_VENDOR_THRESHOLD_SIGNING` / `TIDE_VENDOR_THRESHOLD_TOTAL` env vars **VERIFIED** (keylessh `start.sh`)

**Security assumption**: System remains secure if fewer than 30% of ORKs are compromised (honest minority model). On mainnet: safe if <7 of 20 ORKs compromised. **VERIFIED** (Threat-model.md)

**Agent implication**: Never hardcode 14/20. Treat threshold as deployment-variable.

---

## ORK (Orchestrated Recluders of Keys)

**What it is**: Individual nodes in the Fabric. Each holds one shard of distributed keys. **VERIFIED** (tier1-article2)

**Official name**: "Orchestrated Recluders of Keys" is a backronym. Use "ORK" or "ORK node".

**Responsibilities**:
- Store one key shard per distributed key
- Perform threshold cryptographic operations (signing, decryption, PRISM verification)
- Independently verify claims before partial-signing
- Execute Forseti policy contracts
- Coordinate via TWELVE MAP directory service

**Agent implication**: ORK endpoints are discovered via adapter JSON (`homeOrkUrl`) or TWELVE MAP, not hardcoded.

---

## Threshold Password Authentication (BYOiD)

**What it is**: Authentication model where user password is verified via threshold protocol without any party learning the password. No password hashes stored anywhere. **VERIFIED** (byoid.md, tier2-protocol-prism.mdx)

**Official name**: "Bring Your Own Identity (BYOiD)" sounds like federated login. It is not. It is threshold password authentication using PRISM (Threshold Oblivious Pseudorandom Function).

**How it works**:
1. User enters password in browser
2. SWE coordinates PRISM protocol across T+ ORKs
3. Each ORK applies its CMK shard to the password challenge
4. Browser assembles partial results into authentication proof
5. No ORK, server, or attacker learns the password

**Agent implication**: Standard login flows (`doLogin()`, `useTideCloak()`) work transparently. Do not implement custom password verification. PRISM is SDK-internal.

**Common confusion**: BYOiD is NOT OAuth2/OIDC federated login. It uses OIDC protocol framing but authentication is threshold-verified, not server-checked.

---

## Threshold JWT Signing (VVK)

**What it is**: JWT tokens are signed by threshold protocol across ORKs, not by TideCloak server. Each VVK ORK independently verifies all claims before partial-signing. **VERIFIED** (tier2-protocol-vvk-jwt-signing.mdx)

**How it works**:
1. TideCloak requests JWT signing from Fabric
2. Each VVK ORK performs 12-gate verification chain independently **INFERRED** (whitepaper describes gates; specific gate list not in SDK docs - GAP-025)
3. If all gates pass, ORK produces partial signature
4. T+ partial signatures combine into final JWT
5. If any ORK rejects a claim, signing fails

**Agent implication**:
- JWT verification uses embedded JWKS from adapter JSON only. Do not use `createRemoteJWKSet`. **VERIFIED** (keylessh `tideJWT.ts`)
- Adapter JSON field `jwk: { keys: JWK[] }` contains public keys for local verification **VERIFIED** (keylessh `tidecloakConfig.ts`)
- Server-side verification pattern: extract JWT → verify signature against adapter JWKS → check `iss`, `azp`, `exp`, `iat` → validate roles **VERIFIED** (keylessh `tideJWT.ts`)

**Common confusion**: This is NOT standard Keycloak JWT signing. TideCloak delegates signing to Fabric. Do not fetch JWKS from the remote `{realm}/protocol/openid-connect/certs` endpoint. Use only the embedded `jwk` from `tidecloak.json`. See I-04.

---

## IGA (Identity Governance & Administration)

**What it is**: Quorum-enforced governance layer. Admin changes to roles, users, clients require multi-admin approval sealed by VVK threshold signatures. **VERIFIED** (IGA.mdx, SetupIGA.md, keylessh `init-tidecloak.sh`)

**Official docs weakness**: Reads as "approval workflow" without emphasis on threshold cryptography. IGA approval is cryptographic enforcement, not procedural.

**How it works**:
1. Admin proposes change (create user, modify role, etc.) → draft created automatically for 18 specific admin API actions **VERIFIED** (vendor confirmation, GAP-041 resolved). Not every mutating endpoint creates a draft — many operations (updating user attributes, updating realm settings, creating groups, managing identity providers) execute immediately. Master realm and IGA-disabled realms are always exempt.
2. The change request enters the approval queue keyed by `id`, with `entityType`, `actionType`
3. Required quorum of admins approve: `max(1, floor(TotalAdmins * 0.7))` **VERIFIED** (SetupIGA.md)
4. Approved change is sealed by VVK threshold signatures (Authorization Proofing) — in Tide mode; Tideless mode records a username attestation (no crypto)
5. Change is committed to realm
6. VVK ORKs verify future JWT claims against these proofs

**Change-request lifecycle** **VERIFIED** (qea-iga-api.md):
```
PENDING → APPROVED (committed) → (ACTIVE)
        → DENIED
        → CANCELLED
```

**Change-request API endpoints** — current `/iga/change-requests/...` surface (replaces legacy `/tide-admin/change-set/...`, GAP-065). **Full spec: `canon/iga-change-requests-api.md`.**
```
GET  /admin/realms/{realm}/iga/change-requests?status=PENDING          → list (objects keyed by id)
GET  /admin/realms/{realm}/iga/change-requests/{id}                    → one change request
POST /admin/realms/{realm}/iga/change-requests/{id}/authorize          → approve (sign), body {} optional
POST /admin/realms/{realm}/iga/change-requests/bulk-authorize          → batch approve
POST /admin/realms/{realm}/iga/change-requests/{id}/commit             → commit (412 if under threshold)
POST /admin/realms/{realm}/iga/change-requests/{id}/deny               → reject
GET/POST /admin/realms/{realm}/iga/change-requests/{id}/approval-model → Tide-mode enclave two-phase sign
```

**Signing modes** **VERIFIED** (CHANGE_REQUEST_API.md):
- **FirstAdmin**: Signs immediately with VRK. `requiresApprovalPopup: false`. Used during initial setup before multi-admin is configured.
- **MultiAdmin**: Returns enclave challenge. `requiresApprovalPopup: true`. Client must decode `changeSetDraftRequests` (base64), present to enclave for admin to sign, then submit via `add-review`.

**Policy resolution**: When signing, the system uses the `tide-realm-admin` role's policy by default. Pass `policyRoleId` in the sign request to use a role-specific policy instead. **VERIFIED** (CHANGE_REQUEST_API.md)

**Note**: The SSH policy `threshold` (per-role approval count for Forseti policy signing) is distinct from the IGA admin quorum (`max(1, floor(N*0.7))`). These are independent systems.

**Agent implication**:
- Enable IGA via `POST /admin/realms/{realm}/tide-admin/toggle-iga` **VERIFIED** (all exemplar init scripts)
- Canonical setup ordering: license (`setUpTideRealm`) → IGA (`toggle-iga`) → E2EE. This is the only valid sequence. **VERIFIED** (vendor confirmation, batch-02 Q-04, A-21/A-22 resolved). License required for all Tide features (BYOiD login, signing, IGA, vouchers). IGA required for E2EE because `jwk` only injected when IGA enabled. BYOiD-only (license + no IGA) is a valid deployment mode but has no E2EE. DPoP is standard Keycloak, not gated by Tide licensing.
- After IGA commit, new roles are NOT immediately visible in the doken. Token refresh is required, and propagation may take up to 120s **VERIFIED** (test-cases F3, F6)
- Change requests have a hardcoded 1-month (2628000 seconds) cryptographic expiry enforced by the Tide enclave. After this window, signing requests are rejected. No automatic database cleanup — stale drafts persist until manually cancelled. Expiry not configurable. **VERIFIED** (vendor confirmation, batch-02 Q-08, A-25 resolved)
- **ACTIVE vs DRAFT distinction** **VERIFIED** (vendor confirmation, GAP-041 resolved): Role creation (`POST .../roles`) and default-role assignment get `ACTIVE` status (recorded for audit but non-blocking, no sign/commit needed). All other draft-triggering actions get `DRAFT` status requiring quorum sign/commit. This matters for automation: agents creating roles do not need sign/commit, but agents assigning those roles to users do.

**Common confusion**: IGA is NOT generic approval workflow. Approval is sealed by threshold signatures. No single admin can bypass.

---

## Threshold E2EE (Hermetic E2EE)

**What it is**: End-to-end encryption where decryption requires threshold participation from Fabric ORKs. Plaintext exists only on user's device. **VERIFIED** (hermetic-e2ee.md, tier2-protocol-hermetic-e2ee.mdx)

**Official name**: "Hermetic E2EE" is marketing. Use "threshold E2EE".

**How it works** **VERIFIED** (vendor confirmation, GAP-009 resolved):
1. User calls `doEncrypt([{ data: plaintext, tags: [tag] }])` in browser
2. A fresh random encryption key is generated per call (<32B: fresh ElGamal scalar; >=32B: fresh 32-byte AES key via `crypto.getRandomValues()`). No key reuse across calls.
3. Data encrypted locally; the per-call key is ElGamal-encrypted via threshold across ORKs
4. Ciphertext (TideMemory envelope) stored in application
5. User calls `doDecrypt([{ encrypted: ciphertext, tags: [tag] }])` → Fabric threshold-decrypts the per-call key → plaintext recovered locally
6. Separately, a session key (`t.ssk`) in the doken authenticates the user to ORKs but does NOT encrypt data. Lives in ORK enclave iframe; destroyed on tab close/logout. Adapters have no encryption key state to manage.

**Tag-based role enforcement** **VERIFIED** (e2ee.md):
- Roles: `_tide_<tag>.selfencrypt` and `_tide_<tag>.selfdecrypt`
- Enforcement is cryptographic: Fabric won't decrypt without role proof in JWT
- Tag names are fully application-defined, no reserved prefixes or values. Case-sensitive, passed to ORK as-is (UTF-8, no normalization), max ~237 chars for self-encryption. **VERIFIED** (vendor confirmation, batch-02 Q-10, A-26 resolved)

**Agent implication**:
- Use SDK methods `doEncrypt()`/`doDecrypt()` **VERIFIED** (SDK references)
- Both `Uint8Array` (binary) and string inputs supported **VERIFIED** (vendor confirmation, GAP-013 resolved). Strings are converted via `TextEncoder`. Base64 encoding is used for JSON transport (~33% overhead).
- No application-level maximum payload size **VERIFIED** (vendor confirmation, GAP-013 resolved). Payloads under 32 bytes are encrypted directly with ElGamal; payloads of 32 bytes or more use a hybrid scheme (AES-256-GCM for the data, ElGamal for the symmetric key). Practical transmission ceiling is the ASP.NET Core Kestrel default request body limit (~28.6 MB), reconfigurable per deployment.
- Self-encryption and policy-based encryption share the same size characteristics.
- Ciphertext is a TideMemory-serialized envelope (SerializedField v1). Returns base64 string when input was string, raw `Uint8Array` when input was `Uint8Array`. Overhead ~157B (small data) / ~217B (large data) before base64. Format versioned (v1), stable within major SDK version. **VERIFIED** (vendor confirmation, batch-02 Q-05, A-28 resolved)
- E2EE requires online Fabric access; no offline decryption **VERIFIED** (hermetic-e2ee.md)
- Both `selfencrypt` AND `selfdecrypt` roles needed to round-trip **INFERRED** (roles are separate; no source states granting one implies the other - A-27)

**Common confusion**: This is NOT client-side encryption with server-stored keys. Decryption requires live Fabric threshold participation.

---

## SWE (Secure Web Enclave)

**What it is**: Browser-delivered JavaScript module that coordinates cryptographic operations. Untrusted dealer: coordinates but cannot extract keys or forge proofs. Verified by SRI hash. **VERIFIED** (SWE.md, tier1-article7)

**Official name**: "Secure Web Enclave" oversells trust level. SWE is explicitly an untrusted dealer. Use "SWE (untrusted dealer)" in docs to prevent confusion.

**How it works**:
1. Browser loads SWE iframe from Tide domain
2. SWE code is SRI-verified: `integrity="sha384-..."` hash must match
3. SWE coordinates with ORKs but never learns complete keys or plaintext
4. ORKs verify SWE's instructions independently; untrusted SWE cannot bypass threshold enforcement

**CSP requirements** **VERIFIED** (vendor confirmation, GAP-028 resolved):
```
frame-src 'self' *
```
`frame-src '*'` required for ORK re-homing. Without correct CSP, SWE iframe silently fails.

**Agent implication**:
- Include `silent-check-sso.html` in `public/` for silent token refresh **VERIFIED** (docs + keylessh)
- Do not modify or vendor SWE code; SRI hash verification will fail
- SWE failure symptoms: login hangs, E2EE operations timeout, no visible errors (check browser console for CSP violations)

---

## Forseti Policy Engine

**What it is**: Programmable policy engine. C# contracts run in sandboxed VmHost on every ORK. Policy decisions are majority-enforced. **VERIFIED** (Forseti.mdx, tier2-protocol-forseti.mdx, keylessh `sshPolicy.ts`)

**How it works**:
1. Application creates Forseti contract (C# code) defining policy rules
2. Contract is submitted to ORKs via `createTideRequest()`
3. Each ORK compiles and executes contract in sandbox
4. Majority of ORKs must approve for operation to proceed
5. No single ORK bypass; compromised ORK cannot override policy

**Contract structure** **VERIFIED** (keylessh `sshPolicy.ts`):
```typescript
{
  contract: "using System; ...",  // C# code
  modelName: "BasicCustom<APP>:BasicCustom<1>",  // model ID
  authFlow: "Policy:1",  // protocol version
  authorizer: tc.doken,  // VVK-signed session token
  challengeData: { ... }  // application-specific data
}
```

**Model IDs** **VERIFIED** (keylessh `sshPolicy.ts`):
- `BasicCustom<X>:BasicCustom<1>` - implicit auth, no popup
- `DynamicCustom<X>:DynamicCustom<1>` - dynamic challenge data
- `DynamicApprovedCustom<X>:DynamicApprovedCustom<1>` - requires operator approval popup

**REQUIRES_RUNTIME_VALIDATION**: Single-app evidence. `<X>` is app-specific (keylessh uses `<SSH>`). Prefix pattern may be Forseti convention.

**Built-in default contracts** **VERIFIED** (vendor confirmation, GAP-046 resolved):

Four pre-registered contracts in the ORK factory — no need to upload via the contract deployment API:

| Contract | Purpose | Validates | Parameters |
|----------|---------|-----------|------------|
| `GenericResourceAccessThresholdRoleContract` (`GenericResourceAccessThresholdRole:1`) | Role-gated multi-approval on **client roles** | Approvers only | `role` (string), `resource` (string), `threshold` (number) |
| `GenericRealmAccessThresholdRoleContract` | Same but checks **realm roles** | Approvers only | `role`, `resource`, `threshold` |
| `SimpleTagBasedDecryptionContract` | Tag-based decryption. Checks `_tide_{tag}.encrypt`/`.decrypt` roles. One built-in option, not the standard Forseti flow. | Data + Executor | tag from data context |
| `HederaTX` | Hedera transaction contract | Unknown | Unknown |

Use default contracts for simple role-gated multi-approval. Write custom contracts for executor validation, data validation, or complex logic. `GenericResourceAccessThresholdRoleContract` only validates **approvers** (not executor); its `ValidateData` is a no-op and `ValidateExecutor` is not implemented.

**C# contract API surface** **VERIFIED** (forseti-crypto-quickstart, tidewarden, test-cases):

Every contract implements `IAccessPolicy` from `Ork.Forseti.Sdk` and defines up to three validation methods:

| Method | When it runs | Context object | Key properties |
|--------|-------------|---------------|----------------|
| `ValidateData(DataContext ctx)` | Always | `ctx.RequestId` (e.g. `"PolicyEnabledEncryption:1"`), `ctx.Data` (positional byte buffer), `ctx.DynamicData`, `ctx.Policy.ExecutionType`, `ctx.Policy.ApprovalType` | |
| `ValidateApprovers(ApproversContext ctx)` | When `ApprovalType.EXPLICIT` | `ctx.Dokens` (array of doken bytes) | `DokenDto.WrapAll(ctx.Dokens)` wraps all approvers |
| `ValidateExecutor(ExecutorContext ctx)` | When `ExecutionType.PRIVATE` | `ctx.Doken` (single doken bytes), `ctx.DynamicData` | `new DokenDto(ctx.Doken)` wraps executor |

**Data access in contracts**: `ctx.Data` is a positional byte buffer, NOT key-value. Read fields with `data.GetValue(index)` or `data.TryGetValue(index, out var field)`. Tags are extracted by iterating indices.

**TideMemory wire format**: Fields are packed sequentially — each field is a 4-byte little-endian length prefix followed by that many data bytes. `ctx.DynamicData` uses the same format; read with `TryReadField(buffer, index, out result)`.

**Executor validation pattern**:
```csharp
var executor = new DokenDto(ctx.Doken);
return Decision
    .RequireNotExpired(executor)
    .RequireRole(executor, roleName);           // 2-arg: realm role
    // or: .RequireRole(executor, resource, role);  // 3-arg: client role
```

**Approver validation pattern**:
```csharp
var approvers = DokenDto.WrapAll(ctx.Dokens);
return Decision
    .Require(approvers.Count > 0, "No approvers")
    .RequireAnyWithRole(approvers, resource, role);
```

**Direction detection**: `ctx.RequestId == "PolicyEnabledEncryption:1"` for encrypt, `"PolicyEnabledDecryption:1"` for decrypt. Contract must check this to apply direction-specific logic.

**Error surface**: `PolicyDecision.Deny("message")` — deny messages are string-based and propagated to the client. **VERIFIED** (test-cases F11 negative tests)

**Forseti sandbox security model** **VERIFIED** (vendor confirmation, GAP-008 resolved): Five-layer model. Contracts compiled with Roslyn against .NET 8.0 references plus three SDK assemblies (`Ork.Forseti.Sdk`, `Cryptide`, `Ork.Shared`). After compilation, IL vetting enforces a block-list of forbidden namespace prefixes: `System.IO`, `System.Net`, `System.Diagnostics`, `System.Threading`, `System.Reflection`, `System.Runtime.InteropServices`, `System.Reflection.Emit`, `Microsoft.Win32`. `System.Console` and `System.Runtime.CompilerServices.Unsafe` are always hard-blocked. Non-deterministic calls (`DateTime.Now`, `Guid.NewGuid`, `Random`, etc.) blocked by default. Static constructors banned. A contract referencing a blocked namespace compiles but fails IL vetting with `BadPolicy.ForbiddenCall` at upload time. Each policy runs in an isolated `AssemblyLoadContext` inside a separate VmHost process with OS-level CPU/memory limits and gas metering (default 50,000 gas). `Claim(key)` = 5 gas, `Log(message)` = 25-30 gas. Throws `OutOfGasException` when exhausted.

**Doken delivery**: Doken is an extra field (`"doken"`) in the OIDC token endpoint response body. Standard OIDC libraries discard unknown fields. To capture it, intercept the raw HTTP response before the OIDC library deserializes it. Doken is delivered at both initial login and token refresh. **VERIFIED** (tidewarden `DokenCapturingClient`)

**Agent implication**:
- Gas metering: default 50,000 gas. `Claim(key)` = 5 gas, `Log(message)` = 25-30 gas. Throws `OutOfGasException` when exhausted. **VERIFIED** (vendor confirmation, GAP-008 resolved)
- Sandbox: five-layer model fully documented. Namespace block-list enforced via IL vetting. **VERIFIED** (vendor confirmation, GAP-008 resolved)
- Contract errors propagated to client as string messages: `PolicyDecision.Deny("message")`, `BadPolicy.ForbiddenCall:{target}`, `BadPolicy.EntryTypeNotFound`, `BadPolicy.BudgetExceeded`, `VmHost.Timeout`, `OutOfGasException`. ORK error codes are not systematically surfaced — they arrive as opaque strings. **VERIFIED** (vendor confirmation, GAP-004 resolved). Internal ORK compilation error taxonomy still opaque (GAP-018).
- Doken accessed via `tc.doken` property **VERIFIED** (keylessh `tideSsh.ts`)
- Doken is VVK-signed (EdDSA), session-bound. **VERIFIED** (vendor confirmation, GAP-017 resolved)
- Doken `exp` copied directly from SSO access token `exp` at issuance — they share the same expiration. Auto-reissued when access token is refreshed; SDK handles transparently including mid-operation refresh via `dokenRefreshCallback`. No independent doken TTL configuration.
- Doken revocation: operates at the signature level via per-user blocklist (`RevokedAuthorizerService`). No explicit "revoke this doken" API.
- Role claims (`realm_access`, `resource_access`) are snapshot into the doken at issuance and only update on the next token refresh — this explains the up to 120s delay between IGA role changes and doken reflection.
- A fully-expired doken cannot be refreshed — the user must reauthenticate. Refresh must happen before expiry, not after.

**Common confusion**: Forseti is NOT authorization middleware config. Real C# contracts execute in every ORK. No single bypass point.

---

## DPoP (Demonstration of Proof-of-Possession)

**What it is**: RFC 9449 standard. Binds access tokens to a client key pair. Server verifies proof on every request. **VERIFIED** (RFC 9449, keylessh `auth.ts`, `AuthContext.tsx`)

**TideCloak DPoP supports two signing algorithms** **VERIFIED** (vendor confirmation, GAP-049 resolved):
- **ES256** (ECDSA P-256) — **default**. Recommended for new projects due to universal browser WebCrypto support.
- **EdDSA** (Ed25519) — supported, with automatic fallback logic for browsers that lack Ed25519.

The algorithm is negotiated at runtime via the server's `dpop_signing_alg_values_supported` OIDC metadata field. Apps may override the default with `useDPoP.alg`. ES384/ES512 are declared in types but not implemented (would throw at runtime).

```typescript
// Recommended for new projects (ES256 is the default)
useDPoP: { mode: 'strict', alg: 'ES256' }
// EdDSA also supported
useDPoP: { mode: 'strict', alg: 'EdDSA' }
```

**DPoP enablement**: DPoP is configured per-client in TideCloak via the client attribute `"dpop.bound.access.tokens": "true"`. This is NOT a realm-wide setting. **VERIFIED** (test-cases realm.json)

**DPoP client SDK**: DPoP is enabled and enforced by default across the TideCloak SDKs. Configure it via the `useDPoP` option (there is no `enableDpop` flag — that option does not exist in the current SDK). Use the `TideCloak` class (not `IAMService`) for the DPoP-signing client:
```typescript
const tc = new TideCloak({ url, realm, clientId, vendorId, homeOrkUrl, ... });
// useDPoP defaults to { mode: 'strict' }; pass it explicitly to set alg or relax the mode:
//   useDPoP: false                       → disable DPoP entirely
//   useDPoP: { mode: 'auto' }            → use DPoP only when the realm advertises it
//   useDPoP: { mode: 'strict', alg: 'ES256' } → require DPoP (default), pin the algorithm
await tc.init({ onLoad: "check-sso", pkceMethod: "S256", useDPoP: { mode: "strict", alg: "ES256" } });
// tc.secureFetch() auto-attaches DPoP headers
```
**VERIFIED** (tidecloak-js `IAMService.js` on `main` — `useDPoP` default `{ mode: 'strict' }`)

**Server-side verification pattern** **VERIFIED** (keylessh `server/auth.ts`, test-cases `dpop-protected/route.ts`):
1. Extract `Authorization: DPoP <token>` (NOT `Bearer`)
2. Extract `DPoP` header (the proof JWT)
3. Verify JWT structure: `typ: "dpop+jwt"`, `alg` matches expected (EdDSA or ES256)
4. Verify signature against `jwk` in DPoP proof
5. Check `htm` (HTTP method) matches request method
6. Check `htu` (HTTP URI) matches request URL (no query string)
7. Check `iat` timestamp (120s freshness window)
8. Check `jti` not replayed (2-min TTL in-memory cache)
9. Extract access token, verify `cnf.jkt` matches DPoP proof thumbprint

Alternative: use `oauth2-dpop` npm package + `jose` for simpler verification. **VERIFIED** (test-cases `dpop-protected/route.ts`)

**Agent implication**:
- DPoP required for Tide's full security guarantees **VERIFIED** (vendor confirmation, GAP-032 resolved). Disabling degrades security.
- ES256 is the default algorithm. EdDSA supported with automatic fallback. ES384/ES512 not implemented.
- SDK provides DPoP client-side via `TideCloak.secureFetch()`; server must verify proof
- Replay protection requires in-memory `jti` cache with TTL

**Common confusion**: DPoP is NOT bearer token. Authorization header uses `DPoP` scheme, not `Bearer`. Each request requires fresh proof. Do not cache DPoP headers.

---

## Adapter JSON

**What it is**: Configuration file exported from TideCloak Admin Console. Extends Keycloak adapter format with Tide-specific fields. **VERIFIED** (keylessh `tidecloakConfig.ts`)

**Tide extensions**:
- `jwk: { keys: JWK[] }` - Embedded JWKS for local JWT verification (only present when IGA is enabled) **VERIFIED**
- `vendorId: string` - Tide vendor identifier **VERIFIED**
- `homeOrkUrl: string` - Home ORK endpoint **VERIFIED**
- `client-origin-auth-{origin}: string` - ORK-network-produced signature attesting a web origin is authorized for this client. Required for SDK enclave initialization. One entry per allowed web origin per client. No browser-specific variants. **VERIFIED** (vendor confirmation, GAP-048 resolved)

**Storage locations** **VERIFIED** (keylessh `tidecloakConfig.ts`, bridge configs):
- File: `data/tidecloak.json` (default)
- Env var: `CLIENT_ADAPTER` (JSON string)
- Env var: `TIDECLOAK_CONFIG_B64` (base64-encoded JSON)

**Agent implication**:
- `jwk` field is only present when IGA is enabled on the realm. Validate its presence at startup.
- Adapter JSON enables local JWT verification. Do not use `createRemoteJWKSet` or fetch JWKS remotely. If `jwk` is missing, re-export adapter with IGA enabled. (I-04)
- Export via vendor endpoint: `GET /admin/realms/{realm}/vendorResources/get-installations-provider?clientId={client-uuid}&providerId=keycloak-oidc-keycloak-json` **VERIFIED** (vendor confirmation, GAP-044 resolved). This is the **realm-level** endpoint; the client is passed as the `clientId={uuid}` query param, NOT as a `/clients/{id}/` path segment (the per-client path returns a minimal adapter missing `jwk`). There is a single provider ID: `keycloak-oidc-keycloak-json`. The string `tidecloak-oidc-keycloak-json` does not exist in the codebase and should not be used.
- The config loader must select the `client-origin-auth-{window.location.origin}` entry and pass it to the SDK as `clientOriginAuth`. If no matching entry exists, enclave initialization will fail. **VERIFIED** (vendor confirmation, GAP-048 resolved)

**Common confusion**: Adapter JSON is NOT standard Keycloak format. Do not use generic Keycloak adapter parsers.

---

## Key Types (Theory Backing)

Most key types are theory-only; not directly referenced in SDK code.

| Key Type | Purpose | SDK Visibility | Source |
|----------|---------|----------------|--------|
| **CMK** (Consumer Master Key) | User identity key for BYOiD auth | Transparent to SDK | tier2-protocol-account-creation-keygen.mdx |
| **VVK** (Vendor Verifiable Key) | Organization JWT signing key | `vendorId` in adapter JSON | tier2-protocol-vvk-jwt-signing.mdx |
| **CVK** (Consumer Vendor Key) | Per-user personal authority key for Forseti, E2EE | `executeSignRequest()`, `doEncrypt()`/`doDecrypt()` | tier2-protocol-cvk-session.mdx, keylessh `tideSsh.ts` |
| **VRK** (Vendor Random Key) | Monthly TideCloak-Fabric payment key | Theory-only | tier2-protocol-vendor-licensing.mdx |
| **DVK** (Device Vendor Key) | Hardware biometric key on authenticator app | Theory-only | tier2-protocol-authenticator-app.mdx |
| **BRK** (Browser Key) | localStorage cross-verification key | Theory-only | tier2-protocol-authenticator-app.mdx |
| **RGK** (Ragnarok Key) | Offboarding reconstruction key | Theory-only | tier2-protocol-ragnarok.mdx |

**Agent implication**: Focus on CMK, VVK, CVK. Others are protocol backing, not SDK-facing.

---

## Ragnarok (Fabric Offboarding)

**What it is**: Deliberate offboarding from Fabric. The sole deviation from the never-whole-key invariant. Reconstructs keys locally so TideCloak can operate independently. Irreversible. **VERIFIED** (ragnarok.md, tier2-protocol-ragnarok.mdx)

**Official name**: "Ragnarok" is whimsical for a destructive operation. Use "Fabric offboarding (Ragnarok)" in docs.

**How it works**:
1. Quorum of admins approve Ragnarok
2. Keys reconstructed locally via nested threshold (RGK)
3. TideCloak switches to local EdDSA signing (Heimdall handler)
4. Fabric integration disabled permanently

**Agent implication**:
- Ragnarok is irreversible once quorum-approved **ASSUMED** (ragnarok.md describes finalization but no rollback - A-24)
- Post-Ragnarok details undocumented **STILL_UNRESOLVED** (GAP-021)
- keylessh does not implement Ragnarok

---

## Required Roles and Configuration

**`_tide_enabled` role** **VERIFIED** (vendor confirmation, GAP-031 resolved):
- `setUpTideRealm` runs after realm import and does not auto-create `_tide_enabled`
- Declare `_tide_enabled` in the realm template so the role already exists when setup continues
- If omitted from the imported realm, it must be created and assigned manually afterward
- Must be in every user's default role set
- Without it, Tide cryptographic operations fail

**`tidebrowser` flow** **VERIFIED** (confirmed across 4 exemplar realm.json files):
- Tide-specific browser authentication flow
- Set as `browserFlow` in realm.json
- Replaces standard Keycloak browser flow

**Token lifetimes** **VERIFIED** (confirmed across all exemplar realm.json files):
- `accessTokenLifespan: 600` (10 min)
- `ssoSessionIdleTimeout: 1800` (30 min)
- `ssoSessionMaxLifespan: 36000` (10 hours)

---

## Undocumented Admin Endpoints

Discovered in keylessh; not in API documentation.

| Endpoint | Purpose | Evidence |
|----------|---------|----------|
| `POST /admin/realms/{realm}/vendorResources/setUpTideRealm` | Initialize Tide features (email + terms) | `init-tidecloak.sh` |
| `POST /admin/realms/{realm}/tide-admin/toggle-iga` | Enable/disable IGA | `init-tidecloak.sh` |
| `POST /admin/realms/{realm}/users/{user-id}/tideAdminResources/get-required-action-link` | Generate account linking URL | `init-tidecloak.sh` |
| `GET /admin/realms/{realm}/vendorResources/get-installations-provider?clientId={client-uuid}&providerId=keycloak-oidc-keycloak-json` | Download adapter JSON with Tide extensions. Realm-level endpoint; client passed as `clientId={uuid}` query param (NOT a `/clients/{id}/` path segment). Only valid providerId: `keycloak-oidc-keycloak-json`. `tidecloak-oidc-keycloak-json` does not exist. | `init-tidecloak.sh`, vendor confirmation (GAP-044 resolved) |

**PARTIALLY_RESOLVED** (GAP-029): Most endpoint paths observed. `setUpTideRealm` fully documented (vendor confirmation, batch-02 Q-03). `get-required-action-link` request/response schema still missing.

---

## Account Linking Onboarding

**PARTIALLY_RESOLVED_BY_KEYLESSH** (GAP-030):

New admin users must complete account linking:
1. Generate time-limited URL via `get-required-action-link` (default: 12 hours lifespan)
2. User opens link, completes linking in browser
3. Poll user attributes for `tideUserKey` and `vuid`
4. When present, linking complete

**Evidence**: keylessh `init-tidecloak.sh`

**Unclear**: Whether mandatory for non-admin users or non-IGA setups.

---

## Settlement Layer (Theory-Only)

**Anonymous Voucher**: Micro-payment token gating every ORK operation. Triple-blinded: ORK identity, vendor identity, user ID independently obfuscated. **VERIFIED** (tier2-protocol-anonymous-voucher.mdx)

**VUID (Vendor User ID)**: Mathematically unlinkable identifier across vendors. Mapped to `vuid` JWT claim. **VERIFIED** (tier2-protocol-double-blind-tss.mdx, keylessh `realm.json`)

**Agent implication**: Vouchers are a universal Tide Network requirement — every cryptographic operation requires a voucher. For TideCloak apps using `@tidecloak/js`, the SDK automatically constructs the voucher URL from the user's access token — developers do not need to build this URL manually. **VERIFIED** (vendor confirmation, GAP-051 resolved). Non-TideCloak integrations must operate their own voucher faucet and pass its URL to the Heimdall SDK directly.

---

## Voucher Gates (Dual Role Requirement)

**What it is**: For policy-governed VVK encryption, users need TWO types of roles: voucher gate roles and Forseti contract roles. The voucher system in `VoucherResource.java` independently gates whether encrypt/decrypt operations are allowed for a session before the Forseti contract even runs. **VERIFIED** (operational exemplars: forseti-crypto-quickstart, tidecloak-test-cases)

**Two encryption models** **VERIFIED** (test-cases F7, F9, vendor confirmation batch-02 Q-10):

| Pattern | Role names | Encryption model | SDK call |
|---------|-----------|-----------------|----------|
| Self-encryption | `_tide_{tag}.selfencrypt` / `_tide_{tag}.selfdecrypt` | User-bound (only encryptor can decrypt) | `doEncrypt([{data, tags}])` — no policy bytes |
| Policy-based | No `_tide_{tag}` roles required. Tags are opaque data; authorization defined by Forseti contract | Shared (any doken satisfying the contract can decrypt) | `doEncrypt([{data, tags}], policyBytes)` — with policy bytes |

For self-encryption, the SDK checks `_tide_{tag}.selfencrypt`/`.selfdecrypt` roles on the client and ORK. For policy-based encryption, the SDK skips the tag-role check entirely (`tidecloak.js:703-704`); authorization is handled by the Forseti contract, which can check any Keycloak role (not necessarily `_tide_`-prefixed).

**Voucher gate roles**: The voucher system still requires `_tide_*` roles to fund ORK operations, even for policy-based encryption. But you do not need per-tag `_tide_{tag}.encrypt`/`.decrypt` roles — any `_tide_*` role (e.g., `_tide_enabled`, or a generic `_tide_x.selfdecrypt`) satisfies the `vendorsign` voucher check. For `vendordecrypt`, a role matching `_tide_*.selfdecrypt` or `_tide_*.decrypt` is needed.

**Forseti contract roles** (e.g., `shared-data-access`): Checked by the custom contract's `ValidateExecutor`. Controls WHO can actually decrypt. Regular realm role, NOT `_tide_*` prefixed. Only relevant for policy-based encryption.

**Voucher enforcement rules** **VERIFIED** (vendor confirmation, GAP-051 resolved):
The `tidevouchers/fromUserSession` endpoint performs role-based voucher authorization before issuing vouchers:
- `signin` and `updateaccount`: always allowed
- `vendorsign` (encrypt): allowed if user has ANY `_tide_*` role, an authorizer role, or `tide-realm-admin`
- `vendordecrypt` (decrypt): allowed if user has a role matching `_tide_*.selfdecrypt` or `_tide_*.decrypt`

**Without the voucher**: ORKs refuse before the Forseti contract runs. Error: `"session ID ... has not been allowed a voucher action of type vendordecrypt"`.

**Self-encryption role assignment pattern**:
```json
{
  "roles": {
    "realm": [
      { "name": "_tide_secret.selfencrypt", "description": "Voucher gate: enables self-encryption" },
      { "name": "_tide_secret.selfdecrypt", "description": "Voucher gate: enables self-decryption" }
    ]
  }
}
```

**Policy-based encryption role assignment pattern** (simplified approach — vendor confirmation, batch-02 Q-10):
```json
{
  "roles": {
    "realm": [
      { "name": "shared-data-access", "description": "Forseti contract role: who can encrypt/decrypt" },
      { "name": "_tide_x.selfencrypt", "description": "Voucher gate: enables vendorsign (generic tag)" },
      { "name": "_tide_x.selfdecrypt", "description": "Voucher gate: enables vendordecrypt (generic tag)" }
    ]
  }
}
```

Policy-based encryption does NOT require per-tag `_tide_{tag}.encrypt`/`.decrypt` roles. The SDK skips the tag-role check when a `decryption_policy` is provided. Use a generic voucher gate (e.g., `_tide_x.selfencrypt`/`_tide_x.selfdecrypt` with tag `x`) to satisfy the voucher system. Actual access control is entirely in the Forseti contract checking the business role (e.g., `shared-data-access`).

Note: The `SimpleTagBasedDecryptionContract` is one built-in default contract that does check `_tide_{tag}.encrypt`/`.decrypt` roles, but the standard Forseti flow uses custom contracts where authorization is fully contract-defined.

**Agent implication**: After adding roles to a running realm, users must refresh their token (or log out and back in) for the doken to pick up new roles. Propagation may take up to 120s. **VERIFIED** (test-cases F3, F7)

**Anti-pattern**: Using `_tide_*` roles in your Forseti contract's `ValidateExecutor`. The voucher gate roles are for ORK operation gating only. Your contract should check a regular realm role.

**Anti-pattern**: Using self-encryption roles (`selfencrypt`/`selfdecrypt`) when you need shared access. Self-encryption is identity-bound. Use policy-based encryption with a Forseti contract for shared data. Policy-based encryption does not require per-tag `_tide_` roles — authorization is contract-defined.

**Anti-pattern**: Renaming `selfencrypt`/`selfdecrypt` to `encrypt`/`decrypt` and expecting this to enable shared decryption. The role suffix does not change the encryption model. The SDK call path determines whether encryption is self-bound or policy-governed. See AP-26 in `canon/anti-patterns.md`.

---

## Self-Encryption vs Policy-Governed VVK Encryption

**What it is**: Two completely separate encryption models with different key binding, access semantics, and SDK call paths. **VERIFIED** (operational exemplars: forseti-crypto-quickstart)

**Model 1: Self-encryption** (no policy):
- SDK calls: `doEncrypt(data)` / `doDecrypt(data)` on `useTideCloak()`
- Binds ciphertext to the encrypting user's identity (CVK)
- Only that user can decrypt
- Giving another user `selfdecrypt` role does NOT let them decrypt your data
- Use for: personal vaults, user-private data

**Model 2: Policy-governed VVK encryption** (with signed policy):
- SDK calls: `IAMService.doEncrypt(data, signedPolicyBytes)` / `IAMService.doDecrypt(data, signedPolicyBytes)`
- Encrypts with VVK (organizational key distributed across ORKs)
- Any user whose doken satisfies the Forseti contract can decrypt
- Requires a signed Forseti policy with a custom contract
- Use for: shared data, group messaging, multi-user access

**Critical distinction**: The `doEncrypt`/`doDecrypt` on `useTideCloak()` are convenience wrappers that do NOT pass the policy parameter. For shared encryption, call `IAMService` directly.

**Agent implication**: Never use self-encryption for shared data. Never assume that assigning decrypt roles to multiple users enables cross-user decryption under self-encryption.

**Anti-pattern**: Using `doEncrypt`/`doDecrypt` from `useTideCloak()` and expecting other users to decrypt the result. Self-encryption is identity-bound; shared access requires `IAMService` with a signed policy.

---

## Policy Signing (5-Step Flow)

**What it is**: VVK policy signing requires a 5-step flow through the ORK threshold network. Raw `policy.toBytes()` without a VVK signature is rejected. **VERIFIED** (operational exemplars: forseti-crypto-quickstart)

**The 5 steps**:

```js
const tc = IAMService._tc;

// Step 1: Initialize the request
const initialized = await tc.createTideRequest(request.encode());

// Step 2: Operator approval (opens popup for user to sign)
const approvalResults = await tc.requestTideOperatorApproval([
  { id: "policy-sign", request: initialized },
]);
if (approvalResults[0].status !== "approved") throw new Error("Denied");

// Step 3: Decode approved request and ATTACH THE ADMIN POLICY
const approvedRequest = BaseTideRequest.decode(approvalResults[0].request);
const adminPolicyBytes = await fetchAdminPolicyFromTideCloak(token);
approvedRequest.addPolicy(adminPolicyBytes);

// Step 4: Execute sign request (waitForAll MUST be true)
const signatures = await tc.executeSignRequest(approvedRequest.encode(), true);

// Step 5: Attach VVK signature to the policy object
policy.signature = signatures[0];
const signedBytes = policy.toBytes(); // NOW has VVK signature
```

**What fails if each step is skipped**:
- Skip step 2 (popup): `executeSignRequest` alone does not sign policies
- Skip step 3 (admin policy): ORKs reject with `"Policy supplied has not been signed"`
- Skip step 4 (executeSignRequest): approval popup alone does not produce the VVK signature
- Forget `policy.signature = signatures[0]`: policy bytes have no signature, ORKs reject

**Critical pitfalls**:
- Do NOT call `addPolicy(policy.toBytes())` on the `BaseTideRequest` during construction. Attaching an unsigned policy causes `createTideRequest` to fail immediately. Only call `addPolicy()` in step 3 to attach the signed admin policy.
- Do NOT store signed policy bytes to the server until verified. A failed signing attempt storing unsigned bytes causes subsequent calls to fetch stale bytes and silently fail.

**Agent implication**: Copy the exact pattern from the forseti-crypto-quickstart reference implementation. Deviating from the step order or parameter passing causes ORK byte serialization failures.

**Anti-pattern**: Attempting to sign policies from the init script or backend. The backend receives `requiresApprovalPopup: true` and cannot complete the signing. Policy signing MUST happen from the frontend after the admin logs in.

---

## SDK Internals

**What it is**: Internal structure of Tide SDK packages and their exports. **VERIFIED** (operational exemplars: forseti-crypto-quickstart, tidewarden, keylessh)

**Package responsibilities** **VERIFIED** (runtime confirmation, GAP-042):
- **`@tidecloak/nextjs`** — Next.js integration layer. Exports `TideCloakProvider`, `useTideCloak`, `useAuthCallback`, `Authenticated`/`Unauthenticated`, guard components. Does NOT export `Models`, `PolicySignRequest`, `BaseTideRequest`, `ApprovalType`, `ExecutionType`, or any policy/model helpers. Importing these from `@tidecloak/nextjs` returns `undefined` at runtime.
- **`@tideorg/js`** — Exports `Models` (`Policy`, `BaseTideRequest`, `ExecutionType`, `ApprovalType`) and `Contracts` (`GenericResourceAccessThresholdRoleContract`). **This is the preferred import source for Models and Contracts.**
- **`heimdall-tide`** — Exports `PolicySignRequest`. Use `PolicySignRequest.New(policy)` to construct policy signing requests. **This is the preferred import source for PolicySignRequest.**
- **`@tidecloak/js`** — Core TideCloak JS SDK. Exports `IAMService`, `TideCloak` (for DPoP). Re-exports `Models` from `@tideorg/js` and `PolicySignRequest` from `heimdall-tide`, but the re-exports may be incomplete. Prefer importing from the source packages directly.
- **`asgard-tide`** — Vendor validation library.

**Package-boundary rule**: `@tidecloak/nextjs` is the Next.js-facing auth/provider/hooks layer. It does NOT export policy/model helpers (`Models`, `PolicySignRequest`, `BaseTideRequest`, `ApprovalType`, `ExecutionType`). When those helpers are needed, import `Models` from `@tideorg/js` and `PolicySignRequest` from `heimdall-tide`. Importing them from `@tidecloak/nextjs` produces `undefined` at runtime, causing destructuring failures like `Cannot destructure property 'Policy' of 'Models' as it is undefined`.

**Import rules**:
```js
// Models and Contracts: import from @tideorg/js (NOT @tidecloak/nextjs)
import { Models, Contracts } from "@tideorg/js";
const { Policy, ApprovalType, ExecutionType, BaseTideRequest } = Models;

// PolicySignRequest: import from heimdall-tide (NOT @tidecloak/nextjs)
import { PolicySignRequest } from "heimdall-tide";

// IAMService and TideCloak: import from @tidecloak/js
import { IAMService } from "@tidecloak/js";
import { TideCloak } from "@tidecloak/js";  // for DPoP flows

// Policy signing methods live on the TideCloak instance, not IAMService:
const tc = IAMService._tc;  // underlying TideCloak instance
await tc.createTideRequest(request);
await tc.requestTideOperatorApproval(requests);
await tc.executeSignRequest(request, waitForAll);

// Next.js hooks/provider: from @tidecloak/nextjs
import { useTideCloak, TideCloakProvider } from "@tidecloak/nextjs";
```

**Next.js webpack workaround**: `@tidecloak/js` re-exports symbols from `heimdall-tide` that may not resolve. Add to `next.config.ts`:
```typescript
config.module.strictExportPresence = false;
```
Also add the `@tidecloak/react` ESM alias. See `canon/framework-matrix.md` for the complete webpack config. VERIFIED (learning-batch-004, L-04).

**Model IDs format**: `"{name}:{version}"`. Examples: `"Policy:1"`, `"PolicyEnabledEncryption:1"`, `"PolicyEnabledDecryption:1"`. Check `ModelRegistry.js` in `@tideorg/js/dist/Models/` for correct names. Never guess model names.

**Agent implication**: Always use the documented import paths. The #1 source of policy-signing failures is importing from the wrong package or incorrect destructuring.

**Anti-pattern**: Importing `Models` or `PolicySignRequest` from `@tidecloak/nextjs`. This package does not export them. Dynamic imports like `await import("@tidecloak/nextjs")` return `undefined` for these symbols, producing `Cannot destructure property 'Policy' of 'Models' as it is undefined`. Fix: import `Models` from `@tideorg/js` and `PolicySignRequest` from `heimdall-tide`.

**Anti-pattern**: Destructuring `{ ApprovalType, ExecutionType }` from `Models.Policy` instead of `Models`. `Models.Policy` is the Policy class itself. This gives `undefined`, causing `Cannot read properties of undefined (reading 'IMPLICIT')`.

### `@tideorg/js` Export Reference (v0.13.33)

`@tideorg/js` exports 8 namespaces. Only `Models` and `Contracts` are needed for app-level policy work. The others are internal SDK plumbing.

**Top-level namespaces**: `Models`, `Contracts`, `Clients`, `Cryptide`, `Errors`, `Flow`, `Math`, `Tools` (also aliased as `Utils`).

**Top-level convenience re-exports** (alongside the namespaces): `TideError` and `TideJsErrorCodes` (from `Errors`), and `RecentRequestsBuffer` (from `Clients`). The `Errors` namespace carries the SDK's structured error-reporting surface. **VERIFIED** (tide-js `index.ts` on `main`).

#### Models (app-facing — used in policy signing)

| Export | Type | Purpose |
|--------|------|---------|
| `Models.Policy` | class | Construct a Forseti policy. Constructor: `{ version, contractId, modelId, keyId, approvalType, executionType, params }`. Methods: `toBytes()`, static `from()`. Property: `signature` (set after signing). |
| `Models.ApprovalType` | enum | `EXPLICIT` (0) = separate approver dokens needed. `IMPLICIT` (1) = no separate approvers. |
| `Models.ExecutionType` | enum | `PRIVATE` (0) = runs `ValidateExecutor` on user's doken. `PUBLIC` (1) = no executor check. |
| `Models.BaseTideRequest` | class | Base request for Tide operations. Methods: `encode()`, `decode()`, `addPolicy()`, `addApproval()`, `addAuthorizer()`, `setCustomExpiry()`, `getPolicy()`, `hasPolicy()`, `isInitialized()`, `replicate()`. |
| `Models.Doken` | class | Authorization/identity token. Properties: `header`, `payload` (`sessionKey`, `tideuserkey`, `vuid`, `homeOrk`, `exp`, `aud`, `realm_access`, `resource_access`), `signature`. Methods: `isExpired()`, `validate()`, `verify()`, `serialize()`. |
| `Models.SerializedField` | class | Encrypted field envelope (TideMemory format v1). Static: `create()`, `deserialize()`. |
| `Models.Datum` | class | Data element with tag. Properties: `data`, `tag`. |
| `Models.AuthRequest` | class | Authentication request. Properties: `keyId`, `purpose`, `keyPub`, `expiry`, `sessionId`. |
| `Models.VendorData` | class | Vendor data. Properties: `VUID`, `gCMKAuth`, `blindSig`, `AuthToken`. |
| `Models.VendorSettings` | class | Vendor config. Properties: `regOn`, `backupOn`, `imageURL`, `logoURL`. |
| `Models.EnclaveEntry` | class | Enclave entry. Properties: `username`, `persona`, `expired`, `userInfo`, `orksBitwise`, `selfRequesti`, `sessKey`. |
| `Models.PolicyParameters` | class | Policy parameter storage. Methods: `tryGetParameter()`, `getParameter()`, `toBytes()`. |
| `Models.ModelRegistry` | class | Registry for model builders. Static: `getHumanReadableModelBuilder()`. |
| `Models.HumanReadableModelBuilder` | class | Builds human-readable request representations. Methods: `getDetailsMap()`, `getRequestDataJson()`, `getExpiry()`. |
| `Models.Infos.KeyInfo` | class | User key info. Properties: `UserId`, `UserPublic`, `UserM`, `OrkInfo`. |
| `Models.Infos.OrkInfo` | class | ORK node info. Properties: `orkID`, `orkPublic`, `orkURL`, `orkPaymentPublic`. |

#### Contracts (app-facing — used for contract validation)

| Export | Type | Purpose |
|--------|------|---------|
| `Contracts.BaseContract` | abstract class | Base for contract validation. Abstract: `validateData()`, `validateApprovers()`, `validateExecutor()`. Method: `testPolicy()`. |
| `Contracts.GenericRealmAccessThresholdRoleContract` | class | Built-in contract checking realm roles with threshold approval. |
| `Contracts.GenericResourceAccessThresholdRoleContract` | class | Built-in contract checking client/resource roles with threshold approval. |
| `Contracts.Doken` | class | Doken for contract context. Methods: `hasResourceAccessRole()`, `hasRealmAccessRole()`, `hasVuid()`. |

#### Tools (utility — used for serialization)

| Export | Type | Purpose |
|--------|------|---------|
| `Tools.TideMemory` | class (extends Uint8Array) | Tide's binary serialization format. Static: `CreateFromArray()`, `Create()`. Methods: `WriteValue()`, `GetValue()`, `TryGetValue()`. |
| `Tools.Threshold` | constant | Default threshold (14). |
| `Tools.Max` | constant | Default max ORKs (20). |
| `Tools.CurrentTime()` | function | Current timestamp. |
| `Tools.WaitForNumberofORKs()` | function | Wait for threshold ORK responses. |

#### Cryptide (internal — rarely needed by app code)

Low-level cryptographic operations. Sub-namespaces: `Encryption` (ElGamal, AES, DH), `Signing` (EdDSA, BlindSig, signature formats), `Hashing` (SHA256, SHA512, HMAC), `Ed25519` (curve point math), `Components` (key component system), `Serialization` (byte conversion utilities), `Interpolation` (Lagrange interpolation for threshold), `Math` (modular arithmetic).

Key class: `Cryptide.TideKey` — key management. Static: `NewKey()`, `FromSerializedComponent()`. Methods: `sign()`, `verify()`, `asymmetricEncrypt()`, `asymmetricDecrypt()`.

#### Flow (internal — SDK orchestration)

High-level operation flows. Sub-namespaces: `DecryptionFlows`, `EncryptionFlows`, `SigningFlows`, `VoucherFlows`.

Key class: `Flow.EncryptionFlows.PolicyAuthorizedEncryptionFlow` — policy-based encrypt/decrypt. Methods: `encrypt()`, `decrypt()`, `createEncryptionRequest()`, `createDecryptionRequest()`, `commitEncrypt()`, `commitDecrypt()`.

Key class: `Flow.SigningFlows.dVVKSigningFlow2Step` — two-step VVK signing. Methods: `preSign()`, `sign()`, `getVouchers()`.

#### Math (internal — threshold crypto math)

| Export | Type | Purpose |
|--------|------|---------|
| `Math.KeyDecryption.GetKeys()` | function | Recover keys from decryption shares. |
| `Math.KeySigning.PreSign()` | function | Prepare threshold signature. |
| `Math.KeySigning.Sign()` | function | Finalize threshold signature. |

---

## Admin Policy Endpoint

**What it is**: How to fetch the signed admin policy needed in step 3 of policy signing. **VERIFIED** (custom-contracts.md; LEARNINGS-ratidefy-batch-001 L-22)

**Endpoints**:
```
WRONG:   GET /admin/realms/{realm}/tide-admin/realm-policy
         Returns: { status: "none" } even when the policy exists

WRONG:   GET /realms/{realm}/tide-policy-resources/admin-policy
         This public endpoint does NOT exist on current main.

CORRECT: GET /admin/realms/{realm}/iga/role-policies   (server-side, admin bearer token)
         Returns: an array of role-policy records; the signed policy bytes
         live in each record's `policy` field (base64), alongside `policySig`.
```

**Response handling**: Fetch server-side with an admin bearer token, pick the `admin-policy` record, and decode its `policy` field. Proxy the bytes to the browser:
```js
// Backend proxy (admin token required)
const rpUrl = `${authServerUrl}/admin/realms/${realm}/iga/role-policies`;
const rolePolicies = await fetch(rpUrl, {
  headers: { Authorization: `Bearer ${adminToken}` },
}).then(r => r.json());
const adminPolicyB64 = rolePolicies.find(p => p.name === 'admin-policy')?.policy;
const raw = Buffer.from(adminPolicyB64, "base64");
res.json({ policyBytes: Array.from(new Uint8Array(raw)) });

// Frontend
const data = await res.json();
const adminPolicyBytes = new Uint8Array(data.policyBytes);
```

**Common mistake**: Treating the base64 string as raw bytes (passing each character's char code as a byte value). If admin policy bytes start with `[65, 81, 65, 65, ...]` (ASCII for `"AQAA..."`), you are passing base64 text as byte values instead of decoding it. The ORK fails with `Index out of range` because the policy structure is garbage.

**Agent implication**: Always base64-decode the response. Proxy through your backend since this is a non-admin endpoint.

**Anti-pattern**: Using `GET /admin/realms/{realm}/tide-admin/realm-policy` to fetch the admin policy. This endpoint checks status only and returns `{ status: "none" }` regardless of whether the policy exists.

---

## Realm Policy Setup

**What it is**: Endpoints for creating and managing the realm admin policy. The realm admin policy must exist before encryption policies can be signed. **VERIFIED** (operational exemplars: forseti-crypto-quickstart)

**Endpoints**:
```
GET  /tide-admin/realm-policy              -> check status
POST /tide-admin/realm-policy/pending      -> create pending policy (needs templateId + contractCode)
POST /tide-admin/realm-policy/commit       -> commit after approval
GET  /tide-admin/policy-templates          -> list templates
POST /tide-admin/policy-templates          -> create template
```

**Setup sequence**:
1. Create a policy template via `POST /tide-admin/policy-templates`
2. Create a pending realm policy via `POST /tide-admin/realm-policy/pending` with `templateId` and `contractCode`
3. Approve via enclave (admin browser required)
4. Commit via `POST /tide-admin/realm-policy/commit`

**Storing policy on a role** (`init-cert` endpoint) **VERIFIED** (vendor confirmation, GAP-039 resolved):
```
POST /admin/realms/{realm}/tide-iga-provider/role-policy/{roleId}/init-cert
Content-Type: application/json

{
  "initCert": "<base64 signed policy bytes, required>",
  "initCertSig": "<base64 raw VVK signature, optional>"
}
```
There is no `doken` field — this is a pure storage endpoint persisting to `TideRoleDraftEntity`. Returns `{"message":"initCert updated for role <roleId>"}` on success, 404 if role not found, 400 if `initCert` missing. The stored policy is consumed during multi-admin change-set signing/commit to produce vendor-signed access proofs.

Note: path is `tide-iga-provider`, not `tide-admin`. The JS admin client does not have this endpoint wired up — use raw HTTP.

**Critical requirement**: `templateId` is REQUIRED when creating a pending realm policy. Omitting it causes the request to fail.

**Agent implication**: The realm admin policy is a prerequisite for all encryption policy signing. Verify it exists before attempting to sign encryption policies.

**Anti-pattern**: Attempting to sign encryption policies without first setting up the realm admin policy. The ORKs will reject with `"Policy supplied has not been signed"` because there is no admin policy to attach in step 3 of the policy signing flow.

---

## Status Legend

- **VERIFIED** - Directly sourced from documentation or exemplar evidence (keylessh, forseti-crypto-quickstart, tidewarden, test-cases, CHANGE_REQUEST_API.md)
- **INFERRED** - Strongly implied by source material
- **ASSUMED** - Operator guidance where sources are silent
- **REQUIRES_RUNTIME_VALIDATION** - Single-app evidence; needs confirmation across apps
- **STILL_UNRESOLVED** - Open gap
- **PARTIALLY_RESOLVED** - Partial evidence; gaps remain
