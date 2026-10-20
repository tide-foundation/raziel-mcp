# Anti-Patterns — Attestation

Each of these produces an app that looks attested and is not.

## AP-AT01: Treating a row as the fact

The whole point is that a row is not enough. One code path that answers "is X in the group", "did X
consent", "is X verified" from the table, without `verifyAttestation`, and a database write is all
an attacker needs.

**Do**: one function per kind of fact decides it, it calls `verifyAttestation`, and every access
decision, listing, count and notification goes through it.

## AP-AT02: Storing the signed bytes

Keeping the policy bytes next to the row means verification checks the bytes against themselves. An
edited row still "verifies".

**Do**: store the inputs and the signature. Rebuild the bytes from the row every time.

## AP-AT03: Storing a signature without verifying it first

A signature the browser returns is a claim until checked. Stored unverified, it reads as attested
forever after.

**Do**: rebuild from the row, verify, then store. Refuse one that does not verify.

## AP-AT04: Building the statement in the browser

The browser would then choose what gets signed, and the server would be verifying a statement it did
not write.

**Do**: the server builds the statement from the row it is about to record and sends it down. The
browser only signs. On the way back the server rebuilds it again, from the row.

## AP-AT05: Assembling the bytes by hand

A signature is over bytes. A policy that is logically identical but has its parameters in another
order, or an expiry field, or a different version, verifies against nothing — and the failure says
only that the signature is wrong.

**Do**: use `buildAttestation`. It is checked byte for byte against the ORK SDK. Parameters in
name order; `IMPLICIT`/`PRIVATE`; an absent optional field is absent, not empty.

## AP-AT06: An `IMPLICIT` rule that is `PUBLIC`

`IMPLICIT` removes the approvers. `PUBLIC` removes the signer's credential. Together, anyone can
have the network sign anything the contract allows. The contract refuses to run under one, but only
if you kept that check.

**Do**: `IMPLICIT` + `PRIVATE`, always, and leave the contract's check in place.

## AP-AT07: Letting the rule sign more than attestations

Under an implicit rule nobody approves anything, so the contract is the only limit. If it allows the
`any` model, or `Policy:1`, a signer can mint themselves a rule or a grant with no admin involved.

**Do**: exactly one model in the signed policy, and it is the attestation model. Unknown or repeated
fields are refused, not ignored. The claim type must be one the rule lists.

## AP-AT08: Using a role where the rule is about identity

"Only the owner can add to their close friends" and "only I can consent for me" are identity rules.
Inventing a `friends:manage` or `consent:record` role for them means everyone who holds the role can
attest for everyone.

**Do**: `owner` mode for things a person owns, `self` mode for things a person says about
themselves. The contract compares the signer's vuid with the statement.

## AP-AT17: One wide rule for every claim

A rule is a mode plus a list of claim types. A single `role` rule listing `consented`, `member-of`
and `verified` lets any holder of that role record consent for other people and add anyone to
anyone's group.

**Do**: one rule per kind of issuer. Group claim types only when the same mode, and the same role,
should govern all of them.

## AP-AT18: Reading consent off an attestation that is not `self`

Only a `self` attestation proves the subject said it. An `owner` or `role` attestation proves the
*issuer* said something about the subject.

**Do**: where agreement matters, require a `self` attestation from the subject — alone, or as well.

## AP-AT19: Trusting an expiry the server did not check

The contract reads no clock, so the network signs whatever expiry it is given and never enforces it.

**Do**: `verifyAttestation` refuses an expired statement; use it. For a time the network itself
vouches for, this is the wrong scenario: `attested-provenance-registry`.

## AP-AT09: Identifying people by the OIDC `sub`

The contract sees a doken, whose user id is the **vuid**. A statement naming a Keycloak user id can
never match its signer.

**Do**: vuids everywhere in the statement. Read the vuid from the `vuid` token claim; a user who has
never signed in has none and cannot be added yet.

## AP-AT10: Verifying against the OIDC JWKS

`/protocol/openid-connect/certs` does not hold the realm's Ed25519 key. The request succeeds and
every signature fails.

**Do**: `jwk.keys` from the adapter (`tidecloak.json`), loaded at startup.

## AP-AT11: Rebuilding every row with the current contract id

Editing the contract changes its id. An app that rebuilds every row with the new id invalidates
everything signed under the old one.

**Do**: store the contract id and key id on each row and rebuild with those.

## AP-AT12: Presenting revocation as attested

Deleting a signature is a server action. A compromised server cannot create a fact, but it can put a
withdrawn one back by restoring the old signature.

**Do**: tell the user. If it matters, use an expiry and re-attest, or add a signed withdrawal
(`templates/attestation/README.md`, "Revocation").

## AP-AT13: Reading a clock, using LINQ, or a static initialiser in the contract

Each compiles locally. A clock read can make ORKs disagree, so the threshold never assembles; a
lambda or a static field initialiser is rejected by the ORK's IL vetter.

**Do**: no clock, loops instead of LINQ, `const` or instance fields.

## AP-AT14: Signing the rule once at threshold and moving on

A policy that carries a contract must reach **every** ORK. A round that reaches only a quorum leaves
ORKs without the contract; requests routed to them are refused, intermittently.

**Do**: repeat the rule's signing round until it completes on every ORK, then confirm `signed`.

## AP-AT15: Attesting from a job, an import or a seed script

There is no user credential on a server. Seeded "attested" rows are unsigned rows.

**Do**: facts created outside a browser are unsigned and must show as such until the right person
signs them.

## AP-AT16: Accepting the terms or inventing the licence email to get the realm up

See AP-90. This scenario needs a realm like any other.
