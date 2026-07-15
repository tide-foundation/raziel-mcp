# Next.js Customer Portal — Tide Starter Template

Minimal Next.js App Router project showing where Tide auth, protected routes, protected APIs, and RBAC belong.

## Quick start

```bash
npm install
npm run init    # starts TideCloak, creates realm, exports tidecloak.json
npm run dev
```

`npm run init` runs `scripts/init-tidecloak.sh`. It requires Docker, curl, and jq. It:

1. Reads the `name` field from `package.json` and uses it as the realm and client name (e.g., `nextjs-customer-portal` becomes realm `nextjs-customer-portal` with client `nextjs-customer-portal-client`).
2. Starts a TideCloak dev container, creates the realm and client, enables IGA, creates an admin user, and exports `data/tidecloak.json`.
3. Prints an invite link — you must open it in a browser to link your admin Tide account.

Override names via env vars if needed: `REALM_NAME=foo CLIENT_NAME=foo-client npm run init`

After init completes, `npm run dev` starts the app at `http://localhost:3000`.

## What this template includes

- Auth provider with DPoP (`src/app/providers.tsx`)
- Config API route for client-side SDK (`src/app/api/config/route.ts`)
- Public home page with login/logout (`src/app/page.tsx`)
- Protected route example (`src/app/dashboard/layout.tsx`)
- Protected API with JWT verification (`src/app/api/customers/route.ts`)
- Role-aware UI example (`src/app/dashboard/page.tsx`)
- Server-side auth helpers (`src/lib/auth/`)
- CSP and webpack config (`next.config.ts`)
- Post-auth redirect handler (`src/app/auth/redirect/page.tsx`)
- Silent SSO file (`public/silent-check-sso.html`)
- TideCloak init script (`scripts/init-tidecloak.sh`)
- Realm template (`scripts/realm.json.template`)

## What this template does NOT include

- A database. API routes return stub data.
- Production deployment config. See notes below.

## Setup paths

### Generated app (default)

Use `npm run init`. This is the recommended path for new projects. It handles TideCloak bootstrap automatically. See Quick start above.

### BYO TideCloak (advanced)

If you already have a running TideCloak with a configured realm:

1. Export adapter JSON and place it at `data/tidecloak.json`
2. Run `npm run dev`

See playbooks `start-tidecloak-dev`, `bootstrap-realm-from-template`, and `initialize-admin-and-link-account` for the manual bootstrap sequence.

## Playbook sequence this template follows

1. `add-auth-nextjs-fresh` — setup (provider, adapter, CSP, silent SSO)
2. `protect-routes-nextjs` — client-side route guards (UI gating only)
3. `protect-api-nextjs` — server-side JWT verification
4. `verify-jwt-server-side` — complete JWT + DPoP verification
5. `add-rbac-nextjs` — role-based access control

## Version policy

Versions in `package.json` were pinned when this template was last updated. Before using this template:

1. Run `npm view @tidecloak/nextjs version` to check for a newer stable release. Pin the exact version. Skip any 0.99.x versions.
2. Run `npm view next version` and `npm view react version` to check current stable framework versions. Use caret ranges.
3. See `canon/version-policy.md` for the full policy and fallback versions.

Do not use `"latest"` in package.json. Do not use `--force` or `--legacy-peer-deps` as the default install strategy.

## Prerequisites

- Node.js 18+
- Docker (for `npm run init`)
- curl and jq (for `npm run init`)

## Security model

| Layer | File | Security value |
|-------|------|---------------|
| UI gating | `src/app/dashboard/layout.tsx` | None. UX convenience only. |
| Route guard | `src/app/dashboard/layout.tsx` | None for APIs. Redirect only. |
| API auth | `src/app/api/customers/route.ts` | **Real.** JWT verified server-side. |
| RBAC | `src/lib/auth/protect.ts` `withRole()` | **Real.** Role checked on verified JWT. |

Hidden UI is not authorization. Every protected API verifies JWT server-side.

**Note**: This template does not use Next.js `proxy.ts` for request interception. The file `src/lib/auth/protect.ts` is a Tide auth helper (`withAuth`/`withRole`) — it is application code, not the Next.js edge runtime file.

## Deployment notes

- **HTTPS**: `sslRequired: "external"` in realm.json allows HTTP on localhost but requires HTTPS for all non-local access.
- **TideCloak image**: No production image is currently documented. `tideorg/tidecloak-dev` and `tideorg/tidecloak-stg-dev` are dev/staging only (H2 embedded DB). Contact Tide for production deployment guidance.
- **Reverse proxy** (recommended example, not Tide-certified): Forward `Host` and `X-Forwarded-Proto` headers. Set `KC_PROXY_HEADERS=xforwarded` on the TideCloak container. DPoP `htu` verification requires the proxy to preserve the original URL as seen by the client.
