#!/usr/bin/env bash
# Get a working SkyCloak public-API key: REUSE a stored one if it still validates,
# otherwise mint a fresh one via the device flow.
#
# Why reuse matters: the mint enforces a per-plan key quota (one of its four 403
# gates), and keys CANNOT be listed or deleted with a device token —
# `GET`/`DELETE /api/cli/keys` both return 405 (the route is POST-only), and
# `full_key` is shown exactly once. So a script that mints on every run silently
# accumulates keys it can never enumerate or clean up, until the quota 403s.
# Pruning is dashboard-only (Workspace -> API keys). VERIFIED 2026-08-07.
#
# Usage:
#   bash scripts/skycloak-mint-key.sh            # reuse if valid, else mint
#   FORCE_NEW=1 bash scripts/skycloak-mint-key.sh  # always mint (e.g. key revoked)
#
# Result: a valid key at scripts/.skycloak-api-key (gitignored, mode 600)
set -euo pipefail

LOGIN="https://login.app.skycloak.io/realms/skycloak/protocol/openid-connect"
CLIENT_ID="skycloak-mcp"
API="https://api.skycloak.io"
VER="2026-06-01.beta"
KEY_NAME="${KEY_NAME:-tidecloak-bootstrap}"
OUT="$(cd "$(dirname "$0")" && pwd)/.skycloak-api-key"

# Scopes are load-bearing: omit them and the key comes back READ-ONLY.
# Write implies read. clusters:logs:read is needed to read cluster logs when
# something fails — without it that endpoint 403s.
SCOPES='["clusters:write","realms:write","applications:write","realm-users:write","identity-providers:write","clusters:credentials:read","clusters:logs:read","clusters:events:read"]'

# --- Step 1: reuse a stored key if it still works -----------------------------
# The only way to "query" an existing key is to test the copy you kept: the API
# has no readable list, and a key's value is unrecoverable after minting.
if [ -z "${FORCE_NEW:-}" ] && [ -s "$OUT" ]; then
  echo "==> Found a stored key, checking it still works..."
  code=$(curl -s -m 20 -o /dev/null -w "%{http_code}" "$API/clusters" \
    -H "API-Key: $(cat "$OUT")" -H "API-Version: $VER" || echo "000")
  case "$code" in
    200)
      echo "==> Stored key is valid. Reusing it (no new key minted)."
      echo "    $OUT"
      exit 0 ;;
    401|403)
      echo "==> Stored key rejected (HTTP $code) — it was revoked or its scopes are insufficient. Minting a new one." ;;
    *)
      echo "ERROR: could not reach $API to validate the stored key (HTTP $code)."
      echo "       Not minting — fix connectivity first, or re-run with FORCE_NEW=1."
      exit 1 ;;
  esac
else
  [ -n "${FORCE_NEW:-}" ] && echo "==> FORCE_NEW set — minting a new key." \
                          || echo "==> No stored key found — minting one."
fi

# --- Step 2: device authorization --------------------------------------------
echo "==> Requesting device code..."
dev=$(curl -s -m 20 -X POST "$LOGIN/auth/device" -d "client_id=$CLIENT_ID" -d "scope=openid")
DEVICE_CODE=$(echo "$dev" | jq -r '.device_code')
INTERVAL=$(echo "$dev" | jq -r '.interval // 5')
[ -n "$DEVICE_CODE" ] && [ "$DEVICE_CODE" != "null" ] || { echo "ERROR: no device code: $dev"; exit 1; }

echo
echo "============================================================"
echo "  APPROVE IN YOUR BROWSER (expires in 10 minutes):"
echo "  $(echo "$dev" | jq -r '.verification_uri_complete')"
echo "  (code: $(echo "$dev" | jq -r '.user_code'))"
echo "============================================================"
echo

echo "==> Waiting for approval..."
ACCESS_TOKEN=""
for _ in $(seq 1 120); do
  sleep "$INTERVAL"
  tok=$(curl -s -m 15 -X POST "$LOGIN/token" \
    -d "grant_type=urn:ietf:params:oauth:grant-type:device_code" \
    -d "device_code=$DEVICE_CODE" -d "client_id=$CLIENT_ID")
  err=$(echo "$tok" | jq -r '.error // empty')
  case "$err" in
    "")                    ACCESS_TOKEN=$(echo "$tok" | jq -r '.access_token'); break ;;
    authorization_pending) printf '.' ;;
    slow_down)             INTERVAL=$((INTERVAL + 5)) ;;
    *)                     echo; echo "ERROR: device auth failed: $err"; exit 1 ;;
  esac
done
echo
[ -n "$ACCESS_TOKEN" ] || { echo "ERROR: timed out waiting for approval"; exit 1; }
echo "==> Approved."

# --- Step 3: mint -------------------------------------------------------------
# The device token is NOT an API credential — its only job is this call.
echo "==> Minting API key (POST /api/cli/keys)..."
RESP="$(mktemp)"
CODE=$(curl -s -m 25 -o "$RESP" -w "%{http_code}" -X POST "https://app.skycloak.io/api/cli/keys" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$KEY_NAME\",\"scopes\":$SCOPES}")

if [ "$CODE" != "201" ]; then
  echo "ERROR: mint returned HTTP $CODE"
  cat "$RESP"; echo
  # 403 has four distinct causes: workspace membership, the API-keys permission
  # (owner/admin), a verified email, and the plan key quota. If it is the quota,
  # delete unused keys in the dashboard (Workspace -> API keys) — they cannot be
  # removed from here.
  [ "$CODE" = "403" ] && echo "HINT: if this is the key quota, prune old keys in the SkyCloak dashboard."
  rm -f "$RESP"; exit 1
fi

jq -r '.full_key' "$RESP" > "$OUT"      # shown ONCE — this is the only copy
chmod 600 "$OUT"
rm -f "$RESP"
echo "==> Key minted and saved to: $OUT"

echo "==> Verifying against the public API..."
curl -s -m 20 -o /dev/null -w "GET /clusters -> HTTP %{http_code}\n" \
  "$API/clusters" -H "API-Key: $(cat "$OUT")" -H "API-Version: $VER"
echo
echo "Done. Re-running this script will REUSE this key while it stays valid."
