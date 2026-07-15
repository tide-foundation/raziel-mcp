# Provision Hosted TideCloak via Skycloak

Provision a fully-managed TideCloak instance in Skycloak's cloud instead of self-hosting, then bootstrap the Tide realm on top of it. This is the hosted alternative to `deploy-tidecloak-docker`.

Read `canon/hosting-options.md` first — it covers the self-host vs hosted decision, the trust model, and the honest caveats you must surface to the operator.

---

## When to Use

- The team does not want to run auth infrastructure (containers, DB, upgrades, TLS, backups).
- You want a managed TideCloak reachable at a stable URL with no ops burden.
- You are prototyping and want an instance without local Docker.

**Do not use** if:
- The deployment must be air-gapped or fully self-controlled → `deploy-tidecloak-docker`.
- You already have a running TideCloak → go straight to realm bootstrap / integration.
- The operator has not confirmed a Skycloak account and API key exist (this playbook cannot create the account).

---

## Prerequisites

- A Skycloak account with a workspace (dashboard at `skycloak.io`).
- A Skycloak **API key** with scope `clusters:write` and `clusters:credentials:read`, created in Dashboard → Workspace → API keys. Shown once — capture it securely.
- `curl` and `jq`.
- Plan level sufficient for your region/size (non-US regions and larger sizes need Developer plan or higher; a `402 Payment Required` means the action isn't on the current plan).

**Secret handling (AP-HOST-3):** The API key and any cluster automation-client secret are operator/bootstrap secrets. Keep them in the shell/CI environment. Never write them into application code, the repo, or `tidecloak.json`. Same rule as master admin credentials (AP-41).

---

## Overview of the flow

```
1. Create a TideCloak cluster        (Skycloak API)      → cluster id
2. Poll until status = available     (Skycloak API)      → cluster URL
3. Fetch automation-client creds     (Skycloak API)      → admin token source
4. Bootstrap the Tide realm          (TideCloak admin API) → adapter JSON
5. Wire the app                       (unchanged)          → same as self-hosted
```

Steps 1–3 are Skycloak-specific and covered here. Step 4 is the **same Tide-realm bootstrap** as the self-host path — reuse `bootstrap-realm-from-template` / the `deploy-tidecloak-docker` init sequence, pointed at the hosted URL with a token from the automation client instead of master admin creds. Step 5 is identical to any Tide app (`add-auth-nextjs-fresh` etc.).

---

## Step 1: Create a TideCloak cluster

```bash
export SKYCLOAK_API_KEY="<your-key>"
API="https://api.skycloak.io"
VER="2026-06-01.beta"

# NOTE: exact request-body field names are INFERRED from the docs — if this 422s,
# inspect the RFC 9457 error body (it lists the offending field) and adjust.
curl -s -X POST "$API/clusters" \
  -H "API-Key: $SKYCLOAK_API_KEY" \
  -H "API-Version: $VER" \
  -H "Content-Type: application/json" \
  -d '{
    "identityPlatform": "TideCloak",
    "name": "myapp-auth",
    "size": "Small",
    "region": "us-east"
  }' | tee cluster-create.json | jq .
```

- **`identityPlatform: "TideCloak"`** is the field that makes this a Tide broker rather than plain Keycloak. Do not omit it.
- `size`: `Small` (DEV), `Medium` (STAGING), `Large` (PROD).
- Capture the returned cluster **id**: `CLUSTER_ID=$(jq -r '.id' cluster-create.json)`.
- Creation is **asynchronous** — the response comes back before the cluster is ready.

---

## Step 2: Poll until available

```bash
for i in $(seq 1 40); do
  STATUS=$(curl -s "$API/clusters/$CLUSTER_ID" \
    -H "API-Key: $SKYCLOAK_API_KEY" -H "API-Version: $VER" | jq -r '.status')
  echo "attempt $i: $STATUS"
  case "$STATUS" in
    available) echo "ready"; break ;;
    failed)    echo "provisioning FAILED — check the Skycloak dashboard"; exit 1 ;;
  esac
  sleep 15
done
```

Provisioning is typically 2–4 minutes; Skycloak also emails on completion. Do not proceed to bootstrap until status is `available`. The cluster is reachable at `https://<cluster-id>.app.skycloak.io`:

```bash
TIDECLOAK_URL="https://${CLUSTER_ID}.app.skycloak.io"
curl -s -f "$TIDECLOAK_URL" > /dev/null && echo "TideCloak reachable" || echo "not reachable yet"
```

---

## Step 3: Get an admin token (no master password exists)

Skycloak does **not** issue a Keycloak admin username/password. Two ways to reach the admin API:

**A. Admin Console SSO (interactive)** — for a human clicking through: open the cluster's "Go to Console" from the Skycloak dashboard, authenticated by your Skycloak account. Use this to eyeball the instance; it does not give a scriptable token.

**B. Automation client (scriptable)** — each cluster has a confidential OAuth2 client `skycloak-automation-<cluster-id>` in the `master` realm for programmatic admin access. Fetch its credentials, then use client-credentials to mint admin tokens:

```bash
# Field names of the credentials response are INFERRED — inspect the actual JSON.
curl -s "$API/clusters/$CLUSTER_ID/credentials" \
  -H "API-Key: $SKYCLOAK_API_KEY" -H "API-Version: $VER" | tee cluster-creds.json | jq .

CLIENT_ID=$(jq -r '.clientId // .automationClientId // empty' cluster-creds.json)
CLIENT_SECRET=$(jq -r '.clientSecret // .secret // empty' cluster-creds.json)

# Mint an admin token against the hosted instance's master realm:
get_token() {
  curl -s -X POST "$TIDECLOAK_URL/realms/master/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=client_credentials&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET" \
    | jq -r '.access_token'
}
TOKEN="$(get_token)"
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] && echo "admin token OK" || echo "token failed — check creds/scopes"
```

This `get_token` replaces the master-admin `get_token` in the self-host init script. Everything downstream (realm create, `setUpTideRealm`, IGA toggle, change-request authorize/commit, adapter export) is the same — just pointed at `$TIDECLOAK_URL` with this token.

---

## Step 4: Bootstrap the Tide realm

Run the standard Tide-realm bootstrap against the hosted instance:

1. `bootstrap-realm-from-template` — create the realm from the `realm.json` template (identical template to self-host; see `deploy-tidecloak-docker` Step 2), then `setUpTideRealm` + enable IGA.
2. `initialize-admin-and-link-account` — create the admin user, assign `tide-realm-admin`, generate the Tide-account link, approve the change requests, export the adapter JSON.

Use the `get_token()` from Step 3 (automation client) everywhere the self-host script uses the master-admin token. Point `TIDECLOAK_URL` at `https://<cluster-id>.app.skycloak.io`.

> **VERIFY THIS ON THE LIVE INSTANCE (GAP-066).** The pack cannot yet confirm that a Skycloak-hosted TideCloak exposes the full Tide vendor surface (`setUpTideRealm`, `toggle-iga`, the change-request API, adapter export with `jwk`/`vendorId`/`homeOrkUrl`) or how Tide **licensing** is handled in the hosted context. Before promising a turnkey result:
> - Probe `POST .../vendorResources/setUpTideRealm` and check for a 2xx + licensing JSON.
> - After bootstrap, confirm the exported adapter JSON contains `jwk`, `vendorId`, `homeOrkUrl` (I-05, I-13).
> - If those endpoints 404 or the adapter lacks Tide fields, **stop** — Skycloak is hosting the broker but Tide-realm provisioning/licensing needs the partner's Tide-specific path. Report this to the operator and raise with the Tide/Skycloak teams. Do not fabricate the adapter JSON.

---

## Step 5: Wire the app

Identical to any Tide app — the hosting choice does not change integration. Adapter JSON goes to `data/tidecloak.json` (Next.js) or `public/tidecloak.json` (React/Vite), with `auth-server-url` pointing at the hosted URL. Continue with `add-auth-nextjs-fresh` / `add-auth-nextjs-existing`, then route/API protection.

---

## Verification Checklist

```bash
# Cluster available
curl -s "$API/clusters/$CLUSTER_ID" -H "API-Key: $SKYCLOAK_API_KEY" -H "API-Version: $VER" | jq '.status'
# → "available"

# Hosted TideCloak reachable
curl -s -f "https://${CLUSTER_ID}.app.skycloak.io" > /dev/null && echo reachable

# Admin token from automation client works
[ -n "$(get_token)" ] && echo "token OK"

# After bootstrap: adapter has Tide extensions (the real turnkey test — GAP-066)
jq 'has("jwk") and has("vendorId") and has("homeOrkUrl")' data/tidecloak.json
# → true   (if false: GAP-066 — hosted Tide vendor surface not confirmed)

# IGA enabled on the hosted realm
curl -s "https://${CLUSTER_ID}.app.skycloak.io/admin/realms/myapp" \
  -H "Authorization: Bearer $(get_token)" | jq '.attributes.isIGAEnabled'
```

---

## Common Failures

### `402 Payment Required` on create
The chosen region/size isn't available on the current plan (e.g. a non-US region on a trial workspace). Use a US region / `Small` size, or upgrade the plan. The RFC 9457 body's `detail` states the constraint.

### `403` "does not have the required scope"
The API key lacks `clusters:write` (create) or `clusters:credentials:read` (Step 3). Create a key with the right scopes; note write includes read.

### Missing `API-Version` header (AP-HOST-4)
Every Skycloak call needs `-H "API-Version: 2026-06-01.beta"`. Omitting it fails the request.

### `422` on create with a field complaint
The request-body field names here are INFERRED from the docs. Read the `errors[]` array in the RFC 9457 response — it names the offending `field` — and adjust (`identityPlatform`/`size`/`region` spellings, enum values).

### Cluster stuck in `provisioning` / went `failed`
Provisioning is async and occasionally fails server-side. Check the Skycloak dashboard for the cluster's error detail; recreate if `failed`. Do not bootstrap against a non-`available` cluster.

### Adapter JSON missing Tide fields after bootstrap (GAP-066)
The hosted instance may not expose the Tide vendor surface, or licensing wasn't provisioned. Do not fall back to `createRemoteJWKSet` or hand-build the adapter (I-04). Stop and escalate — this is the open question the hosted path depends on.

---

## Anti-Patterns

- **AP-HOST-2** — Telling the user the hosted Tide path is fully turnkey before GAP-066 is confirmed. Cluster provisioning is verified; the Tide-realm bootstrap on top is not.
- **AP-HOST-3** — Putting `SKYCLOAK_API_KEY` or the `skycloak-automation-*` secret in app code, `tidecloak.json`, or the repo. Bootstrap secrets only.
- **AP-HOST-4** — Omitting the `API-Version` header.
- **Do not** fabricate `tidecloak.json` if the hosted vendor endpoints are absent. A missing adapter is a provisioning problem to escalate, not a file to invent (I-05, I-13).
- **Do not** present hosting as either a security downgrade or a magic upgrade — state the real trust model from `canon/hosting-options.md` (availability + metadata + Tideless-IGA caveat).

---

## References

- `canon/hosting-options.md` — decision, trust model, Skycloak API reference, GAP-066
- Skycloak docs: `https://skycloak.io/docs/api/` (API-Version `2026-06-01.beta`)
- `deploy-tidecloak-docker` — the self-host equivalent and the shared realm-bootstrap sequence
- `bootstrap-realm-from-template`, `initialize-admin-and-link-account` — the Tide-realm steps reused in Step 4
