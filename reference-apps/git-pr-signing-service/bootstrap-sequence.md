# Bootstrap Sequence — Git PR Signing Service

All steps must complete before the service can sign merge commits. Order matters.

## Phase 1: TideCloak infrastructure

1. **Start TideCloak container**
   - Use `tidecloak-dev` (development) or `tidecloak-stg-dev` (staging with ORK env vars).
   - Staging requires `SYSTEM_HOME_ORK`, `USER_HOME_ORK`, `THRESHOLD_T`, `THRESHOLD_N`.
   - Wait for readiness: `curl http://localhost:8080/health/ready` returns 200.

2. **Obtain bootstrap admin token**
   - `POST /realms/master/protocol/openid-connect/token` with `KC_BOOTSTRAP_ADMIN_USERNAME` / `KC_BOOTSTRAP_ADMIN_PASSWORD`.

## Phase 2: Realm and client setup

3. **Import realm template**
   - `POST /admin/realms` with `realm.json`.
   - Template must declare: realm name, OIDC client for the signing service, `_tide_enabled` role, default-roles composite, protocol mappers.
   - Template should include redirect URIs for the signing service's web UI.

4. **License the realm**
   - `POST /admin/realms/{realm}/vendorResources/setUpTideRealm` with admin email.
   - Content-Type: `application/x-www-form-urlencoded`. Body: `email=admin@example.com`.

5. **Enable IGA**
   - `POST /admin/realms/{realm}/tide-admin/toggle-iga` with form-urlencoded `isIGAEnabled=true`.
   - Must happen after licensing.

## Phase 3: Approve initial change requests

6. **Approve initial change requests** (current `/iga/change-requests/...` surface — see `canon/iga-change-requests-api.md`)
   - List: `GET /admin/realms/{realm}/iga/change-requests?status=PENDING` (objects keyed by `id`).
   - Approve: `POST .../iga/change-requests/bulk-authorize` (`{"actionTypeIn":["CREATE","DELETE"],"limit":100}`), then `POST .../iga/change-requests/{id}/commit` for each `readyToCommit` CR. FirstAdmin bootstrap signs server-side.

## Phase 4: Admin user setup

7. **Create admin user(s)**
   - `POST /admin/realms/{realm}/users` with username, email, enabled=true.
   - Create at least as many admins as your signing policy threshold requires (e.g., 2 for threshold=2).

8. **Assign `tide-realm-admin` role**
   - Get role ID: `GET /admin/realms/{realm}/clients/{realm-mgmt-client-id}/roles` and find `tide-realm-admin`.
   - Assign: `POST /admin/realms/{realm}/users/{userId}/role-mappings/clients/{realm-mgmt-client-id}`.

9. **Generate account-linking invites**
   - For each admin: `POST /admin/realms/{realm}/tideAdminResources/get-required-action-link?userId={userId}&lifespan=43200` with body `["link-tide-account-action"]`.
   - Each admin must complete linking in a browser.

10. **Wait for account linking**
    - Poll `GET /admin/realms/{realm}/users/{userId}` until `attributes.tideUserKey` and `attributes.vuid` are present for each admin.

## Phase 5: Approve user change requests

11. **Approve user change requests**
    - List: `GET /admin/realms/{realm}/iga/change-requests?status=PENDING`.
    - Authorize then commit (see Phase 3 / `canon/iga-change-requests-api.md`).

## Phase 6: IDP settings and adapter export

12. **Sign IDP settings**
    - `POST /admin/realms/{realm}/vendorResources/sign-idp-settings`.
    - Required after any IDP config change.

13. **Export adapter JSON**
    - `GET /admin/realms/{realm}/vendorResources/get-installations-provider?clientId={clientUUID}&providerId=keycloak-oidc-keycloak-json`.
    - Save to `data/tidecloak.json`.
    - Verify `jwk`, `vendorId`, `homeOrkUrl`, `client-origin-auth-*` fields are present.

## Phase 7: Signing role and policy setup

14. **Create signing roles**
    - Create client roles: `git-sign:main`, `git-sign:develop`, etc. as needed.
    - Create service executor role: `signing-service`.
    - Role creation goes through IGA change-sets. Approve and commit.

15. **Assign signing roles**
    - Assign `git-sign:<branch>` roles to admin users who will approve PRs for those branches.
    - Assign `signing-service` role to the service's own identity (if using a service account pattern) or to the admin who triggers the signing execution.
    - Role assignments go through IGA change-sets. Approve and commit.

16. **Create and approve signing policies**
    - Create a PolicySignRequest with:
      - Forseti contract: `GitCommitSigningPolicy` (see role-policy-matrix.md)
      - Parameters: `Role` = `git-sign:main`, `Resource` = client ID, `threshold` = 2
      - Model ID: `BasicCustom<GitSign>:BasicCustom<1>`
      - Contract transport: source + entry type
    - PolicyApproval must be signed and committed so `signed_policy_data` is populated.
    - Repeat for each branch that needs a separate signing policy.

## Phase 8: GitHub App setup

17. **Register GitHub App**
    - Create a GitHub App (or bot account) in the target organization.
    - Permissions required: `checks: write`, `contents: write`, `pull_requests: read`.
    - Subscribe to webhook events: `pull_request`.
    - Set webhook URL to the signing service's webhook endpoint (e.g., `https://signing-service.example.com/api/webhook/github`).
    - Set webhook secret. Store it securely in the service's environment.

18. **Upload threshold public key and configure committer identity**
    - Export the threshold Ed25519 public key from the adapter JSON's `jwk.keys[0].x` field (base64url-encoded 32-byte key).
    - Convert to SSH format: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA<base64> <comment>`.
    - Add it to a GitHub account as a **Signing Key** (Settings → SSH and GPG Keys → type: Signing Key).
    - **Critical**: The commit's `committer.email` must match this GitHub account's email. Mismatch produces `unknown_signature_type` instead of "Verified". VERIFIED (LEARNINGS-ratidefy-batch-001 L-26).
    - **GitHub App limitation**: Bot accounts (e.g., `myapp[bot]`) cannot have SSH keys. Use a dedicated machine user account.
    - GitHub will verify commit signatures against this key.

19. **Install GitHub App on repositories**
    - Install the App on the target repositories (or organization-wide).
    - Verify webhook delivery: push a test PR and confirm the service receives the event.

20. **Configure branch protection**
    - On each target branch, enable branch protection rules:
      - Require status checks to pass: add the signing service's check name.
      - Optionally: require reviews (GitHub-native reviews in addition to Tide-governed approval).
    - This ensures PRs cannot be merged without the signing service's approval.

## Phase 9: Service readiness

21. **Place adapter JSON in service**
    - `data/tidecloak.json` for Next.js service.

22. **Configure environment**
    - `GITHUB_APP_ID` — GitHub App ID
    - `GITHUB_PRIVATE_KEY` — GitHub App private key (for API authentication)
    - `GITHUB_WEBHOOK_SECRET` — webhook HMAC secret
    - `CLIENT_ADAPTER` — (optional) adapter JSON for containerized deployment

23. **Configure CSP**
    - `frame-src '*'` for ORK enclave iframe.

24. **Start service**
    - Service must reach TideCloak at `auth-server-url`.
    - Service must reach GitHub API (`api.github.com`).
    - Service must serve the redirect handler at configured `redirectUri` path.

## Pre-use checklist

Before the signing service is operational, verify:

- [ ] TideCloak healthy (`/health/ready` returns 200)
- [ ] Realm licensed and IGA enabled
- [ ] At least N admins with linked Tide accounts (where N >= signing threshold)
- [ ] All pending change-sets approved and committed
- [ ] Signing roles created and assigned (`git-sign:<branch>`, `signing-service`)
- [ ] Signing PolicyApproval committed with non-empty `signed_policy_data` for each role
- [ ] Adapter JSON exported with `jwk`, `vendorId`, `homeOrkUrl`
- [ ] `sign-idp-settings` called
- [ ] GitHub App registered with correct permissions and webhook events
- [ ] Threshold Ed25519 public key uploaded to GitHub App/bot as SSH signing key
- [ ] GitHub App installed on target repositories
- [ ] Branch protection rules require signing service status check
- [ ] Webhook delivery confirmed (test PR triggers service)
- [ ] Service running with JWT + DPoP verification on admin endpoints
- [ ] Webhook signature verification active (HMAC-SHA256)
- [ ] Redirect handler present at `redirectUri` path
- [ ] CSP includes `frame-src '*'`
