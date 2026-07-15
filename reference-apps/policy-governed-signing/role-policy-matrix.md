# Role-Policy Matrix — Policy-Governed Signing

## Tide bootstrap roles

| Role | Purpose | Attached policy | Created by | Approved by | Required before first use | Default / optional | Notes |
|------|---------|----------------|------------|-------------|--------------------------|-------------------|-------|
| `_tide_enabled` | Enables Tide operations for user | None (gate role) | Realm template | N/A (declared in realm.json) | Yes | Default | Must be in realm.json. Not auto-created. |
| `tide-realm-admin` | Full realm administration | N/A | Bootstrap script | N/A (first admin) | Yes (at least one) | Required | Client role on `realm-management`, not a realm role. |

## Signing roles (Forseti contract-backed)

| Role | Purpose | Attached policy | Created by | Approved by | Required before first use | Default / optional | Notes |
|------|---------|----------------|------------|-------------|--------------------------|-------------------|-------|
| `<prefix>:<name>` (e.g., `ssh:root`) | Authorizes signing operations for a specific resource | Forseti contract with `signed_policy_data`; validates data, approvers, executor | Admin via app UI | Tide realm admin(s) via IGA | Yes (for that resource) | Per-resource | PolicyApproval must be committed with `signed_policy_data` before signing works for this role. |

## Key rules

1. `_tide_enabled` must be declared in `realm.json`. It is not auto-created by `setUpTideRealm`.
2. Signing roles are client roles on the app's OIDC client, not realm roles.
3. Each signing role requires a committed PolicyApproval with `signed_policy_data` before the ORKs will authorize signing for that role.
4. Role assignment changes go through IGA change-sets when IGA is enabled. Roles appear in JWT/doken after next token refresh (up to 120s delay).
5. `tide-realm-admin` is a client role on `realm-management`, not a realm role.
6. The Forseti contract's `ValidateExecutor` must check that the executor's doken contains the required signing role.
7. The Forseti contract's `ValidateApprovers` checks that approvers hold appropriate roles (e.g., `tide-realm-admin` or the signing role itself).
8. The Forseti contract's `ValidateData` validates the data being signed (e.g., SSH challenge structure, document hash format).

## Forseti contract structure

The signing contract implements `IAccessPolicy` with three validators:

| Validator | What it checks |
|-----------|---------------|
| `ValidateData` | Validates the data payload being signed. App-specific: SSH contracts parse SSHv2 publickey challenge; document contracts check hash format. |
| `ValidateApprovers` | Checks that approvers hold the required role on the correct resource. Uses `DokenDto.WrapAll()` and `Decision.RequireAnyWithRole()`. |
| `ValidateExecutor` | Checks that the executor's doken is not expired and holds the required signing role. Uses `Decision.RequireNotExpired()` and `Decision.RequireRole()`. |

## Policy parameters

Forseti contracts use `[PolicyParam]` attributes for automatic parameter binding from the policy `params` map:

| Parameter | Type | Required | Purpose |
|-----------|------|----------|---------|
| `Role` | string | Yes | The client role required for signing (e.g., `ssh:root`) |
| `Resource` | string | Yes | The client/resource ID for role lookup |
| `threshold` | number | Yes | Minimum number of approvers required |
| `approval_type` | string | Yes | `implicit` (doken-only) or `explicit` (requires operator approval popup) |
| `execution_type` | string | Yes | `public` or `private` |

## Request patterns

| Pattern | Model ID format | When to use |
|---------|----------------|-------------|
| `BasicCustomRequest` | `BasicCustom<Name>:BasicCustom<Version>` | Data to sign is known at request creation time and does not change |
| `DynamicCustomRequest` | `DynamicCustom<Name>:DynamicCustom<Version>` | Data to sign may change between authorization and signing |

## Contract transport structure [OBSERVED_PATTERN]

PolicySignRequest draft contains:
1. Policy bytes (serialized `Policy` object)
2. Contract transport: `[contractType("forseti"), [emptyBytes, [sourceCode, entryType("Contract")]]]`

This is constructed via `TideMemory.CreateFromArray` nesting. The contract ID is the SHA-512 hash of the source code.
