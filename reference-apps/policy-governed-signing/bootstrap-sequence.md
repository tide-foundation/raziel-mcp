# Bootstrap Sequence — Policy-Governed Signing

All steps must complete before users can safely use signing features. Order matters.

## Phase 1: TideCloak infrastructure

1. **Start TideCloak container**
   - Use `tideorg/tidecloak-dev:latest` — despite the `-dev` suffix this IS the production image and the only supported one. No ORK/threshold env vars needed or wanted.
   - Staging requires `SYSTEM_HOME_ORK`, `USER_HOME_ORK`, `THRESHOLD_T`, `THRESHOLD_N`.
   - Wait for readiness: `curl http://localhost:8080/health/ready` returns 200.

2. **Obtain bootstrap admin token**
   - `POST /realms/master/protocol/openid-connect/token` with `KC_BOOTSTRAP_ADMIN_USERNAME` / `KC_BOOTSTRAP_ADMIN_PASSWORD`.

## Phase 2: Realm and client setup

3. **Import realm template**
   - `POST /admin/realms` with `realm.json`.
   - Template must declare: realm name, OIDC client, `_tide_enabled` role, default-roles composite, protocol mappers.
   - Template should include redirect URIs for all clients.

4. **License the realm**
   - `POST /admin/realms/{realm}/vendorResources/setUpTideRealm` with admin email.
   - Content-Type: `application/x-www-form-urlencoded`. Body: `email=admin@example.com`.
   - Returns licensing JSON as `text/plain`.

5. **Enable IGA**
   - `POST /admin/realms/{realm}/tide-admin/toggle-iga` with **form-encoded** `isIGAEnabled=true`.
     ⚠️ The endpoint reads the FORM parameter. A JSON body is accepted, parsed by nothing, and the
     missing parameter **fails open to `true`** — so `{"enabled":false}` ENABLES IGA. Always
     form-encode, and assert the response, because the endpoint never refuses a wrong request:
     ```bash
     OUT=$(curl -sf -X POST "$URL/admin/realms/$REALM/tide-admin/toggle-iga" \
       -H "Authorization: Bearer $TOKEN" \
       -H 'Content-Type: application/x-www-form-urlencoded' \
       --data-urlencode "isIGAEnabled=true")
     case "$OUT" in *'"enabled":true'*) : ;; *) echo "toggle-iga returned $OUT" >&2; exit 1 ;; esac
     ```
   - Must happen after licensing. Enables change-set governance for role/user mutations.
   - **Assert Tide mode rather than stamping it.** `setUpTideRealm` sets `iga.attestor=tide` on
     current builds, so the old "stamp it first" step is usually already satisfied — and an
     instruction that is already satisfied teaches nothing. What matters is catching the build where
     it is NOT set, because Tide vs Tideless is the difference between governance approvals being
     cryptographically sealed and being enforced by server logic the host controls (GAP-065):
     ```bash
     curl -sf "$URL/admin/realms/$REALM" -H "Authorization: Bearer $TOKEN" \
       | python3 -c 'import json,sys; a=json.load(sys.stdin).get("attributes") or {}; \
           assert a.get("iga.attestor")=="tide", f"TIDELESS mode: {a.get(\"iga.attestor\")}"'
     ```
     If it is absent, stamp it (GET then PUT `/admin/realms/{realm}`) and re-assert.

## Phase 3: Approve initial change requests

6. **Approve initial change requests** (current `/iga/change-requests/...` surface — see `canon/iga-change-requests-api.md`)
   - IGA creates draft change requests for client/role mutations during realm import (each mutating write returns 202).
   - List: `GET /admin/realms/{realm}/iga/change-requests?status=PENDING` (objects keyed by `id`).
   - Approve: `POST /admin/realms/{realm}/iga/change-requests/bulk-authorize` (`{"actionTypeIn":["CREATE","DELETE"],"limit":100}`), then `POST /admin/realms/{realm}/iga/change-requests/{id}/commit` for each `readyToCommit` CR. FirstAdmin bootstrap signs server-side.

## Phase 4: Admin user setup

7. **Create admin user**
   - `POST /admin/realms/{realm}/users` with username, email, enabled=true.

8. **Assign `tide-realm-admin` role**
   - Get role ID: `GET /admin/realms/{realm}/clients/{realm-mgmt-client-id}/roles` and find `tide-realm-admin`.
   - Assign: `POST /admin/realms/{realm}/users/{userId}/role-mappings/clients/{realm-mgmt-client-id}`.

9. **Generate account-linking invite**
   - `POST /admin/realms/{realm}/tideAdminResources/get-required-action-link?userId={userId}&lifespan=43200` with body `["link-tide-account-action"]`.
   - ⚠️ **`tideInvitable` must be set FIRST, and the change request drained.** Otherwise this
     returns `400 {"errorMessage":"This user cannot be invited: the 'tideInvitable' attribute is
     not set to true."}` for every principal. Three steps, in order: `PUT /users/{id}` with
     `attributes.tideInvitable=["true"]` → **drain the `SET_USER_ATTRIBUTE` change request** →
     request the link. A `204` on the PUT does NOT mean it applied (AP-72). Put this in its own
     script rather than inline. Full sequence: `canon/tidecloak-bootstrap.md` → invite links.
   - Admin must complete this link in a browser to bind their identity to the Tide Fabric.

10. **Wait for account linking**
    - Poll `GET /admin/realms/{realm}/users/{userId}` until `attributes.tideUserKey` and `attributes.vuid` are present.
    - Do not proceed until both attributes exist.

## Phase 5: Approve user change requests

11. **Approve user change requests**
    - List: `GET /admin/realms/{realm}/iga/change-requests?status=PENDING`.
    - Authorize then commit (see Phase 3 / `canon/iga-change-requests-api.md`).

## Phase 6: IDP settings and adapter export

12. **Configure IDP settings (optional)**
    - Upload branding (logo, background) if desired.
    - Set `CustomAdminUIDomain` if a separate app hosts the approval/admin UI.

13. **Sign IDP settings**
    - `POST /admin/realms/{realm}/vendorResources/sign-idp-settings`.
    - Required after any IDP config change. Without it, the enclave rejects settings as unsigned.

14. **Export adapter JSON**
    - `GET /admin/realms/{realm}/vendorResources/get-installations-provider?clientId={clientUUID}&providerId=keycloak-oidc-keycloak-json`.
    - Save to app config path (e.g., `data/tidecloak.json`).
    - Verify `jwk`, `vendorId`, `homeOrkUrl`, `client-origin-auth-*` fields are present.
    - If `jwk` is missing: IGA was not enabled before export. Re-enable IGA and re-export.

## Phase 7: Signing role and policy setup (admin-driven)

15. **Create signing roles**
    - Admin creates client roles via app UI or TideCloak admin API.
    - Role names follow app-specific prefix pattern (e.g., `ssh:<username>`).
    - Role creation goes through IGA change-set when IGA is enabled.
    - Approve and commit role change-sets.

16. **Assign signing roles to users**
    - Admin assigns roles to users via app UI or TideCloak admin API.
    - Role assignment goes through IGA change-set.
    - Approve and commit.

17. **Create and approve signing policies**
    - Admin creates a PolicySignRequest with:
      - Forseti contract source code (C# implementing `IAccessPolicy`)
      - Policy parameters (`Role`, `Resource`, `threshold`, `approval_type`, `execution_type`)
      - Model ID (e.g., `BasicCustom<SSH>:BasicCustom<1>`)
      - Contract transport (source + entry type)
    - PolicyApproval must be signed and committed so `signed_policy_data` is populated.
    - Until committed, signing requests for that role will fail.

## Phase 8: App readiness

18. **Place adapter JSON in app**
    - Express/Node: `data/tidecloak.json`
    - Next.js: `data/tidecloak.json`
    - React/Vite or Vanilla: `public/tidecloak.json`

19. **Configure CSP**
    - Add `frame-src '*'` to Content-Security-Policy. Required for ORK enclave iframe.

20. **Start app server**
    - App must be able to reach TideCloak at the URL in `auth-server-url`.
    - App must serve the redirect handler at the configured `redirectUri` path.
    - App must serve `silent-check-sso.html` in `public/` for session refresh.

## Pre-user checklist

Before any user accesses signing features, verify:

- [ ] TideCloak healthy (`/health/ready` returns 200)
- [ ] Realm licensed and IGA enabled
- [ ] At least one admin with linked Tide account
- [ ] All pending change-sets approved and committed (clients, users, roles)
- [ ] At least one signing role created and assigned to a user
- [ ] Signing PolicyApproval committed with non-empty `signed_policy_data` for each role
- [ ] Adapter JSON exported with `jwk`, `vendorId`, `homeOrkUrl`
- [ ] `sign-idp-settings` called
- [ ] App server running with JWT + DPoP verification on protected endpoints
- [ ] Redirect handler present at `redirectUri` path
- [ ] CSP includes `frame-src '*'`
