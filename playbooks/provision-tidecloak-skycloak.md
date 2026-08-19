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

## Step 0b: Reuse an existing key, or mint one

**Check for a working key before minting.** The mint enforces a **per-plan key quota** (one of its four 403 gates), and keys **cannot be listed or deleted with a device token** — `GET` and `DELETE /api/cli/keys` both return **405** (the route is POST-only), and `full_key` is shown exactly once. So a script that mints on every run silently accumulates keys it can never enumerate or clean up, until the quota starts 403ing. Pruning is dashboard-only (Workspace → API keys). VERIFIED 2026-08-07.

Because a key's value is unrecoverable after minting, "query the existing key" means **test the copy you stored**:

```bash
KEY_FILE=scripts/.skycloak-api-key

if [ -s "$KEY_FILE" ]; then
  code=$(curl -s -m 20 -o /dev/null -w "%{http_code}" "$API/clusters" \
    -H "API-Key: $(cat "$KEY_FILE")" -H "API-Version: $VER")
  case "$code" in
    200)     echo "reusing stored key"; SKYCLOAK_API_KEY=$(cat "$KEY_FILE") ;;
    401|403) echo "stored key revoked or under-scoped — mint a new one" ;;
    *)       echo "cannot reach the API ($code) — fix connectivity, do NOT mint"; exit 1 ;;
  esac
fi
```

Distinguish the three outcomes. A **401/403** means the key is dead — mint. A **connection failure** is not a dead key; minting on it burns quota for no reason and hides the real fault. Keys do get revoked out from under you (two died mid-session during pack development), so treat "was working, now 401" as normal and re-mint rather than debugging the key.

Ready-made implementation: `templates/*/scripts/skycloak-mint-key.sh` (reuse-then-mint, `FORCE_NEW=1` to override).

### Minting



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

**Discover the version — do not hardcode one, and do not read it off Docker Hub.**

Skycloak validates the version by **exact match against its own allowlist** and returns
`400 invalid cluster version` for anything else (`SupportedTideCloak` → `ErrInvalidClusterVersion`,
`internal/clusters/service.go`). A tag can be the newest thing Tide published and still be
un-provisionable because Skycloak has not added it. **Docker Hub is not the version list.**

Ask Skycloak instead. The endpoint requires the API key:

```bash
# either shape, depending on deployment:
curl -s "$API/clusters/supported-versions?type=tidecloak" "${H[@]}"   # → ["0.14.20", ...]
curl -s "$API/clusters/versions" "${H[@]}"                            # → {"keycloak":[...],"tidecloak":[...]}
```

```bash
VERSION="$(templates/shared/skycloak-latest-version.sh)"          # newest provisionable ≥ floor
templates/shared/skycloak-latest-version.sh --check               # + reports catalogue lag
```

**Sort what you get back.** The list is documented "newest to oldest", but do not rely on ordering:
numerically `0.9.8 < 0.14.20` while lexically the reverse, and picking a sub-floor version fails
later as `KEYGEN_FAILED` — an error that reads as key generation and is really licensing.

Then create:

```bash
# Skycloak's newest offered TideCloak version. Not a pin, not a Docker tag.
VERSION="$(templates/shared/skycloak-latest-version.sh)" || exit 1
echo "==> creating on TideCloak $VERSION"

BODY="$(jq -n --arg v "$VERSION" \
  '{type:"tidecloak", name:"myapp-auth", size:"small", location:"us", version:$v}')"
RESP="$(curl -s -w '\n%{http_code}' -X POST "$API/clusters" "${H[@]}" \
          -H "Content-Type: application/json" -d "$BODY")"
CODE="$(printf '%s' "$RESP" | tail -1)"
JSON="$(printf '%s' "$RESP" | sed '$d')"

if [ "$CODE" != "201" ] && [ "$CODE" != "200" ]; then
  echo "ERROR: create failed ($CODE): $JSON" >&2
  # `invalid cluster version` here means Skycloak just told you it supports $VERSION and then
  # refused it. Do NOT retry with an older version to get past this -- that is how you end up on a
  # months-old build with no error. Re-read the version list and report the inconsistency.
  exit 1
fi

printf '%s' "$JSON" > cluster-create.json
CLUSTER_ID="$(jq -r '.id' cluster-create.json)"
jq '{id,name,type,version,status}' cluster-create.json
```

**Never retry with an older version.** An earlier revision of this playbook looped down the list on
`400 invalid cluster version`. That made sense when the list came from Docker Hub (where most tags
genuinely are not offered), and it is wrong now: every entry came from Skycloak, so a rejection means
something is inconsistent, not that you should settle for an older build. The loop turned a loud
failure into a silent downgrade — clusters kept coming up old and nothing reported it.

**If Skycloak's newest is older than you want, no client-side change fixes it.** The allowlist is
server-side. `--check` prints the gap against Docker Hub so you can ask Skycloak to add the version.
Do not lower `--floor` to work around it either: `0.13.13` ships a broken automation client and
`0.14.11` fails licensing, so those provision happily and then fail later.

⚠️ **Verify the version you actually got.** Ask for one and be given another and every later step is
against a build you did not choose:

```bash
jq -r '.version' cluster-create.json   # must equal the $VERSION that succeeded
jq -r '.type'    cluster-create.json   # must be "tidecloak" — see Trap 1
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

**Trap 2 — the version namespace follows the type.** TideCloak clusters take TideCloak versions (`0.14.x`); Keycloak clusters take Keycloak versions (`26.x`). Crossing them → `400 invalid cluster version`, the same error you get for a version Skycloak does not carry. Ask `GET /clusters/supported-versions?type=tidecloak` for the TideCloak list — `templates/shared/skycloak-latest-version.sh` does exactly that.

**Use the LATEST available version. `0.14.17` is the verified FLOOR, not the target.**

`templates/shared/skycloak-latest-version.sh` asks Skycloak which versions it will provision, keeps
strict semver only, sorts **numerically**, and drops anything below the floor.

| Version | Provisions | Automation client | `setUpTideRealm` |
|---|---|---|---|
| `0.13.13` | yes | **500 — unusable** | untestable |
| `0.14.11` | yes | works | **500 KEYGEN_FAILED** |
| `0.14.17` | yes | works | **works** ← floor |
| newest (`0.14.20` at time of writing) | — | — | **use this** |

A broken automation client also breaks Skycloak's own `/clusters/{id}/realms` API, which proxies through it.

**Three traps the script exists to avoid:**

- **Docker Hub is not the version list.** Skycloak matches against a server-side allowlist, so the
  newest published tag is often *not* provisionable. Reading tags instead of asking Skycloak is what
  produced "it still creates clusters on an old version": the newest tag 400s, the caller walks
  down, and you land on something old. Ask the API.
- **`latest` is not a valid value.** Skycloak validates `^[0-9]+\.[0-9]+(\.[0-9]+)?$`, so the tag
  `latest` is rejected outright. Resolve it to a concrete semver.
- **Sort numerically, not lexically.** As strings `"0.9.8" > "0.14.20"`, so a naive sort selects a
  version *below* the floor, which then fails at `setUpTideRealm` with `KEYGEN_FAILED` — an error
  that looks like key generation and is actually licensing.

⚠️ **Do not read the allowlist out of a Skycloak source checkout.** A checkout is a snapshot: the
one on this machine lists `0.11.7` as the only supported TideCloak version, while production
provisions `0.14.17`. Query the running service (AP-83).

**Honest status of "newest":** the floor is VERIFIED by testing; a newly released version above it is
**ASSUMED good** — nobody has run this matrix against it. That is the right default (a months-old pin
goes stale silently, and Tide ships often), but if provisioning succeeds and `setUpTideRealm` then
fails on a brand-new tag, drop one version with `--floor` and report it.

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
# READ-ONLY probe. Do NOT probe with POST /tide-admin/toggle-iga: it reads the form parameter
# `isIGAEnabled`, and a JSON body's missing parameter FAILS OPEN TO true — so the old
# `-d '{"enabled":false}'` probe silently ENABLED IGA on master and ran a Phase-6 ADOPT scan
# across every entity in the realm. These GETs are iga-core-specific and mutate nothing.
curl -s -o /dev/null -w "iga/change-requests %{http_code}\n" \
  "$TIDECLOAK_URL/admin/realms/master/iga/change-requests?status=PENDING" \
  -H "Authorization: Bearer $(get_token)"
```

`200` = real TideCloak. `404` = plain Keycloak, wrong cluster type — go back to Step 1.
VERIFIED read-only against `tideorg/tidecloak-dev:latest` 2026-08-10: returns `200` and leaves
`master`'s `isIGAEnabled` untouched.

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

# READ-ONLY. Never probe with POST toggle-iga — it fails open and ENABLES IGA (see Step 1 note).
curl -s -o /dev/null -w "%{http_code}\n" \
  "$TIDECLOAK_URL/admin/realms/master/iga/change-requests?status=PENDING" \
  -H "Authorization: Bearer $(get_token)"
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
