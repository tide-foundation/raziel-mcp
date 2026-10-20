# Role-Policy Matrix — Organisation Password Manager

No custom contract. Shared vaults use the ORK's built-in `RelationshipAttestation:1` (ORK `main`,
VERIFIED from source `c69fc4f6`). Private items use self-encryption.

## Tide bootstrap roles

| Role | Purpose | Attached policy | Created by | Approved by | Required before first use | Default / optional | Notes |
|------|---------|----------------|------------|-------------|--------------------------|-------------------|-------|
| `_tide_enabled` | Enables Tide operations for user | None (gate role) | Realm template | N/A (declared in realm.json) | Yes | Default | Must be in realm.json. Not auto-created. |
| `_tide_<tag>.selfencrypt` | Encrypt private items with own key | Voucher gate: selfencrypt | Admin via IGA | Tide realm admin(s) | Yes | Default | Include in default-roles composite so all users get it. |
| `_tide_<tag>.selfdecrypt` | Decrypt own private items | Voucher gate: selfdecrypt | Admin via IGA | Tide realm admin(s) | Yes | Default | Include in default-roles composite so all users get it. |
| `_tide_encryptor` | Capability to encrypt into a shared vault | Checked by `RelationshipAttestation:1` | Realm template | N/A (declared in realm.json) | Yes, for writers | Assigned to members who write; never in the default-roles composite | Name fixed by the contract. A **realm** role. Not enough on its own: the member must also match the vault policy's subject. |
| `_tide_decryptor` | Capability to decrypt from a shared vault | Checked by `RelationshipAttestation:1` | Realm template | N/A (declared in realm.json) | Yes, for readers | Assigned to members who read; never in the default-roles composite | Name fixed by the contract. A **realm** role. Same rule as above. |
| `tide-realm-admin` | Realm administration; signs vault policies | N/A | Bootstrap script | N/A (first admin) | Yes (at least one) | Required | Client role on `realm-management`, not a realm role. |

## Org-scoped client roles (per organisation)

These are the `Role` subjects of vault policies (with `clientId` = your OIDC client).

| Role pattern | Purpose | Created by | Approved by | Notes |
|-------------|---------|------------|-------------|-------|
| `org:{uuid}:owner` | Org owner | App on org creation | IGA change-set | Maps to Bitwarden Owner. Cannot sign vault policies: a realm admin does. |
| `org:{uuid}:admin` | Org administrator | App on member invite | IGA change-set | Maps to Bitwarden Admin. |
| `org:{uuid}:user` | Org member | App on member invite | IGA change-set | The usual vault subject: `Role` + `org:{uuid}:user` + `clientId`. |
| `org:{uuid}:manager` | Org manager | App on member invite | IGA change-set | Maps to Bitwarden Manager. |

## Vault policies (one per shared vault)

| Field | Value |
|---|---|
| Contract | `RelationshipAttestation:1` (built in; nothing deployed) |
| Execution | `PRIVATE` (required by the contract) |
| Models | `PolicyEnabledEncryption:1`, `PolicyEnabledDecryption:1` |
| `assignmentId` | vault id (the only tag on every entry) |
| `subjectType` / `subjectId` / `clientId` | `Role` / `org:{uuid}:user` / your client, or `Group` / full group path, or `User` / `tideuserkey` |
| `roles` | `["_tide_encryptor","_tide_decryptor"]` read-write, `["_tide_decryptor"]` read-only |
| Signed by | a `tide-realm-admin`, in the Tide enclave |
| Stored by | the app, keyed by vault id |

| Member type | Policy `roles` | Realm roles the member needs |
|---|---|---|
| Viewer | `["_tide_decryptor"]` | `_tide_decryptor` |
| Contributor | `["_tide_encryptor","_tide_decryptor"]` | both |
| Intake only | `["_tide_encryptor"]` | `_tide_encryptor` |

## Key rules

1. `_tide_enabled`, `_tide_encryptor` and `_tide_decryptor` must be declared in `realm.json`. They are not auto-created by `setUpTideRealm`.
2. Self-encryption roles must exist and be assigned before any user encrypts or decrypts a private item.
3. A vault's policy must be signed before anyone can encrypt into it.
4. Every entry's only tag is its vault id.
5. Org roles are **client** roles: a `Role` policy for `org:{uuid}:user` needs `clientId`, or the check looks in realm roles and fails.
6. `Group` subjects use the full path (`/org-x/team-y`), matched exactly against the `groups` claim.
7. Role and group changes go through IGA change requests. They reach the credential after the next token refresh (up to 120s).
8. `tide-realm-admin` is a client role on `realm-management`, not a realm role.

## Encryption role naming convention

| Pattern | Mode | Use case |
|---------|------|----------|
| `_tide_<tag>.selfencrypt` | Self-encryption | Member encrypts a private item with own key. No sharing. |
| `_tide_<tag>.selfdecrypt` | Self-decryption | Member decrypts own private item. |
| `_tide_encryptor` | `RelationshipAttestation:1` | Write to a shared vault the member's policy subject covers. |
| `_tide_decryptor` | `RelationshipAttestation:1` | Read a shared vault the member's policy subject covers. |

## Common failure

A `Role` policy for an org role with no `clientId`. The contract then looks for a realm role named
`org:{uuid}:user`, finds none, and refuses every member.
