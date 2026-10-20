/**
 * Proves verifyDpop.ts actually rejects what it claims to. Security code that has not been run
 * against its own failure modes is a claim, not a control.
 *
 * The proofs here are built EXACTLY as `@tidecloak/js@0.14.20` builds them
 * (`lib/tidecloak-dpop.js` -> `generateDPoPProof`): a compact JWS with
 *   header  { alg, typ: "dpop+jwt", jwk: { crv, kty, x, y } }
 *   payload { jti, htm, htu: origin+pathname, iat, ath }
 *
 * Run:
 *   npx tsc verifyDpop.ts --target es2022 --module esnext --moduleResolution bundler --skipLibCheck
 *   node verifyDpop.test.mjs
 *
 * Needs `jose` resolvable from this directory.
 *
 * The first assertion is the one that matters: a bound token presented as `Bearer` must be
 * REJECTED. That exact replay returned 200 against a real deployment that verified only the JWT
 * signature (LEARNINGS-nightfabric-001 L-01).
 */
import { generateKeyPair, exportJWK, calculateJwkThumbprint, SignJWT } from "jose";
import { verifyDpop, DpopError, MemoryJtiStore } from "./verifyDpop.js";

const ACCESS = "eyJhbGciOiJFZERTQSJ9.fake-access-token.sig";
const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
const jwk = await exportJWK(publicKey);
const jkt = await calculateJwkThumbprint(jwk, "sha256");

const b64u = (b) => Buffer.from(b).toString("base64url");
const ath = b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ACCESS)));

// Build the proof EXACTLY as @tidecloak/js generateDPoPProof does.
async function proof(over = {}) {
  const p = { jti: crypto.randomUUID(), htm: "GET", htu: "https://app.example/api/whoami",
              iat: Math.floor(Date.now()/1000), ath, ...over };
  return await new SignJWT(p)
    .setProtectedHeader({ alg: "ES256", typ: over.__typ ?? "dpop+jwt",
                          jwk: { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y } })
    .sign(privateKey);
}
const req = (over = {}) => ({
  url: over.url ?? "https://internal.local/api/whoami",
  method: over.method ?? "GET",
  headers: { get: (n) => ({
    authorization: over.authz ?? `DPoP ${ACCESS}`,
    dpop: over.dpop,
    "x-forwarded-host": over.xfh ?? "app.example",
    "x-forwarded-proto": over.xfp ?? "https",
  })[n.toLowerCase()] ?? null },
});
const claims = { cnf: { jkt } };
let pass = 0, fail = 0;
const t = async (name, fn, shouldThrow) => {
  try { await fn(); 
    if (shouldThrow) { console.log(`  FAIL ${name} — accepted when it should reject`); fail++; }
    else { console.log(`  ok   ${name}`); pass++; }
  } catch (e) {
    if (shouldThrow && e instanceof DpopError) { console.log(`  ok   ${name} rejected: ${e.message.slice(0,58)}`); pass++; }
    else { console.log(`  FAIL ${name} — ${e.message.slice(0,80)}`); fail++; }
  }
};
const store = () => new MemoryJtiStore();

await t("valid proof behind a proxy", async () => verifyDpop(req({dpop: await proof()}), ACCESS, claims, {jtiStore: store()}), false);
await t("Bearer replay of a bound token", async () => verifyDpop(req({dpop: await proof(), authz:`Bearer ${ACCESS}`}), ACCESS, claims, {jtiStore: store()}), true);
await t("missing DPoP header", async () => verifyDpop(req({}), ACCESS, claims, {jtiStore: store()}), true);
await t("token with no cnf.jkt", async () => verifyDpop(req({dpop: await proof()}), ACCESS, {}, {jtiStore: store()}), true);
await t("wrong ath (proof from another token)", async () => verifyDpop(req({dpop: await proof({ath:"AAAA"})}), ACCESS, claims, {jtiStore: store()}), true);
await t("wrong htm", async () => verifyDpop(req({dpop: await proof({htm:"POST"})}), ACCESS, claims, {jtiStore: store()}), true);
await t("wrong htu", async () => verifyDpop(req({dpop: await proof({htu:"https://evil.example/api/whoami"})}), ACCESS, claims, {jtiStore: store()}), true);
await t("stale iat", async () => verifyDpop(req({dpop: await proof({iat: Math.floor(Date.now()/1000)-9999})}), ACCESS, claims, {jtiStore: store()}), true);
await t("wrong typ", async () => verifyDpop(req({dpop: await proof({__typ:"jwt"})}), ACCESS, claims, {jtiStore: store()}), true);

// thumbprint mismatch: proof signed by a DIFFERENT key than the token was bound to
const other = await generateKeyPair("ES256", { extractable: true });
const ojwk = await exportJWK(other.publicKey);
const foreign = await new SignJWT({ jti: crypto.randomUUID(), htm:"GET", htu:"https://app.example/api/whoami", iat: Math.floor(Date.now()/1000), ath })
  .setProtectedHeader({ alg:"ES256", typ:"dpop+jwt", jwk:{crv:ojwk.crv,kty:ojwk.kty,x:ojwk.x,y:ojwk.y} }).sign(other.privateKey);
await t("proof signed by a different key", async () => verifyDpop(req({dpop: foreign}), ACCESS, claims, {jtiStore: store()}), true);

// replay: same jti twice against ONE store
const s = store(); const p1 = await proof();
await t("first use of a jti", async () => verifyDpop(req({dpop:p1}), ACCESS, claims, {jtiStore:s}), false);
await t("replay of the same jti", async () => verifyDpop(req({dpop:p1}), ACCESS, claims, {jtiStore:s}), true);

// direct localhost, no proxy headers
const direct = { url:"http://localhost:3000/api/whoami", method:"GET",
  headers:{ get:(n)=>({authorization:`DPoP ${ACCESS}`, dpop:null}[n.toLowerCase()] ?? null) } };
await t("direct localhost (no x-forwarded)", async () => {
  const pr = await proof({htu:"http://localhost:3000/api/whoami"});
  return verifyDpop({...direct, headers:{get:(n)=>({authorization:`DPoP ${ACCESS}`, dpop:pr}[n.toLowerCase()] ?? null)}}, ACCESS, claims, {jtiStore: store()});
}, false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
