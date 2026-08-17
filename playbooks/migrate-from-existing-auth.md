# Migrate from Existing Auth to TideCloak

Replace your current identity provider with TideCloak while keeping standard OIDC flows intact.

> ## ⚠️ Run the compatibility gate FIRST — "it uses Keycloak" does not mean it can be tidified
>
> **Tidifying a realm changes the token signature algorithm from RS256 to EdDSA.** MEASURED: a
> Tide-enabled realm reports `defaultSignatureAlgorithm: EdDSA` and carries an Ed25519 (OKP) signing
> key; non-Tide realms report `RS256` and have no Ed25519 key at all. Clients inherit the realm
> default, so **every token the app receives becomes `alg: EdDSA`**.
>
> This is not a switch to flip back. Tide's signing *is* threshold Ed25519 — forcing RS256 would put
> a whole signing key back on the TideCloak server, which is the property you migrated to remove
> (I-02, I-09). **If the verifier cannot do EdDSA, the verifier changes; the realm cannot.**
>
> ```bash
> templates/tidify-preflight/check-tidify.sh /path/to/app
> ```
>
> Known blockers, VERIFIED: Node **`jsonwebtoken`** has no EdDSA support at all (its allowlist is
> `HS*/RS*/ES*/PS*`); **`jwks-rsa`** pairs remote-JWKS fetching with RS256; stock .NET
> **`Microsoft.IdentityModel.Tokens`** ships no EdDSA (T-23 — `Tide.Asgard.Core` exists to supply it).
> An `algorithms: ['RS256']` pin also rejects a perfectly good token — **repin to EdDSA, never unpin**
> (SG-13).
>
> And the blocker most migrations die on is **not in the repo**: a gateway, managed authorizer, proxy
> or SaaS consumer that validates the JWT must also do EdDSA. The pack asserts nothing about specific
> products — test the real deployment with a real EdDSA token.
>
> Full gate, including the non-EdDSA constraints (no headless/service-account identity, browser-only
> signing, DPoP wiring, adapter JWKS, the `/auth/redirect` handler, asgard+IGA):
> **[canon/tidify-compatibility.md](../canon/tidify-compatibility.md)**. Classify the app **FULLY /
> PARTIALLY / NOT TIDIFIABLE** and say why. A partial migration is a fine outcome; presenting it as
> complete is not.

---

## When to Use

- Migrating from vanilla Keycloak to TideCloak
- Migrating from Auth0, Okta, or any other OIDC-compliant provider
- Want distributed key signing, zero-knowledge passwords, or quorum governance without rewriting auth flows

**Do not use** if starting a greenfield project. See [add-auth-nextjs-fresh.md](add-auth-nextjs-fresh.md) instead.

---

## From Keycloak

Keycloak to TideCloak is the simplest path. TideCloak uses the same admin console, same OIDC endpoints, and same SDK surface.

Keycloak to TideCloak is the **shortest** path — not a free one. The admin console and OIDC endpoints
are familiar, but the **token algorithm changes**, the **JWKS source changes**, and the SDK surface is
`@tidecloak/*`, which only partially overlaps `keycloak-js` (`tokenParsed` does not exist — AP-69).

### Steps

0. **Run the compatibility gate** (above). Do not start until you know the verifier does EdDSA.
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
4. **Expect code changes. The claim that none are needed was wrong** and is corrected here:

   | Change | Why | Reference |
   |---|---|---|
   | JWT verification must accept **EdDSA** | Realm default becomes EdDSA; RS256-only verifiers fail on every request | measured; T-23 |
   | Repin any algorithm allowlist to **EdDSA** | An `RS256` pin rejects valid tokens. Repin — do not unpin | SG-13 |
   | Keys from the **embedded adapter `jwk`**, not a remote JWKS | `createLocalJWKSet(config.jwk)`. The realm's OIDC JWKS also serves an RSA key, so a remote fetch can return the WRONG key with a 200 | I-04, AP-01, GAP-071 |
   | Wire **DPoP** (four pieces) | Relay page, wildcard rewrite, per-path CSP + `Allow-CSP-From`, `secureFetch` with absolute URLs | I-12, AP-62/70/71/73/74 |
   | Add the handler at **`/auth/redirect`** | Not `/auth/callback`; omitting it 404s **silently** | I-16, AP-REDIR-01 |
   | Machine-to-machine paths **cannot** move | No headless/service-account Tide identity; ORK signing is browser-only | GAP-063/064 |

   What *is* true: the OIDC **protocol** shape is unchanged — same flows, same endpoints, same
   redirect dance. That is why this is the shortest path. It is not the same as "no code changes".

### What to verify after swap

```bash
# Confirm discovery endpoint responds
curl -s http://localhost:8080/realms/{realm}/.well-known/openid-configuration | jq .issuer

# Confirm the realm now signs with EdDSA (this is the migration's real fault line)
curl -s http://localhost:8080/admin/realms/{realm} -H "Authorization: Bearer $TOKEN" \
  | jq -r .defaultSignatureAlgorithm            # expect: EdDSA

# Confirm an Ed25519 (OKP) signing key exists
curl -s http://localhost:8080/realms/{realm}/protocol/openid-connect/certs \
  | jq -r '.keys[] | select(.use=="sig") | "\(.kty) \(.alg) \(.crv // "-")"'
# expect a line: OKP EdDSA Ed25519   (an RSA line may ALSO be present — do not verify against it)

# Then the only test that counts: run a REAL token through the app's own verification path.
# Reading library docs is not evidence; a silently-accepted unverified token is worse than a rejection.
```

---

## From Other OIDC Providers (Auth0, Okta, etc.)

Any application using standard OIDC can point to TideCloak by updating configuration values — **provided
its JWT verifier supports EdDSA.** Run the gate first; the algorithm change applies here exactly as it
does coming from Keycloak.

"No TideCloak-specific SDK is required for basic authentication" is true only of the **protocol**. In
practice you still need an EdDSA-capable verifier, the embedded adapter JWKS rather than a remote one,
and — for Tide's actual security properties rather than plain OIDC login — DPoP and the Tide SDK.

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
- **JWKS verification endpoint** -- `GET /realms/{realm}/protocol/openid-connect/certs` returns a standard JWK set. ⚠️ **But existing verification code does NOT work without modification**: the set contains an **Ed25519 (OKP)** signing key alongside an RSA one, and tokens are signed with the **Ed25519** one. An RS256-only verifier fails, and a verifier that picks the RSA key gets a 200 and the **wrong key**. Tide also requires the **embedded adapter `jwk`** rather than this remote endpoint (I-04, AP-01, GAP-071).
- **Role claim paths** -- `realm_access.roles` for realm roles, `resource_access.{client}.roles` for client roles. Same as Keycloak.
- **Redirect URI patterns** -- Same configuration, same behavior.

---

## What You Gain

⚠️ **These are not invisible to the application, and the first row is why.** "VVK threshold signing"
means the token is signed by a distributed Ed25519 key — which is precisely what makes the algorithm
**EdDSA** instead of RS256. The headline benefit *is* the thing that requires the verifier change. An
earlier revision of this playbook claimed no code changes were required to benefit; that was wrong in
both halves (AP-82).

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
