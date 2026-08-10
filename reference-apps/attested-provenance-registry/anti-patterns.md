# Anti-Patterns — Attested Provenance Registry

Scenario-specific mistakes. Each defeats a security property, overstates a guarantee, or costs an
enclave operator approval to discover.

## AP-AP01: Binding the contract's identity check to the OIDC `sub`

A doken's payload holds `UserKey`, `Vuid`, `UserHomeOrk`, `Exp`, `Aud` and role claims. **There is no
`sub`.** `DokenDto.UserId` returns `Payload.Vuid`.

So a contract comparing the envelope's identity against an OIDC subject compares two unrelated
identifiers and **denies every attestation** — discovered only after an operator approval. Carry the
vuid at a fixed offset for the network, and the subject in the JSON for display, and label which is
which. See AP-66.

## AP-AP02: Leaving the signer's identity only inside the JSON

The sandbox has no JSON parser (reflection blocked, 50,000 gas), so an identity that lives only in
the JSON payload is **invisible to the contract**. The ORKs can then prove that *a holder of the
signing role* asked for a signature, but not **which** one — the creator field is the app's own
assertion, and a compromised backend can put anyone's name on a claim while the signature still
verifies.

Move it to a fixed offset. It becomes a byte comparison costing a handful of gas, and authorship
moves from an app assertion to a network-enforced fact.

## AP-AP03: Relying on request expiry to prevent backdating

`setCustomExpiry(n)` is real — ORKs validate it against their own clock — but it is **one-sided**. It
stops a stale request being replayed. It does **not** stop a client declaring an old creation time.

Using it alone *looks* like freshness enforcement and is not. The property comes from a **symmetric**
skew check on the attestation's own timestamp inside the contract. Use both; do not confuse them.

## AP-AP04: Calling `DateTime.UtcNow` in the contract

IL vetting runs with `BlockNonDeterminism = true` and rejects direct `DateTime.Now`/`UtcNow` and
`Guid.NewGuid` call sites. The contract compiles and then fails vetting with
`BadPolicy.ForbiddenCall`.

Read time via `Cryptide.Tools.Utils.GetEpochSeconds()` — a pre-compiled method in a separate
assembly, so calling it passes vetting.

## AP-AP05: Describing the timestamp as RFC 3161 or "trusted timestamping"

It is not. No authority signs a time token, no signed time value is returned, and there is **no
NTP-consensus, roughtime, or clock-agreement protocol** between ORKs — each reads its own system
clock. The attested time is the **client's proposed** timestamp that the network refused to sign
unless fresh.

The defensible claim is *"this attestation existed by approximately time T"*, and the strength rests
on **operator independence**, not on a proven distributed clock. Overstating this is the easiest way
to turn a real property into a false one. Consider enforcing the wording with a test rather than
editorial discipline.

## AP-AP06: Reading `ctx.Data` in `ValidateExecutor`

`ValidateData` sees the bytes; `ValidateExecutor` sees the doken; **neither sees both**. Writing
`ctx.Data` in `ValidateExecutor` compiles fine locally in an editor and fails on the ORK:

```
VmHost.CompileFailed: (210,41): error CS1061: 'ExecutorContext' does not contain
a definition for 'Data'
```

Capture in `ValidateData`, compare in `ValidateExecutor`. And compile locally first (AP-67) — this
error otherwise costs an approval.

## AP-AP07: Not failing closed when the capture never ran

The capture-then-compare pattern has a hole if you ignore it: if `ValidateData` did not run, or ran
and did not set the field, the executor check has nothing to compare against.

```csharp
if (_envelopeVuid == null) return PolicyDecision.Deny("identity check did not run");
```

"The identity check did not run" can only mean **refuse**. A null-tolerant comparison silently
converts the strongest check in the contract into no check at all.

## AP-AP08: Letting the header and the JSON disagree

The binary header deliberately duplicates values that also appear in the JSON. The network validates
the **header** timestamp; a human reads the **JSON**. If the two may diverge, a payload can be signed
under a fresh header timestamp while displaying a backdated one.

Cross-check them on every decode and **reject any divergence** — on build and on verify. This
redundancy is load-bearing, not defensive noise.

## AP-AP09: An issuer-hosted `/verify` endpoint as the third-party story

An endpoint where the issuer checks its own attestation and reports the answer is **worthless to a
third party**: anyone able to forge the attestation can forge the verdict. Verification that routes
through the issuer inherits the issuer's trustworthiness — exactly what a sceptic is trying not to
depend on.

Publish the **evidence**: a self-contained certificate, downloadable and CORS-open, plus a verifier
that runs entirely on the recipient's machine with no dependency on your codebase. See AP-68.

## AP-AP10: Reporting "verified" with checks skipped

Verification is six checks and a signature is only the fourth. Check 1 — *the file hashes to the
value in the certificate* — is **skipped by default**, because a verifier handed only a certificate
has verified a claim about a number. Check 6 — *the key belongs to this person* — **cannot be done by
any software**; it needs a fresh challenge signed while you watch.

Report `SKIPPED` distinctly from `PASS`, and name what could not be run. A bare "verified" is a claim
you did not test.

## AP-AP11: Human-readable owner details outside the signature, uncross-checked

Adding readable owner fields to the certificate **wrapper** puts them outside the signed bytes, where
anyone can edit them. That is only safe if **every** verifier refuses a certificate whose readable
owner disagrees with the signed payload. Otherwise the convenience becomes the attack: the signature
check passes and the displayed owner is a forgery.

## AP-AP12: Pointing a verifier at the OIDC JWKS for the VVK

`/realms/{realm}/protocol/openid-connect/certs` serves Keycloak's **RSA** token-signing keys. The
realm VVK is **Ed25519** and is not there. The request returns **HTTP 200 with a valid key set
containing the wrong key**, so the failure presents as a broken certificate rather than a wrong URL —
the most confusing failure available here.

Serve `jwk.keys` from the adapter on your own public route, and say in the response that the copy
comes from the issuer (GAP-071).

## AP-AP13: Verifying only on write

Verifying at signing time and trusting the database afterwards leaves the signature valid over the
**original** bytes while the rows being rendered have changed. An edited creator column then sits
next to a green tick.

Re-verify on read, and include the third check: **the signed claim still matches the rows being
displayed**. Prove it with a tamper test that mutates the DB several ways and asserts a mismatch each
time.

## AP-AP14: Omitting the `vuid` protocol mapper

The contract binds authorship to the vuid, and the browser must read the claim to build the envelope.
Without the mapper the claim is absent, the envelope cannot be built, and the fail-closed guard
refuses every attestation.

The refusal is correct and completely opaque unless you know the cause. Declare the mapper in
`realm.json` and assert a non-empty `vuid` in a real token during bootstrap.

## AP-AP15: Rendering a confirmation screen that cannot show the identity

The screen whose job is confirming *who* is making a claim must not display "—" for the signer and
still offer the action. Read claims via `getValueFromToken(key)` — there is no `tokenParsed` on the
TideCloak context — and **fail closed**: no vuid, no action.

```tsx
const vuid = getValueFromToken('vuid');
if (!vuid) return <Error>Cannot confirm your identity — refusing to attest.</Error>;
```

`?? '—'` on an identity field converts a wrong API call into a plausible-looking screen with no error
anywhere. See AP-69.

## AP-AP16: Building the envelope before the user confirms

The timestamp must be fresh at the instant of signing. Building the envelope when the review screen
opens lets a slow review push the timestamp outside the window the network enforces — and the user
sees a skew denial for a claim they made correctly.

Build on confirm, not on render.

## AP-AP17: Overstating what a lineage or derivation claim establishes

When a user attests that B derives from A, Tide establishes that **that user made that claim at that
time**. It does not establish that the derivation occurred. Say "claimed derivation", never
"derived from".

Likewise, two identities attesting the same content hash is a legitimate state, not an error. Keep
both attestations intact and visible, and make **no** ownership determination — a provenance registry
is not an automated court.

## AP-AP18: Hardcoding the skew window as a `const` in the contract

Changing a constant changes the source, which changes the SHA-512 `contractId`, which **invalidates
the deployed policy** and costs a fresh enclave approval.

Expose it as `[PolicyParam(Default = 10, Min = 1, Max = 60)]` so it is tunable per deployment without
touching the contract hash.

## AP-AP19: Editing the contract without redeploying the policy

`contractId` is the SHA-512 of the exact source, so **any** edit — even a comment — invalidates the
deployed policy:

```
Policy refers to wrong contract. Expected 'CA0548...' but policy has '18013C...'
```

Compare the deployed policy's `contractId` against a fresh hash of the contract file at boot or in
CI. The same check catches the nastier reverse case: a contract edited *after* deployment, where the
policy still verifies but no longer describes the code the ORKs run.

## AP-AP20: Assuming a bulk import or background job can attest

ORK signing is browser-and-JS-SDK only — no Go/REST path (GAP-063), no device-code or service-account
flow (GAP-064). Attestation requires an **interactive authenticated session**.

This is a product constraint, not an implementation gap to route around. A bulk importer still needs
the creator present. Surface it in the design conversation early rather than discovering it when the
importer is written.

## AP-AP21: Seeding fake attestations

A seeded attestation needs a real threshold signature. Inventing one plants a permanently invalid
record that verification will correctly flag, and it trains everyone to ignore verification failures.

Seed the surrounding catalogue; leave attestations to real signing runs.

## AP-AP22: Copying a refuted workaround out of a reference implementation

The reference app retains a **disabled** `EMIT_V2_LAYOUT` subclass that emits the V2 policy layout.
That theory was **refuted**: the ORKs answered `Could not find specified policy version: 2` — they
are V3-only, and the `ReadOnlyCollection` text in their earlier model-lookup error was an ORK-side
message-formatting artifact.

It is kept, disabled and annotated, so the dead end is recognisable rather than re-derived. **Do not
copy it into a new app.** The general lesson: an error quoting a .NET/JVM **type name** where a value
belongs is not reliable evidence of a wire-format mismatch.
