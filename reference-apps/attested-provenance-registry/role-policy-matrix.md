# Role-Policy Matrix — Attested Provenance Registry

## Tide bootstrap roles

| Role | Purpose | Attached policy | Created by | Approved by | Required before first use | Default / optional | Notes |
|------|---------|----------------|------------|-------------|--------------------------|-------------------|-------|
| `_tide_enabled` | Enables Tide operations for the user | None (gate role) | Realm template | N/A (declared in `realm.json`) | Yes | Default | Must be declared in `realm.json`. Not auto-created by `setUpTideRealm`. |
| `tide-realm-admin` | Full realm administration; needed to read the signed admin policy | N/A | Bootstrap script | N/A (first admin) | Yes (at least one) | Required | Client role on `realm-management`, **not** a realm role. Check with `hasClientRole`, not `hasRealmRole` (AP-29). |

## Application roles

Both are **client roles on the app's own OIDC client**, not realm roles.

| Role | Purpose | Attached policy | Created by | Approved by | Required before first use | Default / optional | Notes |
|------|---------|----------------|------------|-------------|--------------------------|-------------------|-------|
| `<attest-role>` | Authorizes threshold-signing an attestation. The Forseti contract's `SigningRole` param | The custom attestation policy | Realm template | Tide realm admin via IGA | Yes | **In the realm default-roles composite** | Every user receives it at creation, so any authenticated user can attest their own content. Reference app: `origin-attest`. |
| `<admin-role>` | Deploy the attestation policy; read the realm admin policy proxy | None (checked server-side only) | Realm template | Tide realm admin via IGA | Only for policy deployment | **Deliberately NOT a default role** | Granted explicitly to the bootstrap admin. Reference app: `origin-admin`. |
| `appUser` | Standard application user | None | Realm template | N/A (in default-roles) | No | Default (realm role) | Convenience marker for ordinary users. |

### Why the attest role is a realm default here

In most scenarios a signing role is granted per resource, per user. Here the claim is about the
user's **own** content, so gating it behind an approval would mean no user could ever register
anything without an admin. Putting it in the `default-roles-<realm>` composite is the correct
default for this scenario — and it is why `ValidateApprovers` returns `Allow`.

The admin role is the opposite: it must **not** be a default, because it gates the one-time policy
deployment that the whole app depends on.

## Required protocol mappers

These are not optional. The `vuid` mapper is load-bearing for the security property.

| Mapper | Type | User attribute | Claim | Why |
|---|---|---|---|---|
| `Tide vuid` | `oidc-usermodel-attribute-mapper` | `vuid` | `vuid` | **REQUIRED.** The contract binds authorship to the vuid, and the browser must read it to build the envelope. Without this claim the envelope cannot be built and the fail-closed guard refuses every attestation — correctly, but confusingly if you do not know why. |
| `Tide User Key` | `oidc-usermodel-attribute-mapper` | `tideUserKey` | `tideuserkey` | Identity linkage. |
| `audience (self)` | `oidc-audience-mapper` | — | `aud` | Adds the client to `aud` so server-side JWT verification can check audience. |

Set `access.token.claim`, `id.token.claim`, `userinfo.token.claim`, `introspection.token.claim` and
`lightweight.claim` to `true` on the attribute mappers, so the claim survives every surface the app
reads.

Client attribute `dpop.bound.access.tokens: "true"` is also required, paired with
`useDPoP: { mode: 'strict', alg: 'ES256' }` in the provider config.

## The custom Forseti policy

One policy, deployed once, covering the attestation model.

| Field | Value | Notes |
|---|---|---|
| `version` | `"3"` | Must equal `Policy.latestVersion`. The ORKs are V3-only |
| `contractId` | SHA-512 of the contract source, **UPPERCASE hex** | The ORKs compare case-sensitively. `/^[0-9A-F]{128}$/` |
| `modelId` | `BasicCustom<Name>:BasicCustom<Version>` | **Singular** key. Must equal the request's `id()` |
| `keyId` | the **vendorId** | A Policy's `keyId` IS the vendorId |
| `approvalType` | `IMPLICIT` | No operator popup per attestation. `EXPLICIT` only if each claim needs an approver |
| `executionType` | `PRIVATE` | |
| `params` | `[key, value]` **pairs** | Never a plain object (AP-54) |

### Policy parameters → `[PolicyParam]` bindings

| Parameter | Type | Required | Bound to | Purpose |
|---|---|---|---|---|
| `SigningRole` | string | Yes | `<attest-role>` | The client role `ValidateExecutor` requires |
| `SigningResource` | string | Yes | the app's client id (`getResource()`) | What the role is checked against |
| `MaxClockSkewSeconds` | int | No (`Default = 10`, `Min = 1`, `Max = 60`) | app constant | Tunable per deployment **without changing the contract hash** |

Putting the skew window in a `[PolicyParam]` rather than a `const` is deliberate: changing a
constant changes the source, which changes the SHA-512 `contractId`, which invalidates the deployed
policy and costs a fresh enclave approval.

## What each validator checks

| Validator | Runs when | Checks |
|---|---|---|
| `ValidateData` | **Always** | Envelope magic; declared lengths match actual byte count; oversize rejection; claim/content type codes in range; content hash not all-zero; **timestamp within skew of `Utils.GetEpochSeconds()`**. Also **captures the signer vuid** for the executor check |
| `ValidateApprovers` | `ApprovalType.EXPLICIT` | `Allow` — a claim about one's own content needs no third-party quorum. Joint-work and multi-rights-holder approval are separate contracts with their own thresholds |
| `ValidateExecutor` | `ExecutionType.PRIVATE` | `RequireNotExpired`; `RequireRole(SigningResource, SigningRole)`; **the captured vuid was set** (fail closed); **the captured vuid equals `DokenDto.UserId`** |

## Key rules

1. `_tide_enabled` must be declared in `realm.json` — it is not auto-created.
2. The attest role and admin role are **client roles** on the app's OIDC client.
3. The attest role belongs in the `default-roles-<realm>` composite; the admin role must not.
4. `tide-realm-admin` is a client role on `realm-management`. Use `hasClientRole` (AP-29).
5. The `vuid` protocol mapper is **required**, not optional.
6. **`DokenDto.UserId` is the vuid.** A doken carries no OIDC `sub`. Binding a contract check to
   `sub` denies every attestation (AP-66).
7. The signed policy must be deployed and stored before any user can attest. Surface that state.
8. Role assignment changes go through IGA change requests; roles appear in the token after the next
   refresh (up to 120s).
9. The contract source and the wire format must be pinned together by a test. Moving an offset in
   one without the other produces `Not an <app> attestation envelope` from every ORK.
10. Editing the contract at all — even a comment — changes the SHA-512 and **invalidates the
    deployed policy**. Compare the deployed `contractId` against a fresh hash at boot or in CI.

## Contract transport structure

The policy-deployment draft is:

1. Policy bytes (`policy.toBytes()`)
2. Contract transport — **three** nested levels:

```
[ "forseti", [ <empty>, [ contractSource, "Contract" ] ] ]
```

Prefer `PolicySignRequest.New(policy).addForsetiContractToUpload(source)` from `heimdall-tide`,
which builds this correctly. Omitting the outer `"forseti"` level yields `Unknown contract type ''`
from every ORK — **after** the enclave approval (AP-64, GAP-069).

## Signing request identity

The policy's `modelId` and the request's identity must agree, and there are two equivalent ways to
get there:

| Construction | `id()` returns | Model id |
|---|---|---|
| `new BasicCustomRequest("Name", "1", ...)` from `asgard-tide` | `BasicCustom<Name>:BasicCustom<1>` | same |
| `new BaseTideRequest("BasicCustom<Name>", "BasicCustom<1>", ...)` | `name + ":" + version` | same |

`BaseTideRequest.id()` is `name + ":" + version`, and the wire `modelId` is `id()`. So passing
**pre-wrapped** name/version to `BaseTideRequest` is equivalent to passing **raw** name/version to
`BasicCustomRequest`. The reference app uses the second form because `BasicCustomRequest` is not
exported from the `@tideorg/js` Models barrel — it lives in `asgard-tide`.

Whichever you choose, assert it: `request.id() === policy.modelIds[0]`. Pure client-side, and it
settles the question before an approval is spent (GAP-072).
