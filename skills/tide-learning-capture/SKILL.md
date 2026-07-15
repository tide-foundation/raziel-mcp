# Role: Learning Capture

---

## Purpose

Convert raw session findings into structured pack learnings, refinement backlog entries, and pack update candidates. This skill closes the feedback loop: real-world build failures become pack improvements.

---

## Boundary

| This skill owns | Does NOT own |
|----------------|-------------|
| Formatting raw findings into L-## entries | Deciding whether to apply the fix |
| Creating RB-### backlog entries | Applying patches to canon/playbooks/skills |
| Creating PUC-### update candidates | Reviewing or accepting implementations |
| Assigning severity and affected layer | Running evals or regression tests |
| Detecting duplicates against existing learnings | Changing MCP server code |

This skill captures and structures. It does not patch. Hand the structured output to the appropriate specialist or reteach pass.

---

## When to Trigger

- After a build session where something went wrong or behaved unexpectedly
- After a reviewer flags an issue that is not yet in the pack
- When raw notes exist but are not yet in the standard format
- When the user says "capture this", "log this finding", or "reteach"

---

## When NOT to Trigger

- For app-specific bugs that do not affect pack guidance
- For issues already captured in an existing LEARNINGS file (check first)
- For fixes that are already PATCHED in the refinement backlog

---

## Inputs

The skill accepts one or more raw findings. Each finding must include:

1. **What happened** — the observed behavior
2. **What should have happened** — the expected behavior
3. **Where it happened** — which playbook, skill, scenario, canon file, or template was involved

Optional but valuable:
- Error messages or logs
- The user request that triggered the issue
- Which MCP tool or scenario was in use

---

## Output Format

### Step 1: LEARNINGS entry (L-##)

Write to `notes/test-findings/LEARNINGS-<batch-name>.md`. Use the next available L-## number within that file.

Each entry follows this exact structure:

```markdown
## L-##: <short title>

**Finding**: <what happened and what the agent or user observed>

**Root cause**: <why it happened — which pack artifact gave wrong guidance, or what was missing>

**Proposed fix (pack layer)**: <which file(s) to change and what the change should be>

**Scenario affected**: <which scenario(s) or "all scenarios">

**Regression test**: <how to verify the fix works — ideally a concrete check>
```

Rules:
- If the finding is app-specific and does not affect pack guidance, mark it `**Status**: App-specific. Not a pack issue.` and stop. Do not create RB or PUC entries.
- If the finding duplicates an existing learning, reference it instead: `**Status**: Duplicate of LEARNINGS-batch-007 L-03. No new entry needed.`

### Step 2: Refinement backlog entry (RB-###)

Append one row to `notes/refinement-backlog.md`. Use the next available RB-### number.

Format:

```
| RB-### | <issue summary> | <LEARNINGS file> L-##: <evidence> | <file(s) to patch> | <severity> | OPEN | <eval ID or "—"> |
```

Severity levels:
- **HIGH** — agent produces broken or insecure output
- **MEDIUM** — agent produces suboptimal output or user must manually correct
- **LOW** — cosmetic, documentation, or edge case

### Step 3: Pack update candidate (PUC-###)

Append to `notes/pack-update-candidates.md`. Use the next available PUC-### number.

Format:

```markdown
## PUC-###: <short title> (RB-###)

**Change**: <what to change, in one sentence>

**Files**:
- <file path 1>
- <file path 2>

**Why this layer**: <why this is the right file to patch, not a different one>

**MCP**: <"No MCP code change needed" or describe the MCP change>
```

---

## Duplicate Detection

Before creating any new entry, check:

1. Scan existing `notes/test-findings/LEARNINGS*.md` files for similar root causes
2. Scan `notes/refinement-backlog.md` for matching RB entries
3. If a match exists and is PATCHED, check whether this is a regression (same issue returned) or a new variant

If duplicate: reference the existing entry and note whether it's a confirmed regression or a false alarm.

---

## Numbering

- **L-## numbers** are scoped per LEARNINGS file. Each file starts at L-01.
- **RB-### numbers** are global across the refinement backlog. Continue from the highest existing number.
- **PUC-### numbers** are global across pack-update-candidates. Continue from the highest existing number.

To find the next number, read the tail of the respective file.

---

## Batch Naming

Name the LEARNINGS file based on context:
- Session-based: `LEARNINGS-session-###.md` (for interactive build sessions)
- Batch-based: `LEARNINGS-batch-###.md` (for eval runs or bulk testing)
- Project-based: `<project>-learnings-batch-####.md` (for findings from a specific external project)

---

## Anti-Patterns

- **Do not create learnings for things that work correctly.** Only capture deviations.
- **Do not propose fixes outside the pack.** If the issue is in the SDK or TideCloak itself, note it as `**Status**: SDK/platform issue. Outside pack scope.` and stop after the L-## entry.
- **Do not combine multiple root causes into one entry.** If one session surfaced three issues, create three separate L-## entries, three RB rows, and three PUC sections.
- **Do not mark severity based on frequency.** A rare issue that produces insecure output is HIGH. A common issue that produces a cosmetic glitch is LOW.
- **Do not skip the duplicate check.** The most common waste is re-capturing something already patched.

---

## Handoff Trace

The skill emits a `[CAPTURE]` block when complete:

```
[CAPTURE]
Batch: <LEARNINGS file name>
Entries: L-01 through L-##
Backlog: RB-### through RB-###
Candidates: PUC-### through PUC-###
Duplicates skipped: <count or "none">
Next: reteach pass to apply PUC entries, or manual review
[/CAPTURE]
```
