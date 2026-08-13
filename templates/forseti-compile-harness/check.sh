#!/usr/bin/env bash
# Forseti pre-flight: compile a contract locally + scan for sandbox violations.
#
# Contracts are compiled by the ORK at request time, so a shape error costs an enclave operator
# approval to discover. This runs in about a second.
#
# Usage:
#   ./check.sh path/to/MyContract.cs
#   ./check.sh 'src/contracts/**/*.cs'

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- self-test: prove the STUBS still match the real SDK ------------------------------
# Compiles two working, deployed reference contracts against Stubs.cs. A stub that is more
# permissive than the real SDK yields a FALSE PASS on your own contract — that is the one failure
# this harness must never have, and prose cannot prevent it. Run after editing Stubs.cs, and in CI.
if [[ "${1:-}" == "--self-test" ]]; then
  echo "==> self-test: compiling the reference contracts against Stubs.cs"
  st_failed=0
  for ref in "$HERE"/reference/*.cs; do
    [[ "$(basename "$ref")" == "MustFail.cs" ]] && continue
    if dotnet build "$HERE/check.csproj" -p:ContractPath="$ref" --nologo -v quiet >/dev/null 2>&1; then
      echo "    OK   $(basename "$ref")"
    else
      echo "    FAIL $(basename "$ref") — the STUBS are wrong, not the reference. Do not edit the reference." >&2
      dotnet build "$HERE/check.csproj" -p:ContractPath="$ref" --nologo -v quiet 2>&1 | grep -E "error CS" | head -5 >&2
      st_failed=1
    fi
  done
  # The other half: fixtures that MUST NOT compile — ONE error each.
  #
  # Positive references cannot detect an over-permissive stub. byte[] is implicitly convertible to
  # ReadOnlyMemory<byte>, so a byte[]-typed ctx.Data compiles both references happily. And a SINGLE
  # must-fail file with several errors is no better: it keeps failing whichever protection you lose,
  # so it reports nothing. One discriminator per file is what makes drift visible.
  for neg in "$HERE"/reference/mustfail/*.cs; do
    if dotnet build "$HERE/check.csproj" -p:ContractPath="$neg" --nologo -v quiet >/dev/null 2>&1; then
      echo "    FAIL $(basename "$neg") COMPILED — the stubs have drifted PERMISSIVE." >&2
      sed -n 's|^// MUST NOT COMPILE — exactly ONE error: |         expected to be rejected: |p' "$neg" >&2
      echo "         A stub wider than the real SDK yields a false PASS that fails on the ORK" >&2
      echo "         after an approval is spent. Fix Stubs.cs; do not edit the fixture." >&2
      st_failed=1
    else
      echo "    OK   $(basename "$neg") correctly rejected"
    fi
  done

  [[ $st_failed -eq 0 ]] && echo "    Stubs match the reference SDK surface." || echo "    SELF-TEST FAILED." >&2
  exit $st_failed
fi

CONTRACT="${1:-}"
if [[ -z "$CONTRACT" ]]; then
  echo "usage: $0 <path-to-contract.cs>" >&2
  echo "       $0 --self-test          # verify Stubs.cs against the vendored reference contracts" >&2
  exit 2
fi
FAILED=0

# --- 1. Compile against the stubs -------------------------------------------------
# Catches: wrong context property (ctx.Data in ValidateExecutor), typos, wrong method
# signatures, PolicyDecision.Approve(), missing interface members.
echo "==> compiling $CONTRACT against shape stubs"
if dotnet build "$HERE/check.csproj" -p:ContractPath="$CONTRACT" --nologo -v quiet; then
  echo "    OK — compiles"
else
  echo "    FAIL — would surface on the ORK as VmHost.CompileFailed" >&2
  FAILED=1
fi

# --- 2. Sandbox scan --------------------------------------------------------------
# The compiler CANNOT catch these: blocked namespaces compile fine and fail IL vetting at upload
# with BadPolicy.ForbiddenCall.
#
# This is NOT a grep. A grep matches comments, so a contract that merely documents the sandbox
# restrictions fails its own pre-flight — and the obvious workaround (delete the comment) removes
# documentation instead of fixing anything. scan-sandbox.py strips comments with a C#-aware
# scanner that respects string literals, so "http://x" cannot hide a real call after it, and
# reports comment mentions as WARN rather than FAIL.
echo "==> scanning for sandbox-blocked namespaces and non-deterministic calls"
if python3 "$HERE/scan-sandbox.py" $CONTRACT; then
  :
else
  FAILED=1
fi

# --- 3. Contract structure --------------------------------------------------------
echo "==> checking contract structure"
STRUCT_FAILED=0
if ! grep -REq 'using\s+Ork\.Forseti\.Sdk\s*;' $CONTRACT 2>/dev/null; then
  echo "    FAIL — missing 'using Ork.Forseti.Sdk;' (AP-56)" >&2
  STRUCT_FAILED=1
fi
if ! grep -REq ':\s*IAccessPolicy' $CONTRACT 2>/dev/null; then
  echo "    FAIL — no class implements IAccessPolicy (BadPolicy.EntryTypeNotFound)" >&2
  STRUCT_FAILED=1
fi
if grep -REq 'PolicyDecision\.Approve' $CONTRACT 2>/dev/null; then
  echo "    FAIL — PolicyDecision.Approve() does not exist; use PolicyDecision.Allow()" >&2
  STRUCT_FAILED=1
fi
if [[ $STRUCT_FAILED -eq 0 ]]; then
  echo "    OK — structure looks right"
else
  FAILED=1
fi

# --- 4. contractId reminder -------------------------------------------------------
if command -v sha512sum >/dev/null 2>&1 && [[ -f "$CONTRACT" ]]; then
  HASH="$(sha512sum "$CONTRACT" | cut -d' ' -f1 | tr 'a-f' 'A-F')"
  echo "==> contractId (SHA-512, UPPERCASE — the ORKs compare case-sensitively):"
  echo "    $HASH"
  echo "    NOTE: this hashes the FILE. Hash the exact bytes you submit as contract source."
fi

if [[ $FAILED -ne 0 ]]; then
  echo
  echo "PRE-FLIGHT FAILED — do not deploy. Each ORK-side failure costs an operator approval." >&2
  exit 1
fi

echo
echo "PRE-FLIGHT PASSED (compile + sandbox + structure)."
echo "Still unchecked by this harness: policy modelId, contract transport nesting, contractId"
echo "match, vuid-vs-subject. See canon/custom-contracts.md pre-flight checklist."
