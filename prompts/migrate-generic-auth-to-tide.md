# Prompt: Migrate from Generic Auth to Tide (Constrained — Inspection and Planning Only)

Copy-paste this prompt to an AI coding agent to assess an existing auth setup and plan a migration to Tide. This prompt is intentionally constrained because a universal migration recipe does not yet exist.

---

## Important Limitation

There is no fully documented Keycloak-to-TideCloak migration path (GAP-023, STILL_UNRESOLVED). All Tide exemplars are greenfield. This prompt guides inspection, planning, and partial implementation using the available setup and protection playbooks. It does not provide an automated end-to-end migration.

---

## The Prompt

> I have an existing Next.js app with authentication. I want to migrate to Tide. Help me assess the current setup and plan the migration.
>
> **This is a planning and incremental migration prompt, not a one-shot rewrite.** A universal Tide migration recipe is not yet available. Work with what the Tide playbooks support today.
>
> **Inspect first** (before any code changes):
> 1. What auth is currently in use? `grep -r "NextAuth\|next-auth\|passport\|jsonwebtoken\|jose\|auth0\|clerk\|supabase" package.json lib/ app/ pages/ --include="*.ts" --include="*.tsx" 2>/dev/null | head -20`
> 2. Where is the auth provider wired? `grep -r "SessionProvider\|AuthProvider\|ClerkProvider" app/layout.tsx pages/_app.tsx 2>/dev/null`
> 3. How are API routes protected today? `grep -r "getServerSession\|getToken\|requireAuth\|authenticate\|verifyToken" app/api/ pages/api/ lib/ --include="*.ts" 2>/dev/null | head -20`
> 4. How are routes guarded? `grep -r "useSession\|isAuthenticated\|PrivateRoute\|AuthGuard" app/ pages/ components/ --include="*.tsx" 2>/dev/null | head -10`
> 5. Is there existing role/permission logic? `grep -r "role\|permission\|isAdmin\|hasRole" app/ lib/ --include="*.ts" --include="*.tsx" 2>/dev/null | head -10`
> 6. Does any proxy/middleware handle auth? `cat proxy.ts 2>/dev/null || cat middleware.ts 2>/dev/null`
>
> **Produce an assessment** (do not start coding yet):
> - List the current auth provider and its integration points (provider wrapper, API middleware, route guards, session storage).
> - Identify which API routes are currently protected and how.
> - Identify any role or permission logic.
> - Identify what can be replaced incrementally vs what requires simultaneous changes.
>
> **Package versions** (when installing Tide packages):
> - Run `npm view @tidecloak/nextjs version` before adding to package.json. Pin the exact version. Do not use `"latest"`.
> - If the resolved version is 0.99.x, skip it. Fall back to `canon/version-policy.md`.
> - Do not use `--force` or `--legacy-peer-deps`. Align versions to resolve peer conflicts.
>
> **Incremental migration order** (using existing Tide playbooks):
> 1. Add Tide provider alongside existing auth — playbook `add-auth-nextjs-existing`. Both systems coexist.
> 2. Verify Tide login works independently. Do not proceed until confirmed.
> 3. Migrate one API route to Tide JWT verification as a pilot — playbooks `protect-api-nextjs` then `verify-jwt-server-side`.
> 4. Migrate remaining API routes.
> 5. Replace route guards with Tide `useTideCloak()` guards — playbook `protect-routes-nextjs`. These are UI-only in both old and new systems.
> 6. Add RBAC on Tide claims if needed — playbook `add-rbac-nextjs`.
> 7. Remove old auth provider and its dependencies. Verify everything works with Tide only.
>
> **What cannot be migrated automatically**:
> - **Realm migration** — no Keycloak-to-TideCloak procedure documented. You may need to recreate the realm. (GAP-023)
> - **Users** — must be created in TideCloak and linked via Tide account linking. No bulk migration tool.
> - **Sessions** — cannot be transferred. Users re-login after the switch.
> - **Passwords** — Tide uses threshold PRISM. Existing password hashes are not transferable.
>
> **Do not**: Claim a universal migration recipe exists. Do not silently remove old auth before confirming Tide login works. Do not create shim layers that fake Tide behavior using old tokens. See `adapters/AGENTS.md` Forbidden Shortcuts for additional prohibitions.
>
> **If the app is not yet connected to TideCloak at all**, start with the `tide-setup` skill.

---

## Acceptance Criteria

- [ ] Assessment document produced listing current auth integration points
- [ ] Tide provider added and login verified before any old auth is removed
- [ ] Each migrated API route verified: 401 without Tide JWT, 200 with valid Tide JWT
- [ ] Old auth removed only after all routes and APIs confirmed working with Tide
- [ ] No shim layers, fake auth helpers, or plain-text role cookies in the final codebase
- [ ] DPoP enabled from the start
- [ ] Post-auth redirect handler exists at configured `redirectUri` path
