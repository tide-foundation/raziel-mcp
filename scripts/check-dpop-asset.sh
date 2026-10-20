#!/usr/bin/env bash
# Check every tide_dpop_auth.html under a tree against the known-good copy.
#
# WHY THIS EXISTS
# ---------------
# `tide_dpop_auth.html` is a security-relevant relay page distributed by COPY-PASTE into each app's
# public/. There is no version marker in the file and nothing tells an app its copy is stale. Older
# copies post to `window.parent`, which is correct in an iframe and SELF-REFERENTIAL in a popup
# (`window.parent === window`), so the DPoP popup fallback never receives `pageLoaded` and the
# enclave (served by the ORK) reports:
#
#     Popup DPoP verification failed to load
#
# The popup is legitimately BLANK (the page is script-only), and it returned HTTP 200 with a full
# body — so the symptom looks like a load failure several layers from the actual file. 10 copies were
# found on one dev machine at two different versions.
#
# Fixed copies use `window.opener || window.parent` plus a guard that refuses to post to self.
#
# Usage:
#   scripts/check-dpop-asset.sh [path ...]      # default: current directory
#
# Exit 0 = all copies known-good (or none found). Exit 1 = at least one stale/unknown copy.
#
# See: AP-62, GAP-068, canon/troubleshooting.md

set -uo pipefail

# Known-good: verified to use `targetWindow = window.opener || window.parent` with a self-post guard.
# Source of truth: sources/example-app-tidecloak-test-cases/test-app/public/tide_dpop_auth.html
# (byte-identical to sources/example-app-keylessh/client/public/tide_dpop_auth.html)
GOOD_SHA="9d7844b938f0a2565fa910d3d30e9b8797cbfd6e0b73d59d804169a089aea757"
GOOD_SIZE="9120"

# Known-stale: three bare `window.parent.postMessage` calls. Breaks the popup fallback.
STALE_SHA="e725df1231f0050117de1a95948c3da3aca2757282ffdf65821940e668d95756"

ROOTS=("${@:-.}")
FOUND=0
BAD=0

for root in "${ROOTS[@]}"; do
  while IFS= read -r f; do
    FOUND=$((FOUND + 1))
    sha="$(sha256sum "$f" | cut -d' ' -f1)"
    size="$(wc -c <"$f" | tr -d ' ')"

    if [[ "$sha" == "$GOOD_SHA" ]]; then
      echo "  OK     $f"
    elif [[ "$sha" == "$STALE_SHA" ]]; then
      echo "  STALE  $f ($size bytes) — posts to window.parent; popup DPoP will fail (AP-62)" >&2
      BAD=$((BAD + 1))
    else
      # Unknown copy: fall back to a content check, which is what actually matters.
      if grep -q 'window\.parent\.postMessage' "$f" && ! grep -q 'window\.opener' "$f"; then
        echo "  STALE  $f ($size bytes) — unknown version, posts to window.parent only (AP-62)" >&2
        BAD=$((BAD + 1))
      elif grep -q 'window\.opener' "$f"; then
        echo "  UNKNOWN(ok?) $f ($size bytes) — not the known-good hash, but uses window.opener." >&2
        echo "               Newer than this check, or locally modified. Verify deliberately." >&2
      else
        echo "  UNKNOWN $f ($size bytes) — no window.opener and no window.parent.postMessage found." >&2
        BAD=$((BAD + 1))
      fi
    fi
  done < <(find "$root" -name 'tide_dpop_auth.html' -type f -not -path '*/node_modules/*' 2>/dev/null)
done

echo
if [[ $FOUND -eq 0 ]]; then
  echo "No tide_dpop_auth.html found under: ${ROOTS[*]}"
  echo "NOTE: if the app enables DPoP (it is on by default), a MISSING relay page is worse than a"
  echo "      stale one — the popup 404s. Copy the known-good asset into public/ and serve it at"
  echo "      /tide_dpop/:path* . See templates/*/public/tide_dpop_auth.html."
  exit 0
fi

echo "Checked $FOUND copy/copies. Known-good sha256=$GOOD_SHA ($GOOD_SIZE bytes)."
if [[ $BAD -gt 0 ]]; then
  echo "FAILED: $BAD stale or unrecognised copy/copies. Replace with the known-good asset." >&2
  exit 1
fi
echo "All copies known-good."
