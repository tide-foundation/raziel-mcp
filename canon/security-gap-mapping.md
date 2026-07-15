# Security Gap Mapping

Maps weaknesses commonly found in existing systems to the Tide capability that removes them.

This file is the lookup table for the `tide-security-analyst` skill. Each gap entry has:
- **Detect** — how an agent finds the gap in a real codebase or deployment
- **Trust concentration** — the single party/artifact you must trust for the current control to hold
- **Tide replacement** — what Tide provides, with sourcing status
- **Remediation path** — the playbook sequence
- **Honesty note** — what the Tide replacement does NOT cover

**Critical rule**: A gap analysis that cannot name the trust concentration is not a finding. "Uses passwords" is not a gap. "Password verification collapses to trust in one database and one server process" is.

**Severity rubric** (aligned with `canon/invariants.md` failure severities):

| Severity | Meaning |
|----------|---------|
| **CRITICAL** | One compromised party forges identity, mints authority, or reads all sensitive data |
| **HIGH** | One compromised party escalates privilege or replays/extends stolen authority |
| **MEDIUM** | Weakness is exploitable but requires an additional foothold |
| **INFO** | Architectural trust concentration with no immediate exploit path |

Detection commands below are operator guidance — **ASSUMED** unless tagged otherwise. Tide capability claims cite `canon/feature-mapping.md` and `canon/invariants.md`, which carry their own VERIFIED sourcing.

---

## SG-01: Central password verification (stored hashes)

**What it looks like**: Password hashes (bcrypt/argon2/scrypt/PBKDF2) in the application database, or a single IdP that verifies passwords against its own store.

**Detect**:
```bash
grep -rn "bcrypt\|argon2\|scrypt\|pbkdf2\|password_hash\|hashedPassword" --include="*.ts" --include="*.js" --include="*.py" --include="*.cs" --include="*.java" -i .
# Any hit in a login/registration path = central verification
grep -rn "compare\(.*password\|verifyPassword\|checkPassword" -i src/ server/ app/ 2>/dev/null
# Schema check: look for password/hash columns in migrations or ORM models
```

**Trust concentration**: The database and every process that can read it. Dump the table → offline cracking of the entire user base. The verifying server sees the plaintext password on every login.

**Severity**: CRITICAL (for the credential store), even when hashing is strong — hashing changes attack cost, not attack surface.

**Tide replacement**: Threshold password verification (PRISM) across T+ ORKs. No password hash stored anywhere. Each ORK verifies the password challenge independently. An attacker compromising the TideCloak server cannot learn passwords. **VERIFIED** (`canon/feature-mapping.md` — Login/SSO; I-02, I-09).

**Remediation path**: `migrate-from-existing-auth` → `add-auth-nextjs-existing` (or framework equivalent via `canon/framework-matrix.md`).

**Honesty note**: Tide removes the stored-credential single point. It does not stop a user from choosing a weak password or being phished into a fake login page on a domain you don't control.

---

## SG-02: Token-signing key held whole in one place

**What it looks like**: JWT/session signing secret in an env var, config file, KMS entry, or IdP database (`JWT_SECRET`, `jwt.sign(payload, secret)`, HS256 shared secrets, a single RS256 private key, Keycloak/Auth0/Cognito realm keys).

**Detect**:
```bash
grep -rn "JWT_SECRET\|SIGNING_KEY\|PRIVATE_KEY\|jwt.sign\|SignedCookie\|session_secret" -i . --include="*.env*" --include="*.ts" --include="*.js" --include="*.yaml" --include="*.json"
grep -rn "HS256\|HS384\|HS512" -i src/ server/ lib/ 2>/dev/null
# HS* = symmetric: every verifier can also mint. Even worse concentration.
```

**Trust concentration**: Whoever holds the key mints unlimited valid identity for every user and role. Server compromise, leaked env, CI logs, or a malicious insider = silent, undetectable token forgery.

**Severity**: CRITICAL.

**Tide replacement**: JWTs are threshold-signed by the VVK across T+ ORKs; each VVK ORK independently verifies claims before partial-signing; no complete signing key exists anywhere at any point (I-01 Never-Whole-Key, I-02). Compromising TideCloak itself does not allow token forgery (I-09). **VERIFIED** (`canon/invariants.md` I-01/I-02/I-09; `canon/feature-mapping.md` — JWT Verification).

**Remediation path**: `deploy-tidecloak-docker` → `bootstrap-realm-from-template` → `initialize-admin-and-link-account` → `verify-jwt-server-side`.

**Honesty note**: The relying application must still verify tokens correctly (SG-04, SG-10). Threshold signing does not help if the API never checks the signature.

---

## SG-03: Bearer tokens with no proof-of-possession

**What it looks like**: `Authorization: Bearer <token>` accepted as-is. A stolen token (XSS, logs, proxies, browser extensions) is replayable until expiry from any machine.

**Detect**:
```bash
grep -rn "Authorization.*Bearer" -i server/ src/ app/ api/ 2>/dev/null
grep -rn "dpop\|cnf.jkt\|mtls\|token_binding" -i server/ src/ 2>/dev/null
# Bearer present + no DPoP/mTLS/cnf handling = replayable tokens
# Also check token lifetime: long-lived bearer tokens amplify this gap
```

**Trust concentration**: Every channel and store the token transits — browser storage, log pipelines, proxies. Any one leak = full session takeover for the token lifetime.

**Severity**: HIGH.

**Tide replacement**: DPoP (RFC 9449) token binding. The SDK generates an ephemeral key pair; every request carries a fresh proof; server verifies method, URL, freshness, `jti` replay cache, and `cnf.jkt` thumbprint. A stolen access token is useless without the private key. DPoP is required for Tide's full security guarantees. **VERIFIED** (`canon/feature-mapping.md` — DPoP; I-12).

**Remediation path**: `protect-api-nextjs` → `verify-jwt-server-side` (DPoP verification steps included), client config per I-12 bidirectional lockstep.

**Honesty note**: DPoP binds the token to the browser's key. It does not protect against an attacker who fully controls the victim's live browser session (they can drive the real key).

---

## SG-04: Client-side-only authorization

**What it looks like**: Role checks, route guards, or middleware redirects in frontend code, with APIs that trust the client already checked. The most common gap in AI-generated and rapid-prototype apps.

**Detect**:
```bash
# Find client-side gating
grep -rn "hasRole\|isAdmin\|user.role\|roles.includes" src/ app/ components/ --include="*.tsx" --include="*.jsx" 2>/dev/null
# Then check whether APIs verify independently
grep -rLn "jwtVerify\|verifyJWT\|verifyToken" app/api/ pages/api/ server/routes/ 2>/dev/null
# Any API file in the second list that handles sensitive data = finding
# Next.js middleware-only protection counts: middleware redirects are UX, not enforcement
```

**Trust concentration**: The attacker's own browser. There is no server-side control at all — curl bypasses everything.

**Severity**: CRITICAL.

**Tide replacement**: Server-side verification of threshold-signed JWTs with embedded JWKS, plus role checks after signature verification (I-03, I-04, I-08). UI gating stays — as UX only. **VERIFIED** (`canon/invariants.md` I-03/I-08; `canon/feature-mapping.md` — Protected Routes vs Protected APIs).

**Remediation path**: `protect-api-nextjs` → `verify-jwt-server-side` → `add-rbac-nextjs`.

**Honesty note**: This gap is fixable with any competent server-side auth. What Tide adds on top: the verified signature is threshold-produced (SG-02), so fixing SG-04 with Tide also removes the signing-key single point instead of relocating it.

---

## SG-05: Unprotected or partially protected APIs

**What it looks like**: API endpoints with no authentication at all, or a mix where some routes verify and others were forgotten. Common after incremental growth: the first routes got auth, the last five didn't.

**Detect**:
```bash
# Enumerate all API routes, then diff against routes that verify
find app/api pages/api server/routes -name "*.ts" -o -name "*.js" 2>/dev/null
grep -rln "jwtVerify\|verifyJWT\|authenticate\|requireAuth" app/api/ pages/api/ server/routes/ 2>/dev/null
# The set difference is the finding. Confirm each unprotected route's data sensitivity before reporting.
# Runtime check (no repo access needed):
curl -s -o /dev/null -w "%{http_code}" https://target/api/<suspected-route>
# 200 without credentials on a sensitive route = confirmed
```

**Trust concentration**: None exists — that is the gap. Obscurity of the route name is the only control.

**Severity**: CRITICAL for sensitive data/mutations, MEDIUM for public-by-design routes misclassified during triage.

**Tide replacement**: Same enforcement layer as SG-04. Every protected route verifies the threshold-signed JWT server-side before acting (I-03).

**Remediation path**: `protect-api-nextjs` → `verify-jwt-server-side`, applied per-route with the `tide-route-and-api-protection` skill's diagnostic table.

**Honesty note**: Route-by-route coverage is an audit discipline, not a product feature. The analysis must enumerate routes exhaustively; a sampled audit gives false assurance.

---

## SG-06: Server-readable sensitive data (no E2EE, or server-held encryption keys)

**What it looks like**: Sensitive fields (SSNs, health data, documents, secrets) in plaintext at rest; or "encrypted at rest" where the app server holds the decryption key (KMS envelope encryption, `ENCRYPTION_KEY` env var, TDE only).

**Detect**:
```bash
grep -rn "ENCRYPTION_KEY\|createCipheriv\|createDecipheriv\|AES\|kms.decrypt" -i src/ server/ lib/ 2>/dev/null
# Encryption code + server-resident key = server can read everything (relocated trust, not removed)
# Schema review: identify sensitive columns, check whether any encryption exists at all
# Ask: who can read this data? If the answer includes "the server" or "the DBA", it is a finding
```

**Trust concentration**: The application server, its key store, and every admin of either. DB dump + key = full disclosure. "Encryption at rest" against a live server compromise is close to no encryption.

**Severity**: HIGH (CRITICAL for regulated data classes).

**Tide replacement**: Hermetic E2EE. Session keys are threshold-encrypted via CVK; decryption requires live Fabric participation by T+ ORKs; plaintext never exists on the server, admin console, or any ORK; access is enforced cryptographically against roles in the threshold-signed JWT. **VERIFIED** (`canon/feature-mapping.md` — E2EE; I-11). Two models — self-encryption vs policy-governed shared encryption — and they are different architectures (I-17): resolve which one before building.

**Remediation path**: `configure-e2ee-roles-and-policies`; `setup-forseti-e2ee` if multiple users must decrypt the same ciphertext.

**Honesty note**: E2EE requires online Fabric access — no offline decryption (I-11). Server-side batch processing of plaintext (search, analytics) stops working by design; flag this as a product decision, not a footnote. Data already exfiltrated before migration stays exposed.

---

## SG-07: Unilateral admin power

**What it looks like**: One admin account (or any member of an `admins` group) can create users, grant roles, change clients/config with no second approval. Includes the IdP root account and "break-glass" accounts that see daily use.

**Detect**:
```bash
# IdP config: does any change flow require a second approver? Usually no.
# App-level: look for admin mutation endpoints with single-role checks
grep -rn "role.*admin\|isAdmin" server/ app/api/ 2>/dev/null | grep -i "create\|grant\|assign\|delete\|update"
# Process check (ask the operator): can one person grant themselves a role in production?
```

**Trust concentration**: Each individual admin account. One phished admin = backdoor accounts, silent privilege grants, audit-log tampering. Procedural review (tickets, PR-style approval) is bypassable by whoever operates the console.

**Severity**: HIGH (CRITICAL when the same admin also controls the token-signing IdP — combine with SG-02).

**Tide replacement**: IGA / QEA (Quorum Enforced Authorization). Privileged admin writes are captured as **change requests** (the write returns HTTP 202 + a CR id and nothing applies) that must be **authorized (signed) then committed (replayed)** before they take effect. Same admin re-signing is rejected (four-eyes / 409); commit fails with 412 until the approval count meets the threshold. **The strength of this depends on the realm's mode** (`iga.attestor`):
- **Tide mode** (`iga.attestor=tide`, licensed realm): approvals are cryptographic — sealed VRK→Midgard→ORK network; no single admin, server, or vendor can bypass. This is the mode that delivers the "no single point of bypass" property (I-09/I-10). multiAdmin threshold = `max(1, floor(0.7 × active tide-realm-admins))`.
- **Tideless mode** (`iga.attestor=simple` or unset — the default on a non-licensed realm): the "signature" is the admin's recorded **username**; the quorum gate (distinct-signature count ≥ threshold + approver-role check) is enforced by TideCloak's own server logic. **No cryptography, no ORK, no threshold sealing.** It stops a lone honest admin and gives four-eyes, but a compromised TideCloak server or DB admin CAN bypass or forge it — it is a procedural control with a server-enforced gate, not a cryptographic one.

**VERIFIED** (mode split, CR lifecycle, thresholds: internal `tide-iga` QA skill + `tidecloak-iga-extensions/docs/qea-iga-api.md`. The change-request API surface is now `/iga/change-requests/...` across the pack — full spec in `canon/iga-change-requests-api.md`; see also the IGA-model note at the end of this file).

**Remediation path**: `setup-iga-admin-panel` (IGA is also part of standard bootstrap: `bootstrap-realm-from-template`). To get the cryptographic guarantee, the realm must be **Tide-licensed** (`iga.attestor=tide`), not Tideless.

**Honesty note**: Two limits, both load-bearing. (1) **Mode**: only Tide mode is cryptographic — do not claim "no single bypass" for a Tideless realm. Confirm `iga.attestor=tide` before making the strong claim. (2) **Collusion**: even in Tide mode, quorum protects against a compromised *minority* of admins; a colluding or simultaneously-phished quorum still commits. Size the admin set accordingly.

---

## SG-08: Standing privileged credentials in application code

**What it looks like**: Master admin username/password, service-account client secrets, or long-lived admin API keys in app config so the backend can call the IdP admin API.

**Detect**:
```bash
grep -rn "admin.*password\|client_secret\|service.account\|ADMIN_TOKEN\|master" -i .env* config/ server/ docker-compose* 2>/dev/null
grep -rn "grant_type=password\|grant_type=client_credentials" -i server/ src/ 2>/dev/null
```

**Trust concentration**: The credential itself. It is valid 24/7, scoped to everything, and leaks through env dumps, logs, and repo history.

**Severity**: CRITICAL.

**Tide replacement**: Server-side delegation. The server calls admin APIs on behalf of an authenticated user via short-lived (max 600s) threshold-signed delegation tokens, DPoP-bound through a two-hop chain of trust — no master admin credentials in the app, and delegation can be role-scoped via `requested_roles`. **VERIFIED** (`canon/feature-mapping.md` — Server-Side Delegation; `canon/delegation.md`).

**Remediation path**: `setup-server-delegation`.

**Honesty note**: Delegation covers admin-API calls driven by a real user's session. Fully autonomous background jobs that need admin power are a different problem — do not present delegation as covering them without checking `canon/delegation.md` for the supported patterns.

---

## SG-09: Procedural-only policy enforcement on high-value operations

**What it looks like**: Signing, payments, releases, or data-access decisions enforced by application `if`-statements or workflow tools. Whoever controls the server controls the policy.

**Detect**:
```bash
# Find the authorization decision point for the highest-value operation in the system.
# Ask: if this one process is compromised, does the policy still hold? If no — finding.
grep -rn "approve\|authorize\|policy" -i server/ src/ | grep -v test | head -40
```

**Trust concentration**: The single process (or single codebase) evaluating the policy.

**Severity**: HIGH for signing/financial operations, MEDIUM otherwise.

**Tide replacement**: Forseti policy contracts — real C# executed independently in every ORK's five-layer sandbox; majority of ORKs must approve; a compromised ORK (or your own compromised server) cannot override the policy. **VERIFIED** (`canon/feature-mapping.md` — Forseti; I-15).

**Remediation path**: `setup-forseti-e2ee` / `configure-e2ee-roles-and-policies`; scenario match first (`tide_choose_scenario`) — signing scenarios like policy-governed signing have dedicated reference apps.

**Honesty note**: Forseti governs operations that flow through Tide (signing, decryption). It does not retro-govern arbitrary business logic that never touches the Fabric. Scope claims precisely.

---

## SG-10: Remote key distribution for token verification

**What it looks like**: `createRemoteJWKSet`, fetching `/.well-known/jwks.json` or `/protocol/openid-connect/certs` at runtime to verify tokens.

**Detect**:
```bash
grep -rn "createRemoteJWKSet\|jwks_uri\|well-known/jwks\|openid-connect/certs" src/ server/ lib/ 2>/dev/null
```

**Trust concentration**: The network path and DNS between verifier and key endpoint at every cold start.

**Severity**: MEDIUM (an interception requires additional footholds, but silently substitutes the trust root).

**Tide replacement**: Embedded JWKS from the adapter JSON, verified local-only via `createLocalJWKSet(config.jwk)`. Missing `jwk` is a bootstrap failure to fix at the source, never a reason to fall back to remote fetch. **VERIFIED** (I-04).

**Remediation path**: `verify-jwt-server-side`.

**Honesty note**: For non-Tide IdPs, remote JWKS over TLS is standard practice; report this as a hardening delta of the Tide model, not as a vulnerability in the existing system, unless TLS validation is also broken.

---

## SG-11: Homegrown auth or crypto

**What it looks like**: Custom session-token formats, hand-rolled password reset tokens, custom crypto (XOR "encryption", homemade JWT parsing, `Math.random()` secrets).

**Detect**:
```bash
grep -rn "Math.random\|Date.now().*token\|md5\|sha1(" -i src/ server/ lib/ 2>/dev/null | grep -iv "test\|cache\|etag"
grep -rn "atob\|btoa\|base64" -i src/ server/ | grep -i "token\|auth\|session" 2>/dev/null
# Custom JWT parse without signature verification:
grep -rn "split('.')\|split(\"\.\")" src/ server/ | grep -i "token\|jwt" 2>/dev/null
```

**Trust concentration**: The author's cryptographic correctness. Usually multiple independent breaks.

**Severity**: CRITICAL until proven otherwise.

**Tide replacement**: Full replacement of the auth layer with TideCloak (standard OIDC surface, threshold-backed internals), not incremental patching. **VERIFIED** flow: `canon/feature-mapping.md` — Login/SSO.

**Remediation path**: `migrate-from-existing-auth` → standard sequence (`add-auth-nextjs-existing` → `protect-routes-nextjs` → `protect-api-nextjs` → `verify-jwt-server-side` → `add-rbac-nextjs`).

**Honesty note**: Migration must preserve existing user accounts and behavior — follow the migration playbook's inventory steps; do not rip and replace in one pass.

---

## SG-12: IdP vendor lock-in with no cryptographic exit

**What it looks like**: All identity and keys live inside a hosted IdP; leaving means re-enrolling every user; the vendor (or its compromise) is a permanent trust dependency.

**Detect**: Architecture question, not a grep: "If you had to leave your IdP in 90 days, what breaks?" Also: who besides you can reset your tenant's admin?

**Trust concentration**: The IdP vendor — commercially and cryptographically.

**Severity**: INFO (architectural; becomes HIGH during an actual vendor-compromise event).

**Tide replacement**: Ragnarok realm offboarding — quorum-approved, one-way key reconstruction that lets a realm exit to standalone Keycloak with zero ORK calls (the sole exception to I-01). **VERIFIED** (I-01 exception; internal QA exemplar exercises the full Backup ON → Trigger → Commit lifecycle).

**Remediation path**: No dedicated playbook in this pack yet — see `GAP_REGISTER.md`. Raise with the operator; do not improvise offboarding steps.

**Honesty note**: Offboarding surrenders threshold properties by design (keys become whole). It is an exit ramp, not a normal operating mode.

---

## SG-13: JWT algorithm confusion / unverified signature algorithm

**What it looks like**: Token verification that trusts the `alg` header, accepts `alg: none`, or verifies an RS256/ES256 token with a key loaded as an HMAC secret (public key used as HS256 secret → attacker forges tokens). Also: decoding a JWT without verifying it at all (`jwt.decode` / `atob` on the payload, then trusting claims).

**Detect**:
```bash
grep -rn "algorithms:\s*\[.*none\|alg.*none\|verify.*false\|jwt.decode\|jsonwebtoken.*decode" -i src/ server/ lib/ 2>/dev/null
# jwt.verify without an explicit algorithms allowlist = accepts whatever the header claims
grep -rn "jwt.verify\|jwtVerify" -i src/ server/ lib/ 2>/dev/null
# then confirm each call pins algorithms; a missing allowlist is the finding
# HS/RS confusion: same key material used for both signing and verifying (symmetric assumption)
grep -rn "verify.*process.env\|verify.*publicKey.*HS" -i src/ server/ 2>/dev/null
```

**Trust concentration**: The token's own header. If the verifier lets the token pick the algorithm, the attacker picks it too — `alg: none` or key-confusion means anyone mints valid tokens. This collapses even a well-guarded signing key (SG-02) to nothing.

**Severity**: CRITICAL when `alg: none` or unpinned algorithms are accepted; HIGH when tokens are decoded-without-verify on a non-authoritative path.

**Tide replacement**: Verification uses the embedded JWKS (`createLocalJWKSet(config.jwk)`) with the algorithm fixed by the key type (EdDSA), no header-driven algorithm selection and no remote key substitution. The signature itself is threshold-produced (SG-02), so a forged header has nothing valid to bind to. **VERIFIED** (`canon/invariants.md` I-04; `canon/feature-mapping.md` — JWT Verification).

**Remediation path**: `verify-jwt-server-side` (pins the algorithm and issuer, embedded JWKS only).

**Honesty note**: Pinning the algorithm and rejecting `alg: none` is standard-library hygiene that any correct verifier does — report the *current* state as the gap. Tide's contribution is that the verified signature is also threshold-backed, so fixing SG-13 the Tide way removes SG-02 at the same time rather than leaving a whole key behind the now-correct check.

---

## SG-14: Tamperable audit trail on privileged actions

**What it looks like**: Admin/security-relevant actions (role grants, config changes, user creation, permission edits) recorded only in application logs or a DB table that the same admins can edit or delete. No cryptographic integrity; the actor who performs an action can also erase the evidence.

**Detect**:
```bash
# Look for an audit table/log and ask: who can write/delete it?
grep -rn "audit\|activity_log\|event_log\|auditLog" -i src/ server/ migrations/ db/ 2>/dev/null
# If audit rows are written by the app with the same DB role that serves requests,
# and admins have DB or console access, the trail is tamperable.
# Process check (ask operator): can an admin delete the record of their own action?
```

**Trust concentration**: Whoever can write to the log store — application DB role, DBA, or any admin with console access. A compromised admin grants themselves a role and deletes the audit row; the tamper is invisible.

**Severity**: HIGH (governance/compliance-critical; CRITICAL when combined with SG-07 unilateral admin — one admin acts *and* covers the trail).

**Tide replacement — MODE-DEPENDENT, do not overclaim**: IGA / QEA captures privileged changes as change requests that carry a persisted authorization (signature) record. The tamper-evidence property depends on `iga.attestor`:
- **Tide mode** (`iga.attestor=tide`, licensed): the authorization is sealed cryptographically (VRK→Midgard→ORK network) and future JWT claims are verified against these proofs — no single admin, server, or DBA can forge or silently retract the record. This is the mode that actually makes the trail tamper-*evident*.
- **Tideless mode** (`iga.attestor=simple`/unset, default): the record is the approving admin's username stored in TideCloak's DB. It provides a four-eyes approval trail but has **no cryptographic integrity** — a DBA or a compromised TideCloak can alter or delete it just like any other audit table. Against the SG-14 threat (a privileged insider tampering with the store) Tideless mode is **not** a real improvement.

**VERIFIED** (mode split: internal `tide-iga` QA skill / `tidecloak-iga-extensions/docs`, 2026-06 staging). Also note: in current staging the Tide-mode `sign()` is still a SHA-256 stub (a known in-flight artifact) — the cryptographic sealing is the intended/target state, so tag a live deployment's actual guarantee against its build.

**Remediation path**: `setup-iga-admin-panel` (IGA is part of standard bootstrap: `bootstrap-realm-from-template`). Tamper-evidence requires a **Tide-licensed** realm.

**Honesty note**: Two limits. (1) **Mode**: the tamper-evidence claim holds only for Tide mode — for a Tideless realm, report SG-14 as *not meaningfully addressed* and point to standard append-only/audit controls. (2) **Scope**: even in Tide mode, IGA makes tamper-evident only the *authorization decisions it governs* — it is not a general-purpose immutable log for arbitrary application events, which still need their own controls (out of scope, below).

---

## SG-15: Weak session lifecycle (fixation, no rotation, long-lived sessions)

**What it looks like**: Session identifiers not rotated after login or privilege change (fixation); very long or non-expiring sessions; refresh tokens that never rotate; logout that doesn't invalidate server-side. Attacker who plants or captures a session id keeps access indefinitely.

**Detect**:
```bash
grep -rn "session\|maxAge\|expiresIn\|cookie" -i src/ server/ lib/ 2>/dev/null | grep -iv test | head -40
# Look for: no regenerate-on-login, maxAge measured in weeks/months, refresh tokens with no rotation
grep -rn "regenerate\|rotateToken\|session.regenerate" -i src/ server/ 2>/dev/null
# Absence of session regeneration on the login path = fixation exposure
```

**Trust concentration**: The lifetime of a single session artifact. One capture (or one pre-set id) = access for the whole (often unbounded) window.

**Severity**: MEDIUM (HIGH when sessions are effectively non-expiring or bearer tokens are long-lived — compounds SG-03).

**Tide replacement**: Standard OIDC authorization-code flow via TideCloak issues fresh threshold-signed tokens per authentication with bounded lifetimes (`accessTokenLifespan: 600`, `ssoSessionIdleTimeout: 1800`, `ssoSessionMaxLifespan: 36000` in the Tide realm defaults), and DPoP binds each token to a per-session key so a captured token is not replayable (SG-03). **VERIFIED** (`canon/feature-mapping.md` — Realm Initialization, DPoP; I-12).

**Remediation path**: `add-auth-nextjs-existing` (or `migrate-from-existing-auth`) to move onto the OIDC flow; `verify-jwt-server-side` for DPoP binding and expiry checks.

**Honesty note**: Adopting OIDC token lifetimes fixes fixation and unbounded sessions, but the relying app must still enforce `exp`/`iat` server-side (I-03) and not re-introduce its own long-lived session cookie alongside. Moving to Tide without dropping the legacy session store leaves the gap open.

---

## SG-16: No step-up / second approval on high-value operations

**What it looks like**: Irreversible or high-value actions (funds transfer, key export, bulk delete, production release, signing) authorized by the same single session that authorized reading a dashboard. No second factor, no second approver, no policy gate proportional to the stakes.

**Detect**:
```bash
# Identify the highest-value operations, then check the authority required to invoke them.
grep -rn "transfer\|payout\|withdraw\|delete.*all\|export.*key\|sign\|release\|deploy" -i server/ src/ 2>/dev/null | grep -iv test | head -40
# If the authorization for these is identical to any authenticated request, that is the gap.
```

**Trust concentration**: The single authenticated session. One phished session or one over-privileged token performs the highest-stakes action with no additional barrier.

**Severity**: HIGH for financial/signing/irreversible operations, MEDIUM otherwise.

**Tide replacement**: Two complementary mechanisms — Forseti policy contracts require a majority of ORKs to approve an operation against programmable rules (thresholds, executor checks, time windows) before it proceeds; IGA / QEA quorum requires multi-admin approval (change request → authorize → commit) for governed administrative changes. Forseti is always cryptographic (ORK-executed). IGA quorum is cryptographic **only in Tide mode** (`iga.attestor=tide`); in Tideless mode the quorum is username-based and server-enforced (see SG-07). Both make high-value authority multi-party rather than single-session. **VERIFIED** (`canon/feature-mapping.md` — Forseti; IGA mode split from internal `tide-iga` QA skill; I-10, I-15).

**Remediation path**: Scenario match first (`tide_choose_scenario` — signing/approval scenarios have dedicated reference apps); then `setup-forseti-e2ee` / `configure-e2ee-roles-and-policies` for operation policy, `setup-iga-admin-panel` for admin-change quorum.

**Honesty note**: Two scoping limits. (1) Forseti governs operations that flow through the Fabric (signing, decryption, policy-gated actions) — purely internal business operations that never call Tide are not automatically gated; the operation must be routed through a Tide-authorized flow for the policy to bind. Do not claim blanket step-up over all app actions. (2) For the IGA half, the "cryptographic, can't-be-bypassed" strength applies only to Tide mode — a Tideless realm's quorum is a server-enforced procedural gate.

---

## SG-17: User-held secrets stored server-readable

**What it looks like**: Secrets that belong to *users* — stored third-party API tokens, connected-account credentials, personal notes/vault entries, recovery codes — kept in plaintext or under a server-held key, so the application (and anyone who compromises it) can read every user's secrets.

**Detect**:
```bash
# Distinguish USER secrets (per-user, user-owned) from INFRA secrets (DB creds, service keys).
grep -rn "api_key\|access_token\|secret\|credential\|vault\|recovery_code" -i migrations/ db/ src/models server/models 2>/dev/null | grep -iv "process.env\|config"
# Per-user secret columns stored plaintext or app-decryptable = finding.
# INFRA secrets in env are SG-14-adjacent ops hygiene, NOT this gap — see honesty note.
```

**Trust concentration**: The application server and its key store. A DB dump plus the server key (or plaintext) discloses every user's stored secrets at once.

**Severity**: MEDIUM (HIGH for high-value stored credentials like connected financial/cloud accounts).

**Tide replacement**: Hermetic E2EE. Per-user secrets are encrypted such that decryption requires live Fabric threshold participation and the plaintext never exists on the server or any ORK; access is enforced against roles in the threshold-signed JWT. Use self-encryption when only the owning user decrypts, or policy-governed VVK encryption when defined others must (resolve which per I-17). **VERIFIED** (`canon/feature-mapping.md` — E2EE; I-11). This is the same mechanism as SG-06, applied specifically to secret material.

**Remediation path**: `configure-e2ee-roles-and-policies`; `setup-forseti-e2ee` if the secret must be shared/recoverable by others under policy.

**Honesty note**: This covers *user-owned* secrets. **Infrastructure secrets** — your own DB passwords, service-account keys, TLS private keys — are NOT this gap and are not Tide's domain; they belong to a secrets manager (out of scope, below). Also: E2EE requires online Fabric (I-11), so any server-side job that needs to *use* a stored user secret autonomously (e.g. a nightly sync using a user's API token) breaks by design — flag this as a product decision, not a footnote.

---

## SG-18: Machine/service identity via shared static secrets

**What it looks like**: Service-to-service calls authenticated with long-lived shared secrets, static API keys, or a service account whose credential sits in config on both sides. The same secret is valid indefinitely and grants a fixed, often broad, scope.

**Detect**:
```bash
grep -rn "api.key\|service.account\|shared.secret\|X-API-Key\|Bearer.*static\|client_credentials" -i server/ src/ config/ .env* 2>/dev/null
# Long-lived shared secret between services = the finding
```

**Trust concentration**: The shared secret. It leaks through config, logs, images, and CI on either side; anyone holding it impersonates the service for the credential's (usually unbounded) life.

**Severity**: HIGH.

**Tide replacement — PARTIAL, read carefully**: For service calls that act **on behalf of an authenticated user**, server-side delegation replaces the standing shared secret with short-lived (max 600s), DPoP-bound, threshold-signed delegation tokens scoped via `requested_roles` — no static secret in either service. **VERIFIED** (`canon/feature-mapping.md` — Server-Side Delegation; `canon/delegation.md`).

**Remediation path**: `setup-server-delegation` — **only** for user-driven service calls.

**Honesty note**: This is the most over-claimable mapping in the file — do not oversell it. **Autonomous machine-to-machine identity** with no user in the loop (a cron job, a webhook receiver, a data pipeline authenticating as itself) is NOT covered by delegation and has no clean Tide replacement in this pack today. For those, report the shared-secret gap and point to a secrets manager / workload-identity solution (out of scope, below), and log it against `GAP_REGISTER.md`. Claiming delegation covers headless service identity is a false finding.

---

## Out of scope: gaps Tide does NOT fix

Report these when found — classify as `NOT_ADDRESSED_BY_TIDE`, point to standard remediation, and never fold them into the Tide pitch:

| Gap class | Why Tide doesn't cover it |
|-----------|--------------------------|
| SQL/NoSQL/command injection | Application input handling; orthogonal to identity/keys |
| XSS / CSRF | Frontend/output encoding and same-site controls (note: DPoP limits what stolen tokens are worth, but XSS in a live session still acts as the user) |
| SSRF, path traversal | Application-layer input handling |
| Vulnerable dependencies | Supply chain hygiene (audit tooling, update policy) |
| Missing rate limiting / brute-force controls | Infra/middleware concern (TideCloak inherits Keycloak's brute-force settings for login, but your APIs need their own) |
| Infrastructure hardening (open ports, default creds on other services) | Ops concern |
| Logging/monitoring/alerting gaps | Ops concern |
| Business-logic flaws (IDOR beyond role checks, workflow abuse) | Tide enforces who; your code still decides what an authorized user may touch |

**Anti-pattern (AP-SEC-1)**: Presenting Tide as fixing a gap in this table. It destroys the credibility of the legitimate findings. The analysis is stronger when the out-of-scope list is visibly honest.

**Anti-pattern (AP-SEC-2)**: Reporting a trust concentration without evidence (file path, config value, or runtime observation). Every SG finding needs at least one concrete artifact, tagged VERIFIED (observed directly), INFERRED (strongly implied by observed code), or ASSUMED (operator statement, unconfirmed).

---

## IGA-model note (Tide vs Tideless, and a canon divergence)

Several findings (SG-07, SG-14, SG-16) depend on IGA / QEA (Quorum Enforced Authorization). Two things an analyst must hold:

1. **Mode determines whether IGA is a cryptographic control.** The realm attribute `iga.attestor` decides it:
   - `iga.attestor=tide` (licensed realm) — approvals sealed VRK→Midgard→ORK. Cryptographic; delivers "no single point of bypass." (Current staging note: the Tide-mode `sign()` is a SHA-256 stub in flight — verify a live deployment's actual build before asserting the full crypto guarantee.)
   - `iga.attestor=simple` or unset (Tideless, the default) — the "signature" is the approving admin's **username**, quorum enforced by TideCloak server logic. Four-eyes and approver-role gating, but **no cryptography**; a compromised server or DBA can bypass/forge. For SG-14 (tamper-evidence) this means Tideless mode is *not* a real fix.

   **Always confirm `iga.attestor` before making a cryptographic claim.** Detect: realm attribute (`GET /admin/realms/{realm}` → attributes) or presence of a `tide-vendor-key` component (Tide mode) vs its absence (Tideless).

2. **API-surface migration (direction CONFIRMED by Tide 2026-07-07).** The QEA model above (change requests captured as HTTP 202; per-id `authorize` → `commit`; four-eyes 409; quorum-unmet 412; base path `/admin/realms/{realm}/iga/change-requests/...`; batch `POST /iga/bulk-authorize`; enable via `isIGAEnabled="true"` / `POST /tide-admin/toggle-iga`; Phase-6 ADOPT scan) is iga-core's surface and **replaces** the legacy `/admin/realms/{realm}/tide-admin/change-set/sign|commit/batch`. This resolves the earlier "which surface is canonical" question (GAP-065): the new `/iga/change-requests/...` surface is authoritative. Reconciliation is done: the full spec is in `canon/iga-change-requests-api.md`, and canon, playbooks, bootstrap scripts, and reference-apps now use the new surface (the bootstrap approve/commit loop is VERIFIED-against-spec / REQUIRES_RUNTIME_VALIDATION). For a **security analysis** (capability mapping) the mode-split model above is authoritative. For **building/bootstrapping**, follow `canon/iga-change-requests-api.md`. Tracked in `GAP_REGISTER.md` GAP-065.

---

## Verification

To check this file is being used correctly by an analysis:
1. Every finding cites an SG id from this file (or `NOT_ADDRESSED_BY_TIDE`).
2. Every SG finding includes evidence with a confidence tag.
3. Every remediation names a playbook that exists in `playbooks/` (run `tide_list playbooks` to confirm).
4. The report contains a non-empty out-of-scope section, or an explicit statement that none were found.

## Status Legend

- **VERIFIED** — claim sourced from `canon/` files that carry their own verified sourcing, or from operational exemplars
- **INFERRED** — strongly implied by source material
- **ASSUMED** — operator guidance (all detection commands unless tagged otherwise)
