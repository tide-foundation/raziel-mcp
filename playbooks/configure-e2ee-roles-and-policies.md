# Configure E2EE Roles and Policies

Create encryption/decryption realm roles, assign them to default users, and approve the resulting change requests. Optionally deploy a Forseti contract for shared (policy-governed) encryption.

This is realm-level preparation. App-level E2EE wiring (`doEncrypt`/`doDecrypt`) is covered in playbook `setup-forseti-e2ee` and skill `tide-rbac-and-e2ee`.

---

## When to Use

- After `initialize-admin-and-link-account` — admin linked, adapter exported
- App needs self-encryption (private data, only the encrypting user can decrypt)
- App needs shared encryption (policy-governed, multiple users can decrypt)

**Do not use** if E2EE roles already exist. Check: `curl -H "Authorization: Bearer $TOKEN" "$TIDECLOAK_URL/admin/realms/$REALM_NAME/roles" | jq '.[].name' | grep '_tide_'`.

---

## Prerequisites

- TideCloak running with realm fully bootstrapped (all three prior playbooks complete)
- Admin has linked Tide account
- Decision: which data tags to protect (e.g., `secret`, `medical`, `vault`)

---

## Two Encryption Models

Choose the right model before creating roles.

| Model | SDK method | Who can decrypt | Roles needed |
|-------|-----------|----------------|--------------|
| Self-encryption | `doEncrypt`/`doDecrypt` (no policy) | Only the encrypting user | `_tide_{tag}.selfencrypt`, `_tide_{tag}.selfdecrypt` |
| Policy-governed (VVK) | `IAMService.doEncrypt(data, policyBytes)` | Any user whose doken satisfies the Forseti contract | `_tide_{tag}.selfencrypt`, `_tide_{tag}.selfdecrypt` (voucher gates) + a regular role for the contract |

Self-encryption is simpler. Start here unless you explicitly need sharing.

**After completing this playbook**: Self-encryption works immediately. Shared encryption does NOT — it additionally requires the admin signing ceremony from `setup-forseti-e2ee`. That ceremony is browser-only (cannot be scripted) and must happen before any user can encrypt shared data. If the app offers a "shared" mode, it must be blocked/gated until the signing ceremony is complete. VERIFIED (session-002).

**Anti-pattern:** Using self-encryption (`doEncrypt`/`doDecrypt` without policy) for shared data. Ciphertext is bound to the encrypting user's identity. Another user with the same `selfdecrypt` role cannot decrypt it. VERIFIED.

**Anti-pattern:** Renaming `selfencrypt`/`selfdecrypt` to `encrypt`/`decrypt` to "enable sharing". The role suffix does not change the encryption model. The SDK call path determines self vs shared. See AP-26.

**If self-encryption fails**, fix the self-encryption setup (roles, IGA approval, re-login). Do not switch models as a "fix". See T-13.

---

## Steps: Self-Encryption Roles

### Step 1: Add roles to realm template

Add role entries for each tag to `templates/shared/realm.json.template` under `roles.realm`, and include them in the default composite role:

```json
{ "name": "_tide_secret.selfencrypt", "description": "Encrypt data with tag: secret" },
{ "name": "_tide_secret.selfdecrypt", "description": "Decrypt data with tag: secret" }
```

Update the default composite:
```json
{
  "name": "default-roles-REALM_NAME",
  "composites": { "realm": ["_tide_enabled", "appUser", "_tide_secret.selfencrypt", "_tide_secret.selfdecrypt"] }
}
```

See `templates/shared/role-matrix.md` for the full role reference.

### Step 2: Create roles via API (existing realm)

If the realm already exists (no template re-import), create roles via API:

```bash
TOKEN="$(get_token)"
for ROLE in "_tide_secret.selfencrypt" "_tide_secret.selfdecrypt"; do
  curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/roles" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$ROLE\",\"description\":\"E2EE role for tag: secret\"}"
done
```

### Step 3: Assign roles to default composite

```bash
TOKEN="$(get_token)"
DEFAULT_ROLE_ID=$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/roles/default-roles-$REALM_NAME" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.id')

ROLES_JSON=$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/roles" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '[.[] | select(.name | startswith("_tide_secret."))]')

curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/roles-by-id/$DEFAULT_ROLE_ID/composites" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$ROLES_JSON"
```

### Step 4: Approve change requests

Role assignments produce IGA change requests that must be approved:

```bash
approve_and_commit roles
```

(Use the `approve_and_commit` function from prior playbooks.)

### Step 5: Users must re-login

After roles are committed, users must log out and back in (or call `forceUpdateToken()`) for the new roles to appear in their doken. Token refresh delay is up to 120 seconds.

---

## Steps: Policy-Governed Encryption (Shared)

For shared data where multiple users need to decrypt, you need voucher gate roles AND a regular role checked by a Forseti contract.

### Step 1: Create all three role types

```bash
TOKEN="$(get_token)"
for ROLE in "_tide_shared.selfencrypt" "_tide_shared.selfdecrypt" "shared-data-access"; do
  curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/roles" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$ROLE\"}"
done
```

| Role | Purpose |
|------|---------|
| `_tide_shared.selfencrypt` | Voucher gate — enables `vendorsign` action at ORK |
| `_tide_shared.selfdecrypt` | Voucher gate — enables `vendordecrypt` action at ORK |
| `shared-data-access` | Forseti contract checks this for actual access control |

Add all three to the default composite role.

### Step 2: Forseti contract deployment (browser signing flow only)

**There is no REST API for deploying Forseti contracts.** The endpoint `PUT /tide-admin/forseti-contracts` does not exist on the dev or staging image (returns 404/405). VERIFIED (learning-batch-003, L-06; session-001, RB-010).

The contract is deployed as part of the PolicySignRequest flow in the admin's browser:
1. Embed the contract C# source code in the admin page
2. Compute the SHA-512 hash client-side as the `contractId`
3. Use `policyRequest.addForsetiContractToUpload(contractSource)` during the signing flow

The contract source code is included in the signing request and uploaded to the ORKs automatically. No prior deployment step is needed.

See `setup-forseti-e2ee.md` for the full browser-based signing flow.

### Step 3: Policy signing (frontend only)

Policy signing requires the admin's browser enclave. It cannot be done from a script.

The admin must:
1. Log in to the app as `tide-realm-admin`
2. Sign the role policy (init-cert) via approval popup
3. Sign the encryption policy via approval popup

Both policies must be signed before the group is usable. See playbook `setup-forseti-e2ee` for the full frontend flow.

**Anti-pattern:** Trying to sign policies from the init script or backend. Signing requires `requiresApprovalPopup: true` → browser enclave. The script can prepare (deploy contracts, attach policies), but signing must happen from the frontend. VERIFIED.

---

## Verification

- [ ] `_tide_{tag}.selfencrypt` and `_tide_{tag}.selfdecrypt` roles exist in realm
- [ ] Roles are in the default composite (or assigned to target users)
- [ ] All role change requests approved and committed
- [ ] (Self-encryption) `doEncrypt`/`doDecrypt` works in app after user re-login
- [ ] (Shared encryption) Forseti contract deployed, both policies signed by admin

---

## Common Failures

| Symptom | Cause | Fix |
|---------|-------|-----|
| `doEncrypt` throws "unauthorized" | User lacks `_tide_{tag}.selfencrypt` role | Create and assign the role, approve via IGA |
| "vendordecrypt voucher not allowed" | User lacks `_tide_{tag}.selfdecrypt` role | Same — create, assign, approve |
| "Policy supplied has not been signed" | Admin policy not signed via browser enclave | Admin must sign both policies from frontend |
| Decrypt fails for another user (self-encryption) | Self-encryption binds to encrypting user | Use policy-governed VVK encryption for sharing |
| Roles assigned but encrypt still fails | User hasn't refreshed token | Log out/in or call `forceUpdateToken()` |

---

## Anti-Patterns

- **Do not** assign decrypt roles to all users by default for shared data. Encrypt roles can be broad; decrypt roles are your access control boundary.
- **Do not** encrypt everything with the same tag. Different sensitivity levels should use different tags mapped to different roles.
- **Do not** skip tags on encrypted fields. Tags define who can decrypt.
- **Do not** use the built-in `GenericRealmAccessThresholdRole` contract for production. Deploy a custom Forseti contract.
- **Do not** use `_tide_*` roles in your Forseti contract's `ValidateExecutor`. Those are voucher gates only. Use a regular realm role for access control.
