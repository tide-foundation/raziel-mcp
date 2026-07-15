# Tide Pack Version Policy

Central version reference for all templates, install snippets, and setup guidance.

All other pack files point here. Do not duplicate version numbers in playbooks or templates. If a version changes, update this file and re-align dependents.

---

## Tide SDK Packages

Resolved from npm registry on 2026-07-07. npm is the release source of truth. Repo `package.json` version fields lag npm (e.g. `tidecloak-js` source on `main` reads 0.12.15); always confirm against npm, not the checked-out source tree.

| Package | Stable version | Range for templates | Purpose |
|---------|---------------|--------------------| --------|
| `@tidecloak/js` | 0.13.33 | `0.13.33` | Core SDK (vanilla JS, IAMService) |
| `@tidecloak/react` | 0.13.33 | `0.13.33` | React hooks and guard components |
| `@tidecloak/nextjs` | 0.13.33 | `0.13.33` | Next.js provider and hooks |
| `@tidecloak/verify` | 0.13.33 | `0.13.33` | Server-side JWT verification (CJS) |
| `heimdall-tide` | 0.13.33 | `0.13.33` | Policy signing, BasicCustomRequest |
| `@tideorg/js` | 0.13.33 | `0.13.33` | Models, Contracts (Forseti). `tide-js` `main` package.json reads 0.13.32; npm latest is 0.13.33. |
| `asgard-tide` | 0.13.33 | `0.13.33` | Signing request builders (`BasicCustomRequest`, `DynamicPayloadCustomRequest`) |

**Pin to exact version in templates.** Tide packages are pre-1.0. Minor bumps can break. Run `npm view <package> version` before installing to confirm the latest stable.

---

## Framework Packages

Resolved from npm registry on 2026-03-25.

| Package | Stable version | Range for templates | Notes |
|---------|---------------|--------------------| ------|
| `next` | 16.2.1 | `^16.0.0` | Default for generated apps. App Router and Pages Router. Uses `proxy.ts` for request interception (not `middleware.ts`). |
| `react` | 19.0.0 | `^19.0.0` | Required by Next.js 15+. |
| `react-dom` | 19.0.0 | `^19.0.0` | Matches React. |
| `vite` | 6.0.0 | `^6.0.0` | Stable for React SPA templates. |
| `jose` | 6.0.0 | `^6.0.0` | JWT verification library. |
| `typescript` | 5.7.0 | `^5.0.0` | Wide range acceptable. |
| `@vitejs/plugin-react` | 4.3.0 | `^4.0.0` | Vite React plugin. |
| `@types/node` | 22.0.0 | `^22.0.0` | Node.js type definitions. |
| `@types/react` | 19.0.0 | `^19.0.0` | React type definitions. Matches React major. |
| `@types/react-dom` | 19.0.0 | `^19.0.0` | React DOM type definitions. |

**Use caret ranges for framework packages.** Framework packages follow semver. Caret ranges allow safe patch/minor updates.

**Generated apps target latest stable Next.js.** The default generated-app path uses the current stable Next.js version (^16.0.0). Existing app retrofit paths must respect the project's current Next.js version — do not force-upgrade. See `canon/framework-matrix.md` for version-specific conventions (`proxy.ts` for Next.js 16+, `middleware.ts` for Next.js 15).

---

## Version Verification Commands

Before installing, verify current stable versions:

```bash
# Tide packages
npm view @tidecloak/nextjs version
npm view @tidecloak/react version
npm view @tidecloak/js version
npm view @tidecloak/verify version
npm view heimdall-tide version
npm view @tideorg/js version

# Framework packages
npm view next version
npm view react version
npm view vite version
npm view jose version
```

---

## Anti-Patterns

- **Do not use `latest` tag in package.json.** Pin Tide packages to exact versions. Use caret ranges only for framework packages. This applies to all Tide packages: `@tidecloak/*`, `@tideorg/js`, `heimdall-tide`, `asgard-tide`.
- **Do not use `-staging` npm tags.** Tags like `0.13.24-staging` are pre-release builds. Always use the stable version listed above. "Use staging" refers to the Docker image (`tideorg/tidecloak-stg-dev`), never to npm package tags. VERIFIED (LEARNINGS-batch-005 L-01, L-02).
- **Do not assume 1.0.0.** All Tide packages are pre-1.0. Do not write `"@tidecloak/nextjs": "^1.0.0"`.
- **Do not hardcode versions in playbook install snippets.** Playbooks should say `npm install @tidecloak/nextjs` (installs latest) and then instruct the builder to verify with `npm view`. Templates pin the version explicitly.
- **Docker image and npm versions are independent.** Switching to the staging Docker image (`tidecloak-stg-dev`) does NOT mean switching to staging npm packages. npm packages stay at stable versions.

---

## When to Update This File

- When a new stable Tide SDK release is published.
- When a framework major version ships that affects template compatibility.
