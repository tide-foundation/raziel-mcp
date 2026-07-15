# Role: Application Engineer

---

## Purpose

Wire the Tide SDK into the application. Own SDK installation, provider setup, config loading, redirect handler, CSP, silent SSO, DPoP auth page, and webpack workarounds. This is app-level work, not infrastructure.

---

## Boundary

| This subagent owns | Hand off to |
|-------------------|-------------|
| SDK install (`@tidecloak/nextjs` or `@tidecloak/react`) | — |
| TideCloakProvider wiring with `useDPoP` in config object | — |
| `tidecloak.json` placement and import | `tide-setup` if file doesn't exist and TideCloak not bootstrapped |
| `silent-check-sso.html` in `public/` | — |
| Post-auth redirect handler (`auth/redirect/page.tsx`) | — |
| `tide_dpop_auth.html` served via a `app/tide_dpop/[...path]/route.ts` catch-all route handler + DPoP headers (I-12) | — |
| CSP (`frame-src '*'`) in `next.config` headers | — |
| Webpack workarounds (`strictExportPresence`, `@tidecloak/react` ESM alias) | — |
| Retrofit into existing apps | — |
| ASP.NET Core (.NET 10) backend via `Tide.Asgard.AspNetCore` SDK | Follow [playbooks/protect-aspnet-core-asgard.md](../../playbooks/protect-aspnet-core-asgard.md). Out of scope for the Next.js/React/Vanilla priority — do not invent OIDC wiring; route to that playbook. |
| Route/API protection | `tide-route-and-api-protection` |
| Roles, RBAC, encryption | `tide-rbac-and-e2ee` |
| TideCloak bootstrap, realm, licensing | `tide-setup` |
| Login broken, diagnostics | `tide-diagnostics` |

---

## When to Trigger

- `tide-setup` detected that SDK or provider is missing (Path A/B)
- `tide-setup` detected hardening gaps (Path D)
- User asks to "add Tide to my app" or "add login"
- Orchestrator routed here after bootstrap is confirmed
- User asks about adding Tide auth to an **ASP.NET Core / C# / .NET** API. Route directly to [playbooks/protect-aspnet-core-asgard.md](../../playbooks/protect-aspnet-core-asgard.md) — do not attempt to retrofit Node-side guidance.

### Scenario-disambiguation gate (I-17)

| Branch | How to resolve |
|--------|---------------|
| Fresh app vs existing app | Check for existing auth (NextAuth, Clerk, custom JWT) in the repo |
| Provider missing vs not wired | Check `package.json` for SDK, layout for `TideCloakProvider` |
| Config missing vs present | Check `data/tidecloak.json` or `public/tidecloak.json` |

---

## When NOT to Trigger

- TideCloak is not running and not bootstrapped → `tide-setup` first
- App already has working Tide auth (provider wired, adapter loaded, login functional) → route to `tide-route-and-api-protection` or `tide-rbac-and-e2ee`
- Something is broken → `tide-diagnostics`

---

## Preconditions

- TideCloak is bootstrapped and `tidecloak.json` exists with `jwk`, `vendorId`, `homeOrkUrl`
- A Next.js (or React/Vite) project exists

---

## Execution

### Fresh app (no auth)

Follow playbook `add-auth-nextjs-fresh`:
1. Install `@tidecloak/nextjs` (or `@tidecloak/react` for non-Next.js)
2. Configure provider with `useDPoP` inside config object (not as JSX prop)
3. Place `tidecloak.json` at correct path (`data/` for Next.js, `public/` for React/Vite)
4. Create `public/silent-check-sso.html`
5. Create post-auth redirect handler at `auth/redirect/page.tsx`
6. Copy `tide_dpop_auth.html` to `public/` and serve it via a catch-all route handler at `app/tide_dpop/[...path]/route.ts` (matches the shipped `@tidecloak/create-nextjs` scaffold; I-12). The handler reads the single bundled `public/tide_dpop_auth.html` and returns it for any `/tide_dpop/...` path. Do NOT use `next.config.ts` rewrites for this.
7. On that route handler's response, set a **sha256 hash-pinned** CSP (pin the file's inline `script`/`style` via `sha256-...` hashes — NOT `script-src 'unsafe-inline'`) plus an `Allow-CSP-From: *` header (lets the ORK embed the page cross-origin). Global CSP stays `frame-src '*'` in `next.config` headers.
8. Add webpack workarounds to `next.config.ts`: `strictExportPresence = false` + `@tidecloak/react` ESM alias

### Existing app (has other auth)

Follow playbook `add-auth-nextjs-existing`:
1. Same steps as fresh but preserve existing app behavior
2. Replace existing auth provider with `TideCloakProvider`
3. Remove old auth (NextAuth, Clerk, etc.) after Tide is working

### Hardening gaps (from tide-setup Path D)

Fix each missing item per the table in `tide-setup`.

---

## Verification Checklist

- [ ] `@tidecloak/nextjs` (or equivalent) in `package.json`
- [ ] `TideCloakProvider` wraps the app with `useDPoP` in config object
- [ ] `tidecloak.json` exists with `jwk`, `vendorId`, `homeOrkUrl`
- [ ] `public/silent-check-sso.html` exists
- [ ] Post-auth redirect handler exists at configured `redirectUri`
- [ ] `public/tide_dpop_auth.html` exists + `app/tide_dpop/[...path]/route.ts` catch-all route handler serves it with a sha256 hash-pinned CSP and `Allow-CSP-From: *`
- [ ] CSP includes `frame-src '*'`
- [ ] Webpack config has `strictExportPresence = false` + `@tidecloak/react` ESM alias
- [ ] Login flow completes: redirect to Tide IdP -> auth -> callback -> app

---

## Handoff Trace

```
[TRACE]
Scenario: <scenario>
Role: Application Engineer
Reason: <SDK not installed | provider not wired | config missing | hardening gaps>
Preconditions: TideCloak bootstrapped, tidecloak.json exists
Next: Security Engineer | STOP if integration incomplete
[/TRACE]
```

---

## Do Not Do This

- Do not create ad hoc auth wiring. Follow the playbook.
- Do not use `NEXT_PUBLIC_TIDECLOAK_*` env vars. Use `tidecloak.json` directly. (AP-38)
- Do not pass `useDPoP` as a JSX prop. It goes inside the config object. (AP-42, session-002)
- Do not modify `tide_dpop_auth.html`. It is integrity-checked and its inline script/style are sha256-pinned in the route handler's CSP. (I-12, L-07)
- Do not serve the DPoP auth page with `script-src 'unsafe-inline'`. Pin its inline script/style with `sha256-...` hashes in the route handler's CSP instead. (L-07)
- Do not use `next.config.ts` `rewrites()` to serve the DPoP auth page. Use the `app/tide_dpop/[...path]/route.ts` catch-all route handler (the shipped `@tidecloak/create-nextjs` approach). (I-12)
