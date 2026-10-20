#!/usr/bin/env bash
# tide-doctor.sh — one command that finds what is wrong with a Tide app and FIXES what it can.
#
# WHY THIS EXISTS
# ---------------
# A broken Tide login or an unprotected API rarely names its cause. The token endpoint says 400,
# the popup is blank, or — worse — everything appears to work and nothing is being verified. The
# checks below are the ones that have each cost a real build hours, gathered into one run:
#
#   - the DPoP relay page is missing, stale, or served without its headers
#   - useDPoP was passed as a JSX prop, where it is silently ignored and DPoP stays OFF
#   - createTideCloakProxy(config) was called without protectedRoutes, so it protects NOTHING
#   - the adapter JSON has no embedded key, or the verifier fetches keys remotely
#   - a secret is about to be committed
#
# IT REPAIRS BY DEFAULT. A fault with exactly one correct, mechanical repair is fixed on the spot
# and re-checked: the DPoP page is re-copied byte-exact, a wrong rewrite path is corrected, `.env`
# is added to .gitignore. Those are reported as FIXED.
#
# What it will NOT change is anything that needs a decision or rewrites your logic: which routes
# need which roles, where a provider option belongs, your CSP policy, or bootstrapping a realm
# (which needs the user's licence email and their agreement to the terms). Those are reported as
# FAIL with the fix spelled out, for the agent running this to apply. A FAIL is a job for the
# agent, not a list to hand to the user.
#
# With --url or --realm it also makes read-only HTTP requests. It never changes a realm.
#
# Usage:
#   tide-doctor.sh [--app DIR] [--url http://localhost:3000] [--realm NAME] [--check]
#
#   --check       report only; change nothing (use in CI)
#   --app DIR     the app to check (default: current directory)
#   --url URL     also check the RUNNING app: is the DPoP page served, byte-exact, with its headers
#   --realm NAME  also check the realm. Needs TIDECLOAK_URL and KC_BOOTSTRAP_ADMIN_PASSWORD in the
#                 environment or in DIR/.env, plus curl and jq
#
# Exit 0 = nothing left to fix. Exit 1 = at least one FAIL remains. WARN and FIXED never fail the run.

set -uo pipefail

APP="."
URL=""
REALM=""
FIX=1
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
while [ $# -gt 0 ]; do
  case "$1" in
    --app)   APP="${2:?--app needs a directory}"; shift 2 ;;
    --url)   URL="${2:?--url needs a URL}"; shift 2 ;;
    --realm) REALM="${2:?--realm needs a realm name}"; shift 2 ;;
    --check) FIX=0; shift ;;
    --fix)   FIX=1; shift ;;
    -h|--help) sed -n '2,41p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -d "$APP" ] || { echo "not a directory: $APP" >&2; exit 2; }
cd "$APP" || exit 2

GOOD_DPOP_SHA="9d7844b938f0a2565fa910d3d30e9b8797cbfd6e0b73d59d804169a089aea757"
FAILS=0; WARNS=0; PASSES=0; FIXES=0

pass() { PASSES=$((PASSES + 1)); printf '  PASS  %s\n' "$1"; }
warn() { WARNS=$((WARNS + 1));  printf '  WARN  %s\n        fix: %s\n' "$1" "$2"; }
fail() { FAILS=$((FAILS + 1));  printf '  FAIL  %s\n        fix: %s\n' "$1" "$2"; }
note() { printf '  ----  %s\n' "$1"; }
fixed() { FIXES=$((FIXES + 1)); printf '  FIXED %s\n' "$1"; }

# Put the known-good DPoP page at $1. Sources, in order: the SDK already installed in this app,
# then the pack copy that ships beside this script. Either is used only if its bytes are right.
install_dpop_page() {
  local dest="$1" src
  for src in node_modules/@tidecloak/js/tide_dpop_auth.html \
             "$SCRIPT_DIR/../nextjs-customer-portal/public/tide_dpop_auth.html" \
             "$SCRIPT_DIR/../vanilla-js-secure-form/public/tide_dpop_auth.html"; do
    if [ -f "$src" ] && [ "$(sha256 "$src")" = "$GOOD_DPOP_SHA" ]; then
      mkdir -p "$(dirname "$dest")" && cp "$src" "$dest" && [ "$(sha256 "$dest")" = "$GOOD_DPOP_SHA" ] && return 0
    fi
  done
  return 1
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# Source files of the app itself: never dependencies or build output.
src_grep() { # src_grep <grep flags> <pattern>
  grep -rIE "$@" \
    --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' --include='*.mjs' --include='*.cjs' \
    --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist --exclude-dir=build \
    --exclude-dir=out --exclude-dir=.tide-pack --exclude-dir=.git . 2>/dev/null
}

# Is useDPoP set as an option in real code? A mention in a comment (the pack's own verifier has
# one) must not count, or an app with DPoP off would be reported as having it on.
uses_dpop() {
  src_grep -h 'useDPoP[[:space:]]*:' | grep -vqE '^[[:space:]]*(\*|//|/\*)'
}

# ---------------------------------------------------------------------------------------------
FRAMEWORK="none"
if [ -f package.json ]; then
  if grep -q '"next"' package.json; then FRAMEWORK="nextjs"
  elif grep -q '"vite"' package.json; then FRAMEWORK="vite"
  else FRAMEWORK="other"; fi
fi
NEXT_CONFIG=""
for f in next.config.ts next.config.mjs next.config.js; do [ -f "$f" ] && NEXT_CONFIG="$f" && break; done

echo ""
echo "Tide doctor — $(pwd)   (framework: $FRAMEWORK)"
echo ""

# --- 1. Adapter JSON ---------------------------------------------------------------------------
echo "Adapter"
ADAPTER=""
for f in data/tidecloak.json public/tidecloak.json tidecloak.json tidecloakAdapter.json; do
  [ -f "$f" ] && ADAPTER="$f" && break
done
if [ -z "$ADAPTER" ] && [ -z "${CLIENT_ADAPTER:-}" ]; then
  fail "no adapter JSON found (looked for data/tidecloak.json, public/tidecloak.json)" \
       "the realm is not bootstrapped for this app yet. Run the init script (npm run init), or export the adapter from TideCloak."
elif [ -n "$ADAPTER" ]; then
  pass "adapter found: $ADAPTER"
  if grep -q '"jwk"' "$ADAPTER"; then pass "adapter carries the embedded key (jwk)"
  else fail "adapter has no \"jwk\"" \
            "the realm has no Tide vendor key yet. Finish setUpTideRealm, then re-export the adapter with providerId=keycloak-oidc-keycloak-json."; fi
  for k in vendorId auth-server-url realm resource; do
    grep -q "\"$k\"" "$ADAPTER" || fail "adapter is missing \"$k\"" "re-export the adapter from TideCloak; do not hand-write it."
  done
  if grep -q '"client-origin-auth-' "$ADAPTER"; then pass "adapter has a signed origin entry (client-origin-auth-*)"
  else warn "adapter has no client-origin-auth-* entry" \
            "the enclave needs one for the origin the app is served from. Run sign-idp-settings, then re-export the adapter."; fi
fi

# --- 2. DPoP on the client ---------------------------------------------------------------------
echo ""
echo "DPoP — client"
if src_grep -q '(useDPoP|initOptions)=\{'; then
  fail "useDPoP / initOptions is passed as a JSX PROP: $(src_grep -l '(useDPoP|initOptions)=\{' | head -3 | tr '\n' ' ')" \
       "neither provider has that prop, so it is ignored and DPoP stays OFF. Put it inside config: config={{ ...tcConfig, useDPoP: { mode: 'strict', alg: 'ES256' } }}"
elif uses_dpop; then
  pass "useDPoP is set in the provider config"
else
  warn "useDPoP is not set anywhere" \
       "DPoP is opt-in on the client. The pack's realm template requires it, so login fails with 400 \"DPoP proof is missing\". Add useDPoP: { mode: 'strict', alg: 'ES256' } inside the provider config."
fi

# --- 3. The DPoP relay page --------------------------------------------------------------------
echo ""
echo "DPoP — relay page"
SDK_ROUTE=0
src_grep -q 'createDpopRoute|tideDpopPlugin' && SDK_ROUTE=1
DPOP_FILE=""
for f in public/tide_dpop_auth.html static/tide_dpop_auth.html; do [ -f "$f" ] && DPOP_FILE="$f" && break; done

if [ -n "$DPOP_FILE" ]; then
  GOT="$(sha256 "$DPOP_FILE")"
  if [ "$GOT" = "$GOOD_DPOP_SHA" ]; then
    pass "$DPOP_FILE is the known-good page"
  elif grep -q 'window\.opener' "$DPOP_FILE"; then
    warn "$DPOP_FILE is not the known-good bytes (sha256 $GOT) but does handle the popup" \
         "it may be newer than this check or locally edited. The enclave pins the page's script by hash, so an edit breaks login. Re-copy it: cp node_modules/@tidecloak/js/tide_dpop_auth.html $DPOP_FILE"
  elif [ "$FIX" -eq 1 ] && install_dpop_page "$DPOP_FILE"; then
    fixed "$DPOP_FILE was the STALE page (it only posts to window.parent, which breaks the popup fallback). Replaced with the known-good copy; hash verified."
  else
    fail "$DPOP_FILE is the STALE page: it only posts to window.parent, so popup DPoP fails with TIDE-SWE-UNHANDLED" \
         "re-copy it byte-exact: cp node_modules/@tidecloak/js/tide_dpop_auth.html $DPOP_FILE   (or call the tide_dpop_asset tool)"
  fi
elif [ "$SDK_ROUTE" -eq 1 ]; then
  pass "the DPoP page is served by the SDK (createDpopRoute / tideDpopPlugin); no file to copy"
elif [ "$FIX" -eq 1 ] && install_dpop_page public/tide_dpop_auth.html; then
  DPOP_FILE="public/tide_dpop_auth.html"
  fixed "public/tide_dpop_auth.html was missing. Installed the known-good copy; hash verified."
else
  fail "no tide_dpop_auth.html in public/, and no SDK route serving it" \
       "copy it byte-exact: mkdir -p public && cp node_modules/@tidecloak/js/tide_dpop_auth.html public/   (or call the tide_dpop_asset tool)"
fi

if [ "$FRAMEWORK" = "nextjs" ] && [ "$SDK_ROUTE" -eq 0 ]; then
  if [ -z "$NEXT_CONFIG" ]; then
    fail "no next.config.* — nothing maps /tide_dpop/... to the page" \
         "add a rewrite { source: '/tide_dpop/:path*', destination: '/tide_dpop_auth.html' } and the header rule. See the tide_dpop_asset tool."
  else
    if grep -qE "tide_dpop/:path\*" "$NEXT_CONFIG" && grep -q 'tide_dpop_auth.html' "$NEXT_CONFIG"; then
      pass "$NEXT_CONFIG rewrites /tide_dpop/:path* to the page"
    elif grep -qE "source:[[:space:]]*['\"]/tide_dpop['\"]" "$NEXT_CONFIG"; then
      if [ "$FIX" -eq 1 ] && sed -i.tide-bak -E "s#(source:[[:space:]]*['\"])/tide_dpop(['\"])#\\1/tide_dpop/:path*\\2#g" "$NEXT_CONFIG" \
         && rm -f "$NEXT_CONFIG.tide-bak" && grep -qE "tide_dpop/:path\*" "$NEXT_CONFIG"; then
        fixed "$NEXT_CONFIG matched the exact path /tide_dpop, which 404s (the real URL continues /iss/.../aud/...). Changed to the wildcard /tide_dpop/:path*."
      else
        fail "$NEXT_CONFIG rewrites the exact path /tide_dpop — the real URL has /iss/.../aud/... after it and 404s" \
             "use the wildcard: source: '/tide_dpop/:path*'"
      fi
    else
      fail "$NEXT_CONFIG has no rewrite for /tide_dpop/:path*" \
           "add { source: '/tide_dpop/:path*', destination: '/tide_dpop_auth.html' } under rewrites()."
    fi
    if grep -qi 'Allow-CSP-From' "$NEXT_CONFIG"; then pass "$NEXT_CONFIG sends Allow-CSP-From on the relay path"
    else fail "$NEXT_CONFIG never sends Allow-CSP-From" \
              "the enclave frames the page with its own CSP; without Allow-CSP-From: * the frame is refused. Add it to the /tide_dpop/:path* header rule."; fi
    # Later rule wins for a header key: a catch-all placed after the relay rule overrides its CSP.
    CATCH_LINE="$(grep -nE "source:[[:space:]]*['\"]/:path\*['\"]" "$NEXT_CONFIG" | tail -1 | cut -d: -f1)"
    ALLOW_LINE="$(grep -ni 'Allow-CSP-From' "$NEXT_CONFIG" | head -1 | cut -d: -f1)"
    if [ -n "$CATCH_LINE" ] && [ -n "$ALLOW_LINE" ] && [ "$CATCH_LINE" -gt "$ALLOW_LINE" ]; then
      fail "$NEXT_CONFIG puts the catch-all '/:path*' header rule AFTER the /tide_dpop rule (lines $CATCH_LINE and $ALLOW_LINE)" \
           "for one header key the LAST matching rule wins, so the catch-all's CSP replaces the relay's. Move the /tide_dpop/:path* rule below it."
    fi
  fi
fi
if [ -n "$NEXT_CONFIG" ] && grep -qi 'frame-ancestors' "$NEXT_CONFIG"; then
  fail "$NEXT_CONFIG sets frame-ancestors" \
       "the enclave frames your own origin for the DPoP page; a frame-ancestors policy refuses it. Remove it (AP-71)."
fi
if [ "$FRAMEWORK" != "nextjs" ] && [ "$SDK_ROUTE" -eq 0 ] && [ -n "$DPOP_FILE" ]; then
  note "not Next.js: your host must serve /tide_dpop/iss/<hex>/aud/<hex>/tide_dpop_auth.html with Allow-CSP-From: * — check it with --url"
fi

# --- 4. Route protection -----------------------------------------------------------------------
echo ""
echo "Protection"
PROXY_FILES="$(src_grep -l 'createTideCloak(Proxy|Middleware)')"
if [ -n "$PROXY_FILES" ]; then
  if src_grep -q 'createTideCloak(Proxy|Middleware)\([[:space:]]*[A-Za-z_][A-Za-z0-9_.]*[[:space:]]*\)'; then
    fail "createTideCloakProxy/Middleware is called with the adapter directly: $(echo "$PROXY_FILES" | head -2 | tr '\n' ' ')" \
         "that leaves protectedRoutes EMPTY, so every request passes unverified. Call it with ONE object: createTideCloakProxy({ config: tcConfig, protectedRoutes: { '/admin/*': ['admin'] } })"
  elif echo "$PROXY_FILES" | xargs grep -q 'protectedRoutes' 2>/dev/null; then
    pass "the proxy/middleware declares protectedRoutes"
  else
    fail "the proxy/middleware declares no protectedRoutes: $(echo "$PROXY_FILES" | head -2 | tr '\n' ' ')" \
         "with none, nothing is checked. Add protectedRoutes: { '/path/*': ['role'] }."
  fi
fi

HAS_API=0
for d in src/app/api app/api src/pages/api pages/api server api; do [ -d "$d" ] && HAS_API=1; done
if [ "$HAS_API" -eq 1 ]; then
  if src_grep -q 'verifyTideCloakToken|jwtVerify|verifyTideJWT'; then
    pass "server code verifies tokens"
  else
    fail "the app has API routes but nothing verifies a token on the server" \
         "a UI check is not authorization. Verify the JWT (and the DPoP proof) in every protected handler — playbook verify-jwt-server-side."
  fi
  if uses_dpop && ! src_grep -q 'verifyDpop|verifyDPoP|cnf'; then
    warn "DPoP is on, but no server code checks the proof or cnf.jkt" \
         "without it a stolen token replays as a plain Bearer. Use the pack's verifier, templates/dpop-verify/verifyDpop.ts (AP-43)."
  fi
fi
if src_grep -q 'createRemoteJWKSet'; then
  fail "createRemoteJWKSet is used: $(src_grep -l 'createRemoteJWKSet' | head -2 | tr '\n' ' ')" \
       "verify against the key EMBEDDED in the adapter (createLocalJWKSet(config.jwk)), never one fetched at runtime (I-04)."
fi
BEARER_ONLY="$(src_grep -l "startsWith\\(['\"]Bearer " | while read -r f; do grep -q 'DPoP' "$f" || echo "$f"; done)"
if [ -n "$BEARER_ONLY" ]; then
  warn "these files accept only 'Bearer': $(echo "$BEARER_ONLY" | head -3 | tr '\n' ' ')" \
       "with DPoP on, secureFetch sends 'Authorization: DPoP <token>'. Accept both schemes: /^(Bearer|DPoP) /i"
fi
[ "$HAS_API" -eq 0 ] && [ -z "$PROXY_FILES" ] && note "no API routes or proxy found — nothing to check here"

# --- 5. Secrets --------------------------------------------------------------------------------
echo ""
echo "Secrets"
if [ -f .env ]; then
  IGNORED=0
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git check-ignore -q .env 2>/dev/null && IGNORED=1
  elif [ -f .gitignore ] && grep -qE '^\.env([[:space:]]|$)' .gitignore; then
    IGNORED=1
  fi
  if [ "$IGNORED" -eq 1 ]; then pass ".env is gitignored"
  elif [ "$FIX" -eq 1 ] && printf '\n# Secrets never belong in the repo (AP-41)\n.env\n' >> .gitignore; then
    fixed ".env was not gitignored. Added '.env' to .gitignore."
    if git rev-parse --is-inside-work-tree >/dev/null 2>&1 && git ls-files --error-unmatch .env >/dev/null 2>&1; then
      fail ".env is ALREADY TRACKED by git, so ignoring it is not enough" \
           "untrack it (git rm --cached .env) and treat any secret in it as exposed: change the password."
    fi
  else fail ".env exists and is NOT gitignored" "add a line '.env' to .gitignore before anything is committed (AP-41)."; fi
else
  note "no .env file"
fi
LEAKS="$(grep -rIEn '(KC_BOOTSTRAP_ADMIN_PASSWORD|KC_ADMIN_PASSWORD|KEYCLOAK_ADMIN_PASSWORD)[[:space:]]*=[[:space:]]*[^$"'"'"'[:space:]{]' \
  --include='*.sh' --include='*.yml' --include='*.yaml' --include='*.json' --include='*.ts' --include='*.js' --include='Dockerfile*' \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=.tide-pack . 2>/dev/null | head -3)"
if [ -n "$LEAKS" ]; then
  fail "a master-admin password is written into a file: $(echo "$LEAKS" | cut -d: -f1,2 | tr '\n' ' ')" \
       "it belongs in .env (gitignored); the script must read it from the environment and fail when it is unset (AP-41)."
else
  pass "no master-admin password written into a script or config"
fi

# --- 6. The running app (--url) ----------------------------------------------------------------
if [ -n "$URL" ]; then
  echo ""
  echo "Running app — $URL"
  if ! command -v curl >/dev/null 2>&1; then
    warn "curl is not installed" "install curl to use --url."
  else
    hex() { printf '%s' "$1" | od -An -tx1 | tr -d ' \n'; }
    ISS_HEX="6161"; AUD_HEX="6262"
    if [ -n "$ADAPTER" ] && command -v jq >/dev/null 2>&1; then
      A_URL="$(jq -r '."auth-server-url" // empty' "$ADAPTER" | sed 's:/*$::')"
      A_REALM="$(jq -r '.realm // empty' "$ADAPTER")"
      A_RES="$(jq -r '.resource // empty' "$ADAPTER")"
      if [ -n "$A_URL" ] && [ -n "$A_REALM" ] && [ -n "$A_RES" ]; then
        ISS_HEX="$(hex "$A_URL/realms/$A_REALM")"; AUD_HEX="$(hex "$A_RES")"
      fi
    fi
    RELAY="${URL%/}/tide_dpop/iss/$ISS_HEX/aud/$AUD_HEX/tide_dpop_auth.html"
    BODY="$(mktemp)"; HDRS="$(mktemp)"
    CODE="$(curl -sS -m 15 -o "$BODY" -D "$HDRS" -w '%{http_code}' "$RELAY" 2>/dev/null || echo 000)"
    if [ "$CODE" = "200" ]; then
      pass "the relay URL answers 200"
      GOT="$(sha256 "$BODY")"
      if [ "$GOT" = "$GOOD_DPOP_SHA" ]; then pass "the served page is byte-exact"
      else fail "the served page is not the known-good bytes (sha256 $GOT)" \
                "something is rewriting or replacing it. Serve public/tide_dpop_auth.html unmodified."; fi
      if grep -qi '^allow-csp-from:' "$HDRS"; then pass "Allow-CSP-From is sent"
      else fail "Allow-CSP-From is NOT sent on the relay URL" \
                "the enclave's frame is refused without it. In Next.js the /tide_dpop/:path* header rule must come after any catch-all."; fi
      CSP="$(grep -i '^content-security-policy:' "$HDRS" | tail -1)"
      if echo "$CSP" | grep -qi 'script-src'; then pass "the relay URL sends its own script-src policy"
      else fail "the relay URL does not send a script-src policy (got: ${CSP:-none})" \
                "a generic rule is overriding the relay's CSP. Put the /tide_dpop/:path* header rule LAST."; fi
      if echo "$CSP" | grep -qi 'frame-ancestors'; then
        fail "the relay URL sends frame-ancestors" "remove it; the enclave must be able to frame this page (AP-71)."
      fi
    elif [ "$CODE" = "000" ]; then
      fail "could not reach $URL" "start the app (npm run dev) and re-run with --url."
    else
      fail "the relay URL answers $CODE: $RELAY" \
           "404: the rewrite is missing or uses the exact path /tide_dpop. 403: an issuer/client check rejected it — the adapter and the route disagree. 400: malformed hex."
    fi
    rm -f "$BODY" "$HDRS"
  fi
fi

# --- 7. The realm (--realm) --------------------------------------------------------------------
if [ -n "$REALM" ]; then
  echo ""
  echo "Realm — $REALM"
  [ -f .env ] && { set -a; . ./.env 2>/dev/null; set +a; }
  TC="${TIDECLOAK_URL:-http://localhost:8080}"
  PW="${KC_BOOTSTRAP_ADMIN_PASSWORD:-${KC_ADMIN_PASSWORD:-}}"
  USERNAME="${KC_BOOTSTRAP_ADMIN_USERNAME:-admin}"
  if ! command -v curl >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1; then
    warn "curl and jq are needed for --realm" "install both."
  elif [ -z "$PW" ]; then
    warn "KC_BOOTSTRAP_ADMIN_PASSWORD is not set, so the realm cannot be read" "set it in .env (never on the command line)."
  else
    TOKEN="$(curl -sS -m 15 -X POST "$TC/realms/master/protocol/openid-connect/token" \
      -d 'grant_type=password&client_id=admin-cli' \
      --data-urlencode "username=$USERNAME" --data-urlencode "password=$PW" 2>/dev/null | jq -r '.access_token // empty' 2>/dev/null)"
    if [ -z "$TOKEN" ]; then
      fail "could not get an admin token from $TC" "check TIDECLOAK_URL and the admin password; is TideCloak running?"
    else
      REP="$(curl -sS -m 15 "$TC/admin/realms/$REALM" -H "Authorization: Bearer $TOKEN" 2>/dev/null)"
      if [ "$(echo "$REP" | jq -r '.realm // empty' 2>/dev/null)" != "$REALM" ]; then
        fail "realm '$REALM' not found on $TC" "check the realm name, or run the bootstrap."
      else
        pass "realm exists"
        IGA="$(echo "$REP" | jq -r '.attributes.isIGAEnabled // "false"' | tr '[:upper:]' '[:lower:]')"
        if [ "$IGA" = "true" ]; then pass "IGA (governance) is enabled"
        else warn "IGA is not enabled" "enable it ONCE with POST /tide-admin/toggle-iga. Do not call it again afterwards: it is a flip."; fi
        ATT="$(echo "$REP" | jq -r '.attributes."iga.attestor" // empty')"
        [ "$IGA" = "true" ] && { [ "$ATT" = "tide" ] && pass "governance is in Tide mode (iga.attestor=tide)" \
          || warn "iga.attestor is '${ATT:-unset}', not 'tide'" "the realm is in Tideless governance: approvals are not threshold-signed."; }
        # A master-admin token lives about 60 seconds; mint a fresh one for the second call.
        PENDING="$(curl -sS -m 15 "$TC/admin/realms/$REALM/iga/change-requests?status=PENDING" -H "Authorization: Bearer $TOKEN" 2>/dev/null)"
        if echo "$PENDING" | jq -e 'type=="array"' >/dev/null 2>&1; then
          N="$(echo "$PENDING" | jq 'length')"
          DANGER="$(echo "$PENDING" | jq -r '[.[] | select(.actionType | IN("DISABLE_IGA","DELETE_REALM","OFFBOARD_REALM")) | .actionType] | unique | join(", ")')"
          if [ -n "$DANGER" ]; then
            fail "a destructive change request is PENDING: $DANGER" \
                 "do NOT run a drain loop: it would approve this. Deny it unless it is intended (POST /iga/change-requests/{id}/deny). A second toggle-iga call is the usual cause of DISABLE_IGA."
          elif [ "$N" -gt 0 ]; then
            warn "$N change request(s) are still PENDING" "they are not applied yet. Approve them (POST /iga/change-requests/{id}/approve) or deny them."
          else
            pass "no pending change requests"
          fi
        else
          note "could not list change requests (IGA off, or the token expired)"
        fi
      fi
    fi
  fi
fi

# ---------------------------------------------------------------------------------------------
# Deploying a custom Forseti contract is not self-service. A contract decides what the network will
# sign; putting one into service is experimental, test-network only, and done by the Tide team.
# Writing one is fine. Not something to repair: it is a decision, so it is reported.
# (The patterns are split so that this detector is not itself mistaken for the material.)
CONTRACT_FILES="$(grep -rlE --include='*.cs' 'IAccess''Policy' . \
  --exclude-dir=node_modules --exclude-dir=bin --exclude-dir=obj --exclude-dir=.git --exclude-dir=.tide-pack 2>/dev/null | head -3 | tr '\n' ' ')"
CONTRACT_CALLS="$(grep -rlE --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.sh' --include='*.py' 'iga/forseti-''contracts' . \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist --exclude-dir=.git --exclude-dir=.tide-pack 2>/dev/null | head -3 | tr '\n' ' ')"
if [ -n "$CONTRACT_FILES" ]; then
  warn "this app contains a custom Forseti contract: $CONTRACT_FILES" \
       "writing it is fine. Deploying it is done by the Tide team (info@tide.org, or Discord: https://discord.gg/XBMd9ny2q5), on test networks only: send it to them, do not upload it yourself."
fi
if [ -n "$CONTRACT_CALLS" ]; then
  warn "this app uploads a Forseti contract to the realm: $CONTRACT_CALLS" \
       "contract deployment is not self-service. Remove the upload and ask the Tide team (info@tide.org, or Discord: https://discord.gg/XBMd9ny2q5) to deploy the contract."
fi

# ---------------------------------------------------------------------------------------------
echo ""
echo "  $PASSES passed, $FIXES fixed, $WARNS warning(s), $FAILS failure(s)"
if [ "$FAILS" -gt 0 ]; then
  echo "  RESULT: $FAILS thing(s) left that need a decision. Apply each 'fix:' above, then re-run."
  echo "          (For the agent running this: do it yourself. Go back to the user only for what only"
  echo "           they can answer — which routes need which roles, their licence email, the terms.)"
  exit 1
fi
[ "$FIXES" -gt 0 ] && echo "  Repaired $FIXES thing(s) automatically. Restart the dev server so it picks them up."
[ -z "$URL" ] && echo "  Next: start the app and re-run with --url http://localhost:3000 to check what is actually served."
echo "  RESULT: OK"
exit 0
