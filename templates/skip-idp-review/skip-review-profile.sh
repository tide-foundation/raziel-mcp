#!/usr/bin/env bash
# Stop Keycloak's "Account Information" page appearing after a Tide sign-up.
#
# WHAT YOU ARE SEEING
# -------------------
# Tide is a brokered identity provider, so a first sign-in runs Keycloak's built-in
# **first broker login** flow. Its first step is the `idp-review-profile` authenticator, whose
# config key `update.profile.on.first.login` defaults to `missing`:
#
#     if (UPFLM_MISSING.equals(updateProfileFirstLogin)) {
#         profileProvider.create(UserProfileContext.IDP_REVIEW, userCtx.getAttributes()).validate();
#         return false;                 // no page
#     } catch (ValidationException pve) {
#         return true;                  // <-- the page
#     }
#     -- IdpReviewProfileAuthenticator.requiresUpdateProfilePage()
#
# The Tide IdP supplies ONLY a username (the vuid):
#
#     BrokeredIdentityContext identity = new BrokeredIdentityContext(userId, providerConfig);
#     identity.setUsername(userId);     // no email, no firstName, no lastName
#     -- TideIdentityProvider
#
# So User Profile validation fails on the missing email, and Keycloak renders the form. It is not a
# Tide bug and not misconfiguration — it is the stock default meeting an IdP that only asserts an
# identifier.
#
# Setting the value to `off` makes `requiresUpdateProfilePage` return false unconditionally
# (`return UPFLM_ON.equals(updateProfileFirstLogin)`), so the page never renders.
#
# ⚠️ Setting `updateProfileFirstLoginMode` ON THE IDP does nothing. That field on
# IdentityProviderRepresentation is legacy, kept for importing old realms; the runtime check reads
# the AUTHENTICATOR config. It is the obvious thing to try and it silently has no effect.
#
# ⚠️ `first broker login` is a BUILT-IN flow shared by every IdP in the realm. If this realm has
# other identity providers, copy the flow and bind the copy to the Tide IdP instead of editing the
# shared one (this script warns when it finds more than one IdP).
#
# The user is still created: IdpCreateUserIfUniqueAuthenticator calls
# `session.users().addUser(realm, username)` with NO User Profile validation, so an account with no
# email is created cleanly. Collect real details in-app afterwards — see ONBOARDING.md, and do NOT
# invent a placeholder email (AP-85).
#
# Usage:
#   ./skip-review-profile.sh --realm myapp
#   ./skip-review-profile.sh --realm myapp --url https://xyz.us.skycloak.io
#   ./skip-review-profile.sh --realm myapp --revert      # back to the `missing` default
#
# Credentials come from the environment or ./.env, never from this file (AP-41):
#   KC_BOOTSTRAP_ADMIN_USERNAME / KC_BOOTSTRAP_ADMIN_PASSWORD
# Master-admin tokens live ~60 SECONDS, so this mints one per run.

set -uo pipefail

URL="${TIDECLOAK_URL:-http://localhost:8080}"
REALM="${TIDECLOAK_REALM:-}"
FLOW="${BROKER_FLOW:-first broker login}"
MODE="off"

while [ $# -gt 0 ]; do
  case "$1" in
    --realm)  REALM="$2"; shift 2 ;;
    --url)    URL="$2"; shift 2 ;;
    --flow)   FLOW="$2"; shift 2 ;;
    --revert) MODE="missing"; shift ;;
    --mode)   MODE="$2"; shift 2 ;;
    -h|--help) sed -n '1,52p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -f ./.env ] && . ./.env
ADMIN_USER="${KC_BOOTSTRAP_ADMIN_USERNAME:-admin}"
ADMIN_PASS="${KC_BOOTSTRAP_ADMIN_PASSWORD:-}"

[ -n "$REALM" ] || { echo "ERROR: --realm is required." >&2; exit 2; }
[ -n "$ADMIN_PASS" ] || { echo "ERROR: KC_BOOTSTRAP_ADMIN_PASSWORD is not set (env or ./.env)." >&2; exit 2; }
case "$MODE" in on|missing|off) ;; *) echo "ERROR: --mode must be on, missing or off." >&2; exit 2 ;; esac
command -v jq >/dev/null || { echo "ERROR: jq is required." >&2; exit 2; }

tok() {
  curl -s -m 20 -X POST "$URL/realms/master/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=password&client_id=admin-cli&username=$ADMIN_USER&password=$ADMIN_PASS" \
    | jq -r '.access_token // empty'
}

T="$(tok)"
[ -n "$T" ] || { echo "ERROR: could not mint an admin token — check the credentials and URL." >&2; exit 1; }

echo "==> realm '$REALM' at $URL"

# More than one IdP means the shared built-in flow is the wrong thing to edit.
IDPS="$(curl -s -m 20 "$URL/admin/realms/$REALM/identity-provider/instances" \
        -H "Authorization: Bearer $T" | jq -r '[.[].alias] | join(", ")' 2>/dev/null)"
IDP_COUNT="$(printf '%s' "$IDPS" | awk -F', ' '{print ($0=="") ? 0 : NF}')"
if [ "${IDP_COUNT:-0}" -gt 1 ]; then
  echo "WARNING: this realm has $IDP_COUNT identity providers ($IDPS)." >&2
  echo "         '$FLOW' is shared by all of them, so this change affects every one." >&2
  echo "         If that is not what you want, copy the flow, set the copy's idp-review-profile to" >&2
  echo "         '$MODE', and set the Tide IdP's firstBrokerLoginFlowAlias to the copy." >&2
fi

# Find the idp-review-profile execution inside the flow.
ENC_FLOW="$(printf '%s' "$FLOW" | jq -sRr @uri)"
EXECS="$(curl -s -w '\n%{http_code}' -m 20 \
  "$URL/admin/realms/$REALM/authentication/flows/$ENC_FLOW/executions" -H "Authorization: Bearer $T")"
CODE="$(printf '%s' "$EXECS" | tail -1)"; BODY="$(printf '%s' "$EXECS" | sed '$d')"
if [ "$CODE" != "200" ]; then
  echo "ERROR: could not read flow '$FLOW' (HTTP $CODE): $(printf '%s' "$BODY" | head -c 200)" >&2
  echo "       List them with: GET /admin/realms/$REALM/authentication/flows" >&2
  exit 1
fi

EXEC_ID="$(printf '%s' "$BODY" | jq -r '.[] | select(.providerId=="idp-review-profile") | .id' | head -1)"
CFG_ID="$(printf '%s' "$BODY" | jq -r '.[] | select(.providerId=="idp-review-profile") | .authenticationConfig // empty' | head -1)"
if [ -z "$EXEC_ID" ]; then
  echo "ERROR: no 'idp-review-profile' execution in flow '$FLOW'." >&2
  echo "       If the Tide IdP uses a custom first-broker-login flow, pass --flow '<its alias>'." >&2
  exit 1
fi

if [ -n "$CFG_ID" ]; then
  # Config already exists -> update it in place. Creating a second one is not possible and the POST
  # would fail, so this branch matters on any re-run.
  RESP="$(curl -s -w '\n%{http_code}' -m 20 -X PUT \
    "$URL/admin/realms/$REALM/authentication/config/$CFG_ID" \
    -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
    -d "$(jq -n --arg m "$MODE" '{alias:"tide-review-profile", config:{"update.profile.on.first.login":$m}}')")"
else
  RESP="$(curl -s -w '\n%{http_code}' -m 20 -X POST \
    "$URL/admin/realms/$REALM/authentication/executions/$EXEC_ID/config" \
    -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
    -d "$(jq -n --arg m "$MODE" '{alias:"tide-review-profile", config:{"update.profile.on.first.login":$m}}')")"
fi
CODE="$(printf '%s' "$RESP" | tail -1)"
case "$CODE" in
  200|201|204) : ;;
  *) echo "ERROR: could not set the config (HTTP $CODE): $(printf '%s' "$RESP" | sed '$d' | head -c 300)" >&2; exit 1 ;;
esac

# Read it back. A 2xx is not proof the value stuck.
VERIFY="$(curl -s -m 20 "$URL/admin/realms/$REALM/authentication/flows/$ENC_FLOW/executions" \
  -H "Authorization: Bearer $T" \
  | jq -r '.[] | select(.providerId=="idp-review-profile") | .authenticationConfig // empty' | head -1)"
ACTUAL=""
[ -n "$VERIFY" ] && ACTUAL="$(curl -s -m 20 "$URL/admin/realms/$REALM/authentication/config/$VERIFY" \
  -H "Authorization: Bearer $T" | jq -r '.config["update.profile.on.first.login"] // empty')"

if [ "$ACTUAL" = "$MODE" ]; then
  echo "    update.profile.on.first.login = $ACTUAL  (verified by read-back)"
  [ "$MODE" = "off" ] && cat <<'NOTE'

    New users are now created straight from the Tide identity: username = vuid, no email, no
    Account Information page.

    Collect real details IN YOUR APP after login -- see ONBOARDING.md. Do not invent a placeholder
    email to fill the gap (AP-85): it is indistinguishable from a real address downstream, it
    collides with Keycloak's email-uniqueness constraint, and Tide does not need email for recovery
    because password reset happens in the enclave.
NOTE
else
  echo "ERROR: read-back says '${ACTUAL:-<unset>}', expected '$MODE'." >&2
  exit 1
fi
