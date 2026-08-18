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
| `tide_dpop_auth.html` in `public/` + a `/tide_dpop/:path*` **rewrite** in `next.config` + that path's CSP (I-12) | — |
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
6. Install `tide_dpop_auth.html` into `public/` — get it from the MCP tool **`tide_dpop_asset`** (it returns the file byte-exact) or from any pack template; it is NOT in the npm packages or the container. Serve it via a `next.config` **rewrite**: `/tide_dpop/:path*` → `/tide_dpop_auth.html`. Verify with `sha256sum` against `9d7844b938f0a2565fa910d3d30e9b8797cbfd6e0b73d59d804169a089aea757` (9120 bytes), and it **must contain** `window.opener` — the correct page uses `window.opener || window.parent` so it works in both the popup and the iframe. A copy WITHOUT it is the stale 7183-byte version and fails login with `TIDE-SWE-UNHANDLED` (AP-62). Do **not** source it from `sources/example-app-keylessh/public/` — the keylessh repo carries both copies and that path is the stale one. Do NOT use a catch-all route handler — Next.js injects its own hash-based CSP on route-handler responses, which blocks the page's inline script (I-12; VERIFIED LEARNINGS-batch-005 L-04).
7. Give `/tide_dpop/:path*` its own CSP in `next.config` `headers()`: `default-src 'self'; script-src 'unsafe-inline'` plus `Allow-CSP-From: *` (lets the ORK embed the page cross-origin). **Order matters**: place this rule AFTER the generic `/:path*` rule — both match, and the last matching rule wins for a header key, so a generic rule placed later silently overrides it. Global CSP stays `frame-src 'self' *`. VERIFIED 2026-08-06.
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
- [ ] Auth **UX states** handled: `isInitializing` renders a skeleton (NOT the sign-in screen), `initError` renders an error, `isRefreshing` does not unmount content, `sessionExpired` explains and offers re-sign-in, Tide actions disabled when `isOffline`. See `canon/ux-states.md`
- [ ] If progress callbacks are wanted: provider is `TideCloakContextProvider` (`TideCloakProvider` accepts ONLY `config`+`children` and silently drops callbacks) with `onActionNotification` wired to a toast
- [ ] `public/silent-check-sso.html` exists
- [ ] Post-auth redirect handler exists at configured `redirectUri`
- [ ] `public/tide_dpop_auth.html` exists, is byte-identical to the exemplar (no `window.opener`), is served via the `/tide_dpop/:path*` rewrite, and that path returns `default-src 'self'; script-src 'unsafe-inline'` + `Allow-CSP-From: *` (curl it — if you see the generic app CSP instead, the rule order is wrong)
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
- Do not modify `tide_dpop_auth.html` — not even styling. The enclave integrity-checks it, and any edit (notably adding `window.opener` popup handling) fails login with an unexplained 500 at the token exchange. Copy it verbatim and `diff` it. (I-12, L-07)
- Do not forget the DPoP page's own CSP, and do not let the generic app CSP override it — its rule must come last in `headers()`.
- Do not serve the DPoP auth page from a route handler. Use a `next.config` rewrite — Next.js injects a hash-based CSP on route-handler responses that blocks the page's inline script. (I-12, LEARNINGS-batch-005 L-04)
