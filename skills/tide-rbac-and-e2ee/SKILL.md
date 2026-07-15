# Role: IAM / Policy Engineer

---

## Purpose

Add role-based access control to protected APIs using verified JWT claims. Optionally add self-encryption (user-bound E2EE) using Tide's tag-based role system. Both features require prior auth + API protection.

---

## When to Trigger

- User asks to "add roles", "add RBAC", "add permissions", or "add access levels"
- User asks to "encrypt data", "add E2EE", or "add field-level encryption" — **but first check the sharing gate below**
- User asks about `_tide_*` roles or tag-based encryption roles
- Agent detects API routes that verify JWT but do not check roles

### Scenario-disambiguation gate (I-17)

Before starting encryption or RBAC work, resolve these branches:

| Branch | How to resolve |
|--------|---------------|
| Self-encryption vs shared encryption | Does anyone other than the encrypting user need to decrypt? If yes → `setup-forseti-e2ee`, not this skill. |
| Simple RBAC vs policy governance | Does the app need multi-admin approval, IGA change-sets, or Forseti contracts? If yes → `setup-forseti-e2ee` or `setup-iga-admin-panel`. |
| RBAC only vs RBAC + E2EE | Does the user need encryption at all, or just role-based access control? |

**Mandatory sharing gate** (instance of I-17 for encryption):

If the user's request mentions ANY of the following, **STOP** and route to playbook `setup-forseti-e2ee` instead of this skill:
- "share", "sharing", "shared"
- "other users can decrypt", "recipients", "chosen people"
- "cross-user", "multi-user", "group encryption"
- "encrypt for others", "selective access"
- any indication that someone other than the encrypting user needs to decrypt

Self-encryption (this skill) is **permanently user-bound**. It cannot be upgraded to shared encryption later. The SDK call path must be different from the start (`IAMService.doEncrypt(data, policyBytes)` instead of `doEncrypt`/`doDecrypt`). Building self-encryption first and trying to add sharing is a known failure mode (AP-24, session-001).

---

## When NOT to Trigger

- App is not Tide-enabled. Route to `tide-setup` skill.
- API routes do not verify JWT yet. Route to `tide-route-and-api-protection` skill first. RBAC on unverified tokens is meaningless.
- User needs shared/group encryption (policy-governed VVK encryption with Forseti contracts). That is covered by playbook `setup-forseti-e2ee`, not this skill. This skill covers self-encryption only.
- User asks about a **direct Keycloak-to-TideCloak** migration. That specific path is not yet documented (GAP-023). (Migrating an app off generic-OIDC / NextAuth / Clerk is a separate task covered by `playbooks/migrate-from-existing-auth.md`; the open gap is the KC→TideCloak realm/data migration itself.)

**Early sharing detection**: If the user request mentions any of: "sharing", "share encrypted", "chosen recipients", "other users can decrypt", "cross-user decryption", "encrypt for others", "selective sharing" — route directly to `setup-forseti-e2ee`. Do NOT start with self-encryption and attempt to add sharing later. Self-encryption cannot be upgraded to shared encryption by renaming roles or changing parameters. The SDK call path must be different from the start. VERIFIED (session-001, F-07).

---

## Required Repo Inspection

```bash
# 1. Confirm API protection exists (hard prerequisite)
ls lib/auth/tideJWT.ts lib/auth/protect.ts lib/auth/tidecloakConfig.ts 2>/dev/null
# ALL three must exist. If any is missing, complete tide-route-and-api-protection first.

# 2. Check jose is installed
grep '"jose"' package.json

# 3. Check existing role usage
grep -r 'hasRole\|withRole\|realm_access\|resource_access' app/api/ lib/auth/ --include="*.ts" 2>/dev/null

# 4. Check for E2EE usage
grep -r 'doEncrypt\|doDecrypt' app/ components/ --include="*.tsx" --include="*.ts" 2>/dev/null

# 5. Check for _tide_* role references
grep -r '_tide_' app/ components/ lib/ --include="*.ts" --include="*.tsx" 2>/dev/null
```

If check 1 fails, stop. The `tide-route-and-api-protection` skill must be completed first.

---

## Preconditions

- Tide setup complete (SDK, provider, adapter JSON)
- Login working
- Server-side JWT verification implemented (`lib/auth/tideJWT.ts` with `verifyTideJWT()` and `hasRole()`)
- Auth middleware implemented (`lib/auth/protect.ts` with `withAuth()` and `withRole()`)
- Roles created in TideCloak Admin Console and assigned to users (via IGA if enabled)

---

## Execution Workflow

### Part 1: Server-Side RBAC

**Playbook**: `add-rbac-nextjs`

Follow the playbook to apply `withRole()` to API routes and optionally add client-side `hasRealmRole()` / `hasClientRole()` for UI gating.

**Key facts** (not repeated from playbook — these are pitfalls the playbook assumes you know):

- Roles live in `realm_access.roles` (realm) and `resource_access.{client}.roles` (client). The server-side `hasRole()` utility from `verify-jwt-server-side` checks both.
- The client SDK hook exports `hasRealmRole(role)` and `hasClientRole(role, client?)`. There is no generic `hasRole()` on the hook.
- `tide-realm-admin` is a **client role** on `realm-management`, not a realm role. Use `hasClientRole('tide-realm-admin', 'realm-management')`, not `hasRealmRole('tide-realm-admin')`. (AP-29)
- Client-side `hasRealmRole()` / `hasClientRole()` from `useTideCloak()` is UX only — the API still enforces server-side.

### Part 2: Self-Encryption (E2EE) — private data only, NO sharing

**STOP CHECK**: Did the user's request mention sharing, recipients, or multiple users decrypting? If yes, do NOT proceed. Route to `setup-forseti-e2ee` immediately. Self-encryption CANNOT be shared. This is not fixable by renaming roles.

Self-encryption is user-bound. Only the encrypting user can decrypt their own data. For shared encryption between users, use policy-governed VVK encryption instead (playbook `setup-forseti-e2ee`).

**Playbook**: `add-rbac-nextjs` (E2EE section) covers the implementation steps: creating `_tide_{tag}.selfencrypt` / `_tide_{tag}.selfdecrypt` roles, calling `doEncrypt` / `doDecrypt`, and storing ciphertext.

**Prerequisites for E2EE** (verify before starting):
- IGA enabled on the realm (adapter JSON must have `jwk` field)
- Tag roles created and assigned to users in TideCloak
- Users have at least one `_tide_*` role for voucher gating

**Key facts not in the playbook**:
- Tags are fully application-defined, case-sensitive, max ~237 chars. See `canon/feature-mapping.md`.
- The server stores ciphertext only. It cannot decrypt — decryption requires live Fabric threshold participation in the user's browser.
- Use `TEXT` or `BYTEA` DB columns. `VARCHAR(512)` covers plaintexts up to ~150 bytes after base64 overhead.

---

## Safety Checks

- **Do not mix `_tide_*` roles with app roles.** `_tide_ssn.selfencrypt` is for E2EE voucher gating, not for granting admin access.
- **Self-encryption is NOT shared encryption.** Only the encrypting user can decrypt. For shared data, use Forseti-governed VVK encryption (playbook `setup-forseti-e2ee`).
- **Do not rename roles to enable sharing.** Changing `selfencrypt` → `encrypt` in role names does not switch encryption models. The SDK call path determines self vs shared. See AP-26 in `canon/anti-patterns.md`.
- **E2EE requires online Fabric access.** No offline decryption. No server-side decryption. Do not cache session keys. (I-11, AP-04)
- **Do not invent E2EE patterns** not covered by `canon/feature-mapping.md` or the `add-rbac-nextjs` playbook.
- **Token refresh delay**: After IGA role assignment, roles appear in JWT/doken after next token refresh (up to 120s).

---

## Verification Checklist

### RBAC
- [ ] API with `withRole('admin')` returns 403 for non-admin user
- [ ] API with `withRole('admin')` returns 200 for admin user
- [ ] Client-side `hasRole('admin')` shows correct UI for each role
- [ ] Composite roles (if used) propagate permissions correctly
- [ ] Bypassing UI (direct curl) still enforces role server-side

### Self-Encryption (if applicable)
- [ ] `doEncrypt([{ data, tags: ['tag'] }])` succeeds for user with `_tide_{tag}.selfencrypt` role
- [ ] `doDecrypt([{ data: ciphertext, tags: ['tag'] }])` returns original data for same user
- [ ] `doEncrypt` fails for user without the selfencrypt role
- [ ] `doDecrypt` by a different user fails (expected behavior — self-encryption is user-bound; A-27 INFERRED, not runtime-confirmed)
- [ ] Ciphertext stored in DB is not plaintext

---

## Repair Path

### Role always missing (403 for everyone)
1. Decode JWT: `node -e "console.log(JSON.parse(atob('TOKEN_PAYLOAD_PART')))"` — check `realm_access.roles`
2. Verify role exists in TideCloak Admin Console → Roles
3. Verify role is assigned to user → Users → Role Mappings
4. If IGA is enabled, verify the role assignment change-set was approved and committed
5. Wait up to 120s or force token refresh (logout/login)
6. See playbook `diagnose-missing-roles-or-claims`

### E2EE fails with "User has not been given any access"

**This is a self-encryption setup problem.** Do not rename roles or switch encryption models.

1. Check user has `_tide_{tag}.selfencrypt` or `_tide_{tag}.selfdecrypt` role
2. Check user has at least one `_tide_*` role for voucher gating
3. Check tag name matches exactly (case-sensitive)
4. Check adapter JSON has `jwk` field (IGA must be enabled)
5. Check IGA change requests for roles are approved and committed
6. User must re-login after role assignment (up to 120s propagation delay)

**Forbidden response**: Do not rename `_tide_{tag}.selfencrypt` to `_tide_{tag}.encrypt`. The role suffix does not change the encryption model. See AP-26 and T-13.

**If the user actually needs cross-user decryptability**: This is a different encryption model. Route to playbook `setup-forseti-e2ee`. It requires a Forseti contract, policy signing, and `IAMService.doEncrypt(data, signedPolicyBytes)`. Do not attempt this by renaming roles.

### E2EE ciphertext is undefined or empty
1. Check Fabric connectivity (SWE iframe loads, no CSP errors)
2. Check browser console for ORK errors
3. Ensure `doEncrypt` is called after user is authenticated

### Policy commit fails with "Policy supplied has not been signed"

This is a policy-flow failure, not a role issue. See T-14.

1. Check admin policy was fetched (admin bearer) from `GET /admin/realms/{realm}/iga/role-policies`, reading the signed bytes from the `policy` field (the public `tide-policy-resources/admin-policy` endpoint does not exist on main)
2. Check admin policy bytes were base64-decoded from the `policy` field before use
3. Check `addPolicy(adminPolicyBytes)` was called after approval, not during request construction
4. Check URL construction has no double slashes (strip trailing slash from `auth-server-url`)

---

## Handoff Trace

```
[TRACE]
Scenario: <scenario>
Role: IAM / Policy Engineer
Reason: <RBAC needed | self-encryption needed | shared encryption needed>
Preconditions: JWT verification exists (lib/auth/tideJWT.ts), sharing gate resolved
Next: Reviewer / QA Engineer | STOP
[/TRACE]
```

---

## Do Not Do This

- **Do not implement RBAC without prior JWT verification.** Role checks on unverified tokens are meaningless.
- **Do not use `_tide_*` roles for application permissions.** They are for E2EE voucher gating. Use separate realm or client roles for app-level access control.
- **Do not implement offline decryption** or cache decrypted session keys. (AP-04)
- **Do not use self-encryption for data that multiple users need to access.** Use policy-governed VVK encryption with a Forseti contract instead. (AP-24 in canon/anti-patterns.md)
- **Do not assume E2EE is available without IGA.** The `jwk` field (required for E2EE) is only in the adapter JSON when IGA is enabled.
- **Do not store decrypted data server-side.** The whole point of Tide E2EE is that plaintext exists only in the user's browser.
- **Do not rename `selfencrypt`/`selfdecrypt` to `encrypt`/`decrypt` to "fix" encryption failures or enable sharing.** The role suffix is a naming convention. The SDK call path determines the encryption model. See AP-26.
- **Do not treat policy commit failure as a role issue.** Missing admin policy on commit is a bootstrap/policy-flow failure. See T-14.
