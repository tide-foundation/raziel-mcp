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

## AP-S14: Encrypting into a vault before its policy is signed

Each shared vault needs its `RelationshipAttestation:1` policy signed by a realm admin first. Without
it there is nothing to pass to `doEncrypt`. Do not fall back to self-encryption: those items can
never be shared. Block the vault and show an admin setup CTA.

## AP-S15: Treating `_tide_encryptor` / `_tide_decryptor` as the access control

Those realm roles are capabilities. The vault policy's **subject** is the boundary. A vault policy
whose subject is a role or group everyone holds opens the vault to everyone.

## AP-S16: Hardcoding org role names without UUID, or omitting `clientId`

Org-scoped client roles must follow the `org:{uuid}:{suffix}` pattern, so each org's vault policy
names only that org. A `Role` policy for a client role must carry `clientId`; without it the
contract looks for a realm role of that name and refuses every member.

## AP-S17: Tagging entries with anything but the vault id

The contract requires every tag on every entry to equal the policy's `assignmentId`. Extra tags
(field type, folder) make the ORKs refuse the request. Keep such metadata in the stored record, not
in the tags.

## AP-S18: Writing a custom contract for vault access

Per-vault access is exactly what the built-in `RelationshipAttestation:1` does. A custom contract
adds a review and deployment by the Tide team and a second thing to keep correct. Use one only if
org owners must grant access without a realm admin.
