# Scenario-Pattern Library

Known app scenarios with pre-defined Tide role, policy, and bootstrap patterns.

## Purpose

When a user describes an app that matches a known scenario, agents use the scenario manifest to determine:
- which Tide features are required
- which roles and policies to create
- who creates and approves them
- the correct playbook sequence
- what must happen before users can use the app

## How to use

1. When a user says "build me an app" or describes an app type, check this index.
2. If the description matches **one** scenario, read its `manifest.yaml` for the full pattern.
3. If the description matches **multiple** scenarios or is ambiguous, resolve the branch before proceeding. Use the discriminating questions in the table below. If unresolved, ask the user — do not silently pick one. (I-17)
4. Use the matched manifest to drive role creation, policy deployment, and playbook ordering.
5. If no scenario matches and the request is a standard auth/protection flow, fall back to `tide-setup` skill detection and playbook routing.
6. If no scenario matches and the request describes a **novel pattern** not covered by existing playbooks, route to `tide-solutions-architect` to explore safe implementation options within pack constraints.

## Disambiguation

If the request could map to multiple scenarios, resolve with these questions:

| Ambiguity | Discriminating question | If yes | If no |
|-----------|------------------------|--------|-------|
| Encryption vs signing | Does the app encrypt/decrypt data, or produce cryptographic signatures? | Encryption → check sharing/real-time. Signing → `policy-governed-signing`. | Neither → check governance or standard auth. |
| Self-encryption vs shared | Do other users need to decrypt the same ciphertext? | `organisation-password-manager` or `setup-forseti-e2ee` | Self-encryption via `tide-rbac-and-e2ee` or `encrypted-communication` |
| Real-time E2E vs stored data | Does the app need real-time encrypted communication (chat, video, audio) with external crypto? | `encrypted-communication` | `organisation-password-manager` or standard self-encryption |
| Vault/org app vs generic app | Is this a credential vault, password manager, or team-shared encrypted store? | `organisation-password-manager` | Check other scenarios or use standard playbooks |
| Governance vs end-user app | Does the app need a custom admin UI for approving IGA change requests? | `iga-admin-governance` | Standard auth playbooks |
| Admin panel vs built-in console | Is the built-in TideCloak Admin Console sufficient for governance? | Standard playbooks (no custom governance needed) | `iga-admin-governance` |
| Signing service vs direct signing | Does the app sign git commits/merges server-side after PR-based admin approval? | `git-pr-signing-service` | `policy-governed-signing` (direct in-app signing) |
| Single scenario vs no match | Does the description mention domain-specific keywords (SSH, vault, signing, admin, governance, chat, video, messaging)? | Use matched scenario | Use generic playbook routing |

## Scenarios

| ID | Scenario | Primary Tide capability | Default roles | Policy roles | When to use |
|----|----------|------------------------|---------------|-------------|-------------|
| `organisation-password-manager` | Shared credential vault for teams | Self-encryption + policy-governed encryption (Forseti) | `_tide_enabled`, `_tide_<tag>.selfencrypt`, `_tide_<tag>.selfdecrypt` | `appUser`, `orgOwner` | Password manager, credential vault, team vault, secret store |
| `policy-governed-signing` | Cryptographic signing via Forseti contracts on ORK network | Policy-governed threshold signing (Forseti) | `_tide_enabled` | Per-resource signing roles (e.g., `ssh:<user>`) | Keyless SSH, document signing, transaction signing, any policy-governed signing |
| `git-pr-signing-service` | Enterprise PR-based commit signing via GitHub webhooks | Policy-governed threshold signing (Forseti) + GitHub API | `_tide_enabled` | Per-branch signing roles (e.g., `git-sign:main`) | Git commit signing, verified commits, enterprise code signing, PR signing service |
| `iga-admin-governance` | Custom admin panel for IGA change request governance | IGA change-set lifecycle + multi-admin quorum | `_tide_enabled`, `tide-realm-admin` | None (governance, not data) | Admin dashboard, approval workflow, change request management, governance panel |
| `encrypted-communication` | Real-time encrypted chat/video with Tide-protected key storage | Self-encryption (key storage) + external crypto (runtime E2E) | `_tide_enabled`, `_tide_<tag>.selfencrypt`, `_tide_<tag>.selfdecrypt` | None | Encrypted chat, encrypted video calls, secure messaging, zero-knowledge server |

## Matching rules

- Match on app description keywords, not exact names.
- `organisation-password-manager` matches: "password manager", "credential vault", "shared secrets", "team vault", "org vault", "shared password store", "secret store", "vaultwarden", "bitwarden", "encrypted sharing", "share encrypted data", "cross-user decryption", "shared encryption", "encrypt and share", "chosen recipients", "selective sharing", "encrypt for others".
- `policy-governed-signing` matches: "keyless ssh", "ssh signing", "policy signing", "threshold signing", "document signing", "transaction signing", "forseti signing", "ork signing", "decentralised signing", "sign with tide".
- `git-pr-signing-service` matches: "git signing", "git commit signing", "commit signing", "signed commits", "verified commits", "github signing", "github verified", "pr signing", "merge signing", "sign commits", "sign merges", "code signing service", "enterprise commit signing", "verified badge", "git tag signing".
- `iga-admin-governance` matches: "admin panel", "admin dashboard", "governance panel", "governance dashboard", "change request", "approval workflow", "multi-admin", "quorum approval", "iga admin", "iga panel", "manage change requests", "approve changes", "admin console", "policy management panel".
- `encrypted-communication` matches: "encrypted chat", "encrypted messaging", "encrypted video", "e2e chat", "e2e messaging", "secure chat", "secure messaging", "private messaging", "zero knowledge", "encrypted group chat", "encrypted video call", "signal-like", "whatsapp-like", "chat app with encryption", "video app with encryption", "encrypted collaboration", "forward secrecy", "key exchange".
- If the user describes a **single-user private vault** with no sharing, do NOT use the password manager scenario. Use the `nextjs-e2ee-vault` template instead.
- If the user describes **only authentication** with no signing or encryption, do NOT use these scenarios. Use the standard playbook sequence.
- If the user only needs the **built-in TideCloak Admin Console** for governance, do NOT use the `iga-admin-governance` scenario. Use the standard `setup-iga-admin-panel` playbook directly.

## What a scenario defines

Each scenario directory contains:

| File | Purpose |
|------|---------|
| `scenario.md` | What the app is, what Tide features it needs |
| `manifest.yaml` | Machine-readable: roles, policies, playbook sequence, bootstrap requirements |
| `role-policy-matrix.md` | Which roles exist, what each policy checks, who approves |
| `bootstrap-sequence.md` | Step-by-step pre-user setup (admin-only, before app goes live) |
| `anti-patterns.md` | Scenario-specific mistakes |

## Key differences between scenarios

| Aspect | organisation-password-manager | policy-governed-signing | git-pr-signing-service | iga-admin-governance | encrypted-communication |
|--------|------------------------------|------------------------|------------------------|---------------------|------------------------|
| Primary operation | Encrypt/decrypt data | Sign data | Sign git merge commits | Approve/commit admin changes | Real-time encrypted communication |
| Encryption | Self-encryption + policy-governed | None | None | None | Self-encryption (key storage) + external crypto (runtime) |
| Signing | None | Forseti contract-authorized threshold signing | Forseti contract-authorized threshold signing (git commits) | Enclave signing for change-set approval | None |
| Org-scoped roles | Yes (`org:{uuid}:{role}`) | No | No | No | No |
| E2EE roles | Yes (`_tide_<tag>.selfencrypt/selfdecrypt`) | No | No | No | Yes (`_tide_<tag>.selfencrypt/selfdecrypt`) |
| Forseti contracts | Validate org scope + VVK signatures | Validate data + authorize signer | Validate commit content + authorize approvers + verify service | Optional: manage role-policy attachments | None |
| External integration | No | No | Yes (GitHub webhooks, Checks API, Git Data API) | No | No |
| External crypto library | No | No | No (SSH wire format wrapping only) | No | Yes (libsodium, WebCrypto, etc.) |
| IGA required | Yes | Yes | Yes | Yes (core purpose) | Yes |
| Admin pre-approval | Yes (appUser, orgOwner policies) | Yes (signing policies per role) | Yes (signing policies per branch) | Yes (quorum for all admin mutations) | Yes (E2E roles) |
| Min admins | 1 | 1 | 2 (signing quorum) | 2 (for quorum governance) | 1 |
| Developer interacts with Tide | Yes | Yes | No (developers push code normally) | Yes | Yes |
