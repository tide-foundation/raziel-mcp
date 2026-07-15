# Raziel

[![MCP QA Gate](https://github.com/tide-foundation/raziel-mcp/actions/workflows/qa-gate.yml/badge.svg)](https://github.com/tide-foundation/raziel-mcp/actions/workflows/qa-gate.yml)

**Raziel is the Tide MCP** — it gives AI coding agents the knowledge to implement [TideCloak](https://tidecloak.com) correctly.

This MCP server gives your AI assistant deep knowledge of Tide authentication, threshold cryptography, end-to-end encryption, IGA governance, and Forseti smart contracts — plus a **security gap analysis** of your existing system and **self-host vs managed-hosting** guidance. Instead of guessing, your AI follows verified playbooks.

## Quick Start

### Claude Code (CLI or VS Code extension)

Run this one command:

```bash
claude mcp add tide-pack -- npx -y @tideorg/mcp
```

Done. Start a conversation and ask your agent to add Tide auth to your app.

### Project-level config (any MCP client)

Add a `.mcp.json` file to your project root:

```json
{
  "mcpServers": {
    "tide-pack": {
      "command": "npx",
      "args": ["-y", "@tideorg/mcp"]
    }
  }
}
```

Works with: Claude Code, Cursor, Windsurf, Cline, and any MCP-compatible tool.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "tide-pack": {
      "command": "npx",
      "args": ["-y", "@tideorg/mcp"]
    }
  }
}
```

### Cursor

Open Settings > MCP Servers > Add Server:
- Name: `tide-pack`
- Command: `npx`
- Args: `-y @tideorg/mcp`

Or add to `.cursor/mcp.json` in your project root.

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "tide": {
      "url": "https://mcp.tide.org/mcp"
    }
  }
}
```

Or for local: `"command": "npx", "args": ["-y", "@tideorg/mcp"]`

### Zed

Add to your Zed settings (`~/.config/zed/settings.json`):

```json
{
  "context_servers": {
    "tide": {
      "command": {
        "path": "npx",
        "args": ["-y", "@tideorg/mcp"]
      }
    }
  }
}
```

Note: Zed uses `context_servers` (not `mcpServers`) and doesn't yet support remote URL-based MCP servers — use the npx command.

### OpenAI Codex CLI

Add to `~/.codex/config.json`:

```json
{
  "mcpServers": {
    "tide": {
      "command": "npx",
      "args": ["-y", "@tideorg/mcp"]
    }
  }
}
```

Note: Codex CLI currently supports stdio-based MCP servers only — use the npx command.

## What your AI can do with this

Once connected, your AI assistant can:

- **Analyze your existing system** for security gaps and map each one to what Tide fixes (with an honest "what Tide does NOT fix" list)
- **Add Tide auth** to a new or existing Next.js/React app
- **Protect API routes** with server-side JWT + DPoP verification
- **Set up role-based access** with Tide's IGA governance
- **Deploy Forseti smart contracts** for policy-governed encryption and signing
- **Bootstrap TideCloak** — self-hosted (Docker) or partner-hosted (Skycloak) — to a fully configured realm
- **Diagnose issues** like broken login, missing roles, CORS errors
- **Follow security invariants** that prevent common auth mistakes

## Try it

After setup, try these prompts in your AI coding tool:

> Do a security analysis of my app and show what Tide would change

> Add Tide authentication to my Next.js app

> I have an existing app with auth — help me migrate to Tide

> Set up encrypted data sharing between users with Tide

> Help me create a Forseti contract for multi-admin approval

## What's inside

| Category | Count | Examples |
|----------|-------|---------|
| Canon doctrine | 15 files | Security invariants, anti-patterns, security gap mapping, IGA change-request API, hosting options, framework matrix, troubleshooting |
| Playbooks | 18 step-by-step guides | Add auth, protect APIs, verify JWTs, deploy TideCloak, set up E2EE, provision hosted TideCloak |
| Skills | 11 composable roles | Setup, integration, security analysis, route/API protection, review, QA gate |
| Scenarios | 5 reference architectures | Password manager, signing service, encrypted chat, governance panel |
| Prompts | 5 starter prompts | Security gap analysis, secure existing app, migrate auth, admin approval, customer portal |

## Remote Server (no install required)

We host the MCP server so you don't have to install anything. Just add the URL:

```json
{
  "mcpServers": {
    "tide": {
      "url": "https://mcp.tide.org/mcp"
    }
  }
}
```

No Node.js required. No npx. Works with any MCP client that supports remote servers.

## Self-hosting

Want to run your own instance? Pull from Docker Hub:

```bash
docker run -p 3000:3000 tideorg/mcp
```

Or build from source:

```bash
docker build -t tideorg/mcp .
docker run -p 3000:3000 tideorg/mcp
```

Then point your MCP client at `http://localhost:3000/mcp`.

Optional: set `API_TOKEN` environment variable to require Bearer token auth:

```bash
docker run -p 3000:3000 -e API_TOKEN=your-secret tideorg/mcp
```

## Requirements

- **Remote server**: None (just an MCP client that supports remote URLs)
- **npm/npx install**: Node.js 18+
- **Self-hosted Docker**: Docker

No TideCloak instance needed to start — the agent will guide you through setup.

## Privacy

The MCP server is **read-only** and collects no data — no accounts, no telemetry, no storage, no third-party sharing. Tool arguments are used transiently in memory to select bundled guidance. See [PRIVACY.md](PRIVACY.md).

## Links

- [TideCloak](https://tidecloak.com) — The identity platform
- [npm package](https://www.npmjs.com/package/@tideorg/mcp) — `@tideorg/mcp`
- [Privacy policy](PRIVACY.md)
- [Tide Foundation](https://tide.org) — The organisation behind Tide
