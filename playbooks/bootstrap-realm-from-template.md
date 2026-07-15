# Bootstrap Realm from Template

Create a TideCloak realm from the canonical template, initialize Tide licensing and IGA, and approve the initial client change requests.

---

## When to Use

- After `start-tidecloak-dev` — TideCloak is running but has no realm
- Automating realm setup instead of clicking through Admin Console
- Rebuilding a realm from scratch

**Do not use** if the realm already exists. Check: `curl -sf -H "Authorization: Bearer $TOKEN" http://localhost:8080/admin/realms/$REALM_NAME > /dev/null && echo "Exists"`.

---

## Prerequisites

- TideCloak running and reachable (playbook `start-tidecloak-dev` complete)
- `curl`, `jq` installed
- `templates/shared/realm.json.template` available (or equivalent realm template)

---

## Steps

### Step 1: Get master admin token

```bash
TIDECLOAK_URL="${TIDECLOAK_URL:-http://localhost:8080}"
REALM_NAME="${REALM_NAME:-myapp}"
CLIENT_NAME="${CLIENT_NAME:-myclient}"
CLIENT_APP_URL="${CLIENT_APP_URL:-http://localhost:3000}"

get_token() {
  curl -s -X POST "$TIDECLOAK_URL/realms/master/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=admin&password=password&grant_type=password&client_id=admin-cli" \
    | jq -r '.access_token'
}
TOKEN="$(get_token)"
```

### Step 2: Prepare realm template

```bash
TMP_REALM="$(mktemp)"
cp templates/shared/realm.json.template "$TMP_REALM"
sed -i "s|REALM_NAME|$REALM_NAME|g" "$TMP_REALM"
sed -i "s|CLIENT_NAME|$CLIENT_NAME|g" "$TMP_REALM"
sed -i "s|CLIENT_APP_URL|$CLIENT_APP_URL|g" "$TMP_REALM"
```

The template contains placeholders: `REALM_NAME`, `CLIENT_NAME`, `CLIENT_APP_URL`. All three must be replaced before import.

### Step 3: Import realm

```bash
TOKEN="$(get_token)"
curl -s -X POST "$TIDECLOAK_URL/admin/realms" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @"$TMP_REALM"
rm -f "$TMP_REALM"
```

### Step 4: Initialize Tide realm

```bash
TOKEN="$(get_token)"
curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/vendorResources/setUpTideRealm" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "email=admin@yourorg.com" \
  --data-urlencode "isRagnarokEnabled=true"
```

This activates the Tide license and generates the VRK. No manual "Manage License" step needed.

**Critical:** Content-Type must be `application/x-www-form-urlencoded`. JSON causes failure.

**Form parameters** (`setUpTideRealm` on `main`):

| Param | Required | Default | Notes |
|-------|----------|---------|-------|
| `email` | Yes (for licensing) | — | Used to request the free-tier license. Ignored only when `skipLicense=true`. |
| `isRagnarokEnabled` | No | `true` | Enables realm offboarding (Ragnarok). The endpoint already defaults it to `true`; passing `isRagnarokEnabled=true` explicitly is harmless and matches the default. |
| `skipLicense` | No | `false` | When `true`, skips license activation (`email` unused) and returns early. Leave at the default for normal bootstrap. |

### Step 5: Enable IGA

```bash
TOKEN="$(get_token)"
curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/tide-admin/toggle-iga" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "isIGAEnabled=true"
```

### Step 6: Approve and commit client change requests

Realm creation + Tide setup generates change requests that must be approved before proceeding.

```bash
# Current /iga/change-requests/... surface (replaces legacy /tide-admin/change-set/...).
# Bootstrap runs in FirstAdmin/Tideless mode, so authorize signs server-side (no enclave).
# Full spec: canon/iga-change-requests-api.md.
approve_all_pending() {
  local TOKEN ready id

  # 1. Authorize all pending CREATE/DELETE change requests in one call.
  TOKEN="$(get_token)"
  curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/iga/change-requests/bulk-authorize" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"actionTypeIn":["CREATE","DELETE"],"limit":100}' > /dev/null 2>&1

  # 2. Commit ready CRs; loop passes so dependent CRs become ready.
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
# Legacy call sites pass a type arg the new list-all surface ignores.
approve_and_commit() { approve_all_pending; }

approve_and_commit clients
```

---

## Verification

- [ ] `curl -H "Authorization: Bearer $TOKEN" "$TIDECLOAK_URL/admin/realms/$REALM_NAME"` returns realm JSON
- [ ] Realm has Tide IdP listed: `curl -H "Authorization: Bearer $TOKEN" "$TIDECLOAK_URL/admin/realms/$REALM_NAME/identity-provider/instances"` includes `tide`
- [ ] IGA is enabled
- [ ] No pending client change requests remain

---

## Common Failures

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Tide realm setup failed" / "Could not set up the Tide realm" | JSON sent to `setUpTideRealm` instead of form data | Use `application/x-www-form-urlencoded` |
| "email is null or empty" | Missing email parameter | Add `--data-urlencode "email=..."` |
| 404 on setUpTideRealm | Wrong path (`/tide-admin/setUpTideRealm`) | Correct path: `/vendorResources/setUpTideRealm` |
| Realm import fails | Placeholders not replaced in template | Verify `sed` replaced all three: `REALM_NAME`, `CLIENT_NAME`, `CLIENT_APP_URL` |
| Missing `link-tide-account-action` | Minimal realm template used | Use full template from `templates/shared/realm.json.template` |

---

## Anti-Patterns

- **Do not** create a minimal realm.json. Every section in the template is required.
- **Do not** skip IGA enablement. The `jwk` field in adapter JSON only appears with IGA enabled.
- **Do not** reorder steps. License before IGA. IGA before change request approval.
- **Do not** leave license activation as a manual step. `setUpTideRealm` handles it automatically.
- **Do not** blindly set `registrationAllowed: true`. This is a deployment decision — open registration lets any user sign up via Tide IdP. For invite-only apps, keep it `false` and use admin invite links (`tideAdminResources/get-required-action-link`). The admin invite link bypasses the registration gate. VERIFIED (LEARNINGS-batch-008 L-01).
- **Do not** use the standard Keycloak adapter export path (`/clients/{id}/installation/providers/...`). Use `vendorResources/get-installations-provider?clientId={uuid}&providerId=keycloak-oidc-keycloak-json`. The standard path returns a minimal adapter missing `jwk`, `vendorId`, `homeOrkUrl`. VERIFIED (LEARNINGS-batch-008 L-04).

### Realm Deletion on Dev Image (H2)

If re-running bootstrap against an existing realm, delete the old realm first. On the H2 dev database, `DELETE /admin/realms/{realm}` fails with FK constraint violations on composite roles. Use this sequence:

1. Disable IGA: `POST /tide-admin/toggle-iga` with `isIGAEnabled=false`
2. Delete Tide IdP: `DELETE /identity-provider/instances/tide`
3. Strip ALL composite roles (realm-level and per-client) — remove composites from `default-roles-*`, `realm-admin`, `manage-account`, etc.
4. Delete realm: `DELETE /admin/realms/{realm}`

Or: stop the container, delete `data/keycloakdb*`, restart. VERIFIED (LEARNINGS-batch-008 L-06).

---

## Next Step

Proceed to playbook `initialize-admin-and-link-account`.
