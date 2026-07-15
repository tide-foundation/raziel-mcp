// Protocol smoke tests: the server starts, exposes the expected tools/prompts,
// and each tool returns non-empty, correct-looking content.
import { mkClient, callTool, Checks } from "./harness.mjs";

const EXPECTED_TOOLS = [
  "tide_list", "tide_canon", "tide_playbook", "tide_skill", "tide_prompt",
  "tide_adapter", "tide_list_scenarios", "tide_scenario", "tide_scenario_manifest",
  "tide_scenario_roles", "tide_scenario_bootstrap", "tide_choose_scenario",
  "tide_choose_playbook", "tide_security_analysis", "tide_hosting", "tide_gaps",
];
const EXPECTED_PROMPTS = [
  "tide-build-app", "tide-secure-existing", "tide-build-from-scenario",
  "tide-security-analysis", "tide-mcp-qa",
];

export async function run() {
  const c = new Checks("protocol");
  const client = await mkClient();

  // --- Tools & prompts present ---
  const toolDefs = (await client.listTools()).tools;
  const tools = toolDefs.map((t) => t.name);
  for (const t of EXPECTED_TOOLS) c.ok(`tool present: ${t}`, tools.includes(t), `not in [${tools.join(", ")}]`);
  const extraTools = tools.filter((t) => !EXPECTED_TOOLS.includes(t));
  c.ok("no unexpected tools", extraTools.length === 0, `unexpected: ${extraTools.join(", ")} (update EXPECTED_TOOLS if intentional)`);

  // --- Directory readiness: every tool must be annotated read-only ---
  // (required for the Claude connector directory; all pack tools are read-only)
  for (const t of toolDefs) {
    c.ok(`tool annotated readOnlyHint: ${t.name}`, t.annotations?.readOnlyHint === true, `annotations=${JSON.stringify(t.annotations ?? null)}`);
  }

  const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
  for (const p of EXPECTED_PROMPTS) c.ok(`prompt present: ${p}`, prompts.includes(p), `not in [${prompts.join(", ")}]`);

  // --- Representative tool calls return meaningful content ---
  let r;

  r = await callTool(client, "tide_list", { category: "all" });
  c.ok("tide_list(all) returns content", !r.isError && r.text.length > 80, r.text.slice(0, 120));

  r = await callTool(client, "tide_security_analysis");
  c.ok("security_analysis covers SG-01..SG-18", r.text.includes("SG-01") && r.text.includes("SG-18"));
  c.ok("security_analysis includes runtime probes", r.text.includes("Runtime Confirmation Probes"));
  c.ok("security_analysis includes out-of-scope honesty", /out of scope|does NOT fix/i.test(r.text));

  r = await callTool(client, "tide_hosting");
  c.ok("hosting includes Skycloak API base", r.text.includes("api.skycloak.io"));
  c.ok("hosting states the trust model", /trust model/i.test(r.text));
  c.ok("hosting flags GAP-066 (not turnkey)", r.text.includes("GAP-066"));

  r = await callTool(client, "tide_canon", { name: "iga-change-requests-api" });
  c.ok("iga-change-requests-api canon readable", !r.isError && r.text.includes("/iga/change-requests") && r.text.includes("bulk-authorize"));

  r = await callTool(client, "tide_choose_playbook", { situation: "we want a managed hosted tidecloak, no infrastructure" });
  c.ok("choose_playbook routes hosted -> skycloak", r.text.includes("provision-tidecloak-skycloak"));

  r = await callTool(client, "tide_choose_scenario", { situation: "build an organisation password manager" });
  c.ok("choose_scenario returns a match", !r.isError && r.text.length > 20);

  r = await callTool(client, "tide_gaps");
  c.ok("gaps registers GAP-065 as resolved", r.text.includes("GAP-065") && r.text.includes("RESOLVED_BY_VENDOR"));

  // --- Graceful error handling ---
  r = await callTool(client, "tide_canon", { name: "definitely-not-a-real-canon-file" });
  c.ok("unknown canon returns isError", r.isError === true);

  await client.close();
  return c.results;
}
