# Policy-Governed Signing

## What this is

An application where cryptographic signing operations are authorized by Forseti contracts running on the ORK network. The user authenticates via TideCloak OIDC, receives a doken, and when the app needs a signature (e.g., SSH challenge, document signing, transaction approval), the ORKs validate the request against a Forseti contract before collaboratively producing the signature.

No single entity holds the signing key. The key is mathematically split across independent ORKs via threshold cryptography.

## When to use this scenario

Use when the user describes:
- an app that signs data using Tide threshold cryptography
- SSH access control with policy-based signing
- keyless SSH or keyless signing
- document signing with multi-admin approval
- transaction signing governed by smart contracts
- any app where cryptographic signatures are produced by ORKs after policy validation

Do NOT use when:
- the user needs only authentication (no signing)
- the user needs encryption/decryption (use `organisation-password-manager` or self-encryption patterns)
- the user describes a password manager or credential vault

## Core Tide capabilities used

1. **TideCloak OIDC authentication** — zero-knowledge login via threshold PRISM
2. **DPoP token binding** — access tokens bound to device/session
3. **Doken** — delegation token authorizing ORK-mediated operations
4. **Forseti contracts** — C# smart contracts executed in ORK sandboxes; validate data, approvers, and executor before signing
5. **Policy:1 auth flow** — policy-based authorization; ORKs check contract before producing signature
6. **IGA (Identity Governance)** — role and policy changes require multi-admin approval via change-sets
7. **BasicCustomRequest / DynamicCustomRequest** — request patterns for submitting signing operations to ORKs
8. **PolicySignRequest** — creates signing policies with contract code, parameters, and model IDs
9. **Client roles** — prefixed pattern (e.g., `ssh:<username>`) for per-resource access control

## What must exist before first user access

1. TideCloak running with a realm for the app
2. Realm licensed (`setUpTideRealm`) and IGA enabled (`toggle-iga`)
3. Admin user created, Tide account linked, `tide-realm-admin` role assigned
4. Initial client and user change-sets approved and committed
5. `sign-idp-settings` called after IDP config changes
6. Adapter JSON exported to app (`tidecloak.json`) with `jwk`, `vendorId`, `homeOrkUrl`, `client-origin-auth-*`
7. At least one signing role created (e.g., `ssh:<username>`) via admin UI
8. Signing policy created, approved, and committed for each role (Forseti contract + `signed_policy_data`)
9. App server running with JWT + DPoP verification on protected endpoints

## Admin/bootstrap-only steps

- Start TideCloak container
- Import realm template
- Call `setUpTideRealm` and `toggle-iga`
- Create admin user and generate account-linking invite
- Approve pending change-sets (client, user)
- Upload branding / configure IDP settings + `sign-idp-settings`
- Set `CustomAdminUIDomain` if a separate app hosts the approval UI
- Export adapter JSON
- Create signing roles via admin UI
- Create and approve signing policies via admin UI (or policy template system)

## Runtime user flow

1. User visits app
2. App redirects to TideCloak for OIDC login
3. TideCloak authenticates via threshold PRISM (zero-knowledge)
4. TideCloak returns access token + refresh token + doken + id token
5. App server validates JWT (signature + claims + DPoP)
6. When a signing operation is needed (e.g., SSH authentication):
   - Client fetches the committed policy (`signed_policy_data`) for the target role
   - Client creates a `BasicCustomRequest` or `DynamicCustomRequest` with the data to sign
   - Client attaches doken as authorizer and policy bytes
   - Client calls `createTideRequest` then `executeSignRequest`
   - ORKs execute the Forseti contract: validate data, check approver/executor roles, enforce thresholds
   - If policy allows, ORKs collaboratively produce the Ed25519 signature
7. Signature exists only in client memory; signing key never materializes anywhere

## Default playbook sequence

1. `start-tidecloak-dev`
2. `bootstrap-realm-from-template`
3. `initialize-admin-and-link-account`
4. `add-auth-nextjs-fresh` (or framework-appropriate equivalent)
5. `protect-routes-nextjs`
6. `protect-api-nextjs`
7. `verify-jwt-server-side`
8. `add-rbac-nextjs`

## Key diagnostics

| Symptom | Likely cause |
|---------|-------------|
| Login hangs or blank screen | CSP missing `frame-src '*'`, or redirect handler missing |
| Signing fails with "No doken available" | User not authenticated, or doken expired, or `IAMService._tc` not initialized |
| Forseti contract rejects with `PolicyDecision.Deny` | Data validation failed (check contract logic), or executor lacks required role |
| `BadPolicy.ForbiddenCall` | Contract uses a blocked namespace (e.g., `System.IO`) |
| `OutOfGasException` | Contract exceeds 50,000 gas limit; simplify logic |
| Policy fetch returns null | PolicyApproval not committed, or role name mismatch |
| Roles missing from JWT/doken | IGA change-set not committed, or token not refreshed (up to 120s delay) |
| Adapter JSON missing `jwk` | IGA not enabled on realm before export |
| `client-origin-auth-*` mismatch | `sign-idp-settings` not called after origin change |
| Signature length unexpected | Check algorithm; Ed25519 signatures are 64 bytes |

## Intentionally configurable

- **Role naming pattern**: Apps define their own prefix (e.g., `ssh:<user>`, `sign:<resource>`, `tx:<type>`)
- **Forseti contract logic**: Apps write custom `ValidateData`, `ValidateApprovers`, `ValidateExecutor` methods
- **Request pattern**: Choose `BasicCustomRequest` (static data) or `DynamicCustomRequest` (data can change between auth and signing)
- **Approval type**: Implicit (doken-only, no popup) or explicit (requires operator approval popup)
- **Execution type**: Public or private
- **Policy parameters**: `[PolicyParam]` attributes in the contract are filled from the policy `params` map
- **Model ID**: Custom `BasicCustom<Name>:BasicCustom<Version>` or `DynamicCustom<Name>:DynamicCustom<Version>` patterns
- **Approval thresholds**: IGA admin quorum and contract thresholds are deployment-configurable
- **Contract entry type**: Must be `Contract` implementing `IAccessPolicy`
