#!/usr/bin/env bash
# Discover the latest TideCloak version Skycloak can provision.
#
# WHY THIS EXISTS
# ---------------
# Skycloak's create-cluster API takes a semver STRING and there is **no versions endpoint**, so the
# pack used to hardcode one (0.14.17). A hardcoded pin goes stale silently: it keeps working, so
# nobody notices they are provisioning a months-old build. This reads the real tag list instead.
#
# Source of truth: Docker Hub tags for `tideorg/tidecloak` (public, no auth).
#
# TWO TRAPS THIS HANDLES
#   1. `latest` is NOT a valid value. Skycloak validates `^[0-9]+\.[0-9]+(\.[0-9]+)?$`, so the tag
#      `latest` is rejected. It must be resolved to a concrete semver.
#   2. Tags MUST be sorted numerically, not lexically. Lexically, "0.9.8" > "0.14.20" — so a naive
#      sort picks 0.9.8, which is below the licensing floor and fails with KEYGEN_FAILED.
#
# FLOOR: versions below 0.14.17 are excluded. VERIFIED matrix — 0.13.13 has a broken automation
# client (which also breaks Skycloak's own /clusters/{id}/realms proxy) and 0.14.11 fails
# setUpTideRealm with 500 KEYGEN_FAILED. Those are not "older but fine"; they are unusable.
#
# Usage:
#   ./skycloak-latest-version.sh              # newest eligible version, e.g. 0.14.20
#   ./skycloak-latest-version.sh --list       # all eligible, newest first (for fallback)
#   ./skycloak-latest-version.sh --floor 0.14.19
#   ./skycloak-latest-version.sh --repo tideorg/tidecloak
#
# Exit 1 if discovery fails. It does NOT silently fall back to a stale pin: a wrong-but-plausible
# version is how you end up debugging licensing instead of a network error.

set -uo pipefail

REPO="${SKYCLOAK_IMAGE_REPO:-tideorg/tidecloak}"
FLOOR="${SKYCLOAK_VERSION_FLOOR:-0.14.17}"
MODE="latest"

while [ $# -gt 0 ]; do
  case "$1" in
    --list)  MODE="list"; shift ;;
    --floor) FLOOR="$2"; shift 2 ;;
    --repo)  REPO="$2"; shift 2 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

command -v python3 >/dev/null || { echo "ERROR: python3 required." >&2; exit 2; }

# Two pages covers the tag history comfortably; ordering=last_updated puts recent first, but we
# semver-sort everything we fetch rather than trusting the order.
RAW=""
for page in 1 2; do
  P="$(curl -sf -m 20 "https://hub.docker.com/v2/repositories/$REPO/tags?page_size=100&page=$page&ordering=last_updated" 2>/dev/null)" || break
  RAW="$RAW$P"$'\n'
done

if [ -z "$RAW" ]; then
  cat >&2 <<EOF
ERROR: could not read tags for '$REPO' from Docker Hub.

  Check connectivity, then retry. Do NOT guess a version: Skycloak rejects an unknown one with
  400 "invalid cluster version", and a too-old one fails later at setUpTideRealm with
  500 KEYGEN_FAILED — which looks like a key problem and is actually licensing.

  To proceed deliberately with the verified floor:
      --floor $FLOOR   and pass $FLOOR explicitly to the create-cluster call.
EOF
  exit 1
fi

printf '%s' "$RAW" | FLOOR="$FLOOR" MODE="$MODE" REPO="$REPO" python3 -c '
import sys, json, os, re

floor = os.environ["FLOOR"]; mode = os.environ["MODE"]; repo = os.environ["REPO"]
def key(v): return [int(x) for x in v.split(".")]

names = set()
for chunk in sys.stdin.read().split("\n"):
    chunk = chunk.strip()
    if not chunk:
        continue
    try:
        d = json.loads(chunk)
    except Exception:
        continue
    for t in d.get("results", []):
        n = t.get("name", "")
        # STRICT semver only. Skycloak rejects "latest", and a bare "0.14" is ambiguous.
        if re.fullmatch(r"\d+\.\d+\.\d+", n):
            names.add(n)

if not names:
    print(f"ERROR: no semver tags found for {repo}.", file=sys.stderr)
    sys.exit(1)

# Numeric sort — lexically "0.9.8" > "0.14.20", which would pick a version below the floor.
eligible = sorted((n for n in names if key(n) >= key(floor)), key=key, reverse=True)

if not eligible:
    newest = max(names, key=key)
    print(f"ERROR: no tag at or above the {floor} floor (newest found: {newest}).", file=sys.stderr)
    print("       Below the floor, setUpTideRealm fails with 500 KEYGEN_FAILED.", file=sys.stderr)
    sys.exit(1)

print("\n".join(eligible) if mode == "list" else eligible[0])
'
