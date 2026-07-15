# Role-Policy Matrix — Git PR Signing Service

## Tide bootstrap roles

| Role | Purpose | Attached policy | Created by | Approved by | Required before first use | Default / optional | Notes |
|------|---------|----------------|------------|-------------|--------------------------|-------------------|-------|
| `_tide_enabled` | Enables Tide operations for user | None (gate role) | Realm template | N/A (declared in realm.json) | Yes | Default | Must be in realm.json. Not auto-created. |
| `tide-realm-admin` | Full realm administration | N/A | Bootstrap script | N/A (first admin) | Yes (at least one) | Required | Client role on `realm-management`, not a realm role. |

## Signing roles (Forseti contract-backed)

| Role | Purpose | Attached policy | Created by | Approved by | Required before first use | Default / optional | Notes |
|------|---------|----------------|------------|-------------|--------------------------|-------------------|-------|
| `git-sign:<branch>` (e.g., `git-sign:main`) | Authorizes signing merge commits to a specific branch | Forseti contract with `signed_policy_data`; validates commit content, approvers, executor | Admin via service UI | Tide realm admin(s) via IGA | Yes (for that branch) | Per-branch | PolicyApproval must be committed before signing works. |
| `git-sign:*` (optional) | Authorizes signing merge commits to any branch | Same Forseti contract, wildcard match | Admin via service UI | Tide realm admin(s) via IGA | No | Optional | Use for admins who can approve merges to any branch. |

## Service identity roles

| Role | Purpose | Created by | Notes |
|------|---------|------------|-------|
| `signing-service` (client role) | Identifies the service as the signing executor | Admin during bootstrap | The Forseti contract's `ValidateExecutor` checks for this role. Ensures only the service (not individual admins) can execute the signing request. |

## Key rules

1. `_tide_enabled` must be declared in `realm.json`. Not auto-created by `setUpTideRealm`.
2. Signing roles are client roles on the service's OIDC client, not realm roles.
3. Each signing role requires a committed PolicyApproval with `signed_policy_data` before ORKs authorize signing.
4. Role assignment changes go through IGA change-sets. Roles appear in JWT/doken after next token refresh (up to 120s delay).
5. `tide-realm-admin` is a client role on `realm-management`, not a realm role.
6. Admins who review and approve PRs need both `tide-realm-admin` and the relevant `git-sign:<branch>` role.
7. The service itself needs a service identity with the `signing-service` role for `ValidateExecutor`.

## Forseti contract for git commit signing

```csharp
using Ork.Forseti.Sdk;

public class GitCommitSigningPolicy : IAccessPolicy
{
    [PolicyParam] public string Role { get; set; }       // e.g. "git-sign:main"
    [PolicyParam] public string Resource { get; set; }    // client ID
    [PolicyParam] public int threshold { get; set; }      // e.g. 2 admins

    public PolicyDecision ValidateData(DataContext ctx)
    {
        // Parse the git commit payload
        // Validate:
        //   - target branch matches the role suffix
        //   - author identity is present
        //   - commit message is non-empty
        // Optional checks:
        //   - reject commits modifying protected paths (e.g., .github/workflows/)
        //   - require commit message format (conventional commits, ticket reference)
        //   - enforce repo allow-list
        //   - validate PR metadata (reviewers, labels, checks passed)
        return PolicyDecision.Allow();
    }

    public PolicyDecision ValidateApprovers(ApproversContext ctx)
    {
        var approvers = DokenDto.WrapAll(ctx.Dokens);
        return Decision.RequireAnyWithRole(approvers, Role, Resource, threshold);
    }

    public PolicyDecision ValidateExecutor(ExecutorContext ctx)
    {
        var executor = new DokenDto(ctx.Doken);
        return Decision.RequireNotExpired(executor)
            .And(Decision.RequireRole(executor, "signing-service", Resource));
    }
}
```

**Contract notes**:
- `ValidateData` receives the commit bytes that will be signed. Parse them to extract branch, author, message, and file changes.
- `ValidateApprovers` checks that enough admins with the `git-sign:<branch>` role approved the PR.
- `ValidateExecutor` checks the service's identity, not an individual admin. The service is the entity that submits the signing request after collecting approvals.
- Use `BasicCustomRequest` (model ID: `BasicCustom<GitSign>:BasicCustom<1>`). The commit content is known at request creation time and does not change.

## Policy parameters

| Parameter | Type | Required | Example | Purpose |
|-----------|------|----------|---------|---------|
| `Role` | string | Yes | `git-sign:main` | The client role required for approvers |
| `Resource` | string | Yes | `git-pr-signing-service` | The client ID for role lookup |
| `threshold` | number | Yes | `2` | Minimum number of admin approvals before signing |

## Approval flow

1. PR opened on GitHub
2. Service receives webhook, creates check run (pending)
3. Admins log in to service via TideCloak OIDC
4. Each admin reviews code in service UI, clicks "Approve" (collects doken as approval)
5. When `threshold` approvals collected, service creates `BasicCustomRequest` with commit bytes
6. Service attaches admin dokens as approvers and its own doken as executor
7. ORKs execute Forseti contract: validate commit, check approver roles, verify service identity
8. If contract allows, ORKs produce Ed25519 signature
9. Service wraps signature in SSH format, creates signed commit via GitHub API
10. Service updates check run to success, merges PR
