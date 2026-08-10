# Custom Forseti Contracts - Canon

How to write, deploy, and use custom Forseti smart contracts for access control.

Forseti contracts are C# code that runs in a sandboxed VM on every ORK node. They control who can sign, encrypt, decrypt, or approve operations. No single ORK can bypass a contract - majority must agree.

---

## What You Can Build

A contract is arbitrary C# logic that every ORK evaluates independently before allowing a cryptographic operation. A majority of ORKs must agree. No single server, admin, or compromised node can bypass it.

This means you can encode any business rule directly into the cryptographic layer:

**Agent guidance**: When a user describes what their app needs to protect, control, or enforce - think in contracts. Any business rule that should be tamper-proof can become a contract. The user does not need to know they need a contract. They say "only managers should approve expenses over $5K" or "patients should control who sees their records" or "we need three people to sign off on a deployment." Your job is to recognize that these are contract problems and write the C# that enforces them.

Be creative. The contract API gives you roles, identity, time, geo, payload data, multi-party approval, and separation of duties. Combine them. A user who says "build me a password manager" gets self-encryption. A user who says "build me a password manager with recovery" gets a contract that requires 3-of-5 recovery contacts. A user who says "sign transactions" gets a contract that checks amounts against limits and requires more approvers for larger values. A user who says "encrypt medical records" gets a contract that checks the accessor's role, the time of day, and logs every access attempt.

The contract runs on every ORK independently. No server, admin, or single point of compromise can bypass it. This is the differentiator. When the user's requirement is "nobody should be able to cheat this rule" - that is a contract.

Do not wait for the user to ask for a Forseti contract. Recognize when their requirements imply one and propose it.

You can write any C# logic that fits within the sandbox constraints. There are no pre-built templates you must follow. The SDK gives you building blocks - role checks, time checks, doken inspection, payload parsing, approval counting - but the contract itself is freeform C# code. If the user needs a rule that does not map to any existing pattern, write new logic. Parse the payload bytes. Compare values. Count things. Check conditions. Combine checks in ways nobody has combined them before. The contract is your code, meeting the user's specific need, enforced by the network. Write exactly what the situation requires.

---

## When You Need a Custom Contract

Use a built-in contract for simple role-gated multi-approval. Write a custom contract when you need:

- Executor validation (who can perform the action)
- Data validation (what data is being signed/encrypted)
- Time-based restrictions (business hours, weekdays)
- Complex approval logic (minimum from different orgs, no self-approval)
- Direction-specific logic (different rules for encrypt vs decrypt)
- Amount/threshold checks on payload data
- Separation of duties enforcement
- Multi-jurisdictional approval requirements

### Built-in Contracts

| Contract ID | Checks | Parameters |
|-------------|--------|------------|
| `GenericResourceAccessThresholdRole:1` | Approvers have a **client role** | `role`, `resource`, `threshold` |
| `GenericRealmAccessThresholdRole:1` | Approvers have a **realm role** | `role`, `resource`, `threshold` |
| `SimpleTagBasedDecryption:1` | Executor has `_tide_{tag}.encrypt`/`.decrypt` role | tag from data |

Built-in contracts only validate approvers (or tags). They do NOT validate the executor or the data. For anything beyond "N people with role X must approve", write a custom contract.

---

## Contract Template

Every contract must:
- Use namespace `Ork.Forseti.Sdk`
- Have a class named `Contract`
- Implement `IAccessPolicy`

```csharp
using Ork.Forseti.Sdk;

public class Contract : IAccessPolicy
{
    // Parameters bound automatically from policy config
    [PolicyParam(Required = true, Description = "Role required to execute")]
    public string Role { get; set; }

    [PolicyParam(Required = true, Description = "Resource/client to check role against")]
    public string Resource { get; set; }

    // STEP 1: Validate request data (always runs)
    public PolicyDecision ValidateData(DataContext ctx)
    {
        return PolicyDecision.Allow();
    }

    // STEP 2: Validate approvers (runs if ApprovalType.EXPLICIT)
    public PolicyDecision ValidateApprovers(ApproversContext ctx)
    {
        return PolicyDecision.Allow();
    }

    // STEP 3: Validate executor (runs if ExecutionType.PRIVATE)
    public PolicyDecision ValidateExecutor(ExecutorContext ctx)
    {
        var executor = new DokenDto(ctx.Doken);

        return Decision
            .RequireNotExpired(executor)
            .RequireRole(executor, Resource, Role);
    }
}
```

---

## Three Validation Methods

| Method | When it runs | Context | Use for |
|--------|-------------|---------|---------|
| `ValidateData(DataContext ctx)` | Always | `ctx.Data`, `ctx.DynamicData`, `ctx.RequestId` | Time checks, data format validation, direction detection |
| `ValidateApprovers(ApproversContext ctx)` | When `ApprovalType.EXPLICIT` | `ctx.Dokens` (list of approver tokens) | Quorum checks, role-based approval, org diversity |
| `ValidateExecutor(ExecutorContext ctx)` | When `ExecutionType.PRIVATE` | `ctx.Doken` (executor's token) | Role checks, identity checks, expiry |

Each returns `PolicyDecision.Allow()` or `PolicyDecision.Deny("reason")`.

### Direction Detection (Encrypt vs Decrypt)

For encryption contracts, detect the direction via `ctx.RequestId`:

```csharp
public PolicyDecision ValidateData(DataContext ctx)
{
    if (ctx.RequestId == "PolicyEnabledEncryption:1")
    {
        // Encrypt-specific validation
        return PolicyDecision.Allow();
    }
    if (ctx.RequestId == "PolicyEnabledDecryption:1")
    {
        // Decrypt-specific validation
        return Decision.RequireWeekday();
    }
    return PolicyDecision.Deny("Unknown request type");
}
```

### Identity in Contracts: the VUID, never the JWT subject

A contract asserting WHO acted needs an identifier both sides can see. The OIDC `sub` is **not**
it. `DokenDto.UserId` returns `Payload.Vuid`, and a doken carries no subject claim at all — so a
contract can never check `creator.subject`, no matter where you put it in the payload. A policy
that tries denies every signature, and you discover it only after an operator approval.

Two identity systems meet here and only one of them reaches the ORKs. Carry both, and label which
is which:

| Field | Who enforces it | What it is for |
|---|---|---|
| `creator.vuid` | the ORK **network**, byte-compared against the doken | authorship |
| `creator.subject` | your own server, at submission time | display, database linkage |

Put the vuid in the wire payload at a **fixed offset** so the contract can find it, and leave the
subject in the JSON for humans:

```csharp
// In the contract: compare against the doken's UserId, which IS the vuid
var executor = new DokenDto(ctx.Doken);
return Decision.Require(claimedVuid == executor.UserId, "Signer is not the claimed creator");
```

If the two are silently swapped, a verifier's "header agrees with payload" check fails on a
perfectly valid certificate — which reads as a broken signature. LEARNINGS-music-license-001 L-16. AP-66.

### The Context Split: `ValidateData` sees the bytes, `ValidateExecutor` sees the doken

Neither method sees both. To check "the identity in the payload is the identity signing", you must
capture in one and compare in the other:

```
ValidateData(DataContext ctx)         -> ctx.Data, ctx.DynamicData, ctx.RequestId    (no doken)
ValidateExecutor(ExecutorContext ctx) -> ctx.Doken                                   (no data)
```

Writing `ctx.Data` inside `ValidateExecutor` compiles fine in an editor and fails **on the ORK**:

```
VmHost.CompileFailed: (210,41): error CS1061: 'ExecutorContext' does not contain
a definition for 'Data'
```

**The workable shape** — capture in `ValidateData` (which is documented as running ALWAYS), compare
in `ValidateExecutor`, and DENY if the field was never set. "The identity check did not run" can
only mean refuse:

```csharp
public class Contract : IAccessPolicy
{
    private string _claimedVuid = null;   // captured in ValidateData, read in ValidateExecutor

    public PolicyDecision ValidateData(DataContext ctx)
    {
        _claimedVuid = ExtractVuid(ctx.Data);            // your parsing, fixed offset
        if (string.IsNullOrEmpty(_claimedVuid))
            return PolicyDecision.Deny("No creator vuid in payload");
        return PolicyDecision.Allow();
    }

    public PolicyDecision ValidateExecutor(ExecutorContext ctx)
    {
        // FAIL CLOSED: if ValidateData never ran or never set the field, refuse.
        if (_claimedVuid == null)
            return PolicyDecision.Deny("Identity check did not run");

        var executor = new DokenDto(ctx.Doken);
        return Decision
            .RequireNotExpired(executor)
            .Require(_claimedVuid == executor.UserId, "Signer is not the claimed creator");
    }
}
```

**Compile the contract locally before deploying.** Contracts are compiled by the ORK at request
time, so a shape error surfaces as a 500 *after* an operator approval has been spent. A stub
project with the right SHAPES catches it in under a second — see
[templates/forseti-compile-harness/](../templates/forseti-compile-harness/). Shapes are all that
matter; behaviour is irrelevant, because shape errors are exactly what `VmHost.CompileFailed`
reports. LEARNINGS-music-license-001 L-17. AP-67.

---

## Decision Builder

Chain checks with `Decision.`. First failure stops the chain and returns the deny reason.

### Role Checks

```csharp
Decision
    .RequireRole(doken, "resource", "role")              // client role
    .RequireRole(doken, "admin")                          // realm role (2-arg)
    .RequireAnyRole(doken, "resource", "admin", "mod")   // at least one
    .RequireAllRoles(doken, "resource", "read", "write") // must have all
    .ForbidRole(doken, "resource", "blocked")            // must NOT have
```

### Approval Checks

```csharp
Decision
    .RequireMinWithRole(approvers, 2, "resource", "approver")  // N approvers with role
    .RequireAnyWithRole(approvers, "resource", "approver")     // at least one
    .ForbidSelfApproval(requestorId, approvers)                // no self-approval
    .RequireDistinctOrgs(approvers, 2)                         // from N different orgs
```

### Time Checks

```csharp
Decision
    .RequireWeekday()                    // Mon-Fri
    .RequireBusinessHours()              // Mon-Fri 9-17 UTC
    .RequireHourBetween(9, 17)           // custom hours
    .ForbidHourBetween(0, 6)             // block hours
    .RequireDayOfWeek(DayOfWeek.Monday)  // specific day
```

### Token Checks

```csharp
Decision
    .RequireNotExpired(doken)
    .RequireFromAudience(doken, "my-realm")
    .RequireUserId(doken, "user-123")
```

### Geo Checks

```csharp
var country = ForsetiSdk.Claim("country") as string;
Decision
    .RequireCountry(country, "US", "CA", "AU")
    .ForbidCountry(country, "XX", "YY")
```

### Generic

```csharp
Decision
    .Require(amount <= maxAmount, $"Amount {amount} exceeds limit {maxAmount}")
    .Forbid(isBlacklisted, "User is blacklisted")
```

---

## DokenDto - Token Wrapper

Wrap doken bytes to access user identity, roles, and expiry.

```csharp
// Single executor
var executor = new DokenDto(ctx.Doken);

// List of approvers
var approvers = DokenDto.WrapAll(ctx.Dokens);

// Properties
executor.UserId       // user ID string
executor.Audience     // realm/org
executor.Expiry       // unix timestamp
executor.IsExpired    // bool
executor.IsNull       // bool
executor.HasRole("resource", "admin")    // client role
executor.HasAnyRole("resource", "admin", "mod")
```

---

## [PolicyParam] - Declare Parameters

Parameters are bound automatically from the policy configuration. Declare them as properties with `[PolicyParam]`.

```csharp
[PolicyParam(Required = true, Description = "Role name")]
public string Role { get; set; }

[PolicyParam(Default = 2, Min = 1, Max = 10)]
public int MinApprovers { get; set; }

[PolicyParam(AllowedValues = new[] { "low", "medium", "high" })]
public string Priority { get; set; } = "medium";
```

| Option | Description |
|--------|-------------|
| `Required` | Throws if missing (default: false) |
| `Default` | Default value if not provided |
| `Min` / `Max` | Numeric range validation |
| `AllowedValues` | Enum-like string validation |
| `Description` | Human-readable description |

#### ⚠️ Only `string` and `int` binding are verified. Declare 64-bit values as `string`.

Every documented example binds a `string` or an `int`. **Whether `[PolicyParam]` binds `long`,
`decimal` or `bool` is UNVERIFIED** (GAP-073), and a binding surprise does not fail politely: it
surfaces as a contract failure at request time, **on the ORKs, after an enclave approval has been
spent.**

This matters most for money. Currency amounts in cents overflow `int` quickly — a $21,474,836.48
ceiling is the limit, which is fine for a demo and not for a corporate one.

**Until it is tested, declare 64-bit values as `string` and parse them in the contract:**

```csharp
[PolicyParam(Required = true, Description = "Hard ceiling in cents.")]
public string AbsoluteMaxCents { get; set; }

private static bool TryParseNonNegativeLong(string value, out long result) { /* digit loop */ }
```

A hand-written digit loop also buys **determinism** for free: reject signs, separators, whitespace and
leading zeros, and no culture setting can change what a number means on one ORK versus another.
`long.Parse` with an implicit culture is exactly the kind of thing that produces a 13-of-20 split.

This is a workaround, not an answer. VERIFIED as the safe path; the binding question is open
(LEARNINGS-tidewater-001 L-06).

---

## ForsetiSdk Runtime

Available inside contract methods:

```csharp
ForsetiSdk.Claim("key")   // get a claim value (costs 5 gas)
ForsetiSdk.Log("message") // log output (costs 25 gas)
ForsetiSdk.GasUsed         // current gas consumed
ForsetiSdk.GasLimit        // total gas budget (default 50,000)
```

Gas limit is 50,000. Exceeding it throws `OutOfGasException` and the operation fails.

---

## Deploying a Contract

### Step 1: Upload Contract to TideCloak (scriptable — no enclave)

```
POST /admin/realms/{realm}/iga/forseti-contracts
Content-Type: application/json
Authorization: Bearer <admin-token>

{
  "contractCode": "<C# source code as string>",
  "name": "MyPolicy"
}
```

Requires `manage-realm`. **No enclave and no browser — this step is fully scriptable.** It upserts into the realm's contract library, and max source length is 1,048,576 characters. Companion endpoints: `GET /iga/forseti-contracts`, `GET /iga/forseti-contracts/{id}`, `DELETE /iga/forseti-contracts/{id}` (deleting nulls `CONTRACT_ID` on any referencing policy rows via `ON DELETE SET NULL`).

> ⚠️ **Two different hashes. Do not use the response's `contractHash` as your policy's `contractId`.**
> - The response `contractHash` is **SHA-256** of the source — TideCloak's internal dedup key for the library table only.
> - A policy's **`contractId` is SHA-512 hex** of the exact source, which is what the ORK matches against (`ForsetiContract.Id => Convert.ToHexString(SHA512.HashData(...))`). Built-in contracts instead use `Name + ":" + Version`, e.g. `GenericRealmAccessThresholdRole:1`.
>
> Compute the SHA-512 yourself; never copy it out of this response. VERIFIED against `iga-core` / ORK source 2026-08-07.

Uploading here is optional in the sense that `PolicySignRequest.addForsetiContractToUpload(source)` also carries the source during signing. Prefer the REST upload: it is the seamless path, getting the contract into the realm without a human, so the only remaining manual step is the policy signature.

(Earlier pack revisions said no REST API existed, having tested the legacy `/tide-admin/forseti-contracts` path. That path is gone; the surface moved to `/iga/`.)

### Step 2: Create a Policy Using the Contract

On the JavaScript side, use `Models` from `@tidecloak/js` and `BasicCustomRequest` from `asgard-tide`:

```typescript
import { Models, Tools } from '@tidecloak/js'
const { Policy, ApprovalType, ExecutionType, BaseTideRequest } = Models
const { TideMemory } = Tools

// Create the policy — ALL FIVE required fields must be present
const policy = new Policy({
  version: '3',                                    // Policy.latestVersion; anything else is rejected
  contractId,                                      // SHA-512 hex, UPPERCASE (see below)
  modelId: 'BasicCustom<MyModel>:BasicCustom<1>',  // SINGULAR key; registered id or BasicCustom<...> form
  keyId: vendorId,                                 // a Policy's keyId IS the vendorId
  approvalType: ApprovalType.EXPLICIT,             // or IMPLICIT
  executionType: ExecutionType.PRIVATE,            // or PUBLIC
  params: [
    ['Role', 'data-access'],
    ['Resource', 'my-app'],
  ],
})
```

Important:
- Import `Models` from `@tidecloak/js`, NOT from `@tidecloak/nextjs` (returns `undefined`)
- Import `BasicCustomRequest` from `asgard-tide` for signing requests
- Import `PolicySignRequest` from `heimdall-tide` for policy deployment (alternative flow)
- Policy params must be `[key, value]` pairs, not a plain object (AP-54)

#### The Policy constructor field table

The constructor validates its argument **field by field** and throws a **bare string** (not an
`Error`) on the first mismatch. Validation is sequential, so fixing one mismatch only reveals the
next — a wrong shape costs one round trip per wrong field.

| Field | Type | Notes |
|---|---|---|
| `version` | `string` | Must equal `Policy.latestVersion`, currently `"3"` |
| `contractId` | `string` | SHA-512 of the contract source, **uppercase hex** |
| `modelId` | `string \| string[]` | **Singular** key. String and array produce identical bytes (see Refuted Theories) |
| `keyId` | `string` | **This is the vendorId** |
| `params` | pairs or `PolicyParameters` | `[key, value]` pairs, never a plain object |
| `approvalType` | `ApprovalType` | Not type-checked by the constructor |
| `executionType` | `ExecutionType` | Not type-checked by the constructor |

The throw strings, in the order they fire:

| Thrown string | Missing/wrong field |
|---|---|
| `Version is not a string` | `version` |
| `Breaking changes made to Policies. Update how you create a policy in your application` | `version` present but `!== "3"` |
| `ContractId is not a string` | `contractId` |
| `ModelId is not a string` | `modelId` (note: also thrown when you pass the plural `modelIds`) |
| `KeyId is not a string` | `keyId` |
| `Params is null` | `params` |

**The plural/singular trap**: the constructor reads `data["modelId"]` but populates a class field
named `modelIds`. The plural name is the one visible in editors, logs and `Policy.from()`, so
`modelIds:` looks correct and is silently ignored — you get `ModelId is not a string`, which does
not name the key it wanted.

VERIFIED against `@tideorg/js/dist/Models/Policy.js` (0.14.20) 2026-08-07. LEARNINGS-music-license-001 L-01. AP-60.

> There is no exported `PolicyConfig` type, so apps that dynamically import `Models` hand-write
> their own constructor type — and a hand-written type describing the *intended* shape typechecks
> clean against a call that can never work. If you must write one, write it from
> `Models/Policy.js`'s guard clauses, not from intent. GAP-067, AP-61.

#### `contractId` must be UPPERCASE hex

A policy's `contractId` is the SHA-512 of the exact contract source, hex-encoded, and the ORKs
compare it as a **case-sensitive string**. Node's `createHash("sha512").digest("hex")` is
lowercase; the ORK side uses `Convert.ToHexString(...)`, which is uppercase.

```typescript
const contractId = createHash('sha512').update(contractSource, 'utf8')
  .digest('hex').toUpperCase();       // <- .toUpperCase() once, at the point of computation
```

When wrong the ORKs answer with both values, differing only in case:

```
Policy refers to wrong contract.
  Expected '18013C1917209DF27DF92D06ADF04E02...'
  but policy has '18013c1917209df27df92d06adf04e02...'
```

Assert `/^[0-9A-F]{128}$/` before the id leaves the endpoint. VERIFIED (LEARNINGS-music-license-001 L-14).

Because the id is a hash of the exact source, **any** edit to the contract — even a comment —
invalidates the deployed policy. Compare the deployed policy's `contractId` against a fresh hash
of the contract file at boot or in CI; the same check catches the nastier reverse case, where a
contract is edited *after* deployment and the policy still verifies but no longer describes the
code the ORKs run. (L-19)

#### Model ids are registry keys, not free-form labels

A policy's `modelId` is a lookup key. Nothing client-side validates it; the check happens on
every ORK **after** an operator approval has been spent, and the failure reads:

```
Model id '...' not found in registry
```

The registry is `@tideorg/js/dist/Models/ModelRegistry.js` (`modelBuildersMap`) and it holds
exactly nine models:

| Model id | Purpose |
|---|---|
| `Offboard:1` | Offboarding (leaving the Tide network) |
| `RotateVRK:1` | VRK rotation / licence renewal (builder is named `LicenseSignRequestBuilder`) |
| `TestInit:1` | Test/init flows |
| `Policy:1` | Policy deployment itself — this is the **auth flow** for deploying a policy |
| `HederaTx:1` | Hedera transactions |
| `PolicyEnabledEncryption:1` | Policy-gated encryption |
| `PolicyEnabledDecryption:1` | Policy-gated decryption |
| `ServerCert:1` | Server certificates |
| `AttestationUnit:1` | **IGA governance changes** — NOT arbitrary attestations |

⚠️ **`AttestationUnit:1` is a trap.** It is the obvious thing to reach for in an attestation app
and it is wrong: it carries IGA governance changes (unit types and change-request verbs) and its
human-readable title is literally `"Governance change"`. Borrowing a registered model because its
name fits puts the wrong card in front of whoever approves the request in the enclave.

For anything that is not one of the nine, use the custom form. Custom models are recognised by the
SHAPE of their name, not by registration:

```typescript
import { BasicCustomRequest } from 'asgard-tide'   // NOT BaseTideRequest, NOT @tideorg/js

// Derive all three identities from one constant so they cannot drift
export const MODEL_NAME    = 'MyModel';
export const MODEL_VERSION = '1';
export const MODEL_ID      = `BasicCustom<${MODEL_NAME}>:BasicCustom<${MODEL_VERSION}>`;

const request = new BasicCustomRequest(MODEL_NAME, MODEL_VERSION, 'Policy:1', draftBytes, new Uint8Array(0));
const policy  = new Policy({ modelId: MODEL_ID, /* ... */ });

// Pre-flight assertion — pure client-side, no network, catches the whole class
if (request.id() !== policy.modelIds[0]) throw new Error('model id / request identity drift');
```

`BasicCustomRequest.id()` returns `` `BasicCustom<${this.name}>:BasicCustom<${this.version}>` ``,
so the constructor takes the **unwrapped** name and version while the policy declares the
**wrapped** id. VERIFIED against `asgard-tide/src/models/CustomTideRequest.ts`. Sibling classes
`DynamicPayloadCustomRequest` (`DynamicCustom<...>`) and `DynamicPayloadApprovedCustomRequest`
(`DynamicApprovedCustom<...>`) wrap differently again.

> ⚠️ **Three wrapper conventions exist and they are not the same one.** `BasicCustom<...>` is the
> asgard request identity above. `Custom<...>` is a *different* wrapper, matched in tide-js's
> `ModelRegistry` (`/^Custom<(.*)>$/` → `CustomSignRequestBuilder`), and that is the enclave's
> human-readable RENDERING path, not the ORK's model identity. Reading `CustomSignRequestBuilder._id`
> — which STRIPS the wrapper — and concluding the policy should name the stripped id is a
> documented wrong turn (L-13). Assert `request.id() === policy.modelIds[0]` and let the code
> settle it. GAP-072.

**Two equivalent constructions, and this is why L-13 looked self-contradictory.** The wire `modelId`
is whatever `request.id()` returns (`BaseTideRequest.encode()` writes `"modelId": te.encode(this.id())`):

| Construction | `id()` | Resulting model id |
|---|---|---|
| `new BasicCustomRequest("MyModel", "1", …)` — `asgard-tide` | `` `BasicCustom<${name}>:BasicCustom<${version}>` `` | `BasicCustom<MyModel>:BasicCustom<1>` |
| `new BaseTideRequest("BasicCustom<MyModel>", "BasicCustom<1>", …)` | `name + ":" + version` | `BasicCustom<MyModel>:BasicCustom<1>` |

Both produce the **same** id, so passing **pre-wrapped** name/version to `BaseTideRequest` is
equivalent to passing **raw** name/version to `BasicCustomRequest`. That second form is a legitimate
workaround when `asgard-tide` is not installed — note `BasicCustomRequest` is **not** exported from
the `@tideorg/js` Models barrel (it lives in `dist/Models/CustomTideRequest.js`, unexported), so
`asgard-tide` really is the only import path for it.

✅ **VERIFIED IN PRODUCTION**: a policy with `modelId` `BasicCustom<OriginAttestation>:BasicCustom<1>`,
built via `BaseTideRequest` with pre-wrapped name/version, was accepted and threshold-signed by the
ORK network, and attestations were subsequently signed under it (reference app
`attested-provenance-registry`, 2026-08-07). The `request.id() === policy.modelIds[0]` assertion is
the invariant that matters; which constructor you use is not.

**Custom models carry a display contract too**: `CustomSignRequestBuilder` does
`JSON.parse(draft[0])` and reads `humanReadableName` and `additionalInfo`. A custom request whose
draft slot 0 is raw bytes will not render in the enclave approval UI.

LEARNINGS-music-license-001 L-11, L-13. AP-65.

### Step 3: Deploy the Policy to the ORK Network

Policy deployment requires the realm's **admin policy** to authorize the operation. The admin policy is pre-signed during realm setup (IGA bootstrap) and must be attached to every policy creation request. VERIFIED (LEARNINGS-ratidefy-batch-001 L-22).

**Fetch the admin policy** (server-side, admin bearer token — the signed policy is stored as a role policy). The public `tide-policy-resources/admin-policy` endpoint is not present on current main; retrieve the signed policy bytes from the admin IGA surface instead:
```typescript
// Server-side (admin token required): read the signed role/admin policy.
const rpUrl = `${authServerUrl}/admin/realms/${realm}/iga/role-policies`;
const rolePolicies = await fetch(rpUrl, {
  headers: { Authorization: `Bearer ${adminToken}` },
}).then(r => r.json());
// Each record carries `policy` (base64 signed bytes) + `policySig`.
// The realm admin policy is named `tide-realm-admin` — NOT `admin-policy`.
const matches = rolePolicies.filter(p => p.name === 'tide-realm-admin');
if (matches.length !== 1) {
  throw new Error(`Expected exactly one tide-realm-admin policy, got ${matches.length}`);
}
const adminPolicyBytes = Uint8Array.from(atob(matches[0].policy), c => c.charCodeAt(0));
```

⚠️ **The name is `tide-realm-admin`.** Code that looks for `admin-policy` and falls back to
`policies[0]` works today only because exactly one policy is returned; add a second and it
silently picks the wrong one. Match on the name and fail loudly on a miss or on multiples — never
`?? policies[0]`. VERIFIED against a live realm (LEARNINGS-music-license-001 L-06). AP-63.

**Build and deploy the policy** (browser-side — requires authenticated TideCloak session):
```typescript
const tc = (IAMService as any)._tc;  // Internal TideCloak instance

// 1. Build the policy bytes and contract transport (THREE nested levels — see below)
const policyBytes = policy.toBytes();
const contractSource = `using Ork.Forseti.Sdk;\n\npublic class Contract : IAccessPolicy { ... }`;
const encoder = new TextEncoder();
const innerPayload = TideMemory.CreateFromArray([
  encoder.encode(contractSource),
  encoder.encode("Contract"),        // entry type
]);
const forsetiData = TideMemory.CreateFromArray([new Uint8Array(0), innerPayload]);
const contractTransport = TideMemory.CreateFromArray([
  encoder.encode("forseti"),         // contract TYPE — the level everyone omits
  forsetiData,
]);
const draft = TideMemory.CreateFromArray([policyBytes, contractTransport]);

// 2. Build the request with admin policy
const request = new BaseTideRequest("Policy", "1", "Policy:1", draft);
request.addAuthorizer(dokenBytes);  // Admin's doken
request.policy = new TideMemory(adminPolicyBytes.length);
request.policy.set(adminPolicyBytes);  // CRITICAL — without this, ORK rejects

// 3. Send to ORK network
const signRequest = await tc.createTideRequest(request.encode());

// 4. Operator approval via Tide enclave popup
const result = await tc.requestTideOperatorApproval([
  { id: "policy-deploy", request: signRequest }
]);

// 5. Execute — ORK produces VVK signature
const sigs = await tc.executeSignRequest(result[0].request, true);
const vvkSignature = sigs[0];  // 64-byte Ed25519

// 6. Attach VVK signature to policy and store
policy.signature = new TideMemory(vvkSignature.length);
policy.signature.set(vvkSignature);
const signedPolicyBytes = policy.toBytes();  // Store THESE bytes
```

#### The contract transport is THREE nested levels, and the outermost carries the type

```
contractTransport = [ "forseti",       forsetiData  ]   <- contract TYPE lives here
forsetiData       = [ <empty>,         innerPayload ]
innerPayload      = [ contractSource,  "Contract"   ]   <- entry type
draft             = [ policy.toBytes(), contractTransport ]
```

Build two levels instead of three and every ORK rejects the request:

```
TIDE-TIDEJS-NET-THRESHOLD_FAILURE: Could not reach enough VVK ORKs (0 of 20, 20 failed)
  [TIDE-ORK-INTERNAL-UNEXPECTED] Unknown contract type ''
```

An **empty** contract type, not a wrong one — the ORK read position 0 of a structure one level too
shallow and found the middle level's leading `new Uint8Array(0)`.

**Why this one is expensive**: `TideMemory.CreateFromArray` accepts any nesting, so dropping a
level is not an error anywhere in the client. The structure is positional and untyped, and omitting
the wrapper produces a structure that is still perfectly well-formed. It fails at the **last**
stage — the threshold signature, after the operator has already approved in the enclave — so every
attempt costs a full approval cycle. The mistake is easy because the middle level's leading empty
array looks like a placeholder that belongs at the top.

**Prefer the SDK helper over hand-rolling.** `heimdall-tide`'s `PolicySignRequest` already builds
this nesting correctly:

```typescript
const { PolicySignRequest } = await import('heimdall-tide');
const policyRequest = PolicySignRequest.New(policy).addForsetiContractToUpload(contractSource);
```

VERIFIED against `heimdall-tide@0.14.20` `src/models/PolicySignRequest.ts` — it constructs exactly
the three levels above, with `forsetiType = "forseti"` and `forsetiEntryType = "Contract"`. Four
codebases (`ui-framework`, `ratifiy`, `keylessh`, `music-license`) hand-roll this instead; a shape
four codebases duplicate by hand is a shape the library should own (GAP-069).

**If you must hand-roll it** (see the note below on `BaseTideRequest` vs `PolicySignRequest`),
assert the nesting before submitting — this is a pure client-side check that replaces an enclave
round trip:

```typescript
const decoded = new TideMemory(draft.length); decoded.set(draft);
const type = new TextDecoder().decode(decoded.GetValue(1).GetValue(0));
if (type !== 'forseti') throw new Error(`contract transport type is '${type}', expected 'forseti'`);
```

LEARNINGS-music-license-001 L-09. AP-64.

#### ✅ RESOLVED: `PolicySignRequest` and `BaseTideRequest` are two HALVES of one flow, not alternatives

Earlier pack revisions carried this as an open contradiction — `PolicySignRequest.New(policy)` was
documented as the transport-correct path, while direct `BaseTideRequest` construction was VERIFIED as
necessary for create→approve→execute. **They never disagreed.** Each finding described one half, and
the docs read as a conflict because neither said so.

**VERIFIED END TO END 2026-08-10** against mainnet ORKs (T=14/N=20), producing a stored policy that
parses as TideMemory v1 with a 64-byte Ed25519 signature attached
(LEARNINGS-tidewater-001 L-05):

```typescript
// 1. PolicySignRequest owns the THREE-level contract transport. Do not hand-roll it.
const policyRequest = PolicySignRequest.New(policy).addForsetiContractToUpload(contractSource);
const initialized   = await tc.createTideRequest(policyRequest.encode());

// 2. The enclave approval comes back as an ENCODED request. Decode it with BaseTideRequest and
//    attach the admin policy THERE — after the approval, not before it.
const approval = await tc.requestTideOperatorApproval([{ id: 'policy-deploy', request: initialized }]);
const approved = Models.BaseTideRequest.decode(approval[0].request);
approved.addPolicy(adminPolicyBytes);          // the tide-realm-admin bytes

// 3. Execute.
const signatures = await tc.executeSignRequest(approved.encode(), true);   // 64-byte Ed25519
```

Three details made this work first time, and it is their **combination** that matters — each is
documented separately elsewhere:

- the admin policy is attached to the **approved** request, not the initial one (AP: premature `addPolicy`);
- it is looked up **by name** `tide-realm-admin` with no `?? policies[0]` fallback (AP-63), and the
  base64 is handed to the browser as **text** and decoded there — never decoded and re-encoded server-side;
- `request.id() === policy.modelIds[0]` is asserted client-side before submitting, so the
  `BasicCustom<…>` wrapping question is settled by the code rather than by reasoning (GAP-072).

**Critical notes**:
- Use `tc.createTideRequest()` → `tc.requestTideOperatorApproval()` → `tc.executeSignRequest()` — the React context's `initializeTideRequest` does not expose the approve/execute steps. VERIFIED (LEARNINGS-ratidefy-batch-001 L-24).
- `initializeTideRequest` returns a **new object** — it does NOT mutate in place. If using it, capture the return value (AP-59).
- Store `policy.toBytes()` (with signature attached), NOT `request.encode()` (AP-57).
- Admin policy is fetched server-side (admin bearer) from `/admin/realms/{realm}/iga/role-policies` — the signed bytes live in each record's `policy` field. The old public `tide-policy-resources/admin-policy` endpoint is not present on current main; proxy the fetched bytes to the browser (see RB-008).

### Step 4: Use the Signed Policy

For encryption:
```typescript
const ciphertext = await iam.doEncrypt(
  [{ data: plaintext, tags: ['mytag'] }],
  signedPolicyBytes
)
```

For decryption:
```typescript
const plaintext = await iam.doDecrypt(ciphertext, signedPolicyBytes)
```

The signed policy bytes must be stored (e.g., in your database or fetched via admin API) and provided on every encrypt/decrypt call. The ORKs execute the contract and verify the caller's doken against the policy rules.

---

## Example: Multi-Approver with Time Restriction

```csharp
using Ork.Forseti.Sdk;

public class Contract : IAccessPolicy
{
    [PolicyParam(Required = true)]
    public string ApproverRole { get; set; }

    [PolicyParam(Required = true)]
    public string ApproverResource { get; set; }

    [PolicyParam(Default = 2, Min = 1)]
    public int MinApprovers { get; set; }

    [PolicyParam(Required = true)]
    public string ExecutorRole { get; set; }

    [PolicyParam(Required = true)]
    public string ExecutorResource { get; set; }

    public PolicyDecision ValidateData(DataContext ctx)
    {
        // Only allow operations during business hours
        return Decision
            .RequireWeekday()
            .RequireHourBetween(9, 17);
    }

    public PolicyDecision ValidateApprovers(ApproversContext ctx)
    {
        var approvers = DokenDto.WrapAll(ctx.Dokens);

        return Decision
            .RequireMinWithRole(approvers, MinApprovers, ApproverResource, ApproverRole);
    }

    public PolicyDecision ValidateExecutor(ExecutorContext ctx)
    {
        var executor = new DokenDto(ctx.Doken);

        return Decision
            .RequireNotExpired(executor)
            .RequireRole(executor, ExecutorResource, ExecutorRole);
    }
}
```

---

## Example: Direction-Aware Encryption Contract

```csharp
using Ork.Forseti.Sdk;

public class Contract : IAccessPolicy
{
    [PolicyParam(Required = true)]
    public string EncryptRole { get; set; }

    [PolicyParam(Required = true)]
    public string DecryptRole { get; set; }

    [PolicyParam(Required = true)]
    public string Resource { get; set; }

    public PolicyDecision ValidateData(DataContext ctx)
    {
        return PolicyDecision.Allow();
    }

    public PolicyDecision ValidateApprovers(ApproversContext ctx)
    {
        return PolicyDecision.Allow();
    }

    public PolicyDecision ValidateExecutor(ExecutorContext ctx)
    {
        var executor = new DokenDto(ctx.Doken);

        if (ctx.RequestId == "PolicyEnabledEncryption:1")
        {
            return Decision
                .RequireNotExpired(executor)
                .RequireRole(executor, Resource, EncryptRole);
        }

        if (ctx.RequestId == "PolicyEnabledDecryption:1")
        {
            return Decision
                .RequireNotExpired(executor)
                .RequireRole(executor, Resource, DecryptRole);
        }

        return PolicyDecision.Deny("Unknown operation");
    }
}
```

---

## Pre-Flight Checklist (all client-side, no network)

Run every one of these before submitting a policy. Each replaces a failure that costs a full
deploy cycle, and the expensive ones cost an enclave operator approval because they fail at the
threshold-signature stage.

- [ ] the contract **compiles locally** against the stubs — [templates/forseti-compile-harness/](../templates/forseti-compile-harness/) (L-17)
- [ ] `contractId` matches `/^[0-9A-F]{128}$/` — uppercase SHA-512 hex (L-14)
- [ ] policy `modelId` is one of the nine built-ins, or matches `/^BasicCustom<.+>:BasicCustom<.+>$/` (L-11/L-13)
- [ ] `request.id() === policy.modelIds[0]` — request identity and policy declaration agree (L-13)
- [ ] the encoded draft's `GetValue(1).GetValue(0)` decodes to `"forseti"` (L-09)
- [ ] the deployed policy's `contractId` equals a **fresh hash** of the contract file (L-19)
- [ ] the identity the contract compares is the **vuid**, not the JWT subject (L-16)
- [ ] the admin policy was found by name `tide-realm-admin`, with no `policies[0]` fallback (L-06)
- [ ] all five required Policy fields are present: `version`, `contractId`, `modelId`, `keyId`, `params` (L-01)

---

## Refuted Theories — Do Not Walk These Again

Two plausible diagnoses were chased and disproved. They are recorded so the next person recognises
the dead end instead of repeating it.

### A one-element `modelId` array is NOT the problem

`modelId: ["MyModel:1"]` and `modelId: "MyModel:1"` produce **identical bytes**. The constructor
normalises both to the same value:

```javascript
this.modelIds = typeof data["modelId"] === "string" ? [data["modelId"]] : data["modelId"];
```

...and V3's `toBytes()` always encodes slot 2 as a TideMemory collection regardless. Switching
between the two forms cannot change anything. VERIFIED from `Models/Policy.js`.
(LEARNINGS-music-license-001 L-10, retracted.)

### The ORKs are NOT on the V2 policy layout

The theory: because the ORKs' model-lookup error printed
`System.Collections.ObjectModel.ReadOnlyCollection`1[System.String]` where a model id belongs, the
network must be reading slot 2 as a bare string and receiving a collection — a V2/V3 layout skew.

**Refuted by the network.** Emitting a V2 policy (via a subclass overriding `toBytes()`, since the
version guard only fires when `new.target === Policy`) got `Could not find specified policy
version: 2` from all 20 ORKs. **They are V3-only.** The collection at slot 2 is exactly what they
expect; the `ReadOnlyCollection` text is an ORK-side **message-formatting artifact** that prints
the whole model collection instead of the entry that failed to resolve. The real cause was an
unregistered model id (L-11/L-13). GAP-070 is WITHDRAWN.

**The general lesson, which is the reusable part**: an error quoting a .NET/JVM **type name** where
a value belongs is *not* reliable evidence of a wire-format mismatch. "The error prints the value
it read" was an assumption about the far end's error formatting, not an observation. Byte-level
comparison of what you emit is still the right technique; concluding what the far end read from how
it formats its errors is not. (LEARNINGS-music-license-001 L-12.)

---

## Sandbox Restrictions

Contracts run in a sandboxed VM. The following are blocked:

- File I/O (`System.IO`)
- Network (`System.Net`)
- Threads (`System.Threading`)
- Reflection (`System.Reflection`)
- Process/diagnostics (`System.Diagnostics`)
- Console (`System.Console`)
- Non-deterministic calls (`DateTime.Now`, `Guid.NewGuid`, `Random`)

A contract using a blocked namespace compiles but fails IL vetting with `BadPolicy.ForbiddenCall` at upload time.

Available: `System`, `System.Linq`, `System.Collections.Generic`, `System.Text`, plus SDK types (`Ork.Forseti.Sdk`, `Cryptide`, `Ork.Shared`).

---

## Anti-Patterns

- **Wrong namespace**: Use `using Ork.Forseti.Sdk;` not `using Tide.Ork.Classes.Forseti;` (AP-56)
- **Wrong class name**: Class must be named `Contract` and implement `IAccessPolicy`
- **Wrong context properties**: Use `ctx.Dokens` (not `ctx.Approvers`) in `ValidateApprovers`, `ctx.Doken` (not `ctx.Executor`) in `ValidateExecutor`. Wrap with `DokenDto.WrapAll(ctx.Dokens)` and `new DokenDto(ctx.Doken)`. VERIFIED (LEARNINGS-ratidefy-batch-001 L-23).
- **Params as plain object**: Use `[['Role', 'admin']]` not `{ Role: 'admin' }` (AP-54)
- **Policy with `modelIds`, or without `version`/`keyId`**: the constructor reads singular `modelId` and requires all five fields (AP-60)
- **Hand-written Models type that does not mirror the runtime constructor**: typechecks clean, throws at runtime (AP-61)
- **Two-level contract transport**: the outer `"forseti"` wrapper is required — `Unknown contract type ''` (AP-64)
- **Inventing a model id**: use a registered id or the `BasicCustom<...>` form (AP-65)
- **Binding a contract check to the JWT subject**: a doken has no `sub`; compare the vuid (AP-66)
- **Deploying without compiling locally**: `VmHost.CompileFailed` costs an operator approval (AP-67)
- **Lowercase `contractId`**: the ORKs compare hex case-sensitively — `.toUpperCase()` (L-14)
- **`?? policies[0]` fallback for the admin policy**: match `tide-realm-admin` and fail loudly (AP-63)
- **Reading `ctx.Data` in `ValidateExecutor`**: the contexts are disjoint — capture then compare (L-17)
- **Store request.encode() as policy**: Use `policy.toBytes()` not `request.encode()` (AP-57). Related: AP-55 (don't store raw VVK sig either)
- **Missing admin policy**: Policy deployment requires the realm's admin policy attached to the request. Fetch (admin bearer) from `/admin/realms/{realm}/iga/role-policies` (`policy` field). The old `tide-policy-resources/admin-policy` endpoint is not on current main. (AP, LEARNINGS-ratidefy-batch-001 L-22)
- **JSON to createTideRequest**: Pass `Uint8Array` from `signRequest.encode()` (AP-53)
- **Import BasicCustomRequest from wrong package**: Use `asgard-tide`, not `@tideorg/js` or `@tidecloak/js` (LEARNINGS-ratidefy-batch-001 L-11)
- **Import from @tidecloak/nextjs**: Use `@tidecloak/js` for Models, `heimdall-tide` for PolicySignRequest, `asgard-tide` for BasicCustomRequest
- **Call methods on IAMService**: Use `(IAMService as any)._tc` for `createTideRequest`, `executeSignRequest`
- **Use static IAMService.secureFetch/getToken in React apps**: Use `useTideCloak()` hook instead (AP-58)
- **Assume initializeTideRequest mutates in place**: It returns a new object — capture the return value (AP-59)
- **Check `_tide_*` roles in contract**: Those are voucher gates, not access control. Use regular roles (AP-25)
- **Client-side policy logic**: Forseti runs on ORKs, not in the browser (AP-11)
- **`PolicyDecision.Approve()`**: Does not exist. Use `PolicyDecision.Allow()`

---

## Error Messages

Contract errors propagate to the client as strings:

| Error | Meaning |
|-------|---------|
| `PolicyDecision.Deny("message")` | Contract explicitly denied |
| `BadPolicy.ForbiddenCall:{target}` | Contract used a blocked namespace |
| `BadPolicy.EntryTypeNotFound` | Class `Contract` not found or doesn't implement `IAccessPolicy` |
| `BadPolicy.BudgetExceeded` | Gas limit exceeded |
| `VmHost.Timeout` | Contract took too long |
| `OutOfGasException` | Gas exhausted mid-execution |
| `VmHost.CompileFailed: ... error CS####` | Contract does not compile on the ORK. Compile locally first (L-17) |
| `Unknown contract type ''` | Contract transport is missing the outer `"forseti"` level (L-09) |
| `Model id '...' not found in registry` | `modelId` is not one of the nine built-ins and not `BasicCustom<...>` (L-11/L-13) |
| `Policy refers to wrong contract. Expected 'X' but policy has 'Y'` | Compare X and Y: differ only in **case** → lowercase hex (L-14); differ entirely → contract edited after deploy (L-19) |
| `Could not find specified policy version: 2` | Emitting the V2 layout. The ORKs are V3-only (L-12) |
| `Version is not a string` / `ModelId is not a string` / `KeyId is not a string` / `Params is null` | Client-side Policy constructor, bare-string throw (L-01) |

Full error-text → cause lookup: [troubleshooting.md](troubleshooting.md#error-text-lookup).
