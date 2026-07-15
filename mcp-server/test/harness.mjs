// Shared harness for the Tide MCP QA gate.
// Dependency-light: uses the MCP SDK already vendored in mcp-server/ plus node built-ins.
import { createServer } from "../dist/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// repo root = two levels up from mcp-server/test/
export const PACK_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function mkClient() {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "tide-mcp-qa", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

export async function callTool(client, name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  return { isError: r.isError === true, text: r.content?.[0]?.text ?? "" };
}

export function packRead(rel) {
  const p = join(PACK_ROOT, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}
export function packExists(rel) {
  return existsSync(join(PACK_ROOT, rel));
}
export function listDir(rel) {
  const p = join(PACK_ROOT, rel);
  return existsSync(p) ? readdirSync(p) : [];
}

// Recursively list files under an absolute dir, filtered by extension list.
export function walkFiles(absDir, exts = [".md", ".sh"]) {
  const out = [];
  if (!existsSync(absDir)) return out;
  for (const name of readdirSync(absDir)) {
    const full = join(absDir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkFiles(full, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

// Collects pass/fail results for one group of checks.
export class Checks {
  constructor(group) {
    this.group = group;
    this.results = [];
  }
  ok(name, cond, detail = "") {
    this.results.push({ group: this.group, name, pass: !!cond, detail: cond ? "" : String(detail) });
  }
}
