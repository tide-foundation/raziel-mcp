#!/usr/bin/env python3
"""
Approve and commit all pending IGA change requests ("drain the queue").

WHY THIS IS A FILE AND NOT A BASH HEREDOC
-----------------------------------------
`python3 - <<'PY'` takes the SCRIPT from stdin, so a piped payload is silently swallowed:

    pending=$(curl -s ".../change-requests?status=PENDING")
    echo "$pending" | python3 - <<'PY'          # the heredoc IS stdin; the pipe is discarded
    data = json.loads(sys.stdin.read() or '{}') # therefore always '{}'
    PY

Every drain then reports "0 change requests", the bootstrap log is completely green, and you
end up with a realm containing zero roles and zero users. Combined with the fact that far more
operations are governed than the ACTIVE/DRAFT table suggests (CREATE_ROLE and
SET_USER_ATTRIBUTE both are), this produces a realm that LOOKS configured and is empty.

Take arguments, not stdin.

WHY IT LOOPS IN ROUNDS
----------------------
Committing one change request can make another become ready (`dependsOn`). A single pass
leaves dependents pending. `412` means threshold-or-dependency not yet met and is EXPECTED
mid-drain — tolerate it and re-list, rather than aborting on the first one.

Usage:
    drain-change-requests.py <tidecloak-url> <realm> <token> [max-rounds]

Exit 0 always (a queue that will not drain is reported, not fatal) — callers should follow up
by READING BACK the state they expect. With IGA enabled a 2xx means ACCEPTED, not APPLIED.

See: canon/concepts.md (IGA), canon/iga-change-requests-api.md,
     LEARNINGS-agent-quorum-001 L-01/L-02/L-04/L-12
"""

import json
import sys
import urllib.error
import urllib.request

if len(sys.argv) < 4:
    print(__doc__.strip())
    sys.exit(2)

# Strip trailing slashes: the exported adapter's `auth-server-url` ends with one, and a double
# slash gets rejected as 400 {"error":"missingNormalization"} — an error that names neither the
# URL nor the slash.
url = sys.argv[1].rstrip("/")
realm, token = sys.argv[2], sys.argv[3]
max_rounds = int(sys.argv[4]) if len(sys.argv) > 4 else 6

base = f"{url}/admin/realms/{realm}/iga/change-requests"
headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def call(path, method="GET", body=None):
    req = urllib.request.Request(path, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]
    except Exception as e:  # noqa: BLE001
        return "ERR", str(e)[:200]


def pending():
    status, data = call(f"{base}?status=PENDING")
    if status != 200 or data is None:
        print(f"   could not list change requests: {status} {data}")
        return []
    # This endpoint returns a JSON ARRAY of CR objects, each with a top-level `id`.
    # Some pack revisions described an object keyed by id. Handle BOTH rather than betting:
    # a drain written for the keyed shape does Object.keys() on an array and gets "0","1","2",
    # which then 404 as change-request ids.
    if isinstance(data, dict):
        return [(k, v.get("actionType", "?")) for k, v in data.items()]
    return [(c.get("id"), c.get("actionType", "?")) for c in data if c.get("id")]


total = 0
stalled = False

for round_no in range(1, max_rounds + 1):
    items = pending()
    if not items:
        print(f"   round {round_no}: queue empty")
        break

    progressed = False
    for cid, action in items:
        a_status, _ = call(f"{base}/{cid}/authorize", "POST", b"{}")
        c_status, c_body = call(f"{base}/{cid}/commit", "POST", b"{}")
        ok = c_status in (200, 204)
        if ok:
            progressed = True
            total += 1
        if c_status == 412:
            note = "  <- not ready (412: threshold/dependency unmet)"
        elif a_status == 409:
            note = "  <- four-eyes (409: a DIFFERENT admin must authorize)"
        elif ok:
            note = ""
        else:
            note = f"  <- {c_body}"
        print(f"   {action:<24} {str(cid)[:8]} authorize={a_status} commit={c_status}{note}")

    if not progressed:
        stalled = True
        print(f"   round {round_no}: nothing committed; stopping to avoid a spin")
        break

print(f"   committed {total} change request(s)")

if stalled:
    print(
        "   NOTE: the queue did not fully drain. Common causes:\n"
        "     - 409 four-eyes: another admin must authorize (multiAdmin realm)\n"
        "     - 412: an unmet dependency, or a threshold this admin alone cannot satisfy\n"
        "     - the realm flipped to multiAdmin (granting tide-realm-admin does this), after\n"
        "       which approvals need a human enclave session, not a script"
    )

print(
    "   REMINDER: a 2xx means ACCEPTED, not APPLIED. Read back the roles/users/attributes you\n"
    "   expect before continuing — do not infer success from status codes."
)
sys.exit(0)
