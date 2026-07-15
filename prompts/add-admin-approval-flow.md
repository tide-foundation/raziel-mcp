# Prompt: Add an Admin-Only or Approval-Driven Workflow

Copy-paste this prompt to an AI coding agent to add role-gated admin functionality to an existing Tide-enabled app.

---

## The Prompt

> Add an admin-only workflow to my existing Tide-enabled Next.js app. Only users with the `admin` role should be able to access admin pages and admin API routes.
>
> **Assumptions**:
> - The app already has Tide auth working (login/logout functional).
> - TideCloak is running. The `admin` role exists in the realm and is assigned to at least one user.
> - I may or may not have server-side JWT verification in place yet.
>
> **Inspect first**:
> 1. Confirm Tide setup: `@tidecloak/nextjs` in `package.json`, `TideCloakProvider` in layout, `data/tidecloak.json` with `jwk` field.
> 2. Check if `lib/auth/tideJWT.ts` and `lib/auth/protect.ts` exist.
> 3. Check if existing admin API routes already verify JWT: `grep -r "verifyTideJWT\|withAuth\|withRole" app/api/admin/ lib/auth/`
> 4. Check if existing admin pages use only `hasRealmRole()` / `hasClientRole()` for protection (UI gating only — not real authorization).
>
> **If Tide setup checks fail**, stop. Use the `tide-setup` skill first.
>
> **If `lib/auth/tideJWT.ts` does not exist**, use the `tide-route-and-api-protection` skill first (playbooks `protect-api-nextjs` then `verify-jwt-server-side`).
>
> **Once server-side auth is confirmed**, add admin RBAC:
> 1. **Admin API routes**: Wrap with `withRole('admin', handler)` from `lib/auth/protect.ts`. Follow playbook `add-rbac-nextjs`.
> 2. **Admin pages**: Add client-side `hasRole('admin')` checks for UI gating (show/hide admin content). This is UX only — the API enforces the real check.
> 3. **Verify**: `curl` admin API with a non-admin token returns 403. Admin token returns 200. Bypassing the UI (direct curl) still enforces the role check.
>
> **Do not**:
> - Treat `hasRole('admin')` on the client as sufficient protection. It is UI gating only.
> - Create admin bypass paths or emergency override routes.
> - Use Next.js `proxy.ts` (or legacy `middleware.ts`) for role enforcement. It runs at the edge and cannot verify JWT signatures.
> - Implement a custom approval queue unless you have confirmed the TideCloak IGA workflow is appropriate. IGA uses cryptographic quorum enforcement — it is not a simple approval table.
>
> **About IGA (multi-admin approval)**:
> If IGA is enabled on the realm, admin changes (user creation, role assignment) already require cryptographic quorum approval inside TideCloak. Do not build a custom approval system that duplicates or bypasses this. Deep governance configuration (quorum tuning, custom Forseti contracts) is only partially documented — see playbook `setup-iga-admin-panel` for what is currently available.

---

## Acceptance Criteria

- [ ] Admin API returns 403 for non-admin user
- [ ] Admin API returns 200 for admin user
- [ ] Admin pages show "Access Denied" for non-admin (UI gating)
- [ ] Direct curl to admin API without token returns 401
- [ ] Direct curl with non-admin token returns 403
- [ ] No admin bypass paths exist in the codebase
- [ ] Post-auth redirect handler exists at configured `redirectUri` path
