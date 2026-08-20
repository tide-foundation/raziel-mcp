// release-verify.mjs — post-release rollout verification (NOT part of `npm test`).
//
// Confirms every PUBLISHED surface of a Tide/Raziel release is live and at the
// SAME version. Run it after publishing to catch the classic "npm went out but
// the hosted server / registry / marketplace is still behind" drift.
//
// Usage:
//   node test/release-verify.mjs            # target = repo root package.json version
//   node test/release-verify.mjs 1.9.3      # explicit target
//   npm run verify:release -- 1.9.3
//
// Exit 0 = all green (SHIP); exit 1 = something drifted (BLOCK).

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// --- config: the product's published coordinates. Update here if they change.
const CFG = {
  npmPackage: "@tideorg/mcp",
  mcpName: "io.github.tide-foundation/raziel",
  registrySearch: "https://registry.modelcontextprotocol.io/v0/servers?search=raziel",
  hostedMcp: "https://mcp.tide.org/mcp",
  hostedHealth: "https://mcp.tide.org/health",
  vscodeExtId: "Tide.tide-agent-pack",
  expectedTools: 20,
  minPrompts: 5,
};

const repoRoot = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]$/, "");
const TARGET =
  process.argv[2] ||
  JSON.parse(readFileSync(new URL("../../package.json", import.meta.url))).version;

const results = [];
const record = (surface, ok, detail) => results.push({ surface, ok, detail });
const sh = (cmd) =>
  execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
async function getJson(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// --- 1. npm: latest version == target, and mcpName is present ---------------
async function checkNpm() {
  try {
    const ver = sh(`npm view ${CFG.npmPackage} version`);
    let mcpName = "";
    try { mcpName = sh(`npm view ${CFG.npmPackage} mcpName`); } catch {}
    const okVer = ver === TARGET;
    const okName = mcpName === CFG.mcpName;
    record("npm", okVer && okName,
      `version=${ver}${okVer ? "" : ` (want ${TARGET})`}; mcpName=${mcpName || "(missing)"}`);
  } catch (e) { record("npm", false, `error: ${e.message}`); }
}

// --- 2. MCP Registry: an entry for our name is published at target ----------
async function checkRegistry() {
  try {
    const data = await getJson(CFG.registrySearch);
    const list = data.servers || data.data || (Array.isArray(data) ? data : []);
    const nameOf = (s) => s.name ?? s.server?.name;
    const verOf = (s) => s.version ?? s.server?.version ?? s.server?.version_detail?.version;
    const mine = list.filter((s) => nameOf(s) === CFG.mcpName);
    if (!mine.length) return record("MCP Registry", false, `no server named ${CFG.mcpName}`);
    const versions = [...new Set(mine.map(verOf).filter(Boolean))];
    record("MCP Registry", versions.includes(TARGET),
      `versions=[${versions.join(", ")}]${versions.includes(TARGET) ? "" : ` (want ${TARGET})`}`);
  } catch (e) { record("MCP Registry", false, `error: ${e.message}`); }
}

// --- 3. hosted mcp.tide.org: healthy, right version, tools/annotations/prompts
async function checkHosted() {
  let healthOk = false;
  try { healthOk = (await fetch(CFG.hostedHealth)).ok; } catch {}
  const client = new Client({ name: "tide-release-verify", version: "1.0.0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(CFG.hostedMcp)));
    const ver = client.getServerVersion?.()?.version ?? "(unknown)";
    const tools = (await client.listTools()).tools;
    const annotated = tools.filter((t) => t.annotations?.readOnlyHint === true).length;
    const prompts = (await client.listPrompts()).prompts;
    await client.close();
    const ok =
      healthOk && ver === TARGET &&
      tools.length === CFG.expectedTools && annotated === tools.length &&
      prompts.length >= CFG.minPrompts;
    record("mcp.tide.org", ok,
      `health=${healthOk ? "200" : "DOWN"}; version=${ver}${ver === TARGET ? "" : ` (want ${TARGET})`}; ` +
      `tools=${tools.length}/${CFG.expectedTools} (${annotated} readOnly); prompts=${prompts.length}`);
  } catch (e) {
    record("mcp.tide.org", false, `health=${healthOk ? "200" : "DOWN"}; mcp error: ${e.message}`);
  }
}

// --- 4. VSCode Marketplace: latest published version == target --------------
async function checkMarketplace() {
  try {
    const data = await getJson(
      "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json;api-version=3.0-preview.1",
        },
        body: JSON.stringify({
          filters: [{ criteria: [{ filterType: 7, value: CFG.vscodeExtId }] }],
          flags: 914,
        }),
      }
    );
    const ver = data.results?.[0]?.extensions?.[0]?.versions?.[0]?.version;
    if (!ver) return record("VSCode Marketplace", false, `extension ${CFG.vscodeExtId} not found`);
    record("VSCode Marketplace", ver === TARGET,
      `latest=${ver}${ver === TARGET ? "" : ` (want ${TARGET})`}`);
  } catch (e) { record("VSCode Marketplace", false, `error: ${e.message}`); }
}

// --- 5. local git: HEAD is pushed (best-effort; never blocks) ---------------
function checkGit() {
  try {
    const ahead = sh(`git -C "${repoRoot}" rev-list --count "@{u}..HEAD"`);
    record("git (pushed)", ahead === "0",
      ahead === "0" ? "in sync with upstream" : `${ahead} unpushed commit(s)`);
  } catch (e) { record("git (pushed)", true, `skipped (${e.message.split("\n")[0]})`); }
}

// --- run --------------------------------------------------------------------
console.log(`\nRelease verification — ${CFG.npmPackage} @ ${TARGET}\n`);
await checkNpm();
await checkRegistry();
await checkHosted();
await checkMarketplace();
checkGit();

const pad = Math.max(...results.map((r) => r.surface.length));
for (const r of results)
  console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.surface.padEnd(pad)}  ${r.detail}`);

const failed = results.filter((r) => !r.ok);
console.log("");
if (failed.length) {
  console.log(`VERDICT: BLOCK — ${failed.length} surface(s) not at ${TARGET}: ${failed.map((f) => f.surface).join(", ")}`);
  process.exit(1);
}
console.log(`VERDICT: SHIP — all surfaces live at ${TARGET}.`);
