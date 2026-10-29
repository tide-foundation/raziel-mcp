#!/usr/bin/env node
import * as appInsights from "applicationinsights";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, readServablePackFile, listServablePackFiles, PACK_ROOT } from "./server.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Optional usage telemetry — ONLY active when a connection string is provided
// (i.e. the hosted server). npx/self-host users get NO telemetry. We track each
// request tagged with the caller's IP so Application Insights can geo-resolve
// *where usage comes from* (it stores the geo, and masks the raw IP). We do NOT
// inspect request bodies or MCP tool arguments. See PRIVACY.md.
const AI_CONN = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
// v3 enables automatic instrumentation by default. Keep this client manual-only so telemetry
// remains limited to the request metadata described in PRIVACY.md.
const aiClient = AI_CONN ? new appInsights.TelemetryClient(AI_CONN, { useGlobalProviders: false }) : undefined;

const app = express();
app.set("trust proxy", true);

// Geo/usage telemetry middleware (no-op unless AI is configured).
if (aiClient) {
  app.use((req, res, next) => {
    const start = Date.now();
    // Behind Azure Container Apps' ingress the socket IP is Envoy, not the
    // caller — the real client IP is the first entry of X-Forwarded-For.
    const xff = String(req.headers["x-forwarded-for"] || "");
    const clientIp = xff.split(",")[0].trim() || req.socket.remoteAddress || "";
    res.on("finish", () => {
      aiClient.trackRequest({
        name: `${req.method} ${req.path}`,
        url: req.originalUrl,
        duration: Date.now() - start,
        resultCode: String(res.statusCode),
        success: res.statusCode < 400,
        time: new Date(start),
        // v3 maps this standard span attribute to the masked Application Insights location IP.
        properties: { "client.address": clientIp },
      });
    });
    next();
  });
}

app.use(express.json());

// Optional Bearer token auth
const API_TOKEN = process.env.API_TOKEN;
if (API_TOKEN) {
  app.use("/mcp", (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${API_TOKEN}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });
}

// --- Pack files -------------------------------------------------------------------------------
// A caller of the hosted server does not have the pack on disk, so every `templates/...` path a
// tool names has to be fetchable. Two routes, both read-only and unauthenticated (the content is
// the same as the public npm package):
//   GET /pack/templates.tgz    everything servable, for `curl | tar -xz`
//   GET /pack/<path>           one file, byte-exact
// The archive is built once at startup with the system `tar`. If that fails the single-file route
// still works and tools are told not to advertise the archive.
let packArchive: Buffer | null = null;
try {
  const tmp = mkdtempSync(join(tmpdir(), "tide-pack-"));
  const out = join(tmp, "templates.tgz");
  const list = join(tmp, "files.txt");
  writeFileSync(list, listServablePackFiles().join("\n") + "\n");
  execFileSync("tar", ["-czf", out, "-C", PACK_ROOT, "-T", list]);
  packArchive = readFileSync(out);
} catch (e) {
  console.warn("pack archive not built (single-file route still works):", (e as Error).message);
}

app.get("/pack/templates.tgz", (_req, res) => {
  if (!packArchive) {
    res.status(404).json({ error: "Archive unavailable. Fetch files individually from /pack/<path>." });
    return;
  }
  res.status(200).type("application/gzip").send(packArchive);
});

app.get("/pack/*path", (req, res) => {
  const parts = (req.params as { path?: string[] | string }).path;
  const rel = Array.isArray(parts) ? parts.join("/") : String(parts ?? "");
  const body = readServablePackFile(rel);
  if (!body) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  // octet-stream on purpose: these are files to save byte-exact, never pages to render from this
  // origin, and no proxy should be tempted to transform them.
  res.status(200).set({ "Content-Type": "application/octet-stream", "X-Content-Type-Options": "nosniff" }).send(body);
});

// What callers should use to reach this server. Behind Azure Container Apps the request's own
// protocol/host (trust proxy is on) is the public one; PUBLIC_BASE_URL overrides it.
const publicBaseUrl = (req: express.Request) =>
  process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;

// MCP endpoint — stateless (new server + transport per request)
app.post("/mcp", async (req, res) => {
  const server = createServer({ publicBaseUrl: publicBaseUrl(req), packArchive: packArchive !== null });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// Handle GET and DELETE for SSE streams (required by protocol)
app.get("/mcp", async (req, res) => {
  res.status(405).json({ error: "Method not allowed. Use POST for stateless MCP." });
});

app.delete("/mcp", async (req, res) => {
  res.status(405).json({ error: "Method not allowed. Stateless server — no sessions to delete." });
});

// Health check for Azure / load balancers
app.get("/health", (_, res) => {
  res.status(200).json({ status: "ok", name: "@tideorg/mcp" });
});

const port = parseInt(process.env.PORT || "3000", 10);
app.listen(port, "0.0.0.0", () => {
  console.log(`@tideorg/mcp HTTP server listening on port ${port}`);
  console.log(`MCP endpoint: http://0.0.0.0:${port}/mcp`);
  console.log(`Health check: http://0.0.0.0:${port}/health`);
  if (aiClient) console.log("Application Insights telemetry: ON (geo/usage)");
});
