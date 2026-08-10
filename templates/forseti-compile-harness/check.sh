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

CONTRACT="${1:-}"
if [[ -z "$CONTRACT" ]]; then
  echo "usage: $0 <path-to-contract.cs>" >&2
  exit 2
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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
# with BadPolicy.ForbiddenCall. A grep is crude but it is the only local check available.
echo "==> scanning for sandbox-blocked namespaces and non-deterministic calls"
BLOCKED='System\.IO|System\.Net|System\.Threading|System\.Reflection|System\.Diagnostics|System\.Console|DateTime\.Now|DateTime\.UtcNow|Guid\.NewGuid|new Random|Random\.Shared'
if grep -REn "$BLOCKED" $CONTRACT 2>/dev/null; then
  echo "    FAIL — blocked in the Forseti sandbox; fails IL vetting as BadPolicy.ForbiddenCall" >&2
  FAILED=1
else
  echo "    OK — no blocked namespaces found"
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
