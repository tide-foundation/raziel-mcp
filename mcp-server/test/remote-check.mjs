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
  await client.close();
  console.log("REMOTE CHECK: PASS");
} catch (e) {
  console.error("REMOTE CHECK: FAIL —", e.message);
  process.exit(1);
}
