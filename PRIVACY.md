# Privacy Policy — Tide Agent Pack MCP Server (`@tideorg/mcp`)

_Last updated: 2026-07-14_

The Tide Agent Pack MCP server exposes read-only operational guidance (canon, playbooks, skills, prompts, scenarios) to AI coding agents. This policy explains what the server does and does not do with data.

## Summary

**The server collects no personal data, requires no account, stores nothing, and shares nothing with third parties.** Every tool is read-only: it reads guidance files bundled with the server and returns text. It performs no writes, no external network calls, and no tracking.

## What the server processes

- **Tool arguments.** Some tools accept short text arguments — a file name (e.g. `tide_canon name="invariants"`) or a free-text situation (e.g. `tide_choose_scenario situation="..."`). These arguments are used **transiently, in memory**, to select which bundled guidance to return. They are not stored, logged as content, analyzed, profiled, sold, or used to train any model.
- **Bundled content only.** The server's responses come entirely from static files shipped with the package (`canon/`, `playbooks/`, `skills/`, `prompts/`, `reference-apps/`, `GAP_REGISTER.md`). It does not read your source code, files, or environment, and it does not fetch anything from the internet at request time.

## What the server does NOT do

- No user accounts, authentication of end users, or identity collection.
- No collection of personal data or PII.
- No persistence of tool arguments or responses.
- No analytics, telemetry, tracking, or advertising.
- No sharing or sale of data to third parties.
- No use of any input for model training.

## Deployment modes

- **Local (stdio).** When run locally by a coding agent (the default), the server runs entirely on your machine. No data leaves your device through this server.
- **Hosted (HTTP).** When run as a hosted HTTPS endpoint, tool arguments are sent to the server over TLS and processed in memory to select guidance. The application persists no request bodies. Standard infrastructure/operational logs at the hosting layer may record request metadata (e.g. timestamps, IP address, response codes) for reliability and abuse prevention; these contain no bundled-content responses and are subject to the hosting provider's retention. The server itself writes no such logs.

## Data retention

The application retains **no** user data. There is nothing to export or delete because nothing is stored.

## Changes

Material changes to this policy will be published in this file with an updated date.

## Contact

Tide Foundation — <info@tide.org>
Source and issues: <https://github.com/tide-foundation/raziel-mcp>
