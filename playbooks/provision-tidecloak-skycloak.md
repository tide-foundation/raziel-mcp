# Provision Hosted TideCloak via Skycloak

Provision a managed TideCloak cluster in Skycloak's cloud, then bootstrap the Tide realm on it. This is the hosted alternative to `deploy-tidecloak-docker`.

Everything below is **VERIFIED against the live API (2026-08-06)** unless tagged otherwise. Several field names and values contradict Skycloak's public docs; those are called out inline. Trust this file over the docs.

Read `canon/hosting-options.md` first for the trust model and honest caveats.

---

## When to Use

- The team does not want to run auth infrastructure (containers, DB, upgrades, TLS, backups).
- You need a stable public URL rather than `localhost`.

**Do not use** if:
- The deployment must be air-gapped or fully self-controlled → `deploy-tidecloak-docker`.
- You already have a running TideCloak → go straight to realm bootstrap.
- You want the fastest dev loop → local Docker is quicker, has no plan limits, and no enclave-approval friction.

---

## Prerequisites

- A Skycloak account with a workspace.
- **TideCloak enabled for your workspace.** It is NOT on by default in prod — Skycloak enables it per workspace. Without it, cluster creation fails with an opaque `500`.
- A plan allowing the cluster you need. **Trial = 1 cluster.**
- `curl` and `jq`.

**Two credentials, do not conflate them:**
- The **device access token** (device flow, public client `skycloak-mcp`, no secret — Step 0) is **not** an API credential. Its only job is minting an API key (Step 0b).
- The **minted API key** (`full_key`) is what the public API accepts, in the **`API-Key`** header. `API-Key` is the **only** header the gateway accepts — a Bearer token will never authenticate against `https://api.skycloak.io`.

**Secret handling (AP-HOST-3):** device token, `full_key`, and the automation-client secret are all bootstrap secrets. Shell/CI environment only. Never in app code, the repo, or `tidecloak.json` (same rule as AP-41).

---

## Overview

```
0.  Device authorization      (login.app.skycloak.io) → device token
0b. Mint scoped API key       (app.skycloak.io)       → full_key
1.  Create cluster type=tidecloak (api.skycloak.io)   → cluster id
2.  Poll until available      (api.skycloak.io)       → cluster URL
3.  Automation creds → admin token                    → admin token
4.  Bootstrap the Tide realm  (cluster admin API)     → adapter JSON
5.  Wire the app              (unchanged)
```

---

## Step 0: Device authorization

```bash
LOGIN="https://login.app.skycloak.io/realms/skycloak/protocol/openid-connect"
dev=$(curl -s -X POST "$LOGIN/auth/device" -d "client_id=skycloak-mcp" -d "scope=openid")
DEVICE_CODE=$(echo "$dev" | jq -r '.device_code')
INTERVAL=$(echo "$dev" | jq -r '.interval // 5')
echo "$dev" | jq -r '"APPROVE: \(.verification_uri_complete)   (code \(.user_code))"'

# SHOW that URL to the operator, then poll:
while :; do
  sleep "$INTERVAL"
  tok=$(curl -s -X POST "$LOGIN/token" \
    -d "grant_type=urn:ietf:params:oauth:grant-type:device_code" \
    -d "device_code=$DEVICE_CODE" -d "client_id=skycloak-mcp")
  err=$(echo "$tok" | jq -r '.error // empty')
  case "$err" in
    "")                    export DEVICE_TOKEN=$(echo "$tok" | jq -r '.access_token'); break ;;
    authorization_pending) : ;;
    slow_down)             INTERVAL=$((INTERVAL + 5)) ;;
    *)                     echo "device auth failed: $err"; exit 1 ;;
  esac
done
```

**The device code expires in 10 minutes.** Show the URL to the operator *immediately* and keep the surrounding message short — a long agent explanation can burn the whole window before they click. An `aud: lambda-authorizer` claim on the token is expected and correct.

---

## Step 0b: Mint a scoped API key

```bash
mint=$(curl -s -X POST "https://app.skycloak.io/api/cli/keys" \
  -H "Authorization: Bearer $DEVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"tidecloak-bootstrap","scopes":[
        "clusters:write","realms:write","applications:write",
        "realm-users:write","identity-providers:write",
        "clusters:credentials:read","clusters:logs:read","clusters:events:read"]}')
export SKYCLOAK_API_KEY=$(echo "$mint" | jq -r '.full_key')
```

- **This endpoint is absent from Skycloak's public docs.** It is real and works. VERIFIED.
- **Scopes are load-bearing.** Omit them and the key is **read-only**. Write scopes imply their reads. Include `clusters:logs:read` — without it you cannot read cluster logs when something fails.
- `full_key` is shown **once**.
- Optional `workspace_id`; otherwise your default workspace.
- Four gates, each its own **403**: workspace membership, API-keys permission (owner/admin), verified email, plan key quota. A **401** is not a gate — it is the token or the endpoint.
- **Keys get revoked.** If a previously working key starts returning 401, mint a new one rather than debugging it.

Every public-API call thereafter:

```bash
API="https://api.skycloak.io"; VER="2026-06-01.beta"
H=(-H "API-Key: $SKYCLOAK_API_KEY" -H "API-Version: $VER")
```

`API-Version` is required on every request (AP-HOST-4).

---

## Step 1: Create the cluster

```bash
curl -s -X POST "$API/clusters" "${H[@]}" -H "Content-Type: application/json" \
  -d '{"type":"tidecloak","name":"myapp-auth","size":"small","location":"us","version":"0.14.17"}' \
  | tee cluster-create.json | jq '{id,name,type,version,status}'
CLUSTER_ID=$(jq -r '.id' cluster-create.json)
```

**Request body — corrected from live 422s:**

| Field | Value | Notes |
|---|---|---|
| `type` | `tidecloak` \| `keycloak` | **lowercase**. NOT `identityPlatform` |
| `name` | string | |
| `size` | `small` \| `medium` \| `large` | **lowercase**. `Small` → 422 |
| `location` | `us` \| `ca` \| `au` \| `eu` | the field is **`location`**, NOT `region` |
| `version` | semver `^[0-9]+\.[0-9]+(\.[0-9]+)?$` | **required**; namespace follows `type` |

**Trap 1 — `identityPlatform` is silently ignored.** Skycloak's docs say `identityPlatform: "TideCloak"`. That field is **not schema-validated**: it is accepted, ignored, and you get a **plain Keycloak cluster with no Tide extensions**. Always verify:

```bash
jq -r '.type' cluster-create.json    # MUST be "tidecloak"
```

**Trap 2 — the version namespace follows the type.** TideCloak clusters take TideCloak versions (`0.14.x`); Keycloak clusters take Keycloak versions (`26.x`). Crossing them → `400 invalid cluster version`. There is no versions endpoint; read tags from Docker Hub (`tideorg/tidecloak`) or ask Skycloak.

**Version matrix — VERIFIED. Use `0.14.17` or later:**

| Version | Provisions | Automation client | `setUpTideRealm` |
|---|---|---|---|
| `0.13.13` | yes | **500 — unusable** | untestable |
| `0.14.11` | yes | works | **500 KEYGEN_FAILED** |
| `0.14.17` | yes | works | **works** |

A broken automation client also breaks Skycloak's own `/clusters/{id}/realms` API, which proxies through it.

---

## Step 2: Poll until available

```bash
for i in $(seq 1 45); do
  S=$(curl -s "${H[@]}" "$API/clusters/$CLUSTER_ID" | jq -r '.status')
  echo "$i: $S"
  case "$S" in available) break ;; failed) echo "provisioning FAILED"; exit 1 ;; esac
  sleep 15
done
TIDECLOAK_URL="https://${CLUSTER_ID}.us.skycloak.io"   # host mirrors `location`
```

Typically 45s–4min. Status may pass through `provisioning` and `updating`. Do not bootstrap before `available`.

---

## Step 3: Admin token via the automation client

Skycloak issues no master admin password. Each cluster gets a confidential client in its own `master` realm.

```bash
curl -s "${H[@]}" "$API/clusters/$CLUSTER_ID/credentials" -o creds.json
CLIENT_ID=$(jq -r '.client_id' creds.json)
CLIENT_SECRET=$(jq -r '.client_secret' creds.json)
TOKEN_URL=$(jq -r '.token_url' creds.json)

get_token() {
  curl -s -X POST "$TOKEN_URL" \
    --data-urlencode "grant_type=client_credentials" \
    --data-urlencode "client_id=$CLIENT_ID" \
    --data-urlencode "client_secret=$CLIENT_SECRET" | jq -r '.access_token'
}
curl -s -o /dev/null -w "%{http_code}\n" "$TIDECLOAK_URL/admin/realms" \
  -H "Authorization: Bearer $(get_token)"      # want 200
```

The client's UUID does **not** match the cluster id, despite the docs' `skycloak-automation-<cluster-id>` phrasing. Normal, not a fault.

This `get_token` replaces the master-admin one used in the self-host playbooks. Everything downstream is identical.

---

## Step 4: Bootstrap the Tide realm

Run `bootstrap-realm-from-template` then `initialize-admin-and-link-account` against `$TIDECLOAK_URL` using the Step 3 `get_token`.

**Confirm the Tide vendor surface first** (the GAP-066 check — resolved for `0.14.17`):

```bash
curl -s -o /dev/null -w "toggle-iga %{http_code}\n" -X POST \
  "$TIDECLOAK_URL/admin/realms/master/tide-admin/toggle-iga" \
  -H "Authorization: Bearer $(get_token)" -H 'Content-Type: application/json' -d '{"enabled":false}'
```

`200` = real TideCloak. `404` = plain Keycloak, wrong cluster type — go back to Step 1.

Licensing (`setUpTideRealm`) works on hosted from `0.14.17` and takes **10–15 seconds** — it genuinely reaches Tide's licensing service. A sub-2-second failure means it never made the outbound call.

### Ordering rule — the one-way door

Committing the `tide-realm-admin` grant flips the realm **firstAdmin → multiAdmin**. After that, **no change request can be approved from a script**:

```
409 MULTIADMIN_REQUIRES_APPROVAL_ENCLAVE
"multiAdmin change requests must be approved via the approval enclave"
```

That is the security model, not a bug: governed admin changes need a browser enclave signature, so a stolen automation credential cannot rewrite realm config.

**Therefore do every governed write BEFORE granting `tide-realm-admin`:** realm import, licensing, IGA enablement, `_tide_*` roles, client config including **all** redirect URIs and web origins, and the admin user. Grant `tide-realm-admin` last, then drain once.

**Plan redirect URIs up front.** Adding one later (a tunnel URL, a staging domain) is a manual enclave approval in the admin console at `$TIDECLOAK_URL/admin/{realm}/console/` → Change Requests. If the app may be reached over a tunnel or a second port, register those origins during bootstrap.

---

## Step 5: Wire the app

Identical to any Tide app. Export the adapter and confirm the Tide fields:

```bash
CUUID=$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM/clients?clientId=$CLIENT_NAME" \
  -H "Authorization: Bearer $(get_token)" | jq -r '.[0].id')
curl -s "$TIDECLOAK_URL/admin/realms/$REALM/vendorResources/get-installations-provider?clientId=$CUUID&providerId=keycloak-oidc-keycloak-json" \
  -H "Authorization: Bearer $(get_token)" > data/tidecloak.json
jq '{jwk: has("jwk"), vendorId: has("vendorId"), homeOrkUrl: has("homeOrkUrl")}' data/tidecloak.json
```

All three must be `true`. If not, licensing did not complete — do not hand-build the adapter and do not fall back to `createRemoteJWKSet` (I-04, I-05, I-13).

**Match the SDK version to the cluster version.** `@tidecloak/*` npm versions track TideCloak releases: a `0.14.17` cluster wants `@tidecloak/nextjs@0.14.17`. VERIFIED.

**DPoP is lockstep (I-12).** The shared realm template sets `"dpop.bound.access.tokens": "true"`, so the client MUST enable it or the token endpoint returns `400 "DPoP proof is missing"`. All four pieces are required — provider `useDPoP`, `public/tide_dpop_auth.html`, the `/tide_dpop` rewrite, and its CSP. See `add-auth-nextjs-fresh` Step 4. `tide_dpop_auth.html` must match the SDK version and comes only from the pack template or the Tide team.

---

## Verification Checklist

```bash
curl -s "${H[@]}" "$API/clusters/$CLUSTER_ID" | jq '{status, type, version}'
# → available / tidecloak / 0.14.17+      ← type MUST be tidecloak

[ -n "$(get_token)" ] && echo "admin token OK"

curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "$TIDECLOAK_URL/admin/realms/master/tide-admin/toggle-iga" \
  -H "Authorization: Bearer $(get_token)" -H 'Content-Type: application/json' -d '{"enabled":false}'
# → 200 (Tide vendor surface present)

jq 'has("jwk") and has("vendorId") and has("homeOrkUrl")' data/tidecloak.json   # → true

curl -s "$TIDECLOAK_URL/admin/realms/$REALM/iga/change-requests?status=PENDING" \
  -H "Authorization: Bearer $(get_token)" | jq 'length'   # → 0
```

---

## Common Failures

### Cluster creation returns `500 "Failed to create cluster"`
Almost always **TideCloak is not enabled for your workspace** — it is not on in prod by default, and the API fails open with a 500 instead of a clean 402/403. Ask Skycloak to enable it. Confirming signals: schema validation passes (you get past the 422s), plain `type: "keycloak"` fails identically, and nothing partial is created (the cluster list stays `[]`).

### `402 Plan Limit Exceeded`
Clean and honest: `{"current_limit":1,"current_plan":"trial","current_usage":1,"required_plan":"business"}`. Trial allows **one** cluster. Delete the old one (`DELETE /clusters/{id}` → 204) or upgrade.

### `400 invalid cluster version`
The version namespace doesn't match `type`. TideCloak → `0.14.x`, Keycloak → `26.x`.

### You asked for TideCloak and got Keycloak
You used `identityPlatform` instead of `type`. Check `jq -r '.type'`. Delete and recreate.

### Automation client `client_credentials` returns 500
Broken cluster version (`0.13.13`). Recreate on `0.14.17+`. Also manifests as `GET`/`POST /clusters/{id}/realms` returning 500, since Skycloak proxies through that client.

### `setUpTideRealm` → `TIDE-IDPEXT-VENDOR-KEYGEN_FAILED`
Cluster version too old (`0.14.11` and earlier on hosted). Recreate on `0.14.17+`.

To tell licensing from key generation, re-run with `skipLicense=true` **on a fresh realm**. `200 {"status":"idp-created"}` means the failing step is license activation. `skipLicense` is a **diagnostic, not a workaround** — it mints no VRK, so the adapter export then 500s with no `jwk`.

### `setUpTideRealm` → `TIDE-IDPEXT-VENDOR-REALM_SETUP_FAILED`
You retried on a realm a previous failure already half-initialised — `tide-vendor-key` and the `tide` IdP survive the failure. This error is misleading about its own cause. **Always retest on a freshly created realm** or you will chase the wrong fault.

### `409 MULTIADMIN_REQUIRES_APPROVAL_ENCLAVE`
The realm already flipped to multiAdmin. Approve in the admin console UI, or tear down and redo the bootstrap with correct ordering (Step 4).

### Browser CORS errors against the cluster
The client's `webOrigins` doesn't include your app origin. Error responses omit CORS headers, so *any* rejected request surfaces in the console as a CORS failure — read the Network tab's response body, not the console message, before concluding it is CORS.

### Public API returns 401 on a key that previously worked
The key was revoked. Mint a new one; don't debug it.

---

## Anti-Patterns

- **AP-HOST-2** — Claiming the hosted Tide path is turnkey without checking `type`, the vendor surface, and the adapter's `jwk`. Version matters enormously.
- **AP-HOST-3** — Putting the device token, API key, or automation-client secret in app code, `tidecloak.json`, or the repo.
- **AP-HOST-4** — Omitting the `API-Version` header.
- **Do not** use `identityPlatform`. Use `type`.
- **Do not** grant `tide-realm-admin` before finishing governed writes. It is a one-way door.
- **Do not** treat a 500 on cluster creation as a payload bug. Check the workspace entitlement first.
- **Do not** fabricate `tidecloak.json` if the vendor endpoints are absent (I-05, I-13).
- **Do not** use the trial realm path (`POST /api/trial/realm/provision`, browser-only, cookie+CSRF). It accepts only `{slug}`, always yields **plain Keycloak** on shared infrastructure with no Tide surface, and produces no cluster ID — so none of the realm APIs apply.

---

## References

- `canon/hosting-options.md` — decision, trust model, Skycloak API reference
- `canon/iga-change-requests-api.md` — authorize/commit and the multiAdmin flip
- `deploy-tidecloak-docker` / `start-tidecloak-dev` — self-host equivalent
- `bootstrap-realm-from-template`, `initialize-admin-and-link-account` — reused in Step 4
- Skycloak docs: `https://skycloak.io/docs/api/` (base `https://api.skycloak.io`, `API-Version: 2026-06-01.beta`)
