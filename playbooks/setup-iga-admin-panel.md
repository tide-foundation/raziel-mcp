# Set Up IGA Admin Panel

Build an admin UI for managing IGA change requests with quorum governance.

---

## When to Use

- Building an admin dashboard that lists, approves, rejects, and commits IGA change requests
- Need to integrate the TideCloak change-request lifecycle into a custom UI
- Managing role assignments, group changes, or policy updates through quorum-governed workflows

**Do not use** if you only need end-user authentication. See [add-auth-nextjs-fresh.md](add-auth-nextjs-fresh.md) instead.

**A custom panel is optional.** The stack already ships two working admin consoles that manage IGA change requests out of the box:

- **tide-console SPA** — a built Vite/React admin UI bundled inside the `tidecloak-key-provider` jar and served by TideCloak.
- **Legacy keycloak.v2 console** — the stock Keycloak admin UI, which on the shipped build carries a native `tide-change-requests` section.

Build a custom panel only when you need to embed CR governance inside your own product UI. Otherwise use one of the shipped consoles.

---

## Prerequisites

- TideCloak instance running and accessible
- TideCloak realm created with IGA enabled
- Admin user with sufficient privileges (realm-admin or equivalent)
- Admin bearer token obtainable (via admin-cli client or service account)
- Familiarity with the Tide enclave signing flow (required for multi-admin mode)

---

## API Base

All endpoints below are relative to:

```
{tidecloak-url}/admin/realms/{realm}
```

Example: `http://localhost:8080/admin/realms/myrealm`

The consolidated IGA REST surface is rooted at `/admin/realms/{realm}/iga` (server class `IgaAdminResource`). Change requests live under `/iga/change-requests`.

> **Legacy bootstrap-compat surface.** The canonical bootstrap script (`localtest/init/init_tidecloak.sh`) and the `tidecloak-js` `AdminAPI` still call an older `/tide-admin/change-set/{type}/requests`, `/tide-admin/change-set/sign`, and `/tide-admin/change-set/commit` surface. That path still exists for backward compatibility and is fine for scripted bootstrap approval, but the `/iga/*` surface documented below is the current API for a live admin panel. Do not mix the two.

---

## Change Request Lifecycle

Current `/iga/change-requests/...` surface (replaces legacy `/tide-admin/change-set/...`, confirmed by Tide 2026-07-07). **Full spec: `canon/iga-change-requests-api.md`.**

```
1. Admin performs a governed change (role assignment, group change, etc.)
   -> The write returns 202 Accepted; a change request is created (PENDING)
2. Admin reviews:  GET  /iga/change-requests?status=PENDING
3. Admin approves: POST /iga/change-requests/{id}/authorize   (body {} optional)
   -> Tide MultiAdmin mode: sign via the enclave two-phase exchange
      GET/POST /iga/change-requests/{id}/approval-model
   -> FirstAdmin / Tideless mode: authorize signs server-side, no popup
4. Once threshold met: POST /iga/change-requests/{id}/commit  (412 if under threshold)
5. Or reject:          POST /iga/change-requests/{id}/deny
```

`authorize` (simple lane: firstAdmin/Tideless) records an approval and **never commits** — it refuses tide-multiAdmin CRs. `approve` is the multiAdmin enclave lane: it approves AND auto-commits once quorum is met (this is the deployed console "Authorize" button). `commit` is the explicit apply-only step for a CR that already has enough approvals (412 if sub-quorum). Use `bulk-authorize` to act on many at once.

---

## Endpoints

### List / Get

```
GET  /iga/change-requests?status=PENDING     # PENDING|APPROVED|DENIED|CANCELLED
GET  /iga/change-requests/{id}               # single CR (keyed by `id`)
```

Each CR carries `id`, `entityType`, `actionType`, `status`, `readyToCommit`, `threshold`, `authorizers[]`, `dependsOn`/`blocked`. Derive dashboard counts from the list (there is no separate counts endpoint on the new surface; no per-type request endpoints and no `all/requests` path either).

### Authorize (Sign)

```
POST /iga/change-requests/{id}/authorize     # body {} optional  → 200/403/409 (409 = four-eyes)
POST /iga/change-requests/bulk-authorize     # {"actionTypeIn":["CREATE","DELETE"],"limit":100} → 429 if a bulk run is active
```

### Commit / Deny

```
POST /iga/change-requests/{id}/commit        # → 200 (APPROVED) / 412 (under threshold or unmet dependency)
POST /iga/change-requests/{id}/deny          # → 204
```

### Enclave Review (Tide MultiAdmin)

```
GET  /iga/change-requests/{id}/approval-model   # → { changeRequestId, requestModel(base64) }
POST /iga/change-requests/{id}/approval-model   # { "requestModel": "<base64 doken>" } → { recorded, authCount, threshold }
```

The two-phase `approval-model` exchange replaces the legacy `tideAdminResources/add-review`. In FirstAdmin / Tideless mode, `authorize` signs server-side and no enclave step is needed.

### Deprecated: add-review / add-rejection

```
POST /tideAdminResources/add-review               # 410 Gone (deprecated)
POST /tideAdminResources/add-rejection            # 410 Gone (deprecated)
```

Both endpoints were removed as part of the IGA decoupling and now return **`410 Gone`**. Approval goes through `/iga/change-requests/{id}/authorize` (plus the `approval-model` enclave exchange in Tide MultiAdmin mode) and rejection through `/iga/change-requests/{id}/deny`.

### Comments

```
GET/POST   /iga/change-requests/{id}/comments             # { "comment": "..." } (≤2000 chars)
PUT/DELETE /iga/change-requests/{id}/comments/{commentId}
```

There is no per-request `/activity` endpoint on the current surface; comments are the audit thread.

---

## TypeScript Client Usage

There is no `@keycloak/keycloak-admin-client` `KcAdminClient.tideUsersExt` extension on `tidecloak-js` main. The change-request surface is a hand-rolled fetch client, `AdminAPI` (`packages/tidecloak-js/src/AdminAPI.js`), exposed through `@tidecloak/react`. It targets the legacy bootstrap-compat `/tide-admin/change-set/*` endpoints:

```typescript
import { AdminAPI } from "@tidecloak/react";

const api = new AdminAPI({ baseUrl, realm, token });

// List (combines user + role change requests)
const pending = await api.getPendingChangeSets();
const userCrs = await api.getUserChangeRequests();
const roleCrs = await api.getRoleChangeRequests();

// Approve a single change set (sent as FormData, single object — not { changeSets: [...] })
await api.approveChangeSet({ changeSetId, actionType, changeSetType });

// Multi-admin: approve with an enclave signature
await api.approveChangeSetWithSignature(/* signed payload */);

// Commit
await api.commitChangeSet({ changeSetId, actionType, changeSetType });
```

There are no `getChangeSetCounts`, `getAllChangeSetRequests`, `getChangeSetActivity`, or `addChangeSetComment` methods. For a panel built on the current `/iga/*` surface, call the `/iga/change-requests/*` endpoints (see the **Endpoints** section above and `canon/iga-change-requests-api.md`) directly with `fetch` rather than via this SDK.

---

## Policy Management Endpoints

```
GET  /iga/forseti-contracts                      # List contracts
GET  /iga/forseti-contracts/{id}                 # Get one contract
POST /iga/forseti-contracts                      # Create a Forseti contract (POST, not PUT)
DELETE /iga/forseti-contracts/{id}               # Delete a contract
GET  /iga/role-policies                          # Roles with policy status
```

Create is `POST /iga/forseti-contracts` (there is no PUT). Policy-template, SSH-policy, and `role-policy/{roleId}/init-cert` endpoints are not part of the current surface.

---

## Change Request Taxonomy

The current surface does not use a `ChangeSetType` enum. Each change request carries two free-form String columns on `IgaChangeRequestEntity`:

- **`entityType`** — one of: `USER`, `REALM`, `ROLE`, `GROUP`, `CLIENT`, `CLIENT_SCOPE`, `ORGANIZATION`, `COMPOSITE_ROLE`, `CLIENT_SCOPE_CLIENT`, `CLIENT_SCOPE_ROLE`, `PROTOCOL_MAPPER`, `REALM_DEFAULT_SCOPE`, `SCOPE_MAPPING`.
- **`actionType`** — a free-form verb such as `CREATE`, `SET`, `UPDATE`, `ASSIGN`, or an `ADOPT_*` variant.

Read both values back from the `GET /iga/change-requests` response; do not hardcode a fixed enum. Some change requests (e.g. role creation and default-role adoption) commit automatically as part of the login-closure converge and never need an explicit authorize/commit; the rest require quorum authorize/commit. The master realm and IGA-disabled realms are exempt from governance entirely.

## Status Values

| Value | Meaning |
|-------|---------|
| `DRAFT` | Just created, not yet submitted for review |
| `PENDING` | Awaiting approvals |
| `APPROVED` | Enough approvals received, ready to commit |
| `DENIED` | Rejected by reviewer |
| `ACTIVE` | Committed and applied |

---

## Admin Panel Requirements

A working IGA admin panel must include:

1. **Pending list** -- Display change requests via `GET /iga/change-requests?status=PENDING` (keyed by `id`).

2. **Approve button** -- Triggers `POST /iga/change-requests/{id}/authorize` per selected CR (or `POST /iga/change-requests/bulk-authorize` for a batch).

3. **Enclave popup** -- In Tide MultiAdmin mode, complete the two-phase enclave exchange: `GET /iga/change-requests/{id}/approval-model` → sign in the enclave → `POST /iga/change-requests/{id}/approval-model` with the base64 doken. In FirstAdmin/Tideless mode, `authorize` signs server-side and no popup is needed.

4. **Batch support** -- Use `POST /iga/change-requests/bulk-authorize` (`{"actionTypeIn":[...],"limit":N}`) to approve many CRs at once; commit each ready CR (`readyToCommit === true`).

5. **Role check** -- Only users with admin roles should see the panel. Verify the admin token includes the required realm-admin or delegated role before rendering the UI. This is UI gating only; the server enforces authorization on every API call.

---

## Verification Checklist

### Lifecycle

- [ ] A governed write returns 202 and a change request appears via `GET /iga/change-requests?status=PENDING`
- [ ] `POST .../{id}/authorize` records an approval (409 if the same admin re-signs)
- [ ] In Tide MultiAdmin mode, the `approval-model` enclave exchange completes and increments `authCount`
- [ ] Committing a ready CR (`readyToCommit`) applies the change (APPROVED); 412 while under threshold
- [ ] `POST .../{id}/deny` removes it from the pending list (DENIED)

### Endpoints

- [ ] `GET /iga/change-requests?status=PENDING` returns all pending CRs across types
- [ ] `POST /iga/change-requests/{id}/authorize` records the approval
- [ ] `POST /iga/change-requests/bulk-authorize` authorizes a batch (429 if a bulk run is active)
- [ ] `POST /iga/change-requests/{id}/commit` applies the change; 412 under threshold
- [ ] `POST /iga/change-requests/{id}/deny` sets status to DENIED
- [ ] `GET/POST /iga/change-requests/{id}/comments` persist and read back
- [ ] `POST /tideAdminResources/add-review` and `/add-rejection` return `410 Gone` (deprecated — do not use)

### Authorization

- [ ] Unauthenticated requests return 401
- [ ] Non-admin tokens return 403
- [ ] Admin tokens with correct roles return 200

---

## Common Failures

### Enclave Step Skipped in Tide MultiAdmin Mode

**Symptom**: Approve appears to succeed but the change request stays in PENDING and `authCount` does not increase.

**Cause**: In Tide MultiAdmin mode, a bare `authorize` is not enough — the admin must sign the enclave challenge via the two-phase `approval-model` exchange.

**Fix**: `GET /iga/change-requests/{id}/approval-model`, decode `requestModel`, sign it in the Tide enclave, then `POST /iga/change-requests/{id}/approval-model` with `{ "requestModel": "<base64 doken>" }`. (FirstAdmin/Tideless mode signs server-side on `authorize` — no enclave step.)

---

### Committing Before Enough Approvals (412)

**Symptom**: `POST /iga/change-requests/{id}/commit` returns **412 Precondition Failed**.

**Cause**: The CR is under threshold, or a dependency has not committed yet.

**Fix**: Only commit CRs where `readyToCommit === true`. If still short, collect more approvals; if `blocked`, commit the CR named in `dependsOn` first (see the commit-in-passes loop in `canon/iga-change-requests-api.md`).

---

### Re-signing the Same CR (409)

**Symptom**: `POST /iga/change-requests/{id}/authorize` returns **409 Conflict**.

**Cause**: Four-eyes enforcement — the same admin cannot sign a CR twice, or the CR is no longer PENDING.

**Fix**: Have a *different* admin authorize, or refresh the list; do not retry the same admin's signature.

---

### Missing Authorization Header

**Symptom**: 401 on all admin API calls.

**Cause**: Admin token not included or expired.

**Fix**: Obtain a fresh admin token before each batch of calls and handle token refresh.

---

### Calling a Deprecated add-review / add-rejection Endpoint

**Symptom**: `POST /tideAdminResources/add-review` or `/add-rejection` returns `410 Gone`.

**Cause**: Both endpoints were removed in the IGA decoupling. They are no longer functional.

**Fix**: Approve via `POST /iga/change-requests/{id}/authorize` (passing the enclave-signed approval in the body) and reject via `POST /iga/change-requests/{id}/deny`.

---

## References

- Current surface: `IgaAdminResource` (`tidecloak-iga-extensions` iga-core) — `/iga/change-requests/*`, `/iga/forseti-contracts`, `/iga/role-policies`.
- Legacy bootstrap-compat surface: `/tide-admin/change-set/*`, still used by `localtest/init/init_tidecloak.sh` and the `tidecloak-js` `AdminAPI` client.
