# TideCloak Bootstrap — Canon

Canonical reference for starting TideCloak and preparing a realm before any app-level Tide integration begins.

Bootstrap is infrastructure work. It produces a running TideCloak with a configured realm, a linked admin, and an exported adapter JSON. App integration (SDK wiring, route protection, API auth) is a separate concern covered by the app-level canon and playbooks.

---

## Bootstrap Paths

| Path | When to use | How |
|------|-------------|-----|
| **Generated app** (default) | New project from template | `npm run init` runs the bundled init script. Handles everything below automatically. |
| **Manual / BYO TideCloak** (advanced) | Existing TideCloak instance, custom realm, or non-template project | Follow the playbook chain: `start-tidecloak-dev` → `bootstrap-realm-from-template` → `initialize-admin-and-link-account`. |

### Generated app flow

Templates include `scripts/init-tidecloak.sh` and a `"init"` script in package.json. The dev workflow is:

```bash
npm install
npm run init    # starts TideCloak, creates realm, exports tidecloak.json
npm run dev
```

The init script:
1. Starts TideCloak dev container (Docker required)
2. Creates realm from bundled template
3. Runs Tide licensing + IGA setup
4. Creates admin user with `tide-realm-admin` role
5. Prints an invite link (admin must open in browser to link Tide account)
6. Waits for account linking
7. Approves change requests
8. Exports `data/tidecloak.json` with Tide extensions

After init, the app is ready. No manual TideCloak configuration needed.

**Bootstrap order rule**: Always run bootstrap before writing app code. If the app imports `tidecloak.json` at compile time (e.g., TypeScript `import tcConfig from '../../data/tidecloak.json'`), create an empty placeholder file (`echo '{}' > data/tidecloak.json`) before the first build. The init script overwrites it with the real adapter. Add `data/tidecloak.json` to `.gitignore`.

### Manual / BYO TideCloak flow

For projects that do not use the init script, follow the manual sequence below. This is also the path for connecting to an existing TideCloak instance.

---

## Scope Boundary

| Concern | Covered here | Covered elsewhere |
|---------|-------------|-------------------|
| Docker container lifecycle | Yes | — |
| Realm creation from template | Yes | — |
| Tide licensing + IGA enablement | Yes | — |
| Admin user creation + account linking | Yes | — |
| Change request approval (bootstrap phase) | Yes | `setup-iga-admin-panel` for runtime |
| Adapter JSON export | Yes | — |
| E2EE role + policy setup | Yes (realm prep) | `setup-forseti-e2ee` for app-level |
| SDK wiring, provider, CSP | No | `add-auth-nextjs-fresh` et al. |
| JWT verification, DPoP | No | `verify-jwt-server-side` |

---

## Docker Images

| Image | Use when | Forseti support | ORK env vars required |
|-------|----------|----------------|-----------------------|
| `tideorg/tidecloak-dev:latest` | Standard development, full Tide protocol | Yes | **No** — built-in defaults |
| `tideorg/tidecloak-stg-dev:latest` | Staging, testing pre-release features | Yes | **Yes** — must be provided |

**Role mapper fallback (defensive)**: The Tide role/claim mappers in the shipped realm templates use **stock Keycloak mapper types** — `oidc-usermodel-attribute-mapper` (for `tideUserKey`/`vuid`) and `oidc-hardcoded-claim-mapper` (for `t.uho`). There is no distinct `tide-roles-mapper` provider in the extension repos on `main`; a mapper by that instance name only appears in some external app realm.json files. A prior note claimed a `tide-roles-mapper` protocolMapper provider exists on the prod image but is silently dropped on the staging image — this could not be confirmed against source and image contents were not inspected. Treat it as unverified. As a defensive measure, include standard Keycloak role mappers (`realm roles`, `client roles`) in the template so token role claims survive regardless of image.

Use `tidecloak-dev` for standard development. It has built-in ORK/threshold defaults and does not need `KC_HOSTNAME`, `SYSTEM_HOME_ORK`, `USER_HOME_ORK`, `THRESHOLD_T`, `THRESHOLD_N`, or `PAYER_PUBLIC`. Use `tidecloak-stg-dev` only when testing against pre-release Tide features.

**Do not append `start-dev` or any command** to `docker run`. TideCloak images have a pre-configured entrypoint — appending `start-dev` (a vanilla Keycloak convention) breaks Tide initialization. See AP-39.

### Dev image docker run (tidecloak-dev)

```bash
sudo docker run -d --name tidecloak \
  -v ./data:/opt/keycloak/data/h2 \
  -p 8080:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin \
  -e KC_BOOTSTRAP_ADMIN_PASSWORD=password \
  tideorg/tidecloak-dev:latest
```

### Staging image docker run (tidecloak-stg-dev)

```bash
sudo docker run -d --name tidecloak \
  -v ./data:/opt/keycloak/data/h2 \
  -p 8080:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin \
  -e KC_BOOTSTRAP_ADMIN_PASSWORD=password \
  -e KC_HOSTNAME=http://localhost:8080 \
  -e SYSTEM_HOME_ORK=https://sork1.tideprotocol.com \
  -e USER_HOME_ORK=https://sork1.tideprotocol.com \
  -e THRESHOLD_T=3 \
  -e THRESHOLD_N=5 \
  -e PAYER_PUBLIC=20000011d6a0e8212d682657147d864b82d10e92776c15ead43dcfdc100ebf4dcfe6a8 \
  tideorg/tidecloak-stg-dev:latest
```

---

## Required Environment Variables

### Core (both images)

| Variable | Purpose | Example |
|----------|---------|---------|
| `KC_BOOTSTRAP_ADMIN_USERNAME` | Initial admin user | `admin` |
| `KC_BOOTSTRAP_ADMIN_PASSWORD` | Initial admin password | `password` |

### Tide protocol (staging image only — tidecloak-stg-dev)

The dev image (`tidecloak-dev`) has these built in. Only set these for `tidecloak-stg-dev`.

| Variable | Purpose | Example |
|----------|---------|---------|
| `KC_HOSTNAME` | Public-facing URL | `http://localhost:8080` |
| `SYSTEM_HOME_ORK` | Tide network entry point | `https://sork1.tideprotocol.com` |
| `USER_HOME_ORK` | User-facing ORK URL | `https://sork1.tideprotocol.com` |
| `THRESHOLD_T` | Signing threshold | `3` |
| `THRESHOLD_N` | Total ORK nodes | `5` |
| `PAYER_PUBLIC` | Payer ORK public key | hex string |

**Anti-pattern:** Omitting Tide env vars. Without `SYSTEM_HOME_ORK`, `USER_HOME_ORK`, `THRESHOLD_T`, `THRESHOLD_N`, and `PAYER_PUBLIC`, the Tide IdP provider does not initialize. Required actions like `link-tide-account-action` never register, and the init script fails with "Could not find configuration for Required Action". VERIFIED.

---

## Initialization Sequence

Order matters. Do not skip or reorder steps.

| # | Step | API / action | Produces |
|---|------|-------------|----------|
| 1 | Clean previous state | `docker rm`, clear `data/keycloakdb*`, `chown 1000:1000 data/` | Clean slate |
| 2 | Start container | `docker run` with correct image + env vars | Running TideCloak |
| 3 | Wait for readiness | Poll `GET /` until 200 | Reachable server |
| 4 | Get master admin token | `POST /realms/master/protocol/openid-connect/token` | Bearer token |
| 5 | Create realm | `POST /admin/realms` with realm.json template | Realm + client |
| 6 | Initialize Tide + enable IGA | `POST /admin/realms/{realm}/vendorResources/setUpTideRealm` then `POST /admin/realms/{realm}/tide-admin/toggle-iga` | License activated, VRK generated, IGA enabled |
| 7 | Approve client + role change requests | `authorize` + `commit` on `/iga/change-requests` (bulk-authorize then commit ready CRs; see `canon/iga-change-requests-api.md`). **Roles must be approved here** — with IGA enabled, change requests are created in `PENDING` status (there is no `DRAFT` status token); `setUpTideRealm` creates `tide-realm-admin` as a draft. `tide-realm-admin` is a client role on `realm-management`; it is granted to the first admin via firstAdmin auto-commit during the login-closure converge, after which a `REGEN_ADMIN_POLICY` change request flips the authorizer from `firstAdmin` to `multiAdmin`. Without approving the pending role CRs here, role lookups in Step 8c fail. | Client config + roles committed |
| 8 | Create admin user | `POST /admin/realms/{realm}/users` (returns 202 → user-creation change request) | User creation change request created |
| 8b | Approve user creation | `authorize` + `commit` on `/iga/change-requests` | User queryable. **Must happen before role assignment.** |
| 8c | Assign tide-realm-admin role | Assign `tide-realm-admin` client role on `realm-management`. Validate role lookup returns a role, not an error. | Admin user has role |
| 9 | Generate invite link | `POST /tideAdminResources/get-required-action-link` with `["link-tide-account-action"]` | URL for admin to link Tide account |
| 10 | Wait for account linking | Poll user `tideUserKey` attribute until non-empty | Admin has Tide identity |
| 11 | Approve role assignment change requests | `authorize` + `commit` on `/iga/change-requests` | Admin roles committed |
| 12 | Update CustomAdminUIDomain | `PUT /identity-provider/instances/tide` then `POST /vendorResources/sign-idp-settings` | Enclave approval popups work from app origin |
| 13 | Export adapter JSON | `GET /vendorResources/get-installations-provider?clientId={uuid}&providerId=keycloak-oidc-keycloak-json` | `tidecloak.json` with `jwk`, `vendorId`, `homeOrkUrl` |

---

## Critical Endpoint Details

### setUpTideRealm

- Path: `POST /admin/realms/{realm}/vendorResources/setUpTideRealm`
- Content-Type: `application/x-www-form-urlencoded` (NOT JSON)
- Body: `email=admin@yourorg.com` (required, URL-encoded)
- Handles license activation automatically. No manual "Manage License" step needed.

**Anti-pattern:** Using `/tide-admin/setUpTideRealm`. Wrong path. Returns 404. VERIFIED.

**Anti-pattern:** Sending JSON to this endpoint (instead of `x-www-form-urlencoded`). Causes the setup to fail with "Tide realm setup failed" / "Could not set up the Tide realm". VERIFIED.

### toggle-iga

- Path: `POST /admin/realms/{realm}/tide-admin/toggle-iga`
- Content-Type: `application/x-www-form-urlencoded`
- Body: `isIGAEnabled=true`

### Approve/commit change requests

Current `/iga/change-requests/...` surface (replaces legacy `/tide-admin/change-set/...`, GAP-065). **Full spec + bootstrap loop: `canon/iga-change-requests-api.md`.**
- List pending: `GET /admin/realms/{realm}/iga/change-requests?status=PENDING` (objects keyed by `id`)
- Authorize (sign): `POST /admin/realms/{realm}/iga/change-requests/{id}/authorize` (body `{}` optional; records an approval, does **not** commit; simple firstAdmin/Tideless lane — refuses multiAdmin CRs)
- Batch authorize (bootstrap): `POST /admin/realms/{realm}/iga/change-requests/bulk-authorize` with `{ "actionTypeIn": ["CREATE","DELETE"], "limit": 100 }`
- Approve (multiAdmin): `POST /admin/realms/{realm}/iga/change-requests/{id}/approve` (enclave lane; approves AND auto-commits once quorum met — the console "Authorize" button)
- Commit: `POST /admin/realms/{realm}/iga/change-requests/{id}/commit` (explicit apply-only; 412 if under threshold / unmet dependency)
- FirstAdmin/Tideless: authorize signs server-side. Tide MultiAdmin: use the `{id}/approval-model` enclave exchange, then `approve`.

> **Legacy-bootstrap note.** The bootstrap init script (`init_tidecloak.sh`) on the keycloak-IGA fork still drives the **legacy** `/tide-admin/change-set/*` surface (`sign`/`commit`, and `/sign/batch` + `/commit/batch` with `{ "changeSets": [...] }`). That surface is stale — it is kept here only to explain what the existing script calls; reach for `/iga/change-requests/*` in new integration code.

### Adapter config export

- Path: `GET /admin/realms/{realm}/vendorResources/get-installations-provider`
- Query: `clientId={uuid}&providerId=keycloak-oidc-keycloak-json`
- The `jwk` field is injected only when a `tide-vendor-key` component and its EdDSA signing key exist on the realm. `setUpTideRealm` creates both, so `jwk` appears once licensing has run. It is **not** gated on IGA. If `jwk` is missing, the remedy is to ensure `setUpTideRealm` ran successfully (not to enable IGA).

---

## Realm Template Requirements

The realm.json template must include ALL of the following. Missing any section causes silent failures.

| Section | Required for | Failure if missing |
|---------|-------------|-------------------|
| `requiredActions` with `link-tide-account-action` | Admin invite links | Invite link generation fails |
| `authenticationFlows` with `tidebrowser` | Tide login flow | Login uses default Keycloak flow, not Tide |
| `authenticatorConfig` with `defaultProvider: tide` | IdP redirect | Users not redirected to Tide IdP |
| `browserFlow: "tidebrowser"` | Flow binding | Auth flow not activated |
| `protocolMappers` (Tide User Key, IGA Role Mapper, vuid) | JWT claims | Missing `tideuserkey`, `vuid`, roles in tokens |
| `components` (user profile) | User attributes | Attribute storage fails |
| `roles.realm` with `_tide_enabled` in default composite | Voucher system | Users cannot perform Tide operations |
| `UPDATE_PASSWORD` disabled | Tide auth model | Password update prompt conflicts with PRISM |

**Anti-pattern:** Creating a minimal realm.json. Every section above is mandatory. VERIFIED.

**Anti-pattern:** Including `identityProviders` in realm template when `setUpTideRealm` runs after import. `setUpTideRealm` creates the Tide IDP internally. A duplicate `tide` IDP in the template causes `ModelDuplicateException`, which breaks licensing and prevents `tide-realm-admin` from being created. Remove `identityProviders` from the template. VERIFIED (LEARNINGS-batch-006 L-01).

**Anti-pattern:** Placing `unmanagedAttributePolicy` at realm top level. Keycloak 26+ expects it inside `components.org.keycloak.userprofile.UserProfileProvider[0].config.kc.user.profile.config` as part of the embedded JSON string. Top-level placement causes HTTP 400 on import or silently drops `tideUserKey`/`vuid` attributes during account linking. VERIFIED (LEARNINGS-batch-006 L-02).

**Duplicate default role warning**: TideCloak may create a duplicate default role during IGA-enabled realm setup (e.g., `default-roles-myapp-1` alongside `default-roles-myapp`). The duplicate is empty — new users assigned to it get none of the `_tide_*` voucher roles. After user creation, explicitly verify the user has `_tide_*` roles. If missing, assign them via admin API. With IGA enabled, role assignment change-sets require browser enclave approval (`requiresApprovalPopup: true`). VERIFIED (learning-batch-004, L-08).

### Manual realm creation (without template)

If creating a realm without the full template (e.g., `POST /admin/realms` with `{"realm":"myapp","enabled":true}`), you must manually register `link-tide-account-action`:

```bash
curl -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/authentication/register-required-action" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"providerId":"link-tide-account-action","name":"Link Tide Account"}'
```

Without this, invite links redirect to VERIFY_PROFILE or the default login flow instead of Tide account linking. VERIFIED (session-001).

### Admin user profile requirements

When creating the admin user, always set `firstName` and `lastName`:

```json
{"username":"admin","email":"admin@yourorg.com","firstName":"Admin","lastName":"User","enabled":true}
```

If these fields are empty, TideCloak's `VERIFY_PROFILE` required action fires before the Tide account linking flow, blocking bootstrap. Alternatively, disable `VERIFY_PROFILE` as a default required action on the realm. VERIFIED (session-001).

### Bootstrap script fail-fast rule

The bootstrap/init script must check the HTTP status of every critical step and abort on failure. In particular:

- Realm import (`POST /admin/realms`) must return 2xx. If it returns 400/409/500, stop. Do not continue to licensing or IGA.
- `setUpTideRealm` must return 200. If it fails, the realm is unlicensed and all subsequent steps are invalid.

**Anti-pattern:** Continuing bootstrap after realm import failure. Later steps (licensing, IGA, user creation) either fail silently or produce garbage state. Agent wastes multiple rounds debugging cascaded failures. VERIFIED (session-001).

---

## Hosted / SaaS Multi-Tenant Provisioning

When bootstrapping realms programmatically on a hosted TideCloak instance (e.g., `login.dauth.me`) for a multi-tenant SaaS application, the same initialization sequence applies but with critical differences. VERIFIED (Ratidefy SaaS, ratidefy.com).

### Two-Phase Provisioning

Role assignment MUST happen after the admin user links their Tide account. IGA change requests require a Tide doken to be signable. Without a linked identity, the authorize endpoint returns 200 but the change request remains unsigned/uncommitted permanently.

**Phase A** (automated, before user interaction):
Steps 1–9 from the standard sequence, EXCEPT step 8c (role assignment). Generate the invite link at the end.

**Phase B** (after user links Tide account via invite link):
Step 8c (assign role) → Step 11 (approve role change-sets).

**Anti-pattern:** Assigning `tide-realm-admin` before the user links their Tide account. Creates an unsignable DRAFT change request. The only recovery is to delete the draft and re-assign after linking. VERIFIED.

### client-origin-auth Key Format

The adapter config exported from TideCloak includes keys like:
```
"client-origin-auth-https://myapp.example.com": "E1Kaff...=="
```

The **origin URL is part of the key name**, not just metadata. When storing adapter config fields in a database for dynamic serving, preserve the full key name. Storing only the value produces invalid config that causes `[HEIMDALL] Client origin could not be verified`.

**Correct storage format** (e.g., JSON column):
```json
{ "key": "client-origin-auth-https://myapp.example.com", "value": "E1Kaff...==" }
```

VERIFIED.

### IDP Settings Signing

After setting `CustomAdminUIDomain` on the Tide IDP, you MUST call:
```
POST /admin/realms/{realm}/vendorResources/sign-idp-settings
```

Without this step, the Tide enclave rejects all signing/encryption requests from the configured origin with `Client origin could not be verified`. The sign step cryptographically binds the IDP settings to the ORK network. VERIFIED.

### Path-Based vs Subdomain Tenant Routing

If using path-based routing (`myapp.com/t/<tenant>/`) instead of subdomains (`tenant.myapp.com`):
- Set redirect URIs on the **root domain** (`https://myapp.com/*`), not per-tenant subdomains
- `CustomAdminUIDomain` must be the root domain (`https://myapp.com`)
- The `client-origin-auth` key will reference the root domain

Subdomain routing requires a wildcard SSL certificate. Azure App Service managed certs do not support wildcards — use path-based routing or Azure Front Door. VERIFIED.

### JWT kid Requirement

Some TideCloak realm configurations produce JWTs with missing `kid` (Key ID) in the header. The standard Keycloak admin REST API requires `kid` to verify token signatures. Tokens without `kid` cause 401 on all admin API calls even with valid roles.

**Symptom**: Token has all admin roles (`realm-admin`, `manage-users`, etc.) but admin API returns `{"error":"HTTP 401 Unauthorized"}`. TideCloak logs: `kid is null, cant find public key: realm={0}`.

**Fix**: Recreate the realm. The `kid` issue is a realm configuration problem, not a token issue. VERIFIED.

### DPoP on Hosted Instances

DPoP (`useDPoP: { mode: 'strict', alg: 'EdDSA' }`) may not be supported on all hosted TideCloak instances. Enabling DPoP on `login.dauth.me` caused 500 on the token endpoint. Do not enable DPoP unless confirmed supported by the hosting provider. Standard `secureFetch` without DPoP works for admin API calls when the token has a valid `kid`. VERIFIED.

---

## Data Directory Rules

- Mount `./data:/opt/keycloak/data/h2`, never the project root.
- Run `mkdir -p ./data && sudo chown -R 1000:1000 ./data` before starting.
- Clear stale DB files between fresh setups: `sudo rm -f ./data/keycloakdb*`
- Never mount a docker-compose named volume on a standalone `docker run`.

**Failure mode:** Mounting `.:/opt/keycloak/data/h2` (project root) causes `AccessDeniedException` because Docker writes DB files as UID 1000. VERIFIED.

**Failure mode:** Stale DB files cause "Could not open file keycloakdb.mv.db". VERIFIED.

---

## Dev vs Production Separation

| Aspect | Dev (this canon) | Production |
|--------|-----------------|------------|
| Database | H2 embedded | External PostgreSQL (not documented — contact Tide) |
| Image | `tidecloak-dev` (prod) or `tidecloak-stg-dev` (staging) | `tidecloak-dev` is production-grade |
| Threshold | T=3/N=5 minimum | T=14/N=20 on live network |
| SSL | `sslRequired: external` (HTTP on localhost OK) | HTTPS required everywhere |
| Admin password | Hardcoded in script | Secret management system |
| VRK keys | Per-environment, never shared | Per-environment, never shared |

**Anti-pattern:** Using `THRESHOLD_T=1` in any environment. Single-ORK compromise breaks security. VERIFIED.

**Anti-pattern:** Sharing VRK keys between environments. Breaks rotation lifecycle. VERIFIED.

---

## Verification

Bootstrap is complete when:

- [ ] TideCloak container running, `curl http://localhost:8080` returns 200
- [ ] Realm exists with Tide IdP configured
- [ ] IGA is enabled
- [ ] Admin user has `tide-realm-admin` client role on `realm-management`
- [ ] Admin has linked their Tide account (`tideUserKey` attribute non-empty)
- [ ] All bootstrap change requests approved and committed
- [ ] CustomAdminUIDomain set to app origin
- [ ] Adapter JSON exported with `jwk`, `vendorId`, `homeOrkUrl` fields present
