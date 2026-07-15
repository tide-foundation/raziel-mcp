# Tide Role Matrix

Reference for roles used in TideCloak realms. Roles fall into three categories: system roles required by Tide, application roles for your business logic, and E2EE roles for encryption/decryption.

---

## System Roles (always required)

| Role | Type | Purpose | Where declared |
|------|------|---------|---------------|
| `_tide_enabled` | Realm | Enables Tide voucher system operations | `realm.json` template, default composite |
| `tide-realm-admin` | Client (`realm-management`) | Full admin access to Tide realm | Built-in, assigned to admin user |
| `default-roles-{realm}` | Realm (composite) | Auto-assigned to new users | `realm.json` template |

`_tide_enabled` must be in the default composite role. Without it, users cannot perform any Tide operations (login works but E2EE and IGA fail).

---

## Application Roles (your business logic)

| Example Role | Type | Purpose |
|-------------|------|---------|
| `appUser` | Realm | Standard application user |
| `admin` | Realm | Application admin (distinct from `tide-realm-admin`) |
| `customer` | Realm | Customer-tier access |

Client-side: `hasRealmRole(role)` for realm roles, `hasClientRole(role, client?)` for client roles — UI gating only, not authorization. Server-side: `hasRole(payload, role)` on verified JWT — real authorization.

---

## Self-Encryption Roles

For private data that only the encrypting user can decrypt.

| Role pattern | Purpose |
|-------------|---------|
| `_tide_{tag}.selfencrypt` | Allows user to encrypt data with this tag |
| `_tide_{tag}.selfdecrypt` | Allows user to decrypt data with this tag |

### Examples

| Tag | Encrypt role | Decrypt role | Use case |
|-----|-------------|-------------|----------|
| `secret` | `_tide_secret.selfencrypt` | `_tide_secret.selfdecrypt` | General private data |
| `medical` | `_tide_medical.selfencrypt` | `_tide_medical.selfdecrypt` | Health records |
| `vault` | `_tide_vault.selfencrypt` | `_tide_vault.selfdecrypt` | Password vault entries |

### Rules

- Both roles must exist for a tag to work.
- Users must have the role assigned and committed via IGA.
- Users must re-login (or `forceUpdateToken()`) after role assignment for the doken to include the new role.
- Self-encrypted data is bound to the encrypting user. Another user with the same `selfdecrypt` role **cannot** decrypt it.

---

## Policy-Governed (VVK) Encryption Roles

For shared data where multiple users can decrypt via a Forseti contract.

| Role type | Example | Purpose |
|-----------|---------|---------|
| Voucher gate (encrypt) | `_tide_shared.selfencrypt` | Enables `vendorsign` action at ORK |
| Voucher gate (decrypt) | `_tide_shared.selfdecrypt` | Enables `vendordecrypt` action at ORK |
| Forseti contract role | `shared-data-access` | Actual access control, checked by contract's `ValidateExecutor` |

### Rules

- All three roles are needed for policy-governed encryption.
- Voucher gate roles enable the ORK operation type. They do **not** control who can decrypt.
- The Forseti contract role controls actual access. Remove this role to revoke access — not the voucher gate roles.
- Do **not** use `_tide_*` roles in the Forseti contract's `ValidateExecutor`. Those are voucher gates only.
- The Forseti contract must include `using Ork.Forseti.Sdk;` or compilation fails.

---

## Adding E2EE Roles to the Realm Template

To include E2EE roles in initial realm setup, add them to `roles.realm` in `realm.json.template` and include them in the default composite:

```json
{
  "roles": {
    "realm": [
      { "name": "appUser", "description": "Standard application user" },
      { "name": "_tide_enabled", "description": "Tide voucher system" },
      { "name": "_tide_secret.selfencrypt", "description": "Encrypt with tag: secret" },
      { "name": "_tide_secret.selfdecrypt", "description": "Decrypt with tag: secret" },
      {
        "name": "default-roles-REALM_NAME",
        "composite": true,
        "composites": {
          "realm": ["_tide_enabled", "appUser", "_tide_secret.selfencrypt", "_tide_secret.selfdecrypt"]
        }
      }
    ]
  }
}
```

For existing realms, use the API to create roles and assign them to the default composite. See playbook `configure-e2ee-roles-and-policies`.

---

## Anti-Patterns

- **Do not** assign decrypt roles to all users by default for shared data. Encrypt can be broad; decrypt is your access control boundary.
- **Do not** encrypt everything with the same tag. Different sensitivity = different tags = different roles.
- **Do not** use `hasRealmRole("tide-realm-admin")`. It is a client role on `realm-management`. Use `hasClientRole("tide-realm-admin", "realm-management")`.
- **Do not** skip `_tide_enabled` in the default composite. Users without it cannot perform any Tide operations.
