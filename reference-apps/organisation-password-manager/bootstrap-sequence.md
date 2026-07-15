# Bootstrap Sequence — Organisation Password Manager

All steps must complete before users can safely use the app. Order matters.

## Phase 1: TideCloak infrastructure

1. **Start TideCloak container**
   - Use `tidecloak-dev` (development) or `tidecloak-stg-dev` (staging with ORK env vars).
   - Dev image has built-in defaults. Staging requires `SYSTEM_HOME_ORK`, `USER_HOME_ORK`, `THRESHOLD_T`, `THRESHOLD_N`.
   - Wait for readiness: `curl http://localhost:8080/health/ready` returns 200.

2. **Obtain bootstrap admin token**
   - `POST /realms/master/protocol/openid-connect/token` with `KC_BOOTSTRAP_ADMIN_USERNAME` / `KC_BOOTSTRAP_ADMIN_PASSWORD`.

## Phase 2: Realm and client setup

3. **Import realm template**
   - `POST /admin/realms` with `realm.json`.
   - Template must declare: realm name, OIDC client, `_tide_enabled` role, self-encryption roles (`_tide_<tag>.selfencrypt`, `_tide_<tag>.selfdecrypt`), default-roles composite, protocol mappers.
   - Template should include redirect URIs for all clients (web app, browser extension if applicable).

4. **License the realm**
   - `POST /admin/realms/{realm}/vendorResources/setUpTideRealm` with admin email.
   - Content-Type: `application/x-www-form-urlencoded`. Body: `email=admin@example.com`.
   - Returns licensing JSON as `text/plain`.

5. **Enable IGA**
   - `POST /admin/realms/{realm}/tide-admin/toggle-iga` with form-urlencoded `isIGAEnabled=true`.
   - Must happen after licensing. Enables change-set governance for role/user mutations.

## Phase 3: Admin user setup

6. **Create admin user**
   - `POST /admin/realms/{realm}/users` with username, email, enabled=true.

7. **Assign `tide-realm-admin` role**
   - Get role ID: `GET /admin/realms/{realm}/clients/{realm-mgmt-client-id}/roles` and find `tide-realm-admin`.
   - Assign: `POST /admin/realms/{realm}/users/{userId}/role-mappings/clients/{realm-mgmt-client-id}`.

8. **Generate account-linking invite**
   - `PUT /admin/realms/{realm}/users/{userId}/execute-actions-email` with `["link-tide-account-action"]`.
   - Or: `GET /admin/realms/{realm}/tide-admin/get-required-action-link?userId={userId}` for a direct URL.
   - Admin must complete this link in a browser to bind their identity to the Tide Fabric.

9. **Wait for account linking**
   - Poll `GET /admin/realms/{realm}/users/{userId}` until `attributes.tideUserKey` and `attributes.vuid` are present.
   - Do not proceed until both attributes exist.

## Phase 4: Change-set approval

10. **Approve pending change requests** (current `/iga/change-requests/...` surface — see `canon/iga-change-requests-api.md`)
    - IGA creates draft change requests for client and user mutations made during setup (each mutating write returns 202).
    - List: `GET /admin/realms/{realm}/iga/change-requests?status=PENDING` (objects keyed by `id`).
    - Approve: `POST /admin/realms/{realm}/iga/change-requests/bulk-authorize` (`{"actionTypeIn":["CREATE","DELETE"],"limit":100}`; FirstAdmin signs server-side).
    - Commit: `POST /admin/realms/{realm}/iga/change-requests/{id}/commit` for each `readyToCommit` CR.
    - Without this step, client and user changes are in draft state and not active.

## Phase 5: IDP settings and adapter export

11. **Configure IDP settings (optional)**
    - Upload branding (logo, background) if desired.
    - Set `CustomAdminUIDomain` if a separate app hosts the approval UI.

12. **Sign IDP settings**
    - `POST /admin/realms/{realm}/identity-provider/instances/tide` (PUT to update, then sign).
    - Required after any IDP config change. Without it, the enclave rejects settings as unsigned.

13. **Export adapter JSON**
    - `GET /admin/realms/{realm}/vendorResources/get-installations-provider?clientId={clientUuid}&providerId=keycloak-oidc-keycloak-json`.
    - Do NOT use the standard Keycloak path (`/clients/{id}/installation/providers/...`) — it returns a minimal adapter missing `jwk`, `vendorId`, `homeOrkUrl`.
    - Save to app config path (e.g., `data/tidecloak.json`).
    - Verify `jwk`, `vendorId`, `homeOrkUrl`, `client-origin-auth-*` fields are present.
    - If `jwk` is missing: IGA was not enabled before export. Re-enable IGA and re-export.

## Phase 6: Policy setup (app-level)

14. **Seed Forseti contract template**
    - On first org access, the app seeds a default `PolicyTemplate` with C# `IAccessPolicy` contract code.
    - Contract implements `ValidateData` (VVK signature verification), `ValidateApprovers` (tide-realm-admin check), `ValidateExecutor` (org-scoped role check).
    - This is app-level logic, not a TideCloak admin step.

15. **Create and approve policy roles (BROWSER-ONLY — cannot be scripted)**
    - App creates pending PolicyApprovals for `appUser` and `orgOwner` during org membership sync.
    - Admin must approve and commit these PolicyApprovals so `signed_policy_data` is populated.
    - Until `appUser` is committed with `signed_policy_data`, the crypto policy endpoint returns null and **shared encryption is completely non-functional**. VERIFIED (session-002).
    - Until `orgOwner` is committed, org admin operations requiring VVK-verified user context fail.
    - **This step requires the admin's browser** — it cannot be automated from a bootstrap script. The signing ceremony involves `IAMService._tc.createTideRequest()`, operator approval popup, admin-policy fetch (CORS-proxied), and `executeSignRequest()`.
    - **The app must include an admin signing page** (or equivalent UI) for this step. Without it, shared encryption is broken by default. The init script cannot complete this phase.
    - **Anti-pattern**: Silently falling back from shared encryption to self-encryption when the policy is unsigned. Self-encrypted data can never be shared. Block the shared mode entirely until the policy is signed and show a clear admin setup CTA. VERIFIED (session-002).

16. **Create org-scoped client roles**
    - App creates `org:{uuid}:{owner|admin|user|manager|accessAll}` client roles in TideCloak during org sync.
    - These go through IGA change-sets and must be approved.
    - `appUser` is added as composite to `org:{uuid}:user` so standard members get encryption capability.

## Phase 7: App readiness

17. **Place adapter JSON in app**
    - Next.js: `data/tidecloak.json`
    - React/Vite or Vanilla: `public/tidecloak.json`

18. **Configure CSP**
    - Add `frame-src '*'` to Content-Security-Policy. Required for ORK enclave iframe.

19. **Start app server**
    - App must be able to reach TideCloak at the URL in `auth-server-url`.
    - App must serve the redirect handler at the configured `redirectUri` path.
    - App must serve `silent-check-sso.html` in `public/` for session refresh.

## Pre-user checklist

Before any user accesses the app, verify:

- [ ] TideCloak healthy (`/health/ready` returns 200)
- [ ] Realm licensed and IGA enabled
- [ ] At least one admin with linked Tide account
- [ ] All pending change-sets approved and committed
- [ ] Self-encryption roles exist and are in default-roles composite
- [ ] `appUser` PolicyApproval committed with non-empty `signed_policy_data`
- [ ] `orgOwner` PolicyApproval committed with non-empty `signed_policy_data`
- [ ] Forseti contract template seeded
- [ ] Adapter JSON exported with `jwk`, `vendorId`, `homeOrkUrl`
- [ ] `sign-idp-settings` called
- [ ] App server running and reachable
- [ ] Redirect handler present at `redirectUri` path
- [ ] CSP includes `frame-src '*'`
