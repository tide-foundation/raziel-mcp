# Prompt: Secure an Existing App with Tide

Copy-paste this prompt to an AI coding agent to add Tide to an existing Next.js application safely and incrementally.

---

## The Prompt

> I have an existing Next.js app. Add Tide authentication and server-side API protection to it. Preserve the existing app behavior. Do not rewrite the app.
>
> **Route first, then act.** Use the development team model. Team sequence: Scenario Resolver → Setup → Application Engineer (retrofit) → Security Engineer → IAM/Policy if needed → Reviewer before handoff. Check `reference-apps/INDEX.md` for a matching scenario.
>
> **Assumptions**:
> - The app already has pages, routes, and possibly API endpoints.
> - The app may or may not have existing auth (e.g., NextAuth, custom JWT, session cookies).
>
> **Inspect first** (before any code changes):
> 1. Is TideCloak running? `curl -sf http://localhost:8080 > /dev/null && echo "Running" || echo "Not running"`
> 2. Check if Tide is already installed: `grep '@tidecloak' package.json`
> 3. Check for existing auth: `grep -r "auth\|login\|session\|jwt\|NextAuth" app/ pages/ lib/ --include="*.ts" --include="*.tsx" | head -20`
> 4. Check for existing request interception: `cat proxy.ts 2>/dev/null || cat middleware.ts 2>/dev/null`
> 5. Check for existing API routes: `find app/api pages/api -name "*.ts" 2>/dev/null`
> 6. Check if any API route already verifies JWTs: `grep -r "jwtVerify\|verifyToken\|verifyJWT" app/api/ lib/ --include="*.ts" 2>/dev/null`
>
> **If TideCloak is not running**, bootstrap it first:
> 1. Playbook `start-tidecloak-dev` — start the Docker container
> 2. Playbook `bootstrap-realm-from-template` — create realm, enable licensing + IGA
> 3. Playbook `initialize-admin-and-link-account` — create admin, link Tide account, export adapter JSON
>
> All three playbooks are sequential and mandatory. Bootstrap is NOT complete until a user with a non-empty `tideUserKey` attribute exists and `data/tidecloak.json` is exported. Do not attempt Tide SDK wiring until all three steps finish. VERIFIED (atproto-learnings L-01).
>
> **If TideCloak is running but Tide is not installed**, determine the right setup path:
> - No existing auth at all → playbook `add-auth-nextjs-fresh`
> - Has existing auth to replace or supplement → playbook `add-auth-nextjs-existing`
> - Follow the `tide-setup` skill to complete all checks.
>
> **If Tide is already installed**, determine what is missing:
> - No server-side JWT verification (`lib/auth/tideJWT.ts` absent) → follow `tide-route-and-api-protection` skill
> - JWT verification exists but no role checks → follow `tide-rbac-and-e2ee` skill
> - Everything in place → audit existing API routes for gaps (see below)
>
> **Package versions** (when installing Tide packages):
> 1. Run `npm view @tidecloak/nextjs version` before adding to package.json. Pin the exact version. Do not use `"latest"`.
> 2. If the resolved version is 0.99.x, skip it. Fall back to `canon/version-policy.md`.
> 3. Do not use `--force` or `--legacy-peer-deps` as the default. Align versions to resolve peer conflicts.
> 4. Include a short version-selection summary in your output.
>
> **Playbook sequence** (follow in order, skip steps already completed):
> 1. `add-auth-nextjs-fresh` or `add-auth-nextjs-existing` — setup. Verify login works before proceeding.
> 2. `protect-routes-nextjs` — client-side route guards (UX only).
> 3. `protect-api-nextjs` then `verify-jwt-server-side` — server-side JWT + DPoP verification. This is real authorization.
> 4. `add-rbac-nextjs` — role-based access control. Only after step 3 is verified.
>
> Use the `tide-route-and-api-protection` skill's diagnostic table to audit any existing API routes for gaps.
>
> **Preserve existing behavior**:
> - Do not remove existing pages or routes.
> - Do not restructure the project unless required for Tide wiring.
> - Add Tide as a layer: provider wrapping the app, verification in API routes.
> - Test that existing non-auth functionality still works after each step.
> - If the app uses existing auth (NextAuth, custom), decide with me whether to replace or run in parallel. Do not silently remove it.
>
> **Do not**: Create fake auth helpers, plain-text role cookies, or ad hoc local auth. Do not treat `hasRole()` or route guards as real API protection. Do not skip DPoP. See `adapters/AGENTS.md` Forbidden Shortcuts for the full list.
>
> **If the app is not Tide-enabled at all**, stop all other work. Complete setup first. Do not diagnose Tide issues on an app without Tide installed.

---

## Acceptance Criteria

- [ ] TideCloak running with realm configured and adapter JSON exported
- [ ] Tide provider wraps the app with DPoP enabled
- [ ] Adapter JSON present with `jwk`, `vendorId`, `homeOrkUrl`
- [ ] Login flow works (redirect to TideCloak and back)
- [ ] Every API route that handles sensitive data verifies JWT server-side
- [ ] Unauthenticated curl to protected API returns 401
- [ ] Existing non-auth functionality still works
- [ ] No fake auth helpers or plain-text role cookies in codebase
- [ ] Post-auth redirect handler exists at configured `redirectUri` path
- [ ] Browser console shows no CSP violations
