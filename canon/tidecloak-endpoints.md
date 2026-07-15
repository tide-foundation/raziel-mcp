# TideCloak Extension Endpoints - Canon

Complete reference of all REST endpoints added by TideCloak extensions. These are in addition to standard Keycloak endpoints.

Admin endpoints require a Bearer token with `manage-realm` or `manage-users` permission.
Public endpoints require no authentication.

---

## URL Patterns

- Admin API: `/admin/realms/{realm}/{provider-id}/{path}`
- Public realm: `/realms/{realm}/{provider-id}/{path}`

---

## App Developer Endpoints

These are the endpoints app developers interact with most frequently.

### Adapter JSON Export

```
GET /admin/realms/{realm}/vendorResources/get-installations-provider
  ?clientId={uuid}&providerId=keycloak-oidc-keycloak-json
```

Returns the client adapter JSON with Tide-specific fields (`jwk`, `vendorId`, `homeOrkUrl`, `client-origin-auth-*`). The `jwk` field is only present when IGA is enabled. Save as `data/tidecloak.json`.

### Public Tide Config

```
GET /realms/{realm}/public/get-tide-config?clientId={clientId}
```

Public endpoint. Returns `vendorId`, `homeOrkUrl`, client auth origins, and branding URLs for a client. No auth required.

### Role / Encryption Policies

Signed role/encryption policies are managed through the admin IGA surface:

```
GET /admin/realms/{realm}/iga/role-policies
GET /admin/realms/{realm}/iga/role-policies/name/{name}
```

Each role-policy record carries the signed `policy` bytes and `policySig` used by policy-based encryption/decryption. The older public `tide-policy-resources/admin-policy` and `.../policy` endpoints are not present on current main (`tidecloak-iga-extensions`); see `canon/custom-contracts.md`.

### Vouchers

```
POST /realms/{realm}/tidevouchers/fromUserSession?sessionId={sid}
```

Gets vouchers for a user session. Role-based: `signin`/`updateaccount` always allowed; `vendorsign` requires `_tide_*` or authorizer role; `vendordecrypt` requires `_tide_*.selfdecrypt` role. The SDK constructs this URL internally.

```
POST /realms/{realm}/tidevouchers/fromAuthSession?sessionId={sid}&tabId={tab}&clientId={id}
```

Gets vouchers during authentication flow (login).

### DPoP Auth Page

```
GET /realms/{realm}/tide-idp-resources/clientIframe/iss/{iss}/aud/{aud}/tide_dpop_auth.html
```

Serves the DPoP authentication iframe HTML. `iss` and `aud` are hex-encoded. The SDK uses this internally.

### Token Exchange (RFC 8693)

```
POST /realms/{realm}/protocol/openid-connect/token
```

Standard OIDC token endpoint used for RFC 8693 token exchange (server-to-server, e.g. a backend calling a downstream protected service on behalf of the user):
- `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`
- `subject_token=<user access token>`
- `actor_token=<acting-party token>` (optional)

For the shipped .NET wiring, see `playbooks/protect-aspnet-core-asgard.md` (Step 5). Browser-driven server-side delegation (the asgard-tide Node SDK, the same one keylessh uses) is unmerged and intentionally not documented here.

---

## Bootstrap Endpoints

Used during realm initialization. Typically called by the init script, not by app code.

### Realm Setup

```
POST /admin/realms/{realm}/vendorResources/setUpTideRealm
Content-Type: application/x-www-form-urlencoded
Body: email=admin@yourorg.com
```

Full Tide realm setup: creates IDP, key provider, gets free-tier license. `isRagnarokEnabled` optional (default true). Content-Type MUST be form-encoded, not JSON.

### Enable IGA

```
POST /admin/realms/{realm}/tide-admin/toggle-iga
Content-Type: application/x-www-form-urlencoded
Body: isIGAEnabled=true
```

Enables IGA governance for the realm. Sets EdDSA signature algorithm, configures Tide protocol mappers.

### Sign IDP Settings

```
POST /admin/realms/{realm}/vendorResources/sign-idp-settings
```

Signs all Tide IDP settings with the VRK. Required after any IDP config change (logo, background, admin domain, client origins). Without this, the ORK enclave rejects settings as unsigned.

### Admin Invite Link

```
POST /admin/realms/{realm}/tideAdminResources/get-required-action-link
  ?userId={id}&redirectUri={uri}&clientId={id}&lifespan=43200
Body: ["link-tide-account-action"]
```

Generates a link for the admin user to link their Tide account. Time-limited (default 12 hours).

---

## IGA Change-Request Endpoints

Used for multi-admin governance approval flows. **Current surface: `/iga/change-requests/...`** (iga-core), confirmed by Tide 2026-07-07 (GAP-065). This **replaces** the legacy `/tide-admin/change-set/...` surface. Full spec, payloads, status codes, and the bootstrap approve/commit loop: **`canon/iga-change-requests-api.md`**.

### List / get change requests

```
GET /admin/realms/{realm}/iga/change-requests?status=PENDING   # PENDING|APPROVED|DENIED|CANCELLED
GET /admin/realms/{realm}/iga/change-requests/{id}
```

Each CR object is keyed by `id` (replaces legacy `draftRecordId`), with `entityType`, `actionType`, `status`, `readyToCommit`, `threshold`, `authorizers[]`, `dependsOn`/`blocked`.

### Authorize (sign) and Commit

```
POST /admin/realms/{realm}/iga/change-requests/{id}/authorize    Body: {} (optional)   → 200/403/409
POST /admin/realms/{realm}/iga/change-requests/{id}/commit                              → 200/412
```

Batch approve (bootstrap): `POST /admin/realms/{realm}/iga/change-requests/bulk-authorize` with `{ "actionTypeIn": ["CREATE","DELETE"], "limit": 100 }` (429 if a bulk run is already in progress). Bulk authorizes but does not commit — commit the CRs that become `readyToCommit`.

### Deny

```
POST /admin/realms/{realm}/iga/change-requests/{id}/deny         → 204
```

### Two-phase approval (Tide MultiAdmin, enclave)

```
GET  /admin/realms/{realm}/iga/change-requests/{id}/approval-model   → { changeRequestId, requestModel(base64) }
POST /admin/realms/{realm}/iga/change-requests/{id}/approval-model   Body: { "requestModel": "<base64 doken>" }
                                                                     → { recorded, authCount, threshold }
```

### Comments and ADOPT

```
GET/POST /admin/realms/{realm}/iga/change-requests/{id}/comments        Body: { "comment": "..." } (≤2000)
PUT/DELETE /admin/realms/{realm}/iga/change-requests/{id}/comments/{commentId}
POST /admin/realms/{realm}/iga/adopt   Body: { "entityType": "USER", "entityId": "..." }   → 201/409
GET  /admin/realms/{realm}/iga/change-requests/{id}/diagnostic-bundle
```

**Legacy → current:** `change-set/{type}/requests` → `iga/change-requests?status=PENDING`; `change-set/sign[/batch]` → `iga/change-requests/{id}/authorize` (+ `bulk-authorize`); `change-set/commit[/batch]` → `iga/change-requests/{id}/commit`; `change-set/cancel` → `.../{id}/deny`; `tideAdminResources/add-review` → `.../{id}/approval-model`; field `draftRecordId` → `id`. Enabling IGA is unchanged: `POST /admin/realms/{realm}/tide-admin/toggle-iga`.

---

## Policy and Contract Endpoints

Served under `@Path("iga")`. (The older `tide-admin/policy-templates`, `tide-admin/ssh-policies`, `tide-admin/realm-policy`, and `role-policy/{id}/init-cert` endpoints no longer exist on main.)

### Role Policies

```
GET    /admin/realms/{realm}/iga/role-policies
GET    /admin/realms/{realm}/iga/role-policies/{id}
GET    /admin/realms/{realm}/iga/role-policies/name/{name}
POST   /admin/realms/{realm}/iga/role-policies
DELETE /admin/realms/{realm}/iga/role-policies/{id}
DELETE /admin/realms/{realm}/iga/role-policies/name/{name}
```

POST body (`IgaRolePolicyRepresentation`): `{ name, policy, policySig, contractId, approvalType, executionType, threshold, policyData }`. `name`, `policy`, and `policySig` are required (`policySig` ≤ 512 chars).

### Forseti Contracts

```
GET    /admin/realms/{realm}/iga/forseti-contracts
GET    /admin/realms/{realm}/iga/forseti-contracts/{id}
POST   /admin/realms/{realm}/iga/forseti-contracts
DELETE /admin/realms/{realm}/iga/forseti-contracts/{id}
```

POST body (`IgaForsetiContractRepresentation`): `{ contractCode, name }`. Returns the stored contract with its `contractHash` (SHA-512 of the source).

---

## VRK and Licensing Endpoints

Infrastructure-level. Used during initial setup and license rotation.

```
POST /admin/realms/{realm}/vendorResources/generate-initial-key
POST /admin/realms/{realm}/vendorResources/switch-vrk
GET  /admin/realms/{realm}/vendorResources/isPendingLicenseActive
GET  /admin/realms/{realm}/vendorResources/getLicenseDetails
GET  /admin/realms/{realm}/vendorResources/licenseHistory
```

Initial license issuance is driven by `setUpTideRealm` (free-tier); ongoing license drafts/trigger/history are handled by the IGA licensing endpoints (`/iga/licensing/*`).

---

## Utility Endpoints

```
GET /admin/realms/{realm}/vendorResources/get-tide-jwk
```

---

## Other IGA Endpoints

Also served under `@Path("iga")` / `@Path("iga-tve")` (plus a `tide-admin` user-context read):

```
GET|POST|DELETE /admin/realms/{realm}/iga/authorizers[/{id}]     # realm authorizer (firstAdmin/multiAdmin) config
GET|POST        /admin/realms/{realm}/iga/server-certs[...]      # server-identity / mTLS cert issuance (request/issue/revoke/active/instance)
GET|POST        /admin/realms/{realm}/iga/licensing/[...]        # license drafts / trigger / history
POST            /admin/realms/{realm}/iga-tve/tve-bundle         # TVE attestation-unit bundle export (CBOR/JSON)
GET             /admin/realms/{realm}/tide-admin/user-context/{userId}/{clientId}   # effective user context (roles/claims) for a client
```

---

## Branding Endpoints

```
POST   /admin/realms/{realm}/tide-idp-admin-resources/images/upload
  Multipart: fileData, fileName, fileType

DELETE /admin/realms/{realm}/tide-idp-admin-resources/images/{type}/delete
GET    /admin/realms/{realm}/tide-idp-admin-resources/images/{type}/name
GET    /realms/{realm}/tide-idp-resources/images/{type}
```
