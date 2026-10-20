# Attestation — contract and helpers

Makes a fact about people a statement the network signs, so the app's own database cannot forge it.

> **Issuer** attests **Claim** about **Subject** — optionally regarding an **Object**, with a
> **Value**, until an **Expiry**.

Membership is one such fact. So are consent, assignment, verification, approval, sharing and
delegation. Scenario and catalogue: `reference-apps/attestation/`.

| File | Runs | What it does |
|---|---|---|
| `AttestationContract.cs` | on the ORKs | Decides what may be signed and by whom |
| `attestation.ts` | server and browser | Builds the statement, signs it, verifies it |
| `mint-rule.mjs` | at setup | Builds a signing rule |

## The three calls

```ts
// SERVER — when someone does the thing. `rule` is the realm's signed rule for this kind of claim
// (base64), from GET /admin/realms/{realm}/iga/role-policies/name/{name}.
const info = readSigningRule(rule);
const fact = statements.memberOf(ownerVuid, "close-friends", friendVuid);   // or your own Attestation
return { unsignedPolicy: toBase64(wrapForEnclave(buildAttestation(info, clientId, fact))), signingRule: rule };

// BROWSER — as the person making the statement.
const signature = await signAttestation(unsignedPolicy, signingRule);

// SERVER — before storing, and on EVERY decision that relies on the fact. Rebuild from the row.
const ok = await verifyAttestation(info, clientId, fact, signature, adapter.jwk.keys);
```

Store per fact: the statement's fields, `signature`, and the `contractId` and `keyId` it was signed
under. **Not** the signed bytes.

## The statement

| Field | Required | Meaning |
|---|---|---|
| `claim` | yes | what kind of statement; the rule lists the kinds it signs |
| `issuer` | yes | vuid of who is saying it. The network checks the signer **is** this person |
| `subject` | yes | who or what it is about |
| `object` | no | what it concerns: a group, a case, a document, a policy name |
| `owner` | `owner` rules | who owns the object; must equal `issuer` |
| `value` | no | a detail: a role, a version, an outcome |
| `expiry` | no | Unix seconds; only under a rule minted with `--allow-expiry`; enforced by `verifyAttestation` |

People are named by **vuid** (the `vuid` token claim), never the identity provider's user id.

## Who may issue — the rule's mode

| Mode | The network requires | Use for | Helper |
|---|---|---|---|
| `self` | subject = issuer = the signer | consent, acknowledgement, acceptance | `statements.consented` |
| `owner` | owner = issuer = the signer; subject is someone else | your group, your shares, your delegates | `statements.memberOf`, `.sharedWith` |
| `role` | the signer holds a client role, and is the issuer | assignment, verification, approval | `statements.assigned`, `.verified`, `.approved` |

Only `self` proves the subject agreed.

## Setup

One rule per kind of issuer. Keep each narrow.

```bash
node mint-rule.mjs --contract AttestationContract.cs --key-id "$VVK_ID" --resource "$CLIENT_NAME" \
     --claims member-of,shared-with --mode owner
node mint-rule.mjs ... --claims consented --mode self
node mint-rule.mjs ... --claims verified  --mode role --role compliance:verify
```

Then store the contract in the realm, post each rule, and approve its change request. The full
sequence with commands is `reference-apps/attestation/bootstrap-sequence.md` Phase 5.

**Every edit to `AttestationContract.cs` changes its id**, so every rule must be minted and signed
again. Facts signed under the old contract keep verifying, because each row stores the id it was
signed under.

## Revocation

Not attested. The network does not revoke a signature. Withdrawing a fact is deleting the stored
signature. A compromised server cannot create a fact; it can restore a withdrawn one by putting an
old signature back. Tell the user, then choose:

| Option | How | Cost |
|---|---|---|
| Accept it | Nothing more | Withdrawal is server-trusted |
| Expire and renew | Mint the rule with `--allow-expiry`; give facts a short life and re-attest | A restored signature dies at its expiry. The issuer re-signs periodically |
| Epoch | Put a counter in `value` (or the object id); the issuer re-attests the current set under a new epoch when they withdraw one; only the current epoch counts | Everything remaining is re-signed on each withdrawal |
| Signed withdrawal | A second claim type, e.g. `removed-from`, checked alongside | The app must know which came last |

The first two work with the shipped contract. The last two need app logic and are not implemented here.

## What was tested, and what was not

Tested 2026-10-07:

- **The contract against the real ORK SDK**: 49 checks through the SDK's own `DataContext`,
  `ExecutorContext`, `Policy` and `Doken` types. Each of the three modes signs what it should and
  refuses the rest: another person's group, consent on someone's behalf, a signer who is not the
  issuer, a missing role, an unlisted claim type (including a prefix or a substring of a listed
  one), an expiry the rule does not allow, the `any` model, a new signing rule, another client,
  extra / missing / non-string fields, a `PUBLIC` rule, an `EXPLICIT` rule, and an attestation
  presented as a request.
- **The contract through the ORK's own compiler and IL vetter** with determinism enforced, and its
  parameters bound from all three rule shapes the way the VM binds them.
- **`buildAttestation` and `buildSigningRule` byte for byte** against the ORK SDK's
  `Policy.DataToVerify`: a minimal statement, one with every field, one with an expiry, and the
  three rule shapes. `mcp-server/test` keeps those bytes as known answers.
- **`verifyAttestation`** with a local Ed25519 key: a valid signature verifies; any edited field, a
  different contract, key or version, a missing or malformed signature, another key, and an expired
  statement are all refused.

Not tested:

- **A real signing round.** `signAttestation` has not been run against a live enclave by this pack.
  It follows the production exemplar's code, including its use of the private `IAMService._tc`
  handle, for which the SDK has no public equivalent.
- **Deploying the contract and signing a rule on a live realm.** Deployment is done by the Tide
  team; the rule endpoints are the exemplar's (`/iga/jit-policies`, `/iga/role-policies/name/{name}`).
- **The policy version on your network.** The ORK SDK build tested here writes version `4`. Published
  `@tideorg/js` builds have used `3`. `mint-rule.mjs` reads `Policy.latestVersion` from the SDK you
  have installed; `readSigningRule` then carries that version into every attestation.

## Common failures

| Symptom | Cause |
|---|---|
| Signature comes back but will not verify | Bytes differ. Rebuild with `buildAttestation(readSigningRule(rule), …)` from the row |
| `insufficient data to read` | The policy was sent without `wrapForEnclave` |
| `this rule does not sign claims of type X` | Wrong rule for this claim |
| `under a self rule you can only attest about yourself` | Subject is not the signer |
| `only the owner can attest about what they own` | Owner rule, and the signer is not the owner |
| `the signer is not the Issuer this attestation names` | `issuer` is not the logged-in user's vuid |
| Verifies on write, fails after a contract change | The row was rebuilt with the new contract id; use the one stored on the row |
