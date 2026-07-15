# Tide Agent Pack — MCP Server

Exposes the Tide agent pack (canon, playbooks, skills, prompts, adapters) as MCP tools that any AI coding agent can call.

## Setup

```bash
cd mcp-server
npm install
npm run build
```

## Testing / Release gate

```bash
cd mcp-server
npm test        # builds, then runs the deterministic QA gate (protocol + content checks)
```

`npm test` is the objective pre-release gate: it starts the server in-memory, asserts every tool/prompt is present and returns correct-looking content, and runs content-consistency checks (no stray legacy endpoints, no merge markers, referenced playbooks exist, SG-01…SG-18 present, GAP counts sum, honesty guards intact). A non-zero exit means **do not release**.

For a full pre-release review, run the **MCP QA Engineer** (`skills/tide-mcp-qa`, or the `tide-mcp-qa` prompt): it runs `npm test`, then does the semantic review and honesty audit the gate can't, drives sample eval cases, and issues a SHIP / SHIP_WITH_WARNINGS / BLOCK verdict.

## Available Tools

| Tool | Description |
|------|-------------|
| `tide_list` | List all content by category (canon, playbooks, skills, prompts, adapters) |
| `tide_canon` | Read a canon file (invariants, anti-patterns, framework-matrix, etc.) |
| `tide_playbook` | Read a step-by-step playbook |
| `tide_skill` | Read a composable skill definition |
| `tide_prompt` | Read a starter prompt |
| `tide_adapter` | Read agent adapter instructions (CLAUDE, AGENTS, replit) |
| `tide_invariants` | Quick access to all security invariants |
| `tide_anti_patterns` | Quick access to all anti-patterns |
| `tide_choose_playbook` | Recommend the right playbook for a given situation |
| `tide_security_analysis` | Audit an existing (non-Tide) system for security gaps (SG-01…SG-18) and map them to Tide; optionally includes runtime-confirmation probes |
| `tide_hosting` | Self-hosted vs partner-hosted (Skycloak) TideCloak: decision, trust model, and provisioning playbook |
| `tide_gaps` | Read the gap register (unresolved items) |

## Available Prompts

| Prompt | Description |
|--------|-------------|
| `tide-build-app` | Start building a Tide-protected app from scratch |
| `tide-secure-existing` | Add Tide to an existing app |
| `tide-security-analysis` | Analyze an existing system for security gaps and map them to Tide |
| `tide-mcp-qa` | Run the pre-release QA gate and issue a SHIP/BLOCK verdict |

---

## Ready-to-use config templates

Template configs are in `examples/`. Copy the right one into your project and replace `/CHANGE_THIS/` with the actual path to your `tide-agent-pack` clone.

| Platform | Template file | Copy to |
|----------|--------------|---------|
| Claude Code (per-project) | `examples/.mcp.json` | `.mcp.json` in your project root |
| Claude Code (global) | `examples/claude-settings.json` | Merge into `~/.claude/settings.json` |
| Codex (OpenAI) | `examples/codex-config.json` | `.codex/config.json` in your project |
| Replit | `examples/replit-config.json` | Replit agent MCP config |

### Claude Code

1. Copy `examples/.mcp.json` to your project root
2. Replace `/CHANGE_THIS/` with the real path
3. Restart Claude Code — the agent can now call `tide_playbook`, `tide_invariants`, etc.

For global access (all projects), merge `examples/claude-settings.json` into `~/.claude/settings.json`.

### Codex (OpenAI)

1. Copy `examples/codex-config.json` to `.codex/config.json` in your project
2. Replace `/CHANGE_THIS/` with the real path

No-MCP fallback: copy `adapters/AGENTS.md` into your project root as `AGENTS.md`.

### Replit

1. Copy `examples/replit-config.json` into your Replit agent MCP config
2. Replace `/CHANGE_THIS/` with the real path

No-MCP fallback: copy `adapters/replit.md` into your project as the agent system prompt.

---

## How it works

The MCP server reads markdown files from the pack at startup. It serves them as tools over stdio using the Model Context Protocol. Any MCP-compatible agent (Claude Code, Codex, Replit, Cursor, Windsurf, etc.) can connect and query the pack.

The server does not modify any files. It is read-only.
