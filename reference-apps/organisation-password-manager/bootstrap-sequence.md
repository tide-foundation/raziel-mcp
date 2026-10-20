# Bootstrap Sequence — Organisation Password Manager

All steps must complete before users can safely use the app. Order matters.

> **⛔ Before Phase 1 — ask the user, and wait (AP-90).** Setting up the realm licenses it to an
> email address under Tide's Terms & Conditions (**https://tide.org/legal**). Ask: (1) *which email
> address should manage your Tide licence?* and (2) *do you agree to the Terms & Conditions at that
> link? (yes/no)*. Never invent the email, never accept for them, and stop if they decline. Pass the
> answers as `TIDE_LICENSE_EMAIL` and `TIDE_TERMS_ACCEPTED=yes`. Any init script you write must exit
> non-zero without both — the block to paste is in canon `tidecloak-bootstrap`.

## Phase 0: Confirm the built-in contract

0. Shared vaults use the ORK's built-in `RelationshipAttestation:1` (ORK `main`, VERIFIED from
   source `c69fc4f6`). Nothing is written or deployed. If the user's ORK network predates
   2026-10-16, confirm with the Tide team that it runs a build with the contract. Follow
   `relationship-attestation`'s bootstrap for the policy ceremony and its rejection checks.

## Phase 1: TideCloak infrastructure

1. **Start TideCloak container**
   - Use `tideorg/tidecloak-dev:latest` — it is wired to the production Tide network (ork1, 14-of-20), though it is a development build of the server and the only supported one. No ORK/threshold env vars needed or wanted.
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
   - Content-Type: `application/x-www-form-urlencoded`. Body: `email=$TIDE_LICENSE_EMAIL` — the address the user gave (AP-90).
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

## Phase 3: Admin user setup

6. **Create admin user**
   - `POST /admin/realms/{realm}/users` with username, email, enabled=true.

7. **Assign `tide-realm-admin` role**
   - Get role ID: `GET /admin/realms/{realm}/clients/{realm-mgmt-client-id}/roles` and find `tide-realm-admin`.
   - Assign: `POST /admin/realms/{realm}/users/{userId}/role-mappings/clients/{realm-mgmt-client-id}`.

8. **Generate account-linking invite**

   > **Print the two end-user questions next to this link, before the polling loop** — branding,
   > and what the in-app form collects. It is the only step where a human is present and idle;
   > an agent will otherwise decide both itself and report them afterwards (**AP-87**). The
   > exact banner is in `canon/tidecloak-bootstrap.md`.

   - `PUT /admin/realms/{realm}/users/{userId}/execute-actions-email` with `["link-tide-account-action"]`.
   - Or: `GET /admin/realms/{realm}/tide-admin/get-required-action-link?userId={userId}` for a direct URL.
   - ⚠️ **`tideInvitable` must be set FIRST, and the change request drained.** Otherwise this
     returns `400 {"errorMessage":"This user cannot be invited: the 'tideInvitable' attribute is
     not set to true."}` for every principal. Three steps, in order: `PUT /users/{id}` with
     `attributes.tideInvitable=["true"]` → **drain the `SET_USER_ATTRIBUTE` change request** →
     request the link. A `204` on the PUT does NOT mean it applied (AP-72). Put this in its own
     script rather than inline. Full sequence: `canon/tidecloak-bootstrap.md` → invite links.
   - Admin must complete this link in a browser to bind their identity to the Tide Fabric.

9. **Wait for account linking**
   - Poll `GET /admin/realms/{realm}/users/{userId}` until `attributes.tideUserKey` and `attributes.vuid` are present.
   - Do not proceed until both attributes exist.

## Phase 4: Change-set approval

10. **Approve pending change requests** (current `/iga/change-requests/...` surface — see `canon/iga-change-requests-api.md`)
    - IGA creates draft change requests for client and user mutations made during setup (each mutating write returns 202).
    - List: `GET /admin/realms/{realm}/iga/change-requests?status=PENDING` (objects keyed by `id`).
    - Approve per id: `POST .../iga/change-requests/{id}/authorize` (body `{}`) for each pending request, skipping `DISABLE_IGA`, `DELETE_REALM` and `OFFBOARD_REALM` (FirstAdmin signs server-side).
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

## Phase 6: Vault access (app-level)

14. **Contract roles in the realm**
    - Realm roles `_tide_encryptor` and `_tide_decryptor` (names fixed by the contract) are declared
      in `realm.json`. Grant `_tide_decryptor` to members who read shared vaults and
      `_tide_encryptor` to members who write. They are capabilities only; each vault's policy subject
      decides which vault.
    - The `groups` mapper is on the client (pack realm templates ship it before IGA). Needed for
      team (`Group`) subjects.

15. **Create org-scoped client roles and team groups**
    - App creates `org:{uuid}:{owner|admin|user|manager}` client roles (and any team groups) during
      org sync. On an IGA realm these are change requests that must be approved.

16. **Sign one policy per shared vault (BROWSER-ONLY — cannot be scripted)**
    - When a shared vault is created, a `tide-realm-admin` signs its policy in the Tide enclave:
      `signRelationshipPolicy` in `templates/relationship-attestation/relationship.ts`, with
      `assignmentId` = vault id and subject `Role` + `org:{uuid}:user` + `clientId` (or a `Group`
      or `User` subject).
    - The app stores the signed policy (base64) keyed by vault id and serves it to members.
    - Until a vault's policy is signed, **that vault is unusable**. Block writing to it and show an
      admin setup CTA. Never fall back to self-encryption: self-encrypted data can never be shared.
    - **The app must include an admin signing page** (or equivalent UI) for this step.

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
- [ ] Realm roles `_tide_encryptor` and `_tide_decryptor` exist and are granted to members
- [ ] `groups` mapper present on the client (if teams are `Group` subjects)
- [ ] An admin signing page exists for vault policies
- [ ] Rejection checks pass: a member of another org, and a member without `_tide_decryptor`, are both refused
- [ ] Adapter JSON exported with `jwk`, `vendorId`, `homeOrkUrl`
- [ ] `sign-idp-settings` called
- [ ] App server running and reachable
- [ ] Redirect handler present at `redirectUri` path
- [ ] CSP includes `frame-src '*'`
