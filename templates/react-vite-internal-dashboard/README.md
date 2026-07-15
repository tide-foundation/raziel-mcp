# React + Vite Internal Dashboard — Tide Starter Template

Minimal React (Vite) project showing where Tide auth belongs in a client-side SPA with role-aware UI.

## What this template includes

- Auth provider with DPoP (`src/main.tsx`)
- Role-aware dashboard shell (`src/App.tsx`)
- Silent SSO file (`public/silent-check-sso.html`)
- Adapter JSON placement (`public/tidecloak.json`)

**Redirect handler**: The app uses `useAuthCallback()` in `App.tsx` to detect the OIDC callback (`?code=` in URL), process the token exchange, and redirect to the original page. The Vite dev server's SPA fallback ensures `/auth/redirect` serves `index.html` so the React app loads. For production on a static host, configure server-side rewrite rules or create `public/auth/redirect.html`. See `canon/redirect-handler.md`.

## What this template does NOT include

- Server-side JWT verification. React/Vite is a client-only framework. **API protection must be implemented on your backend server.** This template cannot solve server-side authorization by itself.
- A backend server. Protected API calls need a separate Express, Next.js, or other server with JWT verification. See playbooks `protect-api-nextjs` and `verify-jwt-server-side` for the server-side patterns.
- A running TideCloak instance or adapter JSON.

## Important: client-side apps cannot enforce authorization

`hasRealmRole()` / `hasClientRole()` and route guards in this template are UI gating only. They show/hide UI elements for UX purposes. An attacker can bypass them trivially.

Real authorization requires server-side JWT verification on your API backend. See `canon/invariants.md` I-03 and I-08.

## Version policy

Versions in `package.json` were pinned when this template was last updated. Before using:

1. Run `npm view @tidecloak/react version` to check for a newer stable release. Pin the exact version. Skip any 0.99.x versions.
2. Run `npm view react version` and `npm view vite version` to check current stable framework versions.
3. See `canon/version-policy.md` for the full policy and fallback versions.

## Prerequisites

- Node.js 18+
- TideCloak instance running with realm and client created
- IGA enabled on the realm
- Adapter JSON exported and placed at `public/tidecloak.json`
- A separate backend with server-side JWT verification for protected APIs

## Setup

```bash
npm install
cp .env.example .env
# Place adapter JSON at public/tidecloak.json
npm run dev
```

## Adapter JSON placement

React/Vite loads config from a public URL, not the filesystem.
Place your adapter JSON at `public/tidecloak.json`.

The prop is `configUrl`, NOT `configFilePath`. Using the wrong prop causes Vite to serve the HTML index page instead, producing `SyntaxError: Unexpected token '<'`.
