# GRC Review

## Purpose

Review the Tide agent pack through governance, risk, and compliance lenses.

This skill is for evidence-based review of what the pack actually supports, partially supports, or does not evidence.

It is a review skill, not a certification skill.
It must not claim that Tide or the pack is compliant or certified unless the repo clearly proves that conclusion.

## When to trigger

Trigger this skill when the user asks to:

- review the Tide pack for governance, risk, or compliance coverage
- assess what Tide supports for ISO 27001, SOC 2, NIST CSF, ISO 42001, GDPR, HIPAA, FedRAMP, PCI, or TSA
- identify overclaims, weak claims, or missing evidence in the pack
- map Tide pack guidance to control areas or compliance capabilities
- produce a GRC gap analysis for the pack
- identify pack improvements needed to strengthen governance, risk, and compliance support

## When not to trigger

Do not trigger this skill when the user is asking to:

- build or fix an app
- wire TideCloak into a repo
- debug login, JWT, RBAC, bootstrap, or policy flows
- update templates, prompts, or playbooks for non-GRC reasons
- answer generic security questions without asking for a GRC/compliance review

In those cases, use the normal Tide setup, integration, protection, IAM/policy, diagnostics, or review workflows instead.

## Review scope

Inspect the actual pack, especially:

- `canon/*`
- `playbooks/*`
- `adapters/*`
- `skills/*`
- `prompts/*`
- `templates/*`
- `reference-apps/*`
- `evals/cases.yaml`
- `notes/*`
- `GAP_REGISTER.md`

If present, also inspect any MCP routing or discovery logic that affects what the pack can surface or enforce.

## External skill lenses

When available, consult these external review lenses:

- `external-skills/iso27001.skill`
- `external-skills/soc2.skill`
- `external-skills/NIST Cybersecurity.skill`
- `external-skills/ISO-42001.skill`
- `external-skills/gdpr-compliance.skill`
- `external-skills/hipaa-compliance.skill`
- `external-skills/fedramp.skill`
- `external-skills/PCI-Compliance.skill`
- `external-skills/TSA-Compliance.skill`

Use them as review lenses only.
Do not treat them as proof that the pack satisfies a framework.

## Core rules

- Base conclusions on repo evidence.
- Prefer file-level evidence.
- Distinguish clearly between:
  - supported
  - partially supported
  - unsupported
  - not evidenced
- Do not confuse implementation guidance with certification.
- Do not confuse app-specific examples with universal pack coverage.
- Do not overclaim based on implication alone.
- If evidence is weak, say so.
- If a framework is not relevant to the pack content, say so and keep coverage light.

## Review method

### 1. Identify relevant frameworks

Start with the frameworks the user asked about.

If no framework was specified, default to:
- ISO 27001
- SOC 2
- NIST CSF

Then include others only if the pack content clearly makes them relevant.

### 2. Map pack evidence to capabilities

Look for evidence in areas such as:

- governance
- risk management
- access control / IAM
- cryptographic controls
- policy / approval workflow
- auditability / traceability
- privacy / data protection
- operational readiness

### 3. Separate support levels

For each capability or framework area, classify as:

- **Supported**  
  The pack clearly teaches or evidences this capability.

- **Partial**  
  The pack points in this direction but is incomplete, weak, or missing important pieces.

- **Unsupported / Not evidenced**  
  The pack does not teach or prove this capability.

### 4. Detect weak claims

Identify where the pack implies more than it proves.

Examples:
- strong security guidance without compliance evidence
- approval/policy flows presented as if they imply formal governance coverage
- examples or scenarios that look like broad control coverage but are actually narrow

### 5. Recommend the lowest correct pack change

For every meaningful gap, recommend:
- the lowest layer to patch first
- likely files to update
- whether the fix belongs in:
  - canon
  - playbook
  - adapter
  - skill
  - prompt
  - template
  - scenario
  - eval
  - MCP

## Output format

Produce the review in this structure unless the user asks for a different one:

# Executive summary
- clearly supported capabilities
- partially supported capabilities
- unsupported or not evidenced areas

# Framework review
For each relevant framework:
- likely applicable control or topic areas
- what the pack supports
- evidence files
- what is missing
- confidence: high / medium / low

# Capability map
Group findings into:
- governance
- risk management
- access control / IAM
- cryptographic controls
- policy / approval workflow
- auditability / traceability
- privacy / data protection
- operational readiness

For each capability:
- supported / partial / unsupported
- evidence files
- short explanation

# Overclaims or weak claims
List any places where the pack implies more than it proves.

# Gaps to close
List the highest-value improvements needed to strengthen GRC support or evidence.

# Recommended pack updates
For each improvement:
- lowest layer to patch first
- likely files to update
- whether it should become a scenario, playbook, template, eval, or MCP learning

## Evidence standard

Good evidence includes:
- direct statements in `canon/*`
- concrete procedures in `playbooks/*`
- enforceable routing or behavior in `adapters/*`, `skills/*`, or MCP logic
- starter implementations in `templates/*`
- explicit scenario patterns in `reference-apps/*`
- regression coverage in `evals/cases.yaml`

Weak evidence includes:
- vague implications
- one-off notes
- app-specific examples without pack-wide support
- assumptions not backed by pack behavior

## Anti-overclaim rules

Do not say:

- “Tide is compliant with X”
- “This pack proves certification”
- “This satisfies framework Y” without strong repo evidence

Prefer wording like:

- “The pack supports capability areas relevant to X”
- “The pack partially evidences controls related to Y”
- “The pack does not currently provide enough evidence for Z”

## Handoff guidance

If the review finds meaningful reusable gaps, recommend follow-up work for:

- `notes/refinement-backlog.md`
- `notes/pack-update-candidates.md`
- `evals/cases.yaml`
- relevant pack layers

Do not rewrite the pack unless the user explicitly asks for that next step.