#!/usr/bin/env node
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";

const app = express();
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
});
