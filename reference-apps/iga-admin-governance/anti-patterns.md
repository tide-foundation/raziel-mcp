# IGA Admin Governance — Anti-Patterns

Scenario-specific mistakes for IGA admin governance panels. General Tide anti-patterns (I-01 through I-16, AP-01 through AP-42) still apply.

---

## AP-G01: Skipping IGA enablement

**Mistake**: Building the governance panel without enabling IGA on the realm. No change requests are created for admin mutations.

**Why it fails**: Without `toggle-iga`, admin actions execute immediately. The governance panel has nothing to review.

**Fix**: Enable IGA (`toggle-iga`) during bootstrap before building the panel.

---

> Endpoints use the current `/iga/change-requests/...` surface (GAP-065). Full spec: `canon/iga-change-requests-api.md`.

## AP-G02: Treating authorize as commit

**Mistake**: Calling only `POST /iga/change-requests/{id}/authorize` and assuming the change is applied.

**Why it fails**: `authorize` records an approval. The change does not take effect until `POST /iga/change-requests/{id}/commit` is called, and commit returns **412** until `readyToCommit` (threshold met, dependencies committed).

**Fix**: After `authorize` succeeds, poll for `readyToCommit === true`, then `commit`. During bootstrap, `bulk-authorize` then commit ready CRs in dependency passes.

---

## AP-G03: Re-signing the same CR with the same admin

**Mistake**: Retrying `authorize` on a CR the same admin already signed.

**Why it fails**: Four-eyes enforcement returns **409 Conflict** — one admin cannot count twice toward the threshold.

**Fix**: Have a *different* admin authorize. If you get 409, refresh the CR (`GET /iga/change-requests/{id}`) — it may already be signed or no longer PENDING.

---

## AP-G04: Stale pending list across mutations

**Mistake**: Fetching the pending list once and not refreshing after authorize/commit/deny.

**Why it fails**: `status` and `readyToCommit` change after every action. Stale data drives wrong badge counts and lets the UI offer commit on a CR that is not ready (→ 412).

**Fix**: Re-fetch `GET /iga/change-requests?status=PENDING` after every mutation and recompute counts/badges from it.

---

## AP-G05: Skipping the enclave step in Tide MultiAdmin mode

**Mistake**: Calling a bare `authorize` in Tide MultiAdmin mode and treating the response as done.

**Why it fails**: In Tide MultiAdmin mode the approval is cryptographic — a bare `authorize` does not record it. The admin must complete the two-phase enclave exchange: `GET /iga/change-requests/{id}/approval-model` → sign the `requestModel` in the enclave → `POST /iga/change-requests/{id}/approval-model` with `{ requestModel }`.

**Fix**: In MultiAdmin mode, drive the `approval-model` exchange and confirm `recorded: true` / an increased `authCount`. FirstAdmin/Tideless mode signs server-side on `authorize` — no enclave step.

---

## AP-G06: Relying on client-side role checks for governance access

**Mistake**: Using `hasClientRole('tide-realm-admin', 'realm-management')` on the client side as the only access control for the governance panel.

**Why it fails**: Client-side role checks are UI gating only. An attacker can call governance API routes directly. The admin endpoints themselves are protected by TideCloak, but the app's proxy/API routes may not be.

**Fix**: Server-side JWT verification on every governance API route. Check `resource_access['realm-management'].roles` includes `tide-realm-admin` in the verified JWT payload.

---

## AP-G07: Calling TideCloak admin API directly from the browser

**Mistake**: Making browser-side `fetch` calls directly to TideCloak admin endpoints (e.g., `http://localhost:8080/admin/realms/...`).

**Why it fails**: CORS blocks cross-origin requests from the app domain to TideCloak. Even if CORS is configured, exposing the admin API directly to the browser is an unnecessary attack surface.

**Fix**: Create same-origin API routes in the app that proxy requests to TideCloak admin endpoints server-side. The proxy forwards the admin's token and returns the TideCloak response.

---

## AP-G08: Using master admin credentials in the governance app

**Mistake**: Calling TideCloak admin API with `grant_type=password&username=admin&password=password` from the governance app's API routes.

**Why it fails**: Master admin credentials are bootstrap-only. Using them in the app bypasses IGA (master realm is exempt from IGA). Actions performed with master credentials are not governed.

**Fix**: Forward the logged-in admin user's token to TideCloak admin API. The admin user must have `tide-realm-admin` on the governed realm.

---

## AP-G09: Treating `tide-realm-admin` as a realm role

**Mistake**: Checking `hasRealmRole('tide-realm-admin')` or looking in `realm_access.roles` for it.

**Why it fails**: `tide-realm-admin` is a **client role** on the `realm-management` client. It does not appear in `realm_access`.

**Fix**: Check `resource_access['realm-management'].roles` in the JWT payload. Client-side: use `hasClientRole('tide-realm-admin', 'realm-management')`.

---

## AP-G10: Not handling licensing and ragnarok request paths

**Mistake**: Assuming all change-set requests are under `/tide-admin/change-set/...`.

**Why it fails**: Licensing requests use `/tideAdminResources/change-set/licensing/requests`. Ragnarok requests use `/ragnarok/change-set/offboarding/requests`. These are under different path prefixes.

**Fix**: Fetch licensing and ragnarok requests from their specific endpoints if the governance panel supports those change-set types.

---

## AP-G11: Building policy management without IGA change-set support

**Mistake**: Adding realm policy or role-policy management UI without also building the change-set approval workflow for policy changes.

**Why it fails**: Policy mutations (create, delete) also generate IGA change requests that must be approved and committed. Without the change-set workflow, policies stay in pending state.

**Fix**: Implement the full change-set lifecycle (sign → commit) for policy change requests. The `POLICY` change-set type covers realm policy mutations.

---

## AP-G12: Omitting DPoP on admin API calls

**Mistake**: Using regular `fetch` with `Bearer` token for governance API calls when DPoP is enabled on the realm client.

**Why it fails**: DPoP-bound tokens require the DPoP proof header. Without it, TideCloak rejects the request with 400 "DPoP proof is missing".

**Fix**: Use `secureFetch` (or the DPoP-aware fetch wrapper) for all governance API calls. Ensure the admin user's token is DPoP-bound.

---

## AP-G13: Single admin assumes governance is complete

**Mistake**: Deploying with only one admin user and assuming the governance panel is fully operational.

**Why it fails**: With one admin, all changes are FirstAdmin-signed (immediate, no popup). This provides audit logging but not true multi-admin governance. If the goal is quorum enforcement, a single admin defeats the purpose.

**Fix**: For real governance, ensure at least two linked admin users. Document that FirstAdmin mode is bootstrap-only or single-admin-acceptable depending on the deployment's security requirements.
