# Bootstrap Sequence — Attested Provenance Registry

All steps must complete before users can attest anything. **Order matters**, and phase 5 is the one
that costs a human enclave approval — everything catchable before it should be caught before it.

## Phase 1: TideCloak infrastructure

1. **Start TideCloak**
   - Use `tideorg/tidecloak-dev:latest` — despite the `-dev` suffix this IS the production image and
     the only supported one. Do not append `start-dev` (AP-39).
   - Mount `./data`, never the project root (AP-34).
   - Wait for readiness: `curl http://localhost:8080/health/ready` returns 200.

2. **Obtain a bootstrap admin token**
   - `POST /realms/master/protocol/openid-connect/token` with the bootstrap admin credentials.

## Phase 2: Realm, client and mappers

3. **Import the realm template**
   - `POST /admin/realms` with `realm.json`.
   - Must declare: realm name, the OIDC client, `_tide_enabled`, the `default-roles-<realm>`
     composite, **the client roles**, and **the protocol mappers**.
   - The composite must include the **attest role** as a client role, so every user can attest:
     ```json
     "composites": { "realm": ["_tide_enabled", "appUser"],
                     "client": { "<CLIENT>": ["<attest-role>"] } }
     ```
   - The **admin role** is declared but deliberately left OUT of the composite.
   - Client attributes must include `"dpop.bound.access.tokens": "true"`.

4. **Declare the `vuid` protocol mapper** — do not skip this
   - `oidc-usermodel-attribute-mapper`, `user.attribute: vuid`, `claim.name: vuid`, with
     `access.token.claim`, `id.token.claim`, `userinfo.token.claim`,
     `introspection.token.claim` and `lightweight.claim` all `true`.
   - **Why it is load-bearing**: the contract binds authorship to the vuid, and the browser must read
     the claim to build the envelope. Without the mapper the claim is absent, the envelope cannot be
     built, and the fail-closed guard refuses every attestation. The failure is correct and
     completely opaque unless you know this.
   - Verify after login: the access token must contain a non-empty `vuid`.

5. **License the realm**
   - `POST /admin/realms/{realm}/vendorResources/setUpTideRealm`
   - `Content-Type: application/x-www-form-urlencoded`, body `email=admin@example.com`.
   - Returns licensing JSON as `text/plain`.

6. **Enable IGA**
   - `POST /admin/realms/{realm}/tide-admin/toggle-iga` with **form-encoded** `isIGAEnabled=true`.
     ⚠️ The endpoint reads the FORM parameter. A JSON body is accepted, parsed by nothing, and the
     missing parameter **fails open to `true`** — so `{"enabled":false}` ENABLES IGA. Always
     form-encode and assert the response.
   - **Assert Tide mode** rather than stamping it: `setUpTideRealm` sets `iga.attestor=tide` on
     current builds, so verify it instead of assuming. Tide vs Tideless is the difference between
     approvals being cryptographically sealed and enforced by host-controlled server logic (GAP-065).
     If absent, stamp it (GET then PUT `/admin/realms/{realm}`) and re-assert.
     Full call + assertions: `canon/tidecloak-bootstrap.md` → toggle-iga.
   - Must happen **after** licensing.

## Phase 3: Approve initial change requests

7. **Approve and commit the pending change requests**
   - Realm import creates draft change requests for client/role mutations (each mutating write
     returns 202).
   - List: `GET /admin/realms/{realm}/iga/change-requests?status=PENDING`
   - Per id: `POST .../{id}/authorize` (body `{}`) then `POST .../{id}/commit`.
   - `409` = four-eyes (a different admin must authorize). `412` = under threshold or unmet
     dependency.
   - Full surface: [canon/iga-change-requests-api.md](../../canon/iga-change-requests-api.md).
   - **Tideless vs Tide**: with `iga.attestor=simple`/unset this loop is fully scriptable. In Tide
     mode, multi-admin approve is enclave-gated and needs a human.

## Phase 4: Admin identity and adapter

8. **Create the admin user and link a Tide account**
   - Create the user, generate an account-linking invite, open it, complete linking. The bootstrap
     script should wait for completion rather than racing it.

9. **Grant the admin roles**
   - Grant the app's **admin role** (client role on the app client) to the admin user.
   - Grant `tide-realm-admin` (client role on `realm-management`).
   - Each grant is a change request → authorize → commit.

10. **Export the adapter JSON**
    - Provider id `keycloak-oidc-keycloak-json`.
    - Must contain `jwk`, `vendorId`, `homeOrkUrl`, `client-origin-auth-*`. A missing `jwk` means IGA
      was not enabled before export — re-export (AP-13).
    - Write to `data/tidecloak.json`. Do not duplicate its values into `NEXT_PUBLIC_*` env vars
      (AP-38).

11. **Copy the DPoP relay asset and wire its route**
    - Copy the **current** `tide_dpop_auth.html` into `public/`. Verify it:
      ```bash
      scripts/check-dpop-asset.sh .
      ```
    - Add the `/tide_dpop/:path*` → `/tide_dpop_auth.html` rewrite, and that path's CSP
      (`script-src 'unsafe-inline'`, `Allow-CSP-From: *`) **ordered after** any generic CSP rule.
    - A stale copy posts to `window.parent`, which is self-referential in a popup, and reports
      `Popup DPoP verification failed to load` for a page that returned 200 (AP-62, GAP-068).

## Phase 5: The custom contract and policy — the expensive phase

Everything from step 14 onward costs an operator approval to retry. Do 12 and 13 first.

12. **Compile the contract locally**
    ```bash
    cd templates/forseti-compile-harness
    ./check.sh ../../forseti/<YourContract>.cs
    ```
    - Catches the disjoint-context error (`ctx.Data` in `ValidateExecutor` →
      `CS1061`), blocked namespaces, and a missing `IAccessPolicy`.
    - Contracts are compiled **by the ORK at request time**, so without this a typo surfaces as
      `VmHost.CompileFailed` after an approval is spent (AP-67).

13. **Run the pre-flight checklist** — all client-side, no network
    - [ ] contract compiles locally
    - [ ] `contractId` is **UPPERCASE** SHA-512, `/^[0-9A-F]{128}$/`
    - [ ] `modelId` matches `/^BasicCustom<.+>:BasicCustom<.+>$/`
    - [ ] `request.id() === policy.modelIds[0]`
    - [ ] draft's `GetValue(1).GetValue(0)` decodes to `"forseti"`
    - [ ] all five Policy fields present: `version`, `contractId`, `modelId`, `keyId`, `params`
    - [ ] admin policy found by name **`tide-realm-admin`**, no `?? policies[0]` fallback
    - [ ] the contract compares the **vuid**, not the JWT subject
    - [ ] a test pins the wire offsets to the contract's constants
    - Full list: [playbooks/deploy-forseti-policy.md](../../playbooks/deploy-forseti-policy.md).

14. **Upload the contract source** (scriptable — no enclave)
    - `POST /admin/realms/{realm}/iga/forseti-contracts` with `{ "contractCode": "...", "name": "..." }`.
    - Requires `manage-realm`. **Do not** use the response's `contractHash` as the policy's
      `contractId` — that is SHA-256, an internal dedup key. The policy needs **SHA-512 uppercase**.

15. **Mint the admin token into the shell, and start the dev server FROM that shell**
    ```bash
    eval "$(bash scripts/admin-token.sh)"
    npm run dev
    ```
    - The realm admin policy can only be read with an admin bearer token, kept server-side (AP-41).
      It arrives via an **exported shell variable that does not survive a server restart** — and
      restarting the dev server is routine.
    - Started any other way, the admin-policy route returns **503**. Check for the token *before*
      building a policy, and surface the server's actual error body rather than a generic message.

16. **Deploy and sign the policy** — one browser enclave approval
    - Sign in as the admin, open the app's policy-deployment page.
    - The page fetches the admin policy (`tide-realm-admin`), builds the Policy with all five
      fields, builds the three-level transport, submits, and prompts for enclave approval.
    - On success, store `policy.toBytes()` **with the signature attached** — not the raw signature
      (AP-55), not `request.encode()` (AP-57).
    - Store it as deployment state beside `tidecloak.json`, not in the application database, so a DB
      reset does not cost a fresh approval.

17. **Verify the deployment**
    - Deployed policy's `contractId` equals a fresh SHA-512 of the contract file.
    - Add that comparison as a boot or CI check — it turns "signing mysteriously broke" into "you
      edited the contract and did not redeploy", and catches the reverse case where the contract was
      edited *after* deployment.

## Phase 6: Verification surface

18. **Serve the realm VVK publicly**
    - Expose `jwk.keys` from the adapter on an unauthenticated, CORS-open route.
    - **State the weakness in the response body**: this copy comes from the issuer. Tell verifiers to
      pin on first use and corroborate against another adapter holder. The realm VVK is not
      published unauthenticated by TideCloak (GAP-071).
    - Do **not** point verifiers at the OIDC JWKS — it returns 200 with a valid key set containing
      the wrong key.

19. **Ship a standalone verifier**
    - No dependency on the app's codebase, so it can be read in full before being run.
    - Implements all six checks, reports **SKIPPED** separately from **PASS**, and states plainly
      that check 6 (key → human) cannot be done in software.
    - Do **not** ship an issuer-hosted `/verify` returning VALID/INVALID as the third-party story:
      anyone able to forge the attestation can forge the verdict (AP-68).

20. **Turn on verify-on-read**
    - Re-verify each attestation when displayed: envelope parses and header agrees with JSON;
      signature verifies against the VVK; **and the signed claim still matches the DB rows being
      rendered**. The third check is what makes database tampering visible.

## Phase 7: Prove the properties actually hold

A property that has never failed when it should is not known to work.

21. **Prove the skew check rejects a stale timestamp**
    - Temporarily pass a timestamp older than `MaxClockSkewSeconds` and confirm the ORKs **deny**.
    - Expected: a deny naming the skew. If it signs, the contract is not reading the offset you
      think it is.

22. **Prove identity binding rejects a mismatched signer**
    - Build an envelope whose header vuid is not the signer's, and confirm the network refuses.
    - This is the difference between "somebody with the role signed" and "this person signed".

23. **Prove tampering is detected**
    - Mutate stored rows — rewrite the creator, backdate the date, repoint the content hash, edit the
      signed bytes, forge the signature, delete it — and assert a mismatch each time, then revert.
    - The reference app automates this (`npm run tamper-test`). Without it, check 3 of verify-on-read
      is untested and DB tampering could sit next to a green tick.

## Completion gate

Users can attest only once **all** of these hold:

- [ ] realm licensed, IGA enabled, initial change requests committed
- [ ] `vuid` claim present and non-empty in a real access token
- [ ] attest role reaches ordinary users via the default-roles composite
- [ ] DPoP asset present and known-good, route and CSP wired
- [ ] contract uploaded; policy deployed, signed and stored
- [ ] deployed `contractId` matches a fresh hash of the contract source
- [ ] VVK served publicly with its caveat; standalone verifier shipped
- [ ] skew rejection, identity-binding rejection and tamper detection each demonstrated

Until the policy is deployed, the app should say so plainly on the attest path rather than failing
at the signature.
