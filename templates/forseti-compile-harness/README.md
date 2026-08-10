# Forseti Local Compile Harness

Compile a Forseti contract locally, in about a second, before deploying it.

## Why this exists

**Contracts are compiled by the ORK at request time.** A typo or a wrong context property does not
surface when you write it — it surfaces as `VmHost.CompileFailed` on the ORK, **after** an operator
has already approved the request in the Tide enclave. Every mistake costs a full approval cycle.

```
VmHost.CompileFailed: (210,41): error CS1061: 'ExecutorContext' does not contain
a definition for 'Data'
```

That error was found by this harness in under a second. It had already cost an approval.

Shape errors are exactly what `VmHost.CompileFailed` reports, so stubs with the correct **shapes**
catch the whole class. Behaviour is irrelevant.

Every Forseti app should ship one of these and run it in CI.

## Usage

```bash
./check.sh path/to/MyContract.cs        # compile + sandbox scan + structure check + contractId
```

Or the compile step alone:

```bash
dotnet build check.csproj -p:ContractPath=../../src/contracts/MyContract.cs
dotnet build check.csproj -p:ContractPath='../../src/contracts/**/*.cs'
```

With no `ContractPath`, it compiles `contracts/**/*.cs` beside the harness. A glob that matches
nothing is a hard error — a green build over zero contract files is the one outcome that looks like
success and proves nothing.

## What it checks

| Check | Catches |
|---|---|
| Compile against stubs | wrong context property (`ctx.Data` in `ValidateExecutor`), `ctx.Approvers` vs `ctx.Dokens`, `PolicyDecision.Approve()`, typos, wrong signatures, unimplemented interface members |
| Sandbox scan (grep) | `System.IO`, `System.Net`, `System.Threading`, `System.Reflection`, `System.Diagnostics`, `System.Console`, `DateTime.Now`, `Guid.NewGuid`, `Random` |
| Structure | missing `using Ork.Forseti.Sdk;`, nothing implementing `IAccessPolicy`, `PolicyDecision.Approve()` |
| `contractId` | prints the SHA-512 **uppercase** hex — the ORKs compare it case-sensitively |

### What it does NOT check

Be clear about the boundary; a pass here is not a pass overall.

- **IL vetting.** Blocked namespaces *compile fine* and fail at upload with
  `BadPolicy.ForbiddenCall`. The grep in `check.sh` is a crude proxy, not the real vetting pass.
- **Contract logic.** Every stub returns a fixed value. A passing build says the contract compiles,
  never that it decides correctly.
- **Gas.** The 50,000 limit is a runtime property.
- **Anything outside the contract file** — the policy's `modelId`, the three-level contract
  transport, whether `contractId` matches what you submit, vuid-vs-subject. Those are in the
  [pre-flight checklist](../../canon/custom-contracts.md#pre-flight-checklist-all-client-side-no-network).

## Stub fidelity — read this before trusting a PASS

`Stubs.cs` is **ASSUMED** shapes, derived from `canon/custom-contracts.md` (itself VERIFIED against
`Ork.Forseti.Sdk` for `IAccessPolicy`, the context property names, `DokenDto`, and the `Decision`
builder).

The failure mode that matters: **a stub more permissive than the real SDK yields a false PASS.** The
inverse — a stub narrower than reality — yields a false FAIL on correct code, which is annoying but
safe. L-17 hit exactly this with `Cryptide.Tools.Utils.GetEpochSeconds` stubbed at the wrong shape.

So: when the real SDK contradicts a stub, **fix the stub and re-run**, and prefer copying real
signatures over guessing. Treat `Stubs.cs` as a living mirror of the SDK, not a fixed artifact.

`Decision` is split across two types (`Decision` static entry + `DecisionBuilder` instance methods)
because C# forbids same-signature static and instance methods on one type, and contracts chain
`Decision.RequireX(...).RequireY(...)`. **Keep both surfaces identical** — a method on one and not
the other fails depending on where in the chain it appears.

## Verifying the harness itself

```bash
./check.sh examples/PassingContract.cs    # exit 0
./check.sh examples/FailingContract.cs    # exit 1 — three shape errors
```

`examples/FailingContract.cs` reproduces the real mistakes: `ctx.Data` in `ValidateExecutor`,
`ctx.Approvers` instead of `ctx.Dokens`, and `PolicyDecision.Approve()`.

Run this after editing `Stubs.cs`. If `FailingContract.cs` starts passing, the stubs have drifted
permissive and the harness is no longer protecting you.

## Requirements

.NET SDK 8.0+ (verified on 9.0.308 and 10.0.203 targeting `net8.0`). Override with
`-p:TargetFramework=net9.0` if you have no `net8.0` targeting pack.

## Related

- [canon/custom-contracts.md](../../canon/custom-contracts.md) — contract API, the context split, pre-flight checklist
- [playbooks/deploy-forseti-policy.md](../../playbooks/deploy-forseti-policy.md) — the ordered deploy sequence
- AP-67 — deploying a Forseti contract without compiling it locally first
