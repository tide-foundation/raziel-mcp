# Set Up Forseti-Governed E2EE (Policy-Based Shared Encryption)

Implement end-to-end encrypted data sharing using Tide's Forseti policy contracts and VVK encryption. This is the most complex Tide integration. Follow every step exactly.

**CRITICAL**: Self-encryption and policy-governed encryption are completely different mechanisms. Do not mix them. Do not skip the policy signing flow. Do not improvise byte serialization.

---

## When to Use

- Encrypting data that multiple users must decrypt (shared secrets, messages, credentials)
- Enforcing role-based access to encrypted data via Forseti contracts on the ORK network
- Building scoped group encryption (e.g., team vaults, org-level shared data)
- Requiring threshold-governed operations with custom business rules

**Do not use** for private-only encryption where only the encrypting user needs access. Use self-encryption instead.

---

## Prerequisites

- TideCloak realm deployed with ORK network connected
- `@tidecloak/js` and `heimdall-tide` packages installed
- `IAMService` initialized via `useTideCloak()` or equivalent
- Admin user with `tide-realm-admin` role (required for policy signing)
- Backend API for storing signed policy bytes
- Familiarity with [protect-api-nextjs.md](protect-api-nextjs.md) and [add-rbac-nextjs.md](add-rbac-nextjs.md)

---

## Two Encryption Models

### 1. Self-Encryption (Private Data, NO Sharing)

Uses `doEncrypt`/`doDecrypt` from `useTideCloak()` WITHOUT a policy parameter. Ciphertext is bound to the encrypting user's identity. Only that user can ever decrypt. Giving another user the same `selfdecrypt` role does NOT let them decrypt your data.

```tsx
const { doEncrypt, doDecrypt } = useTideCloak();

// Private: ONLY I can ever decrypt this
const encrypted = await doEncrypt([{ data: "my secret", tags: ["vault"] }]);
const plaintext = await doDecrypt([{ encrypted: encrypted[0], tags: ["vault"] }]);
// plaintext only exists in browser memory
```

Requires `_tide_{tag}.selfencrypt` / `_tide_{tag}.selfdecrypt` realm roles.

### 2. Policy-Governed VVK Encryption (Shared Data)

Uses `IAMService.doEncrypt(data, policyBytes)` WITH a signed policy. Encrypts with VVK (organizational key distributed across ORKs). Any user whose doken satisfies the Forseti policy can decrypt.

```jsx
const { IAMService } = useTideCloak();

// Encrypt with VVK + policy (shared: anyone with the right role can decrypt)
const encrypted = await IAMService.doEncrypt(
  [{ data: "shared message", tags: ["shared"] }],
  signedPolicyBytes  // MUST be VVK-signed Uint8Array
);

// Decrypt (any user whose doken satisfies the Forseti contract)
const decrypted = await IAMService.doDecrypt(
  [{ encrypted: ciphertext, tags: ["shared"] }],
  signedPolicyBytes
);
```

The `doEncrypt`/`doDecrypt` on `useTideCloak()` are convenience wrappers that do NOT pass the policy parameter through. For shared encryption, call `IAMService` directly.

---

## Step 1: Write the Forseti Contract (C#)

Every contract implements `IAccessPolicy` from `Ork.Forseti.Sdk`. Without the `using` directive, the ORK compiler fails with `"The type or namespace name 'IAccessPolicy' could not be found"`.

```csharp
using Ork.Forseti.Sdk;

public class Contract : IAccessPolicy
{
    [PolicyParam(Required = true)]
    public string Role { get; set; }

    public PolicyDecision ValidateData(DataContext ctx)
    {
        if (ctx.Data == null || ctx.Data.Length == 0)
            return PolicyDecision.Deny("No data provided");
        return PolicyDecision.Allow();
    }

    public PolicyDecision ValidateExecutor(ExecutorContext ctx)
    {
        var executor = new DokenDto(ctx.Doken);
        return Decision
            .RequireNotExpired(executor)
            .RequireRole(executor, Role);
    }
}
```

For contracts that also need approver validation (EXPLICIT approval mode):

```csharp
using Ork.Forseti.Sdk;

public class Contract : IAccessPolicy
{
    [PolicyParam(Required = true)]
    public string Role { get; set; }

    [PolicyParam(Required = true)]
    public string Resource { get; set; }

    public PolicyDecision ValidateData(DataContext ctx)
    {
        if (ctx.Data == null || ctx.Data.Length == 0)
            return PolicyDecision.Deny("No data provided");
        return PolicyDecision.Allow();
    }

    public PolicyDecision ValidateApprovers(ApproversContext ctx)
    {
        // M-of-N approval (for EXPLICIT policies)
        var approvers = DokenDto.WrapAll(ctx.Dokens);
        return Decision
            .RequireAnyWithRole(approvers, Resource, Role);
    }

    public PolicyDecision ValidateExecutor(ExecutorContext ctx)
    {
        // Check executor has required role (for PRIVATE policies)
        var executor = new DokenDto(ctx.Doken);
        return Decision
            .RequireNotExpired(executor)
            .RequireRole(executor, Resource, Role);
    }
}
```

**Advanced contract features** (from forseti-crypto-quickstart):
- Separate `EncryptionRealmRole` and `DecryptionRealmRole` params (both optional)
- Detect encrypt vs decrypt via `ctx.RequestId` (`PolicyEnabledEncryption:1` / `PolicyEnabledDecryption:1`)
- Read tags from `ctx.Data` and enforce `DecryptTimeLock:{epoch}` tags (block decryption until a timestamp)

---

## Step 2: Compute the Contract Hash

**There is no REST API for deploying Forseti contracts.** Do not use `PUT` or `POST` to `/tide-admin/forseti-contracts` — these endpoints do not exist (404/405). Contract deployment happens via `PolicySignRequest.addForsetiContractToUpload(contractSource)` in the browser signing flow (Step 4). VERIFIED (session-001, LEARNINGS-batch-007 L-06).

The `contractId` must be the SHA-512 hash of the EXACT contract source. Compute it locally:

```js
async function computeContractHash(source) {
  const data = new TextEncoder().encode(source);
  const hash = await crypto.subtle.digest("SHA-512", data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}
```

---

## Step 3: Construct the Policy

Policy uses IMPLICIT + PRIVATE:
- **IMPLICIT** approval: no separate approver dokens needed
- **PRIVATE** execution: runs `ValidateExecutor` on the user's doken

**CRITICAL import path**: `ApprovalType` and `ExecutionType` are direct exports from `Models`, alongside `Policy`. They are NOT nested under `Models.Policy` (which is the class itself, not a namespace).

```js
const { Models } = await import("@tideorg/js");
const { Policy, ApprovalType, ExecutionType } = Models;

// vendorId MUST come from the adapter JSON config (data/tidecloak.json).
// Do NOT read it from IAMService._tc.vendorId — that property is undefined.
// import tcConfig from '../../data/tidecloak.json';
const vendorId = tcConfig.vendorId; // or tcConfig["vendorId"]

const policy = new Policy({
  version: "3",
  contractId: contractHash,
  // modelId MUST be an array of specific model IDs, NOT "any"
  // These are the ORK request types the policy governs
  modelId: ["PolicyEnabledEncryption:1", "PolicyEnabledDecryption:1"],
  keyId: vendorId, // from adapter JSON, not from IAMService
  approvalType: ApprovalType.IMPLICIT,
  executionType: ExecutionType.PRIVATE,
  params: new Map([["Role", "shared-data-access"]]),
});
```

**Wrong:**
```js
// WRONG: destructuring from Models.Policy (a class, not a namespace)
const { ApprovalType, ExecutionType } = Models.Policy;

// WRONG: using "any" instead of specific model IDs
modelId: "any"
```

---

## Step 4: Sign the Policy (5-Step Flow)

Raw `policy.toBytes()` will be rejected by the ORKs with `"Policy supplied has not been signed"`. Policy signing is a 5-step process.

### CRITICAL: Import Paths

`PolicySignRequest` MUST come from `heimdall-tide`. Despite broken package exports for some symbols, `PolicySignRequest` itself works and handles the draft serialization format that the ORK expects. Do NOT try to build the policy signing request manually with `BaseTideRequest` + `TideMemory`.

```js
const { PolicySignRequest } = await import("heimdall-tide");
const { Models } = await import("@tideorg/js");
const { BaseTideRequest } = Models;
```

### The 5 Steps

```js
const tc = IAMService._tc;
if (!tc) throw new Error("TideCloak not initialized — user must be logged in before policy signing");

// Step 1: Build and initialize the request
const policyRequest = PolicySignRequest.New(policy);
policyRequest.addForsetiContractToUpload(CONTRACT_SOURCE);
policyRequest.setCustomExpiry(604800); // 1 week

const initializedBytes = await tc.createTideRequest(policyRequest.encode());
const initialized = BaseTideRequest.decode(initializedBytes);

// Step 2: Operator approval (opens popup for admin to sign)
const approvalResults = await tc.requestTideOperatorApproval([
  { id: "policy-sign", request: initialized.encode() },
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

**Reference implementation wrapper functions** (from forseti-crypto-quickstart `AuthProvider.tsx`). This is the EXACT pattern that works. Do not deviate:

```js
const initializeTideRequest = async (request) => {
  return BaseTideRequest.decode(
    await IAMService._tc?.createTideRequest(request.encode())
  );
};

const approveTideRequests = async (requests) => {
  return await IAMService._tc?.requestTideOperatorApproval(requests);
};

const executeTideRequest = async (request, waitForAll = false) => {
  return await IAMService._tc?.executeSignRequest(request, waitForAll);
};
```

### What Fails If You Skip Each Step

| Skipped Step | Error |
|---|---|
| Step 2 (approval popup) | `executeSignRequest` alone does not sign policies |
| Step 3 (admin policy) | ORKs reject: `"Policy supplied has not been signed"` |
| Step 4 (executeSignRequest) | Approval popup alone does not produce the VVK signature |
| Step 5 (signature assignment) | `policy.toBytes()` has no signature, ORKs reject |

### Critical Pitfalls

- Do NOT call `addPolicy(policy.toBytes())` on the `BaseTideRequest` during construction. Attaching an unsigned policy causes `createTideRequest` to fail immediately. Only call `addPolicy()` in step 3 to attach the signed admin policy.
- Do NOT store signed policy bytes to the server until verified. If a failed signing attempt stores unsigned bytes, subsequent calls fetch stale bytes and silently fail.

---

## Step 5: Get the Admin Policy (Correct Endpoint)

```
WRONG:  GET /admin/realms/{realm}/tide-admin/realm-policy
        -> { status: "none" } (even when the policy exists)

WRONG:  GET /realms/{realm}/tide-policy-resources/admin-policy
        -> does NOT exist on current main (the public policy endpoint was removed)

CORRECT: GET /admin/realms/{realm}/iga/role-policies   (admin bearer required)
         -> JSON; the signed admin policy bytes are in the `policy` field
```

The correct endpoint is an admin API route and **requires an admin bearer token**. Proxy through your backend so the browser never holds the admin credential.

**CORS: Browser cannot fetch this endpoint directly.** TideCloak and the app are on different origins, and this is a privileged admin API. Direct browser fetch returns an opaque/blocked response (and would leak the admin bearer). Create a same-origin API route that proxies the request server-side with the admin token. VERIFIED (session-001).

**If the proxy route is protected with `withAuth` (correct per I-03), the client must use authenticated fetch** (e.g., `appFetch` or `secureFetch` with Bearer header). A bare `fetch()` without Authorization returns 401. The resulting empty/error response produces undefined policy bytes, causing `PolicyAuthorizationFlowException: "Model does not have a policy passed with it"` at signing time. VERIFIED (LEARNINGS-batch-009 L-08).

**There is no REST API for deploying Forseti contracts.** Do not try `PUT` or `POST` to `/tide-admin/forseti-contracts` — these endpoints do not exist on the dev image (404/405). Contract deployment happens via `PolicySignRequest.addForsetiContractToUpload(contractSource)` in the browser signing flow (Step 4). VERIFIED (session-001).

**The signed bytes arrive as a base64 string in the `policy` field, not raw binary.** Read the `policy` field and decode before using:

```js
// Backend proxy (holds the admin bearer)
const json = await tcRes.json();
const raw = Buffer.from(json.policy, "base64");
const bytes = Array.from(new Uint8Array(raw));
res.json({ policyBytes: bytes });

// Frontend
const data = await res.json();
const adminPolicyBytes = new Uint8Array(data.policyBytes);
```

**Common mistake:** Treating the base64 `policy` string as raw bytes (passing each character's char code as a byte value). If admin policy bytes start with `[65, 81, 65, 65, ...]` (ASCII for "AQAA..."), you are passing base64 text as byte values instead of decoding it. The ORK will fail with `Index out of range` because the policy structure is garbage.

**Common mistake:** Malformed URL from trailing slash in `auth-server-url`. The adapter JSON `auth-server-url` may include a trailing slash (e.g., `http://localhost:8080/`). Constructing the admin policy URL without stripping it produces `http://localhost:8080//admin/realms/...` (double slash), which returns HTML or 404 instead of policy bytes. Always normalize:
```js
const baseUrl = config["auth-server-url"].replace(/\/+$/, "");
const adminPolicyUrl = `${baseUrl}/admin/realms/${config.realm}/iga/role-policies`;
```

---

## Step 6: Set Up Dual Role Requirement (Voucher Gates + Forseti Contract Roles)

Even though policy-governed encryption uses the VVK and the Forseti contract uses a regular role for access control, the TideCloak voucher system independently gates whether encrypt/decrypt operations are even allowed for a session.

The voucher system (in `VoucherResource.java`) performs role-based voucher authorization **VERIFIED** (vendor confirmation, GAP-051 resolved):
- `signin` and `updateaccount`: always allowed
- `vendorsign` (encrypt): allowed if user has ANY `_tide_*` role, an authorizer role, or `tide-realm-admin`
- `vendordecrypt` (decrypt): allowed if user has a role matching `_tide_*.selfdecrypt` or `_tide_*.decrypt`

Without the voucher, the ORK refuses to participate before the Forseti contract even runs. Error: `"session ID ... has not been allowed a voucher action of type vendordecrypt"`

**Policy-based encryption does NOT require per-tag `_tide_{tag}.encrypt`/`.decrypt` roles** (vendor confirmation, batch-02 Q-10). The SDK skips the tag-role check when a `decryption_policy` is provided. Authorization is handled entirely by the Forseti contract, which can check any Keycloak role. You only need `_tide_*` roles to satisfy the voucher system.

You need TWO types of roles:

| Role Type | Example | Purpose |
|-----------|---------|---------|
| Voucher gate (generic) | `_tide_x.selfencrypt` / `_tide_x.selfdecrypt` | Enables the voucher action type. Use a single generic tag (e.g., `x`) for all policy-based encrypt/decrypt. Does NOT control who can decrypt. |
| Forseti contract role | `shared-data-access` | Checked by the contract's `ValidateExecutor`. Controls WHO can actually decrypt. Regular realm role, NOT `_tide_*`. |

```json
// realm.json: need BOTH types of roles
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

All three roles should be in the default composite role so all users get them. To restrict decryption access, remove `shared-data-access` from specific users (not the voucher gate roles). Use tag `x` in all `doEncrypt`/`doDecrypt` calls.

After adding roles to a running realm, users must log out and back in for their doken to pick up the new roles.

Note: The `SimpleTagBasedDecryptionContract` is one built-in default that checks `_tide_{tag}.encrypt`/`.decrypt` roles, but the standard Forseti flow uses custom contracts where authorization is contract-defined — no per-tag `_tide_` roles needed.

---

## Step 7: Store Signed Policy Bytes Server-Side

Signed policy bytes are needed by EVERY user who encrypts or decrypts. Store them on the server, not in localStorage (per-browser) or in-memory (lost on refresh).

```
ENCRYPT (sender):
  1. getSignedPolicy() -> tries server, falls back to sign via enclave + store
  2. Returns { bytes, key }
  3. IAMService.doEncrypt(data, bytes)
  4. POST /messages with { encryptedMessage, policyKey: key }

DECRYPT (recipient):
  1. GET /messages/inbox -> each message has policyKey
  2. fetchSignedPolicy(token, msg.policyKey) -> fetches from server by key
  3. IAMService.doDecrypt(data, bytes)
```

Store the policy key with each encrypted message so the recipient knows which signed policy to fetch. Different messages may use different policies (different contracts, roles, sharing groups).

---

## Group Lifecycle (CREATED -> POLICY_SETUP -> READY)

A group requires TWO signed policies before it is operational. Only a `tide-realm-admin` can sign these.

| Policy | Purpose | Without It |
|--------|---------|------------|
| Role policy (init-cert) | Enables VVK-signed UserContext creation when members are assigned | IGA can approve but ORKs will not produce a cryptographic proof |
| Encryption policy | Enables VVK encrypt/decrypt with scoped tag + Forseti contract | ORKs reject: `"Policy supplied has not been signed"` |

```
Group lifecycle states:
  CREATED       -- role exists, role policy attached, no policies signed
  POLICY_SETUP  -- admin has signed one of the two policies
  READY         -- both policies signed, group is usable

Frontend gates:
  - "Add Member" disabled until READY
  - "Send" / encrypt disabled until READY
  - Admin sees setup checklist:
    [ ] Sign role policy (init-cert)    -- approval popup
    [ ] Sign encryption policy          -- approval popup
    [x] Group is ready for use
```

Signing policies lazily (on first use) causes confusing errors for non-admin users who cannot sign policies themselves. Better UX: admin completes setup, then the group is ready.

**The two policies serve completely different purposes and are signed through different APIs:**

| Policy | What It Does | How to Sign | API |
|--------|-------------|-------------|-----|
| Role policy (init-cert) | Enables VVK-signed UserContext when members are assigned roles | `POST /tide-iga-provider/role-policy/{roleId}/init-cert` | IGA admin API |
| Encryption policy | Enables VVK encrypt/decrypt with Forseti contract | `PolicySignRequest.New(policy)` via enclave approval popup | Direct ORK signing flow |

### Role Policy (init-cert) Signing Flow

```js
// 1. Build the policy for role signing (same Policy constructor)
const policy = new Policy({
  version: "3",
  contractId: contractHash,
  modelId: ["PolicyEnabledEncryption:1", "PolicyEnabledDecryption:1"],
  keyId: vendorId,
  approvalType: ApprovalType.IMPLICIT,
  executionType: ExecutionType.PRIVATE,
  params: new Map([["Role", "shared-data-access"]]),
});

// 2. Same PolicySignRequest.New -> createTideRequest -> approval popup -> executeSignRequest
const policyRequest = PolicySignRequest.New(policy);
policyRequest.addForsetiContractToUpload(contractCode);
policyRequest.setCustomExpiry(604800);

const initialized = BaseTideRequest.decode(
  await tc.createTideRequest(policyRequest.encode())
);
const approvals = await tc.requestTideOperatorApproval([
  { id: "role-policy", request: initialized.encode() }
]);
const approved = BaseTideRequest.decode(approvals[0].request);
approved.addPolicy(adminPolicyBytes);
const signatures = await tc.executeSignRequest(approved.encode(), true);

policy.signature = signatures[0];
const signedPolicyData = bytesToBase64(policy.toBytes());
const signedPolicySignature = bytesToBase64(signatures[0]);

// 3. DIFFERENCE: send to TideCloak's init-cert endpoint (not stored locally)
// Note: path is tide-iga-provider, not tide-admin. No doken field — pure storage endpoint.
await fetch(`/admin/realms/${realm}/tide-iga-provider/role-policy/${roleId}/init-cert`, {
  method: "POST",
  headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    initCert: signedPolicyData,
    initCertSig: signedPolicySignature
  })
});
```

### Encryption Policy Signing Flow

Same steps 1-2 as above, but in step 3 store the signed bytes on YOUR server:

```js
policy.signature = signatures[0];
const signedBytes = policy.toBytes();
await storeSignedPolicy(policyKey, Array.from(signedBytes));
```

**What the init script can do (server-side, no browser):**
- Attach Forseti policy to a role: `PUT /tide-admin/ssh-policies`

These are prep steps. None produce VVK-signed bytes.

**What the frontend must do (requires admin's browser enclave):**
- Sign both policies via the `PolicySignRequest` flow above.

---

## The Complete Flow for Scoped Shared Encryption

```
1. ADMIN SETUP (one-time per group):
   - Backend creates role: group-member:{groupId}
   - Backend attaches Forseti policy to role: PUT /tide-admin/ssh-policies
   - Frontend: admin signs role policy via approval popup (init-cert stored)
   - Frontend: admin signs encryption policy via approval popup (stored on server)
   - Both policies signed -- group transitions to READY

2. USER ASSIGNMENT (per user, per scope -- MANUAL APPROVAL REQUIRED):
   - Backend creates IGA draft (assigns role to user)
   - Frontend shows pending change request to group admin
   - Admin clicks Approve -- approval enclave popup -- signs UserContext
   - Frontend submits signed result -- backend commits
   - User refreshes token -- doken now includes group-member:{groupId}

3. ENCRYPT (sender):
   - Fetch signed encryption policy from server
   - IAMService.doEncrypt([{ data, tags: ["group:{groupId}"] }], signedPolicy)
   - ORKs verify: sender's doken has group-member:{groupId} in AccessProof
   - VVK encrypts with scoped tag

4. DECRYPT (recipient):
   - Fetch signed policy from server (by policyKey stored with message)
   - IAMService.doDecrypt([{ encrypted, tags: ["group:{groupId}"] }], signedPolicy)
   - ORKs verify: recipient's doken has group-member:{groupId} in AccessProof
   - VVK decrypts -- plaintext only in recipient's browser
```

**Why this prevents unauthorized access:**
- Tags without a matching UserContext are rejected by the ORKs
- UserContexts are VVK-signed and bound to a specific user's `tideUserKey`
- A user cannot forge or reuse another user's UserContext
- Role assignment goes through IGA governance with manual approval enclave signing
- Backend cannot bypass approval -- `requiresApprovalPopup: true` is enforced

---

## IGA Role Assignment Flow (Manual Approval Required)

Role assignments that produce VVK-signed UserContexts MUST be manually approved through the approval enclave in the admin's browser. You cannot automate this from a backend script.

This is Tide MultiAdmin mode: the VVK-signed UserContext binds a specific user's `tideUserKey` to specific roles, and the signing must happen through the ORK threshold network via the Tide enclave in the admin's browser. The backend CANNOT complete it — a bare `authorize` on such a CR requires the two-phase `approval-model` enclave exchange. (Endpoints: current `/iga/change-requests/...` surface — see `canon/iga-change-requests-api.md`.)

```js
// 1. Backend performs the governed change (role assignment) → 202, a CR is created
POST /admin/realms/{realm}/users/{userId}/role-mappings/realm

// 2. Frontend fetches pending CRs
GET /admin/realms/{realm}/iga/change-requests?status=PENDING   // objects keyed by `id`

// 3. For each CR, fetch the enclave challenge (Tide MultiAdmin)
GET /admin/realms/{realm}/iga/change-requests/{id}/approval-model
//   → { changeRequestId, requestModel: "base64..." }

// 4. Collect the challenges, pass to ONE enclave approval popup
const enclaveRequests = pending.map(cr => ({ id: cr.id, request: base64ToBytes(cr.requestModel) }));
const approvals = await tc.requestTideOperatorApproval(enclaveRequests);

// 5. Submit each signed doken back to the same endpoint
POST /admin/realms/{realm}/iga/change-requests/{id}/approval-model
{ "requestModel": "<base64 doken>" }   // → { recorded, authCount, threshold }

// 6. Commit each CR once ready (readyToCommit === true)
POST /admin/realms/{realm}/iga/change-requests/{id}/commit   // 412 if still under threshold
```

After commit: the user must refresh their token (or re-login) for the new role to appear in their doken. Use `IAMService.forceUpdateToken()` or `useTideCloak().forceRefreshToken()`.

---

## CRITICAL: Import Paths and PolicySignRequest

These imports are the #1 source of policy-signing failures. Get them wrong and the code crashes before reaching the ORK.

**Package-boundary rule**: `@tidecloak/nextjs` is the Next.js hooks/provider layer. It does NOT export `Models`, `PolicySignRequest`, `BaseTideRequest`, `ApprovalType`, or `ExecutionType`. Importing them from `@tidecloak/nextjs` returns `undefined`, producing `Cannot destructure property 'Policy' of 'Models' as it is undefined`. Import `Models` from `@tideorg/js` and `PolicySignRequest` from `heimdall-tide`.

**Correct imports:**

```js
// Models: from @tideorg/js (NOT @tidecloak/nextjs)
const { Models } = await import("@tideorg/js");
const { Policy, ApprovalType, ExecutionType, BaseTideRequest } = Models;
// Models.Policy is the Policy CLASS, not a namespace
// ApprovalType, ExecutionType are direct exports from Models alongside Policy
// NOT: const { ApprovalType } = Models.Policy;  // WRONG -- Policy is a class, not a namespace

// PolicySignRequest: from heimdall-tide (NOT @tidecloak/nextjs)
const { PolicySignRequest } = await import("heimdall-tide");
const policyRequest = PolicySignRequest.New(policy);
policyRequest.addForsetiContractToUpload(CONTRACT_SOURCE);
policyRequest.setCustomExpiry(604800); // 1 week
```

Do NOT try to build the policy signing request manually with `BaseTideRequest` + `TideMemory`. The ORK's `PolicySignRequestFactory` expects a specific internal structure that `PolicySignRequest.New(policy)` produces correctly. Building this manually produces different byte layouts that the ORK cannot parse.

**After createTideRequest, decode the result:**

```js
// createTideRequest returns raw bytes. Decode back to BaseTideRequest
// before passing to approval. Skipping this causes serialization errors.
const initializedBytes = await tc.createTideRequest(policyRequest.encode());
const initializedRequest = BaseTideRequest.decode(initializedBytes);

// Pass the re-encoded request to approval
const approvalResults = await tc.requestTideOperatorApproval([
  { id: "policy-sign", request: initializedRequest.encode() },
]);
```

### SDK Internals (Reference)

- `@tidecloak/js` exports: `IAMService`, `TideCloak`, `RequestEnclave`, `ApprovalEnclaveNew`, `Tools`, `AdminAPI`
- `@tideorg/js` exports: `Models` (`Policy`, `BaseTideRequest`, `ApprovalType`, `ExecutionType`), `Contracts`
- `heimdall-tide` exports: `PolicySignRequest`
- `Tools` includes: `TideMemory` (Tide's serialization format)
- `IAMService._tc` gives access to the underlying `TideCloak` instance for `createTideRequest()` and `executeSignRequest()`
- `RequestEnclave.encrypt(data, policy)` switches flow: `"encrypt"` (self) vs `"policy encrypt"` (VVK) based on whether policy is provided
- Model IDs must match exactly what the ORK registry expects. Check `ModelRegistry.js` in `@tideorg/js/dist/Models/` for the correct `_name` and `_version`. Policy signing is `"Policy:1"` (not `"PolicySign:1"`).

---

## Common Mistakes That Cause Index out of range / PreSign Failures

1. Destructuring `{ ApprovalType, ExecutionType }` from `Models.Policy` instead of `Models` (Models.Policy is the class, not a namespace)
2. Building the request manually instead of using `PolicySignRequest.New(policy)`
3. Not decoding `createTideRequest` result via `BaseTideRequest.decode()` before passing to approval
4. Calling `addPolicy(policy.toBytes())` on the request during construction (attaching unsigned policy)
5. Using wrong model ID (e.g. `"PolicySign:1"` instead of `"Policy:1"`)
6. Using `modelId: "any"` instead of `["PolicyEnabledEncryption:1", "PolicyEnabledDecryption:1"]` in Policy constructor
7. Not using `PolicySignRequest.New(policy)` from `heimdall-tide` to construct the request

**If you get `Index out of range` in `Policy.From` during `PreSign`:** Do NOT try to debug the byte serialization. Instead, copy the exact working pattern from the forseti-crypto-quickstart reference implementation:

1. Copy `~/forseti-crypto-quickstart/template-ts-app/components/AuthProvider.tsx` for the `initializeTideRequest`, `approveTideRequests`, `executeTideRequest` wrapper functions
2. Copy `~/forseti-crypto-quickstart/template-ts-app/app/home/page.tsx` lines 740-830 for the policy creation, initialization, approval, and commit flow
3. Copy `~/forseti-crypto-quickstart/template-ts-app/lib/forsetiContract.ts` for the contract source and `computeContractId` function

The forseti-crypto-quickstart is the reference implementation that works against the live ORK network. If your code diverges from this pattern in any way (different import paths, different function call order, different parameter passing), the ORK byte serialization will fail. Do not improvise.

---

## Verification Checklist

- [ ] `contractId` (SHA-512 of contract source) matches what is passed to `PolicySignRequest.addForsetiContractToUpload`
- [ ] Policy constructed with `ApprovalType.IMPLICIT` and `ExecutionType.PRIVATE` from `Models` (not `Models.Policy`)
- [ ] `modelId` is `["PolicyEnabledEncryption:1", "PolicyEnabledDecryption:1"]` (array, not string)
- [ ] `PolicySignRequest` imported from `heimdall-tide`
- [ ] `BaseTideRequest.decode()` called on `createTideRequest` result before approval
- [ ] Admin policy fetched (admin bearer) from `GET /admin/realms/{realm}/iga/role-policies`; signed bytes read from the `policy` field (the public `tide-policy-resources/admin-policy` endpoint does not exist on main)
- [ ] Admin policy bytes are base64-decoded from the `policy` field (not raw char codes)
- [ ] Approval popup opens and admin approves
- [ ] `executeSignRequest` called with `waitForAll = true`
- [ ] `policy.signature = signatures[0]` assigned before `policy.toBytes()`
- [ ] Signed policy bytes stored server-side (not localStorage)
- [ ] Voucher gate roles assigned to users (generic `_tide_x.selfencrypt`/`_tide_x.selfdecrypt` for policy-based, or per-tag for self-encryption)
- [ ] Forseti contract role (`shared-data-access`) assigned to users
- [ ] Users logged out and back in after role changes
- [ ] `IAMService.doEncrypt(data, signedPolicyBytes)` succeeds
- [ ] `IAMService.doDecrypt(data, signedPolicyBytes)` succeeds for authorized user
- [ ] Decrypt fails for user without the Forseti contract role
- [ ] Group lifecycle: both role policy and encryption policy signed before marking READY

---

## Common Failures

### "Policy supplied has not been signed"

**Cause:** Using raw `policy.toBytes()` without completing the 5-step signing flow, or only completing some steps.
**Fix:** Complete all 5 steps. Verify `policy.signature = signatures[0]` is called before `policy.toBytes()`.

### "The type or namespace name 'IAccessPolicy' could not be found"

**Cause:** Missing `using Ork.Forseti.Sdk;` in the contract source.
**Fix:** Add the `using` directive as the first line of the contract.

### "Policy refers to wrong contract"

**Cause:** `contractId` (SHA-512 hash) does not match the deployed contract source. Common reasons: whitespace or `using` differences between local and deployed copies, OR the hash is lowercase but the ORK stores it uppercase. The ORK comparison is **case-sensitive**.
**Fix:** Fetch `contractHash` from `GET /tide-admin/forseti-contracts` instead of computing locally. If computing locally, the hex string MUST be uppercase (`.toUpperCase()`).

### `Index out of range` in `Policy.From` during `PreSign`

**Cause:** One of the 7 common mistakes listed above. Most likely: wrong import path for `ApprovalType`/`ExecutionType`, or not using `PolicySignRequest.New()`.
**Fix:** Copy the exact pattern from forseti-crypto-quickstart. Do not debug byte serialization.

### "session ID ... has not been allowed a voucher action of type vendordecrypt"

**Cause:** User is missing a `_tide_*` voucher gate role that matches the tag used in encrypt/decrypt calls.
**Fix:** For self-encryption, assign `_tide_{tag}.selfdecrypt`. For policy-based encryption, assign a generic voucher gate (e.g., `_tide_x.selfdecrypt` with tag `x`). User must re-login after role assignment.

### `{ status: "none" }` when fetching admin policy

**Cause:** Using the wrong endpoint `GET /admin/realms/{realm}/tide-admin/realm-policy`. (The old public `GET /realms/{realm}/tide-policy-resources/admin-policy` endpoint no longer exists on main either.)
**Fix:** Use `GET /admin/realms/{realm}/iga/role-policies` with an admin bearer token and read the signed bytes from the `policy` field.

### Admin policy bytes start with `[65, 81, 65, 65, ...]`

**Cause:** Passing base64 text as raw byte values instead of decoding.
**Fix:** `Buffer.from(b64, "base64")` on the backend before sending to frontend.

### `requiresApprovalPopup: true` from backend role assignment

**Cause:** Trying to auto-approve IGA role assignments from backend code.
**Fix:** IGA role assignments must go through the approval enclave in the admin's browser. Use the batch endpoint flow described in the IGA Role Assignment section.

### Decrypt fails silently after adding roles

**Cause:** User's doken does not reflect the new roles yet.
**Fix:** Call `IAMService.forceUpdateToken()` or have the user re-login after role changes.

---

## Do Not Do This

### Do Not Mix Self-Encryption with Policy-Governed Encryption

```js
// WRONG: using doEncrypt from useTideCloak() for shared data
const { doEncrypt } = useTideCloak();
const encrypted = await doEncrypt([{ data: "shared", tags: ["shared"] }]);
// This uses self-encryption. Only you can decrypt. No policy, no sharing.
```

Use `IAMService.doEncrypt(data, signedPolicyBytes)` for shared data.

### Do Not Skip Voucher Gate Roles

Even with a valid Forseti contract role, the ORK refuses to participate without `_tide_*` voucher gate roles. Both role types are required. For policy-based encryption, a generic voucher gate (e.g., `_tide_x.selfencrypt`/`_tide_x.selfdecrypt`) is sufficient — you do not need per-tag `_tide_{tag}.encrypt`/`.decrypt` roles.

### Do Not Sign Policies Lazily

Signing policies on first use causes confusing errors for non-admin users. Sign both policies during admin setup before marking the group as ready.

### Do Not Store Unsigned Policy Bytes

If a signing attempt fails partway through and you store the result, all subsequent encrypt/decrypt calls silently fail. Only store bytes after verifying the full 5-step flow completed.

---

## References

- [add-rbac-nextjs.md](add-rbac-nextjs.md) - Role-based access control
- [protect-api-nextjs.md](protect-api-nextjs.md) - Server-side JWT verification
- Source: `~/forseti-crypto-quickstart/template-ts-app/` - Reference implementation (simplest working example)
- Source: `~/tidecloak-test-cases/test-app/src/lib/database/policyDb.ts` - EXPLICIT + PRIVATE multi-party approval reference
