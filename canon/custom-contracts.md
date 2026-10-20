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
| `SimpleTagBasedDecryption:1` | Executor has realm role `_tide_{tag}.encrypt` / `.decrypt` for **every** tag | none (tags from the data) |
| `RelationshipAttestation:1` | Encrypt/decrypt only: every tag equals `assignmentId`; policy `roles` grants the operation; executor holds `_tide_encryptor` / `_tide_decryptor` **and** matches the subject (`User` key, `Group` in `groups`, or `Role`) | `subjectType`, `subjectId`, `assignmentId`, `roles` (JSON array string), optional `clientId` |

The two threshold-role contracts validate **approvers** only. The two encryption contracts validate
the data's tags and the **executor**, require `ExecutionType.PRIVATE`, and accept only
`PolicyEnabledEncryption:1` / `PolicyEnabledDecryption:1`. For signing, or anything beyond these
rules, write a custom contract (deployment is done by the Tide team).

**`RelationshipAttestation:1` availability:** ORK `main` (VERIFIED from source `c69fc4f6`,
2026-10-16). It is the **default** for "who may encrypt or decrypt this record": check it before
writing any custom contract. A `Group` subject needs the access-token claim
named exactly **`groups`** (mandated); its values must equal `subjectId` exactly. Full guide:
`reference-apps/relationship-attestation`. VERIFIED (source).

---

## Contract Template

Every contract must:
- Have a class named `Contract`
- Implement `IAccessPolicy`
- Open with **all six** using directives below

### ⚠️ SIX using directives are required, not one

`using Ork.Forseti.Sdk;` alone does not compile a real contract. `GetValue`/`TryGetValue` are
extension methods, `Utils` lives in `Cryptide.Tools`, `ctx.Policy`'s enums live in
`Ork.Shared.Models.Contracts`, and you need `System.Text` for `Encoding` and
`System.Collections.Generic` for the `List<string>` you will use to thread state. Copy the block
verbatim — both working reference contracts open with exactly these, in this order:

```csharp
using Ork.Forseti.Sdk;
using Cryptide.Tools;
using Ork.Shared.Models.Contracts;
using System;
using System.Collections.Generic;
using System.Text;

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

### `ctx.Data` is a nested byte structure — not a collection, not a flat buffer

This is the single most commonly invented API in a Forseti contract, and the ORK's compiler is the
first thing that tells you. There is **no `DataItem` type**. `ctx.Data` holds a **nested TideMemory
structure**, walked with two extension methods.

**Its declared type is `byte[]?`** (and so is `ctx.DynamicData`). SETTLED 2026-10-07 from the ORK
source, `Ork.Forseti.Sdk/Contracts/IAccessPolicy.cs`, which agrees with the two ORK-proven contracts
that only compile against a reference type (see `templates/forseti-compile-harness/README.md`).
Earlier revisions of this section said `ReadOnlyMemory<byte>`. The walking helpers `GetValue` /
`TryGetValue` extend `ReadOnlyMemory<byte>`, so the style below — assign to a `ReadOnlyMemory<byte>`
first — is still the one to write: it compiles under either typing, and it is what every vendored
contract does. **`ctx.Data` can be null**; check before walking it.

```csharp
ReadOnlyMemory<byte> data = ctx.Data;

var inner = data.GetValue(1);                              // positional child
for (int i = 2; inner.TryGetValue(i, out var tag); i++)    // probe until absent
{
    DataTags.Add(Encoding.UTF8.GetString(tag.Span));       // leaf -> text via .Span
}
```

| You might write | Reality |
|---|---|
| `foreach (DataItem d in ctx.Data)` | ❌ no such type |
| `ctx.Data[0]` | compiles (it is a `byte[]`) but gives you one raw byte, not a child — use `data.GetValue(0)` |
| `byte[] b = ctx.Data` | compiles, but the helpers are on `ReadOnlyMemory<byte>` — assign to that instead |
| `Encoding.UTF8.GetString(leaf)` on a child | ❌ a child is a `ReadOnlyMemory<byte>`: pass `leaf.Span` |
| `ctx.Dokens` / `ctx.Doken` as bytes | ❌ they are typed `Doken` objects; wrap with `new DokenDto(ctx.Doken)` / `DokenDto.WrapAll(ctx.Dokens)` |

VERIFIED against two working, deployed contracts (`forseti-crypto-quickstart`,
`tidecloak-test-cases`), both vendored in `sources/`.

#### Encrypt and decrypt have DIFFERENT payload layouts

The tag offsets are not the same, and nothing in the request tells you except `ctx.RequestId`:

| Request | Outer layout | Tags start at |
|---|---|---|
| `PolicyEnabledEncryption:1` | `GetValue(0)` = time, `GetValue(1)` = first encryption request | index **2** of the inner value |
| `PolicyEnabledDecryption:1` | `GetValue(0)` = first decryption request | index **3** of the inner value |

```csharp
if (ctx.RequestId == "PolicyEnabledEncryption:1")
{
    var time  = data.GetValue(0);
    var first = data.GetValue(1);
    for (int i = 2; first.TryGetValue(i, out var tag); i++) { /* tags */ }
}
else if (ctx.RequestId == "PolicyEnabledDecryption:1")
{
    var first = data.GetValue(0);
    for (int i = 3; first.TryGetValue(i, out var tag); i++) { /* tags */ }
}
else return PolicyDecision.Deny("This contract handles only encryption/decryption requests");
```

Reading the wrong offset silently collects the wrong strings as "tags" — a contract that then allows
or denies on garbage. **Branch on `ctx.RequestId` first**, and deny anything you did not expect.

To reject multi-payload requests, probe the **outer** structure — and note the asymmetry, which
follows from the layouts above: encryption's second item is at outer index 2, decryption's at 1.

```csharp
if (data.TryGetValue(2, out var _)) return PolicyDecision.Deny("one item per encryption");  // encrypt
if (data.TryGetValue(1, out var _)) return PolicyDecision.Deny("one item per decryption");  // decrypt
```

#### `ctx.Policy` — assert the policy shape the contract assumes

`DataContext` also exposes the governing policy, and both references use it to refuse a policy that
does not match their design:

```csharp
if (ctx.Policy.ExecutionType != ExecutionType.PRIVATE ||
    ctx.Policy.ApprovalType  != ApprovalType.EXPLICIT)
    return PolicyDecision.Deny("Policy used against this contract must be EXPLICIT PRIVATE");
```

Worth copying: a contract written for a quorum is dangerous under `IMPLICIT`, and this is a one-line
guard against being deployed the wrong way.

#### A decision cannot be inspected

There is **no `IsAllowed`** on `PolicyDecision` or on the `Decision` chain (on ORK `main` `PolicyDecision` does expose `Allowed` and `Error`, but no vendored contract relies on them). `Decision.RequireX(...)`
chains **return** the decision — you return it, you never interrogate it:

```csharp
return Decision.RequireNotExpired(executor).RequireRole(executor, Role);   // ✅
if (someDecision.IsAllowed) { … }                                          // ❌ no such member
```

If you need branching, branch on your own state before building the decision (as the Cola reference
does with `ApproverSuccessfulRole`).

#### `ValidateApprovers` is optional

`IAccessPolicy` requires only `ValidateData`. The `forseti-crypto-quickstart` reference implements
`ValidateData` + `ValidateExecutor` and **omits `ValidateApprovers` entirely**. Implement it only when
you need a quorum — and remember it runs **only** under `ApprovalType.EXPLICIT`.

⚠️ Because it is optional, a **misspelled** override (`ValidateExecuter`) compiles and the real
method is never yours. Pin method presence with the parity tests
([templates/forseti-parity-tests/](../templates/forseti-parity-tests/)).

**What an unimplemented stage does — DIFFERS ON `main`.** On ORK `main` the interface defaults are
**Deny** (`"ValidateApprovers not implemented"` / `"ValidateExecutor not implemented"`), so a missing
or misspelled method **fails closed** whenever that stage runs: a PRIVATE policy with
`ValidateExecuter` denies every request. The compile harness stub defaults to Allow, so it will not
show you this. Implement all three methods explicitly and never rely on a default either way.

### Per-resource capabilities are IGA-governed — so binding to one costs an approval per share

A natural design for fine-grained E2EE is a **per-resource capability**: the contract demands proof
that the caller holds a capability for *this specific* note/record, so access is enforced by the
network rather than by the app.

The catch is issuance. Anything the contract can verify has to be something the **network** knows
about, and creating it is a **governed change** — so on an IGA realm **every share needs a human
enclave approval**. That is fine for a handful of long-lived grants and unusable for ordinary sharing.

**The honest trade-off, and how to keep the option open:**

| Enforced by | What the contract validates | Cost per share |
|---|---|---|
| **Network** (per-resource capability) | that the caller holds a capability naming this resource | one enclave approval |
| **Contract + app ACL** (usual choice) | operation type, tag structure, id format, participation role | none |

The workable pattern is to put the **structural** checks in the contract — which cannot be bypassed by
a compromised backend — and leave per-resource access to the app's ACL, then **say so explicitly**.
Keep the capability check behind a single parameter (e.g. an empty `ReadCapabilityTemplate`) so
flipping one string re-enables full binding if per-resource capabilities ever become cheaply issuable:

```csharp
[PolicyParam(Required = false, Description = "Capability template; empty disables per-resource binding")]
public string ReadCapabilityTemplate { get; set; }

// ...
if (!string.IsNullOrEmpty(ReadCapabilityTemplate))
{
    // network-enforced per-resource binding
}
// else: structural checks only — per-resource access is enforced by the app ACL (documented limit)
```

⚠️ **Document the limit where a reader will hit it, not only in an architecture note.** A contract that
looks like it binds per-resource access but does not is worse than one that never claimed to — and the
gap is invisible in the contract's *name*. State it in the contract source, in the app's docs, and in
any security write-up.

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
using Ork.Forseti.Sdk;
using Cryptide.Tools;
using Ork.Shared.Models.Contracts;
using System;
using System.Collections.Generic;
using System.Text;

public class Contract : IAccessPolicy
{
    private string _claimedVuid = null;   // captured in ValidateData, read in ValidateExecutor

    public PolicyDecision ValidateData(DataContext ctx)
    {
        _claimedVuid = ExtractVuid(ctx.Data);
        if (string.IsNullOrEmpty(_claimedVuid))
            return PolicyDecision.Deny("No creator vuid in payload");
        return PolicyDecision.Allow();
    }

    // Your parsing. ctx.Data is a nested ReadOnlyMemory<byte>: walk it with GetValue/TryGetValue
    // and read a leaf as text via .Span. Adjust the index to wherever YOUR encoder writes the vuid.
    private static string ExtractVuid(ReadOnlyMemory<byte> data)
    {
        return data.TryGetValue(0, out var leaf) ? Encoding.UTF8.GetString(leaf.Span) : null;
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
    .RequireDistinctOrgs(approvers, 2)                         // ⚠️ see below — cannot pass today
```

⚠️ **`RequireDistinctOrgs(approvers, N)` with N ≥ 2 denies every request.** It counts distinct
doken `Audience` values, and the ORK already requires every approver doken's audience to equal the
same user/key id, so the distinct count is always 1. `Audience` is the VVK id, not a realm name.
VERIFIED 2026-10-07 from ORK `main` (`DecisionBuilder.cs`, `PolicyAuthorizationFlow.cs`). Do not use
it to express "approvers from different organisations".

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

### Geo Checks — not a real control

```csharp
var country = ForsetiSdk.Claim("country") as string;
Decision
    .RequireCountry(country, "US", "CA", "AU")
    .ForbidCountry(country, "XX", "YY")
```

⚠️ **This does not check where the caller is.** `ForsetiSdk.Claim(key)` reads the policy's own
**parameters**, not anything about the request or the user, and `ForbidCountry` passes when the value
is null or empty. There is no geo source on this path. VERIFIED 2026-10-07 from ORK `main`
(`Ork.Forseti.VmHost/Program.cs`, `DecisionBuilder.cs`). Never present a contract using these as a
location restriction.

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

#### ⚠️ `long` and `decimal` never bind. Declare 64-bit values as `string`.

Binding needs an **exact type match** against the policy's wire types: `str`→`string`, `num`→`int`,
`bnum`→`System.Numerics.BigInteger`, `bln`→`bool`, `byt`→`byte[]`. So `string`, `int`, `bool`,
`BigInteger` and `byte[]` bind; **`long` and `decimal` never do.** A `Required` one throws
`PolicyParam.Missing`; a non-required one **silently keeps its default**. Read from ORK `main`
2026-10-07 (`Ork.Shared/Models/Contracts/Policy.cs`); this answers GAP-073 from source, not from a
run. A binding surprise does not fail politely: it surfaces at request time, **on the ORKs, after an
enclave approval has been spent.**

This matters most for money. Currency amounts in cents overflow `int` quickly — a $21,474,836.48
ceiling is the limit, which is fine for a demo and not for a corporate one.

**Declare 64-bit values as `string` (or `BigInteger`) and parse them in the contract:**

```csharp
[PolicyParam(Required = true, Description = "Hard ceiling in cents.")]
public string AbsoluteMaxCents { get; set; }

private static bool TryParseNonNegativeLong(string value, out long result) { /* digit loop */ }
```

A hand-written digit loop also buys **determinism** for free: reject signs, separators, whitespace and
leading zeros, and no culture setting can change what a number means on one ORK versus another.
`long.Parse` with an implicit culture is exactly the kind of thing that produces a 13-of-20 split.

VERIFIED as the safe path (LEARNINGS-tidewater-001 L-06).

---

## ForsetiSdk Runtime

Available inside contract methods:

```csharp
ForsetiSdk.Claim("key")   // get a claim value (costs 5 gas)
ForsetiSdk.Log("message") // log output (costs 25 gas)
ForsetiSdk.GasUsed         // current gas consumed
ForsetiSdk.GasLimit        // total gas budget (default 50,000)
```

Gas limit is 50,000. Exceeding it fails the operation (`Policy.Throw: Out of gas`). Only SDK calls are charged against it (`Claim` 5, `Log` 25); on ORK `main` the bound that actually stops a runaway contract is the wall-clock limit, about 10 seconds, reported as `VmHost.Timeout`.

---

## Deploying a Contract


> _Withheld: uploading a custom Forseti contract is done by the Tide team (experimental, test networks only). Do not reconstruct this step._

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

> This is the **client's** registry — what the enclave can render. The ORK checks model ids against
> its own registries, which also accept `"any"` (a wildcard when it is the first id) and ids not
> listed here such as `EnableOffboard:1`, `SelfDecrypt:1`, `TideSelfEncryption:1`.
>
> **Policy version — DIFFERS ON `main`.** This pack teaches `version: '3'` and "the ORKs are
> V3-only", measured against the live network in August 2026. On `main`, both `tide-js` and `ork`
> set `Policy.latestVersion` to **`"4"`** (v4 adds an optional expiry) while still reading v3;
> published `@tideorg/js` builds up to 0.14.25 still say `"3"`. Do not hardcode either: pass
> `Policy.latestVersion` from the SDK you have installed.

| Model id | Purpose |
|---|---|
| `Offboard:1` | Offboarding (leaving the Tide network) |
| `RotateVRK:1` | VRK rotation / licence renewal (builder is named `LicenseSignRequestBuilder`) |
| `TestInit:1` | Test/init flows |
| `Policy:1` | Policy deployment itself — this is the **auth flow** for deploying a policy |
| `HederaTx:1` | Hedera transactions |
| `PolicyEnabledEncryption:1` | Policy-gated encryption |
| `PolicyEnabledDecryption:1` | Policy-gated decryption |
| `ServerCert:1` | Server certificates. ⚠️ Present in this client-side registry but **absent from ORK `main`**; a policy naming it fails there |
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

### TWO consumers read the request, and they key off DIFFERENT fields

This is the whole reason the wrapper question is confusing, and it is the thing to understand before
choosing a construction.

| Consumer | Reads | Source |
|---|---|---|
| **ORK network** | `request.id()` | `BaseTideRequest.encode()` writes `"modelId": te.encode(this.id())` |
| **Enclave approval card** | the raw `name` / `version` **fields** | `ModelRegistry.getHumanReadableModelBuilder` |

VERIFIED, `@tideorg/js/dist/Models/ModelRegistry.js`:

```javascript
const r = BaseTideRequest.decode(data);              // a BaseTideRequest, NOT your subclass
const nameMatch    = r.name.match(/^Custom<(.*)>$/)?.[1];
const versionMatch = r.version.match(/^Custom<(.*)>$/)?.[1];
if (nameMatch && versionMatch) return new CustomSignRequestBuilder(data, reqId, context);
const c = modelBuildersMap[r.id()];                  // r.id() here is name + ":" + version
if (!c) throw new TideError({ code: MODEL_UNKNOWN_MODEL, … });
```

Two consequences that are not obvious:

- `decode` returns a **`BaseTideRequest`**, so `r.id()` is `name + ":" + version` — **not** your
  subclass's wrapped `id()`. The card path never sees `BasicCustomRequest.id()`.
- the regex is **anchored**, so `BasicCustom<X>` does **not** match `/^Custom<(.*)>$/` —
  `BasicCustom<` does not start with `Custom<`.

**So the raw `name` must be `Custom<...>`-wrapped for the card to render, while `id()` must be
`BasicCustom<...>`-shaped for the ORKs to resolve the model.** Those are different fields, and one
request can satisfy both.

### ⚠️ CORRECTION: the two constructions are NOT interchangeable

An earlier revision of this file called these "two equivalent constructions" because both yield the
same `id()`. **That was wrong** — they differ in the raw `name` field, which is exactly what the card
reads:

| Construction | raw `name` encoded | `id()` | ORK | Card |
|---|---|---|---|---|
| `new BasicCustomRequest("MyModel", "1", …)` | `MyModel` | `BasicCustom<MyModel>:BasicCustom<1>` | ✅ | ❌ |
| `new BaseTideRequest("BasicCustom<MyModel>", "BasicCustom<1>", …)` | `BasicCustom<MyModel>` | `BasicCustom<MyModel>:BasicCustom<1>` | ✅ | ❌ |
| **`new BasicCustomRequest("Custom<MyModel>", "Custom<1>", …)`** | `Custom<MyModel>` | `BasicCustom<Custom<MyModel>>:BasicCustom<Custom<1>>` | ✅ | ✅ |

The first two produce an identical `modelId` and **both fail the approval card** — they only look
equivalent because the ORK path is the only one most apps exercise.

### The rule

> **`ApprovalType.IMPLICIT`** (no card): either of the first two forms works. This is the shape
> VERIFIED in production — `BasicCustom<OriginAttestation>:BasicCustom<1>` was accepted and
> threshold-signed, with attestations signed under it (reference app
> `attested-provenance-registry`, 2026-08-07).
>
> **`ApprovalType.EXPLICIT`** (a card is built, and it is the **only** way `ValidateApprovers` runs —
> i.e. the only way to have a multi-approver contract at all): construct with **`BasicCustomRequest`**
> and pass the name/version **pre-wrapped in `Custom<...>`**. The policy then declares the
> double-wrapped `BasicCustom<Custom<X>>:BasicCustom<Custom<1>>`.

`BaseTideRequest` cannot substitute in the EXPLICIT case: it writes the already-wrapped name into the
raw field, so `id()` loses the outer `BasicCustom<...>` and the ORKs stop resolving it.

**Assert both consumers**, because each failure costs an approval and neither error names the other:

```typescript
if (!/^Custom<.+>$/.test(MODEL_NAME))                        throw new Error('card will not render');
if (!/^BasicCustom<.+>:BasicCustom<.+>$/.test(request.id())) throw new Error('ORKs will not resolve it');
if (request.id() !== policy.modelIds[0])                     throw new Error('model id drift');
```

### Status: what is measured vs. predicted

| Claim | Status |
|---|---|
| `BasicCustom<X>:BasicCustom<1>` is accepted by the ORKs (IMPLICIT) | ✅ **NETWORK-VERIFIED** 2026-08-07 |
| A bare `Custom<X>:Custom<1>` model id is **rejected** by all 20 ORKs | ✅ **NETWORK-VERIFIED** 2026-08-11 — cost one enclave approval |
| The card requires the raw `name` to match `/^Custom<(.*)>$/` | ✅ **SOURCE-VERIFIED** (`ModelRegistry.js`) |
| `BasicCustom<Custom<X>>:BasicCustom<Custom<1>>` is accepted by the ORKs | ⚠️ **PREDICTED, NOT YET NETWORK-VERIFIED** — it satisfies the `BasicCustom<…>` shape the ORKs are known to accept, but the double wrap itself has not been signed |

So GAP-072 is **narrowed, not closed**: the dead end is now measured, the mechanism is source-verified,
and the recommended shape is a prediction awaiting one successful EXPLICIT deployment. Treat the
double wrap as the best-supported choice and keep the two assertions above so a wrong guess fails
client-side.

`BasicCustomRequest` is **not** exported from the `@tideorg/js` Models barrel (it lives in
`dist/Models/CustomTideRequest.js`, unexported), so `asgard-tide` is its only import path — install it
rather than reaching for `BaseTideRequest` when the flow is EXPLICIT.

⚠️ **Do not copy keylessh's constructor arguments.** It passes `name = "BasicCustom<SSH>"` into
`BasicCustomRequest`, yielding `BasicCustom<BasicCustom<SSH>>:BasicCustom<BasicCustom<1>>`. The
pre-wrap is right; the **inner token is wrong** — it must be `Custom<...>`, not `BasicCustom<...>`.
keylessh is IMPLICIT, so no card is ever built and the difference never surfaces there (AP-77).

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

// (withheld: the contract is uploaded by the Tide team, not from here)
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


> _Withheld: uploading a custom Forseti contract is done by the Tide team (experimental, test networks only). Do not reconstruct this step._

#### ✅ RESOLVED: `PolicySignRequest` and `BaseTideRequest` are two HALVES of one flow, not alternatives

Earlier pack revisions carried this as an open contradiction — `PolicySignRequest.New(policy)` was
documented as the transport-correct path, while direct `BaseTideRequest` construction was VERIFIED as
necessary for create→approve→execute. **They never disagreed.** Each finding described one half, and
the docs read as a conflict because neither said so.

**VERIFIED END TO END 2026-08-10** against mainnet ORKs (T=14/N=20), producing a stored policy that
parses as TideMemory v1 with a 64-byte Ed25519 signature attached
(LEARNINGS-tidewater-001 L-05):


> _Withheld: uploading a custom Forseti contract is done by the Tide team (experimental, test networks only). Do not reconstruct this step._


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

        // ⚠️ DIFFERS ON `main`: on ORK `main`, ExecutorContext (and ApproversContext) have no
        // `RequestId` — only DataContext does — so this line is CS1061 there. If the ORK rejects
        // it, decide the direction in ValidateData and keep it in a field, as the next section shows.
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

## Two ways to attest something

"Attest" means: the network signs a statement with the realm's key, after a contract agrees this
signer may make it. A fact that was "a row says so" becomes "the network signed it, and it still
verifies". There are two shapes. Pick by **what the statement is about and who checks it later**.

| | Attestation (policy-as-attestation) | Provenance (custom payload) |
|---|---|---|
| About | **people**: membership, assignment, consent, verification, approval, sharing, delegation | **content**: who made it, when |
| The signed thing | a **policy** whose parameters are the statement | your own binary envelope |
| Request | `Policy:1`, authorised by an IMPLICIT/PRIVATE signing rule | `BasicCustom<X>:BasicCustom<V>` |
| Contract inspects | the policy being signed (`ctx.Data` → model ids, params, expiry) | the envelope bytes |
| Time | not attested; an expiry is enforced by your server | the ORK's own clock, within a skew window |
| Checked later by | **your own server**, by rebuilding the bytes from a row | **a third party**, from a portable certificate |
| Scenario | `attestation` | `attested-provenance-registry` |
| Template | `templates/attestation/` | scenario docs |

**Who may issue** is the design decision in the first shape, and the contract enforces it:

| Mode | The network requires | Proves |
|---|---|---|
| `self` | subject = issuer = the signer | the person said this about themselves (the only mode that proves agreement) |
| `owner` | owner = issuer = the signer | the owner of the thing said this |
| `role` | the signer holds a named role, and is the issuer | someone authorised said this, and who |

Rules common to both shapes:

- **The signer's credential is the whole check**, so the contract is mostly about what to refuse.
  Under an IMPLICIT rule nobody approves anything. Keep each rule narrow: the claim types that share
  one answer to "who may issue", and nothing more.
- **`IMPLICIT` must come with `PRIVATE`.** Implicit and public needs no credential at all.
- **Identify people by vuid**, and bind the signer: compare `DokenDto.UserId` with the identity the
  statement names. The executor stage has no `RequestId` and no `Data`, so capture what it needs in
  `ValidateData` and fail closed if that never ran.
- **A signature is over bytes.** Store inputs and signature; rebuild and verify. Never store the bytes.
- **An attestation authorises nothing.** Give it a model id no real request carries, and refuse it
  if it is ever presented as one.

## Sandbox Restrictions

Contracts run in a sandboxed VM. The following are blocked:

- File I/O (`System.IO`)
- Network (`System.Net`)
- Threads (`System.Threading`)
- Reflection (`System.Reflection`)
- Process/diagnostics (`System.Diagnostics`)
- Console (`System.Console`)
- Non-deterministic calls (`DateTime.Now`, `Guid.NewGuid`, `Random`, `Stopwatch`, `Environment.TickCount`)
- Interop and emit (`System.Runtime.InteropServices`, `System.Reflection.Emit`, `Microsoft.Win32`, P/Invoke, `Unsafe`)

A contract using a blocked namespace compiles but fails IL vetting with `BadPolicy.ForbiddenCall` at upload time.

**Three things that compile, look harmless, and are rejected.** VERIFIED 2026-10-07 from the ORK's IL
vetter (`Ork.Forseti.Shared/Security/IlVetter.cs`); the local compile harness does not catch them:

- **Lambdas and method groups.** They emit `ldftn`, which is banned. That rules out LINQ with a
  lambda (`approvers.Where(a => ...)`, `.Any(x => ...)`) and `Decision.Require(() => ...)`. Write
  loops. The SDK's own source notes that it "avoids LINQ which is blocked by IL vetter".
- **Static constructors** — which includes any `static` field with an initialiser
  (`static readonly string[] Allowed = {...}`). Use `const`, or build the value inside the method.
- **`[ModuleInitializer]`**, `calli`, `localloc`.

Available: `System`, `System.Collections.Generic`, `System.Text`, plus SDK types (`Ork.Forseti.Sdk`, `Cryptide`, `Ork.Shared`). `System.Linq` is referenced, but in practice only its lambda-free calls survive vetting.

---

## Anti-Patterns

- **Wrong namespace**: Use `using Ork.Forseti.Sdk;` not `using Tide.Ork.Classes.Forseti;` (AP-56)
- **Wrong class name**: Class must be named `Contract` and implement `IAccessPolicy`
- **Wrong context properties**: Use `ctx.Dokens` (not `ctx.Approvers`) in `ValidateApprovers`, `ctx.Doken` (not `ctx.Executor`) in `ValidateExecutor`. Wrap with `DokenDto.WrapAll(ctx.Dokens)` and `new DokenDto(ctx.Doken)`. VERIFIED (LEARNINGS-ratidefy-batch-001 L-23).
- **Params as plain object**: Use `[['Role', 'admin']]` not `{ Role: 'admin' }` (AP-54)
- **Policy with `modelIds`, or without `version`/`keyId`**: the constructor reads singular `modelId` and requires all five fields (AP-60)
- **Hand-written Models type that does not mirror the runtime constructor**: typechecks clean, throws at runtime (AP-61)
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
| `BadPolicy.BudgetExceeded:Methods/Instructions` | The contract exceeds an IL size budget. Not a gas error |
| `BadPolicy.Interface: ...` / `IlVetter.Failed: ...` | Vetting rejected the assembly (lambda, static constructor, wrong interface) |
| `PolicyParam.Missing: ...` / `PolicyParam.Validation: ...` | A `[PolicyParam]` did not bind — check the type is one of `string`, `int`, `bool`, `BigInteger`, `byte[]` |
| `VmHost.Timeout` | Contract took too long (about 10 s wall clock) |
| `Policy.Throw: Out of gas` | SDK-call gas exhausted mid-execution |
| `Forseti policy denied (<stages>): <err> (gas: N)` | How a contract's own denial arrives at the client |
| `Policy expired at <n>` | The policy carries an expiry and it has passed |
| `Model does not have a policy passed with it` / `Policy supplied has not been signed` | No policy attached / attached without a signature. Two different omissions |
| `VmHost.CompileFailed: ... error CS####` | Contract does not compile on the ORK. Compile locally first (L-17) |
| `Model id '...' not found in registry` | `modelId` is not one of the nine built-ins and not `BasicCustom<...>` (L-11/L-13) |
| `Policy refers to wrong contract. Expected 'X' but policy has 'Y'` | Compare X and Y: differ only in **case** → lowercase hex (L-14); differ entirely → contract edited after deploy (L-19) |
| `Could not find specified policy version: 2` | Emitting the V2 layout. The ORKs are V3-only (L-12) |
| `Version is not a string` / `ModelId is not a string` / `KeyId is not a string` / `Params is null` | Client-side Policy constructor, bare-string throw (L-01) |

Full error-text → cause lookup: [troubleshooting.md](troubleshooting.md#error-text-lookup).
