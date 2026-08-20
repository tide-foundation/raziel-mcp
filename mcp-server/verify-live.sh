#!/usr/bin/env bash
# "Am I actually running the latest pack?" — answer it, don't assume it.
#
# WHY THIS EXISTS
# ---------------
# An MCP server is a PROCESS started when your session began. Editing the source, or even rebuilding
# `dist/`, changes nothing for a session that is already connected: it keeps talking to the old
# process. The symptom is silent and confusing -- a tool you just added is "missing", and an
# instruction you just wrote is ignored -- so it reads like a broken feature rather than a stale
# process. This checks the three things that can each be independently out of date:
#
#   1. is `dist/` older than `src/`?          -> you need `npm run build`
#   2. does the BUILT server expose what you  -> the build is fine; your SESSION is stale
#      expect when spawned fresh?
#   3. is the session's tool list the same?   -> only you can see this; compare with /mcp
#
# Usage:
#   bash mcp-server/verify-live.sh
#   bash mcp-server/verify-live.sh tide_onboarding tide_branding   # require specific tools
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
WANT=("$@")
[ ${#WANT[@]} -eq 0 ] && WANT=(tide_onboarding tide_branding tide_dpop_asset)
FAIL=0

echo "==> 1. is dist/ up to date with src/?"
STALE="$(find src -name '*.ts' -newer dist/server.js 2>/dev/null | head -5)"
if [ -n "$STALE" ]; then
  echo "    STALE — newer than the build:"; printf '      %s\n' $STALE
  echo "    fix: (cd $HERE && npm run build)"
  FAIL=1
else
  echo "    OK — dist/ is current"
fi

echo "==> 2. what does the BUILT server actually expose?"
# The probe MUST live inside this package: node resolves node_modules by walking up from the
# script's own directory, so a probe in /tmp cannot find @modelcontextprotocol/sdk.
NODE_PROBE="$HERE/.verify-probe.mjs"
trap 'rm -f "$NODE_PROBE"' EXIT
cat > "$NODE_PROBE" <<'EOF'
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const dist = process.argv[2], want = process.argv.slice(3);
const t = new StdioClientTransport({ command: "node", args: [dist] });
const c = new Client({ name: "verify-live", version: "1" }, { capabilities: {} });
await c.connect(t);
const tools = (await c.listTools()).tools.map((x) => x.name);
const instr = c.getInstructions?.() ?? "";
// NOT /\b\d+.../ -- in "Pack v1.9.20" the \b never matches, because "v" and "1" are both
// word characters, so there is no boundary between them.
console.log("VERSION " + (instr.match(/v?(\d+\.\d+\.\d+)/)?.[1] ?? "?"));
console.log("TOOLCOUNT " + tools.length);
for (const w of want) console.log((tools.includes(w) ? "HAS " : "MISSING ") + w);
console.log((/ONCE A REALM IS BOOTSTRAPPED/.test(instr) ? "HAS " : "MISSING ") + "post-bootstrap-ask");
await c.close();
EOF
# The probe must run from a directory where the SDK resolves — that is this package.
OUT="$(cd "$HERE" && node "$NODE_PROBE" "$HERE/dist/index.js" "${WANT[@]}" 2>&1)"
rm -f "$NODE_PROBE"
if printf '%s' "$OUT" | grep -q TOOLCOUNT; then
  printf '%s\n' "$OUT" | sed 's/^/    /'
  printf '%s' "$OUT" | grep -q '^MISSING' && FAIL=1
else
  echo "    FAILED to start the built server:"; printf '%s\n' "$OUT" | head -5 | sed 's/^/      /'
  FAIL=1
fi

echo "==> 3. your SESSION"
echo "    The two checks above test the build on disk. Your running session connected at startup and"
echo "    will keep using the process it started then. If a tool above says HAS but your session"
echo "    cannot call it, the build is fine and the SESSION is stale:"
echo "      - reconnect the server (/mcp in Claude Code), or start a new session"
echo "    Config on this machine:"
for f in "$HOME/.claude.json" "$HERE/../.mcp.json"; do
  [ -f "$f" ] || continue
  python3 - "$f" <<'PY' 2>/dev/null
import json,sys
def walk(o):
    if isinstance(o,dict):
        for k,v in o.items():
            if k=="mcpServers" and isinstance(v,dict):
                for n,c in v.items():
                    tgt=" ".join(c.get("args",[])) or c.get("url","")
                    print(f"      {n} -> {tgt}")
            else: walk(v)
    elif isinstance(o,list):
        for v in o: walk(v)
walk(json.load(open(sys.argv[1])))
PY
done

echo
[ $FAIL -eq 0 ] && echo "RESULT: the build is current and exposes everything expected." \
               || echo "RESULT: something is out of date — see above." >&2
exit $FAIL
