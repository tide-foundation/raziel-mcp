# Prompt: Build a Private Customer Portal with Tide

Copy-paste this prompt to an AI coding agent to scaffold a customer portal with Tide authentication and protected APIs.

---

## The Prompt

> Build a private customer portal using Next.js and Tide authentication.
>
> **Route first, then act.** Use the development team model. Do not bundle all work into one pass.
>
> **Team sequence for this task**:
> 1. **Scenario Resolver** — confirm this is a fresh app with standard auth (not shared encryption, not retrofit)
> 2. **Setup / Platform Engineer** — bootstrap TideCloak if not running
> 3. **Application Engineer** — wire SDK, provider, config, redirect handler, CSP, DPoP auth page
> 4. **Security Engineer** — route guards + API protection + JWT/DPoP verification
> 5. **IAM / Policy Engineer** — if roles or encryption needed
> 6. **Reviewer / QA Engineer** — compliance check before handoff
>
> **Scenario check**: Check `reference-apps/INDEX.md` for a matching scenario pattern. If one matches, use its manifest for roles, policies, and playbook sequence.
>
> **Assumptions**:
> - This is a fresh Next.js project (App Router).
> - I want login, protected pages, and protected API routes.
>
> **Default dev flow** (for a new project):
> ```
> npm install
> npm run init    # starts TideCloak, creates realm, exports tidecloak.json
> npm run dev
> ```
> The init script handles TideCloak bootstrap automatically. Docker, curl, and jq are required. You must open the invite link printed by the script to link your admin Tide account.
>
> **Inspect first** (if not starting fresh):
> 1. Is TideCloak running? `curl -sf http://localhost:8080 > /dev/null && echo "Running" || echo "Not running"`
> 2. Check if `@tidecloak/nextjs` is in `package.json`.
> 3. Check if `TideCloakProvider` (Next.js) or `TideCloakContextProvider` (React) is in `app/layout.tsx` or `app/providers.tsx`.
> 4. Check if `data/tidecloak.json` exists with `jwk`, `vendorId`, and `homeOrkUrl` fields.
>
> **If TideCloak is not running and no init script exists**, bootstrap manually:
> 1. Playbook `start-tidecloak-dev` — start the Docker container
> 2. Playbook `bootstrap-realm-from-template` — create realm, enable licensing + IGA
> 3. Playbook `initialize-admin-and-link-account` — create admin, link Tide account, export adapter JSON
>
> All three playbooks are sequential and mandatory. Bootstrap is NOT complete until a user with `tideUserKey` exists and `data/tidecloak.json` is exported.
>
> **If TideCloak is running but checks 2-4 fail**, follow the `tide-setup` skill to complete setup. Use playbook `add-auth-nextjs-fresh`.
>
> **Package versions** (before writing package.json):
> 1. Run `npm view @tidecloak/nextjs version` to get the current stable version. Pin it exactly (e.g., `"0.13.33"`). Do not use `"latest"` or `"^"` for `@tidecloak/*` packages.
> 2. If the resolved version is 0.99.x, skip it. Use the highest non-0.99.x version instead. If unsure, fall back to the versions in `canon/version-policy.md`.
> 3. Run `npm view next version` and `npm view react version` to get current stable framework versions. Use caret ranges (e.g., `"^15.0.0"`). Align React and React DOM to the same major.
> 4. Do not use `--force` or `--legacy-peer-deps` as the default install strategy. If peer dependency conflicts arise, resolve them by aligning versions.
> 5. After writing package.json, include a short version-selection summary in your output: which versions you chose and why.
>
> **Build sequence** (follow playbooks in order):
> 1. **Setup**: Playbook `add-auth-nextjs-fresh`. Includes SDK install, provider wiring with DPoP, adapter JSON, silent SSO file, post-auth redirect handler, and CSP.
> 2. **Login**: Use `useTideCloak()` hook. Verify login redirects to TideCloak and back.
> 3. **Protected pages**: Playbook `protect-routes-nextjs`. These are UI gating only — not real authorization.
> 4. **Protected APIs**: Playbooks `protect-api-nextjs` then `verify-jwt-server-side`. This is where real authorization happens. Every API route returning customer data must verify JWT server-side.
> 5. **Verify**: Unauthenticated `curl` to API returns 401. Valid token returns 200. Direct API call bypassing UI still enforces auth.
>
> **Do not**: Create fake auth helpers, plain-text role cookies, or ad hoc login logic. Do not treat `hasRole()` or route guards as real API protection. See `adapters/AGENTS.md` Forbidden Shortcuts for the full list.
>
> **If I later need roles** (admin vs customer), follow playbook `add-rbac-nextjs`. Only after API protection is verified.
>
> **If I later need to encrypt customer data**, default to self-encryption (user-bound — only the encrypting user can decrypt). Run playbook `configure-e2ee-roles-and-policies` to set up `_tide_{tag}.selfencrypt`/`.selfdecrypt` roles, then follow playbook `add-rbac-nextjs` (E2EE section). Do NOT rename roles to `encrypt`/`decrypt` — the suffix does not change the model.
>
> **If I explicitly need multiple users to decrypt the same data**, that is a different encryption model (policy-governed VVK). Route to `setup-forseti-e2ee`. It requires a Forseti contract, policy signing, and `IAMService.doEncrypt(data, policyBytes)`. Do not treat this as a role rename from self-encryption.

---

## Acceptance Criteria

- [ ] TideCloak running with realm configured and adapter JSON exported
- [ ] Login redirects to TideCloak and returns authenticated
- [ ] Protected pages redirect unauthenticated users to login
- [ ] API routes return 401 without valid JWT
- [ ] API routes return 200 with valid JWT
- [ ] Direct API call (bypassing UI) still returns 401/403
- [ ] Browser console shows no CSP violations or 404s
- [ ] DPoP is enabled on the provider
- [ ] `silent-check-sso.html` exists in `public/`
- [ ] Post-auth redirect handler exists at configured `redirectUri` path (no 404 after login)
