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

### Step 1: Upload Contract to TideCloak (Optional)

```
POST /admin/realms/{realm}/iga/forseti-contracts
Content-Type: application/json
Authorization: Bearer <admin-token>

{
  "contractCode": "<C# source code as string>",
  "name": "MyPolicy"
}
```

The ORK compiles the contract in its sandbox and stores it. The response carries the stored contract's `contractHash` (`SHA512(source code)`).

Note: This endpoint may not be available on all TideCloak images. If it returns 404/405, the contract is deployed through the policy signing flow (Step 3) instead — the contract source is included in the contract transport.

### Step 2: Create a Policy Using the Contract

On the JavaScript side, use `Models` from `@tidecloak/js` and `BasicCustomRequest` from `asgard-tide`:

```typescript
import { Models, Tools } from '@tidecloak/js'
const { Policy, ApprovalType, ExecutionType, BaseTideRequest } = Models
const { TideMemory } = Tools

// Create the policy
const policy = new Policy({
  contractId: contractHash,  // SHA512 of the C# source
  modelIds: ['MyModel:1'],
  approvalType: ApprovalType.EXPLICIT,   // or IMPLICIT
  executionType: ExecutionType.PRIVATE,   // or PUBLIC
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
const adminPolicyB64 = rolePolicies.find(p => p.name === 'admin-policy')?.policy;
const adminPolicyBytes = Uint8Array.from(atob(adminPolicyB64), c => c.charCodeAt(0));
```

**Build and deploy the policy** (browser-side — requires authenticated TideCloak session):
```typescript
const tc = (IAMService as any)._tc;  // Internal TideCloak instance

// 1. Build the policy bytes and contract transport
const policyBytes = policy.toBytes();
const contractSource = `using Ork.Forseti.Sdk;\n\npublic class Contract : IAccessPolicy { ... }`;
const contractTransport = TideMemory.CreateFromArray([
  new Uint8Array(0),  // empty bytes
  TideMemory.CreateFromArray([
    new TextEncoder().encode(contractSource),
    new TextEncoder().encode("Contract"),  // entry type
  ]),
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

**Critical notes**:
- Use `BaseTideRequest` directly, NOT `PolicySignRequest` from `heimdall-tide` — the full flow requires direct ORK interaction. VERIFIED (LEARNINGS-ratidefy-batch-001 L-24).
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
