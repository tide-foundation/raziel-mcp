# Forseti Local Compile Harness

Compile a Forseti contract locally, in about a second, before deploying it.

## The `ctx.Data` question

**The real type is not settled, so this harness compiles your contract against BOTH candidates and
requires it to pass under each.** That is not caution for its own sake — the pack has already shipped
the wrong single answer once and it rejected a contract with real threshold signatures on record.

The evidence is asymmetric, and only one direction counts:

| Style | Compiles if `Data` is `byte[]` | Compiles if `Data` is `ReadOnlyMemory<byte>` |
|---|---|---|
| `ReadOnlyMemory<byte> m = ctx.Data;` | yes (implicit conversion) | yes (identity) |
| `byte[] d = ctx.Data;` | yes | **no** (`CS0029`) |
| `ctx.Data == null` | yes | **no** (`CS0019` — illegal on a struct) |
| `ctx.Data[0]` | yes | **no** (`CS0021`) |

Measured with the real compiler, 2026-08-20.

So every vendored quickstart contract — all written in the `ReadOnlyMemory` style — compiles under
**either** typing and is therefore **not evidence for either**. That is exactly the trap the
2026-08-11 stub revision fell into: it "corrected" the stub to `ReadOnlyMemory<byte>` on the strength
of contracts that would have compiled regardless.

Meanwhile two contracts that **only** compile against a reference type are ORK-proven:
`music-license/forseti/OriginAttestation.cs` (its `contractId` matches its signed policy byte for
byte, and it has produced real threshold signatures) and keylessh's `sshPolicy`. That is positive
evidence for `byte[]` — reported independently as sashlings **L-10** and vialproof **L-02**.

### Write the dual-compatible form

```csharp
ReadOnlyMemory<byte> mem = ctx.Data;   // identity if ROM, implicit if byte[]
ReadOnlySpan<byte>  data = mem.Span;   // .Length and indexing work as before
if (data.Length == 0) { /* ... */ }    // NEVER `ctx.Data == null` — illegal on a struct
```

`check.sh` reports `NOT PORTABLE` with the offending lines when a contract compiles under one typing
only, rather than failing it outright — a contract in that state may well work on today's ORK, but
you are betting on an unverified assumption with an operator approval as the stake.

**Do not "simplify" `Stubs.cs` back to a single typing** without an ORK error message that settles
it. The `#if FORSETI_DATA_ROM` split is load-bearing.

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
| Sandbox scan (comment-aware) | `System.IO`, `System.Net`, `System.Threading`, `System.Reflection`, `System.Diagnostics`, `System.Console`, `DateTime.Now/UtcNow`, `Guid.NewGuid`, `Random` — **in code**; comment mentions are reported as `WARN`, not failures |
| Structure | missing `using Ork.Forseti.Sdk;`, nothing implementing `IAccessPolicy`, `PolicyDecision.Approve()` |
| `contractId` | prints the SHA-512 **uppercase** hex — the ORKs compare it case-sensitively |

### What it does NOT check

Be clear about the boundary; a pass here is not a pass overall.

- **IL vetting.** Blocked namespaces *compile fine* and fail at upload with
  `BadPolicy.ForbiddenCall`. `scan-sandbox.py` is a proxy for that pass, not the pass itself.

  It is **not** a grep. A grep matches comments, so a contract that merely documents the sandbox
  restrictions would fail its own pre-flight — and the obvious workaround (delete the comment)
  removes documentation instead of fixing anything. `scan-sandbox.py` strips comments with a
  C#-aware scanner that respects string literals, so `"http://x"` cannot hide a real call after it,
  and it reports comment mentions as `WARN` rather than `FAIL`. VERIFIED against all three cases:
  comment-only → pass with warnings; real violation → fail; string-literal trap → fail.
  (LEARNINGS-deploy-gate-001 L-07)
- **Contract logic.** Every stub returns a fixed value. A passing build says the contract compiles,
  never that it decides correctly.
- **Gas.** The 50,000 limit is a runtime property.
- **Anything outside the contract file** — the policy's `modelId`, the three-level contract
  transport, whether `contractId` matches what you submit, vuid-vs-subject. Those are in the
  [pre-flight checklist](../../canon/custom-contracts.md#pre-flight-checklist-all-client-side-no-network).

## Stub fidelity — self-tested, not asserted

`Stubs.cs` is derived from **two working, deployed contracts** vendored in the pack, not from prose:

| Reference | Source |
|---|---|
| `reference/QuickstartContract.cs` | `sources/example-app-forseti-crypto-quickstart/.../forsetiContract.ts` |
| `reference/ColaContract.cs` | `sources/example-app-tidecloak-test-cases/.../forsetiDecryptionContract.ts` |

```bash
./check.sh --self-test     # compiles both references + asserts the must-fail fixtures still fail
```

The failure mode that matters: **a stub more permissive than the real SDK yields a false PASS** — the
contract compiles here and fails on the ORK after an operator approval has been spent. The inverse (a
stub narrower than reality) yields a false FAIL, which is annoying but safe.

**Positive fixtures alone cannot detect over-permissiveness**, and this is worth internalising:
`byte[]` is *implicitly convertible* to `ReadOnlyMemory<byte>`, so when `ctx.Data` was wrongly typed
`byte[]`, **both reference contracts still compiled**. Nor does a single must-fail file with several
errors help — it keeps failing whichever protection you lose, so it reports nothing.

So `reference/mustfail/` holds **one discriminator per file**, each asserted to fail:

| Fixture | Catches a stub that wrongly allows |
|---|---|
| `data-is-not-enumerable.cs` | `foreach` over `ctx.Data` (the `DataItem` misconception) |
| `data-has-no-indexer.cs` | `ctx.Data[0]` — i.e. `ctx.Data` typed as `byte[]` |
| `executor-has-no-data.cs` | `ctx.Data` on `ExecutorContext` |
| `decision-has-no-isallowed.cs` | inspecting a `Decision` chain |
| `policydecision-has-no-isallowed.cs` | inspecting a `PolicyDecision` |
| `no-policydecision-approve.cs` | `PolicyDecision.Approve()` |

Verified: reverting `ctx.Data` to `byte[]`, adding `IsAllowed`, or adding `Data` to `ExecutorContext`
each make the self-test fail with the specific fixture named.

### A prior revision of these stubs was wrong

It typed `ctx.Data` as `byte[]` and gave `PolicyDecision` a public `IsAllowed`. Both were invented.
A `byte[]` stub is **worse than no stub**: contracts written against it (indexing, `.Length`,
`foreach`) compile locally and fail on the ORK. That is precisely the false PASS this harness exists
to prevent, and it is why the self-test now exists. Corrected 2026-08-11.

## Checking the pack's own examples

```bash
./check-docs.sh          # compiles every full contract example in canon/, playbooks/, reference-apps/
```

The pack's simplified examples are where invented shapes come from. This sweep found three broken
ones — a `ctx.Data == null` comparison (`ReadOnlyMemory<byte>` is a struct: `error CS0019`), a snippet
missing its using block, and an example using a `.And(...)` combinator and a 4-argument
`RequireAnyWithRole` that no reference supports. Run it after editing any contract example.

So: when the real SDK contradicts a stub, **fix the stub and re-run**, and prefer copying real
signatures over guessing. Treat `Stubs.cs` as a living mirror of the SDK, not a fixed artifact.

`Decision` is split across two types (`Decision` static entry + `DecisionBuilder` instance methods)
because C# forbids same-signature static and instance methods on one type, and contracts chain
`Decision.RequireX(...).RequireY(...)`. **Keep both surfaces identical** — a method on one and not
the other fails depending on where in the chain it appears.

## Verifying the harness itself

```bash
./check.sh --self-test                    # exit 0 — stubs match the reference SDK surface
./check.sh examples/PassingContract.cs    # exit 0
./check.sh examples/FailingContract.cs    # exit 1 — three shape errors
./check-docs.sh                           # exit 0 — every pack example compiles
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
