# Changelog

All notable changes to `@tideorg/mcp` (the Tide Agent Pack) are documented here.

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
