// relationship.ts — give a user, a group or a role access to ONE record's encrypted data, enforced
// by the network.
//
// Uses the ORK's built-in contract `RelationshipAttestation:1` (revision 3: subject types). There is
// no contract to write, compile or deploy: a policy names the contract by id, a realm admin approves
// the policy once, and from then on the network lets only that SUBJECT - the user it names, a member
// of the group, or a holder of the role - encrypt (realm role `_tide_encryptor`) or decrypt (realm
// role `_tide_decryptor`) data tagged with that record's id, and only the operations the policy grants.
//
// Browser only. Every call here needs the logged-in user's credential, which lives in the Tide
// enclave. A server or a background job cannot sign, encrypt or decrypt with it.
//
// STATUS: the contract's rules are VERIFIED from the ORK source (ORK main @ c69fc4f6, 2026-10-16), and
// the contract was MEASURED end to end on 2026-10-16 (User, Group and Role policies; refusals checked).
// The same sign/encrypt/decrypt calls ran in a sample app on 2026-10-13.
// This file itself has NOT been run - run the checks in the README before relying on it. Networks on an ORK build from before
// 2026-10-16 do not have the contract: confirm with the Tide team there.
//
// A refusal by the contract arrives as TIDE-TIDEJS-NET-THRESHOLD_FAILURE ("Could not reach enough
// VVK ORKs"). It is not an outage: the contract's message is in the error's `cause`. Do not retry.
import { IAMService } from "@tidecloak/js";
import { Models } from "@tideorg/js";
import { PolicySignRequest } from "heimdall-tide";

// Fixed by the contract. Changing any of these makes the network refuse the policy or the request.
export const RELATIONSHIP_CONTRACT_ID = "RelationshipAttestation:1";
export const RELATIONSHIP_MODEL_IDS = ["PolicyEnabledEncryption:1", "PolicyEnabledDecryption:1"];
export const ENCRYPT_ROLE = "_tide_encryptor"; // REALM roles
export const DECRYPT_ROLE = "_tide_decryptor";

/** Who a policy is for. Group ids must match the `groups` claim exactly (claim name mandated). */
export type RelationshipSubject =
  | { type: "User"; id: string } // id: the grantee's tideuserkey claim, verbatim
  | { type: "Group"; id: string } // id: the FULL PATH, exactly as the `groups` claim carries it, e.g. "/clinic-a/nurses"
  | { type: "Role"; id: string; clientId?: string }; // realm role, or a client role of clientId

/** What a policy lets its subject do with the record. */
export type RelationshipAccess = "read" | "write" | "read-write";
const ROLES_FOR: Record<RelationshipAccess, string[]> = {
  read: [DECRYPT_ROLE],
  write: [ENCRYPT_ROLE],
  "read-write": [ENCRYPT_ROLE, DECRYPT_ROLE],
};
const SIGN_REQUEST_EXPIRY_SECONDS = 604800;

// The part of the SDK's internal client this file uses. The SDK has no public equivalent yet.
interface TideClient {
  dokenParsed?: Record<string, unknown>;
  createTideRequest(encodedRequest: Uint8Array): Promise<Uint8Array>;
  requestTideOperatorApproval(
    requests: { id: string; request: Uint8Array }[],
  ): Promise<{ id: string; request: Uint8Array; status: "approved" | "denied" | "pending" }[]>;
  executeSignRequest(request: Uint8Array, waitForAll?: boolean): Promise<Uint8Array[]>;
}

function tc(): TideClient {
  const client = (IAMService as unknown as { _tc: TideClient | null })._tc;
  if (!client) throw new Error("TideCloak is not initialised: call IAMService.initIAM first");
  return client;
}

const toBase64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// --- who is logged in ------------------------------------------------------------------------

export interface RelationshipSession {
  /** The user's public key, exactly as their credential carries it. What a `User` policy names. */
  tideUserKey: string;
  realmRoles: string[];
  /** The `groups` claim, as the credential carries it. What a `Group` policy is matched against. */
  groups: string[];
  /** Necessary, not sufficient: the user also needs a policy for the record that grants the same. */
  canEncrypt: boolean;
  canDecrypt: boolean;
}

export function readSession(): RelationshipSession {
  const doken = tc().dokenParsed ?? {};
  const key = doken["tideuserkey"];
  const realmAccess = doken["realm_access"] as { roles?: unknown } | undefined;
  const realmRoles = Array.isArray(realmAccess?.roles) ? (realmAccess!.roles as unknown[]).map(String) : [];
  const groups = Array.isArray(doken["groups"]) ? (doken["groups"] as unknown[]).map(String) : [];
  // Copy the claim as-is. Do not re-encode it.
  return { tideUserKey: typeof key === "string" ? key : "", realmRoles, groups, canEncrypt: realmRoles.includes(ENCRYPT_ROLE), canDecrypt: realmRoles.includes(DECRYPT_ROLE) };
}

// --- the policy ------------------------------------------------------------------------------

export interface RelationshipGrant {
  /** The realm's vendorId, from the adapter JSON. */
  vendorId: string;
  /** Who gets the record. For a User subject: the GRANTEE's tideuserkey - not the admin's. */
  subject: RelationshipSubject;
  /** The record this user may open. It is also the only tag every item must carry. */
  recordId: string;
  /** What the subject may do. Choose per grant; read-only is the safe default for a reviewer. */
  access: RelationshipAccess;
  /** Optional: seconds since the epoch after which the policy stops working. Prefer a short one. */
  expiry?: number;
}

export function buildRelationshipPolicy(grant: RelationshipGrant) {
  const subject = grant.subject;
  if (!subject || !["User", "Group", "Role"].includes(subject.type)) throw new Error('subject.type must be "User", "Group" or "Role"');
  if (!subject.id) {
    throw new Error(subject.type === "User" ? "the grantee has no tideuserkey: they must sign in once first" : `subject.id (the ${subject.type.toLowerCase()}) is required`);
  }
  if (!grant.recordId) throw new Error("recordId is required");
  if (!ROLES_FOR[grant.access]) throw new Error('access must be "read", "write" or "read-write"');
  // The SDK only writes its own latest policy version. Never hard-code it.
  const version = (Models.Policy as unknown as { latestVersion: string }).latestVersion;
  return new Models.Policy({
    version,
    contractId: RELATIONSHIP_CONTRACT_ID,
    modelId: RELATIONSHIP_MODEL_IDS,
    keyId: grant.vendorId,
    approvalType: Models.ApprovalType.IMPLICIT,
    executionType: Models.ExecutionType.PRIVATE,
    // All STRING params. `roles` is JSON written as a string, not an array.
    // The param is named assignmentId whatever kind of record it is.
    params: new Map<string, string>([
      ["subjectType", subject.type],
      ["subjectId", subject.id],
      ...(subject.type === "Role" && subject.clientId ? ([["clientId", subject.clientId]] as [string, string][]) : []),
      ["assignmentId", grant.recordId],
      ["roles", JSON.stringify(ROLES_FOR[grant.access])],
    ]),
    ...(grant.expiry ? { expiry: grant.expiry } : {}),
  } as ConstructorParameters<typeof Models.Policy>[0]);
}

/**
 * Sign a relationship policy. Run in a realm admin's browser: it opens the Tide enclave, where the
 * admin approves. That approval IS the grant.
 *
 * `adminPolicy` is the realm's admin policy (signed bytes), which authorises the signing. Fetch it
 * on your server from GET {auth-server-url}/admin/realms/{realm}/iga/role-policies/name/tide-realm-admin
 * (field `policy`, base64) with the admin's token, and pass the decoded bytes.
 *
 * Returns the signed policy as base64. Store it keyed by user and record.
 */
export async function signRelationshipPolicy(grant: RelationshipGrant, adminPolicy: Uint8Array): Promise<string> {
  const policy = buildRelationshipPolicy(grant);

  // The contract is built into the ORK, so the request carries the policy and nothing else.
  const request = PolicySignRequest.New(policy);
  request.setCustomExpiry(SIGN_REQUEST_EXPIRY_SECONDS);

  const initialised = await tc().createTideRequest(request.encode());
  const id = Models.BaseTideRequest.decode(initialised).getUniqueId();

  const [approval] = await tc().requestTideOperatorApproval([{ id, request: initialised }]);
  if (!approval || approval.status !== "approved") {
    throw new Error(`the grant was not approved (${approval ? approval.status : "no response"})`);
  }

  // Attach the admin policy to the APPROVED request, as raw bytes.
  const approved = Models.BaseTideRequest.decode(approval.request);
  approved.addPolicy(adminPolicy);

  const signatures = await tc().executeSignRequest(approved.encode(), true);
  if (!signatures?.[0]) throw new Error("the network returned no signature");

  policy.signature = signatures[0];
  return toBase64(policy.toBytes());
}

// --- using it --------------------------------------------------------------------------------
// The record id is the ONLY tag. A second tag, or a different one, is rejected by the contract.
// Errors from the network are thrown unchanged: show them, do not replace them.

export async function encryptForRecord(data: string, recordId: string, signedPolicyB64: string): Promise<string> {
  const [out] = await IAMService.doEncrypt([{ data, tags: [recordId] }], fromBase64(signedPolicyB64));
  return typeof out === "string" ? out : toBase64(out);
}

export async function decryptForRecord(encrypted: string, recordId: string, signedPolicyB64: string): Promise<string> {
  const [out] = await IAMService.doDecrypt([{ encrypted, tags: [recordId] }], fromBase64(signedPolicyB64));
  return typeof out === "string" ? out : new TextDecoder().decode(out);
}

/** What a stored policy says, for showing an admin or checking before you store it. */
export function describeRelationshipPolicy(signedPolicyB64: string) {
  const p = Models.Policy.from(fromBase64(signedPolicyB64));
  const param = (k: string) => String(p.params.entries.get(k) ?? "");
  return {
    contractId: p.contractId,
    subjectType: param("subjectType"),
    subjectId: param("subjectId"),
    clientId: param("clientId"),
    recordId: param("assignmentId"),
    roles: param("roles"),
    signed: !!p.signature && p.signature.length > 0,
    isRelationshipPolicy: p.contractId === RELATIONSHIP_CONTRACT_ID,
  };
}
