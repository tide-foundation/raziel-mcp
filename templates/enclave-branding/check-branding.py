#!/usr/bin/env python3
"""
Validate enclave branding assets BEFORE uploading them.

Works on any image, however it was produced — this script, an image model, or a designer. What
matters is the constraints, not the provenance.

Two classes of check, kept apart on purpose:

  [HARD]  Enforced by TideCloak. Failing one means the upload is REJECTED.
          Verified against tide-IdP-keycloak/.../TideIdpAdminRealmResource.java.

  [REC]   Recommendations for how the asset RENDERS in the enclave. Not enforced anywhere —
          the server does no dimension validation at all — so these are warnings, not errors.
          Marked ASSUMED in the pack: the enclave's exact layout is not in readable sources.

Usage:
  python3 check-branding.py branding/                 # expects logo.* and background.*
  python3 check-branding.py logo.png --as LOGO
  python3 check-branding.py bg.jpg  --as BACKGROUND_IMAGE

Exit 0 = every HARD check passed (warnings may remain). Exit 1 = at least one HARD failure.
"""

import argparse, os, struct, sys, zlib

MAX_BYTES = 5 * 1024 * 1024                                    # HARD: server cap
ALLOWED_EXT = {"png", "jpg", "jpeg", "gif", "webp"}            # HARD: server allowlist (no svg)

# [REC] geometry. Chosen so `object-contain` never crops and the centre stays legible.
LOGO_MIN = 256
LOGO_MAX_ASPECT = 1.25          # near-square
BG_MIN_W, BG_MIN_H = 1280, 720
BG_TARGET_ASPECT = 16 / 9
BG_ASPECT_TOL = 0.25


def dims(path, data):
    """(width, height, kind) with no third-party deps."""
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        w, h = struct.unpack(">II", data[16:24])
        return w, h, "png"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        w, h = struct.unpack("<HH", data[6:10])
        return w, h, "gif"
    if data[:2] == b"\xff\xd8":                                  # JPEG: walk to a SOF marker
        i = 2
        while i < len(data) - 9:
            if data[i] != 0xFF:
                i += 1
                continue
            m = data[i + 1]
            if m in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                h, w = struct.unpack(">HH", data[i + 5:i + 9])
                return w, h, "jpeg"
            if m in (0xD8, 0xD9) or 0xD0 <= m <= 0xD7:
                i += 2
                continue
            seg = struct.unpack(">H", data[i + 2:i + 4])[0]
            i += 2 + seg
        return None, None, "jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        c = data[12:16]
        if c == b"VP8 ":
            w, h = struct.unpack("<HH", data[26:30])
            return w & 0x3FFF, h & 0x3FFF, "webp"
        if c == b"VP8L":
            b = struct.unpack("<I", data[21:25])[0]
            return (b & 0x3FFF) + 1, ((b >> 14) & 0x3FFF) + 1, "webp"
        if c == b"VP8X":
            w = int.from_bytes(data[24:27], "little") + 1
            h = int.from_bytes(data[27:30], "little") + 1
            return w, h, "webp"
    return None, None, "unknown"


def png_alpha_stats(data):
    """(has_alpha_channel, transparent_border, min_border_alpha) for a PNG, else None."""
    try:
        w, h = struct.unpack(">II", data[16:24])
        depth, ctype = data[24], data[25]
        if ctype != 6 or depth != 8:
            return (ctype in (4, 6), None, None)
        i, idat = 8, b""
        while i < len(data):
            ln = struct.unpack(">I", data[i:i + 4])[0]
            tag = data[i + 4:i + 8]
            if tag == b"IDAT":
                idat += data[i + 8:i + 8 + ln]
            i += 12 + ln
        raw = zlib.decompress(idat)
        stride = w * 4
        if len(raw) < h * (stride + 1):
            return (True, None, None)
        # Undo PNG filters properly — filter 0 is not guaranteed for arbitrary encoders.
        rows, prev = [], bytearray(stride)
        pos = 0
        for _ in range(h):
            ft = raw[pos]; pos += 1
            line = bytearray(raw[pos:pos + stride]); pos += stride
            if ft == 1:
                for x in range(4, stride): line[x] = (line[x] + line[x - 4]) & 0xFF
            elif ft == 2:
                for x in range(stride): line[x] = (line[x] + prev[x]) & 0xFF
            elif ft == 3:
                for x in range(stride):
                    a = line[x - 4] if x >= 4 else 0
                    line[x] = (line[x] + ((a + prev[x]) >> 1)) & 0xFF
            elif ft == 4:
                for x in range(stride):
                    a = line[x - 4] if x >= 4 else 0
                    b = prev[x]; c = prev[x - 4] if x >= 4 else 0
                    p = a + b - c
                    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                    pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                    line[x] = (line[x] + pr) & 0xFF
            rows.append(line); prev = line
        band = max(1, min(w, h) // 32)
        border = []
        for y in range(h):
            for x in range(w):
                if x < band or x >= w - band or y < band or y >= h - band:
                    border.append(rows[y][x * 4 + 3])
        return (True, all(a == 0 for a in border), min(border) if border else None)
    except Exception:
        return (None, None, None)


def check(path, kind):
    hard, warn = [], []
    name = os.path.basename(path)
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    data = open(path, "rb").read()
    size = len(data)

    if ext not in ALLOWED_EXT:
        hard.append(f"format '{ext or '(none)'}' is not accepted. Allowed: {', '.join(sorted(ALLOWED_EXT))}. "
                    f"SVG is rejected by the server — rasterise it.")
    if size > MAX_BYTES:
        hard.append(f"{size/1024/1024:.2f} MB exceeds the 5 MB cap")

    w, h, detected = dims(path, data)
    if w is None:
        warn.append("could not read dimensions (unrecognised or truncated file) — check it opens")
    else:
        if detected != ("jpeg" if ext in ("jpg", "jpeg") else ext):
            warn.append(f"extension says '{ext}' but the bytes look like '{detected}' — "
                        f"the server keys the allowlist off the FILENAME, so a mislabelled file "
                        f"can upload and then fail to render")
        if kind == "LOGO":
            if w < LOGO_MIN or h < LOGO_MIN:
                warn.append(f"{w}x{h} is small for a logo; >= {LOGO_MIN}px on the short edge scales better")
            ar = max(w, h) / max(1, min(w, h))
            if ar > LOGO_MAX_ASPECT:
                warn.append(f"aspect {w}:{h} ({ar:.2f}:1) is far from square; a square canvas renders "
                            f"predictably under object-contain")
            if ext == "png":
                has_a, transparent_border, min_border = png_alpha_stats(data)
                if has_a is False:
                    warn.append("no alpha channel — a logo on an opaque box shows as a rectangle "
                                "against the enclave background")
                elif transparent_border is False:
                    warn.append(f"artwork touches the canvas edge (min border alpha {min_border}); "
                                f"add ~10-15% transparent padding per side so it is not visually clipped")
            elif ext in ("jpg", "jpeg"):
                warn.append("JPEG cannot be transparent — use PNG (or WebP) for a logo")
        else:
            if w < BG_MIN_W or h < BG_MIN_H:
                warn.append(f"{w}x{h} is below the {BG_MIN_W}x{BG_MIN_H} suggested minimum; "
                            f"it will upscale and look soft")
            ar = w / max(1, h)
            if abs(ar - BG_TARGET_ASPECT) > BG_ASPECT_TOL:
                warn.append(f"aspect {ar:.2f}:1 is away from 16:9 ({BG_TARGET_ASPECT:.2f}:1); "
                            f"expect cropping on one axis")

    label = f"{name}  [{kind}]"
    print(f"\n{label}\n{'-' * len(label)}")
    print(f"  size       {size/1024:.0f} KB (cap 5120 KB)")
    print(f"  dimensions {w}x{h}" if w else "  dimensions unknown")
    for m in hard:
        print(f"  HARD FAIL  {m}")
    for m in warn:
        print(f"  warn       {m}")
    if not hard and not warn:
        print("  OK         passes every hard constraint and every recommendation")
    elif not hard:
        print("  OK         passes every HARD constraint (warnings above are recommendations)")
    return len(hard)


def main():
    ap = argparse.ArgumentParser(description="Validate enclave branding assets before upload.")
    ap.add_argument("target", help="a directory containing logo.*/background.*, or a single file")
    ap.add_argument("--as", dest="kind", choices=["LOGO", "BACKGROUND_IMAGE"],
                    help="required when target is a single file")
    a = ap.parse_args()

    jobs = []
    if os.path.isdir(a.target):
        for f in sorted(os.listdir(a.target)):
            stem = f.rsplit(".", 1)[0].lower()
            if stem == "logo":
                jobs.append((os.path.join(a.target, f), "LOGO"))
            elif stem in ("background", "background_image", "bg"):
                jobs.append((os.path.join(a.target, f), "BACKGROUND_IMAGE"))
        if not jobs:
            print(f"No logo.* or background.* found in {a.target}", file=sys.stderr)
            return 1
    else:
        if not a.kind:
            print("--as LOGO|BACKGROUND_IMAGE is required for a single file", file=sys.stderr)
            return 1
        jobs.append((a.target, a.kind))

    failures = sum(check(p, k) for p, k in jobs)
    print()
    if failures:
        print(f"{failures} HARD failure(s) — the upload would be rejected.")
        return 1
    print("All HARD constraints pass. Upload with fileType=LOGO / BACKGROUND_IMAGE, then SAVE to re-sign.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
