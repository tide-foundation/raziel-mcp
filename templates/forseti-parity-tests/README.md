# Forseti Contract Parity Tests

Assert that your app's code still says what your contract says — in ~200ms, with no ORK, no .NET
runtime, no enclave, and no operator approval.

## Why this exists

A custom-contract app has **two implementations of the same rules**:

- the **C#** that every ORK executes and that actually decides anything;
- the **app code** that tells a human what to expect.

Drift between them is **silent**, and the app's version is the one people believe. A UI that teaches
the wrong approval ladder is worse than no UI at all.

These tests read the **contract source text** and compare it to the app's declared values.
Regex-against-source is crude, and that is the point: it costs nothing and it runs in the same second
as your unit tests.

It **complements** [forseti-compile-harness](../forseti-compile-harness/):

| Harness | Parity tests |
|---|---|
| proves the contract **compiles** | proves the contract **still says what the app claims** |
| catches `CS####`, wrong context properties | catches drift, missing params, renumbered fields, stale deploys |

Run both. Neither replaces the other.

## Usage

```bash
cp -r templates/forseti-parity-tests tests/parity
$EDITOR tests/parity/parity.config.mjs        # describe your contract
node --test tests/parity/contract-parity.test.mjs
```

Zero dependencies — `node:test` + `node:assert`. If you run it from outside the repo root, set
`PARITY_ROOT=/path/to/repo`.

Everything is driven from `parity.config.mjs`; you should never need to edit the test file. Unset
options are **skipped**, not silently passed — but read what each one buys before skipping it.

## What it catches, and what that replaces

| Check | The failure it replaces |
|---|---|
| Entry shape: `using Ork.Forseti.Sdk;`, implements `IAccessPolicy`, no `PolicyDecision.Approve` | `BadPolicy.EntryTypeNotFound` at upload |
| Blocked-namespace scan | `BadPolicy.ForbiddenCall` at upload |
| `ctx.Data` absent from `ValidateExecutor`/`ValidateApprovers` bodies | `CS1061` from `VmHost.CompileFailed` — **after an approval is spent** |
| A `Deny` guarded by the capture flag | A contract that validates nothing when `ValidateData` did not run |
| Identity compared is the **vuid**; no `subject` anywhere | AP-66 — a doken has no `sub`, so the contract denies everything |
| Every `[PolicyParam]` declared ⇔ every param supplied | A required param the policy never sends — fails at request time, **after an approval** |
| `modelId` is a built-in or `BasicCustom<..>:BasicCustom<..>`, and is not `AttestationUnit:1` | `Model id '...' not found in registry`, or the wrong card in front of an approver (AP-65) |
| Wire field indices + field count agree with the encoder | The contract validates bytes the encoder never wrote there — the signature covers bytes nobody checked |
| Ladder params strictly increasing | A misordered ladder makes the contract deny **every** request |
| Deployed `contractId` == fresh SHA-512 of the source | "Signing mysteriously broke" instead of "you edited the contract and did not redeploy" (AP-19) |
| Your own `sourceAssertions` | Someone rewires a threshold and the UI keeps teaching the old rules |

## The blocked-namespace scan strips comments — correctly

A doc comment saying *"the contract cannot call `DateTime.UtcNow`"* is **reported as a note and does
not fail the check.** A contract that documents its own restrictions is correct, and failing it would
only teach people to ignore the checker.

The obvious shortcut — strip everything after `//` — would be **unsafe**: the `//` inside a string
literal such as `"http://example.com"` starts a fake comment and swallows the rest of the line, which
can hide a **real** call after it. A false positive costs one reworded comment; a false negative costs
an operator approval and a `BadPolicy.ForbiddenCall` at upload.

So the scanner tracks string state — `"..."` with escapes, verbatim `@"..."` where `""` is an escaped
quote, and `'...'` char literals — and treats `//` and `/* */` as comments **only outside a string**.
With a correct stripper you get both: comment mentions are tolerated, and nothing real is hidden.

> An earlier revision of this template failed on comment mentions and argued that stripping was
> inherently unsafe. That identified a real hazard and drew the wrong conclusion — the hazard is
> specific to a *naive* stripper. Corrected 2026-08-11 (LEARNINGS-deploy-gate-001 L-07).

## Verified behaviour

Run against a real deployed contract (`~/music-license`, `OriginAttestation.cs`, whose policy is
threshold-signed on mainnet):

- **15 pass, 0 fail, 3 skipped** (unconfigured wire/ladder options)
- the sandbox scan reported 3 comment mentions as notes and correctly found **no code violations**
- a contract with `var u = "http://x"; var t = DateTime.UtcNow;` on one line still **fails** — the
  string literal does not hide the real call
- the deployed-policy freshness check **passed** against the real signed policy, then **failed and
  printed both hashes** once the contract's comments were reworded — because editing a contract at
  all, even a comment, changes its SHA-512 and invalidates the deployed policy

That last pair is the thesis in one run: the scan does not cry wolf, and a contract's identity is its
exact bytes.

## Related

- [forseti-compile-harness](../forseti-compile-harness/) — proves the contract compiles
- [playbooks/deploy-forseti-policy.md](../../playbooks/deploy-forseti-policy.md) — Step 2 and the pre-flight checklist
- [canon/custom-contracts.md](../../canon/custom-contracts.md) — contract API, context split, `[PolicyParam]` types
- AP-19, AP-65, AP-66, AP-67
