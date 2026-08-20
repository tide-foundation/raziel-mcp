#!/usr/bin/env bash
# Why does a Keycloak page appear after a Tide sign-up? Answer it for THIS realm.
#
# There are four different mechanisms that render a Keycloak-looking form after a brokered login,
# and they have four different fixes. Guessing which one you have and applying the wrong fix leaves
# the page in place and changes something you did not intend, so measure first.
#
#   1. idp-review-profile        the "first broker login" flow's first step. Shows the Account
#                                Information form when User Profile validation fails on the brokered
#                                identity. Tide asserts ONLY a username (the vuid) -- no email, no
#                                first/last name -- so any REQUIRED attribute triggers it.
#   2. VERIFY_PROFILE            a required action with the same symptom and a different cause. Fires
#                                on every login while the profile is incomplete, not just the first.
#   3. UPDATE_PROFILE / VERIFY_EMAIL / TERMS_AND_CONDITIONS as DEFAULT required actions -- added to
#                                every new user at creation.
#   4. a stale required action already ON an existing user, which no realm-level change removes.
#
# A correctly provisioned Tide realm has none of these: `setUpTideRealm` leaves the realm with only
# `link-tide-account-action` and `idp_link` (both non-default), and a User Profile with nothing
# required. VERIFIED read-only against a live Tide realm 2026-08-20. If this script reports
# "nothing will fire" and you still see a page, it is probably not a form at all -- check whether
# your post-login redirect is landing on Keycloak's ACCOUNT CONSOLE instead of your app.
#
# Read-only. It changes nothing.
#
# Usage:
#   ./diagnose-post-signup-page.sh --realm myapp
#   ./diagnose-post-signup-page.sh --realm myapp --url https://xyz.us.skycloak.io
#
# Credentials from the environment or ./.env (AP-41):
#   KC_BOOTSTRAP_ADMIN_USERNAME / KC_BOOTSTRAP_ADMIN_PASSWORD

set -uo pipefail

URL="${TIDECLOAK_URL:-http://localhost:8080}"
REALM="${TIDECLOAK_REALM:-}"
FLOW="${BROKER_FLOW:-first broker login}"

while [ $# -gt 0 ]; do
  case "$1" in
    --realm) REALM="$2"; shift 2 ;;
    --url)   URL="$2"; shift 2 ;;
    --flow)  FLOW="$2"; shift 2 ;;
    -h|--help) sed -n '1,30p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -f ./.env ] && . ./.env
ADMIN_USER="${KC_BOOTSTRAP_ADMIN_USERNAME:-admin}"
ADMIN_PASS="${KC_BOOTSTRAP_ADMIN_PASSWORD:-}"
[ -n "$REALM" ] || { echo "ERROR: --realm is required." >&2; exit 2; }
[ -n "$ADMIN_PASS" ] || { echo "ERROR: KC_BOOTSTRAP_ADMIN_PASSWORD is not set (env or ./.env)." >&2; exit 2; }
command -v jq >/dev/null || { echo "ERROR: jq is required." >&2; exit 2; }

T="$(curl -s -m 20 -X POST "$URL/realms/master/protocol/openid-connect/token" \
      -H "Content-Type: application/x-www-form-urlencoded" \
      -d "grant_type=password&client_id=admin-cli&username=$ADMIN_USER&password=$ADMIN_PASS" \
      | jq -r '.access_token // empty')"
[ -n "$T" ] || { echo "ERROR: could not mint an admin token — check credentials and URL." >&2; exit 1; }
G() { curl -s -m 20 "$URL/admin/realms/$REALM$1" -H "Authorization: Bearer $T"; }

echo "=== $REALM @ $URL"
echo
FINDINGS=0

# --- 1. idp-review-profile ---------------------------------------------------------------------
ENC_FLOW="$(printf '%s' "$FLOW" | jq -sRr @uri)"
EXECS="$(G "/authentication/flows/$ENC_FLOW/executions")"
CFG_ID="$(printf '%s' "$EXECS" | jq -r '.[]? | select(.providerId=="idp-review-profile") | .authenticationConfig // empty' | head -1)"
MODE="missing"   # the code default when no config is attached
if [ -n "$CFG_ID" ]; then
  V="$(G "/authentication/config/$CFG_ID" | jq -r '.config["update.profile.on.first.login"] // empty')"
  [ -n "$V" ] && MODE="$V"
fi

# Which attributes would fail validation? Only REQUIRED ones matter, and Tide supplies only username.
REQ="$(G "/users/profile" | jq -r '[.attributes[]? | select(.required != null) | .name] | join(", ")')"
echo "1. idp-review-profile      update.profile.on.first.login = $MODE"
echo "   required user-profile attributes: ${REQ:-<none>}"
if [ "$MODE" = "on" ]; then
  echo "   >> WILL SHOW the Account Information page on every first login (mode 'on' is unconditional)."
  FINDINGS=$((FINDINGS+1))
elif [ "$MODE" = "missing" ] && [ -n "$REQ" ]; then
  echo "   >> WILL SHOW: Tide asserts only a username, so the required attribute(s) above fail"
  echo "      validation. Fix: make them optional, or run skip-review-profile.sh --realm $REALM"
  FINDINGS=$((FINDINGS+1))
else
  echo "   -- will not fire."
fi
echo

# --- 2/3. required actions ----------------------------------------------------------------------
RA="$(G "/authentication/required-actions")"
DEFAULTS="$(printf '%s' "$RA" | jq -r '[.[]? | select(.enabled and .defaultAction) | .alias] | join(", ")')"
VP="$(printf '%s' "$RA" | jq -r '.[]? | select(.alias=="VERIFY_PROFILE") | .enabled')"
echo "2. VERIFY_PROFILE          enabled = ${VP:-not present}"
if [ "$VP" = "true" ] && [ -n "$REQ" ]; then
  echo "   >> WILL SHOW on EVERY login while the profile is incomplete — not just the first."
  echo "      Fix: disable the action, or make those attributes optional."
  FINDINGS=$((FINDINGS+1))
else
  echo "   -- will not fire."
fi
echo
echo "3. default required actions: ${DEFAULTS:-<none>}"
if [ -n "$DEFAULTS" ]; then
  echo "   >> These are added to EVERY new user at creation and each renders its own page."
  FINDINGS=$((FINDINGS+1))
else
  echo "   -- none, so nothing is stamped onto new users."
fi
echo

# --- 4. existing users already carrying an action -----------------------------------------------
STUCK="$(G "/users?max=200" | jq -r '[.[]? | select((.requiredActions|length) > 0) | "\(.username):\(.requiredActions|join("+"))"] | join("  ")')"
echo "4. existing users with a pending required action:"
if [ -n "$STUCK" ]; then
  echo "   >> $STUCK"
  echo "      Realm-level changes do NOT clear these. Clear per user:"
  echo "      PUT /admin/realms/$REALM/users/{id}  {\"requiredActions\":[]}"
  FINDINGS=$((FINDINGS+1))
else
  echo "   -- none."
fi
echo

echo "-----"
if [ "$FINDINGS" -eq 0 ]; then
  cat <<NOTE
Nothing in this realm will render a post-signup form.

If you are still seeing a Keycloak page, it is most likely not a form but the ACCOUNT CONSOLE:
check where your app sends the user after login, and that the client's redirect URI points at your
app rather than at Keycloak. Capture the URL of the page you land on — the path says which it is:
  /realms/$REALM/login-actions/required-action?...   -> a required action (case 2/3/4)
  /realms/$REALM/login-actions/first-broker-login    -> idp-review-profile (case 1)
  /realms/$REALM/account/...                         -> the account console, i.e. a redirect problem
NOTE
else
  echo "$FINDINGS mechanism(s) above will render a page. Fix the ones marked >>."
fi
