# IGA Admin Governance Panel

## What this is

An admin-facing dashboard for managing TideCloak's Identity Governance & Administration (IGA) change requests. Realm admins use this panel to review, approve, reject, and commit proposed changes to users, roles, groups, clients, policies, and realm settings. Every admin mutation in an IGA-enabled realm creates a draft change request. No change takes effect until quorum-signed and committed.

This is a governance tool, not an end-user application. It sits alongside the app that triggered the admin changes.

---

## When to use this scenario

Use when the app needs:
- A custom admin UI for reviewing and approving IGA change requests (instead of or alongside the built-in TideCloak Admin Console)
- Multi-admin quorum governance workflow embedded in a custom dashboard
- Visibility into policy management, Forseti contracts, and role-policy attachments
- Activity tracking (approvals, rejections, comments) on change requests

Do NOT use when:
- The built-in TideCloak Admin Console is sufficient for governance
- The app only needs end-user authentication (use standard auth playbooks)
- The app needs data encryption (use `organisation-password-manager` or `setup-forseti-e2ee`)
- The app needs cryptographic signing (use `policy-governed-signing`)

---

## Core Tide capabilities used

| Capability | Role in this scenario |
|-----------|----------------------|
| IGA change-set API | Core: list, sign, commit, cancel change requests |
| Multi-admin quorum | Core: approval threshold enforced cryptographically |
| Enclave signing | Core: MultiAdmin mode triggers enclave challenge popup |
| Forseti contract management | Supporting: view and manage contracts attached to role policies |
| Realm policy lifecycle | Supporting: create, approve, commit realm-level policies |
| Policy template CRUD | Supporting: manage reusable policy templates |
| SSH/role policy management | Supporting: attach contracts to roles, set thresholds |
| DPoP authentication | Required: admin API calls must be DPoP-bound |
| Server-side JWT verification | Required: governance API routes must verify admin identity |

---

## What must exist before first admin use

1. TideCloak running with a licensed, IGA-enabled realm
2. At least one admin user with `tide-realm-admin` (client role on `realm-management`)
3. Admin user has completed Tide account linking (invite flow)
4. Adapter JSON exported with `jwk` field (IGA must be enabled for `jwk` to be present)
5. App deployed with DPoP-enabled provider and server-side JWT verification
6. For quorum governance: at least two linked admin users

---

## Bootstrap-only steps

These happen before any admin uses the governance panel:

1. Start TideCloak container
2. Create realm from template (with `_tide_enabled`, `tidebrowser` flow, protocol mappers)
3. License realm (`setUpTideRealm`)
4. Enable IGA (`toggle-iga`)
5. Create first admin user, assign `tide-realm-admin`, generate invite link
6. First admin completes account linking
7. Approve/commit initial change requests (user, role, client)
8. Sign IDP settings (`sign-idp-settings`)
9. Export adapter JSON
10. Create second admin user (for quorum) and repeat invite/link/approve cycle

---

## Runtime admin flow

Once bootstrap is complete, the governance panel operates as follows:

Endpoints use the current `/iga/change-requests/...` surface (replaces legacy `/tide-admin/change-set/...`, GAP-065; full spec `canon/iga-change-requests-api.md`).

1. Admin logs in via TideCloak SSO (DPoP-bound)
2. Panel lists pending requests (`GET /iga/change-requests?status=PENDING`) and derives counts
3. Panel groups pending CRs by `entityType` (users, roles, groups, clients, settings, policies)
4. Admin reviews a change request's details, activity, and comments
5. Admin approves: `POST /iga/change-requests/{id}/authorize` (body `{}`; 409 = four-eyes)
   - If Tide MultiAdmin: complete the two-phase `GET`/`POST /iga/change-requests/{id}/approval-model` enclave exchange
   - If FirstAdmin/Tideless: signed server-side immediately
6. When `readyToCommit`: `POST /iga/change-requests/{id}/commit` (412 if under threshold)
7. Admin can reject: `POST /iga/change-requests/{id}/deny`
8. Admin can add/edit/delete comments on change requests

---

## Default playbook sequence

1. `start-tidecloak-dev`
2. `bootstrap-realm-from-template`
3. `initialize-admin-and-link-account`
4. `add-auth-nextjs-fresh` (or `add-auth-nextjs-existing`)
5. `protect-routes-nextjs`
6. `protect-api-nextjs`
7. `verify-jwt-server-side`
8. `setup-iga-admin-panel`
9. `add-rbac-nextjs`

---

## Key diagnostics

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Authorize returns 401 | Token expired or DPoP not attached | Re-login; ensure `secureFetch` with DPoP |
| Authorize returns 409 | Same admin re-signing (four-eyes) or CR not PENDING | Use a different admin; refresh the list |
| MultiAdmin: authorize does not record | Enclave step skipped | Complete `{id}/approval-model` two-phase exchange |
| Commit returns 412 | Under threshold / unmet dependency | Collect more approvals; commit `dependsOn` CR first |
| Change request stays PENDING after authorize | Missing commit step | Call `{id}/commit` once `readyToCommit` |
| add-review returns 415 | Wrong content-type | Use `multipart/form-data`, not JSON |
| Counts don't update after commit | Stale data | Refresh counts after every mutation |
| Policy change requests don't appear | Realm policy not in pending state | Create pending realm policy first via `/tide-admin/realm-policy/pending` |
| Forseti contracts tab empty | No contracts registered | Contracts deploy via SDK signing flow, not REST API |
| 120s delay after commit before roles appear | Token refresh delay | Expected behavior; re-login or wait |

---

## Intentionally configurable

- **Admin role name**: `tide-realm-admin` is the default, but apps may check additional app-specific admin roles for UI-level filtering
- **Quorum threshold**: Determined by `max(1, floor(TotalAdmins * 0.7))` at the TideCloak level; not app-configurable
- **Change-set types**: The panel can filter which types to show based on app needs (e.g., only users and roles, not clients)
- **Activity features**: Comments and activity history are optional; core governance works without them
- **Policy management tabs**: Forseti contracts and realm policy management are optional features; a minimal panel needs only change-set list/approve/commit
- **Custom admin domain**: `CustomAdminUIDomain` must be set and `sign-idp-settings` called if the panel is hosted separately from TideCloak's built-in Admin Console
