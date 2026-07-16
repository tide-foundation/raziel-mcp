import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join, resolve } from "path";

// Resolve pack root.
// - TIDE_PACK_ROOT env var takes priority (custom deployments)
// - Default: two levels up from dist/ → repo/package root
const PACK_ROOT = process.env.TIDE_PACK_ROOT
  ? resolve(process.env.TIDE_PACK_ROOT)
  : resolve(import.meta.dirname, "..", "..");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function listMarkdownFiles(dir: string): string[] {
  const full = join(PACK_ROOT, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));
}

function listDirectories(dir: string): string[] {
  const full = join(PACK_ROOT, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

function readPackFile(dir: string, name: string): string | null {
  const file = name.endsWith(".md") ? name : `${name}.md`;
  const full = join(PACK_ROOT, dir, file);
  if (!existsSync(full)) return null;
  return readFileSync(full, "utf-8");
}

function readSkill(name: string): string | null {
  const full = join(PACK_ROOT, "skills", name, "SKILL.md");
  if (!existsSync(full)) return null;
  return readFileSync(full, "utf-8");
}

function scenarioExists(scenario: string): boolean {
  return existsSync(join(PACK_ROOT, "reference-apps", scenario));
}

function readScenarioFile(scenario: string, fileName: string): string | null {
  const full = join(PACK_ROOT, "reference-apps", scenario, fileName);
  if (!existsSync(full)) return null;
  return readFileSync(full, "utf-8");
}

function scenarioKeywordsFromName(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[-_\s]+/)
    .filter(Boolean);
}

function parseScenarioManifest(raw: string | null): Record<string, string | string[]> {
  if (!raw) return {};
  const result: Record<string, string | string[]> = {};
  const lines = raw.split("\n");

  let currentListKey: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const keyMatch = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(trimmed);
    if (keyMatch) {
      const [, key, value] = keyMatch;
      if (value === "") {
        currentListKey = key;
        result[key] = [];
      } else {
        currentListKey = null;
        result[key] = value.replace(/^["']|["']$/g, "");
      }
      continue;
    }

    if (currentListKey && trimmed.startsWith("- ")) {
      const arr = (result[currentListKey] as string[]) ?? [];
      arr.push(trimmed.replace(/^- /, "").trim());
      result[currentListKey] = arr;
    }
  }

  return result;
}

function textResponse(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResponse(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

function formatList(title: string, items: string[]) {
  return `## ${title}\n${items.length ? items.map((i) => `- ${i}`).join("\n") : "- (none)"}`;
}

function getScenarioSummary(scenario: string) {
  const manifest = parseScenarioManifest(readScenarioFile(scenario, "manifest.yaml"));
  const title = typeof manifest.title === "string" ? manifest.title : scenario;
  const category = typeof manifest.category === "string" ? manifest.category : "uncategorized";
  const corePatterns = Array.isArray(manifest.core_patterns) ? manifest.core_patterns : [];
  const defaultPlaybooks = Array.isArray(manifest.default_playbooks) ? manifest.default_playbooks : [];
  const matchKeywords = Array.isArray(manifest.match_keywords) ? manifest.match_keywords : [];

  return {
    scenario,
    title,
    category,
    corePatterns,
    defaultPlaybooks,
    matchKeywords,
    manifest,
  };
}

// Negative signals: if the situation contains these words and the scenario
// is not the right match, suppress the score.
const SCENARIO_NEGATIVE_SIGNALS: Record<string, string[]> = {
  "policy-governed-signing": ["ssh", "sign", "signing", "document", "transaction", "certificate"],
  "git-pr-signing-service": ["git", "commit", "merge", "pr", "pull request", "verified", "github"],
};

function scoreScenarioMatch(scenario: string, situation: string) {
  const lower = situation.toLowerCase();
  const summary = getScenarioSummary(scenario);

  const manifestKeywords = [
    scenario,
    ...scenarioKeywordsFromName(scenario),
    ...summary.corePatterns.map((p) => String(p).toLowerCase()),
    ...summary.title.toLowerCase().split(/\s+/),
    ...summary.category.toLowerCase().split(/\s+/),
  ];

  const unique = Array.from(new Set(manifestKeywords.filter(Boolean)));
  let score = unique.reduce((acc, kw) => acc + (lower.includes(kw) ? 1 : 0), 0);

  for (const phrase of summary.matchKeywords) {
    if (lower.includes(String(phrase).toLowerCase())) {
      score += 3;
    }
  }

  const requiredSignals = SCENARIO_NEGATIVE_SIGNALS[scenario];
  if (requiredSignals && score > 0) {
    const hasAnySignal = requiredSignals.some((sig) => lower.includes(sig));
    if (!hasAnySignal) {
      score = 0;
    }
  }

  return {
    ...summary,
    score,
  };
}

// ---------------------------------------------------------------------------
// Content catalogs
// ---------------------------------------------------------------------------

const CANON_FILES = listMarkdownFiles("canon");
const PLAYBOOK_FILES = listMarkdownFiles("playbooks");
const PROMPT_FILES = listMarkdownFiles("prompts");
const ADAPTER_FILES = listMarkdownFiles("adapters");
const SKILL_DIRS = listDirectories("skills");
const REFERENCE_APP_DIRS = listDirectories("reference-apps");

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export function createServer(): McpServer {
  const server = new McpServer({
    name: "@tideorg/mcp",
    version: "1.9.2",
  });

  // 1. List available content
  server.registerTool(
    "tide_list",
    {
      description: "List all available content in the Tide agent pack by category",
      inputSchema: {
        category: z
          .enum(["canon", "playbooks", "skills", "prompts", "adapters", "scenarios", "all"])
          .describe("Which category to list, or 'all' for everything"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ category }) => {
      const sections: Record<string, string[]> = {};
      if (category === "all" || category === "canon") sections.canon = CANON_FILES;
      if (category === "all" || category === "playbooks") sections.playbooks = PLAYBOOK_FILES;
      if (category === "all" || category === "skills") sections.skills = SKILL_DIRS;
      if (category === "all" || category === "prompts") sections.prompts = PROMPT_FILES;
      if (category === "all" || category === "adapters") sections.adapters = ADAPTER_FILES;
      if (category === "all" || category === "scenarios") sections.scenarios = REFERENCE_APP_DIRS;
      const text = Object.entries(sections)
        .map(([cat, items]) => formatList(cat, items))
        .join("\n\n");
      return textResponse(text);
    }
  );

  // 2. Read a specific canon file
  server.registerTool(
    "tide_canon",
    {
      description: "Read a canon file (invariants, anti-patterns, concepts, framework-matrix, feature-mapping, troubleshooting, tidecloak-bootstrap, etc.)",
      inputSchema: { name: z.string().describe(`Canon file name. Available: ${CANON_FILES.join(", ")}`) },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ name }) => {
      const content = readPackFile("canon", name);
      if (!content) return errorResponse(`Canon file '${name}' not found. Available: ${CANON_FILES.join(", ")}`);
      return textResponse(content);
    }
  );

  // 3. Read a playbook
  server.registerTool(
    "tide_playbook",
    {
      description: "Read a step-by-step playbook for a specific Tide task",
      inputSchema: { name: z.string().describe(`Playbook name. Available: ${PLAYBOOK_FILES.join(", ")}`) },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ name }) => {
      const content = readPackFile("playbooks", name);
      if (!content) return errorResponse(`Playbook '${name}' not found. Available: ${PLAYBOOK_FILES.join(", ")}`);
      return textResponse(content);
    }
  );

  // 4. Read a skill
  server.registerTool(
    "tide_skill",
    {
      description: "Read a composable skill definition",
      inputSchema: { name: z.string().describe(`Skill name. Available: ${SKILL_DIRS.join(", ")}`) },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ name }) => {
      const content = readSkill(name);
      if (!content) return errorResponse(`Skill '${name}' not found. Available: ${SKILL_DIRS.join(", ")}`);
      return textResponse(content);
    }
  );

  // 5. Read a prompt file
  server.registerTool(
    "tide_prompt",
    {
      description: "Read a reusable starter prompt from the pack",
      inputSchema: { name: z.string().describe(`Prompt file name. Available: ${PROMPT_FILES.join(", ")}`) },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ name }) => {
      const content = readPackFile("prompts", name);
      if (!content) return errorResponse(`Prompt '${name}' not found. Available: ${PROMPT_FILES.join(", ")}`);
      return textResponse(content);
    }
  );

  // 6. Read an adapter file
  server.registerTool(
    "tide_adapter",
    {
      description: "Read an adapter instruction file (AGENTS, CLAUDE, replit)",
      inputSchema: { name: z.string().describe(`Adapter file name. Available: ${ADAPTER_FILES.join(", ")}`) },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ name }) => {
      const content = readPackFile("adapters", name);
      if (!content) return errorResponse(`Adapter '${name}' not found. Available: ${ADAPTER_FILES.join(", ")}`);
      return textResponse(content);
    }
  );

  // 7. List available scenarios
  server.registerTool(
    "tide_list_scenarios",
    {
      description: "List all available scenario patterns under reference-apps/",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async () => {
      if (REFERENCE_APP_DIRS.length === 0) return textResponse("No scenarios found under reference-apps/");
      const lines = REFERENCE_APP_DIRS.map((name) => {
        const summary = getScenarioSummary(name);
        return `- ${summary.scenario} — ${summary.title} [${summary.category}]`;
      });
      return textResponse(`Available scenarios:\n\n${lines.join("\n")}`);
    }
  );

  // 8. Read scenario summary
  server.registerTool(
    "tide_scenario",
    {
      description: "Read a scenario summary from reference-apps/<scenario>/scenario.md",
      inputSchema: { name: z.string().describe(`Scenario name. Available: ${REFERENCE_APP_DIRS.join(", ")}`) },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ name }) => {
      if (!scenarioExists(name)) return errorResponse(`Scenario '${name}' not found. Available: ${REFERENCE_APP_DIRS.join(", ")}`);
      const scenarioContent = readScenarioFile(name, "scenario.md");
      if (!scenarioContent) return errorResponse(`Scenario '${name}' exists but scenario.md is missing.`);
      const antiPatterns = readScenarioFile(name, "anti-patterns.md");
      const text = antiPatterns ? `${scenarioContent}\n\n---\n\n## Anti-patterns\n\n${antiPatterns}` : scenarioContent;
      return textResponse(text);
    }
  );

  // 9. Read scenario manifest
  server.registerTool(
    "tide_scenario_manifest",
    {
      description: "Read a scenario manifest from reference-apps/<scenario>/manifest.yaml",
      inputSchema: { name: z.string().describe(`Scenario name. Available: ${REFERENCE_APP_DIRS.join(", ")}`) },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ name }) => {
      if (!scenarioExists(name)) return errorResponse(`Scenario '${name}' not found. Available: ${REFERENCE_APP_DIRS.join(", ")}`);
      const content = readScenarioFile(name, "manifest.yaml");
      if (!content) return errorResponse(`Scenario '${name}' exists but manifest.yaml is missing.`);
      return textResponse(content);
    }
  );

  // 10. Read scenario role/policy matrix
  server.registerTool(
    "tide_scenario_roles",
    {
      description: "Read a scenario role-policy matrix from reference-apps/<scenario>/role-policy-matrix.md",
      inputSchema: { name: z.string().describe(`Scenario name. Available: ${REFERENCE_APP_DIRS.join(", ")}`) },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ name }) => {
      if (!scenarioExists(name)) return errorResponse(`Scenario '${name}' not found. Available: ${REFERENCE_APP_DIRS.join(", ")}`);
      const content = readScenarioFile(name, "role-policy-matrix.md");
      if (!content) return errorResponse(`Scenario '${name}' exists but role-policy-matrix.md is missing.`);
      return textResponse(content);
    }
  );

  // 11. Read scenario bootstrap sequence
  server.registerTool(
    "tide_scenario_bootstrap",
    {
      description: "Read a scenario bootstrap sequence from reference-apps/<scenario>/bootstrap-sequence.md",
      inputSchema: { name: z.string().describe(`Scenario name. Available: ${REFERENCE_APP_DIRS.join(", ")}`) },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ name }) => {
      if (!scenarioExists(name)) return errorResponse(`Scenario '${name}' not found. Available: ${REFERENCE_APP_DIRS.join(", ")}`);
      const content = readScenarioFile(name, "bootstrap-sequence.md");
      if (!content) return errorResponse(`Scenario '${name}' exists but bootstrap-sequence.md is missing.`);
      return textResponse(content);
    }
  );

  // 12. Choose best matching scenario
  server.registerTool(
    "tide_choose_scenario",
    {
      description: "Match a user request to a known scenario pattern before falling back to generic playbooks",
      inputSchema: { situation: z.string().describe("Describe the app or problem, e.g. 'build an organisation password manager'") },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ situation }) => {
      const matches = REFERENCE_APP_DIRS
        .map((scenario) => scoreScenarioMatch(scenario, situation))
        .filter((m) => m.score > 0)
        .sort((a, b) => b.score - a.score);

      if (matches.length === 0) {
        return textResponse(`No scenario match for "${situation}". Available scenarios:\n${REFERENCE_APP_DIRS.map((s) => `- ${s}`).join("\n")}`);
      }

      const best = matches[0];
      const second = matches.length > 1 ? matches[1] : null;
      const autoSelect = best.score >= 6 && (!second || best.score - second.score >= 3);
      const closeMatches = autoSelect ? [best] : matches.filter((m) => m.score >= best.score * 0.6 && m.score > 0);

      if (closeMatches.length > 1) {
        const lines = closeMatches.map((m) => {
          const dq = typeof m.manifest.discriminating_question === "string" ? m.manifest.discriminating_question : "";
          return `- **${m.scenario}** (${m.title}, score ${m.score})${dq ? `\n  Disambiguate: ${dq}` : ""}`;
        });
        return textResponse([
          `Multiple scenarios match "${situation}" (I-17 — resolve before proceeding):`,
          "", ...lines, "",
          `Resolve the ambiguity before selecting a playbook path.`,
        ].join("\n"));
      }

      const defaultPlaybooks = best.defaultPlaybooks;
      return textResponse([
        `Best scenario match: ${best.scenario}`,
        `Title: ${best.title}`,
        `Category: ${best.category}`,
        defaultPlaybooks.length
          ? `Default playbooks:\n${defaultPlaybooks.map((p) => `- ${p}`).join("\n")}`
          : `Default playbooks: not declared in manifest.yaml`,
        `Use tide_scenario_manifest, tide_scenario_roles, and tide_scenario_bootstrap for scenario-specific details.`,
      ].join("\n\n"));
    }
  );

  // 13. Recommend the right playbook
  server.registerTool(
    "tide_choose_playbook",
    {
      description: "Recommend the right playbook for a given situation",
      inputSchema: { situation: z.string().describe("Describe what the builder wants to do, e.g. 'add login to a new Next.js app'") },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ situation }) => {
      const lower = situation.toLowerCase();

      const scenarioMatches = REFERENCE_APP_DIRS
        .map((scenario) => scoreScenarioMatch(scenario, situation))
        .filter((m) => m.score > 0)
        .sort((a, b) => b.score - a.score);

      if (scenarioMatches.length > 0) {
        const best = scenarioMatches[0];
        const closeMatches = scenarioMatches.filter((m) => m.score >= best.score * 0.6 && m.score > 0);

        if (closeMatches.length > 1) {
          const lines = closeMatches.map((m) => {
            const dq = typeof m.manifest.discriminating_question === "string" ? m.manifest.discriminating_question : "";
            return `- **${m.scenario}** (score ${m.score})${dq ? ` — ${dq}` : ""}`;
          });
          return textResponse([
            `Multiple scenarios match (I-17 — resolve before proceeding):`,
            ...lines, ``, `Resolve the ambiguity before selecting a playbook path.`,
          ].join("\n"));
        }

        const defaultPlaybooks = best.defaultPlaybooks;
        return textResponse([
          `Scenario match: ${best.scenario}`,
          defaultPlaybooks.length
            ? `Recommended playbook sequence:\n${defaultPlaybooks.map((p) => `- ${p}`).join("\n")}`
            : `Scenario matched, but manifest.yaml does not declare default_playbooks.`,
          `Use tide_scenario_manifest, tide_scenario_roles, and tide_scenario_bootstrap for scenario-specific details.`,
        ].join("\n\n"));
      }

      const matches: Array<{ name: string; reason: string }> = [];
      const rules: Array<{ keywords: string[]; name: string; reason: string }> = [
        { keywords: ["new", "fresh", "setup", "add login", "add auth", "from scratch"], name: "add-auth-nextjs-fresh", reason: "New app needs Tide auth from scratch" },
        { keywords: ["existing", "retrofit", "already has", "migrate"], name: "add-auth-nextjs-existing", reason: "Existing app needs Tide added" },
        { keywords: ["route", "page guard", "redirect", "protect page"], name: "protect-routes-nextjs", reason: "Client-side route protection (UI gating)" },
        { keywords: ["api", "endpoint", "server", "protect api", "backend"], name: "protect-api-nextjs", reason: "Server-side API protection" },
        { keywords: ["jwt", "dpop", "verify", "token"], name: "verify-jwt-server-side", reason: "Complete JWT + DPoP verification" },
        { keywords: ["rbac", "role", "permission", "admin", "access control"], name: "add-rbac-nextjs", reason: "Role-based access control" },
        { keywords: ["login broken", "hang", "stuck", "blank", "csp"], name: "diagnose-broken-login", reason: "Login diagnostics" },
        { keywords: ["role missing", "claim", "no role", "token empty"], name: "diagnose-missing-roles-or-claims", reason: "Missing roles/claims diagnostics" },
        { keywords: ["deploy", "docker", "container", "tidecloak"], name: "deploy-tidecloak-docker", reason: "Deploy TideCloak instance" },
        { keywords: ["e2ee", "encrypt", "decrypt", "forseti", "vault", "share", "sharing", "shared"], name: "setup-forseti-e2ee", reason: "End-to-end encryption setup" },
        { keywords: ["iga", "approval", "governance", "admin panel"], name: "setup-iga-admin-panel", reason: "IGA admin panel setup" },
        { keywords: ["bootstrap", "realm", "init", "initialize"], name: "bootstrap-realm-from-template", reason: "Bootstrap realm from template" },
        { keywords: ["start", "run tidecloak", "launch"], name: "start-tidecloak-dev", reason: "Start TideCloak dev instance" },
        { keywords: ["hosted", "managed", "skycloak", "cloud", "saas", "no infrastructure", "no infra"], name: "provision-tidecloak-skycloak", reason: "Provision hosted TideCloak via Skycloak (managed, no self-hosting)" },
      ];

      for (const rule of rules) {
        if (rule.keywords.some((kw) => lower.includes(kw))) {
          matches.push({ name: rule.name, reason: rule.reason });
        }
      }

      if (matches.length === 0) {
        return textResponse(
          `No exact scenario or playbook match for "${situation}". Available playbooks:\n${PLAYBOOK_FILES.map((p) => `- ${p}`).join("\n")}\n\nAvailable scenarios:\n${REFERENCE_APP_DIRS.map((s) => `- ${s}`).join("\n")}\n\nFor a new app, the standard sequence is:\n1. add-auth-nextjs-fresh\n2. protect-routes-nextjs\n3. protect-api-nextjs\n4. verify-jwt-server-side\n5. add-rbac-nextjs`
        );
      }

      const text = matches.map((m) => `**${m.name}** — ${m.reason}`).join("\n");
      return textResponse(`Recommended playbook(s):\n\n${text}`);
    }
  );

  // 14. Security gap analysis entry point
  server.registerTool(
    "tide_security_analysis",
    {
      description: "Analyze an EXISTING (possibly non-Tide) system for security gaps and map them to Tide capabilities. Returns the Security Analyst role instructions, the security gap mapping table (SG-01…SG-18), and the runtime-probe procedures. Use this when the user asks 'do a security analysis', 'where is my auth weak', or 'what would Tide change about my security'.",
      inputSchema: {
        include_runtime_probes: z
          .boolean()
          .optional()
          .describe(
            "Include the runtime-confirmation probe procedures (canon/security-runtime-probes.md). Only relevant when the operator is authorized to probe a live target. Defaults to true."
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ include_runtime_probes }) => {
      const skill = readSkill("tide-security-analyst");
      const mapping = readPackFile("canon", "security-gap-mapping");
      const featureMapping = readPackFile("canon", "feature-mapping");
      const runtimeProbes = readPackFile("canon", "security-runtime-probes");
      if (!skill || !mapping) {
        return errorResponse(
          "Security analysis assets missing. Expected skills/tide-security-analyst/SKILL.md and canon/security-gap-mapping.md."
        );
      }
      const withRuntime = include_runtime_probes !== false;
      return textResponse(
        [
          "# Tide Security Analysis — operating instructions",
          "",
          "You are running a security gap analysis of an EXISTING system. Follow the Security Analyst role below.",
          "Work through the gap mapping (SG-01 … SG-18) exhaustively against the target. Every finding needs a named",
          "trust concentration and evidence with a confidence tag. The out-of-scope section is mandatory.",
          "",
          "Two tiers: run the STATIC sweep always. Run the RUNTIME confirmation tier only with explicit authorization",
          "to test a live target — it is governed by the authorization gate in the runtime-probes doc below.",
          "",
          "---",
          "",
          "## Role: Security Analyst",
          "",
          skill,
          "",
          "---",
          "",
          "## Security Gap Mapping (SG-01 … SG-18)",
          "",
          mapping,
          featureMapping
            ? "\n---\n\n## Feature Mapping (Tide capability sourcing — cite this for replacements)\n\n" + featureMapping
            : "",
          withRuntime && runtimeProbes
            ? "\n---\n\n## Runtime Confirmation Probes (opt-in, authorized targets only)\n\n" + runtimeProbes
            : "",
        ].join("\n")
      );
    }
  );

  // 15. Hosting options (self-host vs partner-hosted / Skycloak)
  server.registerTool(
    "tide_hosting",
    {
      description: "Explain where TideCloak can run: self-hosted vs partner-hosted (Skycloak, a managed TideCloak-as-a-service). Returns the hosting decision, the trust model, the Skycloak API reference, and the provisioning playbook. Use when the user asks about a hosted/managed option, not wanting to run their own infrastructure, or 'can someone host TideCloak for us'.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async () => {
      const hosting = readPackFile("canon", "hosting-options");
      const playbook = readPackFile("playbooks", "provision-tidecloak-skycloak");
      if (!hosting) {
        return errorResponse("Hosting assets missing. Expected canon/hosting-options.md.");
      }
      return textResponse(
        [
          "# Tide Hosting Options",
          "",
          "Where TideCloak runs is an infrastructure choice separate from app integration. Resolve self-host vs",
          "hosted BEFORE bootstrap (I-17). State the honest trust-model caveats to the operator, not just the benefits.",
          "",
          "---",
          "",
          hosting,
          playbook
            ? "\n---\n\n## Provisioning Playbook: Hosted TideCloak via Skycloak\n\n" + playbook
            : "",
        ].join("\n")
      );
    }
  );

  // 16. Read the gap register
  server.registerTool(
    "tide_gaps",
    {
      description: "Read the gap register — what is still uncertain or unresolved in the pack",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async () => {
      const full = join(PACK_ROOT, "GAP_REGISTER.md");
      if (!existsSync(full)) return errorResponse("GAP_REGISTER.md not found");
      return textResponse(readFileSync(full, "utf-8"));
    }
  );

  // -------------------------------------------------------------------------
  // Prompts
  // -------------------------------------------------------------------------

  server.prompt(
    "tide-build-app",
    "Start building a Tide-protected app from scratch",
    { framework: z.enum(["nextjs", "react-vite", "vanilla"]).describe("Target framework") },
    async ({ framework }) => {
      const adapterContent = readPackFile("adapters", "AGENTS") ?? "";
      const invariantsContent = readPackFile("canon", "invariants") ?? "";
      return {
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `I want to build a new ${framework} app with Tide authentication, authorization, and encryption.\n\nHere are the operational instructions you must follow:\n\n${adapterContent}\n\n---\n\nHere are the security invariants you must never violate:\n\n${invariantsContent}\n\nIf the request matches a known app pattern, start with tide_choose_scenario. Otherwise use tide_choose_playbook. Then follow the resulting bootstrap and playbook path step by step.`,
          },
        }],
      };
    }
  );

  server.prompt(
    "tide-secure-existing",
    "Add Tide to an existing app",
    async () => {
      const promptContent = readPackFile("prompts", "secure-existing-app") ?? "";
      return { messages: [{ role: "user", content: { type: "text", text: promptContent } }] };
    }
  );

  server.prompt(
    "tide-security-analysis",
    "Analyze an existing system for security gaps and map them to Tide",
    async () => {
      const promptContent = readPackFile("prompts", "security-gap-analysis") ?? "";
      const skill = readSkill("tide-security-analyst") ?? "";
      const mapping = readPackFile("canon", "security-gap-mapping") ?? "";
      const runtimeProbes = readPackFile("canon", "security-runtime-probes") ?? "";
      return {
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `${promptContent}\n\n---\n\nSecurity Analyst role instructions:\n\n${skill}\n\n---\n\nSecurity gap mapping:\n\n${mapping}\n\n---\n\nRuntime confirmation probes (authorized targets only):\n\n${runtimeProbes}`,
          },
        }],
      };
    }
  );

  server.prompt(
    "tide-build-from-scenario",
    "Start building a Tide app from a known scenario pattern",
    {
      scenario: z.string().describe(`Scenario name. Available: ${REFERENCE_APP_DIRS.join(", ")}`),
      framework: z.enum(["nextjs", "react-vite", "vanilla"]).describe("Target framework"),
    },
    async ({ scenario, framework }) => {
      if (!scenarioExists(scenario)) throw new Error(`Scenario '${scenario}' not found. Available: ${REFERENCE_APP_DIRS.join(", ")}`);
      const adapterContent = readPackFile("adapters", "AGENTS") ?? "";
      const invariantsContent = readPackFile("canon", "invariants") ?? "";
      const scenarioContent = readScenarioFile(scenario, "scenario.md") ?? "";
      const manifestContent = readScenarioFile(scenario, "manifest.yaml") ?? "";
      const rolesContent = readScenarioFile(scenario, "role-policy-matrix.md") ?? "";
      const bootstrapContent = readScenarioFile(scenario, "bootstrap-sequence.md") ?? "";
      return {
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `I want to build a ${framework} Tide app using the scenario pattern '${scenario}'.\n\nFollow these adapter instructions first:\n\n${adapterContent}\n\n---\n\nSecurity invariants:\n\n${invariantsContent}\n\n---\n\nScenario summary:\n\n${scenarioContent}\n\n---\n\nScenario manifest:\n\n${manifestContent}\n\n---\n\nRole and policy matrix:\n\n${rolesContent}\n\n---\n\nBootstrap sequence:\n\n${bootstrapContent}\n\nStart by honoring the scenario bootstrap and role/policy requirements before falling back to generic playbook selection.`,
          },
        }],
      };
    }
  );

  server.prompt(
    "tide-mcp-qa",
    "Run the pre-release QA gate on the Tide MCP pack and issue a SHIP/BLOCK verdict",
    async () => {
      const skill = readSkill("tide-mcp-qa") ?? "";
      return {
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `Act as the MCP QA Engineer and decide whether the Tide MCP pack is safe to release.\n\nFollow the role below. First run the deterministic gate: \`cd mcp-server && npm test\` — a red or crashed gate is an automatic BLOCK. Then do the semantic review and honesty audit the gate cannot see, drive a sample of eval cases, and emit the Release Readiness Report with a single verdict (SHIP / SHIP_WITH_WARNINGS / BLOCK). Do not edit tests or doctrine to make a check pass.\n\n---\n\n${skill}`,
          },
        }],
      };
    }
  );

  return server;
}
