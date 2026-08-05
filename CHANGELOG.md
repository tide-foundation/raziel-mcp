# Changelog

All notable changes to `@tideorg/mcp` (the Tide Agent Pack) are documented here.

## 1.9.5 — 2026-07-31

- **Usage geography (hosted endpoint only)** — `mcp.tide.org` now records aggregate
  request telemetry with the caller's approximate location (country/city, via Azure
  Application Insights) so we can see where the service is used. Local/`npx` and
  self-hosted runs collect **nothing** unless `APPLICATIONINSIGHTS_CONNECTION_STRING`
  is set. Request bodies and tool arguments are never captured; the raw IP is masked
  to coarse geography. **`PRIVACY.md` updated** to disclose this — review it.
- **`deploy.sh` deploys the versioned image tag** — Azure Container Apps won't
  re-pull an unchanged `:latest`, so deploying `:latest` silently no-oped (three
  deploys, zero rollouts). Deploying `tideorg/mcp:$VERSION` makes every deploy roll.

## 1.9.4 — 2026-07-30

Release-hardening — fixes the exact failure modes that made shipping 1.9.3 bumpy.

- **`.gitattributes` (`*.sh text eol=lf`)** — shell scripts always check out with
  LF, so `deploy.sh` and the user-facing `init-tidecloak.sh` /
  `bootstrap-tidecloak.sh` stop shipping with CRLF and breaking under bash/WSL
  (`$'\r': command not found`).
- **Self-healing `deploy.sh`** — re-binds the `mcp.tide.org` custom domain on
  every deploy (idempotent), so the binding stops silently dropping and taking
  the hosted endpoint down at the TLS layer.
- **`scripts/bump-version.mjs`** — one command bumps the version across every
  version-bearing file (core packages, plugin, marketplace, extension, and
  raziel's `server.json`), replacing the error-prone hand-editing.

## 1.9.3 — 2026-07-30

- **Red-team suite** — a `tide-red-team` skill, `canon/breach-precedents.md` and
  `canon/tide-neutralization.md`, a `red-team-review` prompt, and a `red-team-report`
  template for adversarial security review of a system's trust concentration.
- **Bootstrap refinements** — updates to `init-tidecloak.sh`, the realm templates, and
  the IGA/admin initialization playbooks.
- Ships the VSCode extension source in-repo (published separately as **Raziel** 1.9.2).

## 1.9.2 — 2026-07-16

- **MCP Registry ready** — added the `mcpName` field (`io.github.tide-foundation/raziel`)
  to the npm package plus a `server.json` listing both the npm package (stdio via `npx`)
  and the hosted `mcp.tide.org` remote, for publishing to the official MCP Registry.
- **Renamed to Raziel** — the Claude Code plugin is now `raziel` (install id) / **Raziel**.
- **Relicensed** under the Tide Community Open Code License (TCOC v2), replacing MIT.

## 1.9.1 — 2026-07-15

- Docs: refreshed `README.md` (the npm package page) for the 1.9.0 feature set —
  security gap analysis and hosting guidance in the intro and capability list,
  a security-analysis starter prompt, and corrected "What's inside" counts
  (15 canon, 18 playbooks, 11 skills, 5 scenarios, 5 prompts). No code changes.

## 1.9.0 — 2026-07-15

The largest release since the pack's initial cut. It broadens the MCP from an
*integration helper* into a *security and hosting advisor*, migrates the IGA API
to the current surface, and adds a real pre-release quality gate. Also makes the
pack ready to list in the Claude directory.

### Highlights

- **Security gap analysis** — audit an existing (even non-Tide) system and map
  its weaknesses to Tide capabilities.
- **Partner-hosted TideCloak via Skycloak** — a managed-hosting path alongside
  self-hosting.
- **IGA API migration** to `/iga/change-requests/...` (replaces the legacy
  `/tide-admin/change-set/...`).
- **Pre-release QA gate** (`npm test`) + GitHub Actions CI.
- **Read-only tool annotations** and a privacy policy — Claude-directory ready.

### New capabilities

- **`tide_security_analysis` tool** + `tide-security-analysis` prompt. Backed by
  `canon/security-gap-mapping.md` (SG-01 … SG-18: a trust-concentration → Tide
  capability → remediation → honesty-note table, plus a mandatory "what Tide does
  NOT fix" section), `canon/security-runtime-probes.md` (opt-in, authorization-
  gated live probing), and the `tide-security-analyst` skill.
- **`tide_hosting` tool** + `canon/hosting-options.md` and the
  `provision-tidecloak-skycloak` playbook: self-host vs partner-hosted decision,
  the trust model (partner-hosting is an availability/metadata trust, not an
  integrity trust — the host can't forge tokens or decrypt data), and the
  Skycloak provisioning API reference.
- **`tide-mcp-qa` skill + prompt** — the QA Engineer role that runs the gate,
  audits for overclaiming, and issues a SHIP / BLOCK verdict.

The MCP now exposes **16 tools** and **5 prompts** (was 14 / 3).

### Changed

- **IGA change-request API** migrated to `/iga/change-requests/{id}/authorize|commit`
  (per-id, `bulk-authorize` for batches), replacing the legacy
  `/tide-admin/change-set/*/batch`. New authoritative reference
  `canon/iga-change-requests-api.md`; reconciled across canon, playbooks,
  bootstrap scripts, and reference-apps. Captures the **Tide vs Tideless** mode
  split — IGA is cryptographic only in Tide (licensed) mode.
- **All tools now carry `readOnlyHint` annotations** (they are read-only).

### Fixed / internal

- **Deterministic QA gate** (`mcp-server/test/`, `npm test`): protocol smoke
  tests (tools/prompts present, annotated, return sane content) + content
  consistency (no stray legacy endpoints, referenced playbooks exist, SG-01…18
  present, GAP counts sum, manifests valid, versions in sync). **113/113.**
- **GitHub Actions** `qa-gate.yml` runs the gate on every PR and on pushes to
  `main`.
- **Claude directory readiness**: `PRIVACY.md` (no data collected), corrected +
  validated plugin manifests (`claude plugin validate` passes), version
  reconciliation so `server.ts`, both `package.json`s, and `plugin.json` all read
  **1.9.0**.
- `npm run test:remote` verifies a live/hosted endpoint (tool count, annotation
  coverage, version).

### Known follow-ups (require a live stack)

- **IGA bootstrap loop** (`bulk-authorize → commit`) is verified against the spec
  but `REQUIRES_RUNTIME_VALIDATION` on a live iga-core instance. (GAP-065)
- **Skycloak-hosted Tide vendor surface** unconfirmed — provisioning is verified,
  but whether a hosted cluster exposes `setUpTideRealm`/IGA/adapter-with-Tide-
  extensions must be checked on a live cluster (`scripts/skycloak-smoke.sh`).
  (GAP-066)
- Provisioning a **TideCloak** cluster via the Skycloak API needs the identity-
  platform selector field confirmed with Skycloak; the documented API path
  defaults to vanilla Keycloak.

### Upgrade notes

- If you script the TideCloak bootstrap, switch IGA approvals to the new
  `/iga/change-requests/...` surface — see `canon/iga-change-requests-api.md`.
- No changes required to app-side SDK wiring.
