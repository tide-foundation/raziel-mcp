#!/usr/bin/env bash
# Compile every full contract example in the pack's own docs against Stubs.cs.
#
# WHY: the pack's simplified examples are where invented API shapes come from. A reader copies
# `ctx.Data == null` or a `.And(...)` combinator, it compiles nowhere, and they discover it as
# VmHost.CompileFailed on the ORK — after an operator approval has been spent. Prose review does not
# catch this; a compiler does.
#
# Extracts every ```csharp block containing `IAccessPolicy` from canon/, playbooks/ and
# reference-apps/, and compiles each one. Run after editing any contract example.
#
# Usage:  templates/forseti-compile-harness/check-docs.sh [pack-root]

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${1:-$(cd "$HERE/../.." && pwd)}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cp "$HERE/Stubs.cs" "$HERE/check.csproj" "$WORK/"

python3 - "$ROOT" "$WORK" <<'PY'
import re, sys, glob, os, hashlib
root, work = sys.argv[1], sys.argv[2]
pats = ["canon/*.md", "playbooks/*.md", "reference-apps/*/*.md"]
n = 0
for pat in pats:
    for f in glob.glob(os.path.join(root, pat)):
        t = open(f, encoding="utf-8").read()
        for b in re.findall(r"```csharp\n(.*?)```", t, re.S):
            if "IAccessPolicy" not in b:
                continue          # snippets, not whole contracts
            tag = hashlib.md5(b.encode()).hexdigest()[:6]
            name = f"{os.path.basename(f)[:-3]}_{tag}.cs"
            open(os.path.join(work, name), "w", encoding="utf-8").write(b)
            print(f"{name}\t{os.path.relpath(f, root)}")
            n += 1
print(f"# {n} full-contract example(s) extracted", file=sys.stderr)
PY

cd "$WORK" || exit 1
failed=0
for f in *.cs; do
  [ "$f" = "Stubs.cs" ] && continue
  if dotnet build check.csproj -p:ContractPath="$f" --nologo -v quiet >/dev/null 2>&1; then
    echo "  OK   $f"
  else
    echo "  FAIL $f" >&2
    dotnet build check.csproj -p:ContractPath="$f" --nologo -v quiet 2>&1 \
      | grep -oE "error CS[0-9]+: [^[]*" | sort -u | sed 's/^/       /' >&2
    failed=1
  fi
done

if [ $failed -ne 0 ]; then
  echo >&2
  echo "A pack example does not compile. Readers copy these — fix the doc, not the stubs," >&2
  echo "unless ./check.sh --self-test also fails (then the stubs are wrong)." >&2
  exit 1
fi
echo "All pack contract examples compile."
