# Reference contracts — the fidelity check for `Stubs.cs`

These two files are extracted verbatim from **working, deployed** Forseti contracts vendored in the
pack:

| File | Source |
|---|---|
| `QuickstartContract.cs` | `sources/example-app-forseti-crypto-quickstart/template-ts-app/lib/forsetiContract.ts` |
| `ColaContract.cs` | `sources/example-app-tidecloak-test-cases/test-app/src/lib/forsetiDecryptionContract.ts` |

`./check.sh --self-test` compiles both against `Stubs.cs`.

**Why this exists**: the harness's cardinal failure is a stub that is *more permissive than the real
SDK*, because that produces a false PASS — the contract compiles locally and fails on the ORK after
an operator approval has been spent. Prose cannot protect against that; a real contract can.

If `--self-test` fails, **the stubs are wrong, not these files.** Do not edit them to make the build
pass.

Between them they exercise: `ReadOnlyMemory<byte> ctx.Data` with `GetValue`/`TryGetValue`, the
encrypt-vs-decrypt tag offsets (2 vs 3), `ctx.Policy.ExecutionType`/`ApprovalType`, state threaded
through instance fields across all three validators, `DokenDto.WrapAll` + the 1-arg realm-role
`HasRole`, the `Decision.RequireX(...)` chain returning a decision directly, `Utils.GetEpochSeconds()`,
and a contract that **omits `ValidateApprovers` entirely** (proving it is not a required member).
