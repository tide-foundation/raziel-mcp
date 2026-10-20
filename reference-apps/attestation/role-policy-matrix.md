# Role-Policy Matrix — Attestation

## If the built-in contract covers the fact

For an admin-granted relationship between a user, group or role and one record, none of the roles or rules below
are needed. Use `relationship-attestation`:

| Need | Role | Policy |
|---|---|---|
| read the record | realm role `_tide_decryptor` | one per user and record, `roles` includes `_tide_decryptor` |
| write to the record | realm role `_tide_encryptor` | one per user and record, `roles` includes `_tide_encryptor` |
| grant either | `tide-realm-admin` | approves each policy in the enclave |

Everything from here down is for the custom contract.

## Tide bootstrap roles

| Role | Type | Assigned to | Purpose |
|---|---|---|---|
| `_tide_enabled` | realm, default composite | every user | funds ORK operations (voucher gate) |
| `tide-realm-admin` | realm-management client | first admin, granted last | signs the rule's change request |

## Application roles

| Role | Type | Needed when | Purpose |
|---|---|---|---|
| `appUser` | client, default | always | ordinary access |
| `<IssuerRole>` e.g. `compliance:verify`, `team:manage` | client, NOT default | `role` rules only | may make that kind of attestation about anyone |

**`self` and `owner` rules need no issuer role.** The check is identity: the signer's vuid must
equal the statement's `Issuer` (and `Subject`, or `Owner`). Do not invent a role for them — a role
would let every holder attest for everyone.

## Required protocol mappers

| Mapper | Type | Attribute → claim | Why |
|---|---|---|---|
| Tide vuid | `oidc-usermodel-attribute-mapper` | `vuid` → `vuid` | every statement names people by vuid |
| Tide User Key | `oidc-usermodel-attribute-mapper` | `tideUserKey` → `tideuserkey` | builds the doken |

Stock mapper types only. There is no `tide-*` mapper (AP-80).

## The two policies

| | The signing rule | An attestation |
|---|---|---|
| How many | **one per kind of issuer** (a handful per realm) | one per fact |
| Model id | `Policy:1` | `BasicCustom<Attestation>:BasicCustom<1>` |
| Approval / execution | `IMPLICIT` / `PRIVATE` | written as `IMPLICIT` / `PRIVATE` |
| Parameters | `Resource`, `Claims`, `IssuerMode`, `IssuerRole`, `AllowExpiry` | `Claim`, `Issuer`, `Subject`, `Resource`, optional `Object`, `Owner`, `Value` |
| Signed by | admins, once, via a change request | the issuer's own browser, no approval |
| Authorises | signing an attestation of the listed claim types | **nothing** |
| Stored | in the realm (`/iga/role-policies`) | only its signature, on your row |

### Rule parameters → `[PolicyParam]` bindings

| Parameter | Type | Required | Default | Notes |
|---|---|---|---|---|
| `Resource` | `string` | yes | — | the client id; an attestation for any other is refused |
| `Claims` | `string` | yes | — | comma-separated claim types this rule may sign; exact match |
| `IssuerMode` | `string` | no | `self` | `self`, `owner` or `role` |
| `IssuerRole` | `string` | no | `""` | required when `IssuerMode` is `role` |
| `AllowExpiry` | `string` | no | `no` | `yes` lets an attestation carry an expiry |

### Which rule for which claim

| Rule | `--claims` | `--mode` | Example |
|---|---|---|---|
| Things people say about themselves | `consented,accepted` | `self` | consent, acceptance |
| Things people say about what they own | `member-of,shared-with,delegate` | `owner` | close friends, sharing |
| Things an authorised person says | `assigned` | `role --role team:manage` | team and case assignment |
| A different authority | `verified` | `role --role compliance:verify` | identity or age checks |

One rule per **role**: two claim types guarded by different roles need two rules.

`string` only. `long` and `decimal` parameters never bind (see `canon/custom-contracts.md`).

## What each validator checks

| Validator | Checks |
|---|---|
| `ValidateData` | request is `Policy:1`; rule is `IMPLICIT` + `PRIVATE`; exactly one model, the attestation; only the known string fields, each once, non-empty, ≤ 256 chars; `Claim` listed on the rule; `Resource` matches the rule; an expiry only if `AllowExpiry` is `yes`. `self`: `Subject == Issuer`, no `Owner`. `owner`: `Owner == Issuer`, `Subject != Issuer`. Captures `Issuer` |
| `ValidateApprovers` | always Deny: there is no approval path |
| `ValidateExecutor` | credential not expired; signer's vuid `== Issuer`; `role`: signer holds `IssuerRole` on `Resource`. Denies if `ValidateData` did not allow |

## Key rules

1. **One model in the statement, and it is the attestation.** `any` would authorise every request the
   realm key can sign; `Policy:1` would be a new signing rule minted with no admin involved.
2. **The rule must be `PRIVATE`.** An `IMPLICIT` + `PUBLIC` rule requires no credential: anyone could sign.
3. **The server builds the statement, from the row.** Never assemble it in the browser.
4. **Verify before storing and on every read.** A stored signature that was never verified reads as attested.
5. **Rebuild from the row; never store the signed bytes.**
6. **Never rely on a fact because a row exists.** Every decision that depends on it goes through `verifyAttestation`.
7. **Keep rules narrow.** A rule lists only the claim types that share its mode and its role.
