#!/usr/bin/env python3
"""
Validate enclave branding assets BEFORE uploading them.

Works on any image, however it was produced — this script, an image model, or a designer. What
matters is the constraints, not the provenance.

Two classes of check, kept apart on purpose:

  [HARD]  Enforced by TideCloak. Failing one means the upload is REJECTED.
          Verified against tide-IdP-keycloak/.../TideIdpAdminRealmResource.java.

  [REC]   How the asset RENDERS in the enclave. The server does NO dimension validation, so these
          never block an upload — but they are MEASURED, not guessed. Taken from the live enclave
          stylesheet (ork*.tideprotocol.com/app.*.css) and confirmed by hit-testing the rendered
          element:

              main .logo .img_container {
                width: 85%; height: 85%;          /* of a 100-180px wrapper -> 85-153 CSS px */
                border-radius: 50%;               /* CIRCULAR CROP — corners are cut */
                background-size: cover;           /* FILLS and crops; it does NOT fit-inside */
                background-position: center;
                background-color: var(--white);   /* a WHITE plate sits behind the logo */
              }

          Two consequences most people get wrong:
            * `cover`, not `contain`. A non-square logo is cropped on its long axis before the
              circle is even applied. Square is not a preference; it is the only safe shape.
            * The corners are gone. Content must sit inside the circle inscribed in the canvas.
              For a SQUARE mark that means a >= 14.65% inset per side (a square inscribed in a
              circle has side = diameter / sqrt(2)). A circular mark can go edge to edge.

Usage:
  python3 check-branding.py branding/                 # expects logo.* and background.*
  python3 check-branding.py logo.png --as LOGO
  python3 check-branding.py bg.jpg  --as BACKGROUND_IMAGE

Exit 0 = every HARD check passed (warnings may remain). Exit 1 = at least one HARD failure.
"""

import argparse, math, os, struct, sys, zlib

MAX_BYTES = 5 * 1024 * 1024                                    # HARD: server cap
ALLOWED_EXT = {"png", "jpg", "jpeg", "gif", "webp"}            # HARD: server allowlist (no svg)

# [REC] geometry — MEASURED against the live enclave, not chosen.
LOGO_BOX_MAX = 153              # px: 85% of the 180px wrapper at >=1024px viewport
LOGO_MIN = 460                  # LOGO_BOX_MAX * 3 for a 3x-DPR screen
LOGO_MAX_ASPECT = 1.02          # `background-size: cover` crops the long axis — square or nothing
BG_MIN_W, BG_MIN_H = 1920, 1080
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


def _png_rgba_rows(data):
    """(w, h, rows) of unfiltered 8-bit RGBA scanlines, or None if not that format."""
    w, h = struct.unpack(">II", data[16:24])
    depth, ctype = data[24], data[25]
    if ctype != 6 or depth != 8:
        return None
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
        return None
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
    return (w, h, rows)


def png_alpha_stats(data):
    """(has_alpha_channel, transparent_border, min_border_alpha) for a PNG, else None."""
    try:
        got = _png_rgba_rows(data)
        if got is None:
            return (data[25] in (4, 6), None, None)
        w, h, rows = got
        band = max(1, min(w, h) // 32)
        border = []
        for y in range(h):
            for x in range(w):
                if x < band or x >= w - band or y < band or y >= h - band:
                    border.append(rows[y][x * 4 + 3])
        return (True, all(a == 0 for a in border), min(border) if border else None)
    except Exception:
        return (None, None, None)


def png_circle_fit(data, alpha_floor=8, sectors=72):
    """How the artwork sits against the enclave's circular crop.

    Returns (ratio, furthest_xy, uniformity):
      ratio      - furthest opaque pixel as a fraction of the crop radius. > 1.0 means real content
                   is cut off.
      uniformity - how circular the artwork's own outline is: the minimum over angular sectors of
                   (that sector's reach / the largest sector's reach). A filled disc is ~1.0; a
                   square is ~0.71 (its edges sit at 1/sqrt(2) of its corners).

    Both are needed. A disc that exactly fills the canvas has ratio 1.0 and is CORRECT — it matches
    the crop. A square with ratio 1.0 has its corners exactly on the boundary and loses them. Ratio
    alone cannot tell those apart, and reporting "scale to 100%" at a disc is nonsense advice.
    """
    try:
        got = _png_rgba_rows(data)
        if got is None:
            return None
        w, h, rows = got
        cx, cy = (w - 1) / 2, (h - 1) / 2
        radius = min(w, h) / 2
        reach = [0.0] * sectors
        worst, at = 0.0, None
        for y in range(h):
            row = rows[y]
            dy = y - cy
            for x in range(w):
                if row[x * 4 + 3] > alpha_floor:
                    dx = x - cx
                    d = (dx * dx + dy * dy) ** 0.5
                    if d > worst:
                        worst, at = d, (x, y)
                    k = int((math.atan2(dy, dx) + math.pi) / (2 * math.pi) * sectors) % sectors
                    if d > reach[k]:
                        reach[k] = d
        live = [r for r in reach if r > 0]
        uniformity = (min(live) / max(live)) if live and max(live) > 0 else 0.0
        return (worst / radius, at, uniformity) if at else (0.0, None, 0.0)
    except Exception:
        return None


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
                warn.append(f"{w}x{h} is small for a logo. The container renders up to {LOGO_BOX_MAX}"
                            f" CSS px, so a 3x-DPR screen wants >= {LOGO_BOX_MAX * 3} px "
                            f"(Tide's own default is 838x838)")
            ar = max(w, h) / max(1, min(w, h))
            if ar > LOGO_MAX_ASPECT:
                warn.append(f"aspect {w}:{h} ({ar:.2f}:1) is not square. The container uses "
                            f"`background-size: cover`, so the LONG axis is cropped to a square "
                            f"before the circular mask is applied — a wide logo loses its ends. "
                            f"Re-export on a square canvas with the mark centred.")
            if ext == "png":
                has_a, transparent_border, min_border = png_alpha_stats(data)
                if has_a is False:
                    warn.append("no alpha channel. The container is a WHITE circle, so an opaque "
                                "rectangle shows as a square-cornered block clipped to that circle")
                fit = png_circle_fit(data)
                if fit:
                    ratio, where, uniform = fit
                    round_edged = uniform >= 0.90        # the artwork's own outline is a circle
                    if ratio > 1.02 and not round_edged:
                        pct = (1 - 1 / ratio) * 100
                        warn.append(f"artwork reaches {ratio:.2f}x the circular crop radius "
                                    f"(furthest opaque pixel at {where}) and its outline is not "
                                    f"round (uniformity {uniform:.2f}) — the parts sticking out WILL "
                                    f"be cut off. The enclave masks the logo with "
                                    f"`border-radius: 50%`. Scale the mark to about "
                                    f"{100/ratio:.0f}% of its current size, or add ~{pct:.0f}% more "
                                    f"transparent margin.")
                    elif ratio > 1.02 and round_edged:
                        warn.append(f"artwork is round and slightly overflows the crop "
                                    f"({ratio:.2f}x) — the very edge will be shaved. Inset it by "
                                    f"a pixel or two.")
                    elif ratio > 0.97 and not round_edged:
                        warn.append(f"artwork reaches {ratio:.2f}x the crop radius with a "
                                    f"non-round outline (uniformity {uniform:.2f}) — it fits, but "
                                    f"with no margin for antialiasing. Aim for <= 0.95, or make the "
                                    f"mark itself round so it matches the crop.")
                    elif 0 < ratio < 0.55:
                        warn.append(f"artwork occupies only {ratio:.2f}x the crop radius — it will "
                                    f"look lost inside the circle. Aim for 0.80-1.00.")
            elif ext in ("jpg", "jpeg"):
                warn.append("JPEG cannot be transparent — use PNG (or WebP) for a logo")
        else:
            if w < BG_MIN_W or h < BG_MIN_H:
                warn.append(f"{w}x{h} is below the {BG_MIN_W}x{BG_MIN_H} suggested minimum; "
                            f"it will upscale and look soft")
            ar = w / max(1, h)
            if abs(ar - BG_TARGET_ASPECT) > BG_ASPECT_TOL:
                warn.append(f"aspect {ar:.2f}:1 is away from 16:9 ({BG_TARGET_ASPECT:.2f}:1). The "
                            f"element is full-viewport with `background-size: cover`, so it crops "
                            f"on whichever axis is proportionally longer — keep anything that must "
                            f"survive well inside the centre")

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
