# Bootstrap Sequence — Attestation

All steps must complete before the first attestation can be made. **Order matters**, and Phase 5
is the one that costs an admin approval — catch everything catchable before it.

> **⛔ Before Phase 1 — ask the user, and wait (AP-90).** Setting up the realm licenses it to an
> email address under Tide's Terms & Conditions (**https://tide.org/legal**). Ask: (1) *which email
> address should manage your Tide licence?* and (2) *do you agree to the Terms & Conditions at that
> link? (yes/no)*. Never invent the email, never accept for them, and stop if they decline. Pass the
> answers as `TIDE_LICENSE_EMAIL` and `TIDE_TERMS_ACCEPTED=yes`. Any init script you write must exit
> non-zero without both — the block to paste is in canon `tidecloak-bootstrap`.

## Phase 0: Check the built-in contract first

0. Go through the "Built-in contract first" table in `scenario.md`. If every fact the app needs is
   an **admin-granted relationship between a user, group or role and one record** (assigned; member-of or
   shared-with where a realm admin grants), do **not** follow Phase 5 here. Follow the bootstrap of
   `relationship-attestation` instead: it has no contract to write or deploy, and its roles are the
   realm roles `_tide_decryptor` and `_tide_encryptor`.
   Use the sequence below only for the rows the built-in contract cannot cover (consent, acceptance,
   owner-issued, value-carrying). An app can need both.

## Phase 1: TideCloak infrastructure

1. Ask local Docker or hosted (`tide_hosting`), then start TideCloak (`start-tidecloak-dev`).
   - Use `tideorg/tidecloak-dev:latest` — it is wired to the production Tide network (ork1, 14-of-20), though it is a development build of the server.

## Phase 2: App, realm, client and mappers

2. Start from a working app: `tide_scaffold` (the `nextjs-customer-portal` template has a server,
   which this scenario needs: the server builds the statement and verifies the signature).
3. Bootstrap the realm with the template's `npm run init`. It creates the realm and client, licenses
   it, enables IGA, and stops at the invite link.
4. Confirm the `vuid` and `tideUserKey` mappers are on the client (the pack's realm template has
   them). Without `vuid` no statement can name anybody.
5. For each `role` rule you will mint: create the client role it names as `IssuerRole` (for example
   `team:manage`, `compliance:verify`). Do **not** put it in the default-roles composite.
   `self` and `owner` rules need no role.

## Phase 3: Approve initial change requests

6. Drain the bootstrap change requests with the loop in `canon/iga-change-requests-api.md`
   (it skips `DISABLE_IGA`, `DELETE_REALM` and `OFFBOARD_REALM`). Assert `PENDING` is 0.

## Phase 4: Admin identity and adapter

7. The user opens the **invite link** and links their Tide account. While they do, ask the two
   end-user questions: branding (`tide_branding`) and new-user details (`tide_onboarding`). AP-87.
8. Export the adapter (`data/tidecloak.json`). Its `jwk.keys` is the realm's Ed25519 key — the key
   `verifyAttestation` checks signatures against. It is **not** in the OIDC JWKS.
9. Grant `tide-realm-admin` **last**. Committing that grant flips the realm to multi-admin, after
   which governed changes need an enclave approval.

## Phase 5: The contract and the signing rules — the expensive phase

Decide the **claims and their modes first** (scenario.md, "The catalogue"). Steps 10-12 are done
once per realm; steps 13-16 once **per rule**. Get the contract right before any of it: every edit
changes its id, and every edit means minting and signing every rule again.

10. Copy the contract and helpers into the app:
    ```bash
    cp <pack>/templates/attestation/AttestationContract.cs forseti/
    cp <pack>/templates/attestation/attestation.ts         src/lib/tide/
    cp <pack>/templates/attestation/mint-rule.mjs          scripts/
    ```
11. **Store the contract source in the realm.** This does not put it on the network; it lets the
    realm attach it to the signing round.

> _Withheld: uploading a custom Forseti contract is done by the Tide team (experimental, test networks only). Do not reconstruct this step._

    The reply's `contractHash` is a **SHA-256** of what the realm received. Compare it with
    `sha256sum forseti/AttestationContract.cs`. It is **not** the contract id: the id a policy names
    is the **SHA-512**, upper-case hex.
12. **Read the realm's key id.** A rule naming any other key can never be signed.
    ```bash
    VVK_ID=$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM/components" -H "Authorization: Bearer $(get_token)" \
      | jq -r '.[] | select(.providerId=="tide-vendor-key") | .config.vvkId[0] // empty')
    [ -n "$VVK_ID" ] || { echo "no tide-vendor-key: run setUpTideRealm first" >&2; exit 1; }
    ```
13. **Mint a rule.** One per kind of issuer. Run from the app directory so the policy version comes
    from the installed SDK.
    ```bash
    # things people attest about what they own, e.g. a close-friends list
    node scripts/mint-rule.mjs --contract forseti/AttestationContract.cs \
      --key-id "$VVK_ID" --resource "$CLIENT_NAME" --claims member-of,shared-with --mode owner

    # things people attest about themselves:        --claims consented --mode self
    # things an authorised person attests:          --claims verified  --mode role --role compliance:verify
    # add --allow-expiry if attestations under the rule may expire
    ```
    It prints `CONTRACT_ID`, `POLICY_VERSION` and `RULE` (base64, already wrapped for the realm).
14. **Ask the realm to sign it.** `OBSERVED_PATTERN` (the production exemplar's deploy script):
    ```bash
    curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM/iga/jit-policies" \
      -H "Authorization: Bearer $(get_token)" -H "Content-Type: application/json" \
      -d "$(jq -n --arg n "attest-owner-${CONTRACT_ID:0:16}" --arg p "$RULE" '{name: $n, policy: $p}')"
    ```
    **A 2xx here means captured, not signed.** The realm raises a change request.
15. **Approve that change request.** On a multi-admin realm this is the enclave: an admin signs it in
    their browser. Approving is what runs the signing round, and the round is what carries the
    contract to the ORKs.
    - A policy carrying a contract waits for **every** ORK, not a quorum. If one is unreachable the
      round fails. **Sign again until it succeeds**: a partial round leaves ORKs that will refuse
      later requests, which looks like an intermittent fault.
16. **Confirm the realm holds it signed**, and read it back for the app:
    ```bash
    curl -s "$TIDECLOAK_URL/admin/realms/$REALM/iga/role-policies/name/attest-owner-${CONTRACT_ID:0:16}" \
      -H "Authorization: Bearer $(get_token)" | jq '{name, signed: (.policySig != null)}'
    ```

## Phase 6: The app

17. Table, one row per fact: the statement's fields (`claim`, `issuer`, `subject`, and whichever of
    `object`, `owner`, `value`, `expiry` it uses), `signature`, `policy_contract_id`,
    `policy_key_id`. No column for the signed bytes.
18. Server route **prepare**: check the caller may do this, write the row, build the statement with
    `buildAttestation(readSigningRule(rule), resource, row)` and return `wrapForEnclave(...)`
    (base64) with the signed rule **for that claim's mode**.
19. Browser: `signAttestation(unsignedPolicy, signingRule)` → signature → POST it back.
20. Server route **record**: **rebuild** the statement from the row (never from what the browser
    sent), `verifyAttestation(...)`, and store the signature only if it verifies.
21. **Every decision that relies on the fact** calls `verifyAttestation` on the row. Find every place
    the app decides "is X in this group / verified / consented" and route it through that function.

## Phase 7: Prove the properties actually hold

Do each of these by hand, once. The happy path alone proves nothing.

- [ ] Insert a row directly in the database with no signature → the app treats the fact as **not true**
- [ ] Copy a valid signature onto a row for a different subject → **not true**
- [ ] Change `object` or `value` on a signed row → **not true**
- [ ] `self` rule: try to attest on behalf of someone else → the network refuses
      (`under a self rule you can only attest about yourself`)
- [ ] `owner` rule: as user B, attest about user A's group → the network refuses
      (`only the owner can attest about what they own`)
- [ ] `role` rule: as a user without `IssuerRole` → the network refuses
- [ ] Use a rule for a claim type it does not list → the network refuses
- [ ] Withdraw a fact, then confirm it is gone — and write down that restoring the old signature
      would bring it back (see scenario.md, "What this does not give you")

## Completion gate

- [ ] `tide_doctor` reports `RESULT: OK`, including with `--url`
- [ ] Every rule reads back `signed: true`
- [ ] A fact attested in the UI shows as signed, and survives a server restart
- [ ] Every Phase 7 check behaved as stated
- [ ] The user has been told the limits: revocation and time are not attested, the subject's
      agreement is proved only in `self` mode, and a background job cannot attest
