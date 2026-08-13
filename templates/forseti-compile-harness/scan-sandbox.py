#!/usr/bin/env python3
"""
Scan a Forseti contract for sandbox-blocked namespaces and non-deterministic calls.

WHY THIS IS NOT A GREP
----------------------
A plain grep over the file matches COMMENTS, so a contract that merely *documents* the sandbox
restrictions ("no System.IO / System.Net / ...") fails its own pre-flight. That teaches the wrong
lesson twice: it fails a contract that is fine, and the obvious workaround — deleting the comment —
removes documentation instead of fixing anything. Worst of all, a checker that cries wolf trains
people to ignore it.

The naive fix — strip anything after `//` — is unsafe: the `//` inside a string literal such as
"http://example.com" would start a fake comment and swallow the rest of the line, hiding a REAL call
after it. A false negative here costs an operator approval and a BadPolicy.ForbiddenCall at upload.

So this strips comments *correctly*: a small C#-aware scanner that tracks string state
("..." with escapes, verbatim @"..." where "" is an escaped quote, and '...' char literals) and only
treats // and /* */ as comments when they appear outside a string.

Result:
  - a hit in CODE     -> FAIL (exit 1). This is a real violation.
  - a hit in a COMMENT -> WARN (exit 0). Reported with the line, so you can see it is harmless.

Usage:  scan-sandbox.py <file.cs> [<file.cs> ...]
"""

import re
import sys

BLOCKED = [
    r"System\.IO", r"System\.Net", r"System\.Threading", r"System\.Reflection",
    r"System\.Diagnostics", r"System\.Console", r"System\.Runtime\.InteropServices",
    r"Microsoft\.Win32",
    r"DateTime\.Now", r"DateTime\.UtcNow", r"DateTimeOffset\.Now", r"DateTimeOffset\.UtcNow",
    r"Guid\.NewGuid", r"new Random", r"Random\.Shared",
]


def split_code_and_comments(src):
    """Return (code, comments): same length as src, with the other part blanked to spaces.

    Newlines are preserved in both so line numbers stay accurate.
    """
    code = []
    comments = []
    i, n = 0, len(src)
    state = None  # None | 'line' | 'block' | 'str' | 'verbatim' | 'char'

    def emit(ch, to_code):
        if ch == "\n":
            code.append("\n")
            comments.append("\n")
            return
        code.append(ch if to_code else " ")
        comments.append(" " if to_code else ch)

    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ""

        if state is None:
            if c == "/" and nxt == "/":
                state = "line"; emit(c, False); emit(nxt, False); i += 2; continue
            if c == "/" and nxt == "*":
                state = "block"; emit(c, False); emit(nxt, False); i += 2; continue
            if c == "@" and nxt == '"':
                state = "verbatim"; emit(c, True); emit(nxt, True); i += 2; continue
            if c == '"':
                state = "str"; emit(c, True); i += 1; continue
            if c == "'":
                state = "char"; emit(c, True); i += 1; continue
            emit(c, True); i += 1; continue

        if state == "line":
            if c == "\n":
                state = None
            emit(c, False); i += 1; continue

        if state == "block":
            if c == "*" and nxt == "/":
                state = None; emit(c, False); emit(nxt, False); i += 2; continue
            emit(c, False); i += 1; continue

        if state == "str":
            if c == "\\" and nxt:
                emit(c, True); emit(nxt, True); i += 2; continue
            if c == '"':
                state = None
            emit(c, True); i += 1; continue

        if state == "verbatim":
            if c == '"' and nxt == '"':          # "" is an escaped quote in a verbatim string
                emit(c, True); emit(nxt, True); i += 2; continue
            if c == '"':
                state = None
            emit(c, True); i += 1; continue

        if state == "char":
            if c == "\\" and nxt:
                emit(c, True); emit(nxt, True); i += 2; continue
            if c == "'":
                state = None
            emit(c, True); i += 1; continue

    return "".join(code), "".join(comments)


def find(haystack, src_lines):
    hits = []
    for pattern in BLOCKED:
        for m in re.finditer(pattern, haystack):
            line = haystack.count("\n", 0, m.start()) + 1
            hits.append((line, pattern.replace("\\", ""), src_lines[line - 1].strip()[:100]))
    return sorted(set(hits))


def main(paths):
    failed = False
    for path in paths:
        try:
            src = open(path, encoding="utf-8").read()
        except OSError as e:
            print(f"    ERROR: cannot read {path}: {e}", file=sys.stderr)
            failed = True
            continue

        lines = src.split("\n")
        code, comments = split_code_and_comments(src)

        code_hits = find(code, lines)
        comment_hits = find(comments, lines)

        for line, pat, text in comment_hits:
            print(f"    WARN  {path}:{line}: '{pat}' appears in a COMMENT — harmless, not a call")
            print(f"          {text}")

        for line, pat, text in code_hits:
            print(f"    FAIL  {path}:{line}: '{pat}' is blocked in the Forseti sandbox", file=sys.stderr)
            print(f"          {text}", file=sys.stderr)
            failed = True

        if not code_hits:
            note = f" ({len(comment_hits)} comment mention(s) ignored)" if comment_hits else ""
            print(f"    OK    {path}: no blocked call sites{note}")

    if failed:
        print(
            "\n    Blocked namespaces compile fine and fail IL vetting at UPLOAD with\n"
            "    BadPolicy.ForbiddenCall. Time must come from Cryptide.Tools.Utils.GetEpochSeconds(),\n"
            "    never DateTime.UtcNow.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__.strip())
        sys.exit(2)
    sys.exit(main(sys.argv[1:]))
