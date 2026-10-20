/**
 * RFC 9449 DPoP proof verification for a Tide resource server.
 *
 * WHY THIS EXISTS
 * ---------------
 * `useDPoP: { mode: 'strict' }` makes TideCloak issue sender-constrained tokens: the access token
 * carries `cnf.jkt`, the thumbprint of a key the browser holds, and `secureFetch` sends a signed
 * `DPoP` proof alongside it.
 *
 * **None of that protects anything unless the RESOURCE SERVER verifies the proof.** If your API
 * only checks the JWT signature, a stolen token replays as a plain `Bearer` and succeeds — the
 * binding is decorative. That was measured live: a bare-Bearer replay of a bound token returned
 * `200` (LEARNINGS-nightfabric-001 L-01).
 *
 * An earlier pack revision claimed `secureFetch` sends "a Tide-specific format, not standard
 * RFC 9449 compact JWS" and told you to skip this. That is false. Measured against
 * `@tidecloak/js@0.14.20` (`lib/tidecloak-dpop.js`, `generateDPoPProof`), the proof is an ordinary
 * compact JWS:
 *
 *     header  { alg, typ: "dpop+jwt", jwk: { crv, kty, x, y } }
 *     payload { jti, htm, htu, iat, ath?, nonce? }
 *
 * The likely cause of that report's `Invalid Compact JWS` was verifying with the REALM's public key
 * instead of the `jwk` embedded in the proof's own header. A DPoP proof is signed by the client's
 * ephemeral key — it is self-describing, and that is the point.
 *
 * USAGE
 * -----
 *   const claims = await verifyTideJWT(token);          // your existing signature/iss/azp check
 *   await verifyDpop(req, token, claims);               // throws if the binding does not hold
 *
 * Both are required. Neither replaces the other.
 */

import { jwtVerify, importJWK, calculateJwkThumbprint, decodeProtectedHeader, type JWK } from "jose";

export class DpopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DpopError";
  }
}

/** Replace with Redis/Postgres for multi-instance deployments — see "Replay" below. */
export interface JtiStore {
  /** true if this jti has NOT been seen before (and records it). */
  claim(jti: string, expiresAtMs: number): Promise<boolean>;
}

const IAT_SKEW_SECONDS = 300;

/**
 * In-memory default. Correct for a single process ONLY.
 *
 * A serverless deployment runs many isolated instances, so a per-instance Set does not prevent
 * replay — it merely makes it less likely, which is worse than not claiming the protection at all.
 * Ship a shared store before relying on the replay check (AP-44 covers the same trap for rate
 * limits and sessions).
 */
export class MemoryJtiStore implements JtiStore {
  private seen = new Map<string, number>();
  async claim(jti: string, expiresAtMs: number): Promise<boolean> {
    const now = Date.now();
    for (const [k, exp] of this.seen) if (exp < now) this.seen.delete(k);
    if (this.seen.has(jti)) return false;
    this.seen.set(jti, expiresAtMs);
    return true;
  }
}

/**
 * The absolute URL the CLIENT saw, which is what it signed into `htu`.
 *
 * Behind a proxy or tunnel (cloudflared, a load balancer, Vercel), `req.nextUrl.origin` is the
 * INTERNAL origin — `https://localhost:3000` — not the host the browser used. Comparing that to
 * `htu` rejects every legitimate request, so the app 401s entirely the moment it goes behind a
 * reverse proxy. Measured: `x-forwarded-host` + `x-forwarded-proto` reconstruct the true origin in
 * both the tunnelled and the direct-localhost case (LEARNINGS-nightfabric-001 L-02).
 *
 * ⚠️ Only trust these headers when a proxy you control sets them. Directly exposed to the internet,
 * a client can forge `x-forwarded-host` and choose its own `htu` — pass `trustForwardedHeaders:
 * false` in that case.
 */
export function requestHtu(
  req: { url: string; headers: { get(name: string): string | null } },
  trustForwardedHeaders = true,
): string {
  const url = new URL(req.url);
  if (trustForwardedHeaders) {
    const host = req.headers.get("x-forwarded-host");
    const proto = req.headers.get("x-forwarded-proto");
    if (host) {
      // `x-forwarded-*` may be a comma-separated chain; the first entry is the original client-facing value.
      const h = host.split(",")[0].trim();
      const p = (proto?.split(",")[0].trim()) || url.protocol.replace(":", "");
      return `${p}://${h}${url.pathname}`;
    }
  }
  // The SDK signs `origin + pathname` — no query string. Matching on the full URL fails every
  // request that carries one.
  return `${url.origin}${url.pathname}`;
}

export interface VerifyDpopOptions {
  jtiStore?: JtiStore;
  trustForwardedHeaders?: boolean;
  /** Accept a wider iat window. Default 300s. */
  iatSkewSeconds?: number;
}

const defaultStore = new MemoryJtiStore();

/**
 * Verify the DPoP proof on a request. Throws `DpopError` if the binding does not hold.
 *
 * @param req         the incoming request (Next.js `NextRequest` or any Fetch `Request`)
 * @param accessToken the raw access token string, as presented
 * @param claims      the VERIFIED access-token claims (must already have passed signature checks)
 */
export async function verifyDpop(
  req: { url: string; method: string; headers: { get(name: string): string | null } },
  accessToken: string,
  claims: { cnf?: { jkt?: string } },
  opts: VerifyDpopOptions = {},
): Promise<void> {
  const jkt = claims.cnf?.jkt;

  // A token WITHOUT cnf.jkt is not sender-constrained. Do not silently accept it here: if your realm
  // issues bound tokens, an unbound one is either a downgrade attempt or a misconfigured client.
  if (!jkt) {
    throw new DpopError(
      "Access token has no cnf.jkt — it is not sender-constrained. Enable useDPoP on the client; " +
        "accepting it here would make DPoP optional, which is the same as not having it.",
    );
  }

  // The scheme matters. This is the exact replay that succeeded when only the signature was checked:
  // a bound token presented as `Bearer` must be rejected, or the binding buys nothing.
  const authz = req.headers.get("authorization") ?? "";
  if (!/^DPoP /i.test(authz)) {
    throw new DpopError(
      "Sender-constrained token presented without the DPoP auth scheme. A cnf.jkt token sent as " +
        "`Bearer` is a replay of a stolen token.",
    );
  }

  const proof = req.headers.get("dpop");
  if (!proof) throw new DpopError("Missing DPoP proof header.");

  let header: ReturnType<typeof decodeProtectedHeader>;
  try {
    header = decodeProtectedHeader(proof);
  } catch {
    throw new DpopError("DPoP proof is not a compact JWS.");
  }
  if (header.typ !== "dpop+jwt") throw new DpopError(`DPoP proof typ is '${header.typ}', expected 'dpop+jwt'.`);
  const jwk = header.jwk as JWK | undefined;
  if (!jwk) throw new DpopError("DPoP proof header has no embedded jwk.");

  // Verify with the key the proof carries — NOT the realm key. This is the step the older,
  // withdrawn guidance got wrong, and the reason it concluded the format was non-standard.
  let payload: Record<string, unknown>;
  try {
    const key = await importJWK(jwk, header.alg);
    ({ payload } = (await jwtVerify(proof, key)) as { payload: Record<string, unknown> });
  } catch (e) {
    throw new DpopError(`DPoP proof signature invalid: ${e instanceof Error ? e.message : String(e)}`);
  }

  // The binding itself: the proof's key must be the key the token was issued against.
  const thumb = await calculateJwkThumbprint(jwk, "sha256");
  if (thumb !== jkt) {
    throw new DpopError("DPoP proof key does not match the token's cnf.jkt — token and proof come from different keys.");
  }

  // ath ties the proof to THIS access token, so a proof captured from one request cannot be
  // replayed with a different stolen token.
  const expectedAth = base64url(await sha256(accessToken));
  if (payload.ath !== expectedAth) {
    throw new DpopError("DPoP proof `ath` does not match the presented access token.");
  }

  if (typeof payload.htm !== "string" || payload.htm.toUpperCase() !== req.method.toUpperCase()) {
    throw new DpopError(`DPoP proof htm '${String(payload.htm)}' does not match ${req.method}.`);
  }

  const htu = requestHtu(req, opts.trustForwardedHeaders ?? true);
  if (payload.htu !== htu) {
    throw new DpopError(
      `DPoP proof htu '${String(payload.htu)}' does not match '${htu}'. Behind a proxy this is ` +
        "usually x-forwarded-host not being honoured, not an attack.",
    );
  }

  const skew = opts.iatSkewSeconds ?? IAT_SKEW_SECONDS;
  const iat = typeof payload.iat === "number" ? payload.iat : NaN;
  if (!Number.isFinite(iat) || Math.abs(Date.now() / 1000 - iat) > skew) {
    throw new DpopError(`DPoP proof iat is outside the ±${skew}s window.`);
  }

  const jti = payload.jti;
  if (typeof jti !== "string" || !jti) throw new DpopError("DPoP proof has no jti.");
  const store = opts.jtiStore ?? defaultStore;
  if (!(await store.claim(jti, Date.now() + skew * 1000))) {
    throw new DpopError("DPoP proof jti already used — replay.");
  }
}

async function sha256(s: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
}

function base64url(buf: ArrayBuffer): string {
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
