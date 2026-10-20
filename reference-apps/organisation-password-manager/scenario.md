# Organisation Password Manager

## What this is

A shared credential vault where organisation members store, encrypt, and retrieve passwords and
secrets. It uses two Tide encryption layers, and **no custom contract** for either:

1. **Self-encryption** — a member's private items are encrypted with their own Tide-managed key via
   `_tide_<tag>.selfencrypt` / `_tide_<tag>.selfdecrypt` roles.
2. **Shared vaults under the built-in contract** — every shared vault (or collection) has one
   policy under the ORK's built-in `RelationshipAttestation:1` contract. The policy names who may
   open that vault: an org role, a team, or one member. A realm admin approves it once. From then
   on the ORKs, not the app, decide who can encrypt and decrypt that vault's entries.

No server, admin, or single ORK can read stored credentials.

`RelationshipAttestation:1` is built into the ORK (ORK `main`, VERIFIED from source
`c69fc4f6`, 2026-10-16). There is nothing to write, compile or deploy. The full mechanics are in
`relationship-attestation`; this page maps them onto a vault.

## Built-in contract: how a vault maps onto it

| Contract param | Vault value |
|---|---|
| `assignmentId` | the vault (or collection) id. It is also the **only** tag on every entry in that vault |
| `subjectType` / `subjectId` | who may open it: `Role` + `org:{uuid}:{role}` (with `clientId` = your OIDC client, because org roles are client roles), `Group` + the team's full group path, or `User` + one member's `tideuserkey` |
| `roles` | `["_tide_encryptor","_tide_decryptor"]` for members who add and edit entries; `["_tide_decryptor"]` for read-only members |

Rules the network enforces (VERIFIED from the contract source):

- The policy must be `PRIVATE` execution and name only the `PolicyEnabledEncryption:1` /
  `PolicyEnabledDecryption:1` models.
- **Every** tag on every entry must equal the vault id. A second tag, or a different one, is refused.
- The member's credential must carry realm role `_tide_encryptor` to encrypt or `_tide_decryptor`
  to decrypt, the policy's `roles` must list that role, **and** the member must match the subject.

Which subject to use:

| Access model | Subject | Granting a member |
|---|---|---|
| Everyone in an org role may open the vault (the Bitwarden "collection" default) | `Role`, `org:{uuid}:user`, `clientId` = your client | assign the org role |
| A team inside the org | `Group`, `/org-{uuid}/team-x` (full path, exactly as the `groups` claim carries it) | add them to the group |
| One named member | `User`, their `tideuserkey` | a new policy, approved by a realm admin |
| Read-only auditors | any of the above with `roles` = `["_tide_decryptor"]` | as above |

With `Role` and `Group` subjects, one policy per vault serves everyone in that role or team, and
adding a member is a membership change (a governed change request on an IGA realm), not a new
policy.

## Who can grant

Policies are signed with the realm's key, so **a realm admin (`tide-realm-admin`) approves each
vault policy** in the Tide enclave. An org owner cannot sign one. Two consequences:

- Creating a shared vault needs a realm admin's approval before anyone can write to it.
- Day-to-day membership (who is in `org:{uuid}:user`, who is in a team group) is ordinary role or
  group administration, governed by IGA.

If the product needs org owners to grant access with no realm admin involved, the built-in
contract does not cover it. That is the one case for a custom contract, and it goes to the Tide team
(info@tide.org) to deploy.

The Vaultwarden exemplar this scenario came from also had an `orgOwner` policy: a custom contract
for **signing** an org's user context, checked against the VVK. Vault encryption does not need it,
and the built-in contract cannot replace it (it only runs encryption and decryption requests). If an
app needs that signature, treat it as `policy-governed-signing`.

## When to use this scenario

Use when the user describes:
- a team or organisation password manager
- a shared credential vault or secret store
- a Vaultwarden/Bitwarden-style self-hosted vault with Tide
- any app where multiple users each store encrypted credentials with org-scoped access control

Do NOT use when:
- the user describes a single-user private vault with no org structure
- the user needs only basic auth without encryption
- access is per record with an explicit assignment (a case, an assessment): use
  `relationship-attestation` directly

## Core Tide capabilities used

1. **TideCloak OIDC authentication** — zero-knowledge login, no master password stored
2. **DPoP token binding** — access tokens bound to device/session
3. **Self-encryption / self-decryption** — per-user E2EE via `_tide_<tag>.selfencrypt` / `_tide_<tag>.selfdecrypt` roles
4. **Built-in contract `RelationshipAttestation:1`** — one admin-approved policy per shared vault decides who may encrypt and decrypt it
5. **Doken** — carries the member's realm roles, client roles and `groups`, which the contract checks
6. **IGA (Identity Governance)** — role and group membership changes require admin approval via change requests
7. **Org-scoped client roles** — `org:{uuid}:{owner|admin|user|manager}` pattern for per-org membership, used as `Role` subjects
8. **`groups` claim** — mandated claim name, full path on; needed for team (`Group`) subjects

## What must exist before first user access

1. TideCloak running with a realm for the app
2. Realm licensed (`setUpTideRealm`) and IGA enabled (`toggle-iga`)
3. Admin user created, Tide account linked, `tide-realm-admin` role assigned
4. Initial client and user change-sets approved and committed
5. Self-encryption roles (`_tide_<tag>.selfencrypt`, `_tide_<tag>.selfdecrypt`) created and included in the default role composite
6. Realm roles `_tide_encryptor` and `_tide_decryptor` created (names fixed by the contract) and assigned to members who write and read shared vaults
7. The `groups` protocol mapper on the client (shipped by the pack's realm templates, before IGA)
8. `sign-idp-settings` called after any IDP config changes
9. Adapter JSON exported to app (`tidecloak.json`) with `jwk`, `vendorId`, `homeOrkUrl`, `client-origin-auth-*`
10. App server running and able to reach TideCloak

Per vault, at runtime: one `RelationshipAttestation:1` policy, signed by a realm admin, stored by
the app keyed by vault id.

## Admin/bootstrap-only steps

- Start TideCloak container
- Import realm template (declares `_tide_enabled`, `_tide_encryptor`, `_tide_decryptor` and the `groups` mapper)
- Call `setUpTideRealm` and `toggle-iga`
- Create admin user and generate account-linking invite
- Approve pending change-sets (client, user)
- Create self-encryption roles if not in realm template
- Upload branding / configure IDP settings + `sign-idp-settings`
- Export adapter JSON

## Runtime user flow

1. User visits app (web vault or browser extension)
2. App redirects to TideCloak for OIDC login
3. TideCloak authenticates via threshold PRISM (zero-knowledge)
4. TideCloak returns access token + refresh token + doken + id token
5. App server validates JWT (signature + claims + DPoP)
6. On first org access, app syncs membership to TideCloak: creates org-scoped client roles (`org:{uuid}:{role}`) and team groups (governed change requests on an IGA realm)
7. A shared vault is created: a realm admin signs its `RelationshipAttestation:1` policy in the enclave (`signRelationshipPolicy`, `templates/relationship-attestation/relationship.ts`); the app stores the signed policy keyed by vault id
8. Member adds an entry: the browser fetches the vault's signed policy and calls `doEncrypt` with the vault id as the only tag and that policy; the server stores only ciphertext
9. Member opens an entry: the browser calls `doDecrypt` with the same policy; the ORKs check the member's roles and subject before releasing anything
10. Plaintext exists only in client memory, never stored server-side

## Default playbook sequence

1. `start-tidecloak-dev`
2. `bootstrap-realm-from-template`
3. `initialize-admin-and-link-account`
4. `configure-e2ee-roles-and-policies` (self-encryption mode + `RelationshipAttestation:1` for shared vaults)
5. `add-auth-nextjs-fresh` (or framework-appropriate equivalent)
6. `protect-routes-nextjs`
7. `protect-api-nextjs`
8. `verify-jwt-server-side`
9. `add-rbac-nextjs`

## Key diagnostics

| Symptom | Likely cause |
|---------|-------------|
| Login hangs or blank screen | CSP missing `frame-src '*'`, or redirect handler missing |
| Self-encryption fails | `_tide_<tag>.selfencrypt` not assigned, or doken expired |
| Shared vault encrypt/decrypt fails with `TIDE-TIDEJS-NET-THRESHOLD_FAILURE` | The contract refused: read the error's `cause`. Usual reasons: member lacks `_tide_encryptor`/`_tide_decryptor`, member is not the policy's subject, an entry carries a tag other than the vault id, or the policy's `roles` lacks the operation. Do not retry |
| `'org:{uuid}:user' role under <client> not found in doken` | `Role` policy without the right `clientId`, or the member was not given the org role (or has not refreshed) |
| `'<group>' group not found in doken` | `subjectId` is not the full group path, the member is not in the group, or the `groups` mapper is missing |
| Roles missing from JWT | IGA change-set not committed, or token not refreshed (up to 120s delay) |
| Adapter JSON missing `jwk` | IGA not enabled on realm before export |
| `client-origin-auth-*` mismatch | `sign-idp-settings` not called after origin change |
| Org membership sync fails | Client roles not created in TideCloak, or `org:{uuid}:{role}` pattern mismatch |

## Intentionally configurable

- **Encryption tag name**: `<tag>` in `_tide_<tag>.selfencrypt` is app-specific (e.g., `vaultwarden`, `vault`)
- **Org-scoped roles**: Apps define org role patterns (e.g., `org:{uuid}:owner`, `org:{uuid}:admin`)
- **Subject per vault**: org role (`Role`), team (`Group`) or member (`User`), and read-only vs read-write via the policy's `roles`
- **Policy expiry**: optional; a vault policy can stop working after a date
- **Approval thresholds**: IGA admin quorum is deployment-configurable
- **Browser extension support**: Optional. Requires adding extension redirect URIs to OIDC client config
- **Database backend**: App-specific choice (SQLite, PostgreSQL, MySQL)
- **Per-field vs whole-record encryption**: App decides granularity; Tide encrypts whatever the client sends

## Verification

- A member with `org:{uuid}:user` and `_tide_decryptor` decrypts an entry in the vault.
- The same member **without** `_tide_decryptor` is refused (`'_tide_decryptor' role not found`).
- A member of a **different** org is refused, even with both `_tide_*` roles.
- An entry encrypted with two tags, or with any tag other than the vault id, is refused at encryption.
- A read-only member (`roles` = `["_tide_decryptor"]`) can decrypt but cannot encrypt.

## Common failure

Treating the `_tide_encryptor` / `_tide_decryptor` realm roles as the access control. They are only
the capability; the **subject** in each vault's policy is the boundary. Grant them only to members
who use shared vaults, never through the default-roles composite: the role check is a second gate,
and it means nothing if everyone holds the role. Worse is a vault policy whose subject is a role
everyone holds (such as `default-roles-<realm>`): that opens the vault to the whole realm.
