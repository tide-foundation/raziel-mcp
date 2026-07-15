# Add Role-Based Access Control (RBAC) in Next.js

Implement role-based access control using Tide JWT roles.

---

## When to Use

- Need different access levels (admin, editor, viewer)
- Need fine-grained permissions
- Have configured roles in TideCloak realm
- Roles assigned to users via IGA

---

## Prerequisites

**Required — do not skip**:

1. API protection implemented: [protect-api-nextjs.md](protect-api-nextjs.md) **must be completed first**. That playbook creates the files this playbook imports (`lib/auth/tideJWT.ts`, `lib/auth/protect.ts`, `lib/auth/tidecloakConfig.ts`) and installs `jose`.
2. Roles created in TideCloak Admin Console
3. Users assigned roles (via IGA if enabled)

**Verify before proceeding**:
```bash
# These files must exist (created by protect-api-nextjs.md)
ls lib/auth/tideJWT.ts lib/auth/protect.ts lib/auth/tidecloakConfig.ts
# jose must be installed
grep '"jose"' package.json
```

If any are missing, complete [protect-api-nextjs.md](protect-api-nextjs.md) first.

---

## Role Storage in Tide

Roles appear in JWT token:

```json
{
  "realm_access": {
    "roles": ["admin", "offline_access", "_tide_enabled"]
  },
  "resource_access": {
    "my-client": {
      "roles": ["manage-account"]
    }
  }
}
```

**Realm roles**: Global to realm (`realm_access.roles`)
**Client roles**: Specific to client (`resource_access.{client-id}.roles`)

---

## Client-Side RBAC (UI Gating Only)

```typescript
// components/AdminPanel.tsx
'use client';

import { useTideCloak } from '@tidecloak/nextjs';

export function AdminPanel() {
  const { hasRealmRole } = useTideCloak();

  if (!hasRealmRole('admin')) {
    return <div>Access denied</div>;
  }

  return (
    <div>
      <h1>Admin Panel</h1>
      {/* admin content */}
    </div>
  );
}
```

**Warning**: This is UI gating. Real enforcement happens server-side.

---

## Server-Side RBAC (Real Authorization)

```typescript
// app/api/admin/users/route.ts
import { withRole } from '@/lib/auth/protect';

// Requires 'admin' role
export const GET = withRole('admin', async (req, jwt) => {
  return Response.json({ users: [...] });
});
```

**Multiple roles** (any match):

```typescript
// lib/auth/protect.ts
export function withAnyRole(roles: string[], handler: AuthenticatedHandler) {
  return withAuth(async (req, jwt) => {
    const hasAnyRole = roles.some(role => hasRole(jwt, role));
    if (!hasAnyRole) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    return handler(req, jwt);
  });
}

// Usage
export const GET = withAnyRole(['admin', 'editor'], async (req, jwt) => {
  return Response.json({ data: [...] });
});
```

---

## Role Hierarchies

TideCloak supports composite roles. Define in Admin Console:

1. Create `super-admin` role
2. Add `admin`, `editor`, `viewer` as composite roles
3. Assign `super-admin` to user → user inherits all roles

---

## E2EE Role-Based Encryption

Tide E2EE uses tag-based roles for **self-encryption** (user-bound, private data):

**Role pattern**: `_tide_<tag>.selfencrypt`, `_tide_<tag>.selfdecrypt`

```typescript
// Client-side E2EE with role enforcement (self-encryption)
const { doEncrypt, doDecrypt } = useTideCloak();

// Both take a single argument: an ARRAY of items. Each encrypt item is
// { data, tags }; the tags drive the _tide_<tag>.self* role check.
// Requires _tide_ssn.selfencrypt role
const [ciphertext] = await doEncrypt([{ data: '123-45-6789', tags: ['ssn'] }]);

// doDecrypt takes the array of encrypted items ({ encrypted, tags }).
// Requires _tide_ssn.selfdecrypt role
const [plaintext] = await doDecrypt([{ encrypted: ciphertext, tags: ['ssn'] }]);
```

**Signature note**: The `useTideCloak()` `doEncrypt`/`doDecrypt` are single-argument (`data`) wrappers. `data` is an array so you can encrypt/decrypt multiple fields in one call. This matches the shapes in [setup-forseti-e2ee.md](setup-forseti-e2ee.md) and [configure-e2ee-roles-and-policies.md](configure-e2ee-roles-and-policies.md). Do NOT call them with positional `(tag, value)` arguments — that form does not exist.

Fabric enforces roles cryptographically. See [canon/concepts.md#tag-based-e2ee-roles](../canon/concepts.md#tag-based-e2ee-roles).

**Self-encryption is user-bound**: only the encrypting user can decrypt. Giving another user the `selfdecrypt` role does NOT let them decrypt your data. For shared data between users, use policy-governed VVK encryption with a Forseti contract instead. See [setup-forseti-e2ee.md](setup-forseti-e2ee.md) and [canon/anti-patterns.md AP-24](../canon/anti-patterns.md#ap-24-using-self-encryption-for-shared-data-between-users).

---

## Verification Checklist

- [ ] Admin API rejects non-admin users (403)
- [ ] Role-based UI elements show/hide correctly
- [ ] Multiple roles (OR condition) work
- [ ] Composite roles inherit permissions
- [ ] E2EE roles enforce encrypt/decrypt access

---

## Common Failures

### Role Always Missing in JWT

**Fix**: See [diagnose-missing-roles-or-claims.md](diagnose-missing-roles-or-claims.md).

---

## Do Not Do This

### ❌ Do Not Mix Tide Roles with App Roles

```typescript
// ❌ WRONG: Confuse E2EE role with app admin role
if (hasRealmRole('_tide_ssn.selfencrypt')) {
  // Grant admin access (WRONG)
}
```

**Why**: `_tide_*` roles are for E2EE, not app permissions. See [canon/anti-patterns.md AP-18](../canon/anti-patterns.md#ap-18-mixing-tide-roles-with-application-roles).

---

## References

- [protect-api-nextjs.md](protect-api-nextjs.md) - API protection
- [canon/concepts.md](../canon/concepts.md#tag-based-e2ee-roles) - E2EE roles
- [diagnose-missing-roles-or-claims.md](diagnose-missing-roles-or-claims.md) - Debug roles
