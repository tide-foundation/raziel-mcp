# Migrate from Existing Auth to TideCloak

Replace your current identity provider with TideCloak while keeping standard OIDC flows intact.

---

## When to Use

- Migrating from vanilla Keycloak to TideCloak
- Migrating from Auth0, Okta, or any other OIDC-compliant provider
- Want distributed key signing, zero-knowledge passwords, or quorum governance without rewriting auth flows

**Do not use** if starting a greenfield project. See [add-auth-nextjs-fresh.md](add-auth-nextjs-fresh.md) instead.

---

## From Keycloak

Keycloak to TideCloak is the simplest path. TideCloak uses the same admin console, same OIDC endpoints, and same SDK surface.

### Steps

1. **Deploy TideCloak** in place of (or alongside) your Keycloak instance.
2. **Download the new adapter config** (`tidecloak.json`) from the TideCloak admin console:
   - Clients -> {your-client} -> Installation -> Keycloak OIDC JSON
3. **Replace `keycloak.json` with `tidecloak.json`** in your application:
   ```bash
   # Backup existing config
   cp data/keycloak.json data/keycloak.json.bak

   # Replace with TideCloak adapter
   cp tidecloak.json data/keycloak.json
   # Or rename to tidecloak.json and update your config loader path
   ```
4. **No code changes needed.** Same SDK, same OIDC protocol. The application does not need to know it is talking to TideCloak instead of Keycloak.

### What to verify after swap

```bash
# Confirm discovery endpoint responds
curl -s http://localhost:8080/realms/{realm}/.well-known/openid-configuration | jq .issuer

# Confirm JWKS endpoint responds
curl -s http://localhost:8080/realms/{realm}/protocol/openid-connect/certs | jq .keys[0].kty
```

---

## From Other OIDC Providers (Auth0, Okta, etc.)

Any application using standard OIDC can point to TideCloak by updating configuration values. No TideCloak-specific SDK is required for basic authentication.

### Steps

1. **Deploy TideCloak.**
2. **Create a realm and client** in TideCloak matching your existing client configuration (redirect URIs, scopes, grant types).
3. **Update your application's OIDC configuration:**

   | Setting | Old value (example: Auth0) | New value (TideCloak) |
   |---------|---------------------------|----------------------|
   | Discovery endpoint | `https://tenant.auth0.com/.well-known/openid-configuration` | `http://localhost:8080/realms/{realm}/.well-known/openid-configuration` |
   | Issuer URL | `https://tenant.auth0.com/` | `http://localhost:8080/realms/{realm}` |
   | Client ID | Your Auth0 client ID | Your TideCloak client ID |
   | Client secret (if confidential) | Your Auth0 client secret | Your TideCloak client secret |

4. **Standard OIDC -- no TideCloak SDK required for basic auth.** Your existing OIDC library (e.g., `openid-client`, `next-auth` with generic provider, `passport-openidconnect`) works without changes beyond the config values above.
5. **Add TideCloak SDK only if you need Tide-specific features:**
   ```bash
   npm install @tidecloak/js
   # or
   npm install @tidecloak/react
   ```
   The SDK is required for E2EE features (`doEncrypt()` / `doDecrypt()`) and direct enclave interactions. It is not required for login, logout, or token verification.

---

## What Stays the Same

These are standard OIDC behaviors. TideCloak does not change them:

- **OIDC/OAuth 2.0 flows** -- Authorization Code, PKCE, Client Credentials all work identically.
- **JWT format and claims structure** -- Access tokens are standard JWTs. No proprietary wrapper.
- **JWKS verification endpoint** -- `GET /realms/{realm}/protocol/openid-connect/certs` returns standard JWK set. Existing JWT verification code works without modification.
- **Role claim paths** -- `realm_access.roles` for realm roles, `resource_access.{client}.roles` for client roles. Same as Keycloak.
- **Redirect URI patterns** -- Same configuration, same behavior.

---

## What You Gain

These improvements are invisible to the application. No code changes required to benefit:

| Feature | What it means |
|---------|--------------|
| **VVK threshold signing** | JWTs are signed by a distributed Vendor Verification Key. No single signing key exists to steal. Compromise of one node does not compromise tokens. |
| **Zero-knowledge passwords** | User passwords are never stored as hashes. The server never sees the plaintext password. Credential database breaches yield nothing usable. |
| **Quorum governance** | Admin changes (role assignments, policy updates) require multiple admin approvals before taking effect. Single compromised admin cannot unilaterally escalate privileges. |
| **Optional E2EE** | `doEncrypt()` / `doDecrypt()` available via TideCloak SDK for end-to-end encrypted data fields. Requires `@tidecloak/js` or `@tidecloak/react`. |

---

## Verification Checklist

### Discovery and Tokens

- [ ] `GET /realms/{realm}/.well-known/openid-configuration` returns valid JSON with correct `issuer`
- [ ] `GET /realms/{realm}/protocol/openid-connect/certs` returns JWKS with at least one key
- [ ] Application obtains access token via Authorization Code flow
- [ ] Access token decodes to standard JWT with expected claims (`sub`, `realm_access`, `iss`)

### Login and Logout

- [ ] Login redirects to TideCloak login page (not old provider)
- [ ] Successful login redirects back to application with valid tokens
- [ ] Logout clears session and redirects correctly
- [ ] Silent token refresh works (no forced re-login after token expiry)

### JWT Verification

- [ ] Existing server-side JWT verification code accepts TideCloak tokens without modification
- [ ] `iss` claim matches the new TideCloak issuer URL
- [ ] Role claims at `realm_access.roles` are populated correctly

### No Residual Old Auth

- [ ] No requests to old provider endpoints in browser network tab
- [ ] No old provider cookies or tokens in browser storage
- [ ] No old provider SDKs still loaded in the application bundle

---

## Common Failures

### Issuer Mismatch

**Symptom**: JWT verification fails. Error message mentions issuer validation.

**Cause**: Application still expects the old provider's issuer URL (e.g., `https://tenant.auth0.com/`) but receives TideCloak's issuer (`http://localhost:8080/realms/myrealm`).

**Fix**: Update the expected issuer in your JWT verification configuration to match TideCloak's issuer URL exactly. Check trailing slashes.

---

### CORS Errors After Switch

**Symptom**: Browser console shows CORS errors on token or JWKS requests.

**Cause**: TideCloak's Web Origins configuration does not include your application's origin.

**Fix**: In TideCloak admin console: Clients -> {your-client} -> Settings -> Web Origins. Add your application origin (e.g., `http://localhost:3000`).

---

### Redirect URI Mismatch

**Symptom**: Login fails with "Invalid redirect_uri" error on TideCloak login page.

**Cause**: The redirect URI your application sends does not match any URI registered in TideCloak.

**Fix**: In TideCloak admin console: Clients -> {your-client} -> Settings -> Valid Redirect URIs. Add all URIs your application uses (including `http://localhost:*` for development).

---

### Old Provider Tokens Cached

**Symptom**: Application appears logged in but API calls fail with 401. Or infinite redirect loop.

**Cause**: Browser still holds tokens or cookies from the old provider.

**Fix**: Clear site data in browser DevTools (Application -> Storage -> Clear site data). Test in incognito window for a clean session.

---

### Client Secret Not Configured (Confidential Clients)

**Symptom**: Token exchange fails with 401 from TideCloak token endpoint.

**Cause**: Confidential client in TideCloak does not have the client secret configured, or the application is sending the old provider's secret.

**Fix**: In TideCloak admin console: Clients -> {your-client} -> Credentials. Copy the secret and update your application's configuration.

---

### Role Claims Missing or Different Path

**Symptom**: Application cannot find user roles after migration.

**Cause**: Old provider used a custom claim path (e.g., Auth0 namespaced claims like `https://myapp.com/roles`). TideCloak uses standard Keycloak paths.

**Fix**: Update role extraction code to read from `realm_access.roles` (realm roles) or `resource_access.{client}.roles` (client roles). If your application hardcodes a custom claim namespace, replace it.

---

## References

- Source: SDK documentation, operational exemplars
- Keycloak migration: same admin console, same OIDC endpoints, config swap only
- Generic OIDC migration: config-only change, no SDK required for basic auth
