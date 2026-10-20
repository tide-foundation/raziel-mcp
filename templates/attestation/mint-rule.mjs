#!/usr/bin/env node
// mint-rule.mjs — build one attestation signing rule, ready to send to the realm.
//
// A rule says: these claim types may be signed, by this kind of issuer. Mint one per "who may
// issue" answer - an app with consent (self), friend lists (owner) and verification (role) has
// three. Run at setup, and again whenever the contract source changes, because a rule names the
// contract by the SHA-512 of its source.
//
//   node mint-rule.mjs --contract AttestationContract.cs --key-id <vvkId> --resource <clientId> \
//        --claims member-of,shared-with --mode self|owner|role [--role <client role>] \
//        [--allow-expiry] [--policy-version <n>]
//
// Prints two lines: CONTRACT_ID=<sha512 upper hex> and RULE=<base64, wrapped for the realm>.
// It builds bytes and nothing else: it does not talk to the realm, and the rule is NOT signed until
// the change request the realm raises for it is approved and committed.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) =>
    (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] === undefined || all[i + 1].startsWith("--") ? true : all[i + 1]]] : acc), []),
);
const need = (k) => args[k] ?? (console.error(`missing --${k}`), process.exit(2));

const source = readFileSync(need("contract"));
const contractId = createHash("sha512").update(source).digest("hex").toUpperCase();
const mode = need("mode");
if (!["self", "owner", "role"].includes(mode)) { console.error("--mode must be self, owner or role"); process.exit(2); }
if (mode === "role" && (!args.role || args.role === true)) { console.error("--mode role needs --role <client role>"); process.exit(2); }
const claims = String(need("claims")).split(",");
if (claims.some((c) => !c || c.length > 64)) { console.error("--claims is a comma-separated list of claim types, each at most 64 characters"); process.exit(2); }

// The policy format version. It is inside the signed bytes, and an attestation is written in the
// same version as its rule, so take it from the SDK the app will run with rather than guessing.
let version = args["policy-version"];
if (!version) {
  try {
    version = (await import("@tideorg/js")).Models?.Policy?.latestVersion;
  } catch { /* not installed here */ }
}
if (!version) {
  console.error("Could not read Policy.latestVersion from @tideorg/js. Run this from the app directory, or pass --policy-version.");
  process.exit(2);
}

const utf8 = (s) => new TextEncoder().encode(s);
function container(values) {
  const out = new Uint8Array(4 + values.reduce((n, v) => n + 4 + v.length, 0));
  const view = new DataView(out.buffer);
  view.setUint32(0, 1, true);
  let at = 4;
  for (const v of values) { view.setUint32(at, v.length, true); at += 4; out.set(v, at); at += v.length; }
  return out;
}
const param = (name, value) => container([utf8(name), utf8("str"), utf8(value)]);
// In name order, as the ork rebuilds them.
const params = [param("AllowExpiry", args["allow-expiry"] ? "yes" : "no"), param("Claims", claims.join(",")), param("IssuerMode", mode)];
if (mode === "role") params.push(param("IssuerRole", args.role));
params.push(param("Resource", need("resource")));

const body = container([
  utf8(String(version)), utf8(contractId), container([utf8("Policy:1")]), utf8(need("key-id")),
  utf8("IMPLICIT"), utf8("PRIVATE"), container(params),
]);

// The realm reads a policy wrapped in one more container. Sent bare it answers
// 400 "Insufficient data to read."
console.log(`CONTRACT_ID=${contractId}`);
console.log(`POLICY_VERSION=${version}`);
console.log(`RULE=${Buffer.from(container([body])).toString("base64")}`);
