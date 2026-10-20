// The relationship-attestation scenario: one named user may open one record's encrypted data, under
// the ORK's built-in RelationshipAttestation:1 contract. Nothing is written or deployed by the app,
// so unlike the other contract scenarios this one must NOT send anyone to contract authoring, and
// must say plainly that the network has to have the contract and that no live round was run.
import { mkClient, callTool, Checks, packRead } from "./harness.mjs";
import { RESTRICTED, RESTRICTED_MARKER } from "../dist/server.js";

const SC = "relationship-attestation";

export async function run() {
  const c = new Checks("relationship");
  const client = await mkClient();

  // --- routing ---------------------------------------------------------------------------------
  const mine = [
    "only the clinician assigned to an assessment can decrypt its notes",
    "per-record access to encrypted patient files, need to know",
    "relationship based access: a user assigned to a case can read that case's encrypted data",
    "grant a user access to one record's encrypted data and nobody else",
    "caseload app where each assessor decrypts only their assigned assessments",
    "use the RelationshipAttestation contract",
  ];
  for (const situation of mine) {
    const r = await callTool(client, "tide_choose_scenario", { situation });
    c.ok(`choose_scenario picks ${SC}: "${situation}"`, r.text.includes(`Best scenario match: ${SC}`), r.text.slice(0, 140).replace(/\n/g, " | "));
  }
  // What it must not take.
  const others = [
    ["attest that this user was added to my close friends group", "attestation"],
    ["attest that Dave consented to privacy policy v3", "attestation"],
    ["attest that a team lead assigned Carol to case 42 as reviewer", "attestation"],
    ["build an organisation password manager with shared team vaults", "organisation-password-manager"],
    ["share encrypted data with everyone on my team", "organisation-password-manager"],
    ["prove I created this artwork with a timestamp", "attested-provenance-registry"],
    ["keyless ssh signing", "policy-governed-signing"],
  ];
  for (const [situation, want] of others) {
    const r = await callTool(client, "tide_choose_scenario", { situation });
    c.ok(`${SC} does not take "${situation}" from ${want}`, r.text.includes(`Best scenario match: ${want}`), r.text.slice(0, 140).replace(/\n/g, " | "));
  }
  let r = await callTool(client, "tide_choose_scenario", { situation: "add login to a new Next.js app" });
  c.ok(`an ordinary login request does not match ${SC}`, !r.text.includes(`Best scenario match: ${SC}`));

  r = await callTool(client, "tide_choose_playbook", { situation: mine[0] });
  c.ok("choose_playbook routes it too, with the work order", r.text.includes(`Scenario match: ${SC}`) && /Work order/.test(r.text), r.text.slice(0, 140).replace(/\n/g, " | "));
  c.ok("... and does not send the build to contract deployment", !/deploy-forseti-policy|setup-forseti-e2ee/.test(r.text) && !/Deploying a custom Forseti contract/.test(r.text));

  // --- it is NOT a custom-contract scenario -------------------------------------------------------
  c.ok("it is not listed as a scenario whose contract the app team writes", !RESTRICTED.contractScenarios.includes(SC));
  r = await callTool(client, "tide_list_scenarios");
  c.ok("the scenario list names it, without the custom-contract mark", new RegExp(`- ${SC}`).test(r.text) && !new RegExp(`- ${SC} .*deployed by the Tide team`).test(r.text));

  // --- content -------------------------------------------------------------------------------------
  r = await callTool(client, "tide_scenario", { name: SC });
  const sc = r.text;
  c.ok("scenario: names the built-in contract and says nothing is written or deployed",
    /RelationshipAttestation:1/.test(sc) && /default contract/.test(sc) && /write no C#, compile nothing\s+and deploy nothing/.test(sc));
  c.ok("scenario: the policy shape is exact",
    /PolicyEnabledEncryption:1/.test(sc) && /PolicyEnabledDecryption:1/.test(sc) && /`IMPLICIT`/.test(sc) && /`PRIVATE`/.test(sc) &&
    /`subjectType`/.test(sc) && /`subjectId`/.test(sc) && /`clientId`/.test(sc) && /`User`, `Group` or `Role`/.test(sc) && !/Param `tideUserKey`/.test(sc) && /`assignmentId`/.test(sc) && /`roles`/.test(sc) && /_tide_encryptor/.test(sc) && /_tide_decryptor/.test(sc) &&
    !/assessmentId|canAccessAssignment/.test(sc));
  c.ok("scenario: read and write are separate, in the policy and in the user's roles", /Read and write are separate/.test(sc) && /is read-only/.test(sc) && /Policy permits it/.test(sc) && /Caller's role/.test(sc));
  c.ok("scenario: one tag per item, and it is the record id", /One tag per item/.test(sc) && /is\s+rejected/.test(sc));
  c.ok("scenario: one policy per subject and record, each approved by an admin", /One policy per subject and record/.test(sc) && /tide-realm-admin.{0,40}approves it in the enclave/s.test(sc));
  c.ok("scenario: revision 3 subjects - User, Group (groups claim, name mandated), Role (clientId)",
    /\| `User` \| exactly one user/.test(sc) && /\| `Group` \| every member of the group/.test(sc) && /\| `Role` \| everyone holding the role/.test(sc) &&
    /claim named exactly \*\*`groups`\*\*/.test(sc) && /mandated by Tide/.test(sc) && /Whoever controls membership controls access/.test(sc));
  c.ok("scenario: on ORK main (c69fc4f6), and the end-to-end run is recorded with its scope",
    /The contract is on ORK `main` \| \*\*Yes\*\*/.test(sc) && /`c69fc4f6`/.test(sc) && /MEASURED end to end by Sasha Le \(2026-10-16\)/.test(sc) &&
    /client-`Role` \(with `clientId`\)/.test(sc) && !/default-relationship-attestation/.test(sc));
  c.ok("scenario: states what is verified and what is not",
    /\| A live sign, encrypt and decrypt round \| MEASURED against \*\*revision 2\*\* on a \*\*local test stack\*\*/.test(sc) && /the refusals were checked/.test(sc) && /Your network has the contract \| \*\*ASSUMED\*\*/.test(sc) && /VERIFIED — read from the contract source on ORK `main`/.test(sc));
  c.ok("scenario: a missing contract is a stop, not a reason to write one", /Do not work around that by writing\s+a custom contract/.test(sc));
  c.ok("scenario: is honest about revocation", /no instant, certain revocation/.test(sc) && /short expiry/.test(sc));
  c.ok("scenario: the server still authorises its own API", /does not protect your endpoints/.test(sc) && /does not replace API authorisation/i.test(sc));
  c.ok("scenario: the contract's own error messages are in the diagnostics",
    /subjectId does not match\./.test(sc) && /group not found in doken\./.test(sc) && /role not found in doken\./.test(sc) && /'_tide_decryptor' role not found for this decryption request\./.test(sc) &&
    /_tide_decryptor not found in list of roles\./.test(sc) && /Tags do not contain assignmentId\./.test(sc));

  r = await callTool(client, "tide_scenario_bootstrap", { name: SC });
  const boot = r.text;
  c.ok("bootstrap: LEADS with the licence-email and terms ask", boot.indexOf("BEFORE ANY TIDE REALM IS SET UP") < 20);
  c.ok("bootstrap: Phase 0 confirms the network has the contract, before anything is built",
    /Phase 0: Confirm the network has the contract/.test(boot) && boot.indexOf("Phase 0") < boot.indexOf("Phase 1: TideCloak infrastructure") && /info@tide\.org/.test(boot));
  c.ok("bootstrap: a REALM role, not in the default roles", /The \*\*realm\*\* roles `_tide_encryptor` and `_tide_decryptor` ship in the pack's realm templates/.test(boot) && /Do \*\*not\*\* put them in the default-roles\s+composite/.test(boot));
  c.ok("bootstrap: tide-realm-admin is granted last", /Grant `tide-realm-admin` \*\*last\*\*/.test(boot));
  c.ok("bootstrap: proves the rejections, not just the happy path",
    /It must be rejected/.test(boot) && (boot.match(/\*\*It must be rejected\.\*\*/g) || []).length >= 5 && /read-only\*\* policy/.test(boot) && /stop: the contract in use is not the one described here/.test(boot));
  c.ok("bootstrap: no step writes, compiles or deploys a contract",
    !/\.cs\b/.test(boot) && !/forseti-compile-harness/.test(boot) && boot.split("\n").filter((l) => RESTRICTED_MARKER.test(l)).length === 0 && !/Withheld/.test(boot));

  r = await callTool(client, "tide_scenario_roles", { name: SC });
  c.ok("roles: the role alone opens nothing, the policy alone opens nothing", /A user needs \*\*both\*\*/.test(r.text) && /## Access levels/.test(r.text) && /a reviewer, an auditor/.test(r.text) && /Server-side authorisation still applies/.test(r.text));
  r = await callTool(client, "tide_scenario_manifest", { name: SC });
  c.ok("manifest: default contract, deployed by Tide, one policy per user and record",
    /id: "RelationshipAttestation:1"/.test(r.text) && /deployed_by: Tide/.test(r.text) && /one_policy_per: subject \(user, group or role\) and record/.test(r.text) && /claim_name: groups/.test(r.text) && /^status: /m.test(r.text));

  const ap = packRead("reference-apps/relationship-attestation/anti-patterns.md") || "";
  const ids = [...ap.matchAll(/^## (AP-RA\d\d):/gm)].map((m) => m[1]);
  c.ok("anti-patterns: numbered AP-RA01.. with no gaps or repeats", ids.length >= 18 && ids.every((id, i) => id === `AP-RA${String(i + 1).padStart(2, "0")}`), ids.join(","));
  c.ok("anti-patterns: writing a custom contract when the built-in one is missing is first", /^## AP-RA01: Writing a custom contract because the built-in one is missing/m.test(ap));

  // --- the helper template -------------------------------------------------------------------------
  const ts = packRead("templates/relationship-attestation/relationship.ts") || "";
  c.ok("template: constants match the contract",
    /RELATIONSHIP_CONTRACT_ID = "RelationshipAttestation:1"/.test(ts) && /"PolicyEnabledEncryption:1", "PolicyEnabledDecryption:1"/.test(ts) && /ENCRYPT_ROLE = "_tide_encryptor"/.test(ts) && /DECRYPT_ROLE = "_tide_decryptor"/.test(ts) && !/canAccessAssignment|assessmentId/.test(ts));
  c.ok("template: access is chosen per grant - read, write or read-write", /read: \[DECRYPT_ROLE\]/.test(ts) && /write: \[ENCRYPT_ROLE\]/.test(ts) && /"read-write": \[ENCRYPT_ROLE, DECRYPT_ROLE\]/.test(ts) && /access: RelationshipAccess;/.test(ts));
  c.ok("template: revision 3 string params, in the contract's names", /\["subjectType", subject\.type\]/.test(ts) && /\["subjectId", subject\.id\]/.test(ts) && /\["clientId", subject\.clientId\]/.test(ts) && /\["assignmentId", grant\.recordId\]/.test(ts) && /\["roles", JSON\.stringify\(ROLES_FOR\[grant\.access\]\)\]/.test(ts) && !/\["tideUserKey"/.test(ts));
  c.ok("template: the subject is User, Group or Role, and the session carries groups", /type: "User"; id: string/.test(ts) && /type: "Group"; id: string/.test(ts) && /type: "Role"; id: string; clientId\?: string/.test(ts) && /groups: string\[\]/.test(ts));
  c.ok("template: IMPLICIT and PRIVATE", /ApprovalType\.IMPLICIT/.test(ts) && /ExecutionType\.PRIVATE/.test(ts));
  c.ok("template: the policy version is read from the SDK, never hard-coded", /latestVersion/.test(ts) && !/version:\s*"\d"/.test(ts));
  c.ok("template: exactly one tag, the record id", (ts.match(/tags: \[recordId\]/g) || []).length === 2);
  c.ok("template: attaches no contract source", ts.split("\n").filter((l) => RESTRICTED_MARKER.test(l)).length === 0);
  c.ok("template: says what was and was not tested, and that a refusal is not an outage", /has NOT been run/.test(ts) && /It is not an outage/.test(ts));
  const readme = packRead("templates/relationship-attestation/README.md") || "";
  c.ok("template README: status table and the five checks", /\*\*Not run\*\*/.test(readme) && /not necessarily with this file/.test(readme) && /A second user uses the first user's `User` policy: rejected/.test(readme) && /A non-member uses a `Group` policy: rejected/.test(readme) && /Encrypt with a read-only policy: rejected/.test(readme) && /Do not decrypt on the server/.test(readme));

  // --- the neighbouring scenario points here ---------------------------------------------------------
  const att = packRead("reference-apps/attestation/scenario.md") || "";
  c.ok("the attestation scenario sends decryption-gating facts here", /One named user and\s+one record \(or a group or role and one record\): `relationship-attestation`/.test(att));

  // --- the existing contract scenarios check the built-in contract first -----------------------------
  r = await callTool(client, "tide_scenario", { name: "attestation" });
  c.ok("attestation: 'Built-in contract first' comes before 'When to use', with the row-by-row verdict",
    r.text.indexOf("## Built-in contract first") > 0 && r.text.indexOf("## Built-in contract first") < r.text.indexOf("## When to use this scenario") &&
    /`assigned`[^\n]*\*\*Yes\.\*\* Use `relationship-attestation`/.test(r.text) && /`consented`, `accepted`[^\n]*\*\*No\*\*/.test(r.text) &&
    /The \*\*owner\*\* cannot grant/.test(r.text) && /`_tide_decryptor` to read, `_tide_encryptor` to write/.test(r.text));
  r = await callTool(client, "tide_scenario_bootstrap", { name: "attestation" });
  c.ok("attestation bootstrap: Phase 0 checks the built-in contract, and the licence ask still leads",
    r.text.indexOf("BEFORE ANY TIDE REALM IS SET UP") < 20 && /Phase 0: Check the built-in contract first/.test(r.text) && r.text.indexOf("Phase 0") < r.text.indexOf("Phase 1: TideCloak infrastructure"));
  r = await callTool(client, "tide_scenario_roles", { name: "attestation" });
  c.ok("attestation roles: the built-in path comes first", /## If the built-in contract covers the fact/.test(r.text) && r.text.indexOf("If the built-in contract") < r.text.indexOf("## Tide bootstrap roles"));
  r = await callTool(client, "tide_scenario_bootstrap", { name: "organisation-password-manager" });
  c.ok("password manager bootstrap: built-in contract for shared vaults, no custom contract, and the licence ask still leads",
    r.text.indexOf("BEFORE ANY TIDE REALM IS SET UP") < 20 && /Phase 0: Confirm the built-in contract/.test(r.text) && /signRelationshipPolicy/.test(r.text) &&
    !/appUser|orgOwner|Seed Forseti contract/.test(r.text));
  r = await callTool(client, "tide_scenario_roles", { name: "organisation-password-manager" });
  c.ok("password manager roles: viewer, contributor and intake map to policy roles", /\| Viewer \| `\["_tide_decryptor"\]`/.test(r.text) && /\| Contributor \|/.test(r.text) && /\| Intake only \|/.test(r.text));
  r = await callTool(client, "tide_scenario", { name: "organisation-password-manager" });
  c.ok("password manager: shared vaults run on the built-in contract, with its limits",
    /## Built-in contract: how a vault maps onto it/.test(r.text) && /the vault \(or collection\) id/.test(r.text) && /An org owner cannot sign one/.test(r.text) &&
    /read-only/.test(r.text) && /no custom contract/.test(r.text) && /`clientId` = your OIDC client/.test(r.text));
  for (const sc of ["policy-governed-signing", "git-pr-signing-service", "attested-provenance-registry"]) {
    r = await callTool(client, "tide_scenario", { name: sc });
    c.ok(`${sc}: says plainly that no built-in contract covers it`,
      /## Built-in contract: does not cover signing/.test(r.text) && /only allows \*\*encryption and decryption\*\*/.test(r.text) && /info@tide\.org/.test(r.text) && /relationship-attestation/.test(r.text));
    const m = await callTool(client, "tide_scenario_manifest", { name: sc });
    c.ok(`${sc}: manifest records builtin_contract: none`, /^builtin_contract: none$/m.test(m.text));
  }
  for (const sc of ["attestation", "organisation-password-manager"]) {
    const m = await callTool(client, "tide_scenario_manifest", { name: sc });
    c.ok(`${sc}: manifest names the built-in contract and what it does not cover`, /builtin_contract:\n  id: "RelationshipAttestation:1"/.test(m.text) && /does_not_cover:/.test(m.text));
  }
  r = await callTool(client, "tide_choose_scenario", { situation: "attest that this user was added to my close friends group" });
  c.ok("a custom-contract match is told to check the built-in contract first", /Check the built-in contract first/.test(r.text) && /relationship-attestation/.test(r.text));
  c.ok("the scenario maps the other needs onto a record id", /## Other scenarios that map onto this one/.test(sc) && /A member may open a vault/.test(sc));
  const idx = packRead("reference-apps/INDEX.md") || "";
  c.ok("the index has the built-in-contract table for every scenario",
    /## Built-in contract first/.test(idx) && ["relationship-attestation", "attestation", "organisation-password-manager", "policy-governed-signing", "encrypted-communication"].every((n) => idx.split("## Disambiguation")[0].includes("`" + n + "`")));

  // --- every scenario states its relationship to the built-in contract ------------------------------
  for (const scn of ["attestation", "attested-provenance-registry", "encrypted-communication", "git-pr-signing-service",
    "iga-admin-governance", "organisation-password-manager", "policy-governed-signing"]) {
    const m = await callTool(client, "tide_scenario_manifest", { name: scn });
    c.ok(`${scn}: manifest declares builtin_contract`, /^builtin_contract:/m.test(m.text));
    const t = await callTool(client, "tide_scenario", { name: scn });
    c.ok(`${scn}: scenario has a built-in contract section`, /^## Built-in contract/m.test(t.text) && /RelationshipAttestation:1/.test(t.text));
  }


  // --- the chooser routes "who may decrypt this" requests to the built-in contract ------------------
  const routes = [
    ["share encrypted documents with a group of users", "relationship-attestation"],
    ["managers can read salary records but employees cannot", "relationship-attestation"],
    ["only the assigned clinician can read a patient's assessment notes", "relationship-attestation"],
    ["chat app where room members can decrypt the room key", "encrypted-communication"],
    ["a team password manager where each vault is shared with an org role", "organisation-password-manager"],
    ["sign SSH challenges only for users with the ops role", "policy-governed-signing"],
  ];
  for (const [situation, want] of routes) {
    const out = await callTool(client, "tide_choose_scenario", { situation });
    c.ok(`chooser: "${situation}" -> ${want}`, new RegExp(`Best scenario match: ${want}\\b`).test(out.text), out.text.slice(0, 120));
    c.ok(`chooser: "${situation}" says whether the built-in contract fits`,
      want === "policy-governed-signing"
        ? /Built-in contract: none fits/.test(out.text)
        : /Built-in contract: RelationshipAttestation:1 \(in the ORK; nothing to write or deploy\)/.test(out.text));
  }
  const e2ee = await callTool(client, "tide_playbook", { name: "setup-forseti-e2ee" });
  c.ok("setup-forseti-e2ee leads with the built-in contract, and it survives the restricted filter",
    /## Start here: the built-in contract \(default\)/.test(e2ee.text) && /`assignmentId` \| the record id/.test(e2ee.text));

  await client.close();
  return c.results;
}
