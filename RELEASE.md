# Release runbook — `@tideorg/mcp`

Steps to cut a release: publish to npm, redeploy the hosted server, verify, tag.
Run from the repo root on an up-to-date `main`. Versions must already be bumped
and merged (see the version-sync gate check). Example below uses **1.9.0**.

Prerequisites:
- `main` merged and clean; `git pull`.
- npm: logged in with publish rights to `@tideorg` (`npm whoami`).
- Docker: running, logged in with push rights to the `tideorg` Docker Hub org.
- Azure: `az login` with access to the `tide-mcp-rg` resource group.

## 0. Preflight — gate must be green

```bash
cd mcp-server && npm test && cd ..     # expect: 113/113 passed
claude plugin validate .               # expect: Validation passed
```

Confirm the versions agree (the gate also checks this):

```bash
node -p "require('./package.json').version"                 # 1.9.0
node -p "require('./mcp-server/package.json').version"      # 1.9.0
node -p "require('./.claude-plugin/plugin.json').version"   # 1.9.0
grep -A1 '@tideorg/mcp' mcp-server/src/server.ts | grep version   # 1.9.0
```

## 0. Sync to raziel-mcp (publish from there, not the workshop)

`raziel-mcp` is the public product and the publish source. Promote the workshop to it first.
The sync reads committed `main` — merge your changes before running it, or they won't cross over.

```bash
git checkout main && git pull --ff-only              # sync reads main, not your working tree
(cd mcp-server && npm ci && npm run build)           # the redact step needs dist/server.js
rm -rf /path/to/raziel-mcp/mcp-server/node_modules   # Windows: a locked node_modules fails the wipe
scripts/sync-to-raziel.sh /path/to/raziel-mcp        # regenerates raziel, leak-checks, then STOPS
```

The script wipes raziel (keeping only `.git`, `LICENSE`, `server.json`), copies the publish
allowlist from `main`, strips the non-self-service Forseti steps, re-brands to Raziel, and stages
the result. It never commits. Then, in `raziel-mcp`:

```bash
# 1. Bump server.json "version" by hand — the sync never touches it.
# 2. Gate must pass:
(cd mcp-server && npm ci && npm test)
# 3. Review and ship:
git --no-pager diff --cached
git commit -m "Sync <version>: <summary>" && git push
```

Watch for:
- **`Leak check: OK`** in the output. `LEAK` means a private file (`sources/`, `notes/`, `evals/`,
  `CLAUDE.md`, `AGENTS.md`) crossed over — do not push.
- **`WARN: '<x>' … NOT classified`** means a new top-level path isn't in the allowlist. Decide where
  it belongs in `sync-to-raziel.sh` before trusting the result.
- **`server.json` left behind** ships the old version to the MCP Registry while npm ships the new one.

## 1. Publish to npm

`prepublishOnly` builds `dist/` first; `files` bundles the content dirs.

```bash
npm publish --access public
npm view @tideorg/mcp version          # expect: 1.9.0
```

This is what `npx -y @tideorg/mcp` and the Claude Code plugin pull.

## 2. Redeploy the hosted server (Azure Container Apps → mcp.tide.org)

`deploy.sh` builds `tideorg/mcp:latest` **and** `tideorg/mcp:<version>` (tagged
off `package.json`, now `1.9.0`), pushes both, and updates the `tide-mcp` app.
The `mcp.tide.org` custom domain stays mapped to the app — no DNS changes.

```bash
./deploy.sh
```

Note: `deploy.sh` updates the app to the `:latest` tag, which creates a new
revision that pulls the freshly pushed image. If you prefer a pinned deploy,
update the app to `tideorg/mcp:1.9.0` explicitly.

## 3. Verify the live endpoint

```bash
cd mcp-server && npm run test:remote          # default: https://mcp.tide.org/mcp
```

Expected: **22 tools, 22/22 annotated, prompts: 5**, the released version, and `ok: yes` for
`tide_gaps`, `tide_dpop_asset`, `tide_branding`, `tide_onboarding` and `tide_choose_playbook`,
instructions that fit, and both `/pack` routes. The asset tools and `/pack` routes read `templates/`
from the image: an `ok: NO` there means the image was built without it. The check exits non-zero on
any of these.

Also:

```bash
curl -s https://mcp.tide.org/health        # {"status":"ok","name":"@tideorg/mcp"}
```

## 4. Tag + GitHub release

```bash
git tag -a v1.9.0 -m "v1.9.0"
git push origin v1.9.0
gh release create v1.9.0 --title "v1.9.0" --notes-file <(sed -n '/^## 1.9.0/,/^## /p' CHANGELOG.md)
```

(Or paste the `1.9.0` section of `CHANGELOG.md` into the GitHub release UI.)

## Rollback

- **npm**: you cannot overwrite a published version. Publish a patch (e.g. 1.9.1)
  with the fix, or `npm deprecate @tideorg/mcp@1.9.0 "use 1.9.1"`.
- **Hosted**: `az containerapp revision list -n tide-mcp -g tide-mcp-rg` then
  activate the previous revision, or redeploy `tideorg/mcp:<previous-version>`.
