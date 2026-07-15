# Role: Setup / Platform Engineer

---

## Purpose

Detect whether TideCloak infrastructure is running and correctly bootstrapped. Own the TideCloak container lifecycle, realm creation, licensing, IGA enablement, admin user, account linking, and adapter JSON export. Hand off app-level integration to `tide-integration`.

---

## When to Trigger

- User asks to "add login", "add auth", "set up Tide", or "start TideCloak"
- Another skill's repo inspection detects missing Tide setup (no SDK, no provider, or no adapter JSON)
- User reports login issues and CHECK-1 or CHECK-2 below have not been confirmed yet
- User asks about realm creation, licensing, or admin setup

### Scenario-disambiguation gate (I-17)

Before running any checks or writing code, resolve these branches if ambiguous:

| Branch | How to resolve |
|--------|---------------|
| Fresh app vs existing app | Check for existing auth (NextAuth, Clerk, custom JWT) in the repo |
| Generated app vs manual bootstrap | Check for `"init"` script in `package.json` or `scripts/init-tidecloak.sh` |
| Setup vs diagnosis | Is something broken (login hangs, roles missing)? Or does auth not exist yet? |
| App-only integration vs full TideCloak bootstrap | Is TideCloak already running and configured, or does it need to be started? |

If multiple paths are plausible and the repo does not resolve it, ask the user before proceeding.

---

## When NOT to Trigger

- App already has working Tide auth (provider present, adapter JSON loaded, login functional). Proceed to route-and-api-protection or rbac-and-e2ee skill instead.
- User is asking about a **direct Keycloak-to-TideCloak** migration. That specific path is not yet documented (GAP-023) — say so and stop. (Retrofitting an app off generic-OIDC / NextAuth / Clerk is a different task, covered by `playbooks/migrate-from-existing-auth.md`; the open gap is the KC→TideCloak realm/data migration itself.)

---

## Required Repo Inspection

Run these checks before any code changes. Results determine the execution path.

```bash
# CHECK-0: Is TideCloak running?
curl -sf http://localhost:8080 > /dev/null 2>&1 && echo "TideCloak reachable" || echo "TideCloak NOT reachable"

# CHECK-0b: Does an init script exist? (generated-app bootstrap)
grep -q '"init"' package.json 2>/dev/null && echo "Init script found — run: npm run init" || echo "No init script"
test -f scripts/init-tidecloak.sh && echo "Init script file exists" || true

# CHECK-1: Is a Tide SDK package installed?
grep -E '@tidecloak/(nextjs|react|js)' package.json

# CHECK-2: Is TideCloakProvider wired into the app?
grep -r 'TideCloakProvider\|TideCloakContextProvider' app/layout.tsx app/providers.tsx pages/_app.tsx src/app/providers.tsx 2>/dev/null

# CHECK-2b: Is config loaded from tidecloak.json (not env vars)?
grep -r 'NEXT_PUBLIC_TIDECLOAK' app/providers.tsx app/layout.tsx src/app/providers.tsx 2>/dev/null && echo "WARNING: Provider reads env vars — should import data/tidecloak.json instead (AP-38)"
grep -r 'tidecloak.json' app/providers.tsx src/app/providers.tsx 2>/dev/null || echo "WARNING: Provider does not import tidecloak.json"

# CHECK-3: Does tidecloak.json exist with Tide extensions?
# Next.js (server-side): check data/
test -f data/tidecloak.json && node -e "const c=require('./data/tidecloak.json'); console.log(!!c.jwk && !!c.vendorId && !!c.homeOrkUrl)"
# React/Vite or Vanilla JS (client-side): check public/
test -f public/tidecloak.json && echo "Found at public/tidecloak.json" || echo "Not in public/"
# Wrong filename? (common mistake)
ls data/adapter.json data/keycloak.json public/adapter.json public/keycloak.json 2>/dev/null && echo "WRONG FILENAME — must be tidecloak.json"

# CHECK-3b: Does the config API route exist? (Next.js only)
# Required so the client-side SDK can fetch adapter JSON (default configUrl is /adapter.json which won't exist)
ls app/api/config/route.ts src/app/api/config/route.ts 2>/dev/null && echo "Config API route found" || echo "Config API route MISSING"
grep -r 'configUrl' app/providers.tsx src/app/providers.tsx 2>/dev/null || echo "WARNING: configUrl not set on provider — SDK will try /adapter.json"

# CHECK-4: Is DPoP configured?
grep -r 'useDPoP\|enableDpop' app/providers.tsx app/layout.tsx pages/_app.tsx src/main.tsx 2>/dev/null

# CHECK-5: Does silent-check-sso.html exist?
test -f public/silent-check-sso.html && echo "Found" || echo "Missing"

# CHECK-6: Is CSP configured for SWE iframe?
grep -r "frame-src" next.config.* 2>/dev/null

# CHECK-6b: What Next.js version is installed? (determines proxy.ts vs middleware.ts)
NEXT_MAJOR=$(node -e "try{console.log(require('next/package.json').version.split('.')[0])}catch{console.log('unknown')}" 2>/dev/null)
echo "Next.js major version: $NEXT_MAJOR"
# 16+ → request interception file is proxy.ts
# 15 or earlier → request interception file is middleware.ts

# CHECK-7: Does the post-auth redirect handler exist?
# Next.js App Router:
test -f app/auth/redirect/page.tsx || test -f src/app/auth/redirect/page.tsx && echo "Found" || echo "Missing"
# Next.js Pages Router:
test -f pages/auth/redirect.tsx || test -f src/pages/auth/redirect.tsx && echo "Found" || echo "Missing"
```

---

## Preconditions

- A Next.js (or React/Vite) project exists with `package.json` (for app integration paths)
- Docker installed (for bootstrap paths)

---

## Execution Workflow

### Pre-step: Scenario matching

Before running checks, determine if the user's request matches a known scenario in `reference-apps/INDEX.md`.

If the user describes an app that matches a scenario (e.g., "build me a password manager", "shared credential vault"):
1. Read the scenario's `manifest.yaml` for roles, policies, and playbook sequence.
2. Use the manifest's `playbook_sequence` instead of the default ordering below.
3. Use the manifest's `roles` to generate or validate the realm template.
4. Follow the scenario's `bootstrap-sequence.md` for pre-user admin setup.

If no scenario matches, continue with the standard detection flow below.

### Path 0: TideCloak not running (CHECK-0 fails)

The user needs infrastructure before app integration. Choose the right bootstrap path:

**If the project has an init script** (`npm run init` in package.json or `scripts/init-tidecloak.sh` exists):

1. Run `npm run init`. This handles the full TideCloak bootstrap automatically.
2. After init completes, return to CHECK-1 for app integration verification.

**If no init script exists** (manual / BYO TideCloak):

1. Route to bootstrap playbook chain:
   - `start-tidecloak-dev` → start TideCloak container
   - `bootstrap-realm-from-template` → create realm, enable licensing + IGA
   - `initialize-admin-and-link-account` → admin user, invite link, adapter export
2. If E2EE is needed or scenario requires it: also `configure-e2ee-roles-and-policies`
3. If scenario has policies: also `setup-forseti-e2ee` after bootstrap
4. After bootstrap, return to CHECK-1 for app integration.

**Do not** attempt app-level Tide integration without a running TideCloak.

### Path A/B/C/D: App integration needed

**Hand off to `tide-integration` skill.** This skill does not own SDK install, provider wiring, config loading, or hardening.

- CHECK-1 or CHECK-2 fail (no SDK or no provider) → `tide-integration`
- CHECK-3 fails (adapter JSON missing but TideCloak running) → export via `initialize-admin-and-link-account` Step 7, then `tide-integration`
- CHECK-3 fails and TideCloak not running → Path 0 first, then `tide-integration`
- CHECK-4/5/6 fail (missing DPoP, silent SSO, redirect handler, CSP) → `tide-integration`

### Path E: All checks pass

Bootstrap and integration are complete. Route to the next subagent:
- Need route guards or API protection → `tide-route-and-api-protection`
- Need RBAC or private E2EE (no sharing) → `tide-rbac-and-e2ee`
- Need E2EE with sharing / multiple users decrypt → `tide-rbac-and-e2ee` (sharing gate routes to `setup-forseti-e2ee`)
- Something is broken → `tide-diagnostics`

---

## Safety Checks

- **Do not use the scaffold command** (`npm init @tidecloak/nextjs@latest`) unless the user explicitly requests it. Manual setup is more inspectable.
- See `adapters/AGENTS.md` Forbidden Shortcuts for the full safety rule set (fake auth, plain-text cookies, custom passwords, DPoP skip).

---

## Verification Checklist

After setup is complete, verify:

- [ ] TideCloak running and reachable
- [ ] `@tidecloak/nextjs` (or equivalent) in `package.json`
- [ ] `TideCloakProvider` (Next.js) or `TideCloakContextProvider` (React) wraps the app with `useDPoP` in config object
- [ ] `data/tidecloak.json` exists with `jwk`, `vendorId`, `homeOrkUrl` fields
- [ ] `public/silent-check-sso.html` exists
- [ ] Post-auth redirect handler exists at configured `redirectUri` path (I-16)
- [ ] CSP includes `frame-src '*'`
- [ ] `npm run dev` starts without import errors
- [ ] Login redirects to TideCloak and returns with authenticated state
- [ ] Browser console shows no CSP violations or 404s
- [ ] Logout clears session

---

## Repair Path

If login hangs after setup:
1. Check browser console for CSP violations → fix CSP
2. Check for 404 on `silent-check-sso.html` → create the file
3. Check TideCloak reachability: `curl ${TIDECLOAK_URL}/realms/${REALM}/.well-known/openid-configuration`
4. Check adapter JSON validity: `node -e "console.log(require('./data/tidecloak.json'))"`
5. Test in incognito browser (stale localStorage can cause hangs)
6. If all else fails, use playbook `diagnose-broken-login`

---

## Handoff Trace

```
[TRACE]
Scenario: <scenario>
Role: Setup / Platform Engineer
Reason: <TideCloak not running | realm not configured | init script available>
Preconditions: Docker available, port 8080 free
Next: Application Engineer | STOP if bootstrap failed
[/TRACE]
```

---

## Do Not Do This

- **Do not diagnose Tide issues on an app without Tide installed.** Route to setup playbook first.
- **Do not create a mock TideCloak provider** or stub that simulates auth without a real TideCloak instance.
- **Do not fabricate adapter JSON** or create placeholder configs. The file must be exported from TideCloak.
- **Do not hardcode TideCloak URLs in source files.** Use `data/tidecloak.json` (Next.js) or `public/tidecloak.json` (React/Vite). Do not use `NEXT_PUBLIC_TIDECLOAK_*` env vars (AP-38). Server-side code may use `CLIENT_ADAPTER` or `TIDECLOAK_CONFIG_B64` env vars for deployment.
- **Do not skip TideCloak bootstrap** when the server is not running. App integration depends on a configured realm.
- For additional prohibitions (fake auth helpers, custom password flows, ESM import pitfalls), see `adapters/AGENTS.md` Forbidden Shortcuts.
