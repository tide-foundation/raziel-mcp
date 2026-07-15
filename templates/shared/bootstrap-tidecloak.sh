#!/bin/bash
# bootstrap-tidecloak.sh — Full TideCloak bootstrap for development
#
# Runs the complete bootstrap sequence:
#   1. Start container
#   2. Create realm from template
#   3. Initialize Tide licensing + IGA
#   4. Approve client change requests
#   5. Create admin user + assign tide-realm-admin
#   6. Generate invite link (interactive: admin must open in browser)
#   7. Wait for account linking
#   8. Approve user change requests
#   9. Update CustomAdminUIDomain
#  10. Export adapter JSON
#
# Usage:
#   REALM_NAME=myapp CLIENT_NAME=myclient CLIENT_APP_URL=http://localhost:3000 ./bootstrap-tidecloak.sh
#
# Prerequisites: docker, curl, jq, sudo access

set -euo pipefail

# --- Derive app-relatable defaults from package.json ---
# Strips @scope/, converts non-alphanumeric to hyphens, lowercases.
if [ -f "package.json" ] && command -v jq &>/dev/null; then
  _PKG_NAME=$(jq -r '.name // empty' package.json | sed 's|^@[^/]*/||' | tr -cs 'a-zA-Z0-9-' '-' | tr '[:upper:]' '[:lower:]' | sed 's/^-//;s/-$//')
fi
_APP_NAME="${_PKG_NAME:-myapp}"

# --- Configuration (override via environment) ---
TIDECLOAK_URL="${TIDECLOAK_URL:-http://localhost:8080}"
REALM_NAME="${REALM_NAME:-$_APP_NAME}"
CLIENT_NAME="${CLIENT_NAME:-${_APP_NAME}-client}"
CLIENT_APP_URL="${CLIENT_APP_URL:-http://localhost:3000}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@yourorg.com}"
ADAPTER_OUTPUT="${ADAPTER_OUTPUT:-./data/tidecloak.json}"
TIDECLOAK_IMAGE="${TIDECLOAK_IMAGE:-tideorg/tidecloak-dev:latest}"

# --- Helpers ---
get_token() {
  curl -s -X POST "$TIDECLOAK_URL/realms/master/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=admin&password=password&grant_type=password&client_id=admin-cli" \
    | jq -r '.access_token'
}

# Approve + commit all pending change requests using the current
# /iga/change-requests/... surface (replaces the legacy /tide-admin/change-set/...).
# During bootstrap the realm is in FirstAdmin/Tideless mode, so authorize signs
# server-side with no enclave. See canon/iga-change-requests-api.md.
approve_all_pending() {
  local TOKEN ready id

  # 1. Authorize every pending CREATE/DELETE change request in one call.
  TOKEN="$(get_token)"
  curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/iga/change-requests/bulk-authorize" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"actionTypeIn":["CREATE","DELETE"],"limit":100}' > /dev/null 2>&1

  # 2. Commit everything ready; loop passes so dependent CRs become ready.
  for pass in 1 2 3 4 5; do
    TOKEN="$(get_token)"
    ready=$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/iga/change-requests?status=PENDING" \
      -H "Authorization: Bearer $TOKEN" 2>/dev/null \
      | jq -r 'if type=="array" then (.[] | select(.readyToCommit==true) | .id) else empty end' 2>/dev/null)
    [ -z "$ready" ] && break
    for id in $ready; do
      TOKEN="$(get_token)"
      curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/iga/change-requests/$id/commit" \
        -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1
    done
  done
}

# Back-compat wrapper: legacy call sites pass a type arg (clients/users/roles)
# which the new list-all surface ignores. Each call sweeps all pending CRs.
approve_and_commit() { approve_all_pending; }

# --- Step 0: Clean previous state ---
echo "==> Cleaning previous state..."
docker stop tidecloak 2>/dev/null || true
docker rm tidecloak 2>/dev/null || true
mkdir -p ./data
sudo rm -f ./data/keycloakdb* 2>/dev/null || true
sudo chown -R 1000:1000 ./data

if lsof -i :8080 >/dev/null 2>&1; then
  echo "ERROR: Port 8080 is already in use. Stop the existing service or change the port."
  exit 1
fi

# --- Step 1: Start container ---
echo "==> Starting TideCloak ($TIDECLOAK_IMAGE)..."

# Dev image: no ORK/threshold config needed (built-in defaults).
# Staging image (tidecloak-stg-dev): requires ORK, threshold, and payer config.
if echo "$TIDECLOAK_IMAGE" | grep -q "stg"; then
  sudo docker run -d --name tidecloak \
    -v "$(pwd)/data:/opt/keycloak/data/h2" \
    -p 8080:8080 \
    -e KC_BOOTSTRAP_ADMIN_USERNAME=admin \
    -e KC_BOOTSTRAP_ADMIN_PASSWORD=password \
    -e KC_HOSTNAME="$TIDECLOAK_URL" \
    -e SYSTEM_HOME_ORK=https://sork1.tideprotocol.com \
    -e USER_HOME_ORK=https://sork1.tideprotocol.com \
    -e THRESHOLD_T=3 \
    -e THRESHOLD_N=5 \
    -e PAYER_PUBLIC=20000011d6a0e8212d682657147d864b82d10e92776c15ead43dcfdc100ebf4dcfe6a8 \
    "$TIDECLOAK_IMAGE"
else
  sudo docker run -d --name tidecloak \
    -v "$(pwd)/data:/opt/keycloak/data/h2" \
    -p 8080:8080 \
    -e KC_BOOTSTRAP_ADMIN_USERNAME=admin \
    -e KC_BOOTSTRAP_ADMIN_PASSWORD=password \
    "$TIDECLOAK_IMAGE"
fi

if [ $? -ne 0 ]; then
  echo "ERROR: Docker failed to start. Check 'docker logs tidecloak'."
  exit 1
fi

# --- Step 2: Wait for readiness ---
echo "==> Waiting for TideCloak to start..."
for i in {1..20}; do
  curl -sf "$TIDECLOAK_URL" > /dev/null 2>&1 && break
  echo "  Attempt $i/20..."
  sleep 5
done

if ! curl -sf "$TIDECLOAK_URL" > /dev/null 2>&1; then
  echo "ERROR: TideCloak did not start within 100 seconds. Check 'docker logs tidecloak'."
  exit 1
fi
echo "  TideCloak is ready."

# --- Step 3: Create realm from template ---
echo "==> Creating realm '$REALM_NAME'..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TMP_REALM="$(mktemp)"
cp "$SCRIPT_DIR/realm.json.template" "$TMP_REALM"
sed -i "s|REALM_NAME|$REALM_NAME|g" "$TMP_REALM"
sed -i "s|CLIENT_NAME|$CLIENT_NAME|g" "$TMP_REALM"
sed -i "s|CLIENT_APP_URL|$CLIENT_APP_URL|g" "$TMP_REALM"

TOKEN="$(get_token)"
curl -s -X POST "$TIDECLOAK_URL/admin/realms" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @"$TMP_REALM"
rm -f "$TMP_REALM"

# --- Step 4: Initialize Tide + enable IGA ---
echo "==> Initializing Tide realm (license + VRK)..."
TOKEN="$(get_token)"
curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/vendorResources/setUpTideRealm" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "email=$ADMIN_EMAIL" \
  --data-urlencode "isRagnarokEnabled=true" > /dev/null

echo "==> Enabling IGA..."
TOKEN="$(get_token)"
curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/tide-admin/toggle-iga" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "isIGAEnabled=true" > /dev/null

# --- Step 5: Approve client change requests ---
echo "==> Approving client and role change requests..."
sleep 2
approve_and_commit clients
approve_and_commit roles

# --- Step 6: Create admin user ---
echo "==> Creating admin user..."
TOKEN="$(get_token)"
curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"email\":\"$ADMIN_EMAIL\",\"enabled\":true}"

# Approve user creation change request before proceeding.
# With IGA enabled, the user is not queryable until its change request is committed.
echo "==> Approving user change requests..."
sleep 2
approve_and_commit users

TOKEN="$(get_token)"
USER_ID=$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/users?username=admin" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')

if [ -z "$USER_ID" ] || [ "$USER_ID" = "null" ]; then
  echo "ERROR: Could not find admin user after creation. Check change-set approval."
  exit 1
fi

# --- Step 6b: Assign tide-realm-admin role ---
echo "==> Assigning tide-realm-admin role..."
TOKEN="$(get_token)"
CLIENT_UUID=$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/clients?clientId=realm-management" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')

if [ -z "$CLIENT_UUID" ] || [ "$CLIENT_UUID" = "null" ]; then
  echo "ERROR: realm-management client not found."
  exit 1
fi

ROLE_JSON=$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/clients/$CLIENT_UUID/roles/tide-realm-admin" \
  -H "Authorization: Bearer $TOKEN")

if echo "$ROLE_JSON" | jq -e '.error' > /dev/null 2>&1; then
  echo "ERROR: tide-realm-admin role not found: $ROLE_JSON"
  exit 1
fi

TOKEN="$(get_token)"
curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/users/$USER_ID/role-mappings/clients/$CLIENT_UUID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "[$ROLE_JSON]"

# --- Step 7: Generate invite link ---
echo "==> Generating invite link..."
TOKEN="$(get_token)"
INVITE_LINK=$(curl -s -X POST \
  "$TIDECLOAK_URL/admin/realms/$REALM_NAME/tideAdminResources/get-required-action-link?userId=$USER_ID&lifespan=43200" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '["link-tide-account-action"]')

echo ""
echo "============================================"
echo "Open this link in a browser to link your admin Tide account:"
echo "$INVITE_LINK"
echo "============================================"
echo ""

# --- Step 8: Wait for account linking ---
echo "Waiting for admin to link Tide account (polling every 5s)..."
while true; do
  TOKEN="$(get_token)"
  KEY=$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/users?username=admin" \
    -H "Authorization: Bearer $TOKEN" | jq -r '.[0].attributes.tideUserKey[0] // empty')
  [ -n "$KEY" ] && echo "  Account linked." && break
  sleep 5
done

# --- Step 9: Approve ALL pending change requests ---
# Account linking generates user change requests (tideUserKey write).
# IGA toggle and setUpTideRealm may generate accumulated client change requests.
# Sweep all types to ensure nothing is left pending.
echo "==> Approving all pending change requests..."
sleep 2
approve_and_commit users
approve_and_commit roles
approve_and_commit clients

# --- Step 10: Update CustomAdminUIDomain ---
echo "==> Configuring CustomAdminUIDomain..."
TOKEN="$(get_token)"
INST=$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/identity-provider/instances/tide" \
  -H "Authorization: Bearer $TOKEN")
UPDATED=$(echo "$INST" | jq --arg d "$CLIENT_APP_URL" '.config.CustomAdminUIDomain=$d')
curl -s -X PUT "$TIDECLOAK_URL/admin/realms/$REALM_NAME/identity-provider/instances/tide" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d "$UPDATED" > /dev/null

curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/vendorResources/sign-idp-settings" \
  -H "Authorization: Bearer $TOKEN" > /dev/null

# --- Step 11: Export adapter JSON ---
echo "==> Exporting adapter config..."
TOKEN="$(get_token)"
CLIENT_UUID=$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/clients?clientId=$CLIENT_NAME" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')

curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/vendorResources/get-installations-provider?clientId=$CLIENT_UUID&providerId=keycloak-oidc-keycloak-json" \
  -H "Authorization: Bearer $TOKEN" > "$ADAPTER_OUTPUT"

echo ""
echo "============================================"
echo "Bootstrap complete!"
echo "Adapter config: $ADAPTER_OUTPUT"
echo "TideCloak URL:  $TIDECLOAK_URL"
echo "Realm:          $REALM_NAME"
echo "Client:         $CLIENT_NAME"
echo "============================================"
