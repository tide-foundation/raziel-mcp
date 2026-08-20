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
  echo "==> self-test: compiling the reference contracts against Stubs.cs (both ctx.Data typings)"
  st_failed=0
  for ref in "$HERE"/reference/*.cs; do
    [[ "$(basename "$ref")" == "MustFail.cs" ]] && continue
    for typing in bytes rom; do
      if dotnet build "$HERE/check.csproj" -p:ContractPath="$ref" -p:DataTyping="$typing" --nologo -v quiet >/dev/null 2>&1; then
        echo "    OK   $(basename "$ref") [$typing]"
      else
        echo "    FAIL $(basename "$ref") [$typing] — the STUBS are wrong, not the reference. Do not edit the reference." >&2
        dotnet build "$HERE/check.csproj" -p:ContractPath="$ref" -p:DataTyping="$typing" --nologo -v quiet 2>&1 | grep -E "error CS" | head -5 >&2
        st_failed=1
      fi
    done
  done
  # The other half: fixtures that MUST NOT compile — ONE error each.
  #
  # Positive references cannot detect an over-permissive stub, and here they cannot even detect the
  # TYPING: every vendored reference is written in the ReadOnlyMemory style, which compiles under
  # BOTH candidates (byte[] converts implicitly to ReadOnlyMemory<byte>; the reverse does not). That
  # asymmetry is exactly why the 2026-08-11 stub revision pinned the wrong type. A SINGLE must-fail
  # file with several errors is no better: it keeps failing whichever protection you lose, so it
  # reports nothing. One discriminator per file is what makes drift visible.
  #
  # A fixture tagged `// TYPING: rom` is only a discriminator under the ReadOnlyMemory candidate —
  # under byte[], indexing and foreach are legal C# and compiling is correct, not drift.
  for neg in "$HERE"/reference/mustfail/*.cs; do
    typings="bytes rom"
    grep -q '^// TYPING: rom' "$neg" && typings="rom"
    for typing in $typings; do
      if dotnet build "$HERE/check.csproj" -p:ContractPath="$neg" -p:DataTyping="$typing" --nologo -v quiet >/dev/null 2>&1; then
        echo "    FAIL $(basename "$neg") [$typing] COMPILED — the stubs have drifted PERMISSIVE." >&2
        sed -n 's|^// MUST NOT COMPILE — exactly ONE error: |         expected to be rejected: |p' "$neg" >&2
        echo "         A stub wider than the real SDK yields a false PASS that fails on the ORK" >&2
        echo "         after an approval is spent. Fix Stubs.cs; do not edit the fixture." >&2
        st_failed=1
      else
        echo "    OK   $(basename "$neg") [$typing] correctly rejected"
      fi
    done
  done

  [[ $st_failed -eq 0 ]] && echo "    Stubs match the reference SDK surface under both typings." || echo "    SELF-TEST FAILED." >&2
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
# `ctx.Data`'s real type is UNRESOLVED — see README "The ctx.Data question". Compile against BOTH
# candidates and require both, because only a contract that compiles either way is safe whichever
# the live ORK has. This is not belt-and-braces: the pack has already shipped the wrong single
# answer once, and it rejected a contract with real threshold signatures on record.
echo "==> compiling $CONTRACT against shape stubs (both ctx.Data typings)"
declare -A RESULT
for typing in bytes rom; do
  if dotnet build "$HERE/check.csproj" -p:ContractPath="$CONTRACT" -p:DataTyping="$typing" --nologo -v quiet >/dev/null 2>&1; then
    RESULT[$typing]=ok
    echo "    OK   ctx.Data as $([[ $typing == bytes ]] && echo 'byte[]' || echo 'ReadOnlyMemory<byte>')"
  else
    RESULT[$typing]=fail
    echo "    FAIL ctx.Data as $([[ $typing == bytes ]] && echo 'byte[]' || echo 'ReadOnlyMemory<byte>')" >&2
  fi
done

if [[ "${RESULT[bytes]}" == "fail" && "${RESULT[rom]}" == "fail" ]]; then
  echo "    FAIL — would surface on the ORK as VmHost.CompileFailed" >&2
  dotnet build "$HERE/check.csproj" -p:ContractPath="$CONTRACT" -p:DataTyping=bytes --nologo -v quiet 2>&1 | grep -E "error CS" | head -8 >&2
  FAILED=1
elif [[ "${RESULT[bytes]}" == "fail" || "${RESULT[rom]}" == "fail" ]]; then
  bad=$([[ "${RESULT[rom]}" == "fail" ]] && echo rom || echo bytes)
  echo "" >&2
  echo "    NOT PORTABLE — compiles under one candidate typing of ctx.Data but not the other." >&2
  echo "    The real SDK type is not settled, so this may compile locally and fail on the ORK" >&2
  echo "    after an operator approval is spent. Offending constructs:" >&2
  dotnet build "$HERE/check.csproj" -p:ContractPath="$CONTRACT" -p:DataTyping="$bad" --nologo -v quiet 2>&1 | grep -E "error CS" | head -5 >&2
  echo "" >&2
  echo "    Use the dual-compatible form, which compiles under BOTH:" >&2
  echo "        ReadOnlyMemory<byte> mem = ctx.Data;   // identity if ROM, implicit if byte[]" >&2
  echo "        ReadOnlySpan<byte>  data = mem.Span;   // .Length and indexing work as before" >&2
  echo "        if (data.Length == 0) ...              // NEVER \`ctx.Data == null\` — illegal on a struct" >&2
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
