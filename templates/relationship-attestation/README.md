# Relationship attestation helper

Gives a named user, a group or a role access to one record's encrypted data, enforced by the Tide
network, using the ORK's built-in contract `RelationshipAttestation:1` (revision 3).

Scenario: `reference-apps/relationship-attestation` (read `scenario.md` first, then
`bootstrap-sequence.md`).

## Before you start

- **Confirm the network has the contract.** It is new and not in every network. Ask the Tide team
  (info@tide.org or Discord: https://discord.gg/XBMd9ny2q5). If it is missing, stop. Do not write a
  custom contract in its place.
- A realm with IGA on and a `tide-realm-admin` who can approve.
- Realm roles `_tide_decryptor` (read) and `_tide_encryptor` (write), granted to each user
  according to what they will do.
- The `tideUserKey` mapper on the client.
- For `Group` subjects: the **`groups`** mapper (claim name mandated). The pack's realm templates
  ship it with full path on, so a group's `subjectId` is its full path, e.g. `/clinic-a/nurses`.

## Install

```bash
cp relationship.ts <your-app>/src/lib/tide/
npm install @tidecloak/js @tideorg/js heimdall-tide
```

Start from a pack template (`tide_scaffold`) so login, DPoP and the enclave pages are already wired.

## Use

Grant, in a realm admin's browser:

```ts
import { signRelationshipPolicy } from "@/lib/tide/relationship";

// subject: { type: "User", id: granteeKey }       granteeKey = the GRANTEE's tideuserkey claim
//          { type: "Group", id: "/clinic/team-a" }  exactly as the `groups` claim carries it
//          { type: "Role", id: "case-reviewer" }    realm role; add clientId for a client role
// adminPolicy: bytes of the realm's admin policy, fetched by your server (see relationship.ts).
// access: "read" | "write" | "read-write"
const subject = { type: "Group", id: "/clinic/team-a" } as const;
const signed = await signRelationshipPolicy({ vendorId, subject, recordId, access: "read-write", expiry }, adminPolicy);
await fetch("/api/policies", { method: "POST", body: JSON.stringify({ subject, recordId, policy: signed }) });
```

Read and write, in the user's browser:

```ts
import { encryptForRecord, decryptForRecord } from "@/lib/tide/relationship";

const policy = await (await fetch(`/api/policies/mine?record=${recordId}`)).text();
const ciphertext = await encryptForRecord(note, recordId, policy);   // store this
const plaintext  = await decryptForRecord(ciphertext, recordId, policy);
```

## Server side

The helper is browser-only. Your server needs:

| Route | Rule |
|---|---|
| store a signed policy | admins only, checked from the verified token; parse the policy and confirm it names the expected user and record |
| return a policy | only when it applies to the caller: the `User` policy naming them, or a `Group`/`Role` policy whose subject is in their verified token |
| store and return ciphertext | verified token and DPoP proof; your own row-level rules |

Storage: `(subject_type, subject_id, client_id, record_id, policy_b64, expires_at, granted_by,
created_at)`, unique on `(subject_type, subject_id, client_id, record_id)`. Record each user's
`tideuserkey` when they first sign in, so an admin can grant to them later.

## Checks to run before you rely on it

1. Granted user encrypts then decrypts: round-trips.
2. Encrypt with a different tag: rejected.
3. Encrypt with two tags: rejected.
4. A second user uses the first user's `User` policy: rejected (`subjectId does not match.`).
4a. A non-member uses a `Group` policy: rejected (`'…' group not found in doken.`).
5. Remove `_tide_decryptor`, sign in again, decrypt: rejected (`'_tide_decryptor' role not found for
   this decryption request.`).
6. Encrypt with a read-only policy: rejected (`_tide_encryptor not found in list of roles.`).

If 1 passes and any of 2-6 (or 4a) is not rejected, stop and report it.

## What was tested

| Item | Status |
|---|---|
| The contract's rules | VERIFIED from the contract source on ORK `main` @ `c69fc4f6` (2026-10-16). The contract itself is MEASURED end to end (2026-10-16, all subject types and the refusals) |
| This file | Type-checks against the 0.13.21 packages |
| A live sign, encrypt and decrypt round | MEASURED on a local test stack (2026-10-13), using a sample app that makes these same calls: checks 1, 2, 3 and 6 below passed, with the contract's message on every ORK. Policy version 3 was accepted |
| Checks 4, 4a and 5 (subject; role removed) | MEASURED end to end by Sasha Le (2026-10-16): `User`, `Group`, realm-`Role` and client-`Role` (with `clientId`) policies, refusals included — not necessarily with this file |
| This file | **Not run**. It type-checks |
| The admin-policy endpoint named in `relationship.ts` | Returned the admin policy for an admin token on a local realm (2026-10-13). Not tested with a non-admin token |

## Common failures

| Symptom | Cause |
|---|---|
| Works for the admin, fails for the user | A `User` policy was built with the admin's key |
| `'…' group not found in doken.` | No `groups` claim (mapper missing, misnamed, or not in the access token), full-path mismatch, or the user signed in before joining |
| `Required parameter 'roles' is missing.` | `roles` was passed as an array; it is a JSON string |
| `Tags do not contain assignmentId.` | More than one tag, or the wrong one |
| `_tide_encryptor not found in list of roles.` | The policy is read-only |
| `'_tide_decryptor' role not found for this decryption request.` | A client role instead of a realm role, or the user has not signed in since the grant |
| Unknown contract at signing | The network does not have the contract. Ask the Tide team |
| `Could not reach enough VVK ORKs` after a request that should be refused | That is the refusal, not an outage. The contract's message is in the error's `cause` |
| The admin's grant (signing) does nothing; console `Error opening enclave of type: Popup` | The enclave pop-up was blocked. Allow pop-ups, and call `signRelationshipPolicy` straight from the click. canon `troubleshooting` T-27 (a visible notice and `registerPopupErrorCallback` need `@tidecloak/js` `0.14.41-staging`) |

## Do not

- Do not present a stored policy or a UI check as the authorisation for an API route.
- Do not decrypt on the server.
- Do not put `_tide_encryptor` or `_tide_decryptor` in the default roles.
- Do not give every policy both roles: choose per grant.
