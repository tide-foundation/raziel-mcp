# Encrypted Communication — Bootstrap Sequence

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

3. Create realm from template.

   The realm template must include:
   - `_tide_enabled` in default composite role
   - `_tide_<tag>.selfencrypt` and `_tide_<tag>.selfdecrypt` in default composite role
   - `tidebrowser` authentication flow
   - `link-tide-account-action` required action
   - Tide protocol mappers (`tideUserKey`, `vuid`)
   - `UPDATE_PASSWORD` required action disabled

   ```bash
   curl -s -X POST "http://localhost:8080/admin/realms" \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d @realm.json
   ```
   **Fail-fast**: Check HTTP status. Abort on non-2xx.

4. License realm:
   ```bash
   curl -s -X POST "http://localhost:8080/admin/realms/$REALM/vendorResources/setUpTideRealm" \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "email=admin@example.com"
   ```

5. Enable IGA:
   ```bash
   curl -s -X POST "http://localhost:8080/admin/realms/$REALM/tide-admin/toggle-iga" \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "isIGAEnabled=true"
   ```

6. Approve and commit initial client change request.

---

## Phase 3: Admin User

7. Create admin user (include `firstName` and `lastName` to avoid `VERIFY_PROFILE` block).

8. Approve and commit user creation change request.

9. Assign `tide-realm-admin` (client role on `realm-management`).

10. Approve and commit role assignment change request.

11. Generate invite link (`lifespan=43200`). Admin completes Tide account linking.

---

## Phase 4: IDP Settings and Adapter Export

12. Sign IDP settings:
    ```bash
    curl -s -X POST "http://localhost:8080/admin/realms/$REALM/vendorResources/sign-idp-settings" \
      -H "Authorization: Bearer $TOKEN"
    ```

13. Export adapter JSON:
    ```bash
    curl -s "http://localhost:8080/admin/realms/$REALM/vendorResources/get-installations-provider?clientId=$CLIENT_UUID&providerId=keycloak-oidc-keycloak-json" \
      -H "Authorization: Bearer $TOKEN" > tidecloak.json
    ```
    Verify `jwk` field is present.

---

## Phase 5: App Wiring

14. Install SDK (`@tidecloak/react` or `@tidecloak/nextjs`).

15. Wire TideCloak provider with adapter JSON config.

16. Create redirect handler at configured `redirectUri` path.

17. Add `public/silent-check-sso.html`.

18. Set CSP `frame-src '*'` in server config or framework config.

19. Implement server-side JWT verification for API routes that handle key material.

20. Create API endpoint for storing/retrieving encrypted key material (protected by JWT verification).

21. Create database table for user keys (user_id, public_key, encrypted_private_key).

---

## Phase 6: Client-Side Key Management

22. Install external crypto library (e.g., `libsodium-wrappers`).

23. Implement first-login flow:
    - Generate keypair client-side
    - Encrypt private key with `doEncrypt([{ data: privateKeyBytes, tags: [tag] }])`
    - Store encrypted private key + public key via protected API

24. Implement returning-login flow:
    - Fetch encrypted key material via protected API
    - Decrypt private key with `doDecrypt([{ encrypted: encryptedPrivateKey, tags: [tag] }])`
    - Private key available in memory for runtime E2E operations

25. Implement runtime E2E operations using the external crypto library (not Tide).

---

## Pre-User Checklist

Before any user accesses the app:

- [ ] TideCloak running and reachable
- [ ] Realm created with self-encryption roles in default composite
- [ ] Realm licensed (`setUpTideRealm`)
- [ ] IGA enabled (`toggle-iga`)
- [ ] At least one admin user with `tide-realm-admin` linked
- [ ] All initial change requests approved and committed
- [ ] IDP settings signed (`sign-idp-settings`)
- [ ] Adapter JSON exported with `jwk` field present
- [ ] App has TideCloak provider wired with config
- [ ] Redirect handler exists at configured path
- [ ] `silent-check-sso.html` in public directory
- [ ] CSP includes `frame-src '*'`
- [ ] Server-side JWT verification on key material API endpoints
- [ ] Database table for encrypted key storage exists
- [ ] External crypto library installed and initialized
- [ ] First-login keypair generation flow tested
- [ ] Returning-login key decryption flow tested
