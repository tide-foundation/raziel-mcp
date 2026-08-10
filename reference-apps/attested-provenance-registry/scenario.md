# Attested Provenance Registry

## What this is

An application that issues **timestamped, third-party-verifiable attestations about content**.

A user submits content, the app hashes and canonicalizes it in the browser, and the ORK network
threshold-signs a claim of the form:

> At approximately time T, authenticated Tide identity X made claim Y about content H.

The output is a **portable certificate** the holder can hand to anyone, and that recipient
verifies it **without contacting the issuer**. That last property is what separates this scenario
from ordinary signing: the artifact outlives the signing session and is checked by someone who has
no reason to trust the app.

Two security properties do the work, and **both live in the Forseti contract, not the app**:

| Property | Enforced how | Why the app cannot do it |
|---|---|---|
| **Authorship** — the named signer really signed | The signer's **vuid** sits at a fixed offset in the envelope; the contract byte-compares it to `DokenDto.UserId` | Without it, the network only proves *somebody holding the signing role* asked. The creator field would be the app's own assertion, and a compromised backend could put anyone's name on a claim while the signature still verified. |
| **Freshness** — the claim cannot be backdated | The contract compares the client timestamp against **each ORK's own clock**, symmetrically | The app's clock is never consulted. To move an attested time an attacker must fool a majority of independently operated ORK clocks at once. |

## When to use this scenario

Use when the user describes:
- proving who created something, and when
- a provenance, notarisation, or content-authenticity registry
- certificates of authenticity, verifiable claims, or signed attestations
- a rights/licensing registry where claims must be independently checkable
- derivative or chain-of-custody lineage where each link is an attested claim
- "prove I made this first", "tamper-evident record", "cannot be backdated"

Do NOT use when:
- the signature is **consumed immediately by a protocol** — SSH login, a transaction, a git
  commit — with no durable artifact for a third party. Use `policy-governed-signing`, or
  `git-pr-signing-service` for the git/GitHub domain.
- the app only needs authentication (no signing)
- the app needs encryption/decryption (use `organisation-password-manager` or self-encryption)
- the app needs a governance approval UI (use `iga-admin-governance`)

### The discriminating question

**Does the app hand someone an artifact that a third party verifies later, without contacting the
issuer?** Yes → this scenario. No → `policy-governed-signing`.

## Core Tide capabilities used

1. **TideCloak OIDC authentication** — zero-knowledge login via threshold PRISM
2. **DPoP token binding** — `dpop.bound.access.tokens` on the client, `useDPoP: { mode: 'strict', alg: 'ES256' }` in the provider
3. **Doken** — carries the vuid and role claims the contract checks
4. **Custom Forseti contract** — the enforcement point; built-in contracts **cannot** do this scenario
5. **`Policy:1` auth flow** with a `BasicCustom<...>` model id
6. **Threshold Ed25519 signing** — 64-byte signature, key never materializes
7. **IGA** — role and policy changes are governed change requests
8. **Realm VVK** — the public verifying key third parties need
9. **`vuid` protocol mapper** — REQUIRED; the contract binds identity to the vuid, not the OIDC `sub`

## The identity split — the single most important design point

A doken's payload holds `UserKey`, `Vuid`, `UserHomeOrk`, `Exp`, `Aud` and role claims.
**There is no OIDC `sub` in a doken.** `DokenDto.UserId` returns `Payload.Vuid`.

So a contract comparing against `sub` compares two unrelated identifiers and **denies every
attestation**. Carry both, and label which is enforced where:

| Field | Enforced by | Purpose |
|---|---|---|
| `creator.vuid` | the **ORK network**, byte-compared against the doken | authorship |
| `creator.subject` | your own server, against the verified access token | display, database linkage |

The vuid is duplicated into the binary header at a fixed offset; the subject stays in the JSON.
Verification must reject any divergence between the two, or the displayed author and the enforced
author could differ. See AP-66.

## Why the envelope is binary, not JSON

A Forseti contract receives `ctx.Data` as a raw `byte[]` and is responsible for deserializing it.
The sandbox blocks reflection and the gas budget is 50,000, so **a JSON parser is not available**.
Hand-parsing JSON in C# to find a timestamp would be fragile and expensive.

So every field the contract must enforce sits at a **fixed offset** in a fixed-size header, and the
human-readable JSON follows:

```
offset  size  field
0       8     magic (ASCII, e.g. "ORIGINA2")
8       8     clientTimestamp, epoch SECONDS, big-endian uint64
16      1     claimType code
17      1     contentType code
18      32    contentHash, raw SHA-256 digest
50      2     payloadLength, big-endian uint16
52      1     signerVuidLength, uint8
53      S     signerVuid, UTF-8        <- the ORKs compare THIS to the doken
53+S    N     canonical JSON payload, UTF-8
```

**The header deliberately duplicates values that also appear in the JSON, and that redundancy is
load-bearing.** The network validates the *header* timestamp; a human reads the *JSON*. If the two
were allowed to disagree, a payload could be signed under a fresh header timestamp while displaying
a backdated one. Verification must cross-check them and reject divergence.

**Bump the magic when the layout changes.** Moving a field the contract reads is a breaking change
to the wire format; a version marker in the magic is what stops old and new envelopes being
confused.

## The context split, and why it forces a fail-closed guard

To check "the identity in the payload is the identity signing", the contract needs the data **and**
the token. The SDK gives them to different methods:

```
ValidateData(DataContext ctx)          -> ctx.Data, ctx.DynamicData, ctx.RequestId   (no doken)
ValidateExecutor(ExecutorContext ctx)  -> ctx.Doken                                  (no data)
```

Neither sees both. So: capture the vuid in `ValidateData` (documented as running **always**) into an
instance field, compare in `ValidateExecutor`, and **DENY if the field was never set** — "the
identity check did not run" can only mean refuse.

Writing `ctx.Data` inside `ValidateExecutor` compiles fine in an editor and fails **on the ORK** as
`VmHost.CompileFailed`, after an operator approval has been spent. Compile locally first
(AP-67, [templates/forseti-compile-harness/](../../templates/forseti-compile-harness/)).

## Trusted time — what it is and is not

The contract reads the ORK's clock via `Cryptide.Tools.Utils.GetEpochSeconds()`. It **cannot** call
`DateTime.UtcNow` directly: IL vetting runs with `BlockNonDeterminism = true` and rejects it.
`Utils.GetEpochSeconds` is a pre-compiled method in a separate assembly, so calling it passes
vetting.

```csharp
long skew = Math.Abs(clientTimestamp - Utils.GetEpochSeconds());
if (skew > MaxClockSkewSeconds) return PolicyDecision.Deny(...);
```

**State the property honestly.** What it buys:

> A majority of independently operated ORKs each agreed, against their own clock, that this
> timestamp was within N seconds when the signature was produced.

What it is **not**:
- **not RFC 3161 timestamping** — no authority signs a time token, and no signed time value is returned
- **no NTP-consensus, roughtime, or clock-agreement protocol** between ORKs — each reads its own clock
- the attested time is the **client's proposed** timestamp the network refused to sign unless fresh

So display *"attested at approximately T"*, and claim *"this attestation existed by this time"*.

**Two freshness mechanisms exist; use both.** Native request expiry (`setCustomExpiry(n)`, validated
by ORKs against their own clock) is **one-sided** — it stops a stale request being replayed but does
not stop a client declaring an old creation time. Relying on it alone *looks* like backdating
protection and is not. The contract's symmetric check is what actually delivers the property.

## Verification is six checks, not one

Five can pass while the claim is still worthless. Full model:
[canon/verifiable-claims.md](../../canon/verifiable-claims.md).

| # | Check | Note |
|---|---|---|
| 1 | the **FILE** hashes to the value in the certificate | **skipped** unless someone supplies the file |
| 2 | the header agrees with the signed JSON | the load-bearing redundancy above |
| 3 | there is a date, and it is not in the future | |
| 4 | the signature verifies under the realm **VVK** | the only check most people implement |
| 5 | the certificate names an owner public key | |
| 5b | the **readable** owner block matches the **signed** one | unsigned wrapper fields are a spoofing surface |
| 6 | that key belongs to the person claiming it | **no software can do this** — needs a live challenge |

**Publish evidence, not a verdict.** An issuer-hosted `/verify` returning VALID/INVALID is worthless
to a third party: anyone able to forge the attestation can forge the verdict (AP-68). Ship a
standalone verifier with no dependency on the app's codebase, and have it report **SKIPPED**
separately from **PASS**.

## Getting the verifying key to a verifier

The realm VVK is **not** in the OIDC JWKS. Pointing a verifier there returns **HTTP 200 with a valid
key set containing the wrong key** — the most confusing failure available, because it looks like a
broken certificate rather than a wrong URL.

| Source | Holds | Readable by |
|---|---|---|
| `/realms/{realm}/protocol/openid-connect/certs` | Keycloak's **RSA** token keys | anyone |
| `/admin/realms/{realm}/vendorResources/get-tide-jwk` | the **Ed25519 VVK** | master admin only |
| `data/tidecloak.json` → `jwk.keys` | the **Ed25519 VVK** | whoever holds the adapter |

So the app must serve its own copy on a public, CORS-open route — which comes from the issuer, the
party a sceptical verifier is trying not to trust. **Say so in the response.** It still buys
something real: the same key signs every certificate the realm issues, so it can be pinned on first
use and compared against anyone else holding the adapter. GAP-071.

## Verify on read, not just on write

Re-verify every attestation when it is displayed, in three independent checks:

1. the envelope parses and its fixed header agrees with its JSON payload
2. the threshold signature verifies over those exact bytes against the realm VVK
3. **the signed claim still matches the database rows being rendered**

Check 3 is what makes database tampering visible. The signature stays valid over the original bytes,
so without it an edited `creator` column would sit next to a green tick. This check is cheap and it
is the difference between "we stored a signature" and "what you are reading is what was signed".

## What must exist before first user access

1. TideCloak running with a realm for the app
2. Realm licensed (`setUpTideRealm`) and IGA enabled (`toggle-iga`)
3. Admin user created, Tide account linked, `tide-realm-admin` assigned
4. Initial client/user/role change requests approved and committed
5. Adapter JSON exported with `jwk`, `vendorId`, `homeOrkUrl`, `client-origin-auth-*`
6. **The `vuid` protocol mapper present on the client** — without it, no attestation can be built
7. Attest role in the realm default-roles composite; admin role created and granted separately
8. Contract uploaded and the **custom policy deployed and signed** — one browser enclave approval
9. App server running JWT + DPoP verification on protected endpoints

Users cannot attest until step 8 completes. Make that state visible rather than a confusing failure.

## Runtime user flow

1. User signs in via TideCloak OIDC; app server verifies JWT + DPoP
2. Browser hashes and canonicalizes the content — **the creator's own browser computes the bytes shown**
3. Review screen displays the exact content hash, claim, and the **vuid the network will bind**
4. **Only on confirm** is the envelope built, so its timestamp is fresh at that instant
5. Browser fetches the signed policy, builds the request, submits to the ORK network
6. Every ORK runs the contract independently: envelope shape, type codes, hash shape, **skew**, role, **vuid == doken**
7. A majority agree → 64-byte Ed25519 threshold signature
8. Signed envelope goes to the server, which **verifies before storing** and binds `creator.subject` to the verified token
9. Certificate is downloadable; a third party verifies it offline

**Step 4 is load-bearing.** Building the envelope before the review would let a slow review push the
timestamp outside the window the network enforces.

## Why this is browser-only, and what that costs

ORK signing is available only through the JS SDK in a browser context — it needs the authenticated
session, the doken, the request enclave and PRISM state. There is **no** Go/Python/REST path
(GAP-063) and **no** device-code or service-account flow (GAP-064).

Consequences that shape the architecture:
- hashing and canonicalization run client-side
- the app server never signs and holds no signing key (I-01)
- the server verifies and stores; it cannot forge
- **attestation cannot run in a background job, a CLI, or a bulk importer.** Registration requires
  an interactive authenticated session. That is a real product constraint — surface it early.

## Default playbook sequence

1. `start-tidecloak-dev`
2. `bootstrap-realm-from-template`
3. `initialize-admin-and-link-account`
4. `add-auth-nextjs-fresh`
5. `protect-routes-nextjs`
6. `protect-api-nextjs`
7. `verify-jwt-server-side`
8. `add-rbac-nextjs`
9. **`deploy-forseti-policy`** — the custom contract and policy

## Key diagnostics

| Symptom | Likely cause |
|---|---|
| Every attestation denied, no obvious reason | Contract compares the OIDC `sub`; a doken has no `sub`. Compare the vuid (AP-66) |
| Attestation denied, contract's fail-closed message | `ValidateData` did not capture the identity — check it runs and the offset is right |
| `VmHost.CompileFailed: ... CS1061 'ExecutorContext' ... 'Data'` | Used `ctx.Data` in `ValidateExecutor`; the contexts are disjoint (AP-67) |
| `BadPolicy.ForbiddenCall` | Contract reached a blocked namespace — time must come from `Utils.GetEpochSeconds()` |
| `Not an <app> attestation envelope` | Draft is being wrapped, or wire format and contract have drifted. Pin them with a test |
| Denied on clock skew | Working as intended, or the device clock is wrong. Guard client-side for a clear message |
| `Model id '...' not found in registry` | `modelId` is not a built-in and not `BasicCustom<...>` (AP-65) |
| `Unknown contract type ''` | Contract transport missing the outer `"forseti"` level (AP-64) |
| `Policy refers to wrong contract` | Case → uppercase the SHA-512; entirely different → contract edited, redeploy |
| Signature never verifies, key set fetched fine | Verifier pointed at the OIDC JWKS, not the VVK (GAP-071) |
| Identity fields render blank/`—` but page works | Read a non-existent context property; use `getValueFromToken` and **fail closed** (AP-69) |
| Roles missing from token | IGA change request not committed, or token not refreshed (up to 120s) |

## Intentionally configurable

- **Claim and content type codes** — app-specific vocabularies. Never renumber; attestations reference them forever
- **Canonicalization** — how content becomes bytes. Exact-file-bytes, or a domain canonical form
- **`MaxClockSkewSeconds`** — a `[PolicyParam]` with `Default`/`Min`/`Max`, so it is tunable per deployment without changing the contract hash
- **Role names** — attest role and admin role; whether the attest role is a realm default
- **Approval type** — `IMPLICIT` (no popup) suits self-claims; `EXPLICIT` if a claim needs an operator
- **Quorum** — `ValidateApprovers` returning `Allow` is correct for a claim about one's own content. Joint-work or multi-rights-holder approval is a *separate contract with its own threshold*, not an edit to this one
- **Lineage semantics** — a derivation claim is a **claim**. Tide establishes that X claimed it at time T, never that the derivation occurred. Say "claimed derivation"
- **Dispute handling** — two identities attesting the same hash is a legitimate state. Keep both attestations intact and make no ownership determination

## Reference implementation

`~/music-license` — **Origin**, provenance and licensing for musical works. Next.js 16 + React 19,
Prisma/Postgres, 171 passing tests, `tsc --noEmit` clean (verified 2026-08-10).

Worth reading in this order:

| Path | Why |
|---|---|
| `forseti/OriginAttestation.cs` | The contract. Capture-then-compare, fail-closed guard, skew check, and an unusually honest header comment on what the timestamp property is not |
| `src/lib/attestation/wire.ts` | The binary envelope, with the header/JSON cross-check |
| `src/lib/tide/sign.ts` | Request construction, both freshness mechanisms, and ORK error translation into actionable messages |
| `src/lib/auth/protect.ts` | `withAuth`/`withRole` — verify, assert DPoP, *then* check roles |
| `scripts/verify-attestation.mjs` | Standalone six-check verifier, no app dependencies |
| `src/app/api/realm-key/route.ts` | Public VVK with the weakness stated in the response body |
| `docs/RUNTIME-VALIDATION.md` | An explicit verified-vs-assumed ledger |

### Patterns to reuse vs not

- **LIKELY_REUSABLE_PATTERN** — the binary envelope with a fixed-offset identity field; capture-then-compare with a fail-closed guard; symmetric skew check via `Utils.GetEpochSeconds()`; verify-on-read including the DB-match check; standalone verifier; VVK route that states its own weakness; a test pinning wire offsets to the contract's constants
- **PROJECT_SPECIFIC_PATTERN** — musical-work canonicalization, the work/performance/recording split, similarity fingerprinting, the licensing marketplace, and the specific claim/content type vocabularies
- **OBSERVED_PATTERN** — storing the signed policy as a file in `data/` beside `tidecloak.json` rather than in the database, so it survives a DB reset without a fresh enclave approval

### Honest status of the reference app

**This scenario is VERIFIED END TO END against a live ORK network**, which is unusual for a pack
scenario and worth stating precisely. Evidence inspected 2026-08-10 in the running deployment:

| Verified | Evidence |
|---|---|
| The custom policy deployed and was signed | `data/origin-attestation-policy.json` — 527 bytes decoding to `[dataToVerify(451), signature(64)]`; a real 64-byte Ed25519 threshold signature, stored 2026-08-07 |
| ORKs accept the **V3** policy layout | The signed policy carries `version` 3. GAP-070's withdrawal is confirmed, not merely argued |
| ORKs accept a `BasicCustom<...>` model id | The signed policy's `modelId` is `BasicCustom<OriginAttestation>:BasicCustom<1>` — **the practical answer to GAP-072** |
| Uppercase SHA-512 `contractId` is correct | `5768C487…` accepted; lowercase was rejected earlier with both values printed |
| The contract compiles and passes IL vetting on the ORK | Attestations signed under it, so `Utils.GetEpochSeconds()` from `Cryptide.Tools` genuinely passes `BlockNonDeterminism` vetting in production |
| The contract's checks **pass** for legitimate requests | 4 attestations in `OriginAttestation`, each with a 64-byte Ed25519 `AttestationSignature` — 3 `CREATOR_ATTESTATION` plus 1 `DERIVATIVE_ATTESTATION`, 2026-08-07 10:22–11:55. The skew check, the vuid-equals-doken check and the role check all passed on real ORKs |
| `ctx.Data` arrives as exactly the draft bytes | Otherwise the magic check would have denied with `Not an Origin attestation envelope`. This was `docs/RUNTIME-VALIDATION.md`'s top open question; the signatures answer it |
| Code quality | 171 tests pass, `tsc --noEmit` clean, DPoP relay asset is the known-good 9120-byte copy |

**Still NOT verified — and do not assume it from the above.** Successful signatures prove the checks
*admit* valid requests; they do **not** prove the checks *reject* invalid ones. The negative tests are
Phase 7 of [bootstrap-sequence.md](bootstrap-sequence.md) and remain unproven in-repo:

- that a stale/backdated timestamp is actually **denied**
- that a mismatched signer vuid is actually **refused**
- tamper detection (`npm run tamper-test` exists but needs a live run recorded)

A property that has never failed when it should is not known to work. This is the single most
important gap in an otherwise fully-validated scenario.

**Known deviation**: `src/app/studio/policy/page.tsx` retains a disabled `EMIT_V2_LAYOUT` subclass.
The V2 theory was **refuted** — the ORKs are V3-only (`Could not find specified policy version: 2`),
now doubly confirmed by the signed V3 policy above. It is kept, disabled and annotated, so the dead
end is recognisable rather than re-derived. Do not copy it into a new app.

## Related

- [canon/custom-contracts.md](../../canon/custom-contracts.md) — contract API, Policy field table, model registry, context split
- [canon/verifiable-claims.md](../../canon/verifiable-claims.md) — the six checks, the VVK trap
- [playbooks/deploy-forseti-policy.md](../../playbooks/deploy-forseti-policy.md) — the ordered deploy sequence
- [templates/forseti-compile-harness/](../../templates/forseti-compile-harness/) — compile the contract locally first
- `policy-governed-signing` — the general case; use it when no durable artifact is produced
