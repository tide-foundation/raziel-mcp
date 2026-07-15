# Initialize Admin and Link Tide Account

Create the realm admin user, assign `tide-realm-admin`, generate the invite link, wait for account linking, approve user change requests, configure the IdP domain, and export the adapter JSON.

---

## When to Use

- After `bootstrap-realm-from-template` — realm exists with IGA enabled, client change requests approved
- Admin user does not yet exist in the realm

**Do not use** if the admin already has `tideUserKey` set. Check: `curl -H "Authorization: Bearer $TOKEN" "$TIDECLOAK_URL/admin/realms/$REALM_NAME/users?username=admin" | jq -r '.[0].attributes.tideUserKey[0] // empty'`.

---

## Prerequisites

- TideCloak running with realm created and IGA enabled (playbook `bootstrap-realm-from-template` complete)
- `curl`, `jq` installed
- A browser to open the invite link (interactive step)

---

## Steps

### Step 1: Create admin user

```bash
TIDECLOAK_URL="${TIDECLOAK_URL:-http://localhost:8080}"
REALM_NAME="${REALM_NAME:-myapp}"
CLIENT_NAME="${CLIENT_NAME:-myclient}"
CLIENT_APP_URL="${CLIENT_APP_URL:-http://localhost:3000}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@yourorg.com}"

get_token() {
  curl -s -X POST "$TIDECLOAK_URL/realms/master/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=admin&password=password&grant_type=password&client_id=admin-cli" \
    | jq -r '.access_token'
}

TOKEN="$(get_token)"
curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"email\":\"$ADMIN_EMAIL\",\"enabled\":true}"
```

### Step 1b: Approve user creation change request (if any)

With IGA enabled, user creation usually generates a change request. Approve before proceeding. **Note**: When the master admin token creates the first user, IGA may not generate a change request (the master admin bypasses realm-level IGA). The `approve_and_commit` function handles this gracefully — if no requests exist, it skips. VERIFIED (atproto-learnings L-02).

```bash
sleep 2
approve_and_commit users
```

(Use the `approve_and_commit` function from `bootstrap-realm-from-template`.)

**Failure if skipped**: User lookup in Step 2 returns `null`. Role lookup returns `{"error":"..."}` which gets passed as the role mapping body, producing `Invalid json representation for RoleRepresentation`.

### Step 2: Assign tide-realm-admin role

`tide-realm-admin` is a **client role** on the `realm-management` client, not a realm role.

```bash
TOKEN="$(get_token)"
USER_ID=$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/users?username=admin" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')

if [ -z "$USER_ID" ] || [ "$USER_ID" = "null" ]; then
  echo "ERROR: Could not find admin user. Was the user change request approved?"
  exit 1
fi

TOKEN="$(get_token)"
CLIENT_UUID=$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/clients?clientId=realm-management" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')

ROLE_JSON=$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/clients/$CLIENT_UUID/roles/tide-realm-admin" \
  -H "Authorization: Bearer $TOKEN")

# Validate we got a role, not an error
if echo "$ROLE_JSON" | jq -e '.error' > /dev/null 2>&1; then
  echo "ERROR: tide-realm-admin role not found: $ROLE_JSON"
  exit 1
fi

TOKEN="$(get_token)"
curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/users/$USER_ID/role-mappings/clients/$CLIENT_UUID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "[$ROLE_JSON]"
```

### Step 3: Generate invite link

Use the required-action-link endpoint. **Do not use `execute-actions-email`** — it fails on the dev image without SMTP configuration (`"Invalid sender address 'null'"`). The direct link method works without SMTP. VERIFIED (LEARNINGS-batch-008 L-05).

```bash
TOKEN="$(get_token)"
INVITE_LINK=$(curl -s -X POST \
  "$TIDECLOAK_URL/admin/realms/$REALM_NAME/tideAdminResources/get-required-action-link?userId=$USER_ID&lifespan=43200" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '["link-tide-account-action"]')

echo "====================================="
echo "Open this link in a browser to link your admin Tide account:"
echo "$INVITE_LINK"
echo "====================================="
```

**This is an interactive step.** The admin must open the link in a browser and complete the Tide account linking flow. The script cannot automate this — it requires the user's browser.

### Step 4: Wait for account linking

```bash
echo "Waiting for admin to link Tide account..."
while true; do
  TOKEN="$(get_token)"
  KEY=$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/users?username=admin" \
    -H "Authorization: Bearer $TOKEN" | jq -r '.[0].attributes.tideUserKey[0] // empty')
  [ -n "$KEY" ] && echo "Account linked." && break
  sleep 5
done
```

### Step 5: Approve user change requests

```bash
# Reuse approve_all_pending from bootstrap-realm-from-template.
# Current /iga/change-requests/... surface (replaces legacy /tide-admin/change-set/...).
# Bootstrap = FirstAdmin/Tideless: authorize signs server-side. Spec: canon/iga-change-requests-api.md.
approve_all_pending() {
  local TOKEN ready id

  TOKEN="$(get_token)"
  curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/iga/change-requests/bulk-authorize" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"actionTypeIn":["CREATE","DELETE"],"limit":100}' > /dev/null 2>&1

  for pass in 1 2 3 4 5; do
    TOKEN="$(get_token)"
    ready=$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/iga/change-requests?status=PENDING" \
      -H "Authorization: Bearer $TOKEN" 2>/dev/null \
      | jq -r '.[] | select(.readyToCommit==true) | .id' 2>/dev/null)
    [ -z "$ready" ] && break
    for id in $ready; do
      TOKEN="$(get_token)"
      curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/iga/change-requests/$id/commit" \
        -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1
    done
  done
}
approve_and_commit() { approve_all_pending; }

approve_and_commit users
approve_and_commit roles
approve_and_commit clients
```

**Sweep all types.** Account linking generates a user change request for the `tideUserKey` attribute write. The IGA toggle and setUpTideRealm may also have generated accumulated client change requests. Approve all three types here. VERIFIED (atproto-learnings L-06, L-07).

### Step 6: Update CustomAdminUIDomain

Required for enclave approval popups to work from the app origin.

```bash
TOKEN="$(get_token)"
INST=$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/identity-provider/instances/tide" \
  -H "Authorization: Bearer $TOKEN")
UPDATED=$(echo "$INST" | jq --arg d "$CLIENT_APP_URL" '.config.CustomAdminUIDomain=$d')
curl -s -X PUT "$TIDECLOAK_URL/admin/realms/$REALM_NAME/identity-provider/instances/tide" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d "$UPDATED"

curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/vendorResources/sign-idp-settings" \
  -H "Authorization: Bearer $TOKEN"
```

### Step 7: Export adapter JSON

```bash
TOKEN="$(get_token)"
CLIENT_UUID=$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/clients?clientId=$CLIENT_NAME" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')

ADAPTER_OUTPUT="${ADAPTER_OUTPUT:-./data/tidecloak.json}"
curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/vendorResources/get-installations-provider?clientId=$CLIENT_UUID&providerId=keycloak-oidc-keycloak-json" \
  -H "Authorization: Bearer $TOKEN" > "$ADAPTER_OUTPUT"

echo "Adapter config saved to $ADAPTER_OUTPUT"
```

Verify the export:
```bash
node -e "const c=require('$ADAPTER_OUTPUT'); console.log('jwk:', !!c.jwk, 'vendorId:', !!c.vendorId, 'homeOrkUrl:', !!c.homeOrkUrl)"
```

---

## Verification

- [ ] Admin user exists with `tideUserKey` attribute set
- [ ] `tide-realm-admin` assigned (client role on `realm-management`)
- [ ] No pending user change requests remain
- [ ] CustomAdminUIDomain matches app origin
- [ ] Adapter JSON at `$ADAPTER_OUTPUT` contains `jwk`, `vendorId`, `homeOrkUrl`

---

## Common Failures

| Symptom | Cause | Fix |
|---------|-------|-----|
| Invite link returns 404 | `requiredActions` missing from realm template | Use full template with `link-tide-account-action` |
| "Could not find configuration for Required Action" | Tide env vars missing from container | Restart container with all required env vars |
| `tideUserKey` never appears | Admin didn't complete the linking flow | Open invite link in browser, complete the flow |
| Enclave popups don't work from app | CustomAdminUIDomain not set | Run Step 6 |
| Adapter JSON missing `jwk` | `setUpTideRealm` did not run / no `tide-vendor-key` component + EdDSA key on the realm (the `jwk` is gated on those, not on IGA) | Re-run `setUpTideRealm` from `bootstrap-realm-from-template` Step 4 and confirm it returned 200 |

---

## Anti-Patterns

- **Do not** auto-approve IGA role assignments from the backend. `requiresApprovalPopup: true` means the browser enclave is required for VVK-signed UserContexts.
- **Do not** skip the invite link step. Account linking is interactive by design.
- **Do not** use `hasRealmRole("tide-realm-admin")` to check admin status. It is a client role on `realm-management`. Use `hasClientRole("tide-realm-admin", "realm-management")`.

---

## Next Step

Bootstrap is complete. Proceed to app integration:
- Fresh app → playbook `add-auth-nextjs-fresh`
- E2EE needed → playbook `configure-e2ee-roles-and-policies`
