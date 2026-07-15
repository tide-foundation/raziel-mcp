# Hosting Options: Self-Hosted vs Partner-Hosted TideCloak

Where the TideCloak instance runs is an infrastructure decision, separate from how the app integrates with it. This file covers the two options, the trust model of each, and the Skycloak partner-hosted path.

**This is a pre-build branch (I-17).** Resolve where TideCloak will run before running bootstrap — the setup steps differ. It does **not** change the application wiring (SDK, provider, adapter JSON, JWT verification are identical either way).

---

## The two options

| | Self-hosted | Partner-hosted (Skycloak) |
|---|---|---|
| Who runs TideCloak | You (Docker/Kubernetes/VM) | Skycloak, in their cloud |
| Setup playbook | `deploy-tidecloak-docker` / `start-tidecloak-dev` | `provision-tidecloak-skycloak` |
| Admin access | Master admin user/password you create | Admin Console SSO (Skycloak account); no admin password issued |
| Automation identity | Bootstrap master-admin token | Per-cluster OAuth2 confidential client `skycloak-automation-<cluster-id>` |
| You manage | OS, container, DB, upgrades, backups, TLS | Nothing — fully managed |
| Best for | Full control, air-gapped, existing infra | Teams who don't want to run auth infra |

Both terminate at the **same** application integration: adapter JSON with `jwk`/`vendorId`/`homeOrkUrl`, server-side JWT verification, DPoP. Choosing hosted does not weaken any invariant — it changes who operates the broker, not how the app enforces security.

---

## Trust model — why partner-hosting TideCloak is compatible with Tide

This is the load-bearing point, and it must be stated honestly: **hosting the TideCloak broker with a partner is an availability and metadata trust, not an integrity trust** — *because of* Tide's threshold model, not despite it.

**What the host CANNOT do** (guaranteed by Tide's invariants, regardless of who runs TideCloak):
- **Forge tokens.** JWT signing is threshold VVK across the ORK network; a compromised TideCloak server cannot mint valid tokens (I-09, I-02). This is the whole point of Tide — the broker is not the trust root.
- **Decrypt your data.** E2EE session keys are threshold-decrypted by the Fabric; plaintext never exists on the TideCloak server or any single ORK (I-11).
- **Extract keys.** Keys never exist in whole form anywhere the host can reach (I-01).

**What the host CAN do** (the honest caveats — surface these, do not bury them):
- **Availability.** They operate the broker; they can take it down, throttle it, or lose it. This is a normal managed-service dependency.
- **Metadata.** They see login timing, realm/client configuration, user identifiers, and IP-level traffic. They do not see passwords (threshold PRISM) or E2EE plaintext, but they see *who authenticates when*.
- **Admin-path position.** With Admin Console SSO, Skycloak's account system sits in the admin-authentication path. Anyone who compromises the Skycloak account that fronts the console reaches the admin console (subject to whatever governs admin actions inside the realm — see next point).
- **Tideless IGA is software-enforced by the host.** If the realm runs IGA in **Tideless mode** (`iga.attestor=simple`/unset), the admin-change quorum is enforced by TideCloak's own server logic — which the host operates. A malicious or compromised host could bypass it. **In Tide mode** (`iga.attestor=tide`, licensed), governance approvals are sealed cryptographically (VRK→Midgard→ORK) and the host cannot forge them. **For a partner-hosted deployment where governance integrity matters, use Tide mode.** (See I-10; the Tide/Tideless split is tracked in `GAP_REGISTER.md` GAP-065.)

**One-line summary for a user**: "You can let Skycloak host TideCloak without handing them the ability to impersonate your users or read your data — those require the ORK threshold, which the host doesn't control. What you're trusting them for is uptime and the metadata they can see."

---

## Skycloak API reference

**INFERRED/VERIFIED tags** below reflect the public docs at `https://skycloak.io/docs/api/` as of 2026-07 (`API-Version: 2026-06-01.beta`). The provisioning *procedure* is in `playbooks/provision-tidecloak-skycloak.md`.

**Base URL**: `https://api.skycloak.io` **VERIFIED** (docs).

**Authentication** **VERIFIED** (docs):
- Header `API-Key: <key>` — created in the Skycloak dashboard (Workspace → API keys), shown once, treat as a secret.
- Header `API-Version: 2026-06-01.beta` — **required** on every request.
- Scopes: write includes read (e.g. `clusters:write` implies `clusters:read`). Credentials retrieval needs `clusters:credentials:read`. Missing scope → `403` with `API key does not have the required scope: <scope>`.
- Separately, an **OAuth2 client-credentials** path exists for cluster-level automation (Terraform/CI) — distinct from the Public API key. Each cluster provisions a confidential automation client `skycloak-automation-<cluster-id>` in the `master` realm.

**Endpoints** **VERIFIED** (docs; request/response field names below are **INFERRED** — confirm against the live response, they are not fully specified in the public docs):

| Method | Path | Purpose | Scope |
|---|---|---|---|
| GET | `/clusters` | List clusters | `clusters:read` |
| POST | `/clusters` | Create a cluster (async) | `clusters:write` |
| GET | `/clusters/{id}` | Get cluster status | `clusters:read` |
| GET | `/clusters/{id}/credentials` | Get cluster/automation credentials | `clusters:credentials:read` |

**Create-cluster inputs** **VERIFIED** (feature docs; exact JSON field names **INFERRED**):
- **Identity platform**: `Keycloak` or **`TideCloak`** — choose TideCloak for a Tide deployment. This is the field that makes the cluster a Tide broker.
- **Name**: descriptive identifier.
- **Version**: a latest-stable Keycloak/TideCloak version.
- **Size**: `Small` (DEV, 1 site), `Medium` (STAGING, 2 sites), `Large` (PROD, 3 sites).
- **Location/region**: US East Coast, Canada, Europe, Australia. Trial workspaces provision in the US; non-US regions need Developer plan or higher.

**Lifecycle** **VERIFIED** (docs): creation is asynchronous. Cluster goes `provisioning`/"Creating" → `available` or `failed` (~2–4 min; email on completion). **Poll `GET /clusters/{id}` until status is `available` before bootstrapping.**

**Result** **VERIFIED** (docs): cluster is reachable at `https://<cluster-id>.app.skycloak.io`. **No Keycloak admin username/password is issued** — admin console is reached via Admin Console SSO (Skycloak account); programmatic admin access uses the `skycloak-automation-<cluster-id>` OAuth2 client.

**Errors** **VERIFIED** (docs): RFC 9457 Problem Details JSON (`type`, `title`, `detail`, `status`, `instance`; validation adds an `errors[]` array with `field`/`detail`/`code`/`value`). Notable codes: `402 Payment Required` (action not on current plan), `403` (scope), `409` (name/state conflict), `422` (validation), `429` (rate limit, with `Retry-After`).

---

## The critical open question (verify before promising a turnkey Tide setup)

Skycloak lists TideCloak as a cluster identity platform, but the public docs do **not** confirm that a hosted TideCloak cluster exposes the full **Tide vendor surface** the pack's bootstrap depends on:
- `POST /admin/realms/{realm}/vendorResources/setUpTideRealm` (creates Tide IDP, `tide-vendor-key`, provisions the free-tier license, generates VVK/VRK)
- IGA toggle and the change-request/change-set governance API
- Adapter export enriched with `jwk`/`vendorId`/`homeOrkUrl`
- Whether Tide **licensing** (the Stripe free-tier flow) is handled by Skycloak or still required from the operator

**Status: STILL_UNRESOLVED** — tracked in `GAP_REGISTER.md` (GAP-066). Until confirmed against a live hosted TideCloak cluster, treat the hosted path as: *provisioning is VERIFIED via Skycloak's API; the Tide-realm bootstrap on top of it is ASSUMED to use the same vendor endpoints and must be verified on the actual instance.* Do not tell a user the hosted path is fully turnkey for Tide until this is confirmed. If the vendor endpoints are absent, the honest answer is that Skycloak hosts the broker but Tide-realm setup needs the partner's Tide-specific provisioning (raise with the Tide/Skycloak teams).

---

## Verification

A hosting-choice step is done when:
1. The self-host vs hosted branch was resolved **before** bootstrap (I-17).
2. If hosted: the cluster reports `available` and is reachable at its `*.app.skycloak.io` URL.
3. The trust-model caveats (availability, metadata, admin-path, Tideless-IGA) were stated to the operator, not just the benefits.
4. The adapter JSON exported from the hosted instance still contains `jwk`, `vendorId`, `homeOrkUrl` (I-05, I-13) — same requirement as self-hosted. If it doesn't, GAP-066 applies.

## Anti-patterns

- **AP-HOST-1** — Presenting partner-hosting as a security *downgrade* ("now a third party holds your auth"). It isn't, because of the threshold model — but state the real caveats (availability, metadata, Tideless-IGA), don't overcorrect into either fear or false comfort.
- **AP-HOST-2** — Claiming the hosted Tide path is fully turnkey before GAP-066 is resolved. Provisioning the cluster is verified; the Tide-realm bootstrap on top is not.
- **AP-HOST-3** — Putting the Skycloak API key or the `skycloak-automation-*` client secret in application code or the repo. These are operator/bootstrap secrets (like master admin creds, AP-41) — never in app runtime.
- **AP-HOST-4** — Hardcoding `API-Version` omission. Every Skycloak API call needs the `API-Version` header or it fails.

## Status Legend

- **VERIFIED** — from Skycloak public docs or Tide canon that carries its own sourcing
- **INFERRED** — strongly implied but not explicitly specified (e.g. exact JSON field names)
- **ASSUMED** — operator guidance where sources are silent (e.g. Tide vendor endpoints on hosted clusters)
- **STILL_UNRESOLVED** — open gap (GAP-066)
