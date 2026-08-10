# Deploy a Custom Forseti Policy to the ORK Network

Take a custom Forseti contract from source to a signed, stored policy.

**This playbook is ORDERED, and the order is the point.** Steps 6, 7 and 8 fail at the **threshold
signature** — after the operator has already approved in the Tide enclave — so every mistake in them
costs a full approval cycle. Steps 1–5 are all local and catch the same failures for free.

**Run the [pre-flight checklist](#pre-flight-checklist) before Step 9. Every item on it replaced a
real deploy cycle.**

Derived from a real deployment (LEARNINGS-music-license-001). Every failure named here was
encountered with a real error message, not predicted.

---

## When to Use

- Deploying a **custom** Forseti contract (your own C# access rules) to the ORK network
- The contract governs a custom model — signing, attestation, provenance, approval
- You have a contract written and need it signed and stored

**Do not use** for:
- Policy-governed E2EE with built-in models → [setup-forseti-e2ee.md](setup-forseti-e2ee.md)
- Simple role-gated multi-approval → use a built-in contract, no custom deployment needed

---

## Prerequisites

- TideCloak realm bootstrapped with IGA enabled and the ORK network connected
- The realm admin policy pre-signed during IGA bootstrap (it is attached to every policy creation)
- `@tidecloak/js`, `heimdall-tide`, `asgard-tide` installed
- An admin user with `tide-realm-admin`, linked to a Tide account (enclave approval needs a human)
- .NET SDK 8.0+ for the local compile harness
- A backend store for the signed policy bytes

---

## Step 1: Mint the admin token INTO the shell, and start the dev server FROM that shell

Reading the realm admin policy needs a master-admin bearer token. It is correctly kept server-side
and out of the repo (AP-41) — but it is delivered through an **exported shell variable**, which does
not survive a server restart, in a project where restarting the dev server is routine.

```bash
eval "$(bash scripts/admin-token.sh)"    # exports the admin token into THIS shell
npm run dev                              # must be started FROM this shell
```

Start the dev server any other way and the admin-policy route returns **503**.

### ⚠️ The token lives SIXTY SECONDS — do not use an exported shell variable for a browser flow

**Measured, not assumed** — `client_id=admin-cli` against `/realms/master/protocol/openid-connect/token`:

```
expires_in: 60        # and exp - iat == 60
```

VERIFIED against `tideorg/tidecloak-dev:latest` 2026-08-10 (LEARNINGS-agent-quorum-001 L-14). "Does
not survive a server restart" badly understates it: **it does not survive sixty seconds.**

That is fine for a script that immediately makes its call, and **useless for a browser flow** where an
operator loads a page and then clicks a button. By the time you read the error, re-export and click
again, the replacement may also be dead. The failure is:

```
HTTP 401 {"error":"HTTP 401 Unauthorized"}
```

...which reads as a **permissions** problem and sends you to check role grants. It is not.

**For any flow with a human in it, mint on demand server-side instead:**

- read `KC_ADMIN_USER` / `KC_ADMIN_PASSWORD` from the **server** environment
- mint per request and cache with a ~5s safety margin
- treat an upstream **401 as "mint fresh and retry once"**, never as an auth failure to report — a
  token that looks locally valid can still be revoked or left over from a previous container, so
  checking `exp` client-side is not sufficient

Verify the recovery path deliberately: start with a real token in env, **wait 68 seconds**, then call
the route. It should return the policy bytes with no intervention.

**Security note, stated honestly**: this puts operator credentials in a server process, which is what
AP-41 warns about. It is defensible for local development and should be labelled as such. The
mitigating detail: this credential sits **outside** the Forseti-protected path — it fetches a policy
document and cannot be used to satisfy a deployment quorum.

⚠️ The token usually appears in `.env.example` as an empty key, which reads like "optional". It is
not optional for this flow. Make the requirement loud:

- The policy-deployment page must check for the token **before** building anything, and say so.
- Surface the server's actual error, not a generic one — see Step 5.

*(L-05, L-14)*

---

## Step 2: Compile the contract locally

Contracts are compiled **by the ORK at request time**. A typo surfaces as `VmHost.CompileFailed`
after an approval has been spent.

```bash
cd templates/forseti-compile-harness
./check.sh ../../src/contracts/MyContract.cs
```

This catches the whole class of shape errors in about a second, including the one that is easiest to
write and hardest to predict:

```
VmHost.CompileFailed: (210,41): error CS1061: 'ExecutorContext' does not contain
a definition for 'Data'
```

**The context split**: `ValidateData` sees `ctx.Data`, `ValidateExecutor` sees `ctx.Doken`, and
**neither sees both**. To compare payload identity against signer identity, capture in
`ValidateData` (which always runs), compare in `ValidateExecutor`, and **DENY if the field was never
set** — "the identity check did not run" can only mean refuse. See
[custom-contracts.md](../canon/custom-contracts.md#the-context-split-validatedata-sees-the-bytes-validateexecutor-sees-the-doken).

**Identity must be the vuid, never the JWT subject.** A doken carries no `sub`; `DokenDto.UserId`
returns `Payload.Vuid`. A contract comparing a subject denies every signature (AP-66).

**Then assert the contract still says what your app claims.** Compiling proves it is valid C#; it
does not prove the app and the contract agree. A custom-contract app has two implementations of the
same rules and drift between them is silent:

```bash
cp -r templates/forseti-parity-tests tests/parity   # once
node --test tests/parity/contract-parity.test.mjs
```

Catches, with no network: a `[PolicyParam]` the policy never supplies (fails at request time, after an
approval), renumbered wire fields, a missing fail-closed guard, an identity check bound to a subject
instead of the vuid, a blocked namespace, a misordered ladder, and a **deployed policy that no longer
matches the contract source**. See [templates/forseti-parity-tests/](../templates/forseti-parity-tests/).

*(L-17, L-16, AP-67, and LEARNINGS-tidewater-001 L-07)*

---

## Step 3: Compute the contractId — UPPERCASE SHA-512

```typescript
const contractId = createHash('sha512')
  .update(contractSource, 'utf8')
  .digest('hex')
  .toUpperCase();               // <- REQUIRED. Do this once, server-side.

if (!/^[0-9A-F]{128}$/.test(contractId)) throw new Error('contractId must be uppercase hex');
```

Node's `digest("hex")` is lowercase. The ORKs compare the hash as a **case-sensitive string** and
answer with both values, differing only in case:

```
Policy refers to wrong contract.
  Expected '18013C1917209DF27DF92D06ADF04E02...'
  but policy has '18013c1917209df27df92d06adf04e02...'
```

⚠️ Hash the **exact bytes you submit as contract source**. Any edit — even a comment — invalidates a
deployed policy (see Step 11).

> Do **not** use the `contractHash` from the contract-upload response as your `contractId`. That is
> **SHA-256**, TideCloak's internal dedup key. The policy's `contractId` is **SHA-512**.

*(L-14, L-19)*

---

## Step 4: Choose a valid model id, and derive everything from one constant

A `modelId` looks like a free-form label. It is a **lookup key** into a fixed nine-model registry
(`@tideorg/js/dist/Models/ModelRegistry.js`, `modelBuildersMap`), and nothing client-side validates
it — the check runs on every ORK after an operator approval:

```
Model id '...' not found in registry
```

The nine built-ins: `Offboard:1`, `RotateVRK:1`, `TestInit:1`, `Policy:1`, `HederaTx:1`,
`PolicyEnabledEncryption:1`, `PolicyEnabledDecryption:1`, `ServerCert:1`, `AttestationUnit:1`.

⚠️ **Do not borrow `AttestationUnit:1` for an attestation app.** It carries IGA governance changes
and its enclave card title is literally `"Governance change"` — it would put the wrong thing in front
of your approver.

For a custom model, use `BasicCustomRequest` from `asgard-tide` and derive all three identities from
one constant so they cannot drift:

```typescript
import { BasicCustomRequest } from 'asgard-tide';   // NOT BaseTideRequest, NOT @tideorg/js

export const MODEL_NAME    = 'MyModel';
export const MODEL_VERSION = '1';
export const MODEL_ID      = `BasicCustom<${MODEL_NAME}>:BasicCustom<${MODEL_VERSION}>`;
```

`BasicCustomRequest.id()` returns `` `BasicCustom<${name}>:BasicCustom<${version}>` ``, so the
constructor takes the **unwrapped** name/version and the policy declares the **wrapped** id.

> ⚠️ `Custom<...>` is a **different** wrapper — tide-js's enclave *rendering* path. Do not reason
> from `CustomSignRequestBuilder._id` (which strips the wrapper) to what the policy should declare;
> that is a documented wrong turn. Let the assertion in the pre-flight settle it: `request.id()` must
> equal `policy.modelIds[0]`. (GAP-072)

**Custom models also carry a display contract**: `draft` slot 0 must be JSON with
`humanReadableName` and `additionalInfo`, or the request will not render in the enclave approval UI.

*(L-11, L-13, AP-65)*

---

## Step 5: Build the Policy with ALL FIVE required fields

```typescript
import { Models } from '@tidecloak/js';       // NOT @tidecloak/nextjs — returns undefined
const { Policy, ApprovalType, ExecutionType } = Models;

const policy = new Policy({
  version: '3',              // Policy.latestVersion; anything else is rejected outright
  contractId,                // uppercase SHA-512 from Step 3
  modelId: MODEL_ID,         // SINGULAR key. Passing `modelIds` is silently ignored
  keyId: vendorId,           // a Policy's keyId IS the vendorId
  approvalType: ApprovalType.IMPLICIT,     // or EXPLICIT
  executionType: ExecutionType.PRIVATE,    // or PUBLIC
  params: [['Role', role], ['Resource', resource]],   // pairs, never a plain object
});
```

The constructor validates **field by field** and throws a **bare string** (not an `Error`) on the
first mismatch, so fixing one only reveals the next — a wrong shape costs one round trip per wrong
field:

| Thrown string | Cause |
|---|---|
| `Version is not a string` | `version` missing |
| `Breaking changes made to Policies...` | `version` present but `!== "3"` |
| `ContractId is not a string` | `contractId` missing |
| `ModelId is not a string` | `modelId` missing — **or you passed plural `modelIds`** |
| `KeyId is not a string` | `keyId` missing |
| `Params is null` | `params` missing |

**The plural trap**: the constructor reads `data["modelId"]` but populates a field named `modelIds`,
so the plural is what appears in editors, logs and `Policy.from()`. There is no exported
`PolicyConfig` type, so a hand-written mirror describing the *intended* shape typechecks clean
against a call that can never work (GAP-067, AP-61). Write any mirror from `Models/Policy.js`'s guard
clauses.

*(L-01, L-02, AP-60)*

---

## Step 6: Upload the contract source (scriptable — no enclave)

```
POST /admin/realms/{realm}/iga/forseti-contracts
Authorization: Bearer <admin-token>
Content-Type: application/json

{ "contractCode": "<C# source>", "name": "MyPolicy" }
```

Requires `manage-realm`. **No enclave, no browser — fully scriptable.** Prefer this: it gets the
contract into the realm without a human, leaving the policy signature as the only manual step.

---

## Step 7: Build the contract transport — THREE nested levels

**Prefer the SDK helper.** `heimdall-tide` already builds this correctly:

```typescript
const { PolicySignRequest } = await import('heimdall-tide');
const policyRequest = PolicySignRequest.New(policy).addForsetiContractToUpload(contractSource);
```

VERIFIED against `heimdall-tide@0.14.20`. Four codebases hand-roll this instead (GAP-069).

If you must hand-roll it, the shape is:

```
contractTransport = [ "forseti",        forsetiData  ]   <- contract TYPE lives here
forsetiData       = [ <empty>,          innerPayload ]
innerPayload      = [ contractSource,   "Contract"   ]   <- entry type
draft             = [ policy.toBytes(), contractTransport ]
```

```typescript
const encoder = new TextEncoder();
const innerPayload = TideMemory.CreateFromArray([
  encoder.encode(contractSource),
  encoder.encode('Contract'),
]);
const forsetiData = TideMemory.CreateFromArray([new Uint8Array(0), innerPayload]);
const contractTransport = TideMemory.CreateFromArray([
  encoder.encode('forseti'),       // the level everyone omits
  forsetiData,
]);
const draft = TideMemory.CreateFromArray([policy.toBytes(), contractTransport]);
```

Build two levels instead of three and every ORK rejects:

```
TIDE-TIDEJS-NET-THRESHOLD_FAILURE: Could not reach enough VVK ORKs (0 of 20, 20 failed)
  [TIDE-ORK-INTERNAL-UNEXPECTED] Unknown contract type ''
```

An **empty** type — the ORK read position 0 of a structure one level too shallow and found the middle
level's leading `new Uint8Array(0)`. `TideMemory.CreateFromArray` accepts any nesting, so nothing
client-side objects, and it fails **after** the enclave approval.

*(L-09, AP-64)*

---

## Step 8: Fetch the realm admin policy — the name is `tide-realm-admin`

Policy deployment requires the realm's admin policy attached to the request, or the ORKs reject it.
Fetch it **server-side** (admin bearer token):

```typescript
// STRIP THE TRAILING SLASH. The exported adapter has "auth-server-url": "http://localhost:8080/",
// so naive concatenation yields a double slash and TideCloak rejects it with
//   400 {"error":"missingNormalization","error_description":"Request path not normalized"}
// — an error that names neither the URL nor the slash, and reads like a body/API-version problem.
const base = authServerUrl.replace(/\/+$/, '');
const url = `${base}/admin/realms/${realm}/iga/role-policies`;
const policies = await fetch(url, {
  headers: { Authorization: `Bearer ${adminToken}` },
}).then(r => r.json());

// The name is `tide-realm-admin` — NOT `admin-policy`.
const matches = policies.filter(p => p.name === 'tide-realm-admin');
if (matches.length !== 1) {
  throw new Error(`Expected exactly one tide-realm-admin policy, got ${matches.length}`);
}
const adminPolicyBytes = Uint8Array.from(atob(matches[0].policy), c => c.charCodeAt(0));
```

⚠️ **Never `?? policies[0]`.** Code looking for `admin-policy` and defaulting to index 0 works today
only because exactly one policy is returned; add a second and it silently deploys under the wrong
authority. A named lookup that misses is a bug, not a case to default through (AP-63).

#### If `role-policies` returns `200 []`, nothing is broken — you have not granted `tide-realm-admin` yet

An empty array is currently indistinguishable from a broken endpoint, and it is neither. **The
`tide-realm-admin` policy is created as part of granting `tide-realm-admin` to the first admin.** On a
fully bootstrapped, licensed, IGA-enabled realm with roles, users and a committed contract, you will
still get `[]` until that grant is committed.

This collides with the hosting canon's ordering rule (AP-HOST-5: grant `tide-realm-admin` **last**,
because committing it flips the realm to multiAdmin). Both rules are correct, and together they mean:

> You cannot deploy a Forseti policy until you have granted `tide-realm-admin`, and granting it is a
> **one-way door** into multiAdmin. Plan every other governed write to happen **before** it — and
> expect the policy deployment itself to be a post-flip, enclave-approved operation.

VERIFIED (LEARNINGS-agent-quorum-001 L-09). See [hosting-options.md](../canon/hosting-options.md) AP-HOST-5.

⚠️ **Decode the base64.** Passing the base64 *text* as bytes yields `[65, 81, 65, 65, ...]` (ASCII
for `"AQAA..."`) and the ORK cannot parse it.

**Surface the server's error to the client.** This route returns a genuinely useful body for each of
three distinct failures — no token, expired token, unbootstrapped realm — and
`if (!response.ok) throw new Error("<static text>")` throws all three away. Read `body.error` and
append it; fall back to the status code:

```typescript
if (!res.ok) {
  const body = await res.json().catch(() => ({}));
  throw new Error(body.error ?? `admin policy fetch failed: HTTP ${res.status}`);
}
```

*(L-06, L-07, AP-63)*

---

## Pre-Flight Checklist

**Run all of it before Step 9.** Every item is client-side, needs no network, and each one replaced a
full deploy cycle — several of which cost an enclave operator approval.

- [ ] contract **compiles locally** against the stubs (Step 2)
- [ ] the **parity tests pass** — app and contract still agree, and the deployed `contractId` still
      matches the source (Step 2, `templates/forseti-parity-tests/`)
- [ ] `contractId` matches `/^[0-9A-F]{128}$/` (Step 3)
- [ ] `modelId` is one of the nine built-ins, or matches `/^BasicCustom<.+>:BasicCustom<.+>$/` (Step 4)
- [ ] `request.id() === policy.modelIds[0]` — request identity and policy declaration agree (Step 4)
- [ ] the encoded draft's `GetValue(1).GetValue(0)` decodes to `"forseti"` (Step 7)
- [ ] all five Policy fields present: `version`, `contractId`, `modelId`, `keyId`, `params` (Step 5)
- [ ] the admin policy was found by name `tide-realm-admin`, with no `policies[0]` fallback (Step 8)
- [ ] the identity the contract compares is the **vuid**, not the JWT subject (Step 2)
- [ ] the admin token is present in the dev server's environment (Step 1)

```typescript
// Transport assertion — three lines, replaces an enclave round trip
const d = new TideMemory(draft.length); d.set(draft);
const type = new TextDecoder().decode(d.GetValue(1).GetValue(0));
if (type !== 'forseti') throw new Error(`transport type '${type}', expected 'forseti'`);

// Model id assertion
if (request.id() !== policy.modelIds[0]) throw new Error('model id / request identity drift');
```

---

## Step 9: Submit to the ORK network and approve in the enclave

```typescript
const tc = (IAMService as any)._tc;      // the React provider DOES initialize _tc (AP-58)

// Attach the admin policy — without this the ORK rejects
const request = new BaseTideRequest('Policy', '1', 'Policy:1', draft);
request.addAuthorizer(dokenBytes);
request.policy = new TideMemory(adminPolicyBytes.length);
request.policy.set(adminPolicyBytes);

const signRequest = await tc.createTideRequest(request.encode());

// Operator approval — a HUMAN approves in the Tide enclave popup
const result = await tc.requestTideOperatorApproval([
  { id: 'policy-deploy', request: signRequest },
]);
```

**This is the expensive gate.** Everything downstream of it costs an approval to retry.

If the popup fails with `Popup DPoP verification failed to load`, the app's `tide_dpop_auth.html` is
stale — it posts to `window.parent`, which is self-referential in a popup. Fixed copies use
`window.opener || window.parent`. The blank popup is **normal** (the page is script-only), and the
page returned HTTP 200. See AP-62 / GAP-068. Also confirm no other dev server has taken port 3000 and
is serving its own `public/` (L-08).

*(L-03, L-04, L-08)*

---

## Step 10: Execute, attach the signature, store `policy.toBytes()`

```typescript
const sigs = await tc.executeSignRequest(result[0].request, true);
const vvkSignature = sigs[0];                      // 64-byte Ed25519

policy.signature = new TideMemory(vvkSignature.length);
policy.signature.set(vvkSignature);

const signedPolicyBytes = policy.toBytes();        // <- STORE THESE
```

- Store `policy.toBytes()` **with the signature attached** — not the raw signature (AP-55), and not
  `request.encode()`, which includes the auth envelope (AP-57).
- If `initializeTideRequest` is used anywhere, capture its **return value** — it does not mutate in
  place (AP-59).

---

## Step 11: Verify the deployment, and keep verifying

Add a boot/CI check comparing the deployed policy's `contractId` against a **fresh hash** of the
contract file:

```typescript
const deployed = Policy.from(storedPolicyBytes);
const fresh = createHash('sha512').update(readFileSync(CONTRACT_PATH, 'utf8')).digest('hex').toUpperCase();
if (deployed.contractId !== fresh) {
  throw new Error(`Policy is stale: deployed ${deployed.contractId.slice(0,12)}… vs source ${fresh.slice(0,12)}…`);
}
```

Three lines, and it turns "signing mysteriously broke" into "you edited the contract and did not
redeploy". It also catches the nastier reverse case: a contract edited **after** deployment, where
the policy still verifies but no longer describes the code the ORKs run.

*(L-19)*

---

## Verification

| Check | Expected |
|---|---|
| `./check.sh <contract>` | exit 0 |
| `/^[0-9A-F]{128}$/.test(contractId)` | true |
| `request.id() === policy.modelIds[0]` | true |
| draft `GetValue(1).GetValue(0)` | `"forseti"` |
| Admin policy lookup | exactly one match named `tide-realm-admin` |
| Enclave approval card | shows YOUR model's `humanReadableName`, not "Governance change" |
| `executeSignRequest` | returns a 64-byte Ed25519 signature |
| Stored bytes | `Policy.from(stored)` round-trips with `signature` present |
| Boot check | deployed `contractId` equals a fresh hash of the contract file |

---

## Common Failures

Keyed by the error text you will actually see. Full table:
[troubleshooting.md](../canon/troubleshooting.md#error-text-lookup).

| Error | Cause | Step |
|---|---|---|
| `Version is not a string` | Policy missing `version` (then `ContractId`, `ModelId`, `KeyId`, `Params` in turn) | 5 |
| `ModelId is not a string` | passed plural `modelIds` | 5 |
| `Unknown contract type ''` | transport built with 2 levels, not 3 | 7 |
| `Model id '...' not found in registry` | unregistered model id | 4 |
| `Could not find specified policy version: 2` | emitting the V2 layout — the ORKs are **V3-only** | 5 |
| `Policy refers to wrong contract` | differ only in case → lowercase hex (3); differ entirely → contract edited (11) | 3 / 11 |
| `VmHost.CompileFailed` | contract does not compile — compile locally | 2 |
| `Popup DPoP verification failed to load` | stale `tide_dpop_auth.html`, or wrong app on port 3000 | 9 |
| `Could not fetch the realm admin policy` | usually no admin token in the dev server's shell — surface `body.error` | 1 / 8 |
| 503 from the admin-policy route | dev server not started from the token-bearing shell | 1 |
| Contract denies every signature | comparing the JWT subject; a doken has no `sub` | 2 |

---

## Anti-Patterns

- **Skipping the local compile** — a typo costs an operator approval (AP-67)
- **`modelIds`, or a Policy missing `version`/`keyId`** (AP-60)
- **Hand-written Models type not mirroring the constructor** — typechecks, throws (AP-61)
- **Two-level contract transport** (AP-64)
- **Inventing a model id**, or borrowing `AttestationUnit:1` (AP-65)
- **`?? policies[0]`** when the named admin-policy lookup misses (AP-63)
- **Binding a contract check to the JWT subject** rather than the vuid (AP-66)
- **Lowercase `contractId`** (L-14)
- **Discarding the server's error body** and reporting a generic message (L-07)
- **Storing `request.encode()`** or the raw signature instead of `policy.toBytes()` (AP-57, AP-55)
- **Committing the admin token** to make Step 1 easier — it is an operator credential (AP-41)

---

## Refuted — do not walk these

- A one-element `modelId` **array is not the problem**. The constructor normalises string and array
  to the same value and V3 always encodes a collection — **identical bytes** either way.
- The ORKs are **not** on the V2 policy layout. They answered `Could not find specified policy
  version: 2`. The `ReadOnlyCollection` text in their model-lookup error is an ORK-side
  message-formatting artifact. **General lesson**: an error quoting a .NET/JVM **type name** is not
  reliable evidence of a wire-format mismatch. GAP-070 WITHDRAWN.

Reasoning kept in [custom-contracts.md](../canon/custom-contracts.md#refuted-theories--do-not-walk-these-again).

---

## References

- [canon/custom-contracts.md](../canon/custom-contracts.md) — contract API, Policy field table, transport nesting, model registry
- [canon/troubleshooting.md](../canon/troubleshooting.md#error-text-lookup) — error-text lookup
- [canon/verifiable-claims.md](../canon/verifiable-claims.md) — if the policy issues signed claims a third party must verify
- [templates/forseti-compile-harness/](../templates/forseti-compile-harness/) — local compile harness (Step 2)
- [setup-forseti-e2ee.md](setup-forseti-e2ee.md) — policy-governed E2EE with built-in models
- Source: `notes/test-findings/LEARNINGS-music-license-001.md`
