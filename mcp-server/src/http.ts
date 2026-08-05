#!/usr/bin/env node
import * as appInsights from "applicationinsights";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";

// Optional usage telemetry — ONLY active when a connection string is provided
// (i.e. the hosted server). npx/self-host users get NO telemetry. We track each
// request tagged with the caller's IP so Application Insights can geo-resolve
// *where usage comes from* (it stores the geo, and masks the raw IP). We do NOT
// inspect request bodies or MCP tool arguments. See PRIVACY.md.
const AI_CONN = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
const aiClient = AI_CONN ? new appInsights.TelemetryClient(AI_CONN) : undefined;

const app = express();
app.set("trust proxy", true);

// Geo/usage telemetry middleware (no-op unless AI is configured).
if (aiClient) {
  const ipKey = aiClient.context.keys.locationIp;
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
        tagOverrides: { [ipKey]: clientIp },
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

// MCP endpoint — stateless (new server + transport per request)
app.post("/mcp", async (req, res) => {
  const server = createServer();
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
