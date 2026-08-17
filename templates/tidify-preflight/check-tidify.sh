#!/usr/bin/env bash
# Can this app be tidified? Scan a project for blockers BEFORE promising a migration.
#
# The headline blocker is EdDSA. Tide signs tokens with threshold Ed25519, so a Tide-enabled realm
# sets defaultSignatureAlgorithm=EdDSA and every client inherits it (MEASURED: non-Tide realms are
# RS256 with no Ed25519 key at all). A verifier that cannot do EdDSA — or is pinned to RS256 —
# rejects every token. "It uses Keycloak" does not mean it can be tidified.
#
# This reports EVIDENCE, not a verdict. It cannot see your gateway, managed authorizer, or the SaaS
# that consumes your tokens — the most common blockers. Read canon/tidify-compatibility.md.
#
# Usage:  ./check-tidify.sh [project-dir]
# Exit 0 = no in-tree blocker.  Exit 1 = at least one likely blocker.

set -uo pipefail
DIR="${1:-.}"
cd "$DIR" || { echo "no such dir: $DIR" >&2; exit 2; }

GREP() {
  grep -rnIE \
    --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build \
    --exclude-dir=.next --exclude-dir=vendor --exclude-dir=target --exclude-dir=__pycache__ \
    --exclude=*.tsbuildinfo --exclude=*-lock.json --exclude=*.lock --exclude=*.min.js \
    --exclude=*.map --exclude=*.snap \
    "$@" . 2>/dev/null
}

# --- CODE vs COMMENT ---------------------------------------------------------------------------
# WHY: a good codebase DOCUMENTS the rules it follows. music-license contains the lines
# "createRemoteJWKSet is forbidden here" and "The VVK is Ed25519 and is NOT there" — a naive grep
# flags all of them and reports a COMPLIANT app as broken. A checker that punishes a codebase for
# explaining itself trains people to ignore the checker. So comment hits are NOTES; only code counts.
#
# Deliberately simple: a line whose first non-space characters open a comment is a comment. It does
# not track block comments or string literals across lines, so a match on a continuation line that
# begins with plain text may still be reported as code. That direction is the right one to err in —
# a false NOTE hides a real finding, a false CODE hit costs the reader one glance.
COMMENT_RE='^[[:space:]]*(//|#|\*|/\*|--)'

CODE_HITS=""
COMMENT_HITS=""
classify() {
  CODE_HITS=""
  COMMENT_HITS=""
  [ -z "$1" ] && return 0
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    body=${line#*:}          # strip file:
    body=${body#*:}          # strip line number:
    if printf '%s\n' "$body" | grep -qE "$COMMENT_RE"; then
      COMMENT_HITS="${COMMENT_HITS}${line}"$'\n'
    else
      CODE_HITS="${CODE_HITS}${line}"$'\n'
    fi
  done <<< "$1"
  return 0
}

blockers=0
notes=0
hdr() { printf '\n%s\n' "== $1"; }

# Never print an untruncated match: a generated file can be a single 148 KB line, and a scanner
# that dumps it is unusable. Truncate every reported line to something a human can read.
CLIP() { cut -c1-160; }

hdr "1. JWT verifier — does it support EdDSA at all?"
if GREP -l '"jsonwebtoken"' --include=package.json >/dev/null 2>&1; then
  echo "  BLOCKER  jsonwebtoken is a dependency. Its algorithm allowlist is HS*/RS*/ES*/PS* with NO"
  echo "           EdDSA support, so it cannot verify a TideCloak token. Swap to 'jose'"
  echo "           (createLocalJWKSet + the adapter jwk), which is EdDSA-capable."
  blockers=$((blockers+1))
fi
if GREP -l '"jwks-rsa"' --include=package.json >/dev/null 2>&1; then
  echo "  BLOCKER  jwks-rsa fetches keys from a REMOTE JWKS and pairs with RS256. Tide requires the"
  echo "           EMBEDDED adapter jwk (I-04/AP-01) — the realm's OIDC JWKS also serves an RSA key,"
  echo "           so pointing there can return the WRONG key with a 200."
  blockers=$((blockers+1))
fi
if GREP -l 'Microsoft\.IdentityModel|AddJwtBearer' --include=*.cs --include=*.csproj >/dev/null 2>&1; then
  echo "  NOTE     .NET detected. Stock Microsoft.IdentityModel.Tokens does NOT ship EdDSA (T-23)."
  echo "           Wire Tide.Asgard.Core's provider:"
  echo "             IssuerSigningKey = Utils.GetEd25519IssuerKey(builder.Configuration)"
  echo "           Also: the asgard .NET SDK does not work against IGA-enabled realms today."
  notes=$((notes+1))
fi
if GREP -l '"jose"' --include=package.json >/dev/null 2>&1; then
  echo "  OK       jose is a dependency — EdDSA-capable, and the path the pack prescribes."
fi

hdr "2. Algorithm pins that would REJECT a valid EdDSA token"
RS_PIN='algorithms?.{0,6}[:=].{0,6}[[]?.{0,3}(RS|PS|HS|ES)(256|384|512)|ValidAlgorithms.{0,40}RS256|"?alg"?.{0,4}[:=].{0,4}"?RS256'
classify "$(GREP "$RS_PIN" | head -20)"
if [ -n "$CODE_HITS" ]; then
  printf '%s' "$CODE_HITS" | head -10 | CLIP | sed 's/^/  PIN      /'
  echo "           Repin to EdDSA. Do NOT remove the pin — an unpinned verifier accepts whatever"
  echo "           algorithm the token claims (SG-13)."
  blockers=$((blockers+1))
else
  echo "  no RS256 pin in code (gateways and managed authorizers still need checking — section 5)"
fi
[ -n "$COMMENT_HITS" ] && printf '%s' "$COMMENT_HITS" | head -3 | CLIP | sed 's/^/  note     in a comment: /'

hdr "3. Remote JWKS usage (must become the embedded adapter jwk)"
classify "$(GREP 'createRemoteJWKSet|jwks_uri|/protocol/openid-connect/certs' | head -20)"
if [ -n "$CODE_HITS" ]; then
  printf '%s' "$CODE_HITS" | head -10 | CLIP | sed 's/^/  CHANGE   /'
  echo "           Use createLocalJWKSet(config.jwk) from data/tidecloak.json (I-04, AP-01)."
  blockers=$((blockers+1))
else
  echo "  no remote-JWKS call in code"
fi
[ -n "$COMMENT_HITS" ] && printf '%s' "$COMMENT_HITS" | head -3 | CLIP | sed 's/^/  note     documented, not used: /'

hdr "4. Surfaces that CANNOT be tidified (no headless Tide identity)"
found_headless=0
for pat in 'client_credentials' 'serviceAccount|service_account' \
             'node-cron|cron\.schedule|CronJob|BullMQ|new Queue\(|celery|sidekiq'; do
  classify "$(GREP "$pat" | head -12)"
  if [ -n "$CODE_HITS" ]; then
    printf '%s' "$CODE_HITS" | head -3 | CLIP | sed 's/^/  EXCLUDE  /'
    found_headless=1
  fi
done
if [ $found_headless -eq 1 ]; then
  echo "           PRISM needs the browser enclave; ORK signing is browser-only (GAP-063/064)."
  echo "           These surfaces keep their current auth. Name them EXCLUDED — a partial migration"
  echo "           is fine; presenting it as complete is not."
  notes=$((notes+1))
else
  echo "  no machine-to-machine indicators in code"
fi

hdr "5. What this script CANNOT see"
cat <<'EOF'
  Anything outside the repo that validates the JWT — the most likely blocker, and the least visible:
    - API gateways / ingress JWT filters / managed serverless authorizers
    - reverse proxies terminating auth
    - SaaS products accepting OIDC but pinning RS256
    - anything consuming TideCloak as an upstream OIDC provider
  The pack asserts nothing about specific products: support is version- and edition-dependent, and a
  wrong claim is worse than none. TEST the real deployment with a real EdDSA token.
EOF

hdr "Result"
if [ "$blockers" -gt 0 ]; then
  echo "  $blockers likely blocker(s), $notes note(s)."
  echo "  Do NOT promise a drop-in migration. Classify FULLY / PARTIALLY / NOT TIDIFIABLE and say why."
  echo "  See canon/tidify-compatibility.md."
  exit 1
fi
echo "  No in-tree blocker found ($notes note(s))."
echo "  This is NOT a clearance: sections 4 and 5 need a human. Verify end to end with a real EdDSA token."
exit 0
