# How Tide Neutralizes These Failures

The mechanism companion to `canon/breach-precedents.md`. That file says what breaks and what it cost. This one says **what Tide does about it, how the mechanism works, and why that removes the failure rather than guarding it** — plus, in every case, what it does not fix.

Read with `tide_canon`. Used by `tide-red-team` (the `Tide neutralization` / `Tide does NOT fix` fields of the finding card), `tide-security-analyst`, and `grc-review`.

---

## The one idea

Traditional security asks *how do we protect the key?* Tide asks *why does a key-shaped object exist to be stolen?*

> "the root cause of catastrophic breach severity is not insufficient protection of authority, but the architectural decision to represent authority as a discrete object at all" — `tier1-article1` **VERIFIED**

An **authority artifact** is *"any digital object that holds unilateral power to verify attestations, sign assertions of trust, or grant access"* (`tier1-article1`). Article 1 names four breach patterns built on them, and every one has precedents in the library:

| Article 1 breach pattern | The artifact | Precedents |
|---|---|---|
| Administrative Authority Capture | PAM vault, admin console, support tool | `BP-ADMIN-01`, `BP-ADMIN-02`, `BP-KEY-12` |
| Signing Key Theft | The private key signing tokens | `BP-KEY-06`, `BP-KEY-03` |
| Credential Store Exfiltration | The password-hash database | `BP-CRED-01`…`BP-CRED-05`, `BP-KEY-14` |
| Session/Bearer Token Hijack | A token carrying full authority | `BP-KEY-05`, `BP-KEY-07`, `BP-SESS-01` |

Article 1's own examples for these are Storm-0558, SolarWinds, LastPass, LinkedIn, Okta/LAPSUS$, Uber and CircleCI — the same incidents the precedent library holds. The requirement it derives: *"the authority artifact never exists as a complete, assemblable object in any single location."* **VERIFIED**

## What makes this different from "we shard the key"

Sharding is not the claim. Article 2 is explicit that MPC is not novel and that what ordinary sharding fails to dissolve is *authority over the key*:

> "No key ever exists in complete form (storage). No single node can exercise its effect (use). No single administrator can alter its rules (governance). No centralized engine decides when it acts (policy logic)." — `tier1-article2` **VERIFIED**

**All four surfaces must be distributed, or the guarantee is theatre.** This is the honest test to apply to Tide and to anything else. `BP-KEYLOSS-05` (Ronin) distributed storage and left governance concentrated: 5-of-9 on paper, 1-of-1 in practice. `BP-KEYLOSS-04` (Multichain) distributed the shards and left operational control on one person's laptop.

The six mechanism classes below map onto those four surfaces.

---

## Evidence tags

- **VERIFIED** — stated directly in a source, quoted.
- **INFERRED** — strongly implied but not stated. Several load-bearing red-team claims are INFERRED; they are marked, and the marking matters.
- **ASSUMED** — pack operator guidance, not a Tide claim.
- **DOCUMENTED_GAP_IMPLEMENTATION_COVERED** — absent from the whitepaper but established by the exemplar implementations and recorded in `canon/invariants.md`.

Threshold values below use the mainnet configuration (n=20, t=14). **Per I-02, thresholds are deployment-configurable — test is 3-of-5. Never hardcode 14/20 in a report; read the deployment's actual configuration.**

---

# M1 — Remove the artifact

## M1.1 The password hash (answers `BP-CRED-01`…`05`, `BP-CRED-11`, `BP-KEY-14`)

**The artifact removed**: the stored verification record. In every credential-breach precedent, the attacker's real prize was not the data — it was **the verification function**, which travels with the hash and makes every subsequent guess free and offline.

**How it works (PRISM)** — a threshold OPRF extending RFC 9497 into a threshold setting. **VERIFIED** (`tier2-protocol-prism`)

1. The browser hashes the password to a curve point via Elligator 2 on Curve25519, then **blinds** it with a random scalar: it sends `X = Y · j`, plus `H(username)`, a session public key, and a voucher. The password never leaves the device in recoverable form.
2. Each ORK applies its own secret share: `X'ᵢ = X · sᵢ`. *"The ORK learns nothing about Y — it applies sᵢ to the already-obfuscated point X."*
3. The browser removes its blind, recovering `Y · s` — the product of the password point and the **joint** PRISM secret `s`.
4. `s` itself is never assembled anywhere. Each ORK holds only a Shamir shard `sᵢ`.

**What actually sits at rest**: a per-ORK verifier `vᵢ = H(mSecORKᵢ · (G · H(Y·s)))`, derived from *both* that ORK's private key and the correct password-PRISM product. The source: *"individual shards reveal nothing about the password"* and *"One compromised verifier is useless without the distributed PRISM product."* **VERIFIED**

**Why the artifact is gone** — this is the sharpest "why" in the system:

> "Unlike hash-based authentication — where the verification function can be replicated offline once the hash and salt are known — BYOiD's verification function is an emergent property of a live, threshold interaction" — `tier1-article4` **VERIFIED**

> "In a conventional system, the 'salt' is a stored string. In PRISM, the equivalent is the output of a live computation distributed across an entire swarm of independent nodes." — `tier1-article4` **VERIFIED**

Each guess costs a network round-trip to ≥14 independent nodes, and `uid` is throttled network-wide after repeated failures. Adobe (`BP-CRED-04`) and Ashley Madison (`BP-CRED-05`) are the counterexamples that prove the point: in both, the *stored* verification path was the whole breach, and in Ashley Madison a correctly-implemented bcrypt store was defeated by one redundant MD5 field shadowing it. There is no field to shadow if there is no verification record.

**Where the guarantee lives**: the ORK fabric, and only during a live ceremony.

**Peer review**: PRISM's formal analysis is published — Wang, Hertzog et al., *Towards Zero Trust Authentication in Critical Industrial Infrastructures with PRISM*, Springer, ACNS 2023 Workshops, LNCS 13907, DOI 10.1007/978-3-031-41181-6_19. **VERIFIED** (Note: sources refer to the venue as both "CIMSS2023" in prose and "ACNS 2023 Workshops" in reference lists.)

**What it does NOT fix** — stated by Tide, not inferred:
- *"It does not prevent phishing … credential reuse across non-Tide services … or weak password selection."* (`addendum`)
- A malicious client can capture the password **before blinding**: *"Honest user using a malicious SWE can get password phished — SRI is the mitigation for that."* (`tier2-protocol-prism`) See M6.
- Rate limiting is a **stated assumption**, not a cryptographic property.

**Verify with**: I-01, I-02. `grep -rn "bcrypt\|argon2\|password_hash" --include="*.ts" .` should find nothing in the auth path.

## M1.2 The signing key (answers `BP-KEY-06`, `BP-KEY-03`, `BP-KEY-01`)

**The artifact removed**: the private key that mints identity. Storm-0558 is the purest case in the library — one key, seven years old, never rotated, equalled being every user of Exchange Online, with no authentication event to alert on.

**How it works**: the VVK is generated across an independent 20-node swarm at 14-of-20 via Distributed Key Generation. **There is no dealer and no moment of assembly** — each ORK generates its own sub-secret, splits it to peers, and the global private key is *mathematically defined* as the sum of 20 sub-secrets that no entity ever computes (`tier1-article3`). **VERIFIED**

At signing time:

> "At no point does the VVK private key materialize — each ORK exercises its shard independently, and the partial signatures are designed to aggregate into a valid Ed25519 signature without ever combining the key shares." — `tier2-protocol-vvk-jwt-signing` **VERIFIED**

The IAM server holds **no signing key at all** — only a VRK, a delegated *communication* key: *"The VRK grants the right to speak to the swarm, not the right to command it."* Hence: *"TideCloak has no signing keys. The authority that normally lives inside an IAM has been dissolved entirely."* (`tier1-article5`) **VERIFIED**

**Why key age and rotation stop mattering**: **proactive resharing** (Herzberg et al., CRYPTO '95) periodically refreshes all 20 shards into a set mathematically incompatible with the old one, while the underlying key and public key are unchanged — *"an attacker who stole a shard at time τ gains nothing after rotation at τ+1"* (`tier1-article3`). **VERIFIED** This defeats the slow-accumulation attack directly. Storm-0558's un-rotated 2016 key has no analogue here, because there is no object whose age is a property. **Note**: a concrete resharing interval is NOT STATED IN SOURCES.

**Where the guarantee lives**: the VVK ORK swarm. The application server and TideCloak are outside the trust boundary by construction.

**What it does NOT fix**: `BP-KEY-06`'s *second* failure was a **verification** bug — a consumer-scoped key accepted for enterprise tokens. Distributing the signing key does not fix a broken verifier. See M2 and M3.

---

# M2 — Distribute the *decision*, not just the key

**This is the class most reports miss, and it is the strongest argument in the system.**

`BP-AUTHZ-09` (Sign in with Apple) involved **no stolen key**. Apple's endpoint minted a validly-signed token asserting any requested email address. Every relying party verified the signature correctly and was still fully compromised. Protecting a key does nothing about that. Neither does sharding one — 20 nodes holding shards of a key that will sign whatever it is asked to sign produces the same forged token.

What changes the outcome is distributing the **decision to sign**.

**How it works**: before contributing a partial signature, **each VVK ORK independently executes a 12-gate verification chain** on the draft token. **VERIFIED** (`tier2-protocol-vvk-jwt-signing`, Algorithm 1)

| # | Gate | What it establishes |
|---|---|---|
| 1 | Retrieve VVK record | Binds to the correct vendor key |
| 2 | VRK delegation | TideCloak is authorized to *speak*, via a VVK-signed proof |
| 3 | ECDH decryption | Channel authenticity |
| 4 | Cross-key authentication | A real user login occurred — verifies the CMK blind signature |
| 5 | Authentication liveness | The auth token has not expired |
| 6 | **Claim validation vs user context** | *"every claim in the JWT must be authorized by the user context"* — plus `realm_access`, `resource_access`, per-client-role sub-assertions |
| 7 | **Authorization proof** | The claims match what the **admin quorum** approved for this user-client pair |
| 8 | Temporal binding | `iat`, `auth_time` within 300s; `exp` in the future |
| 9 | Session binding | `session_state` and `sid` match the vendor session key |
| 10 | Session-auth match | `spk` matches the authenticated client key |
| 11 | Identity match | `vuid` matches the authenticated user |
| 12 | Nonce commitment | 30s TTL, max 30 per VVID — closes the Wagner birthday attack |

*"Any single ASSERT failure → ABORT. The ORK drops the connection and logs the anomaly."* And critically: *"The ORK does not modify or strip the JWT; it validates and either accepts or aborts."*

**Why this defeats a fully compromised IdP**:

> "even if TideCloak is fully compromised, unauthorized claims cannot survive the threshold verification because each ORK independently rejects non-compliant drafts." — `tier2-protocol-vvk-jwt-signing` **VERIFIED**

> "If an attacker injects elevated privileges into the JWT draft (adding `"role": "superadmin"` or unauthorized scopes), the VVK ORKs detect the discrepancy against the pre-approved user context… the attacker's injected privileges never reach a signed token because each of 14 ORKs independently rejects the non-compliant draft." — `tier1-article5` **VERIFIED**

The claims are checked as a **subset of two independently VVK-signed artifacts** — the user context and the authorization proof — and the proof is treated as ground truth: *"the stripped JWT's claims must match exactly what the admin quorum approved."* A compromised TideCloak also cannot fake a login: *"it cannot produce a valid blindSign without the user's CMK shares cooperating."*

**Where the guarantee lives**: 14 independent ORKs, each re-deriving the answer rather than trusting an assertion. This is the same property `BP-ADMIN-07` (Ubiquiti) lacked in a different domain — there, the person being logged controlled the log.

**Source conflict to be aware of**: Article 5's diagram says ORKs *"Strip JWT to proof-approved claims"*; the tier-2 protocol says they never modify it. **Use the tier-2 protocol** (more specific) and treat "strip" as loose tier-1 phrasing.

**What it does NOT fix**: the *relying party* must still verify the token it receives. See M3.2 — and note `BP-AUTHZ-10`/`BP-AUTHZ-11`: a verifier that lets the token choose its own algorithm is defeated regardless of how the token was signed.

---

# M3 — Bind the credential

## M3.1 Session and token binding (answers `BP-KEY-05`, `BP-KEY-07`, `BP-SESS-05`, `BP-AUTHZ-03`)

**The artifact removed**: the free-floating bearer token. CircleCI is the clearest precedent — MFA was present, satisfied, and irrelevant, because the artifact stolen was issued *after* the MFA check and worked from anywhere.

**How it works**, in layers:

- **Non-extractable session keys.** WebCrypto keys with `extractable: false`, never written to `localStorage` or `IndexedDB`. *"This provides software-level non-extractability; hardware-level guarantees are not claimed."* (`tier2-protocol-swe`) **VERIFIED**
- **Gates 9–10** above bind the JWT to the vendor session key and the authenticated client key.
- **The Doken** — the token carrying *cryptographic agency* (as distinct from the JWT, which carries API authorization) — is *"session-scoped, time-limited, and device-bound"*, embedding the session public key `B`. On presentation each ORK checks it was VVK-signed, that the connection is encrypted with the Doken's session key, and that it carries the required roles. **VERIFIED** (`tier1-article6`, `tier2-protocol-forseti`)
- **DPoP** (RFC 9449) bidirectional binding at the application layer — I-12, `canon/feature-mapping.md`. **DOCUMENTED_GAP_IMPLEMENTATION_COVERED**

**Why a stolen token stops paying**: *"A compromised application server can read the JWT (standard OIDC) but cannot forge a Doken (VVK threshold signature required) and cannot intercept or replay a Doken (session key binding prevents use from a different connection)."* (`tier2-protocol-forseti`) A stolen Doken used from another device *"fails step 2 (session binding mismatch)"*.

Even the remember-me capsule is bound rather than bearer: *"A stolen selfRequestᵢ cannot be used without the ability to perform ECDH operations with u — which cannot be exported via any JavaScript API."* (`tier2-protocol-cmk-ceremony`) **VERIFIED**

**Where the guarantee lives**: the browser's non-extractable key store plus per-ORK checks.

**What it does NOT fix**: a token stolen *and used from the same compromised browser*. Binding relocates the attack from "anywhere" to "that device," which is a large reduction, not elimination.

## M3.2 The relying party's own check (answers `BP-CRED-09`, `BP-AUTHZ-01`, `BP-AUTHZ-10`)

**Not a whitepaper claim.** No whitepaper source describes relying-party verification, JWKS, or whether a network call is needed — this is **DOCUMENTED_GAP_IMPLEMENTATION_COVERED**, established by the exemplar repos and recorded as I-03, I-04, I-08.

- **I-03**: protected APIs must verify JWT signature and claims **server-side**; client-side role checks are UI gating only.
- **I-04**: verification uses an **embedded JWKS** from the adapter config — local-only, no remote key fetch, so there is no key-server dependency to compromise or DoS.
- **I-08**: *UI gating is not authorization.*

**Why this matters more than anything else in an app review**: Tide supplies a token whose claims 14 independent nodes agreed to. If the API never checks it, none of that reaches the request. Optus (`BP-CRED-09`) is the precedent, and it is a finding **against the application**. Route fixes to `tide-route-and-api-protection`.

**Pin the algorithm explicitly** (I-13, SG-13). `BP-AUTHZ-11` — CVE-2026-11800, a JWT algorithm-confusion bypass in Keycloak fixed in **26.6.4** — is inherited by any TideCloak below that version. Check `canon/version-policy.md`.

---

# M4 — Require plurality

## M4.1 Admin quorum (answers `BP-ADMIN-01`, `BP-KEY-12`, `BP-ADMIN-03`/`04`, `BP-CHAIN-03`, `BP-SESS-02`)

**The artifact removed**: unilateral administrative power. Note that in `BP-KEY-12` (Coinbase) **no technical control was bypassed** — support agents used access they legitimately held. Authentication and detection are structurally irrelevant to that; only an authorization model that requires plurality changes it.

**How it works**:

> "Any modification capable of affecting JWT claims requires the cryptographic consensus of an administrative quorum before the VVK will seal it." — `tier1-article5` **VERIFIED**

- **14 distinct change types are governed**, including Forseti policy deployment itself. **VERIFIED**
- A **change set** traces the full graph of affected user-per-client pairs, generates a draft proof for each, and computes a SHA-256 **checksum digest** that becomes the immutable identifier. *"Any modification to any proof, any addition or removal of affected pairs, or any alteration of the timestamp changes the checksum."* **VERIFIED**
- Each approving admin contributes three artifacts: an authentication message, a **CMK blind signature**, and a **session-key signature over the specific change-set checksum**.
- Every ORK re-verifies a four-link chain per admin — identity → VVK-certified group membership → membership lookup → co-signature on this change-set — and asserts `approvers ≥ threshold`. *"The ORK does not trust TideCloak's assertion that the quorum was met — it mathematically re-verifies the entire governance lifecycle."* **VERIFIED**
- **Double-approval is blocked**: an admin who approved cannot approve again, *"prevent[ing] a single compromised administrator from inflating the approval count."* **VERIFIED**
- **Replay window**: the draft timestamp must be within `now() − 2628000` seconds. Sources call this "30 days"; the constant is **30.4 days**. **VERIFIED (with arithmetic note)**
- **Why session keys, not CMK**: *"An attacker cannot harvest a permanent CMK signature and reuse it against future change-sets, because the admin never signs the changeset with their CMK — only with the ephemeral session key."* **VERIFIED**

**Threshold**: *"approximately 70% of active administrators (e.g., 2-of-3, 3-of-5)"*, derived from the governing policy, itself a governed change. If the configured threshold exceeds active admins, the system caps at 70% of the remaining active count to prevent deadlock. **VERIFIED**

**The exact formula** is `max(1, floor(TotalAdmins × 0.7))` — **DOCUMENTED_GAP_IMPLEMENTATION_COVERED**. It is *not* in the whitepaper, which says only "approximately 70%"; it is VERIFIED from `SetupIGA.md` and recorded in `canon/invariants.md` I-10 and `canon/feature-mapping.md`. Cite the implementation source for the formula and the whitepaper for the principle — do not attribute the arithmetic to the whitepaper.

Two further distinctions the formula alone hides:
- **Tide mode vs Tideless.** In Tide mode (`iga.attestor=tide`) approvals are cryptographic, sealed VRK→Midgard→ORK. In **Tideless mode** the same quorum *count* is enforced by TideCloak server logic with a username attestation and **no cryptography** — so I-09's "no single point of bypass" does **not** hold. See `canon/security-gap-mapping.md`. A red-team report that cites quorum without establishing which mode is deployed has not established anything.
- The IGA admin quorum is distinct from the SSH policy `threshold` (per-role Forseti signing approval count). Independent systems.

**No break-glass, deliberately**: *"In Tide, there is no singular break-glass bypass… The absence of break-glass is not a gap in the design; it is the design."* **VERIFIED**

**Where the guarantee lives**: the VVK ORK swarm, re-verifying rather than trusting.

**What it does NOT fix**:
- A support agent's need to see *some* data to do the job. Quorum raises the cost from "bribe one contractor" to "bribe a threshold" — large, not infinite.
- **A weakness for low-quorum tenants (2-of-3) is NOT STATED IN SOURCES.** `2-of-3` appears only as a neutral example of ~70%. The concern that two compromised admin sessions meet a 2-of-3 quorum is **INFERRED** and must be tagged as such.
- `BP-KEY-13` (Bybit) is the live warning: quorum protects only what approvers can independently *see*. If all approvers review through one compromised interface, N-of-M collapses to 1. Ask what each approver actually verifies.

## M4.2 The bootstrap window (`T-13`)

Sourced precisely: single-administrator mode signs proofs directly via VRK delegation, exists *"for a single purpose, establishing the first `tide-realm-admin` role assignment"*, **cannot initiate Ragnarök**, and the moment that assignment commits the system *"automatically and irreversibly transitions to multi-administrator mode"*, regenerating all default user contexts so the whole authorization surface is re-sealed. *"The bootstrapping exception exists only long enough to eliminate itself."* **VERIFIED**

## M4.3 Threshold recovery (answers `BP-SESS-08`/`09`, `BP-SESS-07`, `BP-SESS-11`, `BP-ADMIN-03`)

**The artifact removed**: the single recovery channel — one mailbox, one phone number, one help-desk agent — that outranks the password in the real trust hierarchy.

**How it works**: all 20 ORKs independently dispatch recovery emails; the user must click **t = 14** unique links within **1 hour**. *"Each ORK independently retrieves its single stored CMKEmailAddress… No ORK knows which addresses other ORKs hold."* Zero ORK-to-ORK communication during dispatch. The email challenge *replaces the password proof*; **the CMK is never touched** — only the PRISM secret changes, and the CMK still authorizes the transition via group signature. A compromised email provider *"sees links but cannot forge/decrypt selfRequests."* **VERIFIED**

**Why this beats every recovery precedent**: `BP-SESS-09` (The Community) proved SMS 2FA's security is bounded by the least-bribable employee at a carrier you have no contract with. Here the attacker needs *"access to email accounts linked to ≥14 distinct ORKs."*

**What it does NOT fix** — and this is a real gap:
- Emails are **optional** at account creation, and the SWE assigns *"1-20 user-provided email addresses across the 20 ORKs (one per ORK, with possible overlap)"*. **Fewer than 14 distinct addresses is permitted by construction.** The sources state **no minimum, no warning, and no analysis of the resulting reduction** in the effective threshold. In the worst case (one address) a single mailbox authorizes recovery.
  - ⚠️ **This consequence is INFERRED, not VERIFIED.** The construction is sourced; the conclusion is ours. Report it as an operator-configuration finding, and check it in any deployment review.
- The 1-hour window with no password proof is a strictly larger surface than login.
- The **admin-quorum recovery variant** is referenced for enterprises but its mechanism is NOT STATED IN SOURCES.

---

# M5 — Constrain execution

**Answers `BP-KEYLOSS-02` (Parity), `BP-KEY-13` (Bybit), `BP-AUTHZ-12`.**

**The artifact removed**: the policy engine as a *gate in front of* the key — something that can be bypassed, or that runs in one place and can be subverted there. Parity is the precedent: multi-sig at the signature layer, 1-of-anyone at the code layer, and the shared library was the single point of failure under every key.

**How it works (Forseti)**: *"Each ORK independently loads and executes a deterministic C# contract in a sandboxed environment. If the contract fails, the ORK cannot produce its partial computation."* All 20 execute independently — *"no 'master ORK'"*. **VERIFIED**

> "The policy is not a gate in front of the key — it is a precondition of the key's operation." — `tier2-protocol-forseti` **VERIFIED**

**The temporal property is the one to cite**:

> "the contract runs *before* the ORK touches its key shard. The ORK loads aᵢ into ephemeral memory only after the contract returns a successful PolicyDecision. This means contract code, which is vendor-authored, never has access to the shard. The sandbox separation is both logical … and temporal." — `tier2-protocol-forseti` **VERIFIED**

**The five sandbox layers.** Two sources describe these at different altitudes, and both are valid — use the one that matches your claim.

*As stated in the whitepaper* (`tier2-protocol-forseti`, Algorithm 3) — **VERIFIED**:

1. **IL vetting** — forbidden namespaces (configurable; defaults include `System.IO`, `System.Net`, `System.Reflection`); blocks non-deterministic calls (`DateTime.Now`, `Guid.NewGuid`); *"Fail closed on unresolved tokens (unknown references are rejected, not ignored)"*.
2. **Process isolation** — separate OS process, default 10s CPU / 1024 MB, whitelisted assemblies only.
3. **Gas metering** — default **50,000 gas**, charged across CPU time (1,000/ms), peak memory (100/MB), GC allocations (50/MB), Gen0 collections (500 each).
4. **Statelessness** — sandbox created per invocation, purged on return.
5. **Determinism enforcement** — see below.

*As stated in the implementation record* (`canon/concepts.md`, `canon/invariants.md` I-15, vendor confirmation, GAP-008 resolved) — **DOCUMENTED_GAP_IMPLEMENTATION_COVERED**: contracts are **compiled with Roslyn** against .NET 8.0 plus three SDK assemblies (`Ork.Forseti.Sdk`, `Cryptide`, `Ork.Shared`); each policy runs in an isolated **`AssemblyLoadContext`** inside a separate VmHost process. The full block-list adds `System.Diagnostics`, `System.Threading`, `System.Runtime.InteropServices`, `System.Reflection.Emit`, `Microsoft.Win32`, with `System.Console` and `System.Runtime.CompilerServices.Unsafe` **always hard-blocked**; static constructors are banned; a violating contract compiles but fails vetting with `BadPolicy.ForbiddenCall` **at upload time**.

The two views are consistent — Roslyn and `AssemblyLoadContext` are implementation detail beneath the whitepaper's "IL vetting" and "process isolation". **Attribute them to the implementation record, not to the whitepaper.**

**Why determinism is required**: *"If one ORK's contract produced a different result due to DateTime.Now or random values, the threshold signature would fail."* Enforcement is at **deployment time** — a non-deterministic contract is rejected from the registry and never runs. Contract identity is `SHA512` of the source, so *"if any ORK has a different version, the ID mismatch prevents execution."* **VERIFIED**

**Where the guarantee lives**: every ORK sandbox, before any key material is in memory.

**What it does NOT fix**:
- ⚠️ **A residual about block-list completeness is NOT STATED IN SOURCES.** Earlier pack text asserted *"block-list completeness is load-bearing"*; that is **INFERRED**. What the sources do say is that the defaults are *configurable* (so a deployment can weaken them) and that unresolved tokens **fail closed**. Report the inference as an inference.
- Sandbox isolation carries a stated assumption: *"Kernel-level process isolation integrity."*
- Forseti governs whether the key acts. It does not verify that a human approver was shown the truth (`BP-KEY-13`).

---

# M6 — Pin integrity

**Answers `BP-CHAIN-13` (polyfill.io), `BP-CHAIN-07` (Ticketmaster), `BP-CHAIN-06` (British Airways).**

**The artifact removed**: implicit trust in a delivery origin. polyfill.io required no compromise at all — the domain was simply sold, and every site that hardcoded it had delegated permanent code-execution rights in its own origin.

**How it works**: the SWE is *"a browser-delivered HTML/JS module"* acting as an **untrusted dealer** — *"the protocol is designed so that even a fully compromised SWE cannot breach security, only deny service."* **VERIFIED** (`tier1-article7`)

Integrity is hash-pinned, not origin-pinned. Required markup (**VERIFIED**, `tier2-protocol-swe`):

```html
<script defer src="..." integrity="sha256-..." crossorigin="anonymous"></script>
```

with a minimal `<head>` containing *exactly one* `<script>` tag and no other scripts, stylesheets, meta tags or inline handlers. On mismatch: *"**block execution** — SWE does not start."*

**Why hash-pinning beats origin trust**: *"The security model is hash-based, not origin-based: rehoming the SWE does not change the security posture."* Users may re-host it themselves, and can independently verify the hash against Tide's Integrity Checker or any independent auditor. A polyfill.io-style ownership change changes the hash and the browser refuses it.

> ⚠️ **Provenance correction.** **CSP appears nowhere in the whitepaper.** The `frame-src` requirement is **DOCUMENTED_GAP_IMPLEMENTATION_COVERED** via I-06, not a whitepaper claim. Cite I-06, not the whitepaper, for CSP.

**What it does NOT fix** — Tide is explicit and this is `T-14`:

> "This is a widely deployed, well-tested browser feature — but it is a software property, not a mathematical one." — `addendum` **VERIFIED**

> "If the SWE code is replaced, the attacker could capture raw credentials before PRISM blinding. A malicious SWE could also generate an extractable session key … enabling session hijack." — `tier1-article9` **VERIFIED**

The addendum widens this to *"malicious browser extensions, DOM-based XSS, or OS-level malware"*. And on phishing, verbatim:

> "FIDO2's domain-origin binding provides some phishing resistance that password-based flows — including Tide's — do not inherently match." — `tier1-article4` **VERIFIED**

`BP-SESS-01` (0ktapus) is the empirical proof of exactly that gap: Cloudflare's FIDO2 origin binding held where Twilio's relayed OTP did not. **Cite it against Tide's password path** — the honest fix is the Authenticator App.

**The out-of-band path**: the Authenticator App holds a **DVK** in the device's secure element, biometric/PIN protected, so *"no password enters the browser, nullifying both keystroke capture and session key extraction threats."* Each ORK verifies the device key without any ORK knowing it. **VERIFIED**

But its anti-phishing property is **user-adjudicated**: the app *"detects the unfamiliar key and exposes the fraudulent TLD"* and shows *"Unfamiliar device! Verify the TLD."* — the user must act on it. **What happens if the user clicks through is NOT STATED IN SOURCES.** *(Source note: the addendum says the DVK is generated via Nested Shamir DKG; the protocol doc generates it locally in the secure element. These conflict; prefer the protocol doc.)*

---

# Why the blast radius stays small

Two mechanisms, both worth citing because they are what make "per-key" real rather than rhetorical.

**Key-type agnosticism.** An ORK database *"stores an identifier, a timestamp, an ECDH session binding, and a Shamir shard. It stores no metadata indicating whether the shard will authenticate a user, sign an enterprise JWT, or decrypt a private message."* **VERIFIED** Without it, *"compromised nodes could be queried specifically for high-value key populations."* ORKs also store no metadata about which vendors a user is associated with.

This is also why identity binding is **deliberately deferred out of key generation** to the test sign-in: *"This architectural separation ensures that identity binding is coupled to the authentication ceremony, not to key generation — making the DKG construction purely key-type agnostic."* **VERIFIED**

**Separate swarms per key.** *"every key is distributed across a different swarm"*; *"Compromising one swarm yields only the keys that share that exact cluster."* **VERIFIED**

**The compromise zones** (`tier1-article9`, mainnet n=20, t=14) — **VERIFIED**:

| Compromised ORKs | Effect |
|---|---|
| **0–6** | All operations succeed normally. Fully secure. |
| **7–13** | **DoS only.** *"Can deny service… Cannot reconstruct the key."* Recoverable via key healing. |
| **14–20** | *"Can reconstruct the key or produce unauthorized signatures."* |

Honest-minority requirement: `n − t + 1` = **≥7 honest nodes**.

> ⚠️ **Canon correction.** I-09 currently states security holds if *"fewer than 30% of ORKs compromised… On mainnet: <7 of 20."* That is the **no-impact-at-all** zone (0–6), not the security bound. Confidentiality survives up to **13** compromised; availability degrades from **7**. I-09 conflates the two and understates the security margin. *(A related defect exists in the source: `tier2-protocol-prism` labels a row "13-of-20 security tolerance" while defining it as `n − t` = 6. Article 2 gives the correct split — 6 offline-tolerant, 13 collusion-tolerant.)*

**Per-key blast radius** — quote this precisely, it is frequently overstated:

> "**CMK or CVK (user keys):** Compromise is limited to that specific user… No other users are affected."
> "**VVK (organizational key):** The attacker can decrypt VVK-sealed data and forge governance signatures. However, the attacker **cannot** forge BYOiD authentication or mint user JWTs — these are bound to the user's blind signature, requiring control of the user's separate CMK swarm. The VVK alone cannot impersonate a user." — `tier1-article9` **VERIFIED**

> "There is no skeleton key." — `tier1-article9` **VERIFIED**

---

# Where the argument stops

Everything above holds **only** under conditions the sources state plainly. A report that omits them is not more persuasive; it is less credible.

## The five irreducible assumptions (`tier1-article9`) — **VERIFIED**

1. **Honest-minority threshold (≤13 of 20 per key)** — *"the single irreducible cryptographic assumption."*
2. **Mathematical hardness** — ECDLP, SHA-256 preimage, EdDSA.
3. **Browser SRI enforcement** — a software property, not a mathematical one.
4. **Node independence** — *"A single operator secretly controlling 14 nodes renders the threshold meaningless."*
5. **Payer node integrity** — economic only, bounded to one billing cycle.

## Maturity boundaries the sources admit — **VERIFIED**

- **Not independently audited**: the **Double-Blind TSS** is *"pending joint publication with RMIT University"*, and the custom curve **BEd255475** is *"not independently published"* with *"SafeCurves-equivalent analysis forthcoming"*. An independent audit by a recognized firm is listed as a **future milestone**. Treat vendor unlinkability and signing-oracle containment as **provisional**. (Peer-reviewed by contrast: PRISM, Nested Shamir DKG — arXiv:2309.00915, and FROST-like threshold signing.)
- **Not Sybil-proof**: *"A sufficiently resourced adversary willing to create 14 independently-appearing organizations… could theoretically subvert a single swarm. It is not cryptographically impossible — it is economically prohibitive and operationally detectable."* This is assumption 4's real status, and `BP-KEYLOSS-04`/`BP-KEYLOSS-05` are why it deserves operational verification rather than acceptance.
- **Permanent lockout is possible**: *"if an organization's administrative quorum is permanently lost… The key is effectively locked. Tide cannot help. No entity can."* Mitigation is governance — *"set quorum thresholds appropriate to their operational reality (e.g., 2-of-5 rather than 3-of-3)"* — plus triggering Ragnarök before degradation. Pair with `BP-KEYLOSS-08`: **an untested recovery path is not a recovery path.**
- **Fails closed by design**: *"the architecture prioritizes confidentiality over availability"*. See the AVAIL anti-precedents — Tide does **not** improve availability, and says so.
- **Sole Payer cluster today**: *"Tide Foundation currently operates the sole Payer ORK cluster… This reflects the network's maturity stage, not an architectural constraint."*
- **Post-quantum not finalized**: *"Specifications have not been finalized."*
- **Cross-swarm correlation unanalyzed**: *"Formal analysis of this long-term correlation risk is an open research question."*
- **Latency at scale unpublished**, self-flagged as *"a maturity gap"*.
- The comparison to established IAM *"does not claim TideCloak is more mature, more widely deployed, or more feature-complete."*

## Ragnarök — the one deliberate exception

*"the deliberate, sole deviation to the 'never assemble' invariant"*, scoped to the **VVK only** (not user CMKs), gated on sequential approvals from `t` distinct administrators, with each ORK independently validating the governance signatures. Reconstruction happens *"exclusively within the organization's sovereign environment"*. Scenario B (nested admin threshold, *"nuclear codes"*) is stated to be *"the more secure path"* over Scenario A. Revocation precedes release: *"there is no window of dual validity."* Afterwards the org runs *"as a standard Keycloak deployment"* with a conventional EdDSA key — the weakest posture in the system, by design, and the anti-lock-in guarantee. **VERIFIED**

> ⚠️ **Two INFERRED claims to tag.** (1) The consequence of a **captured** (rather than lost) admin quorum is **NOT STATED IN SOURCES** — no source analyses quorum capture as an attack. That capturing `t` admins would export the VVK is a sound inference but must be tagged **INFERRED**. (2) The sources also do **not** analyse the window during Phase 3 in which TideCloak — a single server — holds the assembled VVK, beyond noting it is *"under organization's control."* Both are legitimate red-team observations; neither is a Tide statement.

## What remains the developer's job (`tier1-article10`) — **VERIFIED**

Six items, quoted from the "Remains" table:

1. Application logic correctness
2. Role assignment design
3. **Input validation and sanitization** — *"Standard web security (XSS, injection) still applies."*
4. **Transport layer security (HTTPS)**
5. **Redirect URI configuration**
6. Tag-based E2EE role assignment

What genuinely goes away: securing JWT signing keys, password-hash breach liability, key rotation procedures, HSM procurement, break-glass admin procedures, encryption key management, database encryption for sensitive fields, admin privilege escalation prevention, password breach notification, certificate pinning. *"What is absent from this API: No key management functions. No HSM configuration. No password hashing parameters."*

---

## Quick map: precedent → mechanism

| If the finding is… | Mechanism | Section |
|---|---|---|
| Credential store / offline cracking | PRISM threshold OPRF | M1.1 |
| Signing key theft / token forgery | Threshold VVK, no assembly | M1.2 |
| IdP signs a false claim | 12-gate per-ORK verification | M2 |
| Stolen token replayed elsewhere | Session binding + Doken + DPoP | M3.1 |
| Missing/incorrect server-side authz | Embedded JWKS, I-03/I-04/I-08 | M3.2 |
| Unilateral admin / support console | IGA quorum + authorization proofing | M4.1 |
| Recovery via one mailbox / SIM swap | 14-of-20 email threshold | M4.3 |
| Policy bypass / shared code path | Forseti, pre-shard, in every ORK | M5 |
| Client code tampering / CDN takeover | SRI hash-pinning + rehoming | M6 |
| Availability, ransomware, broken primitive | **Not neutralized** — see Index D | "Where the argument stops" |

## Verification

```bash
# M1 — no local key generation or assembly (I-01)
grep -rn "generateKey\|keygen\|assembleShards\|combineKeys\|reconstructKey" src/ server/

# M1.1 — no stored credential verification (SG-01)
grep -rn "bcrypt\|argon2\|scrypt\|pbkdf2\|password_hash" -i --include="*.ts" --include="*.js" .

# M1.2 — no signing key material (SG-02)
grep -rn "JWT_SECRET\|SIGNING_KEY\|PRIVATE_KEY\|jwt.sign\|HS256" -i .

# M3.2 — server-side verification with embedded JWKS (I-03, I-04)
jq '.jwk' data/tidecloak.json          # must be present
grep -rn "jwks_uri\|remoteJWKSet\|createRemoteJWKSet" src/ server/   # must be empty

# M4 — no admin bypass (I-09, I-10)
grep -rn "bypassIGA\|skipApproval\|adminOverride" server/

# M6 — SRI attributes present (tier2-protocol-swe)
grep -rn "integrity=\"sha256-\|crossorigin=\"anonymous\"" public/ app/

# Thresholds are configuration, not constants (I-02)
echo "$TIDE_VENDOR_THRESHOLD_SIGNING of $TIDE_VENDOR_THRESHOLD_TOTAL"
```

## Anti-patterns when using this file

- **Claiming Tide "prevents breaches."** It changes what an intrusion *yields*. Most precedents' root causes (unpatched CVEs, phished employees, missing MFA toggles) are untouched.
- **Citing sharding as the argument.** Sharding is table stakes; `BP-KEYLOSS-05` sharded. The claim is the four surfaces of Article 2.
- **Presenting INFERRED claims as VERIFIED.** The flagged ones — recovery email overlap, Forseti block-list completeness, low-quorum weakness, Ragnarök quorum capture — are the exact claims a knowledgeable reader will test first.
- **Hardcoding 14/20.** Per I-02, read the deployment's configuration.
- **Omitting M3.2.** The most common real-world failure is an app that never verifies the token, which makes every mechanism above irrelevant to that request.

## Status legend

`VERIFIED` — quoted from a bounded source in `sources/`.
`INFERRED` — strongly implied, tagged inline; never present as a Tide statement.
`ASSUMED` — pack operator guidance.
`DOCUMENTED_GAP_IMPLEMENTATION_COVERED` — absent from the whitepaper, established by exemplar repos and recorded in `canon/invariants.md`.
