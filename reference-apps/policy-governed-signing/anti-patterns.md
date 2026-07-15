# Anti-Patterns — Policy-Governed Signing

Scenario-specific mistakes. Each defeats a security property or causes a setup failure.

## AP-PS01: Skipping IGA before role creation

Creating signing roles before enabling IGA means those role changes are not governed. Enable IGA first, then create roles so they go through the change-set approval flow.

## AP-PS02: Using signing without a committed policy

The signing role must have a committed PolicyApproval with non-empty `signed_policy_data` before ORKs will accept signing requests. If the policy is not committed, `executeSignRequest` will fail. Do not assume signing works immediately after role creation.

## AP-PS03: Hardcoding the signing key

The entire point of this pattern is that no single entity holds the signing key. Do not generate, store, or manage signing keys in the app. The key exists only as threshold shares across independent ORKs.

## AP-PS04: Omitting DPoP on protected API routes

DPoP binds the access token to the device/session. Without DPoP verification on API routes, a stolen access token can be replayed from a different device. Verify DPoP proof on every protected endpoint.

## AP-PS05: Using `createRemoteJWKSet` for JWT verification

Use `createLocalJWKSet(config.jwk)` only. Remote JWKS fetch introduces a network dependency and a potential MITM vector. If `jwk` is missing from the adapter JSON, re-export with IGA enabled.

## AP-PS06: Forgetting `sign-idp-settings` after config changes

Any change to IDP settings (logo, origins, admin domain) must be followed by `sign-idp-settings`. Without it, the ORK enclave rejects the settings as unsigned. Login and signing will fail silently.

## AP-PS07: Weak or missing `ValidateData` in the Forseti contract

The `ValidateData` method is the primary safety gate. If it accepts arbitrary data, the ORKs will sign anything the executor submits. Validate the data structure, size, format, and semantics. For SSH: parse the SSHv2 publickey challenge. For documents: check hash format and size. Never return `PolicyDecision.Allow()` unconditionally.

## AP-PS08: Skipping `ValidateExecutor` in the Forseti contract

The `ValidateExecutor` method must check that the executor's doken contains the required signing role and is not expired. Without it, any authenticated user can request signatures for any role.

## AP-PS09: Using wrong adapter provider ID

The provider ID is `keycloak-oidc-keycloak-json`. The string `tidecloak-oidc-keycloak-json` does not exist. Using the wrong ID returns an error or a generic adapter without Tide fields.

## AP-PS10: Assuming roles appear instantly after IGA commit

After a change-set is committed, roles appear in JWT/doken on the next token refresh. This can take up to 120 seconds. Do not treat immediate post-commit token checks as authoritative.

## AP-PS11: Hiding signing UI without protecting the API

Hiding the "Sign" button for unauthorized users is UI gating only. The API endpoint that handles signing must independently verify JWT signature, claims, roles, and DPoP. A hidden button is not a security boundary.

## AP-PS12: Skipping change-set approval during bootstrap

After IGA is enabled, client and user mutations create draft change-sets. If these are not signed and committed, the changes remain in draft state. The realm appears configured but clients and users are not fully active.

## AP-PS13: Creating policies with wrong model ID

The model ID in the policy must match the request pattern used by the client. `BasicCustom<SSH>:BasicCustom<1>` is for `BasicCustomRequest`. `DynamicCustom<SSH>:DynamicCustom<1>` is for `DynamicCustomRequest`. A mismatch causes ORK rejection.

## AP-PS14: Omitting contract transport from PolicySignRequest

The PolicySignRequest draft must include both the serialized policy bytes and the contract transport (source code + entry type). Without the contract transport, ORKs cannot compile and execute the Forseti contract. The contract ID (SHA-512 of source) must match.

## AP-PS15: Using blocked namespaces in Forseti contracts

The ORK Forseti sandbox blocks: `System.IO`, `System.Net`, `System.Diagnostics`, `System.Threading`, `System.Reflection`, `System.Runtime.InteropServices`, `System.Reflection.Emit`, `Microsoft.Win32`. Hard-blocked: `System.Console`, `System.Runtime.CompilerServices.Unsafe`. Using any blocked namespace causes `BadPolicy.ForbiddenCall`.

## AP-PS16: Not setting custom expiry on PolicySignRequest

`PolicySignRequest.setCustomExpiry()` controls how long the policy remains valid. If not set or set too short, policies expire and signing stops working. The keylessh exemplar uses 604800 seconds (7 days). Choose an appropriate TTL for your use case.
