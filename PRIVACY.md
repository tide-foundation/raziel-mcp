# Privacy Policy — Tide Agent Pack MCP Server (`@tideorg/mcp`)

_Last updated: 2026-07-31_

The Tide Agent Pack MCP server exposes read-only operational guidance (canon, playbooks, skills, prompts, scenarios) to AI coding agents. This policy explains what the server does and does not do with data. It differs by how you run it.

## Summary

**Run locally (the default — `npx` / stdio), the server collects nothing** — no personal data, no account, no storage, no tracking. Every tool is read-only: it reads guidance files bundled with the server and returns text. It performs no writes and reads none of your code, files, or environment.

**The hosted endpoint (`mcp.tide.org`)** additionally records **aggregate usage telemetry** — request counts, timing, response codes, and the caller's approximate **geography** (country/city, derived from the IP and stored without the full address) — so we can see where the service is used and keep it reliable. It does **not** capture request bodies, tool arguments, or responses, and it is **never** used for advertising, individual profiling, model training, or sold/shared. Details under "Usage analytics" below.

## What the server processes

- **Tool arguments.** Some tools accept short text arguments — a file name (e.g. `tide_canon name="invariants"`) or a free-text situation. These are used **transiently, in memory**, to select which bundled guidance to return. They are not stored, logged as content, analyzed, profiled, sold, or used to train any model.
- **Bundled content only.** Responses come entirely from static files shipped with the package (`canon/`, `playbooks/`, `skills/`, `prompts/`, `reference-apps/`, `GAP_REGISTER.md`). The server does not read your source code, files, or environment, and does not fetch anything from the internet at request time.

## Usage analytics (hosted endpoint only)

This applies **only** to the hosted `mcp.tide.org` endpoint. It does **not** apply when you run the server locally via `npx` or your own container without telemetry configured.

- **What is recorded:** for each request — a timestamp, the HTTP method and path (e.g. `POST /mcp`), the response code and duration, and the caller's **approximate location** (country/city) derived from the source IP.
- **How:** via Azure Application Insights. The raw IP address is used to resolve geography and is then **masked** (the location is retained, not the full address).
- **Why:** to understand where the service is used and to detect outages and abuse.
- **What is NOT recorded:** request bodies, tool arguments, MCP responses, guidance content, or any account/identity — none of these are collected, because there are no accounts and the tools are read-only.
- **Retention:** governed by Azure Monitor's retention on the underlying Log Analytics workspace.
- **Note on IP addresses:** an IP address can be personal data under laws such as the GDPR. We minimize this by resolving to coarse geography and masking the address rather than storing it.

## What the server does NOT do

- No user accounts, authentication of end users, or identity collection.
- No persistence of tool arguments, request bodies, or responses.
- No advertising, and no behavioural profiling of individuals.
- No sharing or sale of data to third parties.
- No use of any input for model training.

## Deployment modes

- **Local (stdio).** When run locally by a coding agent (the default), the server runs entirely on your machine and collects nothing. No data leaves your device through this server.
- **Self-hosted (HTTP).** When you run the container yourself, no usage telemetry is collected unless you explicitly configure it (`APPLICATIONINSIGHTS_CONNECTION_STRING`). Standard infrastructure logs at your hosting layer are yours.
- **Hosted (`mcp.tide.org`).** Tool arguments are sent over TLS and processed in memory to select guidance; request bodies are not persisted. The aggregate usage telemetry described under "Usage analytics" is collected.

## Data retention

The application persists **no** request bodies, tool arguments, or responses. The only retained data is the hosted endpoint's aggregate usage/geo telemetry (above), kept per Azure Monitor retention. There is no per-user data to export or delete because no accounts or identities are collected.

## Changes

Material changes to this policy will be published in this file with an updated date.

## Contact

Tide Foundation — <info@tide.org>
Source and issues: <https://github.com/tide-foundation/raziel-mcp>
