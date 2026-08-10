# Giving an Autonomous Agent Tide-Governed Authority — Canon

The question: *"my AI agents need to approve/sign/authorize things — how do they get Tide identities?"*

The short answer: **they cannot hold one directly.** This page states the constraint, the pattern that
does work, and — importantly — the limit of what that pattern buys, so nobody ships it believing it
proves more than it does.

Status: the constraint is VERIFIED (two independent gap-register entries). The pattern is
LIKELY_REUSABLE_PATTERN, exercised in a real build (LEARNINGS-agent-quorum-001 L-11).

---

## The constraint

**An autonomous process cannot authenticate to Tide, and cannot produce a signature by itself.**

| Gap | What it blocks |
|---|---|
| **GAP-064** | No headless/CLI auth. PRISM requires the browser Secure Web Enclave. No device-code grant, no service account, no client-credentials path to a doken. |
| **GAP-063** | ORK signing (`createTideRequest` → `executeSignRequest`) is JS-SDK **and browser** only. No Go, Python, or REST path. |

Both are `STILL_UNRESOLVED`. They are not oversights to route around — there is no supported
workaround, and attempts to synthesise one (scripting a headless browser, replaying a captured doken,
proxying the SDK from a server) either break the security model or break on the next SDK release.

**Design consequence**: any app of the form "agents with authority" must put a **human-owned
authenticated browser session** at the point where authority is exercised. That is not a UX
preference; it is where the credential can exist.

---

## The pattern that works

**One TideCloak principal per agent *role*, each holding exactly one client role, each operating
through its own authenticated browser session** — an "agent operator console".

```
agent role            TideCloak principal     client role         session
────────────────────  ──────────────────────  ──────────────────  ────────────────────────
planner               planner@example          approve:plan        operator console tab
security-reviewer     reviewer@example         approve:security    operator console tab
deployer              deployer@example         approve:deploy      operator console tab
```

- The **reasoning** runs wherever you like — a server, a queue worker, someone's laptop.
- The **credential** is Tide-issued and role-scoped, and lives only in that session.
- The agent's *decision* is an input; the *authorization* is a doken-backed signature obtained in the
  session.

Where a decision needs more than one role's assent, that is a Forseti contract with a
**role-distinct approver quorum** — the contract checks that N approvers hold N *different* roles, so
one compromised principal cannot satisfy a multi-role gate alone.

### What it buys

**An attacker owning the orchestrator cannot mint an approval for a role it does not hold.** The doken
is VVK-signed; the app cannot forge one; the ORKs check the role independently of your backend. This is
a real and unusual property — the orchestrator is *not* in the trust boundary for authorization.

### What it does NOT buy — say this out loud

**Workload attestation.** Tide attests *whoever holds this session holds this role*. It does **not**
attest that the holder is the agent you believe it is, or that the code that made the decision is the
code you reviewed.

> **Compromising the session is equivalent to compromising the approver.**

There is no TPM/SPIFFE/Nitro binding in the current model. If your threat model includes "the agent
process was replaced", Tide does not address it, and claiming otherwise would be the exact
overstatement this pack exists to prevent.

**Leave the seam.** Structure the code so a `WorkloadAttestation` check can be added later without
reshaping the authorization path — e.g. a single interface consulted alongside the role check, today
returning `unattested`. That keeps the honest limit visible in the code rather than only in a doc.

---

## Anti-patterns

- **Claiming an agent "has a Tide identity"** when what exists is a human-owned session the agent
  drives. Describe it accurately; the distinction is the whole security story.
- **One shared principal for all agents.** Collapses role separation, so any agent can approve
  anything. One principal per role, one role per principal.
- **Storing a doken server-side to reuse it later** — violates AP-21 (dokens are never stored
  server-side) and does not survive expiry anyway.
- **Building a headless-browser harness to "get around" GAP-064.** It puts the enclave under
  automation control, which defeats the property the enclave provides, and breaks on SDK updates.
- **Implying workload attestation.** No TPM/SPIFFE/Nitro binding exists. State the session-compromise
  equivalence explicitly in any security write-up.
- **Auto-approving an agent's own request from the backend** — AP-37. The approval must come from a
  session holding the required role, not from server code acting on the agent's behalf.

---

## Verification

| Check | Expected |
|---|---|
| Each agent principal holds exactly one client role | Role list per principal has length 1 |
| Orchestrator compromise cannot forge an approval | With the orchestrator's own credentials, an approval for a role it does not hold is refused by the ORKs, not by app code |
| Multi-role gates need distinct roles | A contract requiring N distinct roles denies N approvals from one principal |
| No doken is persisted | Grep the server for doken storage; expect none (AP-21) |
| The honest limit is documented | Security notes state that session compromise == approver compromise |

---

## Related

- GAP-063, GAP-064 — the two constraints, in `GAP_REGISTER.md`
- [custom-contracts.md](custom-contracts.md) — writing the quorum contract; `ValidateApprovers`
- [anti-patterns.md](anti-patterns.md) — AP-21 (dokens never stored server-side)
- [anti-patterns.md](anti-patterns.md) — AP-37 (backend auto-approval of governed changes)
- [invariants.md](invariants.md) — I-16 (post-auth redirect handler), I-12 (DPoP)
- `reference-apps/attested-provenance-registry/` — the same browser-only constraint, for signed claims
