# Can This App Be Tidified? — Compatibility Canon

**"It uses Keycloak" does not mean it can be tidified.** Tide is built on **EdDSA (Ed25519)**
signatures, and that single fact disqualifies a large amount of otherwise Keycloak-compatible
software. Establish compatibility **before** promising a migration.

This page exists because the pack previously told operators *"No code changes needed. Same SDK, same
OIDC protocol. The application does not need to know it is talking to TideCloak instead of Keycloak."*
That is **false**, and the algorithm is only the first reason.

---

## The measurement

Tidifying a realm **changes the token signature algorithm.** MEASURED on
`tideorg/tidecloak-dev:latest`, 2026-08-13:

| Realm | `defaultSignatureAlgorithm` | Ed25519 (OKP) signing key |
|---|---|---|
| `master` (not Tide-enabled) | `RS256` | absent |
| `myrealm` (not Tide-enabled) | `RS256` | absent |
| **`noted` (Tide-enabled, `iga.attestor=tide`)** | **`EdDSA`** | **present** |

App clients carry no explicit signature attribute, so they **inherit the realm default** — meaning
every token the application receives is `alg: EdDSA` once the realm is Tide-enabled. A real
non-Tide token header for contrast: `{"alg":"RS256","typ":"JWT","kid":"..."}`.

**This is not a configuration preference to switch off.** Tide's token signing *is* threshold Ed25519
across the ORK network — the VVK is an Ed25519 key. Forcing RS256 would mean the TideCloak server
signing tokens by itself, which is the exact property Tide exists to remove (I-02, I-09). If your
verifier cannot do EdDSA, the verifier has to change; the realm cannot.

---

## What EdDSA breaks

Two distinct failure modes, and the second is sneakier:

1. **The verifier has no Ed25519 implementation at all.** Signature validation fails on every request.
2. **The verifier supports EdDSA but is *pinned* to RS256.** An algorithm allowlist —
   `algorithms: ['RS256']`, `ValidAlgorithms`, `alg` filters in a gateway policy — rejects a
   perfectly good token. This is *correct* security hygiene (never let the token pick the algorithm,
   SG-13) and it is why pinning is so common. The fix is to change the pin to `EdDSA`, not to remove it.

### VERIFIED cases

| Verifier | EdDSA? | Evidence |
|---|---|---|
| Node **`jose`** | **Yes** | `EdDSA` in its type surface; this is what the pack's `createLocalJWKSet` path uses |
| Node **`jsonwebtoken`** | **NO** | Its algorithm allowlist is `HS*/RS*/ES*/PS*` only — **zero** occurrences of `EdDSA`/`ed25519` in the shipped bundle |
| .NET **`Microsoft.IdentityModel.Tokens`** | **NO** | T-23. `Tide.Asgard.Core` ships an EdDSA `SignatureProvider` *specifically because* the stock stack lacks one — wire `IssuerSigningKey = Utils.GetEd25519IssuerKey(...)` |

`jsonwebtoken` is one of the most widely used JWT libraries in Node. An app built on it **cannot
verify a TideCloak token** without swapping libraries. That is a code change, and it is not a small one
if verification is spread across a codebase.

### Everything else: DETERMINE, do not assume

Do **not** trust a general claim that a language or framework "supports EdDSA" — support is usually
per-library, often behind an optional dependency, and sometimes version-gated. Check the actual
project:

```bash
# Node — which JWT library, and is it EdDSA-capable?
grep -rn "jsonwebtoken\|jose\|jwks-rsa\|express-jwt" package.json
# jwks-rsa + jsonwebtoken is the classic RS256-only combination.

# Any language — find algorithm pins that will reject EdDSA
grep -rniE "algorithms?\s*[:=]\s*\[?['\"]RS256|RS256['\"]|ValidAlgorithms|signatureAlgorithm" \
  --include=*.ts --include=*.js --include=*.py --include=*.go --include=*.java \
  --include=*.cs --include=*.rb --include=*.php --include=*.json --include=*.yaml .

# Python
grep -rn "PyJWT\|python-jose\|authlib" requirements*.txt pyproject.toml 2>/dev/null
# Java
grep -rn "nimbus-jose-jwt\|jjwt\|bouncycastle" pom.xml build.gradle* 2>/dev/null
# Go
grep -rn "golang-jwt/jwt\|lestrrat-go/jwx" go.mod 2>/dev/null
```

Then prove it with a real token rather than reading docs: fetch one from the Tide-enabled realm and
run it through the app's own verification path. A library that silently accepts an unverified token is
a worse outcome than one that rejects it (SG-13).

### Infrastructure in the token path is the most likely blocker

If anything **other than your code** validates the JWT, it must also do EdDSA — and this is where
migrations die, because it is usually outside the app team's control:

- API gateways and ingress JWT filters
- managed authorizers in front of serverless functions
- reverse proxies terminating auth
- SaaS products that accept OIDC but pin RS256
- anything consuming TideCloak as an upstream OIDC provider

**The pack asserts nothing about specific products here** — support varies by version and edition, and
a wrong claim is worse than no claim. Test the actual deployment with a real EdDSA token before
committing to the migration.

---

## The rest of the gate — EdDSA is necessary, not sufficient

Even with an EdDSA-capable verifier, these constrain how much of an app can be tidified:

| Constraint | Consequence | Reference |
|---|---|---|
| **JWKS must come from the adapter**, not the remote endpoint | `createLocalJWKSet(config.jwk)`; a remote-JWKS verifier is a code change *and* AP-01. Note the realm's OIDC JWKS also serves an RSA key — pointing a verifier there can yield the **wrong key** with a 200 | I-04, AP-01, GAP-071 |
| **No headless / service-account auth** | Machine-to-machine, CLI tools, cron jobs and background workers **cannot** obtain a Tide identity. PRISM needs the browser enclave | GAP-064, `agent-authority.md` |
| **ORK signing is browser-only** | No server-side signing or E2EE. A bulk importer or batch job cannot sign | GAP-063 |
| **DPoP is four pieces of client wiring** | Relay page, wildcard rewrite, per-path CSP + `Allow-CSP-From`, and `secureFetch` with absolute URLs | I-12, AP-62, AP-70/71/73/74 |
| **Post-auth handler at `/auth/redirect`** | Not `/auth/callback`. Omitting it 404s **silently** | I-16, AP-REDIR-01 |
| **The SDK surface is NOT keycloak-js** | `@tidecloak/*` only partially overlaps. `tokenParsed` does not exist; use `getValueFromToken(key)` | AP-69 |
| **asgard .NET + IGA** | The .NET SDK does not work against IGA-enabled realms today — so a .NET app cannot have both governance and Tide auth | `protect-aspnet-core-asgard.md` |
| **Non-browser clients** (native/mobile/desktop) | Must host a browser context for the enclave | GAP-063/064 |

---

## Verdicts — say which one, and why

Use these words, and never round upward:

| Verdict | Meaning |
|---|---|
| **FULLY TIDIFIABLE** | Browser-based app, EdDSA-capable verifier under your control, adapter JWKS, DPoP wired. Everything in the token path handles EdDSA. |
| **PARTIALLY TIDIFIABLE** | Interactive user paths can be tidified; some surface cannot — typically machine-to-machine, batch jobs, or a gateway you do not control. **Name the excluded surface explicitly** and what still guards it. |
| **NOT TIDIFIABLE (as built)** | Something structural blocks it: an EdDSA-incapable verifier you cannot change, a headless-only auth model, or a fixed third-party JWT consumer. Say what would have to change first. |

A partial migration is a legitimate, often correct outcome. **Presenting a partial migration as a
complete one is the failure this page exists to prevent** — the excluded surface keeps its original
exposure, and a security write-up that implies otherwise is wrong in the direction that matters.

---

## Anti-patterns

- **"It uses Keycloak, so it will work"** — the algorithm changes; that is the whole point of AP-82.
- **Promising "no code changes needed."** At minimum the JWKS source changes; usually DPoP and the
  redirect handler too; often the JWT library.
- **Asserting a third-party product supports EdDSA without testing it.** Version- and edition-dependent.
- **Removing an algorithm pin to "fix" validation.** Repin to `EdDSA`; an unpinned verifier accepts
  whatever the token claims (SG-13).
- **Counting a partial migration as complete.** Name the excluded surface.
- **Forcing the realm to RS256 to keep an old verifier.** That puts the TideCloak server back in
  possession of a whole signing key and removes the property you migrated for.

---

## Related

- [troubleshooting.md](troubleshooting.md) → T-23 (the .NET EdDSA case), Error-Text Lookup
- [framework-matrix.md](framework-matrix.md) → per-framework verification, Browser Prerequisites
- [invariants.md](invariants.md) → I-02, I-04, I-09, I-12, I-16
- [agent-authority.md](agent-authority.md) → why headless cannot hold a Tide identity
- [playbooks/migrate-from-existing-auth.md](../playbooks/migrate-from-existing-auth.md) → the migration itself
- `templates/tidify-preflight/` → a script that runs the checks above against a project
