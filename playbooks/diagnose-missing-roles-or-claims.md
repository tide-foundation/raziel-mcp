# Diagnose Missing Roles or Claims

Troubleshoot missing or incorrect JWT claims.

---

## Pre-Check: Is There a Real JWT?

Before inspecting claims, confirm the app is using real Tide JWTs, not fake auth:

```bash
# Check for fake/hardcoded tokens
grep -r "auth_token\|fake.*token\|hardcoded\|FAKE_USERS" lib/ app/ --include="*.ts" --include="*.tsx"
# If matches: the app is using fake auth, not Tide. Fix the auth system first.

# Check for cookie-based auth instead of JWT
grep -r "cookies.*auth\|cookie.*token" app/api/ --include="*.ts"
# If matches: API reads auth from cookies, not Authorization header. See protect-api-nextjs.md.
```

If the app has no real Tide integration (no `@tidecloak/nextjs` in package.json, no `TideCloakProvider` in layout), stop. Complete [add-auth-nextjs-fresh.md](add-auth-nextjs-fresh.md) first. Role diagnostics only apply to apps with working Tide auth.

---

## Symptom: Role Check Always Fails

**What you see**: `hasRealmRole('admin')` returns false even for admin users.

**Diagnostic steps**:

### Step 1: Check JWT Contents

```typescript
// Client-side
const { getValueFromToken, getValueFromIdToken } = useTideCloak();
console.log('User sub:', getValueFromToken("sub"));
console.log('Realm roles:', getValueFromToken("realm_access")?.roles);
console.log('Resource access:', getValueFromToken("resource_access"));
```

Or decode JWT manually:
```bash
# Get token from browser DevTools → Application → Local Storage
# Paste at jwt.io to decode
```

### Step 2: Verify Role Name

Common mismatches:
- Looking for `'admin'` but role is `'realm-admin'`
- Case sensitivity: `'Admin'` vs `'admin'`
- Client role vs realm role

```typescript
// Check both realm and client roles
function hasAnyRole(user: any, role: string): boolean {
  // Realm roles
  const realmRoles = user?.realm_access?.roles || [];
  if (realmRoles.includes(role)) return true;

  // Client roles
  const resourceAccess = user?.resource_access || {};
  for (const client of Object.values(resourceAccess)) {
    const clientRoles = (client as any)?.roles || [];
    if (clientRoles.includes(role)) return true;
  }

  return false;
}
```

---

## Symptom: User Has No Roles

**What you see**: `getValueFromToken("realm_access")?.roles` is empty array or undefined.

**Diagnostic**:

```bash
# Check user in TideCloak Admin
# Admin Console → Users → {user} → Role Mappings
# Should show assigned roles
```

**Causes**:

1. **Roles not assigned**: Assign in TideCloak Admin
2. **IGA pending**: If IGA enabled, role assignment needs quorum approval
3. **Default roles missing**: Realm missing default composite role

**Fix (assign role)**:

1. TideCloak Admin → Users → {user} → Role Mappings
2. Assign role → {role-name}
3. If IGA enabled: authorize + commit the change request (requires quorum; see `canon/iga-change-requests-api.md`)
4. User logout/login to get new token

**Fix (default roles)**:

1. TideCloak Admin → Realm Settings → User Registration → Default Roles
2. Add a `_tide_*` role (e.g., `_tide_enabled`) and application default role
3. New users auto-receive these roles

---

## Symptom: Custom Claim Missing

**What you see**: `getValueFromToken("custom_field")` returns undefined.

**Diagnostic**:

Check if protocol mapper exists:

```bash
# TideCloak Admin → Client Scopes → roles → Mappers
# Or: Clients → {client} → Client Scopes → roles → Mappers
```

**Fix (add protocol mapper)**:

1. Client Scopes → roles → Mappers → Create
2. Mapper Type: "User Attribute"
3. User Attribute: `customField` (user attribute name)
4. Token Claim Name: `custom_field` (claim name in JWT)
5. Claim JSON Type: String
6. Add to ID token: ON
7. Add to access token: ON
8. Save

**Fix (set user attribute)**:

1. Users → {user} → Attributes
2. Key: `customField`, Value: `some-value`
3. Save

User must logout/login to get updated token.

---

## Symptom: `tideuserkey` or `vuid` Missing

**What you see**: Tide-specific claims missing.

**Cause**: Protocol mappers not configured or account not linked.

**Diagnostic**:

```bash
# Check user attributes
curl "${TIDECLOAK_URL}/admin/realms/${REALM}/users/${USER_ID}" | \
  jq '.attributes | {tideUserKey, vuid}'
# Should show values

# Check protocol mappers
curl "${TIDECLOAK_URL}/admin/realms/${REALM}/clients/${CLIENT_ID}/protocol-mappers/models" | \
  jq '.[] | select(.name | contains("tide"))'
```

**Fix**: See [canon/troubleshooting.md T-07](../canon/troubleshooting.md#t-07-account-linking-stuck) for account linking.

---

## Symptom: Roles Change But Token Doesn't Update

**What you see**: Assigned new role in TideCloak, but `getValueFromToken("realm_access")?.roles` still shows old values.

**Cause**: Token cached. JWT claims frozen at issue time.

**Fix**:

```bash
# User must logout/login to get fresh token
```

Or force refresh:

```typescript
// Client-side
const { logout, login } = useTideCloak();

async function forceTokenRefresh() {
  await logout();
  await login();
}
```

---

## Symptom: E2EE Role Not Working

**What you see**: `doEncrypt([{ data, tags: ['tag'] }])` fails even though user has role.

**Diagnostic**:

```bash
# Check exact role name
# Should be: _tide_{tag}.selfencrypt
# Not: _tide_encrypt or tide_{tag}
```

**Fix**:

1. TideCloak Admin → Roles → Create Role
2. Name: `_tide_ssn.selfencrypt` (exact pattern)
3. Assign to user
4. Create matching decrypt role: `_tide_ssn.selfdecrypt`
5. User logout/login

---

## Quick Diagnostic Script

```typescript
// Add to app for debugging
function debugAuth() {
  const { authenticated, getValueFromToken, getValueFromIdToken } = useTideCloak();

  console.log('=== Auth Debug ===');
  console.log('Authenticated:', authenticated);
  console.log('User sub:', getValueFromToken("sub"));
  console.log('User name:', getValueFromIdToken("preferred_username"));
  console.log('Realm roles:', getValueFromToken("realm_access")?.roles);
  console.log('Resource access:', getValueFromToken("resource_access"));
  console.log('Tide claims:', {
    tideuserkey: getValueFromToken("tideuserkey"),
    vuid: getValueFromToken("vuid")
  });
}

// Call from browser console
debugAuth();
```

---

## Known Issues

### `_tide_*` Role Required

**Required for all Tide operations**: Every user must have at least one role starting with `_tide_` (e.g., `_tide_enabled`). This role assignment enables the Tide Voucher system to fund user operations.

**Why**: The Vendor uses the `_tide_*` role to verify the user is Tide-enabled before assigning Vouchers. Without this role, Tide-related requests (including authorization) will be rejected.

**Fix**: Add a `_tide_*` role to realm default roles. Common convention: `_tide_enabled`.

---

## References

- [add-rbac-nextjs.md](add-rbac-nextjs.md) - RBAC implementation
- [canon/troubleshooting.md T-07](../canon/troubleshooting.md#t-07-account-linking-stuck) - Account linking
- [canon/concepts.md#tag-based-e2ee-roles](../canon/concepts.md#tag-based-e2ee-roles) - E2EE roles
