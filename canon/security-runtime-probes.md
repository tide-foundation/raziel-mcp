# Security Runtime Probes

Turns **INFERRED** static findings into **VERIFIED** ones by observing the live target's actual behavior. This is the second tier of the `tide-security-analyst` workflow: static inspection finds *candidate* gaps in code; runtime probing *confirms* which are real against the running system.

A static finding says "this route appears unprotected." A runtime probe says "this route returned 200 with no credentials — here is the response." The second is evidence; the first is a hypothesis.

---

## Authorization gate — read before probing anything

Runtime probing sends real requests to a real system. It is only permitted when **all** of these hold. If any is unmet, stop and stay in static-only mode.

1. **Explicit authorization.** The operator owns the target or has written authorization to test it. Confirm this in the report's scope line. No probing of third-party systems on a hunch.
2. **Non-production or agreed window.** Probing production is allowed only with explicit operator consent; prefer staging. Never probe a system you were merely *shown*, only one you were *asked to test*.
3. **Target is a network endpoint the operator named.** Do not discover-and-probe adjacent hosts, subdomains, or internal services you happened to find in config.

**Absolute limits — these are not "best-effort", they are the boundary of this role:**

- **Non-destructive only.** GET and safe HEAD/OPTIONS. Never send probes that create, modify, or delete data. For write endpoints, confirm the *auth response* (401/403 vs 200) using a request the server rejects *before* it mutates — never complete a mutating call to "see if it works."
- **No exploitation.** Confirm a gap exists; do not weaponize it. Reaching an unauthorized endpoint and reading one response header confirms SG-05. Dumping the database behind it does not — that is an attack, not an analysis.
- **No credential attacks.** No brute force, no password spraying, no token cracking, no fuzzing that could lock accounts or trip abuse defenses. Observing that no rate limit exists is a note (out of scope, not a Tide gap); actually exhausting it is not permitted.
- **Rate-limited and low-volume.** A handful of deliberate requests per finding, not a scan. You are confirming named hypotheses, not enumerating the attack surface.
- **Stop on the first confirmation.** Once a probe confirms a finding, record it and move on. Do not escalate.

If the operator asks for active exploitation, penetration testing, or load/abuse testing, that is a different engagement with different rules — decline within this role and say so.

---

## How probing upgrades evidence

Each finding carries a confidence tag (`canon/security-gap-mapping.md`). Runtime probes move findings up this ladder:

| Before (static) | Probe | After |
|---|---|---|
| INFERRED — route has no visible auth in code | Unauthenticated GET returns 200 with data | **VERIFIED** |
| INFERRED — bearer tokens, no DPoP handling seen | Replay a captured token from a second client; it is accepted | **VERIFIED** (replayable) |
| ASSUMED — operator says "we verify JWTs" | Send a token with `alg: none` / tampered payload; it is accepted | **VERIFIED** (SG-13 real) |
| INFERRED — remote JWKS fetch in code | Observe a JWKS request to the certs endpoint at verification time | **VERIFIED** (SG-10) |

A probe that *fails to confirm* is just as valuable: it downgrades or drops a false positive. Record both outcomes. A finding that survived a probe attempt is far stronger than one that was only read from code.

---

## Probe procedures by gap

Each probe: the observation that confirms the gap, the safe request to make, and how to read the result. `$T` = the operator-named base URL.

### SG-04 / SG-05 — client-only authz / unprotected APIs

**Confirms**: an endpoint enforces nothing server-side.

```bash
# Enumerate candidate routes from static analysis, then for each sensitive one:
curl -s -o /dev/null -w "%{http_code}\n" "$T/api/<route>"
# 200 with no Authorization header on a sensitive route = CONFIRMED unprotected (SG-05)
# Compare: same route WITH a valid session vs WITHOUT — identical output = no server-side check (SG-04)
curl -s "$T/api/<route>" | head -c 300   # inspect: is real data returned unauthenticated?
```
Read: 401/403 unauthenticated = protected (drop/downgrade the finding). 200 with data = confirmed. 200 with an empty/error body = ambiguous, note it, do not overclaim.

### SG-03 — bearer token replay (no proof-of-possession)

**Confirms**: a stolen token works from anywhere, no key binding.

```bash
# With operator-provided test token (their own session), replay from a clean client / different IP context:
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TESTTOKEN" "$T/api/<protected>"
# 200 with a plain replayed bearer and no DPoP header = CONFIRMED replayable (SG-03)
# If the server demands a fresh DPoP proof, it will reject the bare bearer.
```
Read: acceptance of a bare replayed bearer confirms the gap. Use only a token the operator supplied from their own account.

### SG-13 — JWT algorithm confusion / unverified signature

**Confirms**: the verifier trusts the token's claimed algorithm or skips verification.

```bash
# Using the operator's own valid token as a base, craft a NON-mutating GET with:
#  (a) alg swapped to "none" and signature stripped, or
#  (b) a modified claim (e.g. a role) re-signed with an empty/guessed key
# Send to a read-only protected route and observe acceptance.
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $FORGED" "$T/api/<protected>"
# 200 = CONFIRMED the signature is not properly verified (SG-13 / SG-02 exposure)
```
Read: this is the one probe that constructs a token — keep it read-only, use the operator's own account as the base, and do not use any elevated claim to perform an action. Acceptance confirms; rejection (401) means the verifier is sound on this vector. Never chain a confirmed forgery into a real privileged operation.

### SG-10 — remote JWKS fetch

**Confirms**: the verifier fetches keys over the network at verification time.

```bash
# Observe from the operator's own logs/network capture whether a request goes to
# /.well-known/jwks.json or /protocol/openid-connect/certs during token verification.
curl -s -o /dev/null -w "%{http_code}\n" "$T/.well-known/jwks.json"
# Endpoint existing is not proof of use; correlate with a verification-time fetch in the app's egress logs.
```
Read: confirmation requires observing the *app* fetch keys during verify, not just that the endpoint responds. If you can only see the endpoint, keep the finding INFERRED.

### SG-06 / SG-17 — server-readable sensitive data / user secrets

**Confirms**: sensitive data is returned in the clear or is app-decryptable.

```bash
# With the operator's authorization, request a record the authenticated user owns:
curl -s -H "Authorization: Bearer $TESTTOKEN" "$T/api/<record>" | head -c 500
# Plaintext sensitive fields in the response = server can read them (SG-06/SG-17 confirmed for data-in-transit-from-server)
```
Read: plaintext in the API response proves the server holds readable data. Do NOT attempt to reach other users' records to "prove" IDOR — that is exploitation and a separate (out-of-scope) class. Confirm only against the operator's own test account.

### SG-15 — session lifecycle

**Confirms**: sessions don't rotate / don't expire as claimed.

```bash
# Non-destructive: capture the session id/cookie before and after login with the operator's test account.
# Same id after authentication = no rotation (fixation exposure). Operator drives the login; you observe.
# For expiry: note token exp; re-use after the claimed lifetime in a read-only call.
```
Read: an unrotated identifier across a privilege boundary confirms fixation exposure. Observe only; the operator performs the login.

### SG-01 / SG-02 — surface confirmation only

These are confirmed from **artifacts**, not live probing: a schema showing a password-hash column (SG-01), a signing secret visible in the operator-shared config/env (SG-02). Do not attempt to crack hashes or extract keys — possession of the artifact plus its role in the auth path is the confirmation. Keep these static.

---

## Probes that are NOT allowed in this role

- Reaching **other users'** data to demonstrate IDOR/broken-object-level-authz (exploitation; also an out-of-scope class per `canon/security-gap-mapping.md`).
- Any **write/delete** to confirm a mutating endpoint is unprotected — confirm via the auth-layer response before the mutation, never by completing it.
- **Injection, XSS, SSRF, traversal** payloads — these confirm out-of-scope classes and constitute active exploitation.
- **Rate-limit / brute-force / load** testing — a different engagement.
- Probing anything the operator did not explicitly name as in scope.

Finding one of these classes statically is reportable (in the out-of-scope section); *actively exploiting* it to confirm is not part of this role.

---

## Recording probe results

For every probe, the finding in the report gains a **Runtime confirmation** line:

```
- Runtime confirmation: <exact request> → <observed response, e.g. "200, JSON with 14 user records, no auth header"> [VERIFIED]
```

or, when a probe failed to confirm:

```
- Runtime confirmation: <request> → <e.g. "401 Unauthorized"> — finding NOT confirmed at runtime; downgraded to <INFERRED/dropped>
```

A report that ran the runtime tier states, in its Method line, `both (static + runtime)` and lists which SG findings were probed. Findings that were *only* inferred and not probed stay tagged INFERRED — never present an unprobed hypothesis as though it were confirmed.

---

## Verification (of this probe pass)

- [ ] Authorization and scope confirmed in writing before any request was sent.
- [ ] Every probe was non-destructive (no create/update/delete completed).
- [ ] No probe reached data outside the operator's own test account.
- [ ] No out-of-scope class was actively exploited to "confirm" it.
- [ ] Each probed finding has a Runtime confirmation line with the exact request and observed response.
- [ ] Findings not probed remain tagged at their static confidence level.

## Anti-Patterns

- **AP-SEC-7** — Probing a system the operator showed but did not authorize testing. Authorization is per-target and explicit.
- **AP-SEC-8** — Completing a mutating request to "check if it's protected." Confirm at the auth layer; never mutate.
- **AP-SEC-9** — Escalating a confirmed gap into exploitation (dumping data, reaching other accounts, chaining a forged token into a real action). Confirm and stop.
- **AP-SEC-10** — Presenting an unprobed static hypothesis with runtime-level confidence. Only a probe upgrades the tag.

## Status Legend

- **VERIFIED** — observed directly (static artifact or runtime response)
- **INFERRED** — strongly implied by code, not yet probed
- **ASSUMED** — operator statement, unconfirmed
