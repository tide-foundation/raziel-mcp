// One-off: validate the HOSTED MCP endpoint end-to-end (not part of `npm test`).
// Usage: node test/remote-check.mjs [url]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.argv[2] || "https://mcp.tide.org/mcp";
const client = new Client({ name: "tide-remote-check", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(new URL(url));

try {
  await client.connect(transport);
  console.log("connected:", url);
  const tools = (await client.listTools()).tools;
  console.log("tools:", tools.length);
  const annotated = tools.filter((t) => t.annotations?.readOnlyHint === true).length;
  console.log("readOnlyHint present on:", annotated + "/" + tools.length);
  const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
  console.log("prompts:", prompts.length, "->", prompts.join(", "));
  const r = await client.callTool({ name: "tide_gaps", arguments: {} });
  const txt = r.content?.[0]?.text ?? "";
  console.log("tide_gaps ok:", !r.isError && txt.includes("GAP-065") ? "yes" : "NO");
  console.log("server version reported:", client.getServerVersion?.()?.version ?? "(unknown)");

  // The asset tools read templates/ from the server's disk. They returned "not found" on the hosted
  // server for as long as templates/ was missing from the image, and nothing here noticed.
  const GOOD = "9d7844b938f0a2565fa910d3d30e9b8797cbfd6e0b73d59d804169a089aea757";
  const failures = [];
  const text = async (name, args = {}) => {
    const res = await client.callTool({ name, arguments: args });
    return { err: res.isError === true, txt: res.content?.[0]?.text ?? "" };
  };
  for (const [name, args, must] of [
    ["tide_dpop_asset", {}, GOOD],
    ["tide_branding", { realm: "demo" }, "brand-tidecloak.sh"],
    ["tide_onboarding", {}, "WRITE THIS FILE NOW"],
    ["tide_choose_playbook", { situation: "add login to a new Next.js app" }, "Work order"],
    // Licence email + Terms & Conditions must be asked before any realm is set up (AP-90).
    ["tide_choose_playbook", { situation: "add login to a new Next.js app" }, "https://tide.org/legal"],
    ["tide_hosting", {}, "BEFORE ANY TIDE REALM IS SET UP"],
    ["tide_playbook", { name: "bootstrap-realm-from-template" }, "https://tide.org/legal"],
    ["tide_scaffold", { situation: "add login to a new Next.js app" }, ".tide-pack/templates/nextjs-customer-portal/."],
    ["tide_doctor", {}, ".tide-pack/templates/shared/tide-doctor.sh"],
  ]) {
    const { err, txt } = await text(name, args);
    const ok = !err && txt.includes(must);
    console.log(`${name} ok:`, ok ? "yes" : "NO — " + txt.slice(0, 120));
    if (!ok) failures.push(name);
  }
  const instr = client.getInstructions?.() ?? "";
  console.log("instructions length:", instr.length, instr.length <= 2000 ? "(fits)" : "(TOO LONG — clients truncate)");
  if (!instr.length || instr.length > 2000) failures.push("instructions length");

  // The file routes, exactly as the tools tell a caller to use them.
  const origin = new URL(url).origin;
  const { createHash } = await import("node:crypto");
  const page = await fetch(`${origin}/pack/templates/nextjs-customer-portal/public/tide_dpop_auth.html`);
  const sha = page.ok ? createHash("sha256").update(Buffer.from(await page.arrayBuffer())).digest("hex") : `HTTP ${page.status}`;
  console.log("GET /pack/.../tide_dpop_auth.html:", sha === GOOD ? "byte-exact" : "NO — " + sha);
  if (sha !== GOOD) failures.push("/pack file route");
  const tgz = await fetch(`${origin}/pack/templates.tgz`);
  console.log("GET /pack/templates.tgz:", tgz.ok ? `${(await tgz.arrayBuffer()).byteLength} bytes` : `NO — HTTP ${tgz.status}`);
  if (!tgz.ok) failures.push("/pack/templates.tgz");

  await client.close();
  if (failures.length) {
    console.error("REMOTE CHECK: FAIL —", failures.join(", "));
    process.exit(1);
  }
  console.log("REMOTE CHECK: PASS");
} catch (e) {
  console.error("REMOTE CHECK: FAIL —", e.message);
  process.exit(1);
}
