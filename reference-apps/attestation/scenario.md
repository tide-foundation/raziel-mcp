# Attestation

## What this is

An app where **facts about people are signed by the network**, not just stored.

Normally a fact — *Bob is in Alice's close-friends group*, *Dave consented*, *Erin passed identity
checks* — is a database row, and whoever can write to the database decides what is true. Here the
ORK network threshold-signs the statement with the realm's key, and the app relies on the fact
**only while that signature verifies**. A row inserted or edited by anyone who could not get the
network to sign it attests nothing. That includes a compromised app server.

Every attestation has one shape:

> **Issuer** attests **Claim** about **Subject** — optionally regarding an **Object**, with a
> **Value**, until an **Expiry**.

## The catalogue — what you can attest, and who may

Pick the row that matches the request. The mode is the important column: it is **who is allowed to
make this statement**, and it is enforced by the network, not by your app.

| The user wants to attest that… | Claim | Mode | Issuer | Subject | Object | Value |
|---|---|---|---|---|---|---|
| a user was added to **my** group (close friends, a circle, a list) | `member-of` | **owner** | the group's owner | the member | the group | — |
| I shared **my** document / album / record with someone | `shared-with` | **owner** | the owner | the person | the thing shared | access level |
| someone may act on **my** behalf | `delegate` | **owner** | the principal | the delegate | scope | — |
| **I** consent / agree / acknowledge / declare | `consented` | **self** | the person | the same person | what they agreed to | version |
| **I** accept an invitation or a role | `accepted` | **self** | the person | the same person | the invitation | — |
| a user is on a team / assigned to a case / holds a role on a project | `assigned` | **role** | someone allowed to assign | the person | the case / team | the role |
| a user is verified (identity, age, KYC, training) | `verified` | **role** | someone allowed to verify | the person | the check | outcome |
| a request / expense / document was approved | `approved` | **role** | someone allowed to approve | the requester | the item | — |
| one user vouches for or endorses another | `endorsed` | **role** or **owner** | the endorser | the person | topic | — |

Claim types are yours to name. These are conventions shipped as helpers in
`templates/attestation/attestation.ts` (`statements.memberOf`, `.consented`, `.verified`, …); add
your own freely. A **rule lists the claim types it may sign**, so a new type means a new rule.

### The three modes

| Mode | The network requires | So it proves | Typical claims |
|---|---|---|---|
| **self** | `Subject == Issuer ==` the signer | the person said this **about themselves** — the only mode that proves the subject agreed | consent, acknowledgement, acceptance |
| **owner** | `Owner == Issuer ==` the signer, and `Subject` is someone else | the **owner** of the thing said this; nobody else can | membership of a personal group, sharing, delegation |
| **role** | the signer holds `IssuerRole`, and is the `Issuer` | someone **authorised** said this, and which person | assignment, verification, approval |

In every mode the signer must be the person named as `Issuer`. An attestation can never name
somebody else as the one who made it.

## Built-in contract first

Check this **before** the rest of the scenario. The ORK has a built-in contract,
`RelationshipAttestation:1`, that needs nothing written or deployed. Where it fits, use it
(`relationship-attestation`) and stop reading here. The custom contract described below is deployed
by the Tide team and is the fallback.

What the built-in contract attests: **a realm admin approved that this user is tied to this
record, to read it, write to it, or both**. The signed policy is that statement, and the network
also enforces it: only that user can decrypt (or encrypt) data tagged with the record's id.

The user also needs the matching realm role: `_tide_decryptor` to read, `_tide_encryptor` to write.
A policy can grant one without the other, so "may view" and "may contribute" are separate grants.

| Catalogue row | Built-in contract? | Why |
|---|---|---|
| `assigned` — a user is on a team, case or project | **Yes.** Use `relationship-attestation` | This is exactly its case: a user (or a team as a `Group` subject) and one record. A reviewer gets a read-only policy |
| `member-of` — a user was added to a group | **Yes, if membership is governed in TideCloak.** One `Group`-subject policy per record the group may open; membership itself is the Keycloak group (claim `groups`, name mandated) | The **owner** cannot grant: a `tide-realm-admin` approves the policy, and on an IGA realm membership changes are governed |
| `shared-with` — I shared my document with someone | **Yes, if a realm admin may be the one who shares** | Same limit: the owner cannot grant |
| `verified`, `approved` — an authorised person confirms something about a user | **Only if** the authorised person is a realm admin **and** the result is access to a record | It attests "admin tied user to record", not an outcome or a value |
| `consented`, `accepted` — I attest about myself | **No** | An admin's approval is not the user's consent |
| `delegate`, `endorsed` | **No** | Nothing is decrypted, and the issuer is not an admin |

So the built-in contract covers the **admin-granted relationship** cases. It does not cover a
statement made by the **user themselves** or by an **owner**, a statement with a **value**, or one
that gates no data. Those need the custom contract below, which goes to the Tide team (info@tide.org or Discord: https://discord.gg/XBMd9ny2q5) to deploy.

Tell the user which of the two they are getting, and why.

## When to use this scenario

Use when the user describes:
- "attest that …", "prove that this user …", "a signed record that …" about people
- facts that must hold "even if the server / database is compromised"
- membership, assignment, consent, verification, approval, sharing or delegation that should carry a
  signature

Do NOT use when:
- the claim is about **content** and is handed to a **third party** as a portable certificate, or
  must carry a **time the network vouches for** — use `attested-provenance-registry`
- the change is to **realm roles or users** and should be approved by admins — that is IGA; use
  `iga-admin-governance`
- the fact only needs to gate **decryption** — an encryption policy does that. One named user and
  one record (or a group or role and one record): `relationship-attestation` (built-in contract, nothing to deploy). Everyone holding a
  role: `organisation-password-manager`
- the signature is consumed by a protocol (SSH, a transaction) — `policy-governed-signing`

### The discriminating question

**Is it a fact about people that your own server relies on later?** Yes → this scenario.
A claim about content for someone else to verify → `attested-provenance-registry`.

## How it works: the attestation is a policy

A Forseti policy is a small signed structure with named parameters, and the network already knows
how to sign one (`Policy:1`). So the statement is written **as a policy** whose parameters carry it:
`Claim`, `Issuer`, `Subject`, `Resource`, and optionally `Object`, `Owner`, `Value`, plus an expiry.

Its model id is a custom one, `BasicCustom<Attestation>:BasicCustom<1>`, that no real request
carries. A signed attestation therefore **authorises nothing** on the network, and the contract
refuses it outright if anyone presents it as a request. It is something your server verifies and reads.

VERIFIED: this pattern runs in production in a private case-management app (source read
2026-10-07), where it signs a member's role on a case. `LIKELY_REUSABLE_PATTERN`. The general
contract shipped here was checked against the real ORK SDK, compiler and IL vetter; see
`templates/attestation/README.md` for exactly what was and was not tested.

## One contract, one rule per kind of issuer; then no approvals

1. **The contract** (`templates/attestation/AttestationContract.cs`) says what may be signed and by whom.
2. **A signing rule** per kind of issuer: a policy with model `Policy:1`, approval `IMPLICIT`,
   execution `PRIVATE`, naming the contract, the **claim types** it may sign, and the **mode**.
   Admins sign each rule **once**, through a change request.

After that, making an attestation needs **no approver**. The signer's own credential is the whole
check — which is why the contract is almost entirely about what to refuse, and why each rule should
be narrow. An app with consent, friend lists and verification mints **three rules**:

```
--claims consented            --mode self
--claims member-of,shared-with --mode owner
--claims verified             --mode role --role compliance:verify
```

Do not mint one wide rule. A `role` rule that also lists `consented` lets a role holder record
consent for other people.

## Runtime flow

```
1. A user does the thing: adds a friend, ticks "I agree", marks someone verified
2. SERVER   decides the caller may do it, writes the row, then builds the unsigned statement
            from that row (buildAttestation) and returns it with the realm's signed rule
3. BROWSER  signAttestation(): a Policy:1 request, the rule attached, signed as that user
            -> the contract runs on every ORK -> 64-byte signature
4. SERVER   REBUILDS the bytes from the row, verifies the signature against the realm key,
            and only then stores it (with the contract id and key id it was signed under)
5. EVERY decision that relies on the fact: rebuild from the row, verify. No valid signature = not true.
```

Steps 4 and 5 are the same function (`verifyAttestation`). Nothing is taken on trust in either
direction: the browser signs what the server built; the server verifies what the browser returns.

## The single most important design point: rebuild, never store

**Store the inputs and the signature. Never the signed bytes.** To check a fact, rebuild the bytes
from the row's columns and verify. A row somebody edited rebuilds to bytes the signature does not
cover. Storing the bytes beside the row would keep the answer next to the question and prove nothing.

It follows that the bytes must be **exact**: parameters in name order, written `IMPLICIT`/`PRIVATE`,
absent optional fields simply absent, an expiry as an eighth field. `buildAttestation` is checked
byte for byte against the ORK SDK's own `Policy.DataToVerify`.

Store on each row: the statement's fields, the signature, and the **contract id** and **realm key
id** it was signed under. Both are inside the signed bytes, so editing either breaks verification —
and keeping them per row means a later contract edit does not invalidate everything signed before it.

## What this does not give you

Say these to the user. Each is a real limit, not a footnote.

- **Revocation is not attested.** The network does not revoke a signature. Withdrawing a fact is
  deleting the stored signature, which the server controls. A compromised server cannot *create* a
  fact, but it could *restore* one that was withdrawn, by putting an old signature back. Where that
  matters, use an expiry and re-attest, or add a signed withdrawal (README, "Revocation").
- **It does not prove when.** The contract reads no clock. An expiry is in the signed statement and
  **your server** enforces it. For a time the network vouches for, use `attested-provenance-registry`.
- **It proves the issuer said it — not that the subject agreed**, except in `self` mode.
- **It is checked by your server.** It is not a portable certificate. Handing one to a third party
  means giving them the realm key and the exact fields; that is the provenance scenario's job.
- **It needs a browser and a logged-in issuer.** A bulk import or a background job cannot attest:
  there is no user credential to sign with.
- **Everyone named must have signed in once**, or they have no vuid.
- **Under a `role` rule, anyone holding the role can attest about anyone.** That is the authority
  the role already carried, now with a signature and a name on it.

## What must exist before first use

1. Realm bootstrapped, licensed, IGA enabled; `vuid` and `tideUserKey` mappers present
2. The contract uploaded to the realm
3. A signing rule minted for **this realm's key** and **this client**, for each kind of issuer, and
   its change request approved and committed — that signing round carries the contract to the ORKs
4. The rules readable by the app: `GET /admin/realms/{realm}/iga/role-policies/name/{name}`
5. A table per kind of fact with the statement's fields, the signature, contract id and key id

## Default playbook sequence

1. `start-tidecloak-dev`
2. `bootstrap-realm-from-template`
3. `initialize-admin-and-link-account`
4. `add-auth-nextjs-fresh` — or start from `tide_scaffold`
5. `protect-api-nextjs`
6. `verify-jwt-server-side`
   `bootstrap-sequence.md` Phase 5

## Key diagnostics

| Symptom | Cause | Fix |
|---|---|---|
| Signature returned, server refuses it | The bytes differ: field order, an optional field present on one side only, an expiry, a different contract id, key id or policy version | Rebuild with `buildAttestation` from `readSigningRule(rule)`; never hand-assemble |
| `insufficient data to read` | The policy was sent unwrapped | Send `wrapForEnclave(policy)` |
| `this rule does not sign claims of type X` | The rule was not minted for that claim | Mint a rule listing it; do not widen an existing rule past its mode |
| `under a self rule you can only attest about yourself` | `Subject != Issuer` | This is not a self statement; it needs an owner or role rule |
| `only the owner can attest about what they own` | Owner mode and `Issuer != Owner` | The owner must be the one signing |
| `the signer is not the Issuer this attestation names` | The logged-in user is not `Issuer` | Build the statement for the user who is actually signing |
| `attestations under this rule must not carry an expiry` | The rule was minted without `--allow-expiry` | Mint one that allows it, or drop the expiry |
| `Model id '...' not found in registry` | The model id is not of the form `BasicCustom<X>:BasicCustom<V>` | Use the model id exactly as shipped |
| Works on some requests, refused on others | The rule was signed at threshold and some ORKs never received the contract | Re-run the rule's signing round until every ORK has it |
| Everything stops verifying after a contract edit | The app rebuilt with the new contract id | Verify each row against the contract id stored on that row |
| `VmHost.CompileFailed` / `IlVetter.Failed` after editing the contract | A lambda, LINQ, a static field initialiser, or a clock read | Loops, `const`, and no clock |

## Reference implementation

`templates/attestation/`:

| File | What it is |
|---|---|
| `AttestationContract.cs` | The Forseti contract. Deploy it unchanged, or tighten it for your claims |
| `attestation.ts` | `buildAttestation`, `signAttestation` (browser), `verifyAttestation` (server), `statements.*` helpers |
| `mint-rule.mjs` | Builds a signing rule |
| `README.md` | Schema, the three calls, revocation options, and what was tested |

## Related

- `attested-provenance-registry` — the other attestation shape: a custom payload with a network
  timestamp, for third parties
- `iga-admin-governance` — governed changes to realm roles
- `canon/custom-contracts.md` → "Two ways to attest something"
- AP-43 (verify proofs), AP-89 (approvals credited to the caller)
