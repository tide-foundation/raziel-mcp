# Anti-Patterns — Relationship Attestation

## AP-RA01: Writing a custom contract because the built-in one is missing

The network rejects policy signing with an unknown contract, so the agent writes its own.

**Why it is wrong**: deploying a custom contract is not self-service, and a hand-written copy is not
the reviewed one.
**Do instead**: stop and send the user to the Tide team.

## AP-RA02: Building the policy with the admin's key

The admin is logged in, so `tideuserkey` from the session goes into a `User` policy's `subjectId`.

**Symptom**: works for the admin, `subjectId does not match.` for the user.
**Do instead**: use the **grantee's** `tideuserkey`. The grantee must have signed in once.

## AP-RA03: More than one tag on an item

`tags: [recordId, "notes"]`.

**Symptom**: `Tags do not contain assignmentId.`
**Do instead**: exactly one tag, the record id. Keep field names in your own metadata.

## AP-RA04: Putting `_tide_encryptor` or `_tide_decryptor` in default roles

Every user then holds it.

**Why it is wrong**: the role check stops meaning anything; only the policy stands between a user
and a record.
**Do instead**: grant it per user, by change request.

## AP-RA05: Making it a client role

**Symptom**: `'_tide_decryptor' role not found for this decryption request.` although the admin
console shows the role.
**Do instead**: a **realm** role. The contract reads realm roles from the credential.

## AP-RA06: Treating "delete the policy row" as revocation

A user who kept the policy bytes can still use them.

**Do instead**: sign with a short expiry and re-grant; remove the role to cut a user off entirely.
Tell the user which guarantee they are getting.

## AP-RA07: Letting the server hand any policy to any caller

`GET /policies?user=…&record=…` with no check.

**Why it matters less than it looks, and still matters**: a policy only works for the user it names,
but it discloses who has access to what.
**Do instead**: return a policy only to the user it names, behind token and DPoP verification.

## AP-RA08: Letting anyone store a policy

A stored policy is only useful if the network signed it, so the route is left open.

**Why it is wrong**: it lets a caller overwrite a good policy with junk and lock a user out.
**Do instead**: admins only, checked on the server; verify the bytes parse and name the expected
user and record before storing.

## AP-RA09: Hard-coding the policy version

`version: "3"`.

**Symptom**: the SDK refuses to build the policy after an upgrade.
**Do instead**: `Models.Policy.latestVersion`.

## AP-RA10: Passing `roles` as an array

**Symptom**: `Required parameter 'roles' is missing.`
**Do instead**: a string holding JSON: `JSON.stringify(["_tide_encryptor", "_tide_decryptor"])`.

## AP-RA11: Re-encoding the user key

Converting `tideuserkey` between hex and base64 "to normalise it".

**Do instead**: copy the claim as-is.

## AP-RA12: Decrypting on the server

The server has no user credential and cannot satisfy the contract.

**Do instead**: decrypt in the user's browser. The server stores ciphertext.

## AP-RA13: Presenting the stored policy or a UI check as the authorisation for an API route

**Do instead**: verify the token and DPoP proof and check roles on the server for every route.

## AP-RA14: Claiming it was tested end to end

The pack's live round was on a **local test stack**, and did not exercise the caller checks (see
scenario.md, Status). It says nothing about your network or your app.

**Do instead**: run Phase 7 of the bootstrap sequence and report what the network actually returned.

## AP-RA15: One admin approving their own access unnoticed

**Do instead**: raise the admin threshold where self-granting matters, and log every grant with who
approved it.

## AP-RA16: Giving every policy both roles

`roles: ["_tide_encryptor","_tide_decryptor"]` for everyone, because it always works.

**Why it is wrong**: a reviewer who only needs to read can then also write to the record.
**Do instead**: choose per grant. Read-only is `["_tide_decryptor"]`.

## AP-RA17: Expecting the realm role to be enough for an operation the policy does not grant

The user holds `_tide_encryptor`, the policy says `["_tide_decryptor"]`, and encryption fails.

**Symptom**: `_tide_encryptor not found in list of roles.`
**Do instead**: this is the contract working. Sign a policy that grants writing if the user should write.

## AP-RA18: Treating a contract refusal as a network outage

A refused request surfaces as `TIDE-TIDEJS-NET-THRESHOLD_FAILURE: Could not reach enough VVK ORKs`,
so the app retries, or shows "service unavailable".

**Why it is wrong**: every ORK answered; they all said no. Retrying cannot succeed, and the user is
told the wrong thing.
**Do instead**: read the error's `cause` and per-ORK details. If they carry a contract message
(`Tags do not contain assignmentId.`, `… not found in list of roles.`, `subjectId does not match.`,
`… group not found in doken.`, `… role not found in doken.`),
show "you do not have access to this record" and do not retry.

## AP-RA19: A `Group` subject without the `groups` claim, or in the wrong form

The policy names group `team-a`, but the claim emits the full path `/team-a` (the pack's realm
templates turn full path on), or the realm did not come from a pack template and has no `groups`
mapper, or names the claim something else.

**Symptom**: `'team-a' group not found in doken.` for every member.
**Do instead**: use the full path as `subjectId`. Keep the pack template's mapper (claim name exactly
**`groups`**, mandated). If you must add it to an existing realm, do it before IGA, or approve its
change request. Members sign in again after any membership change.

## AP-RA20: One `User` policy per person when a group or role is the real subject

Ten assessors on a case get ten policies, each an admin approval; the eleventh waits for an admin.

**Do instead**: one `Group` (or `Role`) policy for the record, and manage who is in the group. Keep
`User` subjects for the genuinely one-person relationship.

## AP-RA21: Treating group membership as harmless

Under a `Group` or `Role` subject, adding someone to the group or giving them the role **is** giving
them the record.

**Do instead**: keep IGA on so membership changes are governed, and review who may approve them.
