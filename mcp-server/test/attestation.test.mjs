// Attestation: the template's helpers produce exactly the bytes the network signs, the verifier
// accepts only what it should, and the scenario is reachable from a plain request - for membership
// and for every other kind of statement in the catalogue.
//
// The KNOWN ANSWERS below were produced by the ORK SDK itself (Policy.DataToVerify), 2026-10-07,
// by a check that also ran AttestationContract.cs through the real DataContext / ExecutorContext /
// Doken types, the ORK's compiler, its IL vetter and its parameter binder (49 checks). That check
// needs the ORK SDK binaries and so cannot run here; these vectors are what it leaves behind. If
// you change the byte layout in attestation.ts or mint-rule.mjs, these fail - which is the point:
// regenerate them from the SDK, never from the code under test.
import { mkClient, callTool, Checks, PACK_ROOT, packRead } from "./harness.mjs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const SDK = {
  attMin: "0100000001000000340800000030313233414243442f00000001000000270000004261736963437573746f6d3c4174746573746174696f6e3e3a4261736963437573746f6d3c313e0a00000076766b2d6b65792d696408000000494d504c4943495407000000505249564154459d00000001000000210000000100000005000000436c61696d0300000073747209000000636f6e73656e7465642200000001000000060000004973737565720300000073747209000000767569642d646176652300000001000000080000005265736f7572636503000000737472080000006d79636c69656e742300000001000000070000005375626a6563740300000073747209000000767569642d64617665",
  attFull: "0100000001000000340800000030313233414243442f00000001000000270000004261736963437573746f6d3c4174746573746174696f6e3e3a4261736963437573746f6d3c313e0a00000076766b2d6b65792d696408000000494d504c4943495407000000505249564154450d01000001000000210000000100000005000000436c61696d03000000737472090000006d656d6265722d6f66230000000100000006000000497373756572030000007374720a000000767569642d616c6963652600000001000000060000004f626a656374030000007374720d000000636c6f73652d667269656e64732200000001000000050000004f776e6572030000007374720a000000767569642d616c6963652300000001000000080000005265736f7572636503000000737472080000006d79636c69656e742200000001000000070000005375626a6563740300000073747208000000767569642d626f621c000000010000000500000056616c7565030000007374720400000062657374",
  attExp: "0100000001000000340800000030313233414243442f00000001000000270000004261736963437573746f6d3c4174746573746174696f6e3e3a4261736963437573746f6d3c313e0a00000076766b2d6b65792d696408000000494d504c494349540700000050524956415445ed00000001000000210000000100000005000000436c61696d03000000737472090000006d656d6265722d6f66230000000100000006000000497373756572030000007374720a000000767569642d616c6963652600000001000000060000004f626a656374030000007374720d000000636c6f73652d667269656e64732200000001000000050000004f776e6572030000007374720a000000767569642d616c6963652300000001000000080000005265736f7572636503000000737472080000006d79636c69656e742200000001000000070000005375626a6563740300000073747208000000767569642d626f620800000000b33f7100000000",
  ruleSelf: "010000000100000034080000003031323341424344100000000100000008000000506f6c6963793a310a00000076766b2d6b65792d696408000000494d504c4943495407000000505249564154459a0000000100000020000000010000000b000000416c6c6f7745787069727903000000737472020000006e6f220000000100000006000000436c61696d730300000073747209000000636f6e73656e74656421000000010000000a0000004973737565724d6f6465030000007374720400000073656c662300000001000000080000005265736f7572636503000000737472080000006d79636c69656e74",
  ruleOwner: "010000000100000034080000003031323341424344100000000100000008000000506f6c6963793a310a00000076766b2d6b65792d696408000000494d504c494349540700000050524956415445a80000000100000021000000010000000b000000416c6c6f7745787069727903000000737472030000007965732e0000000100000006000000436c61696d7303000000737472150000006d656d6265722d6f662c7368617265642d7769746822000000010000000a0000004973737565724d6f646503000000737472050000006f776e65722300000001000000080000005265736f7572636503000000737472080000006d79636c69656e74",
  ruleRole: "010000000100000034080000003031323341424344100000000100000008000000506f6c6963793a310a00000076766b2d6b65792d696408000000494d504c494349540700000050524956415445cb0000000100000020000000010000000b000000416c6c6f7745787069727903000000737472020000006e6f210000000100000006000000436c61696d730300000073747208000000766572696669656421000000010000000a0000004973737565724d6f64650300000073747204000000726f6c652e000000010000000a000000497373756572526f6c650300000073747211000000636f6d706c69616e63653a7665726966792300000001000000080000005265736f7572636503000000737472080000006d79636c69656e74",
};

export async function run() {
  const c = new Checks("attestation");
  const dir = mkdtempSync(join(tmpdir(), "tide-att-"));
  const src = readFileSync(join(PACK_ROOT, "templates/attestation/attestation.ts"), "utf8");
  // TypeScript 7 removed transpileModule. Use the installed compiler in emit-only mode.
  writeFileSync(join(dir, "attestation.mts"), src);
  const tsc = join(dirname(createRequire(import.meta.url).resolve("typescript/package.json")), "bin", "tsc");
  execFileSync(process.execPath, [tsc, "attestation.mts", "--module", "ESNext", "--target", "ES2022", "--noCheck"], { cwd: dir });
  const M = await import(pathToFileURL(join(dir, "attestation.mjs")).href);
  const S = M.statements;
  const hex = (b) => Buffer.from(b).toString("hex");
  const rule = { version: "4", contractId: "0123ABCD", keyId: "vvk-key-id" };
  const friend = S.memberOf("vuid-alice", "close-friends", "vuid-bob");

  // --- bytes: statements ---
  c.ok("a minimal statement is byte-identical to the ORK SDK's Policy.DataToVerify",
    hex(M.buildAttestation(rule, "myclient", { claim: "consented", issuer: "vuid-dave", subject: "vuid-dave" })) === SDK.attMin);
  c.ok("a statement with every field is byte-identical to the ORK SDK's",
    hex(M.buildAttestation(rule, "myclient", { ...friend, value: "best" })) === SDK.attFull);
  c.ok("a statement with an expiry is byte-identical to the ORK SDK's",
    hex(M.buildAttestation(rule, "myclient", { ...friend, expiry: 1900000000 })) === SDK.attExp);
  // --- bytes: rules ---
  c.ok("a self rule is byte-identical to the ORK SDK's", hex(M.buildSigningRule("4", "0123ABCD", "vvk-key-id", "myclient", ["consented"], { mode: "self" })) === SDK.ruleSelf);
  c.ok("an owner rule (two claims, expiry allowed) is byte-identical to the ORK SDK's", hex(M.buildSigningRule("4", "0123ABCD", "vvk-key-id", "myclient", ["member-of", "shared-with"], { mode: "owner" }, true)) === SDK.ruleOwner);
  c.ok("a role rule is byte-identical to the ORK SDK's", hex(M.buildSigningRule("4", "0123ABCD", "vvk-key-id", "myclient", ["verified"], { mode: "role", role: "compliance:verify" })) === SDK.ruleRole);

  // --- the builder refuses what the contract would ---
  const throws = (fn) => { try { fn(); return false; } catch { return true; } };
  c.ok("a missing required field is refused when building", throws(() => M.buildAttestation(rule, "myclient", { claim: "x", issuer: "a", subject: "" })));
  c.ok("an empty optional field is refused (omit it instead)", throws(() => M.buildAttestation(rule, "myclient", { ...friend, value: "" })));
  c.ok("a claim type with a comma is refused", throws(() => M.buildAttestation(rule, "myclient", { ...friend, claim: "a,b" })));
  c.ok("a rule with no claim types is refused", throws(() => M.buildSigningRule("4", "X", "k", "c", [], { mode: "self" })));
  c.ok("a role rule with no role is refused", throws(() => M.buildSigningRule("4", "X", "k", "c", ["verified"], { mode: "role", role: "" })));
  const bytes = M.buildAttestation(rule, "myclient", friend);
  c.ok("wrapForEnclave adds exactly one container, and readSigningRule reads through it",
    M.wrapForEnclave(bytes).length === bytes.length + 8 && JSON.stringify(M.readSigningRule(M.toBase64(M.wrapForEnclave(bytes)))) === JSON.stringify(rule));
  c.ok("readSigningRule reads a SIGNED rule (body + signature) the same way",
    JSON.stringify(M.readSigningRule(M.toBase64(M.container([bytes, new Uint8Array(64)])))) === JSON.stringify(rule));

  // --- the statement helpers put each claim in the mode's shape ---
  const shapes = [
    ["memberOf is an owner statement", friend, (a) => a.claim === "member-of" && a.owner === a.issuer && a.subject !== a.issuer && a.object === "close-friends"],
    ["sharedWith is an owner statement", S.sharedWith("o", "doc-1", "p", "read"), (a) => a.owner === a.issuer && a.subject === "p" && a.value === "read"],
    ["consented is a self statement", S.consented("p", "data-sharing", "v3"), (a) => a.subject === a.issuer && a.owner === undefined && a.value === "v3"],
    ["assigned names the assigner as issuer", S.assigned("lead", "p", "case-42", "reviewer"), (a) => a.issuer === "lead" && a.subject === "p" && a.owner === undefined],
    ["verified names the verifier as issuer", S.verified("officer", "p", "identity", "passed"), (a) => a.issuer === "officer" && a.subject === "p" && a.value === "passed"],
    ["approved names the approver as issuer", S.approved("mgr", "p", "expense-9"), (a) => a.issuer === "mgr" && a.subject === "p" && a.object === "expense-9"],
  ];
  for (const [label, a, ok] of shapes) c.ok(`statements: ${label}`, ok(a) && !throws(() => M.buildAttestation(rule, "myclient", a)));

  // --- the mint script agrees with the library ---
  const contract = join(PACK_ROOT, "templates/attestation/AttestationContract.cs");
  const cli = (extra) => execFileSync("node", [join(PACK_ROOT, "templates/attestation/mint-rule.mjs"), "--contract", contract, "--key-id", "vvk-key-id", "--resource", "myclient", "--policy-version", "4", ...extra], { stdio: ["ignore", "pipe", "pipe"] }).toString();
  const read = (out, k) => new RegExp("^" + k + "=(.*)$", "m").exec(out)?.[1];
  let out = cli(["--claims", "consented", "--mode", "self"]);
  const cid = read(out, "CONTRACT_ID");
  c.ok("mint-rule names the contract by the SHA-512 of its source, upper-case hex", /^[0-9A-F]{128}$/.test(cid ?? ""));
  c.ok("mint-rule (self) emits the rule the library builds, wrapped for the realm",
    read(out, "RULE") === M.toBase64(M.wrapForEnclave(M.buildSigningRule("4", cid, "vvk-key-id", "myclient", ["consented"], { mode: "self" }))));
  out = cli(["--claims", "member-of,shared-with", "--mode", "owner", "--allow-expiry"]);
  c.ok("mint-rule (owner, expiry allowed) emits the rule the library builds",
    read(out, "RULE") === M.toBase64(M.wrapForEnclave(M.buildSigningRule("4", cid, "vvk-key-id", "myclient", ["member-of", "shared-with"], { mode: "owner" }, true))));
  out = cli(["--claims", "verified", "--mode", "role", "--role", "compliance:verify"]);
  c.ok("mint-rule (role) emits the rule the library builds",
    read(out, "RULE") === M.toBase64(M.wrapForEnclave(M.buildSigningRule("4", cid, "vvk-key-id", "myclient", ["verified"], { mode: "role", role: "compliance:verify" }))));
  c.ok("mint-rule refuses a role rule with no role, and a missing mode",
    throws(() => cli(["--claims", "verified", "--mode", "role"])) && throws(() => cli(["--claims", "verified"])));

  // --- verification: a signature covers exactly one statement ---
  const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  const other = await crypto.subtle.exportKey("jwk", (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])).publicKey);
  const signOver = async (b) => M.toBase64(new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, privateKey, b)));
  const full = { ...friend, value: "best" };
  const sig = await signOver(M.buildAttestation(rule, "myclient", full));
  const v = (r, res, a, s, keys, now) => M.verifyAttestation(r, res, a, s, keys, now);
  c.ok("a valid signature verifies", await v(rule, "myclient", full, sig, [jwk]));
  c.ok("...and with other keys in the set", await v(rule, "myclient", full, sig, [other, { kty: "RSA", n: "x", e: "AQAB" }, jwk]));
  const refused = [
    ["a different claim", () => v(rule, "myclient", { ...full, claim: "verified" }, sig, [jwk])],
    ["a different issuer", () => v(rule, "myclient", { ...full, issuer: "vuid-mallory" }, sig, [jwk])],
    ["a different subject", () => v(rule, "myclient", { ...full, subject: "vuid-mallory" }, sig, [jwk])],
    ["a different object", () => v(rule, "myclient", { ...full, object: "admins" }, sig, [jwk])],
    ["a different owner", () => v(rule, "myclient", { ...full, owner: "vuid-mallory" }, sig, [jwk])],
    ["a different value", () => v(rule, "myclient", { ...full, value: "worst" }, sig, [jwk])],
    ["a dropped optional field", () => v(rule, "myclient", friend, sig, [jwk])],
    ["an added expiry", () => v(rule, "myclient", { ...full, expiry: 1900000000 }, sig, [jwk])],
    ["another client", () => v(rule, "other-client", full, sig, [jwk])],
    ["another contract", () => v({ ...rule, contractId: "FFFF" }, "myclient", full, sig, [jwk])],
    ["another realm key id", () => v({ ...rule, keyId: "other" }, "myclient", full, sig, [jwk])],
    ["another policy version", () => v({ ...rule, version: "3" }, "myclient", full, sig, [jwk])],
    ["a different realm's key", () => v(rule, "myclient", full, sig, [other])],
    ["no signature", () => v(rule, "myclient", full, null, [jwk])],
    ["an empty signature", () => v(rule, "myclient", full, "", [jwk])],
    ["a malformed signature", () => v(rule, "myclient", full, "not base64!!", [jwk])],
    ["a truncated signature", () => v(rule, "myclient", full, sig.slice(0, 40), [jwk])],
    ["no keys", () => v(rule, "myclient", full, sig, [])],
  ];
  for (const [label, fn] of refused) {
    let got;
    try { got = await fn(); } catch (e) { got = "threw: " + e.message; }
    c.ok(`verifyAttestation refuses ${label} (false, without throwing)`, got === false, String(got));
  }
  // Expiry is in the signed bytes, and the SERVER enforces it: the network never does.
  const expiring = { ...friend, expiry: 2000000000 };
  const sigExp = await signOver(M.buildAttestation(rule, "myclient", expiring));
  c.ok("an unexpired statement verifies", await v(rule, "myclient", expiring, sigExp, [jwk], 1999999999));
  c.ok("the same statement is refused at and after its expiry",
    (await v(rule, "myclient", expiring, sigExp, [jwk], 2000000000)) === false && (await v(rule, "myclient", expiring, sigExp, [jwk], 2100000000)) === false);
  c.ok("moving the expiry later breaks the signature", (await v(rule, "myclient", { ...friend, expiry: 2100000000 }, sigExp, [jwk], 1999999999)) === false);

  // --- the contract template keeps the properties the SDK check relied on ---
  const cs = packRead("templates/attestation/AttestationContract.cs") || "";
  c.ok("the contract and the library agree on the attestation model id",
    cs.includes(`"${M.ATTESTATION_MODEL}"`) && M.ATTESTATION_MODEL === "BasicCustom<Attestation>:BasicCustom<1>");
  c.ok("the contract requires an IMPLICIT, PRIVATE rule",
    /ApprovalType != ApprovalType\.IMPLICIT/.test(cs) && /ExecutionType != ExecutionType\.PRIVATE/.test(cs));
  c.ok("the contract binds the signer to the Issuer and fails closed if the data stage did not run",
    /signer\.UserId == _issuer/.test(cs) && /_issuer == null/.test(cs));
  c.ok("the contract limits a rule to the claim types it lists", /!Listed\(Claims, claim\)/.test(cs));
  const code = cs.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  c.ok("the contract uses nothing the ORK's IL vetter rejects (lambda, LINQ, static initialiser, clock)",
    !/=>/.test(code) && !/using System\.Linq/.test(code) &&
    !/\bstatic\s+(readonly\s+)?[A-Za-z<>\[\]]+\s+\w+\s*=/.test(code) && !/DateTime|Stopwatch|Guid\.NewGuid|\bRandom\b/.test(code),
    "see canon/custom-contracts.md, Sandbox Restrictions");

  // --- the scenario is reachable, for every kind of statement ---
  const client = await mkClient();
  const single = [
    "attest that this user was added to my close friends group",
    "I want signed team membership that the server cannot forge",
    "prove who is assigned to a case even if the database is compromised",
    "attest membership of a group",
    "attest that a user consented to our data sharing policy",
    "we need a signed record that a user is kyc verified",
    "attest that a manager approved this expense",
    "attest that I shared my document with another user",
    "I need to attest something about a user",
  ];
  for (const situation of single) {
    const r = await callTool(client, "tide_choose_scenario", { situation });
    c.ok(`choose_scenario picks attestation: "${situation}"`,
      !r.isError && /Best scenario match: attestation\b/.test(r.text), r.text.slice(0, 170).replace(/\n/g, " | "));
  }
  let r = await callTool(client, "tide_choose_playbook", { situation: single[0] });
  c.ok("choose_playbook routes the same request to the scenario, with the work order",
    /Scenario match: attestation\b/.test(r.text) && /Work order/.test(r.text) && /deploy-forseti-policy/.test(r.text), r.text.slice(0, 160).replace(/\n/g, " | "));
  const stay = [
    ["prove I created this artwork with a timestamp", "attested-provenance-registry"],
    ["a provenance registry for content authenticity certificates", "attested-provenance-registry"],
    ["build an organisation password manager", "organisation-password-manager"],
    ["admin panel to review and approve change requests", "iga-admin-governance"],
    ["keyless ssh signing", "policy-governed-signing"],
  ];
  for (const [situation, want] of stay) {
    r = await callTool(client, "tide_choose_scenario", { situation });
    c.ok(`the attestation scenario does not take "${situation}" from ${want}`, r.text.includes(`Best scenario match: ${want}`), r.text.slice(0, 140).replace(/\n/g, " | "));
  }
  // Content for third parties AND the word "attest": both fit, so the agent must be asked to choose.
  r = await callTool(client, "tide_choose_scenario", { situation: "attest who created this file so a third party can verify the certificate" });
  c.ok("a content-and-third-party request is offered both attestation scenarios, with the question that separates them",
    /attested-provenance-registry/.test(r.text) && (/Best scenario match: attested-provenance-registry/.test(r.text) || (/Multiple scenarios match/.test(r.text) && /\*\*attestation\*\*/.test(r.text))), r.text.slice(0, 200).replace(/\n/g, " | "));
  r = await callTool(client, "tide_choose_playbook", { situation: "add login to a new Next.js app" });
  c.ok("a plain new app is not pulled into the attestation scenario", !/Scenario match: attestation/.test(r.text));

  r = await callTool(client, "tide_scenario", { name: "attestation" });
  c.ok("tide_scenario returns the catalogue, the three modes, the limits and the anti-patterns",
    !r.isError && /The catalogue/.test(r.text) && /`member-of`/.test(r.text) && /`consented`/.test(r.text) && /`verified`/.test(r.text) &&
    /\*\*self\*\*/.test(r.text) && /\*\*owner\*\*/.test(r.text) && /\*\*role\*\*/.test(r.text) &&
    /Revocation is not attested/.test(r.text) && /AP-AT01/.test(r.text) && /rebuild, never store/i.test(r.text));
  r = await callTool(client, "tide_scenario_bootstrap", { name: "attestation" });
  c.ok("its bootstrap leads with the licence ask and covers minting and signing a rule per kind of issuer",
    r.text.indexOf("BEFORE ANY TIDE REALM IS SET UP") < 20 && /mint-rule\.mjs/.test(r.text) && /--mode owner/.test(r.text) && /--mode self/.test(r.text) && /--mode role/.test(r.text) &&
    /captured, not signed/.test(r.text) && /\*\*every\*\* ORK/i.test(r.text));
  r = await callTool(client, "tide_scenario_roles", { name: "attestation" });
  c.ok("its role matrix says self and owner rules need no issuer role", !r.isError && /`self` and `owner` rules need no issuer role/.test(r.text));
  r = await callTool(client, "tide_canon", { name: "custom-contracts", section: "Two ways to attest" });
  c.ok("canon explains when to use each attestation shape", !r.isError && /reference-apps\/attestation|`attestation`/.test(r.text) && /attested-provenance-registry/.test(r.text));
  await client.close();

  return c.results;
}
