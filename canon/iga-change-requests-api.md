# IGA / QEA Change-Requests API (current surface)

The authoritative REST surface for IGA (QEA — Quorum Enforced Authorization) change requests. **VERIFIED** (source: `tide-foundation/tidecloak-iga-extensions` → `docs/qea-iga-api.md`, iga-core; confirmed by Tide 2026-07-07, GAP-065).

**This `/iga/change-requests/...` surface REPLACES the legacy `/tide-admin/change-set/...` surface.** The legacy routes are **removed**, not deprecated: `tidecloak-iga-extensions` `main` serves no `/tide-admin/change-set/*` route at all. Enabling IGA is still `POST /tide-admin/toggle-iga` (realm attribute `isIGAEnabled="true"`).

> ### Source audit 2026-10-07
>
> This file was re-checked against `tidecloak-iga-extensions` `main` (`f093800`, iga-core
> `IgaAdminResource`) and the admin console in `keycloak-IGA` (`26.7.5-IGA-main`). Statements both
> sources agree on are corrected in place. Where `main` differs from something this file records as
> **measured on a live instance**, the measurement is kept and the difference is flagged
> **DIFFERS ON `main`** — the released build may predate `main`, and nothing here was re-run. Settle
> those with a live check before relying on either side.
>
> ⚠️ **`toggle-iga` — DIFFERS ON `main`.** On `main` it is a **flip**: the `isIGAEnabled` form
> parameter is bound but never read, and each call inverts the current state. Calling it on a realm
> that already has IGA on files a **`DISABLE_IGA`** change request and returns 202. So: read
> `GET /tide-admin/iga-status` first, call `toggle-iga` only when it is off, and assert
> `"enabled": true` in the response. Never call it twice.

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
| **Approve — the one lane for every mode** | `POST /iga/change-requests/{id}/approve` | `{}` first; `{"requestModel":"<base64>"}` second, only if asked | 200 `{mode:"recorded", committed, authCount, threshold, readyToCommit, status}` or 200 `{mode:"needs-approval", requestModel, ...}` (**auto-commits once quorum is met**) | 403, 409, 412 |
| Authorize (sign) — simple lane, back-compat | `POST /iga/change-requests/{id}/authorize` | `{}` (optional) | 200, updated CR (**does not commit**) | 403 (missing approver role), 409 (not PENDING / this caller already signed / `MULTIADMIN_REQUIRES_APPROVAL_ENCLAVE`) |
| Commit — back-compat | `POST /iga/change-requests/{id}/commit` | — | 200 `{committed:true, changeRequestId, status, changeRequest}` | 412 (`QUORUM_NOT_MET`, `DEPENDENCY_NOT_MET`, `PENDING_ADMIN_GRANTS`, `ADMIN_QUORUM_FLOOR`), 409, 404 `ENTITY_VANISHED`, 429 |
| Edit pending CR | `PUT /iga/change-requests/{id}` | `{"rows":[...]}` | 200, updated CR. **Deletes every existing authorization on the CR.** | 404, 400 (no `rows`) |
| Deny | `POST /iga/change-requests/{id}/deny` | optional `{"reason":"..."}` | 204 | 404 |
| Bulk authorize | `POST /iga/change-requests/bulk-authorize` | `{"actionTypeIn":["ADOPT_ROLE","CREATE_USER"],"limit":100}` or `{"crIdIn":["<id>",...]}` | 200, `{results:[...], summary:{...}}` (per-CR failures are still HTTP 200) | 400 (no selector, or `limit` over 1000), 429 (a bulk run is already in progress — per-realm mutex) |

**`status`** values: `PENDING`, `APPROVED`, `DENIED`, `CANCELLED`. There is no `DRAFT` and no `ACTIVE`. **`APPROVED` means committed and applied**, not "ready to commit". `CANCELLED` comes from switching IGA off and is resumable for `ADOPT_*` requests.

⚠️ **`deny` and `PUT` do not check the status.** Denying an already-`APPROVED` request relabels it `DENIED` **without undoing the change**. Editing a request wipes its approvals. Only call either on a request you have just read as `PENDING`.

### `authorize` vs `approve` vs `commit` — do not conflate

Three server operations (source: iga-core `IgaAdminResource`). The button label in the admin console is **not** the same as the REST verb:

- **`POST .../{id}/approve`** — **the unified lane, for every mode.** The server decides which ceremony applies; the caller does not probe the mode. Call it with an empty body and branch on `mode` (see the next section). It records the approval **and auto-commits once quorum is met**. This is the only approval endpoint the admin console calls — for single approvals, and in a client-side loop for "Bulk Authorize".
- **`POST .../{id}/authorize`** — the older **simple lane** (FirstAdmin / Tideless). Records the caller's approval and **never commits**; commit is a separate step. Refuses MultiAdmin requests with `409 MULTIADMIN_REQUIRES_APPROVAL_ENCLAVE` (except `ADOPT_*`). Source marks it deprecated / back-compat; it still exists and the bootstrap loop below still uses it.
- **`POST .../{id}/commit`** — explicit **apply-only** step, back-compat. Used after a simple-lane `authorize` reaches threshold.

A caller who has already signed gets the commit gates re-run by `/approve` rather than a 409 — that is how a stuck request is re-driven. `authorize` returns 409 for the same case.

**`PUT /iga/change-requests/{id}`** (`updateChangeRequest` → `service.updateRows()`) replaces a CR's `rows` payload; body `{"rows":[...]}`.

**Bulk-authorize: measured as authorize-only; DIFFERS ON `main`.** This file recorded that it authorizes without committing, so the pattern below commits afterwards. On `main`, `processOneCr` records **and commits** each matched request, and each result carries `status: COMMITTED | REJECTED | SKIPPED`. Read `results[].status` and `summary` rather than assuming either. Both "Bulk Authorize" and "Bulk Commit" in the admin console are client-side loops (over `/approve` and `/commit`), not this endpoint.

### Two-phase MultiAdmin approval (Tide mode enclave)

In Tide mode (`iga.attestor=tide`) with MultiAdmin, the simple `authorize` lane refuses the CR. Approval goes through **two calls to the same `/approve` endpoint**. VERIFIED 2026-10-07 against both iga-core and the admin console (`keycloak-IGA` `approvalModel.ts`), which agree:

```
Phase 1:  POST /iga/change-requests/{id}/approve      body: {}
          → 200 {"mode":"recorded", "committed":<bool>, "authCount":N, "threshold":M, "readyToCommit":<bool>, "status":"..."}
               — FirstAdmin / Tideless, or this caller already signed: nothing more to do.
          → 200 {"mode":"needs-approval", "changeRequestId":"...", "actionType":"...", "requestModel":"<base64>", "authCount":N, "threshold":M}
               — base64-decode requestModel, present it to the Tide enclave, the admin signs.

Phase 2:  POST /iga/change-requests/{id}/approve      body: {"requestModel":"<base64 of the signed request>"}
          → 200 {"mode":"recorded", "changeRequestId":"...", "committed":<bool>, "authCount":N, "threshold":M, "readyToCommit":<bool>, "status":"..."}
```

There is no `recorded` boolean; read `mode` and `committed`. The enclave call takes an **array**, so
a whole batch can be signed in one popup and then POSTed back per request.

`GET` / `POST .../{id}/approval-model` is the older exchange. It still exists as back-compat, replies
`{changeRequestId, recorded, authCount, threshold, readyForCommit}`, and **does not commit**. The
admin console no longer uses it. Use `/approve`.

> ## ⚠️ APPROVALS ARE CREDITED TO THE CALLER, NOT THE DOKEN SUBJECT
>
> `approve` records the approval against **whoever authenticated the HTTP request**. Proxy it
> through your app server — which authenticates as the Skycloak automation client, or any service
> account — and **every human enclave signature is recorded under that service account**.
>
> The tally then sticks at `1/2` no matter how many humans approve. Measured on a live deployment
> (LEARNINGS-nightfabric-001 L-03).
>
> **Why — corrected 2026-10-07.** This file used to say "filing a change request auto-authorises
> the filer". iga-core `main` contains no such rule: `create()` stores no authorization. The cause is
> that **each caller counts once**. Every proxied approval arrives as the same service account, so
> only the first is recorded — and once that account has signed, `/approve` skips the enclave for it
> entirely and answers `mode:"recorded"`, so later humans are never even shown a request to sign.
> (Whether some other module also records the filer was not established.)
>
> **This is a security bug, not cosmetics.** A service account that can both propose and approve
> holds two of the votes the quorum exists to split.
>
> **Send governed approvals to TideCloak directly from the admin's browser, with the admin's own
> DPoP-bound token.** Never through a server-side proxy holding a different identity. The realm's
> CORS already permits the app origin and the `DPoP` header, so browser → TideCloak works.

> ⚠️ **Read the approval count from `authorizationCount`, and never default it to `0`.**
> The list object uses **`authorizationCount`** (number) and **`authorizers[]`**
> (`{username, timestamp}`) — not `authCount` or `approvals`. Reading
> `authCount ?? approvals?.length ?? 0` renders "0/1 signed" next to `readyToCommit: true`: the UI
> reports the signature missing at the same moment it reports the CR ready. If the count field is
> absent, fall back to **`readyToCommit`**, not to zero. (The `authCount` in the Phase-2 response
> above is that endpoint's own reply shape; do not carry it over to the list object.)

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
relatedPolicyCrId                   # links a tide-realm-admin grant to its pending REGEN_ADMIN_POLICY request
finalSignature, denyReason
```

**Use `id` for all per-CR operations** (this replaces the legacy `draftRecordId`). `entityType`/`actionType` replace the legacy `changeSetType`/`changeSetType`+`actionType` fields, and there is no `{changeSets:[...]}` request envelope anymore — operations are per-`id`.

---

## Comments

```
GET    /iga/change-requests/{id}/comments                 → 200 array
POST   /iga/change-requests/{id}/comments   {"body":"text"}  (≤2000 chars) → 201   # the console sends `body`; the server also accepts `comment`
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
| 409 | CR not PENDING, this caller already signed, `MULTIADMIN_REQUIRES_APPROVAL_ENCLAVE`, or a second write to an entity that already has a pending CR (`PENDING_CHANGE_REQUEST_CONFLICT`, with `conflictingChangeRequestId`). There is **no** requester-cannot-approve rule in iga-core: the filer may approve their own request |
| 412 | Under threshold, or a dependency is unmet |
| 429 | `bulk-authorize` already running (per-realm mutex) |

## Threshold & approver resolution

- `ADOPT_*` CRs short-circuit to threshold 1 (no approver-role check).
- Otherwise the entity-level `iga.threshold` applies **only if that entity also sets `iga.approverRole`** (the coupling rule); else the realm `iga.threshold`; else 1 (clamped `max(1, …)` — the gate can't be disabled).
- **FirstAdmin** mode (fresh realm, before any `tide-realm-admin`): threshold 1, any `manage-realm` admin signs, server-side VRK, no enclave.
- **MultiAdmin** (Tide): enclave signature required. The commit gate uses the threshold **encoded in the signed `tide-realm-admin` policy**, which only changes when a `REGEN_ADMIN_POLICY` request commits. `max(1, floor(0.7 × active tide-realm-admins))` is the fallback and the projected next value, not the live gate.
- **`OFFBOARD_REALM`** needs at least `iga.offboardMinAdmins` distinct approvals (default **3**), even in FirstAdmin mode. A single-admin realm cannot offboard.
- Removing an admin can be refused: a `tide-realm-admin` revoke that would leave fewer admins than the in-force threshold returns `412 ADMIN_QUORUM_FLOOR`.

---

## Bootstrap pattern (FirstAdmin / Tideless — fully automatable)

During bootstrap the realm is in FirstAdmin (or Tideless) mode, so `authorize` signs server-side and the whole loop is scriptable: **authorize every pending CR → commit the ready ones, in dependency passes.**

> **Use the per-id form. Do NOT filter `bulk-authorize` by `actionTypeIn: ["CREATE","DELETE"]`.**
> `CREATE` and `DELETE` are **not** action-type values. Real values are granular:
> `CREATE_USER`, `DELETE_REALM`, `UPDATE_PROTOCOL_MAPPER`, `ADOPT_SCOPE_MAPPING`,
> `ADOPT_DEFAULT_CLIENT_SCOPE`, `GRANT_ROLES`, …
> That filter matches nothing and **silently authorizes zero CRs** — `summary.total: 0`
> and a 200, so the bootstrap looks like it worked and then fails later when the
> admin user "doesn't exist". Omitting `actionTypeIn` entirely returns **400**.
> VERIFIED on a live instance 2026-08-04.

```bash
# $TC = base url, $REALM = realm, get_token() mints a fresh admin token.
approve_all_pending() {
  local TOKEN ids id ready
  for pass in 1 2 3 4 5; do
    # 1. Authorize every pending CR individually. FirstAdmin/Tideless: the server
    #    signs with the VRK / records the username — no enclave popup.
    TOKEN="$(get_token)"
    ids=$(curl -s "$TC/admin/realms/$REALM/iga/change-requests?status=PENDING" \
      -H "Authorization: Bearer $TOKEN" | jq -r 'if type=="array" then (.[] | select(.actionType | IN("DISABLE_IGA","DELETE_REALM","OFFBOARD_REALM") | not) | .id) else empty end')
    [ -z "$ids" ] && break
    for id in $ids; do
      TOKEN="$(get_token)"
      curl -s -X POST "$TC/admin/realms/$REALM/iga/change-requests/$id/authorize" \
        -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}' > /dev/null
    done

    # 2. Commit everything now ready. Looping passes lets dependent CRs
    #    (a role must exist before its assignment) become ready and commit.
    TOKEN="$(get_token)"
    ready=$(curl -s "$TC/admin/realms/$REALM/iga/change-requests?status=PENDING" \
      -H "Authorization: Bearer $TOKEN" \
      | jq -r 'if type=="array" then (.[] | select(.actionType | IN("DISABLE_IGA","DELETE_REALM","OFFBOARD_REALM") | not) | select(.readyToCommit==true) | .id) else empty end')
    [ -z "$ready" ] && break
    for id in $ready; do
      TOKEN="$(get_token)"
      curl -s -X POST "$TC/admin/realms/$REALM/iga/change-requests/$id/commit" \
        -H "Authorization: Bearer $TOKEN" > /dev/null
    done
  done
}
```

Call `approve_all_pending` at each stage that produces CRs (after client creation, after user creation, after role assignment).

> ⚠️ **A drain must not approve everything it finds.** `DISABLE_IGA`, `DELETE_REALM` and
> `OFFBOARD_REALM` are change requests too. An unfiltered loop will authorize and commit them — and a
> stray second `toggle-iga` call is enough to queue a `DISABLE_IGA`. Skip those three action types
> unless that outcome is exactly what you intend:
>
> ```bash
> jq -r '.[] | select(.actionType | IN("DISABLE_IGA","DELETE_REALM","OFFBOARD_REALM") | not) | .id'
> ```
>
> The pack's own scripts apply this filter.

**Realm deletion is itself a governed CR.** On an IGA-enabled realm, `DELETE /admin/realms/{realm}` returns **202** with a `DELETE_REALM` change request rather than deleting. Authorize + commit it, then re-check for a 404. Disabling IGA first may return **409**, so go through the CR.

**Verify, don't assume.** After a drain, assert `PENDING` is 0 — a silently-zero authorize is the failure mode this pattern exists to prevent:

```bash
curl -s "$TC/admin/realms/$REALM/iga/change-requests?status=PENDING" \
  -H "Authorization: Bearer $(get_token)" | jq 'length'   # → 0
```

**Status: VERIFIED end-to-end on a live instance (TideCloak 0.14.17, hosted + local, 2026-08-06).**

### The automation cliff — grant `tide-realm-admin` LAST

Committing the **first** `tide-realm-admin` grant flips the realm **FirstAdmin → MultiAdmin**. From that moment the simple lane is closed for everything except `ADOPT_*` requests:

```
409 MULTIADMIN_REQUIRES_APPROVAL_ENCLAVE
"multiAdmin change requests must be approved via the approval enclave
 (POST /iga/change-requests/{id}/approve); the simple authorize/commit path
 cannot sign a multiAdmin change request."
```

This is the security model working: governed changes need a browser enclave signature so a stolen automation credential cannot rewrite realm config.

**Do every governed write before the grant** — realm import, licensing, IGA enablement, `_tide_*` roles, client config including **all** redirect URIs and web origins, and the admin user. Grant `tide-realm-admin` last, then drain once. Anything you forget becomes a manual enclave approval in the admin console (`{base}/admin/{realm}/console/` → Change Requests) for the life of the realm.

---

## Old → new migration map

| Legacy (`/tide-admin/change-set/...`) | Current (`/iga/change-requests/...`) |
|----------------------------------------|--------------------------------------|
| `GET .../change-set/{type}/requests` | `GET /iga/change-requests?status=PENDING` |
| `GET .../change-set/counts` | (derive from the list, or use diagnostics) |
| `POST .../change-set/sign/batch` `{changeSets:[{changeSetId,changeSetType,actionType}]}` | `POST /iga/change-requests/{id}/authorize` `{}` (per id); batch: `POST /iga/change-requests/bulk-authorize` |
| `POST .../change-set/commit/batch` `{changeSets:[...]}` | `POST /iga/change-requests/{id}/commit` |
| `POST .../change-set/cancel/batch` | `POST /iga/change-requests/{id}/deny` |
| `POST .../tideAdminResources/add-review` (enclave; now returns **410 Gone**) | `POST /iga/change-requests/{id}/approve` (two calls — see above) |
| field `draftRecordId` | field `id` |
| fields `changeSetType` + `actionType` | fields `entityType` + `actionType` |
| toggle `POST /tide-admin/toggle-iga` | **unchanged** |

## Status Legend

- **VERIFIED** — from the canonical `qea-iga-api.md` (iga-core)
- **REQUIRES_RUNTIME_VALIDATION** — bootstrap loop not yet exercised end-to-end against a live instance
