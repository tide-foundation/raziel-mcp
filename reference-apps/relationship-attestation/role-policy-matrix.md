# Role and Policy Matrix — Relationship Attestation

## Roles

| Role | Kind | Who holds it | What it does | Enforced by |
|---|---|---|---|---|
| `tide-realm-admin` | client role on `realm-management` | the people who may grant records | approves each relationship policy in the enclave | the network, at policy signing |
| `_tide_decryptor` | **realm** role, name fixed | every user who may READ any record | necessary, not sufficient: the user also needs a policy for the record whose `roles` permits reading | the contract, on every decrypt |
| `_tide_encryptor` | **realm** role, name fixed | every user who may WRITE to any record | necessary, not sufficient: the user also needs a policy for the record whose `roles` permits writing | the contract, on every encrypt |
| `_tide_enabled` | realm default | everyone | Tide account | TideCloak |

A role alone opens nothing. A policy alone opens nothing. A user needs **both**, for the same
operation: the realm role, and a policy whose `roles` param names it — and must match the policy's
**subject**: be that user, be in that group, or hold that role.

## Subjects

| `subjectType` | `subjectId` | `clientId` | Matched against |
|---|---|---|---|
| `User` | the grantee's `tideuserkey` claim, verbatim | — | the caller's key |
| `Group` | the group, exactly as in the `groups` claim | — | the caller's `groups` claim (name mandated: `groups`) |
| `Role` | the role name | omit for a realm role | the caller's realm roles |
| `Role` | the role name | the client id | the caller's client roles of that client |

Membership of a `Group` or `Role` subject is itself access: on an IGA realm, adding a member or
granting the role is a governed change request. Review who may approve those.

Do **not** add `_tide_encryptor` or `_tide_decryptor` to the default-roles composite.

## Access levels

| Policy `roles` | User can | Typical use |
|---|---|---|
| `["_tide_decryptor"]` | read the record | a reviewer, an auditor |
| `["_tide_encryptor"]` | add to the record, not read it | a drop box, an intake form |
| `["_tide_encryptor","_tide_decryptor"]` | read and write | the assigned owner of the work |

## Policies

| Policy | Count | Signed by | Authorised by | Contract |
|---|---|---|---|---|
| Relationship policy | one per subject (user, group or role) and record | the network | a `tide-realm-admin` approving in the enclave, under the realm's admin policy | `RelationshipAttestation:1` (built in) |

No contract is written, compiled or deployed for this scenario.

## Who can do what

| Action | User with a matching policy and role | User with the role only | App server | Realm admin |
|---|---|---|---|---|
| Decrypt the record | yes | no | no | only with their own policy and role |
| Encrypt for the record | yes | no | no | only with their own policy and role |
| Grant a record | no | no | no | yes, by approving |
| Read ciphertext | yes | yes, if the API allows | yes | yes |

An admin can grant themselves a record. If that matters, raise the realm's admin threshold so one
admin cannot approve alone, and review who holds `tide-realm-admin`.

## Server-side authorisation still applies

| Route | Check on the server |
|---|---|
| store a signed policy | caller is an admin (token role), token and DPoP verified |
| fetch a policy | the policy names the caller |
| read or write ciphertext | token and DPoP verified; your own rules for who may see the row |

The contract protects the data. These checks protect the API. Neither replaces the other.
