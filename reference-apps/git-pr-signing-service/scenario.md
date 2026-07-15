# Git PR Signing Service

## What this is

A server-side service that threshold-signs git merge commits after admin approval. Developers push code and open pull requests as normal. The service receives GitHub webhooks, presents PRs for admin review in a web UI, and after Forseti-governed quorum approval, signs the merge commit using Tide ORK threshold cryptography. The signed commit appears on GitHub with a "Verified" badge.

No single entity holds the signing key. The key exists only as threshold shares across independent ORKs.

## When to use this scenario

Use when the user describes:
- a service that signs git commits using threshold cryptography
- enterprise code signing with multi-admin approval
- GitHub verified commits without developer-held keys
- a PR approval workflow that produces signed merges
- removing GPG/SSH key management from individual developers
- organizational governance over code signing

Do NOT use when:
- the user needs local `git commit -S` signing at the developer's machine (no server-side service exists for this yet — see GAP-063, GAP-064)
- the user needs to sign container images (use cosign or standard `policy-governed-signing`)
- the user needs SSH challenge signing (use `policy-governed-signing` directly)
- the user needs only authentication with no signing

## Core Tide capabilities used

1. **TideCloak OIDC authentication** — zero-knowledge login via threshold PRISM (admins only; developers do not interact with Tide)
2. **DPoP token binding** — access tokens bound to admin's device/session
3. **Doken** — delegation token authorizing ORK-mediated signing operations
4. **Forseti contracts** — C# contracts validate commit content, approver roles, and executor identity before ORKs produce signature
5. **Policy:1 auth flow** — policy-based authorization; ORKs check contract before producing signature
6. **IGA (Identity Governance)** — role and policy changes require multi-admin approval via change-sets
7. **BasicCustomRequest** — request pattern for submitting commit bytes to ORKs for signing

## Architecture

```
Developer              GitHub                Signing Service                    Tide ORKs
   |                      |                   (browser)     (server)                |
   |-- git push / open PR |                      |             |                   |
   |                      |-- webhook: PR ------>|             |                   |
   |                      |                      |-- pending ->|                   |
   |                      |<-- status check -----|             |                   |
   |                      |                      |             |                   |
   |                      |    Admins log in via TideCloak OIDC                    |
   |                      |    (standard browser, SWE iframe, PRISM)               |
   |                      |                      |             |                   |
   |                      |    Admin 1 reviews code, approves (doken collected)    |
   |                      |    Admin 2 reviews code, approves (doken collected)    |
   |                      |                      |             |                   |
   |                      |    Quorum met. Last approving admin triggers signing:  |
   |                      |                      |             |                   |
   |                      |                      |-- GET commit data -->|           |
   |                      |                      |<-- commit bytes ----|           |
   |                      |                      |                     |           |
   |                      |                      |-- ORK signing (browser) ------->|
   |                      |                      |   createTideRequest + execute   |
   |                      |                      |   Forseti validates:            |
   |                      |                      |     - commit (ValidateData)     |
   |                      |                      |     - approvers (ValidateAppr)  |
   |                      |                      |     - executor (ValidateExec)   |
   |                      |                      |<-- Ed25519 64-byte sig ---------|
   |                      |                      |                     |           |
   |                      |                      |-- POST sig ------->|           |
   |                      |                      |   (server wraps SSH + GitHub)   |
   |                      |<-- signed commit, update ref -------------|           |
   |                      |                      |-- set status: success           |
   |                      |                      |                                 |
   |                      |-- Verified badge shown                                 |
```

**Critical**: ORK signing happens in the admin's browser, not server-side. The JS SDK's `createTideRequest` + `executeSignRequest` require the authenticated TideCloak session (doken, PRISM state) which only exists in the browser context. The server receives the raw 64-byte signature and handles SSH wrapping + GitHub API calls. VERIFIED (LEARNINGS-ratidefy-batch-001 L-10).

## GitHub integration components

| Component | GitHub feature | Purpose |
|-----------|---------------|---------|
| Webhook receiver | `pull_request` event webhook | Notifies service of new/updated PRs |
| Status check | Checks API (`POST /repos/{owner}/{repo}/check-runs`) | Blocks merge until service approves and signs |
| Commit signing | Git Data API (`POST /repos/{owner}/{repo}/git/commits` with `signature`) | Creates signed merge commit |
| Branch protection | Required status checks + required reviews | Enforces that all merges go through the service |
| Bot identity | GitHub App or bot account with Ed25519 SSH signing key | Public key for "Verified" badge verification |

## Ed25519 to SSH signature format

Tide ORKs produce raw 64-byte Ed25519 signatures. GitHub requires SSH signature wire format for commit verification.

The wrapping is a non-cryptographic transformation:
1. Take raw 64-byte Ed25519 signature from ORKs
2. Wrap in SSH signature format: `BEGIN SSH SIGNATURE` block
3. Namespace: `git`
4. Hash algorithm: `sha512`
5. Signature blob: SSH-encoded Ed25519 signature

The threshold Ed25519 public key is uploaded to the service's GitHub App (or bot account) as an SSH signing key. GitHub verifies the signature against that key.

VERIFIED — GitHub docs explicitly list `ssh-ed25519` as a supported key type for commit verification.

## GitHub Verified Badge Requirements

For a signed commit to show the green "Verified" badge on GitHub, three things must align:

1. **SSH signing key registered**: The threshold Ed25519 public key must be added to a GitHub account as a **Signing Key** (Settings → SSH and GPG Keys → type: Signing Key).
2. **Committer email matches**: The commit's `committer.email` field must match the email of the GitHub account that has the signing key registered. A mismatch produces `unknown_signature_type` instead of "Verified".
3. **SSH wire format correct**: The raw signature must be properly wrapped in `BEGIN SSH SIGNATURE` block with correct namespace and hash algorithm.

**SSH key derivation from tidecloak.json**:
The threshold Ed25519 public key is in the adapter JSON's `jwk.keys[0].x` field (base64url-encoded 32-byte key). Convert to SSH format: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA<base64> <comment>`.

**GitHub App limitation**: GitHub App bot accounts (e.g., `ratidefy[bot]`) cannot have SSH keys added via the UI. Use a dedicated machine user account for the committer identity.

VERIFIED (LEARNINGS-ratidefy-batch-001 L-26).

## What must exist before first use

1. TideCloak running with a realm for the signing service
2. Realm licensed (`setUpTideRealm`) and IGA enabled (`toggle-iga`)
3. Admin user(s) created, Tide accounts linked, `tide-realm-admin` role assigned
4. Initial change-sets approved and committed
5. `sign-idp-settings` called after IDP config changes
6. Adapter JSON exported with `jwk`, `vendorId`, `homeOrkUrl`, `client-origin-auth-*`
7. At least one signing role created (e.g., `git-sign:main`) via admin UI
8. Signing policy created, approved, and committed for each role
9. GitHub App registered with webhook URL, permissions for checks + contents + pull_requests
10. Threshold Ed25519 public key uploaded to GitHub App/bot as SSH signing key
11. Branch protection rules configured: require signing service status check
12. Service running with JWT + DPoP verification on protected endpoints

## Key diagnostics

| Symptom | Likely cause |
|---------|-------------|
| No webhook received | GitHub App not installed on repo, webhook URL wrong, or service not reachable |
| Status check stays pending | Service received webhook but admin approval quorum not met |
| Signing fails with "No doken available" | Admin not authenticated or doken expired |
| Forseti contract rejects | ValidateData failed (check commit payload parsing), or executor lacks signing role |
| Merge commit not "Verified" | Public key not uploaded to GitHub, SSH wire format wrong, or wrong key used |
| 401 from GitHub API | GitHub App token expired or insufficient permissions |
| Webhook signature invalid | Webhook secret mismatch between GitHub App config and service |

## Intentionally configurable

- **Signing role naming**: `git-sign:<branch>` is the default pattern. Apps may use `git-sign:<repo>`, `git-sign:*` (all branches), or other patterns.
- **Approval quorum**: Number of admin approvals before signing. Configurable in Forseti contract `threshold` parameter.
- **ValidateData logic**: What the contract validates about the commit. Apps may check: target branch, author identity, commit message format, modified file paths, PR metadata.
- **Approval type**: Implicit (doken-only) or explicit (requires operator approval popup).
- **Branch scope**: Which branches require signed merges. Configurable via GitHub branch protection rules.
- **GitHub identity**: GitHub App (preferred for organizations) or bot account (simpler for personal repos).

## Relationship to policy-governed-signing

This scenario is a specialization of `policy-governed-signing` for the git/GitHub domain. It inherits all invariants, anti-patterns, and Forseti contract patterns from the parent scenario. The key differences:

| Aspect | policy-governed-signing | git-pr-signing-service |
|--------|------------------------|------------------------|
| Trigger | User action in app | GitHub webhook (PR event) |
| Data signed | App-specific (SSH challenge, document hash, etc.) | Git merge commit bytes |
| Signature format | Raw Ed25519 | Ed25519 wrapped in SSH wire format |
| Signature delivery | Returned to app/user | Pushed to GitHub via Git Data API |
| Developer interaction with Tide | Direct (signs in app) | None (developers push code normally) |
| External integration | None | GitHub webhooks, Checks API, Git Data API |
| UI | App-specific signing UI | PR review + approval dashboard |

## What this scenario does NOT cover

- **Local git signing**: Developer-side `git commit -S` with Tide. Blocked by GAP-063 (no Go SDK) and GAP-064 (no CLI auth). The browser-bridge pattern (LEARNINGS-cosign-batch-001 L-08) is a potential future path.
- **Container image signing**: Use cosign or standard `policy-governed-signing`.
- **CI/CD pipeline signing**: The service IS the signer. No separate CI integration needed.
- **Tag signing**: Architecturally similar to commit signing. Same service can sign tags via GitHub Git Data API (`POST /repos/{owner}/{repo}/git/tags`). Not yet documented as a separate flow.
