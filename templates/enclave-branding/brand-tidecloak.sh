#!/usr/bin/env bash
# Brand a TideCloak realm end to end: generate -> validate -> upload -> save+sign -> verify.
#
# One command. No image model needed. Safe to re-run (each upload replaces the previous file of
# that fileType, and set-branding re-signs from the updated config).
#
# Usage:
#   ./brand-tidecloak.sh                          # uses env / .env, realm from TIDECLOAK_REALM
#   ./brand-tidecloak.sh --realm noted --accent 1f6feb --name "Noted"
#   ./brand-tidecloak.sh --realm noted --logo path/to/logo.png --background path/to/bg.jpg
#
# Credentials come from the environment (or ./.env), never from this script (AP-41):
#   KC_BOOTSTRAP_ADMIN_USERNAME / KC_BOOTSTRAP_ADMIN_PASSWORD
# Master-admin tokens live ~60 SECONDS, so a fresh one is minted per call.

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

URL="${TIDECLOAK_URL:-http://localhost:8080}"
REALM="${TIDECLOAK_REALM:-}"
ACCENT="${BRAND_ACCENT:-1f6feb}"
APPNAME="${BRAND_NAME:-}"
LOGO=""; BG=""; OUT="${BRAND_OUT:-./branding}"

while [ $# -gt 0 ]; do
  case "$1" in
    --realm) REALM="$2"; shift 2 ;;
    --url) URL="$2"; shift 2 ;;
    --accent) ACCENT="$2"; shift 2 ;;
    --name) APPNAME="$2"; shift 2 ;;
    --logo) LOGO="$2"; shift 2 ;;
    --background) BG="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[ -f ".env" ] && { set -a; . ./.env; set +a; }
: "${KC_BOOTSTRAP_ADMIN_USERNAME:=${KC_ADMIN_USER:-admin}}"
: "${KC_BOOTSTRAP_ADMIN_PASSWORD:=${KC_ADMIN_PASSWORD:-}}"

[ -z "$REALM" ] && { echo "ERROR: --realm (or TIDECLOAK_REALM) is required." >&2; exit 2; }
if [ -z "$KC_BOOTSTRAP_ADMIN_PASSWORD" ]; then
  echo "ERROR: KC_BOOTSTRAP_ADMIN_PASSWORD is not set. cp .env.template .env and set it (AP-41)." >&2
  exit 1
fi
command -v jq >/dev/null || { echo "ERROR: jq is required." >&2; exit 2; }

tok() {
  curl -s -X POST "$URL/realms/master/protocol/openid-connect/token" \
    -d client_id=admin-cli -d grant_type=password \
    --data-urlencode "username=$KC_BOOTSTRAP_ADMIN_USERNAME" \
    --data-urlencode "password=$KC_BOOTSTRAP_ADMIN_PASSWORD" | jq -r '.access_token // empty'
}

echo "==> Branding realm '$REALM' at $URL"

# --- 0. pre-flight: is this realm even brandable? ----------------------------------------------
# set-branding needs the Tide IdP + tide-vendor-key component (i.e. a LICENSED realm). Checking
# first costs one GET; not checking costs two uploads that land on disk and are then orphaned when
# the save fails. Fail fast.
T="$(tok)"; [ -z "$T" ] && { echo "ERROR: could not mint an admin token — check the credentials." >&2; exit 1; }
# Check for the `tide-vendor-key` COMPONENT — that is precisely what set-branding requires
# (VendorResource filters components on providerId == "tide-vendor-key"). Do NOT check for the Tide
# IdP instead: a realm can have the IdP and still lack the vendor key, which is exactly the state an
# unlicensed realm is left in. Measured: both a licensed and an unlicensed realm return 200 for
# identity-provider/instances/tide, so that check would pass and then the save would fail after two
# wasted uploads.
COMPONENTS="$(curl -s -w '\n%{http_code}' "$URL/admin/realms/$REALM/components" -H "Authorization: Bearer $T")"
COMP_CODE="$(printf '%s' "$COMPONENTS" | tail -1)"
COMP_BODY="$(printf '%s' "$COMPONENTS" | sed '$d')"
if [ "$COMP_CODE" != "200" ]; then
  echo "ERROR: cannot read realm '$REALM' (HTTP $COMP_CODE). Wrong realm name, or the admin lacks" >&2
  echo "       manage-realm. Nothing was uploaded." >&2
  exit 1
fi
if ! printf '%s' "$COMP_BODY" | jq -e 'any(.[]; .providerId == "tide-vendor-key")' >/dev/null 2>&1; then
  echo "ERROR: realm '$REALM' has no 'tide-vendor-key' component, so branding cannot be signed —" >&2
  echo "       set-branding would return 400. The realm is not licensed: run setUpTideRealm first" >&2
  echo "       (canon/tidecloak-bootstrap.md). Nothing was uploaded." >&2
  exit 1
fi

# --- 1. assets ---------------------------------------------------------------------------------
if [ -z "$LOGO" ] || [ -z "$BG" ]; then
  echo "--> generating default assets (accent=$ACCENT${APPNAME:+, name=$APPNAME})"
  python3 "$HERE/make-branding.py" --out "$OUT" --accent "$ACCENT" ${APPNAME:+--name "$APPNAME"} >/dev/null || {
    echo "ERROR: asset generation failed." >&2; exit 1; }
  LOGO="${LOGO:-$OUT/logo.png}"
  BG="${BG:-$OUT/background.png}"
else
  echo "--> using supplied assets"
fi

# --- 2. validate BEFORE spending an upload -----------------------------------------------------
echo "--> validating"
python3 "$HERE/check-branding.py" "$LOGO" --as LOGO >/dev/null || { echo "ERROR: logo failed validation. Run check-branding.py to see why." >&2; exit 1; }
python3 "$HERE/check-branding.py" "$BG" --as BACKGROUND_IMAGE >/dev/null || { echo "ERROR: background failed validation." >&2; exit 1; }
echo "    both assets pass the hard constraints"

# --- 3. upload ---------------------------------------------------------------------------------
declare -A SERVE
for pair in "LOGO:$LOGO" "BACKGROUND_IMAGE:$BG"; do
  TYPE="${pair%%:*}"; FILE="${pair#*:}"
  T="$(tok)"; [ -z "$T" ] && { echo "ERROR: could not mint an admin token." >&2; exit 1; }
  OUTJSON="$(curl -s -X POST "$URL/admin/realms/$REALM/tide-idp-admin-resources/images/upload" \
    -H "Authorization: Bearer $T" \
    -F "fileData=@$FILE" -F "fileName=$(basename "$FILE")" -F "fileType=$TYPE")"
  HASH="$(printf '%s' "$OUTJSON" | jq -r '.hash // empty')"
  if [ -z "$HASH" ]; then
    echo "ERROR: upload of $TYPE failed: $OUTJSON" >&2; exit 1
  fi
  SERVE[$TYPE]="$URL/realms/$REALM/tide-idp-resources/images/$TYPE?v=$HASH"
  echo "--> uploaded $TYPE (sha256 ${HASH:0:12}...)"
done

# --- 4. save AND sign (one call; the enclave verifies the signed blob) -------------------------
echo "--> saving + re-signing IdP settings"
T="$(tok)"
BODY="$(jq -n --arg l "${SERVE[LOGO]}" --arg b "${SERVE[BACKGROUND_IMAGE]}" '{logoUrl:$l, backgroundUrl:$b}')"
RESP="$(curl -s -w '\n%{http_code}' -X POST "$URL/admin/realms/$REALM/vendorResources/set-branding" \
  -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d "$BODY")"
CODE="$(printf '%s' "$RESP" | tail -1)"; MSG="$(printf '%s' "$RESP" | sed '$d')"
if [ "$CODE" != "200" ]; then
  echo "ERROR: set-branding returned $CODE: $MSG" >&2
  echo "       Branding is IGA-exempt, so this is not an approval problem. A 400 usually means the" >&2
  echo "       realm has no tide-vendor-key / Tide IdP (not licensed); a 500 means ORK signing failed." >&2
  exit 1
fi
echo "    $MSG"

# --- 5. verify what the realm actually serves --------------------------------------------------
echo "--> verifying"
T="$(tok)"
curl -s "$URL/admin/realms/$REALM/vendorResources/get-branding" -H "Authorization: Bearer $T" \
  | jq -r 'to_entries[] | "    \(.key) = \(.value)"'
for TYPE in LOGO BACKGROUND_IMAGE; do
  CT="$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$URL/realms/$REALM/tide-idp-resources/images/$TYPE")"
  echo "    GET images/$TYPE -> $CT (public, no auth)"
done
echo
echo "Done. The enclave now shows this branding. Re-run any time — uploads replace, and every save re-signs."
