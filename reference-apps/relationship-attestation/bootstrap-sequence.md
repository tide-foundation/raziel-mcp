# Bootstrap Sequence — Relationship Attestation

All steps must complete before the first record can be shared. There is **no contract to write,
compile or deploy**: the contract is built into the ORK.

> **⛔ Before Phase 1 — ask the user, and wait (AP-90).** Setting up the realm licenses it to an
> email address under Tide's Terms & Conditions (**https://tide.org/legal**). Ask: (1) *which email
> address should manage your Tide licence?* and (2) *do you agree to the Terms & Conditions at that
> link? (yes/no)*. Never invent the email, never accept for them, and stop if they decline. Pass the
> answers as `TIDE_LICENSE_EMAIL` and `TIDE_TERMS_ACCEPTED=yes`. Any init script you write must exit
> non-zero without both — the block to paste is in canon `tidecloak-bootstrap`.

## Phase 0: Confirm the network has the contract

0. `RelationshipAttestation:1` is new and is **not in every network**. Before building, tell the
   user to confirm with the Tide team (info@tide.org or Discord: https://discord.gg/XBMd9ny2q5) that
   the network their TideCloak uses has it. If it does not, stop here. Do **not** substitute a
   custom contract.

## Phase 1: TideCloak infrastructure

1. Ask local Docker or hosted (`tide_hosting`), then start TideCloak (`start-tidecloak-dev`).

## Phase 2: App, realm, client, mappers and the role

2. Start from a working app: `tide_scaffold` (`nextjs-customer-portal` has the server this needs:
   it stores ciphertext and signed policies).
3. Bootstrap the realm with the template's `npm run init`. It creates the realm and client, licenses
   it, enables IGA, and stops at the invite link.
4. Confirm the `tideUserKey` and `vuid` mappers are on the client (the pack's realm template has
   them). Without `tideuserkey` in the credential, no `User` policy can name a user.
4a. Confirm the **`groups`** mapper is on the client. The pack's realm templates declare it (claim
   name exactly `groups`, mandated; access token on; **full path on**), so it exists before IGA and
   the adopt-scan attests it with no approval. Every `Group` policy's `subjectId` is therefore the
   **full path**, e.g. `/clinic-a/nurses`. On a realm that did not come from a pack template, adding
   it now is a governed change request: approve it before relying on `Group` policies. Without the
   claim, every `Group` policy is refused with `'…' group not found in doken.`
5. The **realm** roles `_tide_encryptor` and `_tide_decryptor` ship in the pack's realm templates
   (declared before IGA, so the enable-IGA adopt-scan attests them; INFERRED from the measured
   `groups` mapper behaviour). On a realm made another way, create them. The names are fixed by the
   contract. They must be realm roles, not client roles. Do **not** put them in the default-roles
   composite: then every user would hold them and the role check would mean nothing.

## Phase 3: Approve initial change requests

6. Drain the bootstrap change requests with the loop in `canon/iga-change-requests-api.md`
   (it skips `DISABLE_IGA`, `DELETE_REALM` and `OFFBOARD_REALM`). Assert `PENDING` is 0.

## Phase 4: Admin identity and adapter

7. The user opens the **invite link** and links their Tide account. While they do, ask the two
   end-user questions: branding (`tide_branding`) and new-user details (`tide_onboarding`). AP-87.
8. Export the adapter (`data/tidecloak.json`). It carries `vendorId`, which is every policy's key id.
9. Grant `tide-realm-admin` **last**. Committing that grant flips the realm to multi-admin, after
   which governed changes, and every relationship policy, need an enclave approval.

## Phase 5: Users, groups and the roles

10. Each user who will be given records **signs in once**. Until they do they have no Tide key.
11. Grant `_tide_decryptor` to users who will read, `_tide_encryptor` to users who will write, both
    to users who do both. Each grant is a change request an admin
    approves. The user must sign in again afterwards: the role is read from their credential.
11a. For `Group` and `Role` subjects: create the groups and roles, and add the members (change
    requests). Members sign in again so the new `groups` / roles reach their credential.

## Phase 6: Wire the app

12. Copy the helper into the app:
    ```bash
    cp <pack>/templates/relationship-attestation/relationship.ts src/lib/tide/
    ```
13. Add a table for signed policies, keyed by subject and record:
    `(subject_type, subject_id, client_id, record_id, policy_b64, expires_at, granted_by, created_at)`,
    unique on `(subject_type, subject_id, client_id, record_id)`.
14. Add two server routes, both behind token and DPoP verification:
    - `POST` a signed policy — **admins only**; check the role on the server.
    - `GET` a policy for a record that applies to the caller — the `User` policy naming them, or a
      `Group`/`Role` policy whose subject is in their verified token.
15. Admin screen: pick a subject (a user, a group or a role), a record and the access (`read`,
    `write` or `read-write`), call `signRelationshipPolicy` — for a user, with the **grantee's**
    `tideuserkey` — approve in the enclave, store the result.
16. Record screen: fetch the caller's policy, then `encryptForRecord` / `decryptForRecord` with the
    record id as the only tag. Store ciphertext only.

## Phase 7: Prove it, in this order

17. As a granted user: encrypt, then decrypt. It round-trips.
18. Encrypt with a different tag. **It must be rejected.**
19. Encrypt with two tags. **It must be rejected.**
20. As a second user, load the first user's policy and encrypt. **It must be rejected.**
20a. With a `Group` policy: a group member encrypts and decrypts; a non-member is **rejected**
    (`'…' group not found in doken.`). Then remove the member, sign them in again, and confirm they
    are now rejected too.
21. Remove `_tide_decryptor` from the user, sign in again, decrypt. **It must be rejected.**
    Grant it back.
22. Sign a **read-only** policy (`access: "read"`) for a user who holds both roles, and encrypt with
    it. **It must be rejected.** The policy does not permit writing.
23. Run `tide_doctor`.

If 17 works but 18-22 are not rejected, stop: the contract in use is not the one described here.

## What costs an approval

| Action | Admin approval |
|---|---|
| Creating the two roles | one change request each |
| Granting a role to a user | one per user and role |
| Granting a subject a record | **one per subject and record**, in the enclave |
| Adding someone to a `Group`/`Role` subject | one change request (membership or role) |
| Encrypting or decrypting | none |
