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

Expected after this release: **16 tools, 16/16 annotated, prompts: 5, tide_gaps
ok: yes, version 1.9.0**. (Before the deploy it reports 14 / 0 annotated / 1.4.1
— that's the before/after proof.)

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
