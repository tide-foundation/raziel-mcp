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

Returns the client adapter JSON with Tide-specific fields (`jwk`, `vendorId`, `homeOrkUrl`, `client-origin-auth-*`). `clientId` is the client **UUID**, not its name. The `jwk` field (`{"keys":[...]}`) is present once the realm has a `tide-vendor-key` component with an EdDSA key; it is **not** gated on IGA (VERIFIED 2026-10-07, `tidecloak-idp-extensions` `VendorResource.java`). The browser SDK also needs `client-origin-auth-<origin>` for the origin the app is served from: a new redirect origin needs `sign-idp-settings` re-run and the adapter re-exported. Save as `data/tidecloak.json`.

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

Gets vouchers for a user session. The **browser** (enclave/SDK) fetches the voucher from this TideCloak URL and hands it to the ORK, which validates it with the Payer; ORKs do not call TideCloak for vouchers. Role-based: `signin`/`updateaccount` always allowed. `vendorsign` **and** `vendordecrypt` are both granted on ONE condition: the user holds any role named `_tide_*`, a role with attribute `isAuthorizerRole=true`, or `tide-realm-admin`. There is no separate `.selfdecrypt` check at this endpoint (VERIFIED 2026-10-07, `tidecloak-idp-extensions` `VoucherResource.java`) — the realm default role's composites count for every user, so do not treat the voucher as the access-control boundary for decryption. The SDK constructs this URL internally.

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
Body: email=$TIDE_LICENSE_EMAIL   # the address the USER gave; ask first, with the Terms (AP-90)
```

Full Tide realm setup: creates IDP, key provider, gets free-tier license. Content-Type MUST be form-encoded, not JSON. Requires `manage-realm`.

Form parameters (VERIFIED 2026-10-07 against `tidecloak-idp-extensions` `main`, `VendorResource.java`):

| Param | Default | Effect |
|---|---|---|
| `email` | — | **Selects the free tier.** Free tier + a non-blank email activates a licence immediately. A blank or missing email does **not** fail: it silently switches to a paid Stripe checkout session. |
| `licensingTier` | `free` | Any non-free tier goes to Stripe checkout. |
| `isRagnarokEnabled` | `true` | Turns offboarding **backup on**. See the Ragnarok notes in `canon/concepts.md`. |
| `skipLicense` | `false` | Creates the IdP and returns early with `{"status":"idp-created"}`; no licence, no VRK. This is what the admin console sends. |

No parameter carries Terms & Conditions acceptance, and nothing server-side records it. Agreement happens only where the operator is asked (AP-90).

**Response — DIFFERS ON `main`.** This pack recorded a 200 with an `activationPackage` containing a `gVRK` (measured 2026-08-06 on `tidecloak-dev`). On `main` the body is plain text: **`CREATED`** (licensed and IdP settings signed), **`NEED_PAYMENT`** (also HTTP 200 — **not** licensed), or a **303** whose body is a Stripe checkout URL. A 200 is therefore not proof of a licence on either build. The pack's scripts fail on `NEED_PAYMENT` and on a 303.

### Enable IGA

```
POST /admin/realms/{realm}/tide-admin/toggle-iga
Content-Type: application/x-www-form-urlencoded
Body: isIGAEnabled=true
```

Enables IGA governance for the realm. On enable it sets `iga.attestor=tide` and the EdDSA signature algorithm (when the realm has a `tide` IdP, a `tide-vendor-key` component and an active VRK), and invalidates every user session on the realm.

⚠️ **DIFFERS ON `main`: it is a flip, not a setter.** `isIGAEnabled` is ignored and each call inverts the current state; a second call queues a `DISABLE_IGA` change request (202). Read `GET /admin/realms/{realm}/tide-admin/iga-status` first and call this once. A 200 can still carry `warnings` (a failed signing sweep leaves baseline requests PENDING and logins fail closed). See `canon/iga-change-requests-api.md`.

### Sign IDP Settings

```
POST /admin/realms/{realm}/vendorResources/sign-idp-settings
```

Signs all Tide IDP settings with the VRK. Required after any IDP config change (logo, background, admin domain, client origins). Without this, the ORK enclave rejects settings as unsigned.

### Admin Invite Link

```
POST /admin/realms/{realm}/tideAdminResources/get-required-action-link
  ?userId={id}&redirect_uri={uri}&client_id={id}&lifespan=43200
Body: ["link-tide-account-action"]
```

Generates a link for the admin user to link their Tide account. Time-limited (default 12 hours). Returns the URL as text.

The optional query parameters are the OIDC names **`redirect_uri`** and **`client_id`** (snake_case). `redirectUri` / `clientId` are not read and are silently ignored — earlier revisions of this file used them. VERIFIED 2026-10-07 against the server and the admin client, which agree. `GET /admin/realms/{realm}/tideAdminResources/users/{id}/committed` → `{committed}` tells you beforehand whether a link can be generated under IGA.

---

## IGA Change-Request Endpoints

Used for multi-admin governance approval flows. **Current surface: `/iga/change-requests/...`** (iga-core), confirmed by Tide 2026-07-07 (GAP-065). This **replaces** the legacy `/tide-admin/change-set/...` surface. Full spec, payloads, status codes, and the bootstrap approve/commit loop: **`canon/iga-change-requests-api.md`**.

### List / get change requests

```
GET /admin/realms/{realm}/iga/change-requests?status=PENDING   # PENDING|APPROVED|DENIED|CANCELLED
GET /admin/realms/{realm}/iga/change-requests/{id}
```

The response is a JSON **ARRAY** of CR objects (observed on Keycloak 26.7.0); each carries a top-level `id` (replaces legacy `draftRecordId`), plus `entityType`, `actionType`, `status`, `readyToCommit`, `threshold`, `authorizers[]`, `dependsOn`/`blocked`. Earlier pack text described an object keyed by `id` — **accept both shapes**. VERIFIED (LEARNINGS-agent-quorum-001 L-04).

### Authorize (sign) and Commit

```
POST /admin/realms/{realm}/iga/change-requests/{id}/authorize    Body: {} (optional)   → 200/403/409
POST /admin/realms/{realm}/iga/change-requests/{id}/commit                              → 200/412
```

Batch approve: `POST /admin/realms/{realm}/iga/change-requests/bulk-authorize` with real, granular action types, e.g. `{ "actionTypeIn": ["ADOPT_ROLE","CREATE_USER"], "limit": 100 }`, or `{ "crIdIn": [...] }` (429 if a bulk run is already in progress). **`["CREATE","DELETE"]` matches nothing and authorizes zero requests with a 200** — earlier revisions of this line showed exactly that. Whether it also commits differs between the measured build and `main`; read `results[].status`. Prefer the per-id loop in `canon/iga-change-requests-api.md`.

### Deny

```
POST /admin/realms/{realm}/iga/change-requests/{id}/deny         → 204
```

### Approve (every mode; two-phase with the enclave in Tide MultiAdmin)

```
POST /admin/realms/{realm}/iga/change-requests/{id}/approve   Body: {}
     → { mode: "recorded", committed, authCount, threshold, readyToCommit, status }       # done
     → { mode: "needs-approval", changeRequestId, actionType, requestModel(base64) }      # sign in the enclave, then:
POST /admin/realms/{realm}/iga/change-requests/{id}/approve   Body: { "requestModel": "<base64 signed request>" }
     → { mode: "recorded", committed, authCount, threshold, readyToCommit, status }
```

This is the only approval call the admin console makes. `.../{id}/approval-model` (GET/POST) is the older exchange: still present as back-compat, does not commit, no longer used by the console.

### Comments and ADOPT

```
GET/POST /admin/realms/{realm}/iga/change-requests/{id}/comments        Body: { "body": "..." } (≤2000; `comment` also accepted)
PUT/DELETE /admin/realms/{realm}/iga/change-requests/{id}/comments/{commentId}
POST /admin/realms/{realm}/iga/adopt   Body: { "entityType": "USER", "entityId": "..." }   → 201/409
GET  /admin/realms/{realm}/iga/change-requests/{id}/diagnostic-bundle
```

**Legacy → current:** `change-set/{type}/requests` → `iga/change-requests?status=PENDING`; `change-set/sign[/batch]` → `iga/change-requests/{id}/authorize` (+ `bulk-authorize`); `change-set/commit[/batch]` → `iga/change-requests/{id}/commit`; `change-set/cancel` → `.../{id}/deny`; `tideAdminResources/add-review` (now 410 Gone) → `.../{id}/approve`; field `draftRecordId` → `id`. Enabling IGA is unchanged: `POST /admin/realms/{realm}/tide-admin/toggle-iga`.

---


> _Withheld: uploading a custom Forseti contract is done by the Tide team (experimental, test networks only). Do not reconstruct this step._

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

> _Withheld: uploading a custom Forseti contract is done by the Tide team (experimental, test networks only). Do not reconstruct this step._

## VRK and Licensing Endpoints

Infrastructure-level. Used during initial setup and license rotation.

```
POST /admin/realms/{realm}/vendorResources/CreateTideVendorKey     # form: licensingTier (+ requestedUsers) → CREATED | NEED_PAYMENT | 303 Stripe URL
POST /admin/realms/{realm}/vendorResources/force-gen-vrk
POST /admin/realms/{realm}/vendorResources/force-rotate-vrk
POST /admin/realms/{realm}/vendorResources/force-switch-vrk
GET  /admin/realms/{realm}/vendorResources/latest-rotation-error
GET  /admin/realms/{realm}/vendorResources/isPendingLicenseActive
GET  /admin/realms/{realm}/vendorResources/getLicenseDetails
GET  /admin/realms/{realm}/vendorResources/licenseHistory
```

`generate-initial-key` and `switch-vrk`, listed here in earlier revisions, do not exist on `tidecloak-idp-extensions` `main` (VERIFIED 2026-10-07). Initial license issuance is driven by `setUpTideRealm` (free-tier); ongoing license drafts/trigger/history are handled by the IGA licensing endpoints (`/iga/licensing/*`).

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

The enclave displays a realm **logo** and **background image**. Uploading is only half of it — the
realm must then be pointed at the image and the settings **re-signed**, because the enclave verifies
the signed settings blob.

```
POST   /admin/realms/{realm}/tide-idp-admin-resources/images/upload
  Multipart: fileData, fileName, fileType      # fileType = LOGO | BACKGROUND_IMAGE
  Returns:  {"hash":"<sha256 hex>","name":"<stored name>"}

POST   /admin/realms/{realm}/vendorResources/set-branding
  Body: {"backgroundUrl":"...","logoUrl":"..."}   # save AND re-sign, atomically

GET    /admin/realms/{realm}/vendorResources/get-branding
DELETE /admin/realms/{realm}/tide-idp-admin-resources/images/{type}/delete
GET    /admin/realms/{realm}/tide-idp-admin-resources/images/{type}/name
GET    /realms/{realm}/tide-idp-resources/images/{type}      # PUBLIC, no auth
```

**Upload constraints — VERIFIED** against `TideIdpAdminRealmResource.java` (2026-08-11):

| | |
|---|---|
| `fileType` | `LOGO` or `BACKGROUND_IMAGE` |
| Formats | `png`, `jpg`, `jpeg`, `gif`, `webp` — an **allowlist keyed off the FILENAME extension**. **SVG is rejected** (`400`) |
| Max size | **5 MB** → `413` beyond it |
| Dimensions | **not validated at all** — sizing is purely a rendering concern |
| Storage | one file per `fileType`; a new upload **deletes and replaces** the previous |
| Auth | `manage-realm` |

Because the allowlist keys off the *filename*, a mislabelled file (`logo.png` holding JPEG bytes) can
upload and then fail to render. Validate the actual bytes.

**Build a versioned serve URL** from the returned hash, or a replaced image is served from cache:

```
{auth-server-url}/realms/{realm}/tide-idp-resources/images/{LOGO|BACKGROUND_IMAGE}?v=<hash>
```

**`set-branding` is save AND sign in one call.** It writes IdP config `ImageURL` (background) and
`LogoURL` (logo), then **re-signs the settings blob from the updated config**. An absent field is left
unchanged; a field present as a string (even `""`) overwrites. A failed ORK signing returns `500`
rather than silently leaving stale/unsigned branding. Do **not** write `ImageURL`/`LogoURL` via the
generic IdP-update endpoint and skip the signature — the enclave verifies the blob.

> **Branding is IGA-EXEMPT.** The config write is flagged `IGA_VENDOR_PROVISIONING`, exactly like
> `sign-idp-settings`, so it is **not** captured as a change request. It is one of the few admin
> writes needing no authorize/commit drain — even on a multiAdmin realm, so branding can be fixed
> after the one-way flip without an enclave ceremony.

**Doing all of this in one command**: `templates/enclave-branding/brand-tidecloak.sh --realm <realm>` generates, validates, uploads both, saves+signs and verifies. VERIFIED end to end on a live Tide realm (served bytes byte-identical to the uploaded files). It pre-flights the **`tide-vendor-key` component** — what `set-branding` actually requires — and refuses before uploading on an unlicensed realm; note an unlicensed realm still returns 200 for `identity-provider/instances/tide`, so that is the wrong check.

**Producing the assets**: `templates/enclave-branding/` ships a dependency-free generator
(`make-branding.py` — no image model, no Pillow) plus a validator (`check-branding.py`) and
image-model prompts. Geometry is **MEASURED** from the live enclave stylesheet, not assumed: the logo
is painted into a **circular** container (`border-radius: 50%`) using `background-size: cover` — it
**fills and crops**, it does not fit-inside — on a **white** plate, rendering at **85–153 CSS px**.
So: logo **square, 1024×1024 PNG with alpha**, every element **inside the inscribed circle**
(≥14.65% inset for a square mark), and dark enough to read on white. A non-square logo loses the ends
of its long axis. Background **16:9, ≥1920×1080, JPEG**, full-bleed `cover`, with a **quiet,
low-contrast centre** because the login card sits on top of the middle. Tide's own defaults are
**838×838** and **3840×2160**. Nothing server-side validates dimensions; the only enforced limits are
format (**no SVG**) and **5 MB**.
