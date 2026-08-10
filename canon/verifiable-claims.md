# Verifiable Claims — Canon

How to issue a signed claim a third party can actually verify, and how to verify one you receive.

Applies to **any** Tide app that hands someone a signed assertion — provenance certificates,
attestations, licences, audit receipts, signed approvals. Nothing here is domain-specific.

Status: VERIFIED against a real certificate walked through end to end
(LEARNINGS-music-license-001 L-15, L-18).

---

## The Core Rule: Publish Evidence, Not a Verdict

The instinct — and the shape of most `/verify` endpoints — is to treat verification as a single
boolean served by the issuer. That is not verification.

**An issuer-hosted `/verify` endpoint returning VALID/INVALID is worthless to a third party.**
Anyone able to forge the attestation can forge the verdict. Verification that routes through the
issuer inherits the issuer's trustworthiness, which is precisely what a sceptical verifier is
trying not to depend on.

Publish the **evidence** instead:

- The certificate is a **self-contained** JSON object — everything needed to check it travels with it.
- Serve it downloadable, CORS-open, `content-disposition: attachment`.
- Ship a verifier that runs entirely in the recipient's browser or on their machine.
- **Never serve the verifying key beside the signature.** A key fetched from the same origin as the
  signature proves nothing.
- The verifier reports **which checks it could not run**, never a bare "verified".

AP-68.

---

## The Six Checks

Verification is six distinct checks, not one. **Five can pass while the claim is still worthless.**

| # | Check | Fails when |
|---|---|---|
| 1 | the **FILE** hashes to the value in the certificate | someone attached a certificate to different content |
| 2 | the binary header agrees with the signed JSON | the envelope is malformed |
| 3 | there is a date, and it is **not in the future** | no timestamp, or a fabricated one |
| 4 | the signature verifies under the realm's **VVK** | the bytes were altered after signing |
| 5 | the certificate names an **owner public key** | nothing exists for an owner to prove |
| 5b | the **READABLE** owner block matches the **signed** one | an unsigned label was edited |
| 6 | that key belongs to the **person** claiming it | — see below; no software can do this |

### The two that get missed

**Check 1 — the file.** Without the actual content, you have verified a claim *about a number*. A
certificate and the thing it describes are connected only by someone hashing the thing and
comparing. A verifier handed only a certificate must say **"file not supplied — check 1 skipped"**,
not "verified".

**Check 6 — the human.** The owner in a certificate is **text**. A signature binds bytes to a
**key**, never to a person. As the Tide team put it: *"sasha is a real person standing in front of
you; the owner in the cert is just text — you ask Sasha to sign something."*

The only way to close check 6 is a **fresh challenge the claimant could not have prepared for,
signed while you watch**. No endpoint, library, or certificate field substitutes for it. Any
verifier that implies otherwise is lying about what it checked.

### Check 5b is a real attack, not a formality

Adding human-readable `owner` details to the certificate **wrapper** puts them **outside** the
signature, where anyone can edit them. That is only safe if **every** verifier refuses a certificate
whose readable owner disagrees with the signed payload. Otherwise the convenience *is* the attack.

VERIFIED by forging the readable label on a certificate with a valid signature: **check 4 PASSES,
check 5b FAILS, exit 1.** Unsigned wrapper fields are a spoofing surface unless cross-checked.

---

## Where the Verifying Key Lives (and the Trap)

Third-party verification needs the Ed25519 realm **VVK**. It is not where anyone would look first.

| Source | What it holds | Who can read it |
|---|---|---|
| `/realms/{realm}/protocol/openid-connect/certs` | Keycloak's **RSA** token-signing keys | anyone |
| `/admin/realms/{realm}/vendorResources/get-tide-jwk` | the **Ed25519 VVK** | master admin only |
| `data/tidecloak.json` → `jwk.keys` | the **Ed25519 VVK** | whoever holds the adapter |

⚠️ **Pointing a verifier at the OIDC JWKS is the worst of the three.** It returns **HTTP 200 with a
valid key set containing the wrong key**, so the failure presents as a broken certificate rather
than a wrong URL. This is the most confusing failure available in this area — a successful fetch, a
well-formed response, and a signature that will never verify.

**Consequence**: an app issuing verifiable certificates must serve **its own copy** of the realm
VVK, exported from the adapter. That copy comes from the issuer — the party the verifier is trying
not to trust — which is weaker than it should be.

It is not worthless, and the mitigation is worth stating to verifiers explicitly: the **same key
signs every certificate the realm issues**, so it can be **pinned on first use** and compared
against any other holder of the adapter. Divergence is detectable across certificates and across
parties.

**Correct approach today**: serve `jwk.keys` from the adapter on a public, CORS-open route, and say
in the response where the weakness is.

**Real fix**: TideCloak should publish the realm VVK unauthenticated, the way OIDC publishes its
JWKS. GAP-071.

---

## Verifier Output Contract

A verifier's report must distinguish three states per check, and never collapse them:

| State | Meaning |
|---|---|
| **PASS** | the check ran and succeeded |
| **FAIL** | the check ran and failed → reject the claim |
| **SKIPPED** | the check could not run (e.g. no file supplied) → **not** a pass |

Any check that cannot run must be named in the output. A verifier that prints "verified" while
having skipped check 1 and being structurally incapable of check 6 is making a claim it did not
test.

Recommended shape:

```
Certificate: origin-cert-4f2a.json
  [PASS]    2. header agrees with signed JSON
  [PASS]    3. date present, not in future (2026-08-07T04:12:09Z)
  [PASS]    4. signature verifies under realm VVK (pinned, first seen 2026-08-01)
  [PASS]    5. owner public key present
  [PASS]   5b. readable owner block matches signed payload
  [SKIP]    1. file not supplied — pass the file to check content binding
  [MANUAL]  6. key-to-person binding — challenge the claimant to sign a fresh nonce

RESULT: signature and structure are sound. Content binding UNVERIFIED. Identity UNVERIFIED.
```

---

## Anti-Patterns

- **Issuer-hosted `/verify` returning a verdict** — forgeable by whoever can forge the claim (AP-68)
- **Reporting "verified" with checks skipped** — check 1 is skipped by default; say so
- **Serving the verifying key from the same origin as the signature** — proves nothing
- **Human-readable fields outside the signature, uncross-checked** — check 5b, a live spoofing surface
- **Pointing a verifier at the OIDC JWKS for the VVK** — 200 + valid key set + wrong key (GAP-071)
- **Implying software can establish check 6** — it cannot; it needs a live challenge

---

## Common Failure Modes

| Symptom | Cause |
|---|---|
| Signature never verifies, key set fetched fine | verifier pointed at OIDC JWKS (RSA), not the VVK (Ed25519) |
| "Header agrees with payload" fails on a valid certificate | vuid and subject silently swapped (AP-66) |
| Certificate verifies but describes different content | check 1 skipped — file never supplied |
| Owner name looks right, signature valid, claim still false | check 5b not implemented — readable block was edited |

---

## Related

- [custom-contracts.md](custom-contracts.md) — identity in contracts: the vuid is the only field the network can enforce (AP-66)
- [anti-patterns.md](anti-patterns.md) — AP-68 (verdict vs evidence), AP-66 (vuid vs subject)
- [troubleshooting.md](troubleshooting.md#error-text-lookup) — error-text lookup
- GAP-071 — no unauthenticated endpoint publishes the realm VVK
