# IGA / QEA Change-Requests API (current surface)

The authoritative REST surface for IGA (QEA — Quorum Enforced Authorization) change requests. **VERIFIED** (source: `tide-foundation/tidecloak-iga-extensions` → `docs/qea-iga-api.md`, iga-core; confirmed by Tide 2026-07-07, GAP-065).

**This `/iga/change-requests/...` surface REPLACES the legacy `/tide-admin/change-set/...` surface.** The old surface (documented in the repo-root `CHANGE_REQUESTS_API.md`) is stale — do not use it for new work. Enabling IGA is unchanged: `POST /tide-admin/toggle-iga` (realm attribute `isIGAEnabled="true"`).

For the security/trust implications and the Tide-vs-Tideless mode split, see `canon/feature-mapping.md` (IGA Quorum Approval), `canon/invariants.md` (I-10), and `canon/security-gap-mapping.md` (IGA-model note).

---

## Base path & auth

```
{keycloak-url}/admin/realms/{realm}/iga/...
{keycloak-url}/admin/realms/{realm}/iga-tve/...      # TVE diagnostic bundles
{keycloak-url}/admin/realms/{realm}/tide-admin/...   # toggle-iga, legacy
```

Header: `Authorization: Bearer $TOKEN` — requires `manage-realm` (some reads are lighter, noted below).

---

## Change-request lifecycle

| Step | Method + path | Body | Success | Notable failures |
|------|---------------|------|---------|------------------|
| A governed admin write is captured | (the original admin call, e.g. assign role) | — | **202 Accepted** + `Location` header → the new CR | — |
| List pending | `GET /iga/change-requests?status=PENDING` | — | 200, array of CR objects | — |
| Get one | `GET /iga/change-requests/{id}` | — | 200 | 404 |
| Authorize (sign) — simple lane | `POST /iga/change-requests/{id}/authorize` | `{}` (optional) | 200, updated CR (**does not commit**) | 403 (missing approver role), 409 (not PENDING / already signed / conflicting CR / a MultiAdmin CR) |
| Approve — MultiAdmin enclave lane | `POST /iga/change-requests/{id}/approve` | enclave approval payload | 200, updated CR (**auto-commits once quorum met**) | 403, 409, 412 |
| Commit | `POST /iga/change-requests/{id}/commit` | — | 200, CR now APPROVED | 412 (under threshold or unmet dependency) |
| Edit pending CR | `PUT /iga/change-requests/{id}` | `{"rows":[...]}` | 200, updated CR | 404, 409 (not PENDING) |
| Deny | `POST /iga/change-requests/{id}/deny` | — | 204 | 404 |
| Bulk authorize | `POST /iga/change-requests/bulk-authorize` | `{"actionTypeIn":["CREATE","DELETE"],"limit":100}` | 200, `{results:[...], summary:{...}}` | 429 (a bulk run is already in progress — per-realm mutex) |

**`status`** values: `PENDING`, `APPROVED`, `DENIED`, `CANCELLED`.

### `authorize` vs `approve` vs `commit` — do not conflate

Three distinct server operations (source: `IgaAdminResource` on origin/main). The button label in the admin console is **not** the same as the REST verb:

- **`POST .../{id}/authorize`** (`IgaAdminResource:529`) — the **simple lane** (FirstAdmin / Tideless). Records the caller's approval and **NEVER commits**: even when `authCount >= threshold` the server does *not* call `combineFinal()`; commit is a separate explicit step. **Refuses tide-MultiAdmin CRs.**
- **`POST .../{id}/approve`** (`IgaAdminResource:1096`) — the **MultiAdmin enclave lane**. Consumes the enclave approval and **approves AND auto-commits once quorum is met**. This is what the deployed admin console's **"Authorize" button** calls (button label ≠ REST `/authorize`).
- **`POST .../{id}/commit`** — explicit **apply-only** step (`412` if still sub-quorum / dependency unmet). Used after a simple-lane `authorize` reaches threshold.

**`PUT /iga/change-requests/{id}`** (`IgaAdminResource:1848`, `updateChangeRequest` → `service.updateRows()`) edits a still-`PENDING` CR's `rows` payload; body `{"rows":[...]}`.

**Bulk-authorize authorizes; it does not commit.** After bulk-authorize, commit the CRs that became `readyToCommit` (see the bootstrap pattern below). ("Bulk Commit" in the admin UI is a client-side loop, not a server endpoint.)

### Two-phase MultiAdmin approval (Tide mode enclave)

In Tide mode (`iga.attestor=tide`) with MultiAdmin, the simple `authorize` lane refuses the CR; approval instead goes through `approve`, which requires an enclave signature obtained via the approval-model exchange:

```
Phase 1:  GET  /iga/change-requests/{id}/approval-model
          → 200 {"changeRequestId":"...","requestModel":"<base64>"}
          (decode requestModel, present to the Tide enclave, admin signs → base64 doken)

Phase 2:  POST /iga/change-requests/{id}/approve   (MultiAdmin enclave lane — approves and auto-commits at quorum)
          Body: the enclave approval / {"requestModel":"<base64 doken>"}
          → 200 {"recorded":true,"authCount":N,"threshold":M}
```

**This is the automation boundary.** In FirstAdmin mode (fresh realm before any `tide-realm-admin`) and in Tideless mode, the simple-lane `authorize` signs server-side with no enclave popup (then `commit` applies), so bootstrap is fully automatable. In Tide MultiAdmin mode a human must sign the enclave challenge for `approve`.

---

## Change-request object (response fields)

```
id, realmId, entityType, entityId, actionType,
status,                       # PENDING | APPROVED | DENIED | CANCELLED
requestedBy, createdAt, resolvedAt, resolvedBy,
rows,                         # payload replayed on commit
authorizationCount, authorizers[], threshold,
readyToCommit,                # boolean — safe to commit now
requiredApproverRoles, scopeMode,   # scopeMode: "any" | "all"
dependsOn, blocked, blockedReason   # dependency gating
```

**Use `id` for all per-CR operations** (this replaces the legacy `draftRecordId`). `entityType`/`actionType` replace the legacy `changeSetType`/`changeSetType`+`actionType` fields, and there is no `{changeSets:[...]}` request envelope anymore — operations are per-`id`.

---

## Comments

```
GET    /iga/change-requests/{id}/comments                 → 200 array
POST   /iga/change-requests/{id}/comments   {"comment":"text"}  (≤2000 chars) → 201
PUT    /iga/change-requests/{id}/comments/{commentId}     → 200 (author only)
DELETE /iga/change-requests/{id}/comments/{commentId}     → 204 (author or realm admin)
```

## Manual ADOPT

```
POST /iga/adopt   {"entityType":"USER","entityId":"..."}   → 201 | 409 (ALREADY_ATTESTED)
```

## Role policies (M0 admin policy)

```
GET    /iga/role-policies                         # read: authenticated, no manage-realm
GET    /iga/role-policies/{id}
GET    /iga/role-policies/name/tide-realm-admin
POST   /iga/role-policies   {"name":"...","policy":"<base64>","policySig":"..."}   # 403 if name="tide-realm-admin"
DELETE /iga/role-policies/{id}
DELETE /iga/role-policies/name/{name}
```

## Diagnostics

```
GET  /iga/change-requests/{id}/diagnostic-bundle
     → {"diag_kind":"iga_cr_bundle","schema_version":1,"cr":{...},"authorizations":[...],"threshold":N,"approver_role":"..."}
POST /iga-tve/tve-bundle   {"mode":"synthesize|pasted","clientId":"...","userId":"..."}   (Accept: application/json | application/cbor)
```

---

## Status codes (summary)

| Code | Meaning |
|------|---------|
| 202 | Governed action captured into a CR (`Location` → the CR) |
| 400 | Malformed body / missing field |
| 403 | Missing approver role |
| 404 | Unknown CR or the entity vanished |
| 409 | CR not PENDING, already signed, or a conflicting CR exists (four-eyes) |
| 412 | Under threshold, or a dependency is unmet |
| 429 | `bulk-authorize` already running (per-realm mutex) |

## Threshold & approver resolution

- `ADOPT_*` CRs short-circuit to threshold 1 (no approver-role check).
- Otherwise the entity-level `iga.threshold` applies **only if that entity also sets `iga.approverRole`** (the coupling rule); else the realm `iga.threshold`; else 1 (clamped `max(1, …)` — the gate can't be disabled).
- **FirstAdmin** mode (fresh realm, before any `tide-realm-admin`): threshold 1, any `manage-realm` admin signs, server-side VRK, no enclave.
- **MultiAdmin** (Tide): dynamic floor `max(1, floor(0.7 × active tide-realm-admins))` unless overridden; enclave signature required.

---

## Bootstrap pattern (FirstAdmin / Tideless — fully automatable)

During bootstrap the realm is in FirstAdmin (or Tideless) mode, so `authorize` signs server-side and the whole loop is scriptable. Replace the legacy per-type `sign`+`commit` calls with: **authorize all pending → commit the ready ones, in dependency passes.**

```bash
# $TC = base url, $REALM = realm, get_token() mints a fresh admin token.
approve_all_pending() {
  local TOKEN
  # 1. Authorize every pending CREATE/DELETE change request in one call.
  #    FirstAdmin/Tideless: server signs with VRK / records username — no enclave.
  TOKEN="$(get_token)"
  curl -s -X POST "$TC/admin/realms/$REALM/iga/change-requests/bulk-authorize" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"actionTypeIn":["CREATE","DELETE"],"limit":100}' > /dev/null

  # 2. Commit everything that is ready. Loop a few passes so dependent CRs
  #    (e.g. a role must exist before its assignment) become ready and commit.
  for pass in 1 2 3 4 5; do
    TOKEN="$(get_token)"
    local ready
    ready=$(curl -s "$TC/admin/realms/$REALM/iga/change-requests?status=PENDING" \
      -H "Authorization: Bearer $TOKEN" | jq -r '.[] | select(.readyToCommit==true) | .id')
    [ -z "$ready" ] && break
    for id in $ready; do
      TOKEN="$(get_token)"
      curl -s -X POST "$TC/admin/realms/$REALM/iga/change-requests/$id/commit" \
        -H "Authorization: Bearer $TOKEN" > /dev/null
    done
  done
}
```

Call `approve_all_pending` at each stage that produces CRs (after client creation, after user creation, after role assignment) — the same stage points as the legacy script, but it now lists **all** pending CRs at once rather than per type.

**Per-id alternative** (if you prefer not to use bulk-authorize):

```bash
TOKEN="$(get_token)"
for id in $(curl -s "$TC/admin/realms/$REALM/iga/change-requests?status=PENDING" \
              -H "Authorization: Bearer $TOKEN" | jq -r '.[].id'); do
  TOKEN="$(get_token)"
  curl -s -X POST "$TC/admin/realms/$REALM/iga/change-requests/$id/authorize" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}' > /dev/null
done
# then the same commit-in-passes loop as above
```

**Status of the bootstrap pattern: VERIFIED against the API spec; REQUIRES_RUNTIME_VALIDATION against a live iga-core instance.** The endpoint paths, payloads, and status codes are from the canonical `qea-iga-api.md`; the exact loop/ordering has not yet been run end-to-end here. Validate on a live instance and adjust the pass count / dependency handling if a CR stays `blocked`.

---

## Old → new migration map

| Legacy (`/tide-admin/change-set/...`) | Current (`/iga/change-requests/...`) |
|----------------------------------------|--------------------------------------|
| `GET .../change-set/{type}/requests` | `GET /iga/change-requests?status=PENDING` |
| `GET .../change-set/counts` | (derive from the list, or use diagnostics) |
| `POST .../change-set/sign/batch` `{changeSets:[{changeSetId,changeSetType,actionType}]}` | `POST /iga/change-requests/{id}/authorize` `{}` (per id); batch: `POST /iga/change-requests/bulk-authorize` |
| `POST .../change-set/commit/batch` `{changeSets:[...]}` | `POST /iga/change-requests/{id}/commit` |
| `POST .../change-set/cancel/batch` | `POST /iga/change-requests/{id}/deny` |
| `POST .../tideAdminResources/add-review` (enclave) | `POST /iga/change-requests/{id}/approval-model` |
| field `draftRecordId` | field `id` |
| fields `changeSetType` + `actionType` | fields `entityType` + `actionType` |
| toggle `POST /tide-admin/toggle-iga` | **unchanged** |

## Status Legend

- **VERIFIED** — from the canonical `qea-iga-api.md` (iga-core)
- **REQUIRES_RUNTIME_VALIDATION** — bootstrap loop not yet exercised end-to-end against a live instance
