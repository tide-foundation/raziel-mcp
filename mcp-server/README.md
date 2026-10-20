# Tide Agent Pack MCP server

## "I updated the pack but nothing changed"

**An MCP server is a process started when your session connected.** Editing `src/`, or even
rebuilding `dist/`, does not reach a session that is already connected — it keeps talking to the
process it started. A tool you just added reads as "missing" and an instruction you just wrote reads
as "ignored", which looks like a broken feature rather than a stale process.

```bash
bash mcp-server/verify-live.sh
```

It checks the three things that go out of date independently:

1. **`dist/` older than `src/`** → run `npm run build`
2. **the built server, spawned fresh** → reports its version and whether the tools/instructions you
   expect are actually there
3. **your session** → if step 2 says `HAS` but your session cannot call the tool, the build is fine
   and the *session* is stale: reconnect with `/mcp`, or start a new session

The instructions block is stamped `Tide Agent Pack vX.Y.Z`, so an agent can report which build it is
actually talking to instead of guessing.


---

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
| `tide_scaffold` | **Start a new app from a working template.** Returns the copy, install, bootstrap and check commands |
| `tide_doctor` | **Find and fix what is wrong with an app.** Returns one command that repairs mechanical faults and prints the fix for the rest |
| `tide_choose_scenario` | Match a request to a known scenario. Returns the playbooks **and the work order** (see below) |
| `tide_choose_playbook` | Recommend playbooks for a situation. Returns the same work order |
| `tide_list` | List all content by category (canon, playbooks, skills, prompts, adapters, scenarios) |
| `tide_canon` | Read a canon file (invariants, anti-patterns, framework-matrix, etc.) |
| `tide_playbook` | Read a step-by-step playbook |
| `tide_skill` | Read a composable skill definition |
| `tide_prompt` | Read a starter prompt |
| `tide_adapter` | Read agent adapter instructions (CLAUDE, AGENTS, replit) |
| `tide_list_scenarios` | List the scenario patterns under `reference-apps/` |
| `tide_scenario` / `tide_scenario_manifest` / `tide_scenario_roles` / `tide_scenario_bootstrap` | Read one scenario's summary, manifest, role-policy matrix, or bootstrap sequence |
| `tide_dpop_asset` | The exact command that installs `public/tide_dpop_auth.html`, its sha256, the `next.config` wiring, and wire checks |
| `tide_branding` | Brand the login enclave: one command that generates, validates and uploads a logo and background |
| `tide_onboarding` | Replace Keycloak's "Update Account Information" page with a finished in-app component |
| `tide_hosting` | Self-hosted vs partner-hosted (Skycloak) TideCloak: decision, trust model, and provisioning playbook |
| `tide_security_analysis` | Audit an existing (non-Tide) system for security gaps (SG-01…SG-18) and map them to Tide; optionally includes runtime-confirmation probes |
| `tide_blast_radius` | Blast Radius Assessment of an existing app, delivered as a PDF |
| `tide_gaps` | Read the gap register (unresolved items) |

### Scaffold and doctor

A new build starts from a template, not from prose. `tide_scaffold` picks one of the four app
templates and returns the commands to copy it, name it, install, bootstrap and check it. The code
that most often goes wrong — provider config, the DPoP page and its wiring, server-side token and
proof verification — is then copied, not retyped.

`tide_doctor` returns one command, `templates/shared/tide-doctor.sh`. It **repairs by default**:

| Fault | What it does |
|---|---|
| DPoP page missing or stale | Re-copies the known-good page and verifies the hash |
| Rewrite on the exact path `/tide_dpop` | Changes it to the wildcard |
| `.env` not gitignored | Adds it to `.gitignore` |
| Anything that needs a decision (route roles, provider options, CSP, bootstrapping a realm) | Leaves it, prints the exact fix for the agent to apply |

`--check` reports without changing anything. `--url` adds checks of what a running app actually
serves; `--realm` adds read-only realm checks. It never changes a realm.

The templates are built and the doctor is run in `npm test` (`test/scaffold.test.mjs`): four healthy
scaffolds must pass clean, and each fault must be caught or repaired.

### The work order

`tide_choose_scenario` and `tide_choose_playbook` do not stop at playbook names. Every build response
ends with a numbered work order: the hosting question, where the pack's files are, the two end-user
questions, the four DPoP pieces, server-side verification, and the wire checks. It exists because a
list of names left each mandatory step to be discovered by reading a 500-800 line playbook to the
right line — users had to ask for the DPoP page by name.

### Server instructions are capped at 2000 characters

Claude Code truncates MCP server instructions at about that length (MEASURED 2026-10-07). The
`instructions` block in `src/server.ts` therefore only routes the agent to its first call; detail
goes in tool responses. `npm test` fails if the block grows past the limit.

### Licence email and Terms & Conditions come first

Setting up a realm licenses it to an email address under Tide's Terms & Conditions
(https://tide.org/legal). The agent must ask the user for the email and for their agreement before
anything is created (AP-90). It is enforced in three places, because any one alone was skipped:

| Where | What it does |
|-------|--------------|
| Bootstrap scripts | Prompt at a terminal; otherwise exit 2 without `TIDE_LICENSE_EMAIL` and `TIDE_TERMS_ACCEPTED=yes`. Placeholder addresses are rejected. |
| Tool responses | `LICENSE_ASK` leads `tide_hosting`, `tide_scenario_bootstrap` and every bootstrap playbook, and is step 1 of the work order. |
| Server instructions | One sentence, ahead of the hosting question. |

### Deploying a custom Forseti contract is not self-service

A Forseti contract decides what the network will sign, so an open one can be written to sign
anything. Putting one onto a realm or the network is experimental, test-network only, and done by
the Tide team. The public server teaches how to write and compile-check a contract. It does not
show the upload.

| What | Public server |
|---|---|
| Writing a contract, the compile harness, contract templates | Served |
| The REST upload endpoint and its payload | Removed from every response |
| The SDK call that carries the contract source inside a signing request | Removed; the rest of the signing code stays, with the line marked |
| A scenario or playbook that ends in a deployed contract | Served, starting with a note: do not upload it, it goes to the Tide team to be reviewed and deployed |

The filter is `redactRestricted` in `src/server.ts`, driven by `RESTRICTED_MARKER`.
`scripts/redact-public.mjs` applies the same filter to the public repo's files, so the files and
the runtime cannot disagree. `RESTRICTED` can also name a document, scenario or template directory
to withhold whole; nothing is listed today.

For the Tide team: run from the private workshop with `TIDE_PACK_INTERNAL=1` to get everything.
On a public build that switch finds nothing to reveal.

**Limits.** This controls what the pack says and ships. It does not stop someone who already knows
the endpoint from calling it; the platform enforces that. The filter knows the upload by the terms
in `RESTRICTED_MARKER`: a new way to upload a contract needs a new term there.

### No response exceeds 60 KB

Claude Code rejects a tool result over about 25k tokens (MEASURED 2026-10-07: `tide_blast_radius`
returned an error and a file path). `deliver()` in `src/server.ts` is the single exit for
document-shaped responses:

- A document over `PART_BUDGET` is split at headings into parts. Each part says how to fetch the
  next: call the same tool with `part: 2`, and so on.
- `tide_canon` and `tide_skill` accept `section` to return only the entries whose heading contains
  the text, for example `section: "AP-62"`.

`npm test` walks every document the server can return and fails if any part is over the limit.

### How `tide_choose_playbook` routes

1. A diagnosis (broken login, missing roles) returns only the diagnostic playbook.
2. A scenario scoring 3 or more returns that scenario's sequence.
3. Otherwise keyword rules pick playbooks. Keywords match whole terms, never substrings.
4. Build responses add a framework note for non-Next.js stacks and the work order.

Routing cases live in `test/smoke.test.mjs`. Add a row when you find a misroute.

### Pack files reach the caller, wherever the server runs

Tools that need a template or script name it in a form the **caller** can use:

| Transport | What a tool prints |
|-----------|--------------------|
| stdio (`npx`, local checkout) | the absolute path on this machine |
| HTTP (hosted) | a fetch command against the server: `GET /pack/templates.tgz` (everything) or `GET /pack/<path>` (one file, byte-exact) |

Only `templates/` and `scripts/check-dpop-asset.sh` are served. Build output and `.env` files are
refused even if present on the server's disk.

## Available Prompts

| Prompt | Description |
|--------|-------------|
| `tide-build-app` | Start building a Tide-protected app from scratch |
| `tide-secure-existing` | Add Tide to an existing app |
| `tide-build-from-scenario` | Start building a Tide app from a known scenario pattern |
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

The MCP server reads the pack's markdown and templates from disk and serves them as tools, over stdio (`dist/index.js`) or stateless HTTP (`dist/http.js`), using the Model Context Protocol. Any MCP-compatible agent (Claude Code, Codex, Replit, Cursor, Windsurf, etc.) can connect and query the pack.

The server does not modify any files. It is read-only.
