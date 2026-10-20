# Relationship Attestation

## What this is

An app where **a named user, the members of a group, or the holders of a role can open one record's
encrypted data, and the network enforces it**.

*Dr Lee is assigned to assessment 42* is normally a row in a table. Whoever can write that row
decides who reads the assessment. Here the relationship is a **policy** a realm admin approves once.
The ORK network then releases a decryption only when all of these hold:

- the data is tagged with that assessment's id, and with nothing else
- the caller is the **subject** the policy names: that user, a member of that group, or a holder of
  that role
- the caller holds the realm role for the operation: `_tide_encryptor` to write, `_tide_decryptor`
  to read — and the policy grants that same operation

A compromised app server cannot read the data and cannot add a reader. It has no key, and it cannot
get a policy signed without an admin's approval.

## Status — read before building

| Claim | Status |
|---|---|
| What the contract checks (below) | VERIFIED — read from the contract source on ORK `main` @ `c69fc4f6` (2026-10-16; subject types). The ORK repo has no unit tests for it; the behaviour below is MEASURED end to end (next rows) |
| The contract is on ORK `main` | **Yes** — since 2026-10-16 (`c69fc4f6`), with `groups` in the doken (`Doken.GroupExists`, exact match). A network on an older ORK build does not have it |
| The contract is built into the ORK and needs no source deployed | VERIFIED — ORK source |
| The client calls in `templates/relationship-attestation` | MEASURED against **revision 2** — the same calls ran end to end in a sample app on a local stack (2026-10-13). The template is now written for revision 3 and type-checks; it was not the file that ran |
| A live sign, encrypt and decrypt round | MEASURED against **revision 2** on a **local test stack** (five ORKs, 2026-10-13): three policies signed with no contract source attached; encrypt and decrypt round-tripped; wrong tag, two tags, read-only-policy encrypt and write-only-policy decrypt were all refused with the contract's own message on every ORK; data encrypted under one policy decrypted under another for the same record. The tag and `roles` checks are unchanged in revision 3 |
| The checks on the **caller** (subject; role removed) | MEASURED end to end by Sasha Le (2026-10-16): `User`, `Group`, realm-`Role` and client-`Role` (with `clientId`) policies all worked, and the refusals were checked: someone who is not the subject, a missing `_tide_decryptor`, and a wrong or extra tag were all refused |
| Your network has the contract | **ASSUMED** for networks updated since 2026-10-16. On an older network confirm with the Tide team (info@tide.org or Discord: https://discord.gg/XBMd9ny2q5) |

If the network does not have the contract, policy signing fails. Do not work around that by writing
a custom contract: ask the Tide team.

## The contract: `RelationshipAttestation:1`

It is a **default contract**: compiled into the ORK, named by id. You write no C#, compile nothing
and deploy nothing. You sign **policies** that name it.

A policy that uses it must be:

| Field | Value |
|---|---|
| Contract id | `RelationshipAttestation:1` |
| Model ids | `PolicyEnabledEncryption:1`, `PolicyEnabledDecryption:1` |
| Approval | `IMPLICIT` |
| Execution | `PRIVATE` |
| Key id | the realm's `vendorId` |
| Param `subjectType` | `User`, `Group` or `Role` (case-insensitive): who the policy is for |
| Param `subjectId` | `User`: the user's `tideuserkey` claim, copied as-is. `Group`: the group exactly as it appears in the `groups` claim. `Role`: the role name |
| Param `clientId` | optional, `Role` only: the role is a **client** role of this client. Omit it for a realm role |
| Param `assignmentId` | the record's id |
| Param `roles` | a JSON array **string** saying what this policy permits: `_tide_decryptor` to read, `_tide_encryptor` to write, or both, e.g. `["_tide_encryptor","_tide_decryptor"]` |

All params are strings. A missing or non-string param is rejected, and so is an empty `subjectId`
or a `subjectType` other than the three.

### What it enforces, on every encrypt and decrypt

| Check | Rejected when |
|---|---|
| Request type | it is anything but a policy-enabled encryption or decryption |
| Execution | the policy is not `PRIVATE` |
| Items | the request has no items |
| Tags present | any item has no tag |
| Tags match | any tag on any item differs from `assignmentId` |
| Who (`User`) | the caller's key is not the policy's `subjectId` |
| Who (`Group`) | the caller's credential has no `groups` entry equal to `subjectId` |
| Who (`Role`) | the caller lacks role `subjectId` — a realm role, or with `clientId` a client role of that client |
| Policy permits it | the policy's `roles` lacks `_tide_encryptor` (on encrypt) or `_tide_decryptor` (on decrypt) |
| Caller's role | the caller does not hold that same realm role |
| Expiry | the policy has expired (checked by the network before the contract runs) |

Two consequences to design around:

- **One tag per item, and it is the record id.** An item tagged `["assessment-42", "notes"]` is
  rejected. Put the record id in the tag and anything else in your own metadata.
- **The names are fixed.** The params are `subjectId`, `subjectType`, `assignmentId`, `roles` and
  the optional `clientId`; the realm roles are `_tide_encryptor` and `_tide_decryptor`. The "assignment" can be to any record — a case,
  an assessment, a patient file, a document — but the param is still called `assignmentId`.
- **Read and write are separate.** A policy whose `roles` is `["_tide_decryptor"]` is read-only: the
  user can decrypt the record and cannot add to it. `["_tide_encryptor"]` alone is write-only (a
  drop box). The user must also hold the matching realm role.

## One policy per subject and record

A policy binds **one subject** to **one record**. Choose the subject type by who should get in:

| Subject type | One policy covers | Granting the next person | Use it when |
|---|---|---|---|
| `User` | exactly one user | a new policy (an admin approval) | a single named person, e.g. the assigned assessor |
| `Group` | every member of the group | add them to the group | a team or care team that changes over time |
| `Role` | everyone holding the role | give them the role | a function, e.g. every `case-reviewer` |

Ten users on one assessment is ten `User` policies, or **one** `Group` policy for a group those ten
belong to.

Each policy is signed by the network after a **`tide-realm-admin` approves it in the enclave**.
That approval is the grant of the **record to the subject**. Under `Group` and `Role`, who is *in*
the subject is decided by group membership and role assignment — on an IGA realm those are governed
change requests, so they are approved too. Whoever controls membership controls access: say so.

Plan for the volume. If hundreds of per-person grants a day is normal, use `Group` or `Role`
subjects so a grant is a membership change, not a new policy.

## When to use this scenario

Use when the user describes:
- "only the clinician **assigned to** this assessment can read it"
- "only the **care team** for this patient" (a group) or "every **case reviewer**" (a role) can read it
- per-record or per-case access to encrypted data, need-to-know, a caseload
- access that must hold "even if the server is compromised"

Do NOT use when:
- a team-shared credential vault with org owners and members — `organisation-password-manager`
  (which can itself use this contract per vault; see its "Built-in contract" section)
- only the person who encrypted it decrypts — self-encryption (`nextjs-e2ee-vault` template)
- the fact gates no decryption and your server just needs to rely on it later (membership of a
  group, consent, a verification) — `attestation`
- the claim is about content, handed to a third party — `attested-provenance-registry`

### The discriminating question

**Must access to one record's data be limited to a named user, group or role, enforced at
decryption?** Yes → this scenario.

## Other scenarios that map onto this one

The "record" is whatever the relationship is with. The names in the policy do not change.

| Need | Record id | Data tagged with it |
|---|---|---|
| A user is assigned to a case or assessment | the case id | the case's notes and files |
| A user is a member of a group | the group's own record id | the group's shared content — subject `Group` |
| A document is shared with a user | the document id | the document |
| A member may open a vault | the vault or collection id | every entry in it |

In all of them the grant is made by a **realm admin**. If the grant must be made by an owner or by
the user themselves, or if nothing is encrypted, this contract does not fit: see `attestation`.

## Runtime flow

```
GRANT (once per user and record)
1. ADMIN'S BROWSER  builds the policy: the subject (user key, group or role), the record id, the access
2. ADMIN'S BROWSER  asks the network to sign it; the admin approves in the Tide enclave
3. SERVER           stores the signed policy bytes, keyed by user and record

USE (every read and write)
4. USER'S BROWSER   fetches its signed policy for that record from the server
5. USER'S BROWSER   encrypt([{ data, tags: [recordId] }], policy)   -> ciphertext
                    decrypt([{ encrypted, tags: [recordId] }], policy) -> plaintext
                    the contract runs on every ORK each time
6. SERVER           stores and returns ciphertext only. It never sees plaintext.
```

The server still protects its own API: verify the token and DPoP proof on every route
(`verify-jwt-server-side`). The contract protects the data; it does not protect your endpoints.

## Ending a relationship

There are three levers. Know what each one does.

| Lever | Effect | Limit |
|---|---|---|
| Delete the stored policy | the app stops handing it out | a user who kept a copy can still use it |
| Remove the user from the policy's **group**, or take the **role** (`Group`/`Role` subjects) | that user stops passing the subject check for every record granted to that group or role | takes effect when their credential next carries the change (sign-in or token refresh). INFERRED |
| Remove `_tide_decryptor` (and `_tide_encryptor`) from the user | every policy for that user stops reading (and writing) | it ends ALL of that user's records, not one |
| Sign policies with an expiry | access ends by itself | until then it works; re-grant to extend |

For one record and one `User` subject, there is no instant, certain revocation: use a **short
expiry** and re-grant. If per-record revocation matters, grant the record to a **group made for it**
and remove members from the group. Tell the user which guarantee they get.

## What this does not give you

- **It is not instant per-record revocation.** See above.
- **It does not hide who has access.** The policy names the user's key and the record id in clear.
- **It does not stop the user sharing the plaintext** once they have decrypted it.
- **It needs a browser and a logged-in user.** A background job cannot decrypt: it has no credential.
- **It does not replace API authorisation.** UI checks and stored policies are not protection for
  your routes.
- **Role removal is coarse.** The two realm roles cover every record a user has.
- **Groups need the `groups` claim.** A `Group` subject only works if the access token carries a
  claim named exactly **`groups`** (a JSON array). That name is mandated by Tide. The value must
  equal `subjectId` character for character. The pack's realm templates turn *full group path* on,
  so `subjectId` is `/clinic/team-a`, never `team-a`.

## What must exist before first use

1. A realm that is bootstrapped, licensed, with IGA on, and a `tide-realm-admin` who can approve
2. Realm roles `_tide_encryptor` and `_tide_decryptor`, granted to each user according to whether
   they will write, read or both
3. The `tideUserKey` and `vuid` mappers on the client, so the credential carries the user's key
3a. For `Group` subjects: the **`groups`** mapper on the client — shipped in the pack's realm
    templates (claim name `groups`, access token, full path on), so it is attested when IGA is
    enabled. `subjectId` is the full path, e.g. `/clinic-a/nurses`
4. Each user has signed in once (no Tide account, no key to name in a policy)
5. A table of signed policies keyed by user and record
6. A network that has the contract (see Status)

## Key diagnostics

| Symptom | Cause | Fix |
|---|---|---|
| Policy signing fails with an unknown contract | The network's ORKs do not have the contract | Stop. Ask the Tide team. Do not substitute a custom contract |
| `subjectId does not match. … <> …` | `User` subject: the caller is not the user the policy names | Fetch the policy for the logged-in user, or use a `Group`/`Role` subject |
| `'…' group not found in doken.` | `Group` subject: the caller's credential has no matching `groups` entry | Add the `groups` mapper (claim name exactly `groups`, access token on); match the full-path setting; add the user to the group; sign in again |
| `'…' role not found in doken.` / `'…' role under … not found in doken.` | `Role` subject: the caller lacks the role (realm, or client role of `clientId`) | Grant the role; set `clientId` only for a client role; sign in again |
| `Parameter 'subjectType' must be User, Group, or Role.` | `subjectType` missing or misspelled | One of `User`, `Group`, `Role` |
| `'_tide_decryptor' role not found for this decryption request.` (or `'_tide_encryptor' … encryption request.`) | The user lacks that realm role, or their session predates the grant | Grant the realm role (a change request), then have the user sign in again |
| `_tide_decryptor not found in list of roles.` (or `_tide_encryptor …`) | The **policy** does not permit that operation: its `roles` param lacks it | Sign a policy whose `roles` includes it. A read-only policy cannot encrypt |
| `Tags do not contain assignmentId.` | A tag differs from the policy's `assignmentId` | Tag every item with exactly the record id, and nothing else |
| `Every item must be tagged with the assignmentId.` | An item has no tags | Add the record id as the tag |
| `Required parameter '…' is missing.` | A param is absent or not a string | All params are strings; `roles` is a JSON array written as a string |
| Decrypt fails after a successful encrypt | Different tags on decrypt | Decrypt with the same single tag used to encrypt |
| The client refuses to build the policy (version) | The SDK only writes its own latest policy version | Read `Models.Policy.latestVersion`; never hard-code it |
| `TIDE-TIDEJS-NET-THRESHOLD_FAILURE: Could not reach enough VVK ORKs (got 0 of N required, …)` right after a request the contract should refuse | That **is** the refusal. Every ORK answered with an error, and the SDK reports it as a reachability failure (MEASURED) | Read the error's `cause` and per-ORK detail lines: the contract's message is there. Do not retry and do not treat it as an outage |
| Works for the admin, fails for everyone else | A `User` policy was built with the admin's own key | Build it with the **grantee's** `tideuserkey` |

## Reference implementation

`templates/relationship-attestation/`:

| File | What it is |
|---|---|
| `relationship.ts` | `buildRelationshipPolicy`, `signRelationshipPolicy` (admin's browser; `subject: { type, id, clientId? }`, `access: "read" | "write" | "read-write"`), `encryptForRecord`, `decryptForRecord`, `readSession` |
| `README.md` | Wiring, what was and was not tested, storage shape |
