# Vanilla JS Secure Form — Tide Starter Template

Minimal vanilla JavaScript project showing Tide auth wiring and a protected form submission pattern.

## What this template includes

- IAMService initialization (`public/auth.js`)
- A protected form that sends authenticated requests (`public/form.js`)
- Silent SSO file (`public/silent-check-sso.html`)
- Post-auth redirect handler (`public/auth/redirect.html`)
- Entry HTML (`public/index.html`)

**Note**: This template uses `IAMService`, the shipped singleton, which supports DPoP. DPoP is enabled and enforced by default; configure it via `useDPoP: { mode: 'strict', alg: 'ES256' }` in the IAMService config. There is no `enableDpop` flag. See `canon/framework-matrix.md`.

## What this template does NOT include

- Server-side JWT verification. This is a client-only template. **Your backend must verify JWT server-side.** This template cannot enforce authorization by itself.
- A backend server or API routes.
- A bundler. Files are plain ES modules served directly or via a simple dev server.
- A running TideCloak instance or adapter JSON.

## Important: client-side apps cannot enforce authorization

`hasRealmRole()` / `hasClientRole()` and `secureFetch()` in this template send tokens to your backend. The backend must verify them. Without server-side JWT verification, there is no real authorization.

## Version policy

The `@tidecloak/js` version in `package.json` was pinned when this template was last updated. Before using, run `npm view @tidecloak/js version` to check for a newer stable release. Pin the exact version. Skip any 0.99.x versions. See `canon/version-policy.md`.

## Prerequisites

- TideCloak instance running with realm and client created
- IGA enabled on the realm
- Adapter JSON exported
- A separate backend with server-side JWT verification

## Setup

```bash
npm install
# Place adapter JSON at public/tidecloak.json
# Serve with any static server:
npx serve public
```

Or open `public/index.html` directly if your browser supports ES module `import` from a local server.

## Adapter JSON

Place at `public/tidecloak.json`. The SDK loads it from this URL during initialization.
