#!/usr/bin/env bash
# Discover the latest TideCloak version SKYCLOAK CAN ACTUALLY PROVISION.
#
# WHY THIS EXISTS
# ---------------
# The pack used to hardcode 0.14.17 in the create-cluster body. A pin does not fail — the cluster
# provisions, licensing succeeds, the app works — so nothing ever signals it went stale.
#
# ⚠️ READ THIS BEFORE "FIXING" IT TO USE DOCKER HUB
# -------------------------------------------------
# An earlier version of this script read Docker Hub tags for `tideorg/tidecloak`. That was WRONG,
# and it produced exactly the bug it was meant to fix: the newest Docker tag was rejected, the
# caller walked down the list, and clusters kept coming up on an old version.
#
# Skycloak does not look at Docker Hub. It validates the version by EXACT MATCH against its own
# hardcoded allowlist (`SupportedTideCloak` in `internal/clusters/service.go`; mismatch →
# `ErrInvalidClusterVersion` → `400 invalid cluster version`). A tag can exist on Docker Hub, be
# the newest thing published, and still be un-provisionable because Skycloak has not added it.
#
# So the authority is SKYCLOAK'S OWN ENDPOINT:
#   GET /clusters/supported-versions?type=tidecloak
#   GET /clusters/versions                      → {"keycloak":[...],"tidecloak":[...]}
# Both require the API key. (Older pack docs said "there is no versions endpoint." That was wrong,
# and reaching for Docker Hub is what that error caused.)
#
# Docker Hub is kept ONLY as a lag DIAGNOSTIC — "Skycloak's newest is N releases behind what Tide
# published" is actionable (ask Skycloak to add the version). It is never used to pick a version,
# because a Docker tag is not evidence Skycloak accepts it.
#
# TRAPS
#   1. `latest` is not a valid value. Skycloak validates `^[0-9]+\.[0-9]+(\.[0-9]+)?$`.
#   2. Sort NUMERICALLY. Lexically "0.9.8" > "0.14.20", so a naive sort picks a version below the
#      floor, which then fails as KEYGEN_FAILED — an error that reads as key generation and is
#      really licensing. Do not trust the endpoint's documented "newest to oldest" ordering either;
#      sort what you get.
#   3. Do NOT read the allowlist out of a local Skycloak checkout. A checkout is a snapshot: the one
#      on this machine says `0.11.7` while production takes `0.14.17`. Query the running service.
#      (AP-83 — a snapshot is not authoritative for a VERSION.)
#
# FLOOR: below 0.14.17 is excluded. VERIFIED — 0.13.13 ships a broken automation client (which also
# breaks Skycloak's own /clusters/{id}/realms proxy) and 0.14.11 fails setUpTideRealm with 500
# KEYGEN_FAILED. Those are not "older but fine"; they are unusable.
#
# WHAT IT RETURNS: the NEWEST version Skycloak says it can provision. Not a pin, not a Docker tag.
#
# Usage:
#   SKYCLOAK_API_KEY=... ./skycloak-latest-version.sh           # newest provisionable, e.g. 0.14.20
#   SKYCLOAK_API_KEY=... ./skycloak-latest-version.sh --check    # + report Docker Hub lag
#   SKYCLOAK_API_KEY=... ./skycloak-latest-version.sh --list     # DIAGNOSTIC ONLY (see below)
#                        ./skycloak-latest-version.sh --floor 0.14.19
#
# ⚠️ `--list` IS FOR INSPECTION, NOT FOR FALLING BACK.
# Do not loop over it retrying the create on `400 invalid cluster version`. That pattern belonged to
# the old Docker Hub implementation, where most tags genuinely were not offered. Every entry here
# came from Skycloak, so a rejection means something is inconsistent — and retrying downward turns
# that loud failure into a silent downgrade to a months-old build. Use the newest; fail if it fails.
#
# THE FLOOR NEVER SELECTS AN OLDER VERSION. It only refuses to return one: the newest eligible
# version is the newest version, whenever the newest is at or above the floor. The floor exists so
# that a catalogue topping out at a known-broken build (0.13.13 automation client, 0.14.11
# licensing) is reported instead of provisioned. Override deliberately with `--floor 0` if you must.
#
# Exit 1 if discovery fails. It does NOT fall back to a pin: a wrong-but-plausible version sends you
# debugging licensing instead of a 401.

set -uo pipefail

API="${SKYCLOAK_API:-https://api.skycloak.io}"
VER="${SKYCLOAK_API_VERSION:-2026-06-01.beta}"
KEY="${SKYCLOAK_API_KEY:-}"
FLOOR="${SKYCLOAK_VERSION_FLOOR:-0.14.17}"
REPO="${SKYCLOAK_IMAGE_REPO:-tideorg/tidecloak}"
MODE="latest"

while [ $# -gt 0 ]; do
  case "$1" in
    --list)  MODE="list";  shift ;;
    --check) MODE="check"; shift ;;
    --floor) FLOOR="$2";   shift 2 ;;
    --key)   KEY="$2";     shift 2 ;;
    -h|--help) sed -n '1,52p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

die() { echo "ERROR: $*" >&2; exit 1; }

if [ -z "$KEY" ]; then
  # Try the key the pack's mint script writes, from a few conventional spots.
  for c in ./scripts/.skycloak-api-key ./.skycloak-api-key "${HOME}/.skycloak-api-key"; do
    [ -s "$c" ] && { KEY="$(tr -d '[:space:]' < "$c")"; break; }
  done
fi
[ -n "$KEY" ] || die "no API key. Set SKYCLOAK_API_KEY or run scripts/skycloak-mint-key.sh.
  The supported-version list is NOT public, and Docker Hub is not a substitute:
  Skycloak only provisions versions on its own allowlist."

# --- Ask Skycloak what it will actually provision -----------------------------
fetch() { curl -s -m 25 -w '\n%{http_code}' "$1" -H "API-Key: $KEY" -H "API-Version: $VER"; }

raw="$(fetch "$API/clusters/supported-versions?type=tidecloak")"
code="$(printf '%s' "$raw" | tail -1)"; body="$(printf '%s' "$raw" | sed '$d')"

if [ "$code" != "200" ]; then
  raw="$(fetch "$API/clusters/versions")"
  code="$(printf '%s' "$raw" | tail -1)"; body="$(printf '%s' "$raw" | sed '$d')"
fi

case "$code" in
  200) : ;;
  401|403) die "Skycloak rejected the API key ($code). Re-mint with scripts/skycloak-mint-key.sh." ;;
  404) die "no supported-versions endpoint at $API (got 404). Ask Skycloak which versions are
  offered — do NOT substitute Docker Hub tags, they are not the same list." ;;
  *) die "could not read supported versions from Skycloak (HTTP $code): $(printf '%s' "$body" | head -c 300)" ;;
esac

# The response is either a bare array, {"tidecloak":[...]}, or {"versions":[...]}. Accept all three.
SKY_VERSIONS="$(printf '%s' "$body" | python3 -c '
import sys, json, re
try: d = json.load(sys.stdin)
except Exception: sys.exit(0)
if isinstance(d, dict):
    v = d.get("tidecloak") or d.get("versions") or d.get("supported_versions") or []
else:
    v = d
print("\n".join(x for x in v if isinstance(x, str) and re.fullmatch(r"\d+\.\d+(\.\d+)?", x)))
')"
[ -n "$SKY_VERSIONS" ] || die "Skycloak returned no usable tidecloak versions.
  Raw response: $(printf '%s' "$body" | head -c 300)
  If this listed only keycloak versions, TideCloak is probably not enabled for this workspace."

# Sort numerically and apply the floor in one pass. Emits "<newest-any>" then the eligible list.
PICKED="$(FLOOR="$FLOOR" printf '%s\n' "$SKY_VERSIONS" | FLOOR="$FLOOR" python3 -c '
import sys, os
def key(v):
    p = [int(x) for x in v.split(".")]
    return tuple(p + [0] * (3 - len(p)))
floor = key(os.environ["FLOOR"])
vs = sorted({l.strip() for l in sys.stdin if l.strip()}, key=key, reverse=True)
print(vs[0] if vs else "")                       # line 1: newest offered at all
print("\n".join(v for v in vs if key(v) >= floor))   # rest: eligible, newest first
')"
NEWEST_ANY="$(printf '%s\n' "$PICKED" | head -1)"
ELIGIBLE="$(printf '%s\n' "$PICKED" | tail -n +2 | sed '/^$/d')"

[ -n "$ELIGIBLE" ] || die "Skycloak offers no TideCloak version at or above the $FLOOR floor
  (newest it offers: ${NEWEST_ANY:-none}). Versions below the floor provision fine and then fail —
  0.13.13 on the automation client, 0.14.11 at licensing. Ask Skycloak to add a newer version
  rather than lowering the floor."

NEWEST="$(printf '%s\n' "$ELIGIBLE" | head -1)"

# --- Optional: is Skycloak's catalogue behind what Tide published? -------------
if [ "$MODE" = "check" ]; then
  HUB="$(for p in 1 2; do curl -sf -m 20 "https://hub.docker.com/v2/repositories/$REPO/tags?page_size=100&page=$p" \
          | python3 -c 'import sys,json,re; d=json.load(sys.stdin); print("\n".join(t["name"] for t in d.get("results",[]) if re.fullmatch(r"\d+\.\d+\.\d+", t["name"])))' 2>/dev/null; done \
        | python3 -c 'import sys; k=lambda v:[int(x) for x in v.split(".")]; vs=sorted({l.strip() for l in sys.stdin if l.strip()},key=k,reverse=True); print(vs[0] if vs else "")')"
  echo "skycloak-offers: $NEWEST" >&2
  echo "tide-published:  ${HUB:-unknown}" >&2
  if [ -n "$HUB" ] && [ "$HUB" != "$NEWEST" ]; then
    echo "NOTE: Skycloak's catalogue is behind Docker Hub ($NEWEST vs $HUB)." >&2
    echo "      This is NOT fixable from the client — Skycloak validates against its own allowlist," >&2
    echo "      so $HUB would return 400 invalid cluster version. Ask Skycloak to add it." >&2
  fi
fi

case "$MODE" in
  list) printf '%s\n' "$ELIGIBLE" ;;
  *)    printf '%s\n' "$NEWEST" ;;
esac
