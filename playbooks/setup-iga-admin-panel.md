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

> **Legacy `change-set` surface — do not use for new scripted provisioning.** The `tidecloak-js` `AdminAPI` client (`packages/tidecloak-js/src/AdminAPI.js`) still targets the older `/tide-admin/change-set/{type}/requests`, `/tide-admin/change-set/sign`, `/tide-admin/change-set/commit` surface (SDK not yet migrated). **However, the current `@tidecloak/create-nextjs` scaffolder (`tcinit.sh`) has been rewritten OFF that path onto the native `/iga/change-requests` surface**, and the legacy `change-set/{type}/sign|commit` endpoints 404 on current iga-core. New scripted bootstrap/provisioning MUST use `/iga/change-requests` (list `?status=PENDING` -> `POST .../{id}/approve` with body `{}`, which records and, at firstAdmin threshold-1, auto-commits). The `/iga/*` surface documented below is the current API for both scripted bootstrap and a live admin panel. Do not mix the two.

---

## Change Request Lifecycle

Current `/iga/change-requests/...` surface (replaces legacy `/tide-admin/change-set/...`, confirmed by Tide 2026-07-07). **Full spec: `canon/iga-change-requests-api.md`.**

```
1. Admin performs a governed change (role assignment, group change, etc.)
   -> The write returns 202 Accepted; a change request is created (PENDING)
2. Admin reviews:  GET  /iga/change-requests?status=PENDING
3. Admin approves: POST /iga/change-requests/{id}/approve     (body {})
   -> reply mode "recorded": done. FirstAdmin / Tideless, no popup.
   -> reply mode "needs-approval": sign the returned requestModel in the Tide enclave,
      then POST .../approve again with { "requestModel": "<base64>" }  (Tide MultiAdmin)
4. /approve commits by itself once quorum is met. Read `committed` in the reply.
5. Or reject:          POST /iga/change-requests/{id}/deny
```

`approve` is the **one lane for every mode**: the server decides which ceremony applies, records the approval and auto-commits once quorum is met. It is the only approval call the deployed admin console makes (VERIFIED 2026-10-07 against `keycloak-IGA` and iga-core, which agree). `authorize` is the older simple lane (firstAdmin/Tideless): it records an approval, **never commits**, and returns `409 MULTIADMIN_REQUIRES_APPROVAL_ENCLAVE` for tide-multiAdmin CRs. `commit` is the explicit apply-only step for a CR that already has enough approvals (412 if sub-quorum). Use `bulk-authorize` to act on many at once.

---

## Endpoints

### List / Get

```
GET  /iga/change-requests?status=PENDING     # PENDING|APPROVED|DENIED|CANCELLED
GET  /iga/change-requests/{id}               # single CR (keyed by `id`)
```

Each CR carries `id`, `entityType`, `actionType`, `status`, `readyToCommit`, `threshold`, `authorizers[]`, `dependsOn`/`blocked`. Derive dashboard counts from the list (there is no separate counts endpoint on the new surface; no per-type request endpoints and no `all/requests` path either).

### Approve

```
POST /iga/change-requests/{id}/approve   Body: {}
     → { mode: "recorded", committed, authCount, threshold, readyToCommit, status }      # done
     → { mode: "needs-approval", changeRequestId, actionType, requestModel(base64) }     # sign it, then:
POST /iga/change-requests/{id}/approve   Body: { "requestModel": "<base64 signed request>" }
     → { mode: "recorded", committed, authCount, threshold, readyToCommit, status }
```

Build a panel on this one endpoint. Send the admin's own token straight from the browser to TideCloak — never through your app server (AP-89). The enclave call accepts an array, so a batch can be signed in one popup and POSTed back per request.

### Authorize (older simple lane) and bulk

```
POST /iga/change-requests/{id}/authorize     # body {} optional  → 200/403/409 (409 = not PENDING, this admin already signed, or multiAdmin)
POST /iga/change-requests/bulk-authorize     # {"actionTypeIn":[...],"limit":100} or {"crIdIn":[...]} → 429 if a bulk run is active
# WARNING: "CREATE"/"DELETE" are NOT valid actionTypeIn values — real ones are granular
# (CREATE_USER, DELETE_REALM, UPDATE_PROTOCOL_MAPPER, ADOPT_SCOPE_MAPPING, GRANT_ROLES...).
# A wrong filter authorizes ZERO CRs and still returns 200; omitting it returns 400.
# Prefer per-id authorize. See canon/iga-change-requests-api.md.
```

### Commit / Deny

```
POST /iga/change-requests/{id}/commit        # → 200 (APPROVED) / 412 (under threshold or unmet dependency)
POST /iga/change-requests/{id}/deny          # → 204
```

### Enclave Review (Tide MultiAdmin)

The enclave step is the second call to `/approve` shown above. `GET`/`POST /iga/change-requests/{id}/approval-model` is the older exchange: still present as back-compat, does not commit, and no longer used by the console. Do not build on it.

### Deprecated: add-review / add-rejection

```
POST /tideAdminResources/add-review               # 410 Gone (deprecated)
POST /tideAdminResources/add-rejection            # 410 Gone (deprecated)
```

Both endpoints were removed as part of the IGA decoupling and now return **`410 Gone`**. Approval goes through `/iga/change-requests/{id}/approve` and rejection through `/iga/change-requests/{id}/deny`.

### Comments

```
GET/POST   /iga/change-requests/{id}/comments             # { "body": "..." } (≤2000 chars; `comment` also accepted)
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

> _Withheld: uploading a custom Forseti contract is done by the Tide team (experimental, test networks only). Do not reconstruct this step._

## Change Request Taxonomy

The current surface does not use a `ChangeSetType` enum. Each change request carries two free-form String columns on `IgaChangeRequestEntity`:

- **`entityType`** — one of: `USER`, `REALM`, `ROLE`, `GROUP`, `CLIENT`, `CLIENT_SCOPE`, `ORGANIZATION`, `COMPOSITE_ROLE`, `CLIENT_SCOPE_CLIENT`, `CLIENT_SCOPE_ROLE`, `PROTOCOL_MAPPER`, `REALM_DEFAULT_SCOPE`, `SCOPE_MAPPING`.
- **`actionType`** — a **granular** name, never a bare verb: `CREATE_USER`, `CREATE_ROLE`, `CREATE_GROUP`, `CREATE_CLIENT`, `CREATE_CLIENT_SCOPE`, `GRANT_ROLES`, `REVOKE_ROLES`, `JOIN_GROUPS`, `LEAVE_GROUPS`, `ADD_COMPOSITE`, `ASSIGN_SCOPE`, `ADD_PROTOCOL_MAPPER`, `UPDATE_PROTOCOL_MAPPER`, `UPDATE_CLIENT_REDIRECT_URIS`, `SET_REALM_ATTRIBUTE`, `SET_REALM_CONFIG`, `REGEN_ADMIN_POLICY`, `DISABLE_IGA`, `DELETE_REALM`, `OFFBOARD_REALM`, and the `ADOPT_*` family. There is no `CREATE`, `SET`, `UPDATE` or `ASSIGN` value; a filter on those matches nothing.

Read both values back from the `GET /iga/change-requests` response; do not hardcode a fixed enum. When IGA is first enabled on a firstAdmin realm, only an allow-list commits automatically (`ADOPT_*`, realm attribute/config, default scopes and groups). **`CREATE_ROLE`, `CREATE_CLIENT`, `CREATE_GROUP`, `CREATE_USER`, `ADD_PROTOCOL_MAPPER` and `GRANT_ROLES` stay pending** and need an explicit approve — earlier revisions of this file said role creation commits automatically, which it does not on `main`. The master realm and IGA-disabled realms are exempt from governance entirely.

## Status Values

| Value | Meaning |
|-------|---------|
| `PENDING` | Awaiting approvals. Use the `readyToCommit` field, not the status, to tell whether quorum is met |
| `APPROVED` | **Committed and applied.** It does not mean "ready to commit" |
| `DENIED` | Rejected by a reviewer |
| `CANCELLED` | Cancelled when IGA was switched off (resumable for `ADOPT_*` requests) |

There is no `DRAFT` and no `ACTIVE`. VERIFIED 2026-10-07: these four are the only values set anywhere in iga-core, and the admin console's type has no others.

---

## Admin Panel Requirements

A working IGA admin panel must include:

1. **Pending list** -- Display change requests via `GET /iga/change-requests?status=PENDING` (keyed by `id`).

2. **Approve button** -- Calls `POST /iga/change-requests/{id}/approve` with `{}` per selected CR and branches on the reply's `mode`.

3. **Enclave popup** -- When the reply is `mode: "needs-approval"`, sign the returned `requestModel` in the Tide enclave and POST it back to the same `/approve` endpoint as `{ "requestModel": "<base64>" }`. When the reply is `mode: "recorded"`, there is nothing to sign.

4. **Batch support** -- Loop `/approve` over the selection. Collect every `needs-approval` request, open the enclave **once** with the array, then POST each signed request back. This is what the admin console does; it does not call `bulk-authorize`.

   Count approvals from `authorizationCount`; if it is absent, fall back to `readyToCommit`, never to `0`.

5. **Role check** -- Only users with admin roles should see the panel. Verify the admin token includes the required realm-admin or delegated role before rendering the UI. This is UI gating only; the server enforces authorization on every API call.

---

## Verification Checklist

### Lifecycle

- [ ] A governed write returns 202 and a change request appears via `GET /iga/change-requests?status=PENDING`
- [ ] `POST .../{id}/approve` with `{}` replies `mode: "recorded"` (firstAdmin/Tideless) or `mode: "needs-approval"` (Tide MultiAdmin)
- [ ] In Tide MultiAdmin mode, the second `/approve` call with the signed `requestModel` increments `authCount` and commits at quorum
- [ ] Committing a ready CR (`readyToCommit`) applies the change (APPROVED); 412 while under threshold
- [ ] `POST .../{id}/deny` removes it from the pending list (DENIED)

### Endpoints

- [ ] `GET /iga/change-requests?status=PENDING` returns all pending CRs across types
- [ ] `POST /iga/change-requests/{id}/approve` records the approval and reports `committed`
- [ ] The approval request goes browser → TideCloak with the admin's own token, not through the app server (AP-89)
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

**Symptom**: The first `/approve` call returns `mode: "needs-approval"` and the panel treats that as success; the change request stays PENDING and `authCount` does not increase. With the older `authorize` endpoint the same mistake surfaces as `409 MULTIADMIN_REQUIRES_APPROVAL_ENCLAVE`.

**Cause**: In Tide MultiAdmin mode the admin must sign the request in the enclave. The first `/approve` call only hands back what to sign.

**Fix**: Base64-decode `requestModel`, sign it in the Tide enclave, then `POST /iga/change-requests/{id}/approve` with `{ "requestModel": "<base64 signed request>" }`. (FirstAdmin/Tideless replies `mode: "recorded"` straight away — no enclave step.)

---

### Committing Before Enough Approvals (412)

**Symptom**: `POST /iga/change-requests/{id}/commit` returns **412 Precondition Failed**.

**Cause**: The CR is under threshold, or a dependency has not committed yet.

**Fix**: Only commit CRs where `readyToCommit === true`. If still short, collect more approvals; if `blocked`, commit the CR named in `dependsOn` first (see the commit-in-passes loop in `canon/iga-change-requests-api.md`).

---

### Re-signing the Same CR (409)

**Symptom**: `POST /iga/change-requests/{id}/authorize` returns **409 Conflict**.

**Cause**: This admin has already signed the CR, the CR is no longer PENDING, or the realm is multiAdmin and `authorize` cannot sign it. This is once-per-caller counting, not a requester-cannot-approve rule: iga-core lets the person who filed a request approve it.

**Fix**: Refresh the list. If more approvals are needed, a *different* admin must approve. Calling `/approve` again as the same admin is safe: it re-runs the commit gates instead of returning 409.

---

### Missing Authorization Header

**Symptom**: 401 on all admin API calls.

**Cause**: Admin token not included or expired.

**Fix**: Obtain a fresh admin token before each batch of calls and handle token refresh.

---

### Calling a Deprecated add-review / add-rejection Endpoint

**Symptom**: `POST /tideAdminResources/add-review` or `/add-rejection` returns `410 Gone`.

**Cause**: Both endpoints were removed in the IGA decoupling. They are no longer functional.

**Fix**: Approve via `POST /iga/change-requests/{id}/approve` (the signed request goes in the body as `{ "requestModel": "<base64>" }`) and reject via `POST /iga/change-requests/{id}/deny`.

---

## References

- Legacy `/tide-admin/change-set/*`: **removed**. iga-core `main` serves no such route, so any caller still targeting it (older scripts, the `tidecloak-js` `AdminAPI` client) cannot work against a current server.
