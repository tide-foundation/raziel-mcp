# Anti-Patterns — Organisation Password Manager

Scenario-specific mistakes. Each defeats a security property or causes a setup failure.

## AP-S01: Skipping IGA before role creation

Creating self-encryption roles before enabling IGA means those role changes are not governed. Enable IGA first, then create roles so they go through the change-set approval flow.

## AP-S02: Missing self-encryption roles in default composite

If `_tide_<tag>.selfencrypt` and `_tide_<tag>.selfdecrypt` are not included in the default-roles composite, new users cannot encrypt or decrypt until an admin manually assigns roles. This breaks the expected first-use experience.

## AP-S03: Treating the server as a decryption endpoint

The server must never decrypt vault data. Decryption happens client-side via doken + ORK threshold + crypto policy. If the server decrypts, the entire E2EE guarantee is void. The server stores and returns ciphertext only.

## AP-S04: Storing plaintext credentials server-side

Vault entries must be encrypted before leaving the client. If the app sends plaintext to the server "for later encryption", the server sees secrets in the clear. Encrypt client-side, transmit ciphertext.

## AP-S05: Omitting DPoP on protected API routes

DPoP binds the access token to the device/session. Without DPoP verification on API routes, a stolen access token can be replayed from a different device. Verify DPoP proof on every protected endpoint.

## AP-S06: Using `createRemoteJWKSet` for JWT verification

Use `createLocalJWKSet(config.jwk)` only. Remote JWKS fetch introduces a network dependency and a potential MITM vector. If `jwk` is missing from the adapter JSON, re-export with IGA enabled.

## AP-S07: Forgetting `sign-idp-settings` after config changes

Any change to IDP settings (logo, origins, admin domain) must be followed by `sign-idp-settings`. Without it, the ORK enclave rejects the settings as unsigned. Login and encryption will fail silently.

## AP-S08: Lazy runtime creation of encryption roles

Do not create `_tide_<tag>.selfencrypt` / `_tide_<tag>.selfdecrypt` roles at app startup or on first user request. These roles must exist and be approved via IGA change-sets before the app is available to users.

## AP-S09: Using wrong adapter provider ID

The provider ID is `keycloak-oidc-keycloak-json`. The string `tidecloak-oidc-keycloak-json` does not exist. Using the wrong ID returns an error or a generic adapter without Tide fields.

## AP-S10: Assuming roles appear instantly after IGA commit

After a change-set is committed, roles appear in JWT/doken on the next token refresh. This can take up to 120 seconds. Do not treat immediate post-commit token checks as authoritative.

## AP-S11: Hiding vault UI without protecting the API

Hiding the "decrypt" button for unauthorized users is UI gating only. The API endpoint that handles decryption must independently verify JWT signature, claims, roles, and DPoP. A hidden button is not a security boundary.

## AP-S12: Skipping change-set approval during bootstrap

After IGA is enabled, client and user mutations create draft change-sets. If these are not signed and committed, the changes remain in draft state. The realm appears configured but clients and users are not fully active.

## AP-S13: Caching decrypted credentials on the server

Decrypted vault data must exist only in client memory. Do not cache decrypted values in server-side sessions, databases, or logs. Each decryption request must go through the ORK threshold path.

## AP-S14: Not committing appUser PolicyApproval before user access

The `appUser` PolicyApproval must be committed with non-empty `signed_policy_data` before encryption works. If uncommitted, the crypto policy endpoint returns null and client-side encryption silently fails or errors.

## AP-S15: Skipping orgOwner PolicyApproval

The `orgOwner` PolicyApproval with its Forseti contract (VVK verification, org-scope validation) must be committed before org admin operations work. Without it, user context signing fails and org-level policy enforcement is absent.

## AP-S16: Hardcoding org role names without UUID

Org-scoped client roles must follow the `org:{uuid}:{suffix}` pattern. Hardcoding role names without the org UUID breaks multi-org support and causes the Forseti contract's `TryExtractOrgId` validation to fail.

## AP-S17: Serving crypto policy without verifying commitment status

The crypto policy endpoint should only return `signed_policy_data` from committed PolicyApprovals. Serving policy data from pending or draft approvals means the policy has not been validated by the required quorum.
