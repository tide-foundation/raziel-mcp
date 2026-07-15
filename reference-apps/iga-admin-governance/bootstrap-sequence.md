# IGA Admin Governance — Bootstrap Sequence

---

## Phase 1: TideCloak Infrastructure

1. Start TideCloak container:
   ```bash
   docker run -d --name tidecloak -p 8080:8080 tideorg/tidecloak-dev:latest
   ```
   Wait until `http://localhost:8080` responds.

2. Obtain master admin token:
   ```bash
   TOKEN=$(curl -s -X POST "http://localhost:8080/realms/master/protocol/openid-connect/token" \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "grant_type=password&client_id=admin-cli&username=admin&password=password" \
     | jq -r '.access_token')
   ```

---

## Phase 2: Realm Setup

3. Create realm from template:
   ```bash
   curl -s -X POST "http://localhost:8080/admin/realms" \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d @realm.json
   ```
   **Fail-fast**: Check HTTP status. Abort on non-2xx.

   Realm template must include: `_tide_enabled` in default composite, `tidebrowser` flow, `link-tide-account-action`, Tide protocol mappers (`tideUserKey`, `vuid`), `UPDATE_PASSWORD` disabled.

4. License realm:
   ```bash
   curl -s -X POST "http://localhost:8080/admin/realms/$REALM/vendorResources/setUpTideRealm" \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "email=admin@example.com"
   ```
   **Content-Type**: `application/x-www-form-urlencoded`, NOT JSON.

5. Enable IGA:
   ```bash
   curl -s -X POST "http://localhost:8080/admin/realms/$REALM/tide-admin/toggle-iga" \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "isIGAEnabled=true"
   ```

6. Approve/commit initial change requests (current `/iga/change-requests/...` surface; see `canon/iga-change-requests-api.md`):
   ```bash
   # Authorize all pending, then commit ready ones (FirstAdmin bootstrap signs server-side)
   curl -s -X POST "http://localhost:8080/admin/realms/$REALM/iga/change-requests/bulk-authorize" \
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"actionTypeIn":["CREATE","DELETE"],"limit":100}'
   for id in $(curl -s "http://localhost:8080/admin/realms/$REALM/iga/change-requests?status=PENDING" \
       -H "Authorization: Bearer $TOKEN" | jq -r '.[] | select(.readyToCommit==true) | .id'); do
     curl -s -X POST "http://localhost:8080/admin/realms/$REALM/iga/change-requests/$id/commit" \
       -H "Authorization: Bearer $TOKEN"
   done
   ```

---

## Phase 3: First Admin User

7. Create admin user (include `firstName` and `lastName` to avoid `VERIFY_PROFILE` block):
   ```bash
   curl -s -X POST "http://localhost:8080/admin/realms/$REALM/users" \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"username":"admin1","enabled":true,"firstName":"Admin","lastName":"One","email":"admin1@example.com"}'
   ```

8. Approve/commit user creation change request.

9. Assign `tide-realm-admin` client role on `realm-management`:
   - Look up user ID
   - Look up `realm-management` client UUID
   - Look up `tide-realm-admin` role within that client
   - Assign the role to the user

10. Approve/commit role assignment change request.

11. Generate invite link:
    ```bash
    curl -s -X POST "http://localhost:8080/admin/realms/$REALM/tideAdminResources/get-required-action-link?userId=$USER_ID&lifespan=43200" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d '["link-tide-account-action"]'
    ```

12. First admin opens invite link and completes Tide account linking.

---

## Phase 4: IDP Settings

13. If the governance panel is hosted on a separate domain from TideCloak:
    - Update `CustomAdminUIDomain` on the Tide IDP instance
    - Call `sign-idp-settings`:
      ```bash
      curl -s -X POST "http://localhost:8080/admin/realms/$REALM/vendorResources/sign-idp-settings" \
        -H "Authorization: Bearer $TOKEN"
      ```
    `sign-idp-settings` is ALWAYS required after any Tide IDP config change.

---

## Phase 5: Second Admin (for quorum)

14. Create second admin user (same as steps 7-12 but for admin2).

15. Approve/commit second user creation and role assignment.
    - If still in FirstAdmin mode (one linked admin), signing is immediate.
    - Once second admin is linked, future approvals require MultiAdmin enclave flow.

---

## Phase 6: Adapter Export

16. Export adapter JSON:
    ```bash
    curl -s "http://localhost:8080/admin/realms/$REALM/vendorResources/get-installations-provider?clientId=$CLIENT_UUID&providerId=keycloak-oidc-keycloak-json" \
      -H "Authorization: Bearer $TOKEN" > data/tidecloak.json
    ```
    Verify `jwk` field is present (requires IGA to be enabled).

---

## Phase 7: App Readiness

17. Install SDK, wire provider with DPoP, create redirect handler.
18. Implement server-side JWT verification with `tide-realm-admin` role check on governance API routes.
19. Build governance UI: change-set list, approve, commit, cancel.
20. Optional: add policy management tabs (realm policy, Forseti contracts, role policies).

---

## Pre-User Checklist

Before any admin uses the governance panel:

- [ ] TideCloak running and reachable
- [ ] Realm created with `_tide_enabled`, `tidebrowser`, protocol mappers
- [ ] Realm licensed (`setUpTideRealm`)
- [ ] IGA enabled (`toggle-iga`)
- [ ] At least one admin user with `tide-realm-admin` linked
- [ ] All initial change requests (client, user, role) approved and committed
- [ ] IDP settings signed (`sign-idp-settings`)
- [ ] Adapter JSON exported with `jwk` field
- [ ] App deployed with DPoP-enabled provider
- [ ] Server-side JWT verification on governance API routes
- [ ] At least two linked admins for quorum governance (optional for FirstAdmin-only mode)
- [ ] Change-set list/approve/commit UI functional
