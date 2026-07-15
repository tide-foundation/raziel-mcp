# IGA Admin Governance — Role & Policy Matrix

---

## Tide Bootstrap Roles

| Role | Type | Purpose | Created by | Approved by | Required before first use | Default / optional | Notes |
|------|------|---------|-----------|-------------|--------------------------|-------------------|-------|
| `_tide_enabled` | Realm | Enables Tide voucher system for all users | Realm template | Auto (in default composite) | Yes | Default | Must be in `default-roles-{realm}` composite |
| `tide-realm-admin` | Client (`realm-management`) | Full admin access to TideCloak governance | Built-in | IGA quorum (after first admin) | Yes | Default for admins | This is a **client role**, not a realm role. Do not use `hasRealmRole('tide-realm-admin')`. |

---

## Application Roles

This scenario does not define app-specific roles beyond the admin role. The governance panel serves admins who already have `tide-realm-admin`.

Apps that embed the governance panel alongside user-facing features may add their own application roles (e.g., `admin`, `manager`). These are separate from `tide-realm-admin` and do not affect IGA governance behavior.

---

## Key rules

1. **`tide-realm-admin` is a client role on `realm-management`**. Check it with `hasClientRole('tide-realm-admin', 'realm-management')` on the client side, or check `resource_access['realm-management'].roles` in the server-side JWT payload.

2. **Quorum requires at least two linked admin users.** A single admin operates in FirstAdmin mode (VRK-signed, no popup). Two or more admins operate in MultiAdmin mode (enclave challenge popup).

3. **All admin mutations in an IGA-enabled realm create draft change requests.** These must be signed and committed before they take effect. The governance panel is the tool for this.

4. **Change-set types are fixed by TideCloak.** The app does not define new types. Known types: `USER`, `USER_ROLE`, `COMPOSITE_ROLE`, `CLIENT`, `GROUP_ROLE`, `GROUP_MEMBERSHIP`, `GROUP_MOVE`, `REALM_LICENSE`, `POLICY`, `DEFAULT_ROLES`, `REALM_SETTINGS`, `RAGNAROK`.

5. **`DEFAULT_ROLES` and role creation are ACTIVE (auto-approved).** They appear in the change-set list for audit but do not require sign/commit. All other types require quorum approval.

6. **Quorum threshold**: `max(1, floor(TotalAdmins * 0.7))`. Not configurable by the app.

---

## Policy Layer (optional features)

The governance panel may optionally include policy management. These are NOT required for the core change-request workflow.

| Feature | Endpoint pattern | Purpose | Notes |
|---------|-----------------|---------|-------|
| Realm policy | `GET/POST/DELETE /tide-admin/realm-policy/*` | View and manage the realm-level Forseti policy | Lifecycle: none → pending → committed. Requires sign/commit flow. |
| Policy templates | `GET/POST/PUT/DELETE /tide-admin/policy-templates/*` | CRUD for reusable policy templates | Templates are building blocks. Not policies themselves. |
| SSH/role policies | `GET/PUT/DELETE /tide-admin/ssh-policies` | Attach Forseti contracts to specific roles | Despite the name, not SSH-specific. Sets approval type, execution type, threshold. |
| Forseti contracts | `GET/PUT /tide-admin/forseti-contracts` | List and register Forseti contracts | Contracts are stored server-side. SDK signing flow deploys them to ORKs. |
| Role policies view | `GET /tide-admin/role-policies` | Combined view of all role-policy attachments | Read-only summary. Useful for auditing which roles have policies attached. |

---

## Change-Request Endpoints (core governance)

Current `/iga/change-requests/...` surface (replaces legacy `/tide-admin/change-set/...`, GAP-065). **Full spec: `canon/iga-change-requests-api.md`.**

| Operation | Endpoint | Method | Content-Type | Notes |
|-----------|---------|--------|-------------|-------|
| List | `/iga/change-requests?status=PENDING` | GET | — | Objects keyed by `id`; `status` = PENDING/APPROVED/DENIED/CANCELLED. Derive counts from the list. |
| Get one | `/iga/change-requests/{id}` | GET | — | Full CR (`entityType`, `readyToCommit`, `threshold`, `dependsOn`) |
| Authorize (approve) | `/iga/change-requests/{id}/authorize` | POST | `application/json` | Body `{}` optional. 409 = four-eyes re-sign |
| Bulk authorize | `/iga/change-requests/bulk-authorize` | POST | `application/json` | `{ "actionTypeIn": ["CREATE","DELETE"], "limit": 100 }`; 429 if a bulk run is active |
| Commit | `/iga/change-requests/{id}/commit` | POST | — | 412 if under threshold / unmet dependency |
| Deny (reject) | `/iga/change-requests/{id}/deny` | POST | — | → 204 |
| Enclave sign (Tide MultiAdmin) | `/iga/change-requests/{id}/approval-model` | GET/POST | `application/json` | Two-phase: GET challenge → POST `{ requestModel }` |
| Comments | `/iga/change-requests/{id}/comments` | GET/POST | `application/json` | `{ "comment": "..." }` (≤2000) |
| Manual ADOPT | `/iga/adopt` | POST | `application/json` | `{ "entityType": "USER", "entityId": "..." }` |
