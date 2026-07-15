# Role-Policy Matrix — Organisation Password Manager

## Tide bootstrap roles

| Role | Purpose | Attached policy | Created by | Approved by | Required before first use | Default / optional | Notes |
|------|---------|----------------|------------|-------------|--------------------------|-------------------|-------|
| `_tide_enabled` | Enables Tide operations for user | None (gate role) | Realm template | N/A (declared in realm.json) | Yes | Default | Must be in realm.json. Not auto-created. |
| `_tide_<tag>.selfencrypt` | Allows user to encrypt data with own key | Voucher gate: selfencrypt | Admin via IGA | Tide realm admin(s) | Yes | Default | Include in default-roles composite so all users get it. |
| `_tide_<tag>.selfdecrypt` | Allows user to decrypt own encrypted data | Voucher gate: selfdecrypt | Admin via IGA | Tide realm admin(s) | Yes | Default | Include in default-roles composite so all users get it. |
| `tide-realm-admin` | Full realm administration | N/A | Bootstrap script | N/A (first admin) | Yes (at least one) | Required | Client role on `realm-management`, not a realm role. |

## Policy-governed roles (Forseti contract-backed)

| Role | Purpose | Attached policy | Created by | Approved by | Required before first use | Default / optional | Notes |
|------|---------|----------------|------------|-------------|--------------------------|-------------------|-------|
| `appUser` | Crypto policy for encrypt/decrypt operations | Forseti contract; `signed_policy_data` served as active crypto policy | App on first org sync | Tide realm admin(s) via IGA | Yes (for encryption) | Default | PolicyApproval must be committed with non-empty `signed_policy_data` before encryption works. |
| `orgOwner` | User-context signing with VVK verification | Forseti contract with VVK public key validation | App on first org sync | Tide realm admin(s) via IGA | Yes (for org admin ops) | Default | Contract validates `org:{uuid}:{role}` pattern and verifies user context signature against VVK. |

## Org-scoped client roles (per organisation)

| Role pattern | Purpose | Attached policy | Created by | Approved by | Required before first use | Default / optional | Notes |
|-------------|---------|----------------|------------|-------------|--------------------------|-------------------|-------|
| `org:{uuid}:owner` | Org owner (highest privilege) | Inherits `orgOwner` composites + `accessAll` | App on org creation | IGA change-set | No (created per org) | Per-org | Maps to Bitwarden Owner membership type. |
| `org:{uuid}:admin` | Org administrator | None beyond membership | App on member invite | IGA change-set | No | Per-org | Maps to Bitwarden Admin membership type. |
| `org:{uuid}:user` | Org member (standard) | Inherits `appUser` composite | App on member invite | IGA change-set | No | Per-org | Maps to Bitwarden User membership type. Gets encryption capability via `appUser`. |
| `org:{uuid}:manager` | Org manager | None beyond membership | App on member invite | IGA change-set | No | Per-org | Maps to Bitwarden Manager membership type. |
| `org:{uuid}:accessAll` | Full collection access within org | None | App on org creation | IGA change-set | No | Per-org | Composite of owner role. Grants access to all collections. |

## Key rules

1. `_tide_enabled` must be declared in `realm.json`. It is not auto-created by `setUpTideRealm`.
2. Self-encryption roles must exist and be assigned before any user attempts to encrypt or decrypt.
3. `appUser` PolicyApproval must be committed with `signed_policy_data` before the crypto policy endpoint returns usable data.
4. `orgOwner` PolicyApproval must be committed before org admin operations that require VVK-verified user context.
5. Role assignment changes go through IGA change-sets when IGA is enabled. Roles appear in JWT after next token refresh (up to 120s delay).
6. `tide-realm-admin` is a client role on `realm-management`, not a realm role.
7. All role changes after IGA is enabled require change-set approval (draft -> sign -> commit).
8. Org-scoped roles use the pattern `org:{uuid}:{suffix}`. The Forseti contract validates this pattern and extracts the org UUID for scope enforcement.

## Forseti contract structure (default template)

The default seeded contract implements `IAccessPolicy` with three validators:

| Validator | What it checks |
|-----------|---------------|
| `ValidateData` | Extracts org UUID from executor role. Validates user context array from draft against previous signed user context. Verifies VVK public key signature. |
| `ValidateApprovers` | Checks that approvers hold `tide-realm-admin` role. |
| `ValidateExecutor` | Checks that executor holds an `org:{uuid}:{role}` role matching the allowed org. |

## Encryption role naming convention

| Pattern | Mode | Use case |
|---------|------|----------|
| `_tide_<tag>.selfencrypt` | Self-encryption | User encrypts with own key. No sharing. |
| `_tide_<tag>.selfdecrypt` | Self-decryption | User decrypts own data via ORK threshold. |
| `appUser` | Policy-governed | Crypto policy for encrypt/decrypt. `signed_policy_data` served to clients. |
| `orgOwner` | Policy-governed | User-context signing with VVK verification for org admin operations. |

This scenario uses both self-encryption and policy-governed encryption.
