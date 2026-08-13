#!/usr/bin/env python3
"""
Generate default enclave branding assets — a padded logo and a background image.

WHY THIS IS A SCRIPT AND NOT A PROMPT
-------------------------------------
Most coding agents cannot produce image files. Asking one to "make a 512x512 logo" yields either
nothing, a broken file, or an SVG — and the upload endpoint REJECTS SVG. This script needs no image
model, no Pillow, no network: pure Python stdlib (zlib + struct) writing valid PNGs. An agent that
can run a script can produce correct branding.

WHAT THIS IS NOT
----------------
This does NOT generate artwork "for your kind of app". It has no idea what your app does, and it
does not try to guess: there is no bank glyph, no music note, no health cross. It draws ONE abstract
mark — a rounded square with wave bands — and varies its geometry deterministically from --name so
that two realms do not look alike. Colour comes from --accent.

That is deliberate. A geometric generator attempting to *mean* something produces a mark that looks
like a failed attempt at meaning, which is worse than an obviously neutral placeholder. This is a
placeholder that looks intentional, sized and padded correctly, so nothing about the login screen
looks broken while you get real brand assets made.

If you want artwork that reflects what the app IS, that needs an image model or a designer — see
IMAGE-PROMPT.md, and describe the app in the prompt. Then run `check-branding.py` on the result:
the constraints are what matter, not how the pixels were made.

Usage:
  python3 make-branding.py                          # writes ./branding/{logo,background}.png
  python3 make-branding.py --out dir --accent 2f6f4e --name "Acme"
  python3 make-branding.py --logo-size 512 --bg 1920x1080

Verified constraints this script satisfies (see README.md for sources):
  - format PNG (allowlist is png/jpg/jpeg/gif/webp; SVG is REJECTED server-side)
  - each file well under the 5 MB cap
  - logo is square with transparent padding (a safe area), so `object-contain` never crops it
  - background is 16:9 and deliberately low-detail in the middle, where the enclave puts its content
"""

import argparse, hashlib, math, os, struct, zlib


# ---------------------------------------------------------------------------
# Minimal PNG writer (stdlib only)
# ---------------------------------------------------------------------------

def write_png(path, width, height, rows):
    """rows: iterable of bytearray, each width*4 bytes RGBA."""
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = bytearray()
    for r in rows:
        raw.append(0)          # filter type 0 (None)
        raw.extend(r)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))  # 8-bit RGBA
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def seed_from(name):
    """
    Deterministic seed from the app name.

    Same name -> same mark, always. That matters more than variety: the serve URL is versioned by
    content hash, so a mark that churned between runs would invalidate a deployed URL and force a
    re-upload + re-sign for no reason.

    NOTE this varies the mark's GEOMETRY, not its meaning. It does not infer anything from the app's
    purpose — see the note in the module docstring.
    """
    if not name:
        return 0
    return int(hashlib.sha256(name.encode("utf-8")).hexdigest()[:8], 16)


def hex_rgb(s):
    s = s.lstrip("#")
    if len(s) == 3:
        s = "".join(ch * 2 for ch in s)
    if len(s) != 6:
        raise argparse.ArgumentTypeError(f"--accent must be a 3- or 6-digit hex colour, got {s!r}")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def lerp(a, b, t):
    return a + (b - a) * t


def shade(rgb, factor):
    return tuple(max(0, min(255, int(c * factor))) for c in rgb)


# ---------------------------------------------------------------------------
# Geometry helpers. Everything is supersampled 3x3 so edges are antialiased —
# a jagged logo reads as "broken asset", which defeats the point of a default.
# ---------------------------------------------------------------------------

SS = 3


def inside_rrect(px, py, x0, y0, x1, y1, r):
    """True inside a rounded rectangle."""
    if px < x0 or px > x1 or py < y0 or py > y1:
        return False
    if x0 + r <= px <= x1 - r or y0 + r <= py <= y1 - r:
        return True
    cx = min(max(px, x0 + r), x1 - r)
    cy = min(max(py, y0 + r), y1 - r)
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r


def render(width, height, sample, ss=1, edge=None):
    """
    sample(x, y) -> (r, g, b, a), a in 0..1. Yields PNG rows.

    ss > 1 supersamples for antialiasing. `edge(i, j) -> bool` marks pixels that actually NEED it;
    everywhere else one sample is taken. That matters: a full 3x3 pass over 1920x1080 is ~6M
    evaluations in pure Python (~35 s), while a smooth gradient gains nothing from it. Antialiasing
    is only worth paying for along a hard boundary, which is O(perimeter), not O(area).
    """
    inv = 1.0 / ss
    for j in range(height):
        row = bytearray()
        for i in range(width):
            if ss == 1 or (edge is not None and not edge(i, j)):
                r, g, b, a = sample(i + 0.5, j + 0.5)
                if a <= 0.0:
                    row += b"\x00\x00\x00\x00"
                else:
                    row += bytes((max(0, min(255, int(r))), max(0, min(255, int(g))),
                                  max(0, min(255, int(b))), max(0, min(255, int(a * 255)))))
                continue
            ar = ag = ab = aa = 0.0
            for sy in range(ss):
                yy = j + (sy + 0.5) * inv
                for sx in range(ss):
                    r, g, b, a = sample(i + (sx + 0.5) * inv, yy)
                    ar += r * a; ag += g * a; ab += b * a; aa += a
            a = aa / (ss * ss)
            if aa <= 0.0:
                row += b"\x00\x00\x00\x00"
            else:
                row += bytes((
                    max(0, min(255, int(ar / aa))),
                    max(0, min(255, int(ag / aa))),
                    max(0, min(255, int(ab / aa))),
                    max(0, min(255, int(a * 255))),
                ))
        yield row


# ---------------------------------------------------------------------------
# Logo: square canvas, transparent padding, rounded-square mark with a wave.
# ---------------------------------------------------------------------------

def make_logo(size, accent, pad_frac, seed=0):
    pad = size * pad_frac
    x0, y0, x1, y1 = pad, pad, size - pad, size - pad
    # Geometry varies with the seed, within a deliberately narrow range so every output still reads
    # as the same visual language rather than a random doodle.
    radius = (x1 - x0) * (0.18 + (seed % 7) * 0.017)          # 0.18 .. 0.28
    n_bands = 2 + ((seed >> 3) % 2)                            # 2 or 3
    light = shade(accent, 1.28)
    dark = shade(accent, 0.72)

    bands = []
    for k in range(n_bands):
        h = (seed >> (5 + k * 7)) or (k + 1)
        bands.append((
            (h % 360) / 360.0 * 2.0 * math.pi,                 # phase
            0.035 + (h % 5) * 0.008,                           # amplitude
            0.44 + k * (0.34 / max(1, n_bands - 1)) if n_bands > 1 else 0.60,   # y offset
            0.92 - k * 0.22,                                   # alpha
            1.6 + ((h >> 3) % 4) * 0.35,                        # frequency
        ))

    def sample(x, y):
        if not inside_rrect(x, y, x0, y0, x1, y1, radius):
            return (0, 0, 0, 0.0)
        t = (y - y0) / (y1 - y0)
        base = tuple(int(lerp(light[k], dark[k], t)) for k in range(3))

        # Two wave bands, knocked out in white at low alpha. Purely geometric —
        # no font dependency, so this renders identically everywhere.
        span = x1 - x0
        wave = 0.0
        for phase, amp, yoff, alpha, freq in bands:
            cy = y0 + (y1 - y0) * yoff + math.sin((x - x0) / span * freq * math.pi + phase) * span * amp
            d = abs(y - cy)
            th = span * 0.052
            if d < th:
                wave = max(wave, alpha * (1.0 - (d / th) ** 2))
        if wave > 0:
            base = tuple(int(lerp(base[k], 255, wave)) for k in range(3))
        return (base[0], base[1], base[2], 1.0)

    # Only the rounded-rect boundary needs supersampling. Agreement at all four pixel corners
    # means the pixel is wholly in or wholly out, so one sample is exact there.
    def edge(i, j):
        c = (inside_rrect(i, j, x0, y0, x1, y1, radius),
             inside_rrect(i + 1, j, x0, y0, x1, y1, radius),
             inside_rrect(i, j + 1, x0, y0, x1, y1, radius),
             inside_rrect(i + 1, j + 1, x0, y0, x1, y1, radius))
        return not (c[0] == c[1] == c[2] == c[3])

    return render(size, size, sample, ss=SS, edge=edge)


# ---------------------------------------------------------------------------
# Background: full-bleed gradient, vignette, and a quiet centre.
# ---------------------------------------------------------------------------

def make_background(width, height, accent, seed=0):
    top = shade(accent, 0.42)
    bot = shade(accent, 0.16)
    cx, cy = width / 2.0, height / 2.0
    maxd = math.hypot(cx, cy)
    # Glows are nudged by the seed but stay in the CORNERS — never the middle, where the login card
    # and its white text sit. Varying that would be varying legibility.
    j = (seed >> 11) % 4
    glows = (
        (0.14 + (j % 2) * 0.08, 0.18 + (j // 2) * 0.10, 0.55, 0.16),
        (0.90 - (j % 2) * 0.08, 0.82 - (j // 2) * 0.10, 0.60, 0.12),
    )

    def sample(x, y):
        t = y / height
        r = lerp(top[0], bot[0], t); g = lerp(top[1], bot[1], t); b = lerp(top[2], bot[2], t)

        # Soft off-centre glow, kept away from the middle so overlaid text stays legible.
        for gx, gy, gr, gi in glows:
            d = math.hypot(x - width * gx, y - height * gy) / (maxd * gr)
            if d < 1.0:
                k = (1.0 - d) ** 2 * gi
                r = lerp(r, 255, k); g = lerp(g, 255, k); b = lerp(b, 255, k)

        # Very low-amplitude diagonal banding: texture without detail.
        band = math.sin((x * 0.6 + y * 1.1) / max(width, height) * 6.0 * math.pi) * 3.0
        r += band; g += band; b += band

        # Vignette darkens the edges, pushing attention to the centre.
        v = 1.0 - 0.30 * (math.hypot(x - cx, y - cy) / maxd) ** 2
        return (int(max(0, min(255, r * v))), int(max(0, min(255, g * v))), int(max(0, min(255, b * v))), 1.0)

    return render(width, height, sample, ss=1)


def parse_dim(s):
    try:
        w, h = s.lower().split("x")
        return int(w), int(h)
    except Exception:
        raise argparse.ArgumentTypeError(f"--bg must look like 1920x1080, got {s!r}")


def main():
    ap = argparse.ArgumentParser(description="Generate default enclave branding assets.")
    ap.add_argument("--out", default="branding", help="output directory (default: ./branding)")
    ap.add_argument("--accent", type=hex_rgb, default="1f6feb", help="hex accent colour (default 1f6feb)")
    ap.add_argument("--logo-size", type=int, default=512, help="logo edge in px, square (default 512)")
    ap.add_argument("--logo-padding", type=float, default=0.12,
                    help="transparent safe-area padding as a fraction per side (default 0.12)")
    ap.add_argument("--bg", type=parse_dim, default="1920x1080", help="background WxH (default 1920x1080)")
    ap.add_argument("--name", default="",
                    help="app name; deterministically varies the mark GEOMETRY so different apps get "
                         "different-but-stable marks. Does NOT infer anything from the app's purpose.")
    args = ap.parse_args()

    if not 0.0 <= args.logo_padding < 0.45:
        raise SystemExit("--logo-padding must be in [0, 0.45)")

    os.makedirs(args.out, exist_ok=True)
    logo = os.path.join(args.out, "logo.png")
    bg = os.path.join(args.out, "background.png")

    seed = seed_from(args.name)
    write_png(logo, args.logo_size, args.logo_size,
              make_logo(args.logo_size, args.accent, args.logo_padding, seed))
    w, h = args.bg
    write_png(bg, w, h, make_background(w, h, args.accent, seed))

    for path, label in ((logo, "LOGO"), (bg, "BACKGROUND_IMAGE")):
        kb = os.path.getsize(path) / 1024.0
        print(f"  {label:16} {path}  ({kb:.0f} KB)")

    print("\nUpload each with fileType = LOGO / BACKGROUND_IMAGE, then SAVE to re-sign.")
    print("Validate first:  python3 check-branding.py " + args.out)


if __name__ == "__main__":
    main()
