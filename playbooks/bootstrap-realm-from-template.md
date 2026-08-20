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

Stamp `iga.attestor=tide` on the realm BEFORE enabling IGA so governance comes up
in Tide (cryptographic) mode rather than Tideless:

```bash
TOKEN="$(get_token)"
REALM_REP=$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME" -H "Authorization: Bearer $TOKEN")
UPDATED_REALM=$(echo "$REALM_REP" | jq '.attributes = ((.attributes // {}) + {"iga.attestor":"tide"})')
curl -s -X PUT "$TIDECLOAK_URL/admin/realms/$REALM_NAME" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary "$UPDATED_REALM"

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
  # NOTE: do NOT use bulk-authorize with actionTypeIn:["CREATE","DELETE"] — those are
  # not real action-type values (real ones are CREATE_USER, DELETE_REALM,
  # UPDATE_PROTOCOL_MAPPER, ADOPT_SCOPE_MAPPING, GRANT_ROLES, ...). That filter matches
  # nothing and silently authorizes ZERO CRs with a 200. Omitting the filter returns 400.
  # Authorize each pending CR individually instead. VERIFIED 2026-08-06.
  # See canon/iga-change-requests-api.md.
  ids=$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/iga/change-requests?status=PENDING" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null \
    | jq -r 'if type=="array" then .[].id else empty end' 2>/dev/null)
  for id in $ids; do
    TOKEN="$(get_token)"
    curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/iga/change-requests/$id/authorize" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}' > /dev/null 2>&1 || true
  done

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

1. Disable IGA: `POST /tide-admin/toggle-iga`, **form-encoded**, `isIGAEnabled=false`.

   ⚠️ **This step previously said JSON `{"enabled":false}`, which ENABLES IGA.** The endpoint reads
   the form parameter `isIGAEnabled`; a JSON body is accepted, parsed by nothing, and the missing
   parameter **fails open to `true`**. A teardown path that turns the thing on is a bad way to spend
   an afternoon. Assert the response:

   ```bash
   OUT=$(curl -sf -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/tide-admin/toggle-iga" \
     -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/x-www-form-urlencoded' \
     --data-urlencode "isIGAEnabled=false")
   case "$OUT" in *'"enabled":false'*) : ;; *) echo "toggle-iga returned $OUT" >&2; exit 1 ;; esac
   ```

   ⚠️ **Disabling can be REFUSED while change requests are pending.** From an enabled realm the call
   may return `{"error":…,"conflictingChangeRequestId":…}` and leave IGA on — drain the queue first
   (`templates/shared/drain-change-requests.py`), then retry. If the realm is already multiAdmin and
   you are locked out, the only recovery is the **master-realm admin disabling IGA on that realm**;
   there is no other path. VERIFIED 2026-08-10.
2. Delete Tide IdP: `DELETE /identity-provider/instances/tide`
3. Strip ALL composite roles (realm-level and per-client) — remove composites from `default-roles-*`, `realm-admin`, `manage-account`, etc.
4. Delete realm: `DELETE /admin/realms/{realm}`

Or: stop the container, delete `data/keycloakdb*`, restart. VERIFIED (LEARNINGS-batch-008 L-06).

---

## Before you move on: ask the two end-user questions

These are the only two things the **end user** ever sees, and the default for both is wrong. Neither
is optional to *ask*; both are optional to *do*. Ask both in one message, once:

**(a) Branding** — right now their users see **Tide's** logo at sign-in.

> Want to brand the login screen? Three ways: you drop artwork in `./branding/`, I write you an
> image-AI prompt tailored to this app, or I generate it.

Then `templates/enclave-branding/brand-tidecloak.sh` — generate → validate → upload → sign → verify.
Branding is **IGA-exempt**, so it works even after the multiAdmin flip.

**(b) Post-signup details** — Tide asserts only a username (the vuid), so Keycloak stops every new
user on its own unstyled *Update Account Information* page showing a 64-character username.

> Tide gives each new user a unique account with no name or email. Want a small in-app form so they
> can fill those in — and which fields do you actually need?

Then `templates/skip-idp-review/diagnose-post-signup-page.sh` (four mechanisms cause that page and
each needs a different fix — **never a blind fix**), the matching fix, and
`templates/onboarding-modal/ProfileOnboarding.tsx`.

⚠️ **Do not invent a placeholder email** to make the profile look complete (**AP-85**). Tide does not
need email for recovery — password reset happens in the enclave.

If they skip either, record it and move on. Ask once, not every turn.

---

## Next Step

Proceed to playbook `initialize-admin-and-link-account`.
