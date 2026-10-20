/**
 * Attestations: build a statement, have the network sign it, verify it.
 *
 *   server  buildAttestation()   -> the exact bytes the network signs
 *   browser signAttestation()    -> the network's signature, made as the logged-in user
 *   server  verifyAttestation()  -> does this signature still cover this statement?
 *
 *     Issuer  attests  Claim  about  Subject  [regarding Object]  [= Value]  [until Expiry]
 *
 * THE ONE RULE: a signature is over BYTES, not over meaning. Nothing is stored except the inputs
 * and the signature. To check an attestation you rebuild the bytes from the row and verify. A row
 * somebody edited rebuilds to bytes the signature does not cover. Storing the bytes beside the row
 * would keep the answer next to the question and prove nothing.
 *
 * Pairs with AttestationContract.cs, which decides what the network will sign and for whom.
 */

/** Must match `AttestationModel` in AttestationContract.cs. */
export const ATTESTATION_MODEL = "BasicCustom<Attestation>:BasicCustom<1>";

const utf8 = (s: string) => new TextEncoder().encode(s);

/** The platform's container: a version, then a length and a value for each entry, little-endian. */
export function container(values: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(4 + values.reduce((n, v) => n + 4 + v.length, 0));
  const view = new DataView(out.buffer);
  view.setUint32(0, 1, true);
  let at = 4;
  for (const v of values) {
    view.setUint32(at, v.length, true);
    at += 4;
    out.set(v, at);
    at += v.length;
  }
  return out;
}

/** The inverse of `container`. */
export function values(buf: Uint8Array): Uint8Array[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: Uint8Array[] = [];
  let at = 4;
  while (at + 4 <= buf.length) {
    const n = view.getUint32(at, true);
    at += 4;
    if (at + n > buf.length) break;
    out.push(buf.subarray(at, at + n));
    at += n;
  }
  return out;
}

export const toBase64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
export const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * One statement. People are named by their Tide **vuid** (the `vuid` token claim), never by the
 * identity provider's user id: the contract compares against the signer's vuid.
 */
export interface Attestation {
  /** What kind of statement this is, e.g. "member-of". The rule lists the kinds it may sign. */
  claim: string;
  /** vuid of the person making the statement. The network checks the signer IS this person. */
  issuer: string;
  /** Who or what the statement is about. A vuid when it is a person. */
  subject: string;
  /** What it concerns: a group, a case, a document, a policy name. Optional. */
  object?: string;
  /** Who owns the object. Required under an `owner` rule, where it must equal `issuer`. */
  owner?: string;
  /** A detail of the claim: a role, a version, an outcome. Optional. */
  value?: string;
  /**
   * Unix seconds after which the statement no longer holds. Only under a rule minted to allow it.
   * It is inside the signed bytes; the network does not enforce it - `verifyAttestation` does.
   */
  expiry?: number;
}

export interface SigningRule {
  /** Policy format version the rule was written in. An attestation is written in the same one. */
  version: string;
  /** The contract's identity to the network: SHA-512 of its source, upper-case hex. */
  contractId: string;
  /** The realm's key id. A policy is signed against the realm and must name it. */
  keyId: string;
}

/**
 * Reads the version, contract and realm key out of the realm's signed rule (base64), so an
 * attestation is built from what the realm actually holds rather than from configuration that can
 * drift. Fetch the rule from `GET /admin/realms/{realm}/iga/role-policies/name/{name}`.
 */
export function readSigningRule(ruleBase64: string): SigningRule {
  const body = values(values(fromBase64(ruleBase64))[0] ?? new Uint8Array());
  if (body.length < 7) throw new Error("That is not a policy: expected at least seven fields.");
  const text = (b: Uint8Array) => new TextDecoder().decode(b);
  return { version: text(body[0]), contractId: text(body[1]), keyId: text(body[3]) };
}

const param = (name: string, value: string) => container([utf8(name), utf8("str"), utf8(value)]);

/**
 * The bytes the network signs, and the bytes a stored signature is checked against.
 *
 * Exactness is everything here:
 *   - parameters in name order (Claim, Issuer, Object, Owner, Resource, Subject, Value), the order
 *     the ork rebuilds them in; an optional field that is absent is simply not there
 *   - written as IMPLICIT / PRIVATE - the contract refuses anything else
 *   - an expiry is an eighth field, int64 little-endian seconds, present only when set
 *
 * Checked byte for byte against the ork SDK's own `Policy.DataToVerify` (mcp-server/test).
 *
 * @param resource the client id the rule is for (the contract's `Resource`)
 */
export function buildAttestation(rule: SigningRule, resource: string, a: Attestation): Uint8Array {
  const required: Record<string, string> = { claim: a.claim, issuer: a.issuer, subject: a.subject, resource };
  const optional: Record<string, string | undefined> = { object: a.object, owner: a.owner, value: a.value };
  for (const [name, v] of Object.entries(required)) {
    if (typeof v !== "string" || v.length === 0) throw new Error(`Attestation field '${name}' is required.`);
  }
  for (const [name, v] of Object.entries({ ...required, ...optional })) {
    if (v === undefined) continue;
    if (typeof v !== "string" || v.length === 0 || v.length > 256) {
      throw new Error(`Attestation field '${name}' must be a non-empty string of at most 256 characters, or omitted.`);
    }
  }
  if (a.claim.length > 64 || a.claim.includes(",")) throw new Error("A claim type is at most 64 characters and has no comma.");

  const params = [param("Claim", a.claim), param("Issuer", a.issuer)];
  if (a.object !== undefined) params.push(param("Object", a.object));
  if (a.owner !== undefined) params.push(param("Owner", a.owner));
  params.push(param("Resource", resource), param("Subject", a.subject));
  if (a.value !== undefined) params.push(param("Value", a.value));

  const fields = [
    utf8(rule.version),
    utf8(rule.contractId),
    container([utf8(ATTESTATION_MODEL)]),
    utf8(rule.keyId),
    utf8("IMPLICIT"),
    utf8("PRIVATE"),
    container(params),
  ];
  if (a.expiry !== undefined) {
    if (!Number.isSafeInteger(a.expiry) || a.expiry <= 0) throw new Error("expiry is Unix seconds, a positive integer.");
    const e = new Uint8Array(8);
    new DataView(e.buffer).setBigInt64(0, BigInt(a.expiry), true);
    fields.push(e);
  }
  return container(fields);
}

/** Who may issue under a rule. See AttestationContract.cs for what each mode enforces. */
export type IssuerRule =
  | { mode: "self" }                 // about yourself: Subject must be the signer
  | { mode: "owner" }                // about something you own: Owner must be the signer
  | { mode: "role"; role: string };  // the signer must hold this client role

/**
 * The realm's signing rule: the ONE policy admins sign, once, that lets the network sign
 * attestations on the signer's own credential. Not an attestation, and built only at setup.
 *
 * It authorises `Policy:1` (signing a policy), IMPLICIT (no approvers) and PRIVATE (the signer's
 * credential is required). PRIVATE is not optional: an implicit rule that is PUBLIC would let
 * anyone sign, and the contract refuses it.
 *
 * Keep each rule NARROW: the claim types that share one "who may issue" answer, and nothing more.
 * An app with consent (self), friend lists (owner) and verification (role) mints three rules.
 *
 * @param contractId SHA-512 of the contract source, upper-case hex
 * @param keyId      the realm's key: components[tide-vendor-key].config.vvkId
 * @param claims     the claim types this rule may sign
 */
export function buildSigningRule(
  version: string,
  contractId: string,
  keyId: string,
  resource: string,
  claims: string[],
  issuer: IssuerRule,
  allowExpiry = false,
): Uint8Array {
  if (!claims.length) throw new Error("A rule must name at least one claim type.");
  for (const c of claims) {
    if (!c || c.length > 64 || c.includes(",")) throw new Error(`'${c}' is not a valid claim type.`);
  }
  if (issuer.mode === "role" && !issuer.role) throw new Error("role mode needs the role an issuer must hold.");
  // In name order, as the ork rebuilds them.
  const params = [
    param("AllowExpiry", allowExpiry ? "yes" : "no"),
    param("Claims", claims.join(",")),
    param("IssuerMode", issuer.mode),
  ];
  if (issuer.mode === "role") params.push(param("IssuerRole", issuer.role));
  params.push(param("Resource", resource));
  return container([
    utf8(version),
    utf8(contractId),
    container([utf8("Policy:1")]),
    utf8(keyId),
    utf8("IMPLICIT"),
    utf8("PRIVATE"),
    container(params),
  ]);
}

/**
 * The same policy in the form the enclave and the realm read, which is NOT the form that is signed:
 * the signed body wrapped in one more container. Hand over the unwrapped body and the answer is
 * "insufficient data to read".
 */
export const wrapForEnclave = (policy: Uint8Array) => container([policy]);

/**
 * BROWSER. Has the network sign the attestation as the logged-in user, with nobody approving.
 *
 * The realm's IMPLICIT rule authorises it; the contract checks the signer is the Issuer the
 * statement names (and whatever else the rule's mode requires). Call this in the browser of the
 * person making the statement - never on a server, which has no user credential to sign with.
 *
 * @param unsignedPolicy base64 of `wrapForEnclave(buildAttestation(...))`, built by YOUR SERVER
 *                       from the row it is about to record - not assembled in the browser
 * @param signingRule    the realm's signed rule for this kind of claim, base64
 * @returns the network's signature, base64. Send it to your server, which must verify before storing.
 */
export async function signAttestation(unsignedPolicy: string, signingRule: string): Promise<string> {
  const { IAMService } = await import("@tidecloak/js");
  const { Models } = await import("@tideorg/js");

  // No supported public entry point runs a request you have just prepared, so this reaches the
  // underlying client. Replace it when the SDK exposes one.
  const tc = (IAMService as any)._tc;
  if (!tc?.createTideRequest || !tc?.executeSignRequest) {
    throw new Error("This TideCloak SDK build cannot sign a request. Is the user logged in?");
  }

  // "Sign this policy" (Policy, version 1), authorised BY a policy (the Policy:1 flow).
  // Draft[0] is the policy being signed.
  const draft = container([fromBase64(unsignedPolicy)]);
  const request = new (Models as any).BaseTideRequest("Policy", "1", "Policy:1", draft);
  request.addPolicy(fromBase64(signingRule));

  const initialised = await tc.createTideRequest(request.encode());
  const signatures = await tc.executeSignRequest(initialised, true);
  if (!signatures?.length) throw new Error("The network returned no signature for this attestation.");
  return toBase64(signatures[0]);
}

/**
 * SERVER. Whether `signature` is the realm's signature over exactly this statement, and the
 * statement has not expired.
 *
 * Call it twice: before storing a signature the browser sends back (refuse one that does not
 * verify - a stored one would read as attested), and on EVERY later decision that relies on it.
 *
 * Returns false, never throws, for anything it cannot verify: a missing signature, a malformed
 * one, an edited row, a different realm key, an expired statement. "Cannot check" and "not
 * attested" are the same answer.
 *
 * @param realmKeys the realm's public keys: `jwk.keys` from the adapter JSON (tidecloak.json).
 *                  Use the EMBEDDED keys. They are not in the OIDC JWKS endpoint.
 * @param now       Unix seconds; defaults to the server clock. Only used for `expiry`.
 */
export async function verifyAttestation(
  rule: SigningRule,
  resource: string,
  a: Attestation,
  signature: string | null | undefined,
  realmKeys: JsonWebKey[],
  now: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!signature || !realmKeys?.length) return false;
  let sig: Uint8Array;
  let data: Uint8Array;
  try {
    sig = fromBase64(signature);
    data = buildAttestation(rule, resource, a);
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;
  if (a.expiry !== undefined && now >= a.expiry) return false;

  for (const jwk of realmKeys) {
    if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519") continue;
    try {
      const key = await crypto.subtle.importKey(
        "jwk", { kty: "OKP", crv: "Ed25519", x: jwk.x }, { name: "Ed25519" }, false, ["verify"]);
      if (await crypto.subtle.verify({ name: "Ed25519" }, key, sig, data)) return true;
    } catch {
      // A key that cannot verify these bytes is simply not the right key.
    }
  }
  return false;
}

/**
 * Worked statements. Each is just an `Attestation` with the fields filled the conventional way;
 * use them as-is or write your own claim types. The comment names the rule mode each needs.
 */
export const statements = {
  /** owner rule. "I added `member` to my group." */
  memberOf: (owner: string, group: string, member: string): Attestation =>
    ({ claim: "member-of", issuer: owner, subject: member, object: group, owner }),

  /** owner rule. "I shared my `object` with `person`, as `access`." */
  sharedWith: (owner: string, object: string, person: string, access: string): Attestation =>
    ({ claim: "shared-with", issuer: owner, subject: person, object, owner, value: access }),

  /** self rule. "I agree to `what`, version `version`." */
  consented: (person: string, what: string, version: string): Attestation =>
    ({ claim: "consented", issuer: person, subject: person, object: what, value: version }),

  /** role rule. "As someone allowed to, I assigned `person` to `object` as `role`." */
  assigned: (assigner: string, person: string, object: string, role: string): Attestation =>
    ({ claim: "assigned", issuer: assigner, subject: person, object, value: role }),

  /** role rule. "As someone allowed to, I confirm `person` passed `check` with `outcome`." */
  verified: (verifier: string, person: string, check: string, outcome: string): Attestation =>
    ({ claim: "verified", issuer: verifier, subject: person, object: check, value: outcome }),

  /** role rule. "As someone allowed to, I approved `object`." Subject is who it was approved for. */
  approved: (approver: string, requester: string, object: string): Attestation =>
    ({ claim: "approved", issuer: approver, subject: requester, object }),
};
