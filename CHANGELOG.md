# Changelog

All notable changes to `@tideorg/mcp` (the Tide Agent Pack) are documented here.

## 1.9.34 — Security: clear every advisory and upgrade the toolchain

No behaviour change — this is a dependency and tooling release. `npm audit` now
reports **0 vulnerabilities**.

- **zod 3.25 → 4.6.7** — fixes the HIGH advisory GHSA-mrhx-c7xc-m3w5 (memory
  exhaustion validating oversized constrained collections), reachable through
  tool-input validation on the hosted endpoint. The MCP SDK already supports zod 4
  and the server uses only basic schemas, so no code change.
- **applicationinsights 2.9 → 3.17** — clears the 4 moderate advisories from the
  transitive `@opentelemetry/core` (GHSA-8988-4f7v-96qf, unbounded memory in W3C
  Baggage propagation). The hosted geo/usage telemetry in `http.ts` was adapted to
  the 3.x API; local/`npx` runs still collect nothing.
- **Toolchain bumps** — `@modelcontextprotocol/sdk` → 1.32, `express` → 5.3,
  `typescript` → 7, `@types/node` → 26, Node engine `>=22`, plus an
  `@azure/msal-node` override. Gate stays green (Linux CI, full suite).
- **`RELEASE.md`** — added a lean, manual step-by-step for syncing the workshop to
  `raziel-mcp`.

## 1.9.33 — `RelationshipAttestation:1` is the default for encrypted-data access

The ORK's built-in `RelationshipAttestation:1` contract is on ORK `main` (VERIFIED from source
`c69fc4f6`, 2026-10-16). It lets a named user, a group, or holders of a role encrypt and/or decrypt
one record's data. A realm admin approves one policy; nothing is written, compiled or deployed.

- **New scenario `relationship-attestation`** with manifest, roles, bootstrap, anti-patterns, and
  `templates/relationship-attestation/relationship.ts` (build, sign, encrypt, decrypt).
- **Scenarios moved off custom contracts.** `organisation-password-manager` drops the `appUser`
  and `orgOwner` custom contracts: each shared vault has one `RelationshipAttestation:1` policy
  (vault id = `assignmentId` = the only tag; subject an org role with `clientId`, a team group, or
  a member). `encrypted-communication`'s shared variant uses it instead of a custom contract.
- **Signing scenarios keep custom contracts** and now say why: the built-in contract refuses every
  request model except policy-enabled encryption and decryption (`policy-governed-signing`,
  `attested-provenance-registry`, `git-pr-signing-service`, `attestation`'s signed statements).
- **Playbooks lead with it.** `setup-forseti-e2ee` opens with "Start here: the built-in contract";
  `configure-e2ee-roles-and-policies` and `deploy-forseti-policy` point to it first. Any response
  about a custom contract tells the agent to check the built-in one first.
- **Realm templates** (shared, nextjs-customer-portal, nextjs-e2ee-vault) declare realm roles
  `_tide_encryptor` and `_tide_decryptor` (names fixed by the contract, not in default roles) and
  the `groups` protocol mapper (claim name mandated, full path), before IGA, so the adopt-scan
  attests them. The mapper was MEASURED on a local stack; the roles are INFERRED to behave the same.
- **Canon** default-contract tables list it as the default.
- **MEASURED end to end** on ORK `main` by Sasha Le (2026-10-16): `User`, `Group`, realm-`Role`
  and client-`Role` policies worked, and refusals were checked. GAP-078 resolved by runtime test.
- **Enclave pop-up blocked (T-27).** New troubleshooting entry: when the enclave iframe fails and the
  browser blocks the pop-up fallback, approvals and signing stall. `@tidecloak/js` and
  `heimdall-tide` `0.14.41-staging` show a "Pop-ups are currently blocked" notice and add
  `registerPopupErrorCallback` (tidecloak-js #158, heimdall #102, merged). `latest` (`0.14.34`) has
  neither. Covers the safe registration call, keeping enclave actions inside the click, and not
  silencing the notice.

## 1.9.32 — Deploying a custom Forseti contract is not self-service

A Forseti contract decides what the network will sign, so an open one can be written to sign
anything. Putting one onto a realm or the network is experimental, works on test networks only, and
is done by the Tide team, who see the contract before it runs. Until that changes, this server does
not show a member of the public the upload step.

Writing a contract and compile-checking it stay public. So do the four scenarios built on one, the
contract templates and the compile harness.

This restricts what the pack **says and ships**. It does not stop someone who already knows the
endpoint; the platform enforces that, separately.

- **Withheld.** Every response passes through one filter that removes the upload: the REST endpoint
  and its payload, and the SDK call that carries the contract source to the network inside a
  signing request. A section about the upload goes whole; a table row or bullet goes alone; a
  signing-flow code block keeps its code and marks the one line.
- **Said up front.** A response that had something withheld, and every response about a scenario
  or playbook that ends in a deployed contract, starts with a note: write and compile-check it
  here, do not upload it, do not reconstruct the step, the contract goes to the Tide team to be
  reviewed and deployed. The scenario list marks those scenarios. The server instructions carry one
  line (still under the 2000-character client limit).
- **Not in the public files.** `scripts/redact-public.mjs` rewrites a tree's Markdown through the
  same filter and fails if an upload step is left. `scripts/sync-to-raziel.sh` runs it before
  staging. Downloadable template files are checked to be clean already, because `/pack` serves raw.
- **Doctor.** `tide-doctor.sh` warns when an app uploads a contract itself, and notes when an app
  contains one that it goes to the Tide team to deploy.
- **The Tide team's build.** `TIDE_PACK_INTERNAL=1` (or `createServer({ internal: true })`), run
  from the private workshop, serves everything.
- **A lever for later.** `RESTRICTED` in `src/server.ts` can also name a document, scenario or
  template directory to withhold whole. Nothing is listed today.

Gate: `test/restricted.test.mjs` walks every response the public server can give, over stdio and
hosted, and fails on any upload line. It runs the redaction script over a copy of the published
folders and checks the result. The whole gate also passes inside a redacted tree.

## 1.9.31 — New scenario: attestation

"Attest that this user was added to my close friends group" had nowhere to go. The pack's only
attestation scenario signs claims about content for third parties; any request about a fact
concerning people matched it on the word "attest" and got the wrong design.

- **Scenario `attestation`** (`reference-apps/attestation/`). A fact about people becomes a
  statement the network signs, and the app relies on it only while the signature verifies, so a
  database write cannot create it. One shape covers the cases:

  > **Issuer** attests **Claim** about **Subject**, optionally regarding an **Object**, with a
  > **Value**, until an **Expiry**.

  The scenario carries a catalogue mapping requests to it: membership of a group, sharing,
  delegation, consent, acceptance, assignment, verification, approval, endorsement.
- **Who may issue is enforced by the network**, in one of three modes: `self` (about yourself — the
  only one that proves the subject agreed), `owner` (about something you own), `role` (you hold a
  role that lets you). The signer must always be the named issuer. A rule lists the claim types it
  may sign, so rules stay narrow.
- **How.** The statement is itself a policy, signed with `Policy:1` under an IMPLICIT/PRIVATE rule
  that admins sign once; after that, attesting needs no approver. The pattern is taken from a
  production app (`OBSERVED_PATTERN`), where it signs one kind of fact; the pack generalises it.
- **Template `templates/attestation/`**: `AttestationContract.cs`; `attestation.ts`
  (`buildAttestation`, `signAttestation`, `verifyAttestation`, `buildSigningRule`,
  `readSigningRule`, and `statements.*` helpers for the catalogue); `mint-rule.mjs`.
- **Routing.** The bare words attest / attestation now route here; the provenance scenario needs a
  content, authorship, time or third-party signal. A request with both is offered both, with the
  question that separates them. `canon/custom-contracts.md` gains "Two ways to attest something".
- **Stated limits**, in the scenario and to be told to the user: revocation is not attested (a
  compromised server can restore a withdrawn fact), time is not attested (an expiry is enforced by
  the app's server), agreement is proved only in `self` mode, and a background job cannot attest.

MEASURED 2026-10-07. The contract passed 49 checks against the real ORK SDK: its own context,
policy and credential types, its compiler, its IL vetter with determinism enforced, and its
parameter binder, across all three modes. The TypeScript builders are byte-identical to the SDK's
`Policy.DataToVerify` for three statement shapes and three rule shapes; those bytes are kept in the
gate as known answers.

Not measured: a signing round against a live enclave, and uploading the contract and signing a rule
on a live realm. `signAttestation` follows the exemplar's code, including its use of a private SDK
handle.

Gate: 455 checks (was 379).

## 1.9.30 — Start from a working template; one command that finds and fixes faults

A build used to mean reading about nine playbooks and retyping an app the pack already ships. Two
new tools change the default path, and building the templates to support that found four defects in
them.

### `tide_scaffold` — copy a working app instead of writing one from prose

Picks a template from what the user asked for and returns the commands to copy it, name it, install,
bootstrap and check it. It leads with the licence-email and terms questions, writes out the
`.gitignore` (npm drops it from the published package), and says plainly when a template is
client-only and cannot protect an API. It is step 4 of the work order.

### `tide_doctor` — and it repairs, rather than reporting

`templates/shared/tide-doctor.sh`. A fault with exactly one correct, mechanical repair is fixed on
the spot and re-checked: a missing or stale DPoP page is re-copied byte-exact, a rewrite on the exact
path `/tide_dpop` becomes the wildcard, `.env` is added to `.gitignore`. Anything that needs a
decision — which routes need which roles, where a provider option goes, a CSP, bootstrapping a realm
— is left alone and printed with its fix, for the agent to apply. The output says so: what remains is
the agent's job, and the user is asked only what only they can answer. `--check` changes nothing;
`--url` checks what a running app serves; `--realm` reads the realm and never changes it.

### The templates did not all work

Found by installing and building them, which nothing had done:

- **`nextjs-customer-portal` did not build.** It had no `tsconfig.json`, so every `@/` import failed
  to resolve.
- **`react-vite-internal-dashboard` did not build.** It imported `TideCloakProvider` from
  `@tidecloak/react`, which exports `TideCloakContextProvider`.
- **Both Next.js templates verified the token and not the DPoP proof.** A bound token replayed as a
  plain `Bearer` passed — the AP-43 hole the pack documents. The pack's tested verifier
  (`templates/dpop-verify/verifyDpop.ts`) is now copied into both and called from `withAuth`.
- **`vanilla-js-secure-form` never turned DPoP on** and called `getUserInfo()`, `doLogin({...})` and
  `doLogout({...})`, none of which match the SDK. The doctor found the first of these on its first
  run against the pack's own templates.

MEASURED 2026-10-07 after the fixes: all three buildable templates install and build (Next.js 16.4,
Vite 6.4, `@tidecloak/js` 0.14.34 resolved). The built portal's protected API was called eight ways:
a bound token with a valid proof returns 200; no header, a `Bearer` replay of the bound token, no
proof, a proof from another key, a proof for another URL, an unbound token and a token from another
realm key all return 401.

Not measured: a login through any template, the vanilla template in a browser, and a bootstrap
against a real TideCloak.

Gate: 379 checks (was 316). The new suite scaffolds each template, runs the doctor against it, breaks
it in each of the ways it claims to catch, and runs `--url` and `--realm` against mock servers.

## 1.9.29 — Source audit: the pack checked against every project's own code

Nine read-only audits compared what the pack says with the source of `tidecloak-idp-extensions`,
`tidecloak-iga-extensions`, `tidecloak-js`, `tide-js`, `ork`, `keycloak-IGA`, `ragnarok`,
`tidecloak-override`, and `Midgard` / `master-libs` / `tidecloak`. Nothing was built or run.

**Rule used.** A statement wrong on every build is corrected. Where `main` differs from something
the pack **measured on a live build**, the measurement stays and the difference is flagged
**DIFFERS ON `main`**: several projects' `main` is ahead of what is published (`tide-js` `main` has
thresholds 3/5 and policy version 4; npm has 14/20 and 3), so aligning to `main` would make the pack
wrong for what users install today.

### Errors that left an app unprotected while appearing to work

- **`createTideCloakProxy(tcConfig)` protected nothing.** Two playbooks showed it. The function takes
  `{ config, protectedRoutes }`; passed the adapter directly, the route list is empty and every
  request passes unverified.
- **The React provider example left DPoP off.** `useDPoP` / `initOptions` were shown as props on
  `TideCloakContextProvider`. Neither prop exists; they are ignored. They go inside `config`.
- **A `withAuth` comment still said not to verify DPoP proofs**, in the playbook whose Step 4 says
  the opposite. The example now verifies the proof.
- **Four server snippets accepted only `Bearer`**, while the SDK sends `Authorization: DPoP` when
  DPoP is on. One DPoP snippet read `typ`/`alg` from the JWT payload instead of the header and
  would always throw.
- **`verifyTideCloakToken` is not "embedded key only".** It silently falls back to a remote JWKS
  when `config.jwk` is missing, returns `null` for outages as well as bad tokens, and checks no
  DPoP proof. Now stated.

### Bootstrap scripts

- **They could not tell whether licensing succeeded.** The `setUpTideRealm` response was discarded.
  `NEED_PAYMENT` is an HTTP 200 and means not licensed; a 303 is a paid-checkout redirect. All three
  scripts now read the response and stop on either.
- **`toggle-iga` is a flip on `main`.** A second call queues a `DISABLE_IGA` change request. The
  scripts now read the realm's IGA state first and call it only when off.
- **Drain loops approved anything pending.** They now skip `DISABLE_IGA`, `DELETE_REALM` and
  `OFFBOARD_REALM` (three bash loops, the Python drain, five documented loops).

### Governance API

- **One approval lane.** `POST /iga/change-requests/{id}/approve` serves every mode: `{}` first,
  then `{ "requestModel": ... }` if the reply is `mode: "needs-approval"`. The server and the admin
  console agree; `approval-model` and `authorize` are back-compat. Canon, the admin-panel playbook
  and the governance scenario are rewritten around it.
- **Statuses are `PENDING`, `APPROVED`, `DENIED`, `CANCELLED`.** `DRAFT` and `ACTIVE` never existed;
  `APPROVED` means committed. Action types are granular, never `CREATE` / `SET`.
- **`actionTypeIn: ["CREATE","DELETE"]` was still shown as an example in several places**, including
  the canon that warns it authorizes nothing.
- **AP-89's explanation corrected.** Filing a request does not auto-approve the filer; each caller
  counts once, so proxied approvals collapse into one.
- Invite-link parameters are `redirect_uri` / `client_id`; the camelCase names were ignored.
- The legacy `/tide-admin/change-set/*` routes are removed, not deprecated.

### Other corrections

- **`tidecloak-dev` is not "the production image".** It is a development build of the server
  (H2, a pre-imported `myrealm`) wired to the production network: ork1, **14-of-20**. The T=3/N=5
  and `sork1` values in the environment table were staging values. Reworded throughout the pack.
- **Offboarding.** The "correct" `createChangeRequest({ type: 'FABRIC_OFFBOARDING' })` never
  existed. Real trigger, the three-admin floor, the password reset every user needs, and local
  signing are documented from the `ragnarok` source. A one-admin realm cannot offboard.
- **Forseti.** `ctx.Data` is `byte[]?` (settled from ORK source). Lambdas, method groups and static
  field initialisers compile and are rejected by the ORK's IL vetter. `long` / `decimal`
  `[PolicyParam]`s never bind. `ForsetiSdk.Claim("country")` reads policy parameters, not the
  caller's location. `RequireDistinctOrgs(…, 2)` can never pass. The ORK source cap is 256 KB. The
  compile harness README lists what it cannot catch.
- **Licensing.** The email selects the free tier; a blank one silently switches to paid checkout.
  No terms parameter exists and nothing server-side records acceptance. AP-90 said the
  `create-nextjs` CLI loops on the terms question; it asks once.
- VRK is the Vendor **Rotating** Key. Two VRK endpoint names that do not exist are replaced.
- The DPoP popup error comes from the ORK enclave, not tide-js. The enclave pins the page's script
  by hash; its exact frame policy is recorded.
- Vouchers: the browser fetches them from TideCloak and the ORK validates with the payer. Sign and
  decrypt vouchers are granted on the same role condition.

### Flagged, not changed (needs a live check)

`bulk-authorize` committing; `toggle-iga` ignoring its parameter; the `setUpTideRealm` response
body; `isRagnarokEnabled=true` making `email` a required profile attribute; policy version 4;
.NET 10 references on the ORK; `RequestId` on executor/approver contexts; whether the webpack
workarounds are still needed; which value `CustomAdminUIDomain` should hold (the pack contradicts
itself and the audit could not settle it).

Gates: 18 new regression checks. On first run they caught seven more occurrences the audits had not
listed.

## 1.9.28 — Licence email and Terms & Conditions are asked first; responses fit; routing fixed

### A realm was being licensed to a placeholder, under terms nobody was shown (AP-90)

`setUpTideRealm` licenses the realm to an email address under Tide's Terms & Conditions
(https://tide.org/legal). Tide's own flows ask a person for both — VERIFIED in the keylessh init
script and the `@tidecloak/create-nextjs` CLI prompts. The pack's bootstraps defaulted the email to
`admin@yourorg.com` / `admin@example.com` and never mentioned the terms.

- **The scripts fail closed.** All three bootstraps check for `TIDE_LICENSE_EMAIL` and
  `TIDE_TERMS_ACCEPTED=yes` before the container starts. At a terminal they prompt, reject
  placeholder addresses, and exit if the terms are declined. Without a terminal they exit with code
  2 and print the two questions for the agent to put to the user. The email default is gone.
- **Every realm-setup response leads with the ask**: `tide_hosting`, `tide_scenario_bootstrap`, and
  the five bootstrap-shaped playbooks. It is step 1 of the work order and is in the server
  instructions, ahead of the hosting question.
- **The rule is where agents learn to write their own init script**: a new section and a paste-in
  fail-closed block in `canon/tidecloak-bootstrap.md`, a note above Phase 1 of all six reference-app
  bootstrap sequences, and above the licensing step in the playbooks. Eleven literal addresses in
  snippets replaced with `$TIDE_LICENSE_EMAIL`.
- **Only the user can agree.** The text says so in each place: no accepting on their behalf, no
  inferring agreement from "just set it up", stop if they decline.

Limit, stated in canon: a script cannot stop an agent typing `TIDE_TERMS_ACCEPTED=yes` itself. The
check turns a missing answer into a stop instead of a silent default.

Gates: each script is RUN with no terminal across six cases and must exit 2 having started nothing;
no snippet may license to a literal address; every setup response must lead with the ask.

### Six responses the client rejected, and a chooser that matched substrings

Both found by measuring every response and a battery of ordinary requests, not from a report.

- **Six tool responses were over the client's result limit.** Claude Code rejects an MCP result over
  about 25k tokens: the agent gets an error and a file path instead of content. `tide_blast_radius` —
  one of the pack's two headline paths — failed exactly that way against the live server (129 KB).
  Also over: `breach-precedents` (213 KB), `anti-patterns` (147 KB), the `tide-red-team` skill,
  `tide_gaps`, `tide_security_analysis`. Nothing now leaves the server above 60 KB. A larger document
  is delivered in parts, split at headings, never inside a code fence, losslessly; each part says how
  to get the next. Tools that return documents take an optional `part`.
- **`section` reads one entry.** Documents point at single entries ("see AP-62", "T-26"), and the
  only way to follow that was to fetch the whole file. `tide_canon` and `tide_skill` take `section`:
  `tide_canon(name: "anti-patterns", section: "AP-62")` returns 1 entry, not 147 KB. Part 1 of a
  long document lists its headings.
- **The chooser matched keywords as substrings.** `pr` (from `git-pr-signing-service`) is inside
  "protect", "express", "prototype" and "production", so "protect my ASP.NET Core API", "express api
  that checks tide tokens" and "deploy to production" were all routed to the git-signing scenario
  with a nine-playbook sequence. `new` matched "renew". Keywords are now whole terms, and a scenario
  needs a score of 3 before `tide_choose_playbook` prescribes its sequence.
- **Four playbooks were unreachable from the chooser**: `protect-aspnet-core-asgard`,
  `migrate-from-existing-auth`, `configure-e2ee-roles-and-policies`,
  `initialize-admin-and-link-account`. A .NET request got the Next.js API playbook. All four have
  rules now; gate: every playbook is reachable.
- **Diagnosis wins.** "users are missing roles in their token" returned two build playbooks. A
  broken-login or missing-role request now returns only the diagnostic playbook.
- **Framework note.** The playbooks are written for Next.js. A React/Vite, vanilla, Node-backend or
  other-backend request now says which template and `framework-matrix` section to use, or states
  plainly that the stack has no playbook.
- **A manifest named a playbook that does not exist** (`setup-github-app-signing`, RB-104). The
  response now marks it NOT WRITTEN YET instead of listing it as if it could be read.

Gates: every document the server can return is walked and must fit, part by part; splitting is
checked lossless on the five largest files; fifteen routing cases, each one a measured misroute.

Not changed: the three large MCP *prompts* (`tide-build-from-scenario` is about 95 KB). Prompts are
inserted by the user, not returned as tool results, so the limit above does not apply to them.

## 1.9.27 — Users had to ask for the DPoP page by name. Four separate causes.

Reported as: *"users need to be specific about stuff, for example adding the dpop html page
specifically to get dpop to work."* Each cause below was measured, not inferred.

- **The asset tools were broken on every shipped surface.** `templates/` was in neither the Docker
  image nor the npm `files` list. Against the live `mcp.tide.org` (1.9.23), `tide_dpop_asset`
  returned `tide_dpop_auth.html not found in any pack template` and `tide_branding` returned
  `Branding assets missing`. The gate stayed green because it runs from a checkout where the files
  exist. `templates/` and `scripts/check-dpop-asset.sh` now ship in both; gate **4c** checks the
  artifact definitions instead of the disk, and `npm run test:remote` calls the asset tools.
- **A working tool still named a file the caller could not reach.** Its first instruction was
  `cp "<path on the server>"`. For a hosted server that is a path inside the container, so the agent
  fell through to retyping 9 KB of HTML — AP-88. Tools are now told which transport they run under:
  stdio prints the local path; HTTP prints a fetch command against two new read-only routes,
  `GET /pack/templates.tgz` and `GET /pack/<path>`. Only `templates/` and the DPoP checker are
  servable; traversal, build output and `.env` files are refused.
- **Most of the server instructions never arrived.** The block was 6.8 KB. Claude Code cut it at
  about 2 KB, mid-sentence, so branding, onboarding, `.env`, hosting and the only mention of DPoP were
  dropped. It is now under 1.5 KB and only routes the agent to its first call. The tidify/EdDSA
  warning moved into the chooser response for existing-app requests. Gate: instructions <= 2000 chars.
- **Nothing on the default path led to the DPoP tool.** `tide_choose_playbook` returned one playbook
  name. `tide_choose_scenario` and `tide_choose_playbook` now end every build response with a
  numbered **work order**: hosting question, pack file location, the two end-user questions, the four
  DPoP pieces, server-side verification, wire checks. A pure diagnosis gets a one-line DPoP pointer.

Also:

- **`@tidecloak/js` ships `tide_dpop_auth.html` from 0.14.34.** VERIFIED against the published
  tarball: same sha256 as the pack copy. `tide_dpop_asset` now copies from `node_modules` first and
  falls back to the pack. Six "NOT shipped in the npm packages" statements corrected.
- **Three skills still asserted the page must contain no `window.opener`** (`tide-diagnostics`,
  `tide-reviewer`, `tide-integration`) — the AP-62 inversion, which gate 1g missed because it only
  matched the shell forms. A reviewer following them would flag the correct file. Fixed; 1g extended
  to the prose forms and verified to fire on the old text.
- **Route handler vs rewrite: measured, not changed.** On Next.js 16.4.0 with `createDpopRoute`, no
  injected CSP appeared on the route-handler response; what replaced the handler's CSP was the pack's
  own catch-all `next.config` header rule. No login was run that way, so the rewrite remains the
  instruction. Recorded in `canon/framework-matrix.md`.
- `tide_onboarding` no longer ends with a `cp templates/onboarding-modal/...` step that contradicted
  its own "WRITE THIS FILE NOW".

Known, not fixed: npm drops nested `.gitignore` files from a tarball, so templates installed through
`npx @tideorg/mcp` arrive without theirs. The `/pack` archive keeps them.

## 1.9.26 — nightfabric: the pack was teaching an exploitable DPoP pattern

`AP-43` carried a **`✅ CORRECT`** marker on "verify JWT signature only", and
`verify-jwt-server-side.md` Step 4 called proof verification *"Optional Defense-in-Depth"*. Both are
now reversed: a bare-`Bearer` replay of a sender-constrained token returned **`200`** against a live
deployment following that guidance (L-01).

- **The premise was false and it is measurable.** The old advice rested on "secureFetch sends a
  Tide-specific format, not standard RFC 9449". Read from `@tidecloak/js@0.14.20`
  (`generateDPoPProof`), the proof is an ordinary compact JWS: `{alg, typ:"dpop+jwt", jwk}` /
  `{jti, htm, htu, iat, ath}`. The original `Invalid Compact JWS` came from verifying with the
  **realm's** key instead of the `jwk` in the proof's own header.
- **New `templates/dpop-verify/`** — a verifier plus a test with **13 assertions**, proofs built
  exactly as the SDK builds them. The first assertion is the Bearer replay.
- **`htu` behind a proxy** (L-02): the SDK signs the origin the *browser* saw, so
  `req.nextUrl.origin` behind cloudflared makes every legitimate request fail htu and the app 401s
  entirely. Reconstructed from `x-forwarded-host`/`x-forwarded-proto`, verified in both the tunnelled
  and direct-localhost cases.
- **AP-89** (L-03): `approve` credits the **caller**, so proxying approvals through the app server
  records every human signature under its service account — and since filing auto-authorises the
  filer, one identity both proposes and approves. Approvals must go browser → TideCloak with the
  admin's own token.
- **L-04**: read `authorizationCount` / `authorizers[]`; fall back to `readyToCommit`, never to `0`.
- **L-09**: both Skycloak version-discovery endpoints now `400 "Invalid parameter: cluster_id"` on
  prod — the pack's own helper failed identically. It now falls back to the verified floor **loudly
  on stderr, marked ASSUMED**, rather than blocking provisioning, and still never walks the list
  downward.
- **L-12**: the pack's own `get_token` sent `password=password`, contradicting its AP-41. Fixed in
  the shipped script and five docs.
- Gates **2c** (nothing may teach skipping proof verification; a tested verifier must ship) and
  **2d** (no hardcoded `password=password`). Both verified to fire.

## 1.9.25 — The two questions now lead every bootstrap tool response

Sixth request for the same thing. Five previous placements each failed for a different reason —
MCP `instructions` (advisory, and stale for a live session), the pack's own bootstrap scripts
(agents write their own), a playbook section, canon, and the reference-app sequences (all read as
background, mid-document).

They now lead the **response body** of every bootstrap-shaped tool, above the document:
`tide_scenario_bootstrap`, and playbooks matching bootstrap / initialize-admin / provision-tidecloak
/ start-tidecloak / deploy-tidecloak-docker. An agent building a realm must call one of these to know
what to do, so it is the last position where the message is unavoidable.

The block names both tools to call (`tide_branding`, `tide_onboarding` with the chosen fields),
points at the invite-link step as the moment to ask, and says explicitly not to choose and report
afterwards.

- Gate **2b** asserts the block exists, demands asking rather than deciding, is prepended by both
  tools, and — the part that matters for coverage — that **no playbook containing
  `get-required-action-link` is left out of the match pattern**. That check immediately caught
  `deploy-tidecloak-docker`, which generates invite links and was missing.
- Fixed gate **1t**, which sliced the instructions block to the first `].join("\n")` *in the file*.
  The new constant ends with one earlier, so the slice returned empty and produced three false
  failures. It now searches from the start of the instructions block.

## 1.9.24 — Copy tide_dpop_auth.html, never regenerate it (AP-88)

`tide_dpop_asset` handed over 9 KB of HTML with *"write this verbatim"* — an instruction an agent
cannot reliably follow. Reproducing that much markup silently normalises quotes, indentation or line
endings, and the result reviews as correct: structure present, logic present, hash wrong.

It now leads with a byte-exact copy from an absolute path plus a mandatory `sha256sum`, and marks the
listing as a fallback for when the pack is not on the machine (a remote MCP server). Gate **2a**
enforces that ordering.

**AP-88** also records the distinction that makes this non-obvious: the opposite rule applies to
`ProfileOnboarding.tsx`, which is *meant* to be customised per app, so the MCP emits a built version
to write. Copy-exactly and generate-per-app are both right — for different files. The test is whether
anything downstream verifies the bytes.

Measured while investigating: the copies in all four local apps that have one (Undertow, pharma, wfh,
cyberpunk) are **byte-identical to the known-good** — 9120 bytes, correct sha256. So nothing had
rewritten them; the tool was simply inviting a failure that had not landed yet.

## 1.9.23 — Put the requirement where agents WRITE scripts, not where the pack ships them

Fourth *"decisions I made without asking"* report (Undertow). The previous fixes all landed in
`templates/shared/bootstrap-tidecloak.sh` — and **agents do not run that script.** They write their
own `init-tidecloak.sh` per app. Undertow's was hand-written, correct, and paused at the invite link
exactly as intended; it just never contained the banner, because the banner lived in a file nothing
read.

- The requirement now lives in `canon/tidecloak-bootstrap.md` (with the verbatim banner to paste)
  and in **all six** reference-app `bootstrap-sequence.md` files — the material an agent reads *while
  writing* its bootstrap.
- Gate **1z** fails the build if that canon section loses the banner or the ask-and-wait rule, or if
  any reference-app sequence mentions an invite link without the requirement.
- AP-87 gains the general lesson: if you are patching a shipped example script to change agent
  behaviour, check first whether agents run it at all.

## 1.9.22 — tide_onboarding writes the page, instead of telling you to copy one

*"mcp should create the page for me."* Right — `cp templates/… <your-app>/components/` is not
creating a page. The agent still had to notice the file, adapt the fields, and wire it up, and each
of those is somewhere to stop.

`tide_onboarding` now takes `appName`, `fields`, `componentPath` and `framework`, and returns a
**finished component to write**, under a `WRITE THIS FILE NOW` heading:

- the `fields` array is baked in, so the modal collects exactly what was asked for
- the heading reads "Welcome to *&lt;app&gt;*"
- `displayName` maps to Keycloak's `firstName` (there is no such attribute) and **patches the label
  the component actually renders** — the first version injected a `LABELS` constant the component
  never read, which would have been dead code that looked like it worked
- a mounting snippet per framework (`nextjs-app`, `nextjs-pages`, `react-vite`), placed inside
  `TideCloakProvider` because `useTideCloak()` throws outside it
- a verification step: `npx tsc --noEmit`, then log in as a new user

The bootstrap banners no longer print a `cp` command; they say the agent will write it. Gate **1y**
fails the build if the tool stops emitting the file or if any script reverts to telling the user to
copy it, and gate **1w** was rekeyed off the filename onto the ask itself.

## 1.9.21 — Put the two questions where a human is already standing

Third report of never being asked. This time the agent **did both things, and did them well** —
a fitting generated mark, a skippable in-app modal that asked for no email and invented none — then
reported them as *"Two decisions I made — flag if you'd like them changed."*

That is not a capability failure. It is an agent optimising for *"everything that can be done without
a human is done"*, which is the right instinct nearly everywhere and exactly wrong for a choice about
how someone else's product looks.

None of the three earlier placements could fix it:

- MCP `instructions` are advisory, and only reach a session that connected *after* the rebuild.
- Bootstrap **output** is skipped by an agent batching human interaction to the end.
- A **playbook step** reads as documentation, not as a stop.

**So the questions now sit at the one step that already blocks on a human: the admin invite link,**
where the script polls until someone opens it in a browser. The user is present and idle by
construction, so asking costs them nothing. The block tells the agent explicitly to ask and *wait*,
not to choose. Applied to all three bootstrap scripts; gate **1x** fails the build if the ask drifts
away from between the link and the poll.

**AP-87** generalises it: a question the user must answer belongs at an existing human checkpoint,
not at the point the information is first needed. Without one, the question gets answered by whoever
is present — and that is the agent. Where no checkpoint exists, prefer a default that is cheap to
reverse and say so in a line.

## 1.9.20 — The bootstrap script asks, instead of trusting MCP instructions

Reported: *"never got the prompt to ask if I wanted to collect additional information for new users,
I didn't see a custom page created."*

Correct, and the design was at fault. 1.9.18 put both questions in the MCP `instructions` block —
which is **advisory**, reaches the agent only if the server is built from current source *and* the
session was restarted, and can be summarised away by the client. Anyone running the MCP from a
different checkout got the old instructions and was never asked.

- **Both bootstrap scripts and both app-template init scripts now PRINT the two questions when they
  finish.** Script stdout goes to the operator on every run, independent of agent behaviour, server
  version drift, and session timing. Gate **1w** enforces it.
- The printed block names the exact commands: `brand-tidecloak.sh --kind …` for branding, and
  `cp templates/onboarding-modal/ProfileOnboarding.tsx …` for the in-app form, plus the reminder
  that the Keycloak page is already off for that realm.
- The MCP instructions stay as the belt; this is the braces.

**Note on the modal**: `ProfileOnboarding.tsx` is a template you copy into the app — nothing
auto-creates a page. The bootstrap output now says so explicitly with the copy command.

## 1.9.19 — New realms never show the Keycloak signup page at all

Turning the page off was a fix you had to remember. Now it is the default: no new realm this pack
creates will ever render Keycloak's *Update Account Information* form.

- **Step 3b/4b** in `templates/shared/bootstrap-tidecloak.sh` and both app-template
  `init-tidecloak.sh` scripts sets `update.profile.on.first.login=off`, then **reads it back** and
  fails the bootstrap if it did not stick — the symptom of failure is a page a human sees at signup,
  long after the script exited successfully.
- **It runs before `toggle-iga`, and that ordering is load-bearing.** Once IGA is on, the same write
  is a governed admin write: `202` and a pending change request, not applied. Gate **1u** enforces
  both the presence and the order.
- Verified against a real Keycloak on a throwaway realm: a fresh realm already carries the config
  object (so the update path is a `PUT`, not a `POST`), the write applies, and the read-back returns
  `off`.
- Gate **1v**: the shipped realm template must not mark `email`/`firstName`/`lastName` required —
  Tide never supplies them, so a required attribute re-arms the same page even with the flow step in
  place.
- `templates/skip-idp-review/` is now explicitly the path for realms created **before** this, or by
  another route.

The details are collected app-side instead, by `templates/onboarding-modal/ProfileOnboarding.tsx`,
which updates the user through the Account API with the user's own token.

## 1.9.18 — Ask about branding too, at the same checkpoint

1.9.17 made the MCP ask about post-signup details but left **branding reactive** — "when branding
comes up" — so it still never got offered. Same bug, one line apart.

- Both are now a **single post-bootstrap checkpoint**, asked in one message and once per session:
  branding and post-signup details are the only two things the END USER sees, and both defaults are
  bad (Tide's logo on someone else's login screen; an unstyled Keycloak form showing a 64-character
  username).
- Added to `playbooks/bootstrap-realm-from-template.md` as well, so it survives outside the MCP.
- Gate **1t** fails the build if either question drops back to reactive-only, if they are not asked
  together, or if the "ask once" guard disappears — nagging every turn is its own failure.

## 1.9.17 — vialproof learnings: ctx.Data compiled both ways, and the MCP now ASKS about onboarding

- **The compile harness no longer rejects an ORK-proven contract.** The 2026-08-11 stub
  "correction" pinned `ctx.Data` to `ReadOnlyMemory<byte>` on the strength of vendored contracts
  that compile under *either* typing — so they were never evidence. Two contracts that compile only
  against a reference type are ORK-proven. `Stubs.cs` is now `#if`-split and `check.sh` builds
  **both** typings, reporting `NOT PORTABLE` with the offending lines instead of a flat failure.
  Two must-fail fixtures were tagged `// TYPING: rom` because indexing and `foreach` are legal C#
  under `byte[]` and compiling there is not drift. Reported independently as sashlings L-10 and
  vialproof L-02.
- **New `tide_onboarding` MCP tool, and the server now instructs the agent to ASK.** Previously the
  onboarding doc existed but nothing offered it, so every app shipped with Keycloak's unstyled
  *Update Account Information* page showing a 64-hex username. The tool returns the ask, the
  read-only diagnostic, the fix, and a ready-to-drop `ProfileOnboarding.tsx`.
- **`templates/onboarding-modal/`** — a real dismissible modal that writes through the **Account API
  with the user's own token**, handles `401/403` (usually a missing `account` audience) and `202`
  (captured by IGA — reports "queued", never a false success), and never invents a placeholder
  email.
- **AP-86** — never `>/dev/null` a governed bootstrap write (a silenced grant becomes an enclave
  repair once the realm flips to multiAdmin; only the *approval* is enclave-gated, commit still
  works over REST); `UID` is readonly in bash and assigning to it silently keeps the old value;
  role descriptions over **255 chars** fail the entire realm import with an opaque 500; never
  restart the app server mid-enclave-flow (approvals are not refundable, and `pkill -f "next dev"`
  kills the agent's own shell — use `fuser -k 3000/tcp`); never delete a broken container, it
  destroys `docker logs`.
- Gates **1r** (no realm-JSON description over 255 chars) and **1s** (no `UID=` in shipped shell).

## 1.9.16 — Stop the Keycloak page after a Tide sign-up (diagnose first)

Tide's IdP asserts **only a username** — the vuid, no email or name — so a brokered sign-up can hit
a Keycloak form before the user ever reaches the app.

- **`diagnose-post-signup-page.sh`** (read-only) reports which of FOUR mechanisms will fire:
  `idp-review-profile`, `VERIFY_PROFILE`, default required actions, or a stale action already on a
  user. Each needs a different fix, and a realm-level change never clears the last one. Gate 1q
  keeps the docs leading with the diagnostic rather than a blind fix.
- **`skip-review-profile.sh`** sets `update.profile.on.first.login = off` and **reads the value
  back** — a 2xx is not proof. Measured: the `authenticationConfig` object usually already exists
  (alias `"review profile config"`, value `"missing"`), so this is a `PUT` to the existing config;
  a POST-only script fails on every real realm.
- **Measured, read-only, on a live Tide realm**: a correctly provisioned one has *none* of the four
  active — only `link-tide-account-action` and `idp_link`, both non-default, and no required
  user-profile attribute. So if a page still appears it is likely the **account console**, i.e. a
  redirect-URI problem. The landing URL tells you which.
- Two traps recorded: setting `updateProfileFirstLoginMode` **on the IdP does nothing** (legacy
  field; the runtime check reads the authenticator config), and `first broker login` is a
  **built-in flow shared by every IdP** in the realm.
- **AP-85** — do not synthesise a placeholder email. It is indistinguishable from a real address
  downstream, collides with Keycloak's email uniqueness (measured `duplicateEmailsAllowed: false`),
  and destroys the "never set" signal. Tide does not need email for recovery — reset happens in the
  enclave. Gate 1p enforces it, scoped to per-user construction so a static bootstrap
  `ADMIN_EMAIL` default is unaffected.
- **`ONBOARDING.md`** — collect details in-app with a dismissible modal, writing via the **Account
  API with the user's own token**, never the Admin API (AP-41, plus a governed admin write returns
  202 and silently queues a change request). Whether a self-service profile update is itself
  governed is flagged INFERRED with the command to check.

## 1.9.15 — Enclave branding: ask the user, generate art that fits the app, upload it

**The flow, not just the docs.** `BRANDING-FLOW.md` is the script the agent follows: ask once, then
(1) the user drops their own art in `./branding/`, (2) the agent writes an image-AI prompt *filled in
for their app* and uploads what comes back, or (3) the agent generates it. `brand-tidecloak.sh` then
does check -> upload both -> save+sign -> verify in one command. The real failure was never a broken
upload — it is that nobody offers, so every app ships with Tide's logo on its login screen. Gate 1n
enforces the ask.

**Art that matches the app.** `make-branding.py --kind` covers vault, identity, notes, chat, data,
finance, health, media, commerce, generic — each a distinct mark (shield, keyhole, lines, bubble,
bars, pulse, play, bag, waves) with a sensible default colour. `--name` varies it deterministically,
so two vault apps differ and the same app always regenerates identically. Gate 1o keeps the code and
the docs in step. Still Python stdlib only — no image model, no Pillow.

**The mark is now a disc, not a rounded square**, because the enclave crops to a circle: a disc fills
the whole area instead of floating a small square inside a circle.

### Enclave branding geometry, measured instead of guessed

The pack's branding geometry was tagged ASSUMED because "the enclave's exact layout is not in
readable sources". It is readable — the enclave is a public page. Measured it, and the guidance was
wrong in the way that matters.

- **The logo is cropped to a CIRCLE.** `main .logo .img_container { border-radius: 50% }`, confirmed
  by hit-testing the rendered element and by screenshotting a full-bleed square injected into the
  live enclave: all four corners are gone. `evidence/` carries the picture and the method.
- **It is `background-size: cover`, not `object-contain`.** The pack said the logo was fitted into a
  box. `cover` fills and crops, so a **non-square canvas loses the ends of its long axis** before the
  circle is even applied. Square is not a preference.
- **There is a WHITE plate behind it** (`background-color: var(--white)`), so a logo is designed
  against white — not against the uploaded background image. A pale mark disappears.
- **Real numbers**: the box renders at **85–153 CSS px** (85% of a 100–180px wrapper), so 512 is the
  practical source floor at 3× DPR. Tide's own defaults are **838×838** logo and **3840×2160** JPEG
  background. Safe area for a square mark is a **≥14.65% inset** — a square inscribed in a circle has
  side = diameter ÷ √2.
- `check-branding.py` now computes the **exact ratio of artwork to crop radius** and says what to
  scale to. Validated against Tide's own logo (0.94, passes) and a full-bleed square (1.41 = √2,
  correctly flagged).
- `IMAGE-PROMPT.md` carries a copy-paste prompt for a user to run in an image model, with the
  circular-safe constraint, the white-background constraint, and no-text stated up front.
- `make-branding.py` defaults to 1024×1024; its output measures 0.94 against the crop radius.
- Gates **1l** (nothing describes the logo as `object-contain`), **1m** (branding docs must state the
  circular crop), **1n** (the flow exists and leads with the ask), **1o** (every `--kind` is
  documented).
- `check-branding.py` also gained an **angular uniformity** test, because ratio alone was not enough:
  a disc that exactly fills the canvas is *correct*, while a square at the same ratio loses its
  corners. Without it the checker told a disc to "scale to 100%", which is nonsense advice.

Upload limits confirmed from the admin UI: PNG/JPEG/GIF/WebP, 5 MB, no SVG, and **no dimension
validation at all** — nothing rejects a badly shaped logo, it just ships clipped.

## 1.9.14 — Ask Skycloak for the version list; Docker Hub was the wrong source

Follow-up to 1.9.13, which fixed the hardcoded pin by reading Docker Hub tags. **That still
provisioned old clusters**, and the reason matters more than the fix.

- **Skycloak never consults Docker Hub.** It exact-matches the version against a server-side
  allowlist (`SupportedTideCloak` → `ErrInvalidClusterVersion` → `400 invalid cluster version`).
  A tag can be the newest thing Tide published and still be un-provisionable.
- **The walk-down loop then hid it.** Newest 400s → try next → land on something old, with no
  error. A retry loop over the wrong list converts a loud failure into a silent downgrade.
- **The walk-down is now gone entirely.** Fixing the source made it not just unnecessary but wrong:
  every entry comes from Skycloak, so a rejection is an inconsistency to report, not a reason to
  settle for an older build. The playbook takes Skycloak's newest and creates **once**. Gate **1k**
  fails the build on any create loop over `--list`, and `--list` is now labelled diagnostic-only.
- The `0.14.17` floor never *selects* an older version — it only refuses to return one when the
  entire catalogue is below it (known-broken builds), so it can never mask a newer release.
- **There IS a versions endpoint** — `GET /clusters/supported-versions?type=tidecloak` and
  `GET /clusters/versions`, both behind the API key. The pack's earlier "there is no versions
  endpoint" was an unverified negative inferred from the public docs, and it is precisely what
  sent the previous fix to Docker Hub for a substitute.
- `templates/shared/skycloak-latest-version.sh` now queries Skycloak, handles all three response
  shapes, sorts numerically, applies the `0.14.17` floor, and fails loudly. Docker Hub survives
  only as `--check`, a lag diagnostic ("Skycloak is behind what Tide published" → ask them to add
  it). It never picks a version.
- **Do not read the allowlist from a Skycloak source checkout.** The checkout on this machine lists
  `0.11.7` while production provisions `0.14.17` — a snapshot is authoritative for the *mechanism*,
  never the *values*. AP-83, third occurrence.
- If Skycloak's newest is genuinely old, no client-side change fixes it. Report it; do not lower the
  floor, because `0.13.13` and `0.14.11` provision happily and then fail.
- AP-84 rewritten around this. New gates **1i** (nothing sources the version from Docker Hub) and
  **1j** (nothing repeats the "no versions endpoint" claim, retractions allowed).

## 1.9.13 — 2026-08-18

- **New `tide_dpop_asset` tool — serve `tide_dpop_auth.html` from the MCP.** The Tide
  enclave integrity-checks this page, so any local drift breaks login with an
  unexplained 500. Rather than have every template ship a copy that can rot, the MCP
  now serves the canonical **popup-safe** page (`window.opener || window.parent` +
  self-post guard) directly. **Reverses the previously inverted `window.opener`
  guidance** and reteaches the root cause. (19th tool.)
- **`sources/` is not authoritative for an artifact's VERSION.** New anti-pattern:
  a vendored copy under `sources/` is a point-in-time snapshot, not the version of
  record — trusting its version (or its content) as current is how drift ships.
  Documented in `canon/anti-patterns.md` and `CLAUDE.md`.
- **Skycloak: discover the latest TideCloak image instead of pinning `0.14.17`.**
  New `templates/shared/skycloak-latest-version.sh` resolves the current image at
  provision time; `provision-tidecloak-skycloak` and `canon/hosting-options.md`
  updated so a hardcoded tag stops silently going stale.
- **`release-verify.mjs` expects 19 tools** (was 18) now that `tide_dpop_asset` ships.

## 1.9.12 — 2026-08-17

- **Corrected a false migration claim — tidifying is not free (EdDSA gate).** The
  pack previously told operators *"No code changes needed — same SDK, same OIDC, the
  app doesn't need to know it's talking to TideCloak instead of Keycloak."* That is
  **false**. Tidifying a realm changes token signing from **RS256 to EdDSA
  (Ed25519)** (MEASURED on `tideorg/tidecloak-dev:latest`), so **every token the app
  receives becomes `alg: EdDSA`** — and a verifier that can't do EdDSA rejects all of
  them. Known blockers, VERIFIED: Node **`jsonwebtoken`** has no EdDSA support at
  all; .NET **`Microsoft.IdentityModel.Tokens`** ships none (that's why
  `Tide.Asgard.Core` exists); and an `algorithms: ['RS256']` pin rejects a perfectly
  valid token — **repin to EdDSA, never unpin.**
- **New `canon/tidify-compatibility.md` + `tidify-preflight` template.** Establish
  compatibility *before* promising a migration: `check-tidify.sh` scans a project for
  EdDSA blockers and reports **evidence, not a verdict** (it can't see your gateway,
  managed authorizer, or a downstream SaaS that validates the JWT — the most common
  blockers). The `migrate-from-existing-auth` playbook is rewritten around this.
- **Turnkey enclave branding — one command, and automatic during bootstrap.** New
  `brand-tidecloak.sh` runs the whole flow end-to-end (**generate → validate → upload
  → save+sign → verify**), safe to re-run, and `init-tidecloak.sh` now brands the
  realm during bootstrap. Credentials come from the environment / `.env`, never the
  script (AP-41); a fresh ~60-second master-admin token is minted per call.

## 1.9.11 — 2026-08-10

- **New `tide_branding` tool + `enclave-branding` template** — how to produce and
  upload the login/approval enclave's **logo** and **background image**. Returns the
  **verified upload contract** (endpoint, multipart parts, the png/jpg/jpeg/gif/webp
  allowlist with **SVG rejected server-side**, the **5 MB** cap, and the crucial
  **save-AND-sign** step — the enclave verifies the branding, so an upload that
  isn't re-signed via `set-branding` doesn't take). Ships a **dependency-free
  generator** (`make-branding.py`, stdlib only — no Pillow, no image model, no
  network) for the many agents that can't create images, a **validator**
  (`check-branding.py`) to catch a bad asset *before* wasting an upload, and
  image-model prompts for agents that can. The generator's `--name` deterministically
  varies the mark's geometry so two realms don't look alike, while staying stable
  across runs (the serve URL is content-hashed).
- Failure modes made explicit: a mislabelled file (JPEG bytes in `logo.png`) passes
  the filename-keyed allowlist but breaks; an **unpadded logo isn't rejected — it
  just ships looking clipped**. Documents the `vendorResources` upload/set/get
  surface in `canon/tidecloak-endpoints.md`, VERIFIED against the server source.
- **`release-verify.mjs` expects 18 tools** (was 17) now that `tide_branding` ships.

## 1.9.10 — 2026-08-10

Correctness and security fixes surfaced by real ORK/TideCloak runs after 1.9.9.

- **Removed the invalid `tide-roles-mapper` (AP-80).** It is **not a real
  protocol-mapper provider** — measured against the production image, a realm
  import declaring it returns `201 Created` but the mapper is **silently dropped**,
  so role claims go missing. Purged from the realm templates, **gated so it can't
  come back**, and the eval that wrongly *required* it (EVAL-053) inverted.
  Templates still carry the stock `tideUserKey` + `vuid` attribute mappers, so the
  removal can't be "fixed" by deleting the Tide claims wholesale.
- **Corrected the Forseti/ORK contract SDK surface.** Canon, playbooks, and the
  compile-harness stubs were teaching an ORK contract API that does not exist (a
  real compile failure). Reconciled against the two working, deployed contracts;
  adds reference contracts (`ColaContract`, `QuickstartContract`), `mustfail`
  cases, and a `scan-sandbox.py`.
- **Master-admin password out of the script (AP-41).** Bootstrap now reads
  `KC_BOOTSTRAP_ADMIN_PASSWORD` from the environment / a gitignored `.env` with
  **no default** (a default password is a hardcoded credential with extra steps);
  ships `.env.template` + `.gitignore` across templates.
- **Red-team correction** — TideCloak is **not an identity concentration** and does
  not own a verifier; the `tide-red-team` skill wrongly claimed it did. Also a
  model-id "equivalent constructions" correction (LEARNINGS-deploy-gate-001).
- Canon refinements: substantially expanded `anti-patterns` and `custom-contracts`,
  plus `tidecloak-bootstrap`, `security-gap-mapping`, and the reference-app
  role-policy matrices.

## 1.9.9 — 2026-08-10

- **`toggle-iga` fails open — form-encode and assert.** The
  `/tide-admin/toggle-iga` endpoint reads the **form** parameter `isIGAEnabled`;
  a JSON body is parsed by nothing and the missing parameter **defaults to
  `true`**, so `{"enabled":false}` silently *enables* IGA and a malformed request
  never errors. Every bootstrap script now form-encodes `isIGAEnabled=true` and
  **asserts `"enabled":true`** in the response instead of trusting the 200.
- **Giving an autonomous agent Tide authority** — new `canon/agent-authority.md`:
  an AI agent **cannot hold a Tide identity or sign by itself** (GAP-064, no
  headless auth). States the quorum pattern that does work *and its limit*, so
  nobody ships it believing it proves more than it does.
- **Seamless DPoP relay + CSP wiring** — the DPoP popup relay and the
  Content-Security-Policy needed to serve it now wire up without manual fixups.
- **`forseti-parity-tests` template** — assert your app code still matches the
  signed contract in ~200 ms, with no ORK / .NET / enclave / approval. Catches
  silent drift between the C# every ORK runs and the UI that teaches users the
  approval ladder.
- **`drain-change-requests.py`** — a real file (not a bash heredoc, which
  swallows the piped payload and makes every drain falsely report "0 change
  requests") to approve + commit all pending IGA change requests.
- Canon/playbook refinements: `anti-patterns`, `framework-matrix`,
  `tidecloak-bootstrap`, `custom-contracts`, `concepts`, `invariants`,
  `deploy-forseti-policy`, and the reference-app bootstrap sequences.

## 1.9.8 — 2026-08-10

Applies a full learnings cycle (L-01…L-20) from a real integration project.

- **Deploy a custom Forseti policy** — new `playbooks/deploy-forseti-policy.md` +
  a `forseti-compile-harness` template that compile-checks a contract (with passing/
  failing examples) before it's signed to the ORK network. Registered in
  `tide_choose_playbook`.
- **Verifiable claims** — new `canon/verifiable-claims.md`, plus expanded
  `custom-contracts`, `anti-patterns`, `invariants`, and `troubleshooting` canon.
- **DPoP page integrity** — the popup-safe `tide_dpop_auth.html`
  (`window.opener || window.parent` + self-post guard, AP-62 / GAP-068) is now the
  canonical page shipped across **all** templates, with `scripts/check-dpop-asset.sh`
  and the gate enforcing it. Fixes the silent popup-login 500.
- **`attested-provenance-registry` scenario** — a new reference-app scenario for
  provenance / attestation / notarization use cases (signed Ed25519 attestations,
  chain-of-custody, anti-backdating), wired into `tide_choose_scenario` keyword
  matching with a disambiguation note vs. bare `policy-governed-signing`.

## 1.9.7 — 2026-08-07

- **DPoP hardening** — the server-side `cnf.jkt` assertion (sender-constrained token
  proof-of-possession) is now active in the JWT-verification guidance; it had shipped
  commented out. See `playbooks/verify-jwt-server-side.md` and `protect-api-nextjs.md`.
- **Skycloak: reuse a working API key** instead of minting a new one on every run.
- **Auth UX** — a new `canon/ux-states.md` (auth state machine, real waits, and
  Tide-specific copy) plus a fix for the provider-callback error.
- Red-team refinements and a source cross-reference audit.

## 1.9.6 — 2026-08-06

- **Skycloak hosted provisioning — verified end-to-end.** The device-auth flow now
  mints an API key, and the public Skycloak API takes API-Key auth only; DPoP wiring
  confirmed; pinned to Tide SDK 0.14.17; uses the production image only. Major rewrite
  of `provision-tidecloak-skycloak.md` and `canon/hosting-options.md`.
- **New entry flow.** The MCP opens by offering two paths — build a Tide app, or run a
  **Blast Radius Assessment** of an existing system — and its server instructions steer
  agents to ask about Tide integration up front.
- **Setup asks local vs hosted.** Starting TideCloak now offers local (Docker) or
  hosted (Skycloak, device auth).
- **Red-team** — adds a Skycloak live-deploy hand-off (device-auth).
- Canon/playbook refinements across IGA change-requests, troubleshooting, the
  bootstrap scripts, and SDK version references (0.14.17).

## 1.9.5 — 2026-07-31

- **Usage geography (hosted endpoint only)** — `mcp.tide.org` now records aggregate
  request telemetry with the caller's approximate location (country/city, via Azure
  Application Insights) so we can see where the service is used. Local/`npx` and
  self-hosted runs collect **nothing** unless `APPLICATIONINSIGHTS_CONNECTION_STRING`
  is set. Request bodies and tool arguments are never captured; the raw IP is masked
  to coarse geography. **`PRIVACY.md` updated** to disclose this — review it.
- **`deploy.sh` deploys the versioned image tag** — Azure Container Apps won't
  re-pull an unchanged `:latest`, so deploying `:latest` silently no-oped (three
  deploys, zero rollouts). Deploying `tideorg/mcp:$VERSION` makes every deploy roll.

## 1.9.4 — 2026-07-30

Release-hardening — fixes the exact failure modes that made shipping 1.9.3 bumpy.

- **`.gitattributes` (`*.sh text eol=lf`)** — shell scripts always check out with
  LF, so `deploy.sh` and the user-facing `init-tidecloak.sh` /
  `bootstrap-tidecloak.sh` stop shipping with CRLF and breaking under bash/WSL
  (`$'\r': command not found`).
- **Self-healing `deploy.sh`** — re-binds the `mcp.tide.org` custom domain on
  every deploy (idempotent), so the binding stops silently dropping and taking
  the hosted endpoint down at the TLS layer.
- **`scripts/bump-version.mjs`** — one command bumps the version across every
  version-bearing file (core packages, plugin, marketplace, extension, and
  raziel's `server.json`), replacing the error-prone hand-editing.

## 1.9.3 — 2026-07-30

- **Red-team suite** — a `tide-red-team` skill, `canon/breach-precedents.md` and
  `canon/tide-neutralization.md`, a `red-team-review` prompt, and a `red-team-report`
  template for adversarial security review of a system's trust concentration.
- **Bootstrap refinements** — updates to `init-tidecloak.sh`, the realm templates, and
  the IGA/admin initialization playbooks.
- Ships the VSCode extension source in-repo (published separately as **Raziel** 1.9.2).

## 1.9.2 — 2026-07-16

- **MCP Registry ready** — added the `mcpName` field (`io.github.tide-foundation/raziel`)
  to the npm package plus a `server.json` listing both the npm package (stdio via `npx`)
  and the hosted `mcp.tide.org` remote, for publishing to the official MCP Registry.
- **Renamed to Raziel** — the Claude Code plugin is now `raziel` (install id) / **Raziel**.
- **Relicensed** under the Tide Community Open Code License (TCOC v2), replacing MIT.

## 1.9.1 — 2026-07-15

- Docs: refreshed `README.md` (the npm package page) for the 1.9.0 feature set —
  security gap analysis and hosting guidance in the intro and capability list,
  a security-analysis starter prompt, and corrected "What's inside" counts
  (15 canon, 18 playbooks, 11 skills, 5 scenarios, 5 prompts). No code changes.

## 1.9.0 — 2026-07-15

The largest release since the pack's initial cut. It broadens the MCP from an
*integration helper* into a *security and hosting advisor*, migrates the IGA API
to the current surface, and adds a real pre-release quality gate. Also makes the
pack ready to list in the Claude directory.

### Highlights

- **Security gap analysis** — audit an existing (even non-Tide) system and map
  its weaknesses to Tide capabilities.
- **Partner-hosted TideCloak via Skycloak** — a managed-hosting path alongside
  self-hosting.
- **IGA API migration** to `/iga/change-requests/...` (replaces the legacy
  `/tide-admin/change-set/...`).
- **Pre-release QA gate** (`npm test`) + GitHub Actions CI.
- **Read-only tool annotations** and a privacy policy — Claude-directory ready.

### New capabilities

- **`tide_security_analysis` tool** + `tide-security-analysis` prompt. Backed by
  `canon/security-gap-mapping.md` (SG-01 … SG-18: a trust-concentration → Tide
  capability → remediation → honesty-note table, plus a mandatory "what Tide does
  NOT fix" section), `canon/security-runtime-probes.md` (opt-in, authorization-
  gated live probing), and the `tide-security-analyst` skill.
- **`tide_hosting` tool** + `canon/hosting-options.md` and the
  `provision-tidecloak-skycloak` playbook: self-host vs partner-hosted decision,
  the trust model (partner-hosting is an availability/metadata trust, not an
  integrity trust — the host can't forge tokens or decrypt data), and the
  Skycloak provisioning API reference.
- **`tide-mcp-qa` skill + prompt** — the QA Engineer role that runs the gate,
  audits for overclaiming, and issues a SHIP / BLOCK verdict.

The MCP now exposes **16 tools** and **5 prompts** (was 14 / 3).

### Changed

- **IGA change-request API** migrated to `/iga/change-requests/{id}/authorize|commit`
  (per-id, `bulk-authorize` for batches), replacing the legacy
  `/tide-admin/change-set/*/batch`. New authoritative reference
  `canon/iga-change-requests-api.md`; reconciled across canon, playbooks,
  bootstrap scripts, and reference-apps. Captures the **Tide vs Tideless** mode
  split — IGA is cryptographic only in Tide (licensed) mode.
- **All tools now carry `readOnlyHint` annotations** (they are read-only).

### Fixed / internal

- **Deterministic QA gate** (`mcp-server/test/`, `npm test`): protocol smoke
  tests (tools/prompts present, annotated, return sane content) + content
  consistency (no stray legacy endpoints, referenced playbooks exist, SG-01…18
  present, GAP counts sum, manifests valid, versions in sync). **113/113.**
- **GitHub Actions** `qa-gate.yml` runs the gate on every PR and on pushes to
  `main`.
- **Claude directory readiness**: `PRIVACY.md` (no data collected), corrected +
  validated plugin manifests (`claude plugin validate` passes), version
  reconciliation so `server.ts`, both `package.json`s, and `plugin.json` all read
  **1.9.0**.
- `npm run test:remote` verifies a live/hosted endpoint (tool count, annotation
  coverage, version).

### Known follow-ups (require a live stack)

- **IGA bootstrap loop** (`bulk-authorize → commit`) is verified against the spec
  but `REQUIRES_RUNTIME_VALIDATION` on a live iga-core instance. (GAP-065)
- **Skycloak-hosted Tide vendor surface** unconfirmed — provisioning is verified,
  but whether a hosted cluster exposes `setUpTideRealm`/IGA/adapter-with-Tide-
  extensions must be checked on a live cluster (`scripts/skycloak-smoke.sh`).
  (GAP-066)
- Provisioning a **TideCloak** cluster via the Skycloak API needs the identity-
  platform selector field confirmed with Skycloak; the documented API path
  defaults to vanilla Keycloak.

### Upgrade notes

- If you script the TideCloak bootstrap, switch IGA approvals to the new
  `/iga/change-requests/...` surface — see `canon/iga-change-requests-api.md`.
- No changes required to app-side SDK wiring.
