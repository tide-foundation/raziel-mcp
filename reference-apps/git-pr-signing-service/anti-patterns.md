# Anti-Patterns — Git PR Signing Service

Scenario-specific mistakes. Each defeats a security property or causes a setup failure. Inherits all anti-patterns from `policy-governed-signing` (AP-PS01 through AP-PS16).

## AP-GS01: Signing commits without webhook signature verification

The service receives GitHub webhooks to trigger the signing flow. If it does not verify the HMAC-SHA256 webhook signature, an attacker can forge webhook payloads to trigger signing of arbitrary commits. Verify every webhook payload against the shared secret before processing.

## AP-GS02: Using cosign or gitsign as intermediary

cosign is for OCI container image signing. gitsign is for local developer-side signing via Fulcio/Rekor. Neither maps to a server-side PR-based signing service. Use the GitHub Git Data API directly to create signed commits.

## AP-GS03: Signing without quorum — single admin approval

The entire point of threshold signing with Forseti governance is that no single individual can authorize a signature. If the Forseti contract threshold is 1, any single compromised admin account can sign arbitrary code. Set threshold >= 2 for production.

## AP-GS04: Trusting GitHub PR metadata without re-validating

The webhook payload includes PR metadata (author, branch, reviewers, labels). The Forseti contract's `ValidateData` must parse and validate the actual commit bytes, not trust metadata from the webhook. Webhook payloads are GitHub's representation; the commit bytes are the cryptographic truth.

## AP-GS05: Storing the threshold Ed25519 private key

The threshold private key never exists in complete form anywhere. The service receives only the raw 64-byte signature from ORKs, never the key. If you find yourself storing, generating, or assembling a private key, you have broken I-01 (never-whole-key).

## AP-GS06: Skipping SSH wire format wrapping

GitHub requires SSH signature format (`BEGIN SSH SIGNATURE` block) for commit verification. Submitting the raw 64-byte Ed25519 signature to the Git Data API will not produce a "Verified" badge. The wrapping is a non-cryptographic transformation that must happen after ORK signing and before the GitHub API call.

## AP-GS07: Using master admin credentials in the service

The service must use admin OIDC tokens acquired via browser login for Tide operations (approval collection, signing requests). It must use GitHub App installation tokens for GitHub API calls. Do not embed `admin`/`password` or GitHub personal access tokens in the service. See AP-41.

## AP-GS08: Allowing merge without signing service status check

If branch protection does not require the signing service's status check, developers can merge PRs directly — bypassing threshold signing entirely. The branch protection rule is the enforcement point that routes all merges through the service.

## AP-GS09: Signing merge commits for the wrong branch

The Forseti contract should validate that the target branch matches the signing role's scope (e.g., `git-sign:main` should only sign merges to `main`). Without this check, a `git-sign:main` approval could be used to sign a merge to any branch.

## AP-GS10: Not verifying GitHub App token permissions at startup

The service authenticates to GitHub as a GitHub App installation. If the App's permissions are insufficient (missing `checks:write`, `contents:write`, or `pull_requests:read`), operations fail at runtime with opaque 403 errors. Verify permissions at service startup.

## AP-GS11: Assuming signed commits appear instantly

After creating a signed commit via the GitHub Git Data API and updating the branch ref, GitHub may take a few seconds to process the signature verification. Do not assert "Verified" badge presence immediately after the API call. The check run should be updated to success after the ref update, not after badge verification.

## AP-GS12: Re-using admin dokens across PRs

Each signing operation should use fresh admin approvals (dokens) specific to that PR's commit bytes. Re-using dokens from a previous PR approval would sign different data than what the admins reviewed. The Forseti contract's `ValidateData` should include PR-specific context to prevent replay.

## AP-GS13: Using GitHub merge API for tree computation

`POST /repos/{owner}/{repo}/merges` creates a **real merge commit** and advances the base branch. It is NOT a dry-run. Using it to compute the merge tree SHA causes PRs to be merged without threshold signatures — defeating the entire purpose of the signing service.

**Correct**: Use `GET /repos/{owner}/{repo}/git/commits/{headSha}` to read the head commit's tree SHA (no side effects). Build the merge commit payload from the tree SHA and both parent SHAs.

**Wrong**: `POST /repos/{owner}/{repo}/merges` with `base` and `head` — this performs a real merge.

VERIFIED (LEARNINGS-ratidefy-batch-001 L-14).
