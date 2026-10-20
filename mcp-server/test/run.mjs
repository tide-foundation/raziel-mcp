// Tide MCP QA — deterministic release gate.
// Runs the protocol smoke tests + content-consistency checks and exits non-zero on any failure.
import { run as smoke } from "./smoke.test.mjs";
import { run as content } from "./content.test.mjs";
import { run_ as scaffold } from "./scaffold.test.mjs";
import { run as restricted } from "./restricted.test.mjs";
import { run as relationship } from "./relationship.test.mjs";
import { existsSync } from "node:fs";

// The attestation suite checks a custom Forseti contract. That material is not self-service, so
// scripts/redact-public.mjs removes the suite from the public tree along with what it tests.
const suites = [smoke, content, scaffold];
if (existsSync(new URL("./attestation.test.mjs", import.meta.url))) suites.push((await import("./attestation.test.mjs")).run);
suites.push(restricted, relationship);

const results = [];
for (const suite of suites) {
  try {
    results.push(...(await suite()));
  } catch (e) {
    results.push({ group: "harness", name: `suite crashed: ${suite.name}`, pass: false, detail: e.stack || e.message });
  }
}

const failures = results.filter((r) => !r.pass);
const byGroup = {};
for (const r of results) {
  byGroup[r.group] ??= { pass: 0, fail: 0 };
  byGroup[r.group][r.pass ? "pass" : "fail"]++;
}

console.log("\n=== Tide MCP QA — deterministic gate ===\n");
for (const r of results) {
  const tag = r.pass ? "PASS" : "FAIL";
  console.log(`  ${tag}  [${r.group}] ${r.name}${r.pass ? "" : "\n         -> " + r.detail}`);
}
console.log("\n--- summary ---");
for (const [g, v] of Object.entries(byGroup)) {
  console.log(`  ${g}: ${v.pass} passed, ${v.fail} failed`);
}
console.log(`\n  TOTAL: ${results.length - failures.length}/${results.length} passed`);
console.log(failures.length ? "\n  RESULT: FAIL — do not release until green.\n" : "\n  RESULT: PASS — deterministic gate green.\n");

process.exit(failures.length ? 1 : 0);
