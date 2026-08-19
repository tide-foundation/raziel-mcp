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

**Authentication** — the public API accepts **only** the `API-Key` header; the pack's default is to **mint that key with a device-authorization token** (no dashboard key needed). Two distinct credentials:
- **Device access token → mints the key.** OAuth 2.0 device flow against `https://login.app.skycloak.io/realms/skycloak/protocol/openid-connect/auth/device` with the public client `skycloak-mcp` (no secret); the operator approves in their browser. This token is **not** an API credential — its only job is to mint an API key: `POST https://app.skycloak.io/api/cli/keys` (Bearer device token, body `{name, scopes}`) returns `201` with `full_key` (shown once). Omitting `scopes` yields a read-only key; write scopes imply reads. The mint enforces four `403`s: workspace membership, the API-keys permission (owner/admin), a verified email, and the plan's key quota. An `aud: lambda-authorizer` claim on the device token is expected.
- **Minted API key → authenticates the API.** Header `API-Key: <full_key>`. **`API-Key` is the only header the public gateway (`https://api.skycloak.io`) accepts — a `Bearer` token never authenticates there.** A dashboard-created key (Workspace → API keys) works identically and is the headless alternative.
- Header `API-Version: 2026-06-01.beta` — **required** on every request.
- Scopes: write includes read (e.g. `clusters:write` implies `clusters:read`). Credentials retrieval needs `clusters:credentials:read`. Missing scope → `403` with `does not have the required scope: <scope>`.
- Separately, an **OAuth2 client-credentials** path exists for cluster-level automation (Terraform/CI) inside a cluster's own `master` realm — distinct from Public API auth. Each cluster provisions a confidential automation client `skycloak-automation-<cluster-id>` (used in provisioning Step 3 for the admin token).

**Endpoints** **VERIFIED** (docs; request/response field names below are **INFERRED** — confirm against the live response, they are not fully specified in the public docs):

| Method | Path | Host | Purpose | Scope |
|---|---|---|---|---|
| POST | `/api/cli/keys` | `app.skycloak.io` | Mint an API key (Bearer device token; `{name, scopes}`; `201` `full_key`) | device token + API-keys permission |
| GET | `/clusters` | `api.skycloak.io` | List clusters | `clusters:read` |
| POST | `/clusters` | `api.skycloak.io` | Create a cluster (async) | `clusters:write` |
| GET | `/clusters/{id}` | `api.skycloak.io` | Get cluster status | `clusters:read` |
| GET | `/clusters/{id}/credentials` | `api.skycloak.io` | Get cluster/automation credentials | `clusters:credentials:read` |
| POST | `/clusters/{id}/realms` | `api.skycloak.io` | Create a realm (`{name, display_name}`; cluster must be `available`) | `realms:write` |
| POST | `/clusters/{id}/realms/{realm}/applications` | `api.skycloak.io` | Create an application/client | `applications:write` |
| POST | `/clusters/{id}/realms/{realm}/users` | `api.skycloak.io` | Create a realm user | `realm-users:write` |
| POST | `/clusters/{id}/realms/{realm}/identity-providers` | `api.skycloak.io` | Add an identity provider | `identity-providers:write` |
| POST | `/clusters/{id}/realms/import` | `api.skycloak.io` | Bulk import realm + apps + users + IdPs | `realms:write` |

**Create-cluster body** — **VERIFIED against the live API 2026-08-06.** These values were confirmed by running them and reading the 422s. Several **contradict the public docs**; trust this table.

| Field | Value | Note |
|---|---|---|
| `type` | `tidecloak` \| `keycloak` | **lowercase**. NOT `identityPlatform` |
| `name` | string | |
| `size` | `small` \| `medium` \| `large` | **lowercase**. `Small` → 422 |
| `location` | `us` \| `ca` \| `au` \| `eu` | the field is **`location`**, NOT `region` |
| `version` | semver, required | namespace **follows `type`** |

Three traps, each of which cost real debugging time:

1. **`identityPlatform` is not schema-validated.** The docs name it, but the API accepts, ignores it, and hands back a **plain Keycloak cluster with no Tide extensions**. Always assert `jq -r '.type'` is `tidecloak`.
2. **Version namespace follows type.** TideCloak clusters take TideCloak versions (`0.14.x`), Keycloak clusters take Keycloak versions (`26.x`). Crossing them → `400 invalid cluster version`. There is no versions endpoint.
3. **TideCloak is enabled per workspace and is off by default in prod.** Without the entitlement, creation returns an opaque `500 "Failed to create cluster"` rather than a clean 402/403 — the dashboard gates it behind a `has_access` flag with a "Contact" link.

**Version matters more than anything else here** — **VERIFIED**:

| Version | Provisions | Automation client | `setUpTideRealm` |
|---|---|---|---|
| `0.13.13` | yes | **500 — unusable** | untestable |
| `0.14.11` | yes | works | **500 KEYGEN_FAILED** |
| `0.14.17` | yes | works | **works** ← verified FLOOR |

A broken automation client also breaks Skycloak's own `/clusters/{id}/realms` API, since that proxies through it. Match the `@tidecloak/*` npm SDK version to the cluster version.

**`0.14.17` is the floor, not the version to use. Discover the newest and use that** — run
`templates/shared/skycloak-latest-version.sh`. Hardcoding a pin is the failure mode this replaces: a
pin keeps provisioning successfully long after it is stale, so nothing ever signals it aged out.

**The version list comes from Skycloak, not Docker Hub.** Skycloak validates the version by exact
match against a server-side allowlist (`SupportedTideCloak` → `ErrInvalidClusterVersion`,
`internal/clusters/service.go`), so a tag can be the newest thing Tide published and still be
rejected. There **is** a versions endpoint — earlier pack revisions said there wasn't, and that error
is what sent the script to Docker Hub:

```
GET /clusters/supported-versions?type=tidecloak    → ["0.14.20", ...]
GET /clusters/versions                             → {"keycloak":[...],"tidecloak":[...]}
```

Both need the API key. Docker Hub is useful only as a **lag diagnostic** (`--check`): "Skycloak is N
releases behind what Tide published" is actionable — ask Skycloak to add the version. It is never a
source for picking one.

Three traps:

- **`latest` is not an accepted value.** Skycloak validates against `^[0-9]+\.[0-9]+(\.[0-9]+)?$`.
- **Sort numerically, never lexically.** As strings `"0.9.8" > "0.14.20"`, so a naive sort selects a
  version *below* the floor, which then fails at `setUpTideRealm` with `KEYGEN_FAILED` — an error
  that reads as key generation and is actually licensing. Do not trust the endpoint's documented
  "newest to oldest" ordering either; sort what you receive.
- **Never read the allowlist from a Skycloak source checkout.** A checkout is a snapshot — the one
  on this machine says `0.11.7` while production takes `0.14.17` (AP-83).

**Use the newest Skycloak offers, and create once.** Do not retry downward on
`400 invalid cluster version`: the list came from Skycloak, so a rejection is an inconsistency to
report, not a reason to settle for an older build. Retrying downward is only ever a downgrade, and it
is what kept clusters coming up old with no error. The `0.14.17` floor never selects an older
version — it only refuses to return one when the whole catalogue is below it.

If Skycloak's newest is older than you want, **no client-side change fixes it** — the allowlist is
server-side. Do not lower the floor to compensate: sub-floor versions provision happily and then
fail at licensing or on the automation client. The floor is VERIFIED by testing; anything newer is
**ASSUMED good** until someone re-runs the matrix.

**Lifecycle** **VERIFIED**: creation is asynchronous, `provisioning`/`updating` → `available` or `failed` (45s–4min). Poll before bootstrapping.

**Result** **VERIFIED**: the cluster is reachable at `https://<cluster-id>.<location>.skycloak.io` (e.g. `.us.skycloak.io` — the host mirrors `location`, it is not `.app.`). **No Keycloak admin username/password is issued** — the admin console uses SSO; programmatic access uses the per-cluster automation client from `GET /clusters/{id}/credentials`. That client's UUID does **not** match the cluster id, despite the `skycloak-automation-<cluster-id>` phrasing in the docs.

**Plan limits** are enforced cleanly: `402` with `{"current_limit":1,"current_plan":"trial","required_plan":"business"}`. **Trial = 1 cluster.**

**The trial realm path is a dead end for Tide.** The dashboard's `POST /api/trial/realm/provision` (browser-only, cookie+CSRF, accepts only `{slug}`) yields a **plain Keycloak** cluster on shared infrastructure — no Tide vendor surface, and no cluster ID, so none of the realm APIs apply. It cannot be used to run a Tide app.

**Errors** **VERIFIED** (docs): RFC 9457 Problem Details JSON (`type`, `title`, `detail`, `status`, `instance`; validation adds an `errors[]` array with `field`/`detail`/`code`/`value`). Notable codes: `402 Payment Required` (action not on current plan), `403` (scope), `409` (name/state conflict), `422` (validation), `429` (rate limit, with `Retry-After`).

---

## GAP-066 — RESOLVED (2026-08-06)

**A hosted TideCloak cluster does expose the full Tide vendor surface, provided the version is new enough.** Verified end-to-end on a live `0.14.17` cluster:

- `POST .../vendorResources/setUpTideRealm` — **works**. Creates the Tide IdP and `tide-vendor-key`, provisions the free-tier subscription, generates the gVRK. Takes **10–15 seconds** because it genuinely reaches Tide's licensing service.
- `tide-admin/toggle-iga` and the `iga/change-requests` governance API — **200**.
- Adapter export carries `jwk`, `vendorId`, `homeOrkUrl` — **confirmed**.
- Tide **licensing is handled automatically** by `setUpTideRealm`; the operator does nothing extra.

**Licensing is version-gated, and the error lies about its own cause.** On `0.14.11` the same call fails with `TIDE-IDPEXT-VENDOR-KEYGEN_FAILED` / "Initial VRK generation failed". Key generation is not the problem: re-running with `skipLicense=true` returns `200 {"status":"idp-created"}`, isolating the failure to **license activation**. `skipLicense` is a diagnostic only — it mints no VRK, so the adapter export then 500s with no `jwk`.

**Two diagnostic rules learned the hard way:**
- **Always retest on a freshly created realm.** A failed `setUpTideRealm` leaves `tide-vendor-key` and the `tide` IdP behind; retrying in place then returns `TIDE-IDPEXT-VENDOR-REALM_SETUP_FAILED`, a different and misleading error.
- **Compare against local.** Running the same call on a local Docker TideCloak is the cleanest control. Timing alone is diagnostic: ~7–15s means a real outbound licensing call, ~1s means it failed before making one.

**Verification before promising a working hosted setup** — assert all three:

```bash
jq -r '.type' cluster-create.json                                   # → tidecloak
# READ-ONLY vendor-surface probe (see warning below):
curl -s -o /dev/null -w '%{http_code}\n' \
  "$TIDECLOAK_URL/admin/realms/master/iga/change-requests?status=PENDING" \
  -H "Authorization: Bearer $TOKEN"                                 # → 200, not 404
jq 'has("jwk") and has("vendorId") and has("homeOrkUrl")' data/tidecloak.json   # → true
```

> ⚠️ **Do not probe the vendor surface with `POST /tide-admin/toggle-iga`.** Earlier revisions of this
> page used `-d '{"enabled":false}'` against `master`, which does distinguish TideCloak (200) from
> plain Keycloak (404) — **and silently ENABLES IGA on the master realm as a side effect.** The
> endpoint reads the form parameter `isIGAEnabled`; a JSON body is parsed by nothing and the missing
> parameter fails open to `true`. On a fresh realm this also runs a Phase-6 ADOPT scan over every
> entity and warns about admin lockout. Use the read-only `GET .../iga/change-requests` above, which
> is equally Tide-specific and mutates nothing. VERIFIED 2026-08-10.

---

## Verification

A hosting-choice step is done when:
1. The self-host vs hosted branch was resolved **before** bootstrap (I-17).
2. If hosted: the cluster reports `available`, is reachable at `https://<id>.<location>.skycloak.io`, and **`type` is `tidecloak`** (not silently Keycloak).
3. The trust-model caveats (availability, metadata, admin-path, Tideless-IGA) were stated to the operator, not just the benefits.
4. The adapter JSON exported from the hosted instance contains `jwk`, `vendorId`, `homeOrkUrl` (I-05, I-13) — same requirement as self-hosted. If it doesn't, licensing did not complete: check the cluster version is at or above the `0.14.17` floor.

## Anti-patterns

- **AP-HOST-1** — Presenting partner-hosting as a security *downgrade* ("now a third party holds your auth"). It isn't, because of the threshold model — but state the real caveats (availability, metadata, Tideless-IGA), don't overcorrect into either fear or false comfort.
- **AP-HOST-2** — Claiming the hosted Tide path works without checking `type`, the vendor surface, and the adapter's `jwk`. GAP-066 is resolved *from `0.14.17`*; older versions provision happily and then fail at licensing. Do not hardcode `0.14.17` either — it is the floor; discover the newest with `templates/shared/skycloak-latest-version.sh`.
- **AP-HOST-5** — Granting `tide-realm-admin` before finishing every governed write. It flips the realm to multiAdmin, after which no change request can be approved from a script (`409 MULTIADMIN_REQUIRES_APPROVAL_ENCLAVE`) and every later config change needs a human enclave approval. Register all redirect URIs and web origins during bootstrap.

  ⚠️ **But Forseti policy deployment needs that grant.** `GET /iga/role-policies` returns `200 []` until `tide-realm-admin` is granted to the first admin — the `tide-realm-admin` policy is created *as part of* that grant, and policy deployment requires it. So "grant it last" and "you cannot deploy a policy without it" are both true: sequence every other governed write before the grant, then expect **policy deployment itself to be a post-flip, enclave-approved operation**. An empty `role-policies` array is not a broken endpoint. VERIFIED (LEARNINGS-agent-quorum-001 L-09); see `playbooks/deploy-forseti-policy.md` Step 8.
- **AP-HOST-3** — Putting the Skycloak API key or the `skycloak-automation-*` client secret in application code or the repo. These are operator/bootstrap secrets (like master admin creds, AP-41) — never in app runtime.
- **AP-HOST-4** — Hardcoding `API-Version` omission. Every Skycloak API call needs the `API-Version` header or it fails.

## Status Legend

- **VERIFIED** — from Skycloak public docs or Tide canon that carries its own sourcing
- **INFERRED** — strongly implied but not explicitly specified (e.g. exact JSON field names)
- **ASSUMED** — operator guidance where sources are silent
- **STILL_UNRESOLVED** — open gap

GAP-066 (Tide vendor surface + licensing on hosted clusters) is **RESOLVED** as of 2026-08-06 — see the section above. Where this file says VERIFIED against the live API, that beats the public docs, which are wrong on several field names.
