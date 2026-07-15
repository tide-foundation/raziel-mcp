# Organisation Password Manager

## What this is

A shared credential vault where organisation members store, encrypt, and retrieve passwords and secrets. Uses two Tide encryption layers:

1. **Self-encryption** — each user's vault data is encrypted with their own Tide-managed key via `_tide_<tag>.selfencrypt` / `_tide_<tag>.selfdecrypt` roles.
2. **Policy-governed encryption** — org-scoped `appUser` and `orgOwner` roles carry Forseti contracts with `signed_policy_data`. The `appUser` crypto policy governs who can perform encryption/decryption operations. The `orgOwner` contract enforces user-context signing with VVK verification.

No server, admin, or single ORK can read stored credentials.

## When to use this scenario

Use when the user describes:
- a team or organisation password manager
- a shared credential vault or secret store
- a Vaultwarden/Bitwarden-style self-hosted vault with Tide
- any app where multiple users each store encrypted credentials with org-scoped access control

Do NOT use when:
- the user describes a single-user private vault with no org structure
- the user needs only basic auth without encryption

## Core Tide capabilities used

1. **TideCloak OIDC authentication** — zero-knowledge login, no master password stored
2. **DPoP token binding** — access tokens bound to device/session
3. **Self-encryption / self-decryption** — per-user E2EE via `_tide_<tag>.selfencrypt` / `_tide_<tag>.selfdecrypt` roles
4. **Policy-governed encryption** — `appUser` role with Forseti contract and `signed_policy_data` as the active crypto policy for encrypt/decrypt operations
5. **User-context signing** — `orgOwner` role with Forseti contract that validates user context against VVK public key
6. **Doken** — delegation token for ORK-mediated crypto operations
7. **IGA (Identity Governance)** — role/policy changes require multi-admin approval via change-sets
8. **Forseti contracts** — C# smart contracts enforce role-assignment approval thresholds, org-scoped access, and VVK signature verification
9. **Org-scoped client roles** — `org:{uuid}:{owner|admin|user|manager}` pattern for per-org membership mapping

## What must exist before first user access

1. TideCloak running with a realm for the app
2. Realm licensed (`setUpTideRealm`) and IGA enabled (`toggle-iga`)
3. Admin user created, Tide account linked, `tide-realm-admin` role assigned
4. Initial client and user change-sets approved and committed
5. Self-encryption roles (`_tide_<tag>.selfencrypt`, `_tide_<tag>.selfdecrypt`) created and included in the default role composite
6. `appUser` and `orgOwner` PolicyApprovals created, approved, and committed with `signed_policy_data`
7. Forseti contract template seeded (default `IAccessPolicy` with org-scoped validation and VVK verification)
8. `sign-idp-settings` called after any IDP config changes
9. Adapter JSON exported to app (`tidecloak.json`) with `jwk`, `vendorId`, `homeOrkUrl`, `client-origin-auth-*`
10. App server running and able to reach TideCloak

## Admin/bootstrap-only steps

- Start TideCloak container
- Import realm template
- Call `setUpTideRealm` and `toggle-iga`
- Create admin user and generate account-linking invite
- Approve pending change-sets (client, user)
- Create self-encryption roles if not in realm template
- Seed default Forseti contract template
- Upload branding / configure IDP settings + `sign-idp-settings`
- Export adapter JSON

## Runtime user flow

1. User visits app (web vault or browser extension)
2. App redirects to TideCloak for OIDC login
3. TideCloak authenticates via threshold PRISM (zero-knowledge)
4. TideCloak returns access token + refresh token + doken + id token
5. App server validates JWT (signature + claims + DPoP)
6. On first org access, app syncs membership to TideCloak: creates org-scoped client roles (`org:{uuid}:{role}`), creates pending PolicyApprovals for `orgOwner` and `appUser`
7. User creates vault entries: client fetches crypto policy (`signed_policy_data` from committed `appUser` approval), encrypts fields client-side, sends ciphertext to server
8. User retrieves entries: client requests decryption via doken + ORK threshold + crypto policy
9. Plaintext exists only in client memory, never stored server-side

## Default playbook sequence

1. `start-tidecloak-dev`
2. `bootstrap-realm-from-template`
3. `initialize-admin-and-link-account`
4. `configure-e2ee-roles-and-policies` (self-encryption mode + policy-governed mode)
5. `add-auth-nextjs-fresh` (or framework-appropriate equivalent)
6. `protect-routes-nextjs`
7. `protect-api-nextjs`
8. `verify-jwt-server-side`
9. `add-rbac-nextjs`

## Key diagnostics

| Symptom | Likely cause |
|---------|-------------|
| Login hangs or blank screen | CSP missing `frame-src '*'`, or redirect handler missing |
| Encryption fails silently | Self-encryption roles not assigned, or doken expired, or `appUser` crypto policy not committed |
| `get_crypto_policy` returns null | `appUser` PolicyApproval not committed or has empty `signed_policy_data` |
| Roles missing from JWT | IGA change-set not committed, or token not refreshed (up to 120s delay) |
| Adapter JSON missing `jwk` | IGA not enabled on realm before export |
| `client-origin-auth-*` mismatch | `sign-idp-settings` not called after origin change |
| Decryption returns error | User lacks `_tide_<tag>.selfdecrypt` role, or ORK threshold not met, or crypto policy missing |
| Org membership sync fails | Client roles not created in TideCloak, or `org:{uuid}:{role}` pattern mismatch |
| VVK verification fails in contract | VVK public key not available, or user context signature invalid |

## Intentionally configurable

- **Encryption tag name**: `<tag>` in `_tide_<tag>.selfencrypt` is app-specific (e.g., `vaultwarden`, `vault`)
- **Org-scoped roles**: Apps define org role patterns (e.g., `org:{uuid}:owner`, `org:{uuid}:admin`)
- **Forseti contract logic**: Default template validates org scope and VVK signatures; apps can customize validation rules
- **Approval thresholds**: IGA admin quorum and Forseti contract thresholds are deployment-configurable
- **Browser extension support**: Optional. Requires adding extension redirect URIs to OIDC client config
- **Database backend**: App-specific choice (SQLite, PostgreSQL, MySQL)
- **Per-field vs whole-record encryption**: App decides granularity; Tide encrypts whatever the client sends
