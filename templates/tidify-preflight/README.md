# Tidify Pre-Flight — can this app actually be tidified?

```bash
./check-tidify.sh /path/to/app
```

Run this **before** promising a migration. `"It uses Keycloak"` does not mean it can be tidified.

## The one fact that decides most cases

**Tidifying a realm changes the token signature algorithm from RS256 to EdDSA.** MEASURED on
`tideorg/tidecloak-dev:latest`:

| Realm | `defaultSignatureAlgorithm` | Ed25519 (OKP) key |
|---|---|---|
| non-Tide | `RS256` | absent |
| **Tide-enabled** | **`EdDSA`** | **present** |

Clients inherit the realm default, so every token the app receives becomes `alg: EdDSA`. **This is not
revertible**: Tide's signing *is* threshold Ed25519, and forcing RS256 would put a whole signing key
back on the TideCloak server — the property you migrated to remove. The verifier changes; the realm
cannot.

## What the script checks

| # | Check | Why |
|---|---|---|
| 1 | JWT library capability | `jsonwebtoken` has **no** EdDSA (allowlist is `HS*/RS*/ES*/PS*`); `jwks-rsa` is remote-JWKS + RS256; stock .NET has none (T-23). `jose` does |
| 2 | Algorithm **pins** | `algorithms: ['RS256']` rejects a valid token. **Repin to EdDSA — never unpin** (SG-13) |
| 3 | Remote JWKS usage | Must become `createLocalJWKSet(config.jwk)` (I-04, AP-01) |
| 4 | Machine-to-machine surfaces | No headless Tide identity (GAP-063/064) — these stay excluded |
| 5 | What it cannot see | Gateways, managed authorizers, proxies, SaaS consumers |

## It reports evidence, not a verdict

Exit 1 means "likely blocker found", not "impossible". Exit 0 is **not a clearance** — sections 4 and 5
need a human. Classify the app yourself:

**FULLY** / **PARTIALLY** (name the excluded surface) / **NOT TIDIFIABLE (as built)** (say what would
have to change). A partial migration is a fine outcome; presenting it as complete is not.

## Comment hits are notes, not blockers

A good codebase documents the rules it follows. `music-license` contains the lines
*"createRemoteJWKSet is forbidden here"* and *"The VVK is Ed25519 and is NOT there"* — a naive grep
flags all of them and reports a **compliant** app as broken. So a match whose line opens with a comment
marker is reported as a note. A checker that punishes a codebase for explaining itself teaches people
to ignore the checker.

The classifier is deliberately simple and errs toward calling things code: it does not track block
comments or string literals across lines. A false note would hide a real finding; a false code hit
costs one glance.

## Verified behaviour

- **`music-license`** (a working Tide app): exit **0**, `jose` recognised, and its three
  `createRemoteJWKSet` / `certs` mentions correctly reported as *"documented, not used"*
- **a synthetic legacy Keycloak app** (`jsonwebtoken` + `jwks-rsa` + `algorithms: ['RS256']` +
  a `client_credentials` worker): exit **1**, 3 blockers, and the excluded machine-to-machine surface named
- output is clipped to 160 columns per line — a generated file can be a single 148 KB line, and an
  early version dumped one

## Related

- [canon/tidify-compatibility.md](../../canon/tidify-compatibility.md) — the full gate and the verdicts
- [canon/anti-patterns.md](../../canon/anti-patterns.md) — AP-82
- [playbooks/migrate-from-existing-auth.md](../../playbooks/migrate-from-existing-auth.md) — the migration
- [canon/troubleshooting.md](../../canon/troubleshooting.md) — T-23 (.NET EdDSA)
