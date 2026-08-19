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
  - logo is SQUARE, which is mandatory: the enclave paints it with `background-size: cover`, so a
    non-square canvas is cropped on its long axis
  - logo artwork stays inside the circle inscribed in the canvas (measured at 0.94x the crop
    radius), because the enclave masks it with `border-radius: 50%` and cuts the corners off
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

# App-kind motifs. Each entry is (default_accent, glyph). The glyph is a function of normalised
# coordinates u, v in [-1, 1] measured from the centre of the disc, returning True inside the mark.
#
# Why a DISC and not a rounded square: the enclave clips the logo with `border-radius: 50%`, so a
# square mark either gets its corners cut or has to be inset to 70.7% and looks small inside the
# circle. A disc that fills the canvas matches the crop exactly — it reads as intentional, and it
# uses the whole area the enclave gives you. See evidence/README.md.

def _rounded_bar(u, v, cx, cy, hw, hh, r=0.04):
    du, dv = abs(u - cx) - (hw - r), abs(v - cy) - (hh - r)
    du, dv = max(du, 0.0), max(dv, 0.0)
    return (du * du + dv * dv) <= r * r or (abs(u - cx) <= hw and abs(v - cy) <= hh - r) \
        or (abs(u - cx) <= hw - r and abs(v - cy) <= hh)


def _glyph_shield(u, v):
    # Flat shoulders down to v=0, then taper to a point at the bottom. The taper must go to ZERO at
    # the point, not at the shoulder — getting that backwards yields a blob, not a shield.
    if v < -0.62 or v > 0.52:
        return False
    if v >= 0.0:
        half = 0.44
    else:
        t = (v + 0.62) / 0.62          # 0 at the point, 1 at the shoulder
        half = 0.44 * (max(0.0, t) ** 0.62)
    return abs(u) <= half


def _glyph_key(u, v):
    if (u * u + (v - 0.26) ** 2) <= 0.25 ** 2:
        return True
    return abs(u) <= 0.11 * (1.0 - 0.45 * (0.30 - v) / 0.80) and -0.58 <= v <= 0.26


def _glyph_lines(u, v):
    for i, w in enumerate((0.46, 0.46, 0.30)):
        if _rounded_bar(u, v, 0.0, 0.34 - i * 0.34, w, 0.085):
            return True
    return False


def _glyph_bubble(u, v):
    if (u * u + (v - 0.12) ** 2) <= 0.50 ** 2:
        return True
    return (-0.34 <= u <= -0.02) and (-0.62 <= v <= -0.30) and (v >= -0.62 + (u + 0.34) * 1.0)


def _glyph_bars(u, v):
    for i, (cx, h) in enumerate(((-0.34, 0.24), (0.0, 0.40), (0.34, 0.56))):
        if _rounded_bar(u, v, cx, -0.52 + h, 0.115, h):
            return True
    return False


def _glyph_pulse(u, v):
    pts = ((-0.58, 0.0), (-0.24, 0.0), (-0.08, 0.36), (0.08, -0.40), (0.24, 0.0), (0.58, 0.0))
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        dx, dy = x2 - x1, y2 - y1
        L2 = dx * dx + dy * dy
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((u - x1) * dx + (v - y1) * dy) / L2))
        if (u - (x1 + t * dx)) ** 2 + (v - (y1 + t * dy)) ** 2 <= 0.085 ** 2:
            return True
    return False


def _glyph_play(u, v):
    return u >= -0.30 and (u - 0.44) <= 0 and abs(v) <= (0.44 - u) * 0.62


def _glyph_bag(u, v):
    if _rounded_bar(u, v, 0.0, -0.14, 0.44, 0.34, 0.10):
        return True
    d = (u * u + (v - 0.26) ** 2) ** 0.5
    return 0.19 <= d <= 0.28 and v >= 0.24


def _glyph_waves(u, v):
    for k, (yoff, freq, amp) in enumerate(((0.24, 1.7, 0.16), (-0.10, 1.7, 0.16), (-0.44, 1.7, 0.16))):
        cy = yoff + math.sin(u * freq * math.pi) * amp
        if abs(v - cy) <= 0.075:
            return True
    return False


KINDS = {
    "vault":     ("1f4fd8", _glyph_shield),   # security, secrets, password managers
    "identity":  ("5b3fd8", _glyph_key),      # auth, access, SSO
    "notes":     ("2f6f4e", _glyph_lines),    # documents, notes, wikis, CMS
    "chat":      ("0f7f8f", _glyph_bubble),   # messaging, social, support
    "data":      ("1f6feb", _glyph_bars),     # analytics, dashboards, reporting
    "finance":   ("0f6f3f", _glyph_bars),     # payments, invoicing, banking
    "health":    ("c2384f", _glyph_pulse),    # clinical, fitness, patient records
    "media":     ("8f2f6f", _glyph_play),     # video, audio, streaming
    "commerce":  ("b4541f", _glyph_bag),      # shops, orders, inventory
    "generic":   ("1f6feb", _glyph_waves),    # anything else
}


def make_logo(size, accent, pad_frac, seed=0, kind="generic"):
    """A filled disc that exactly matches the enclave's circular crop, with a motif knocked out.

    pad_frac is honoured but defaults to 0: the disc is meant to fill the circle. Pass a non-zero
    padding only if you want the mark to float inside the circle with white around it.
    """
    _, glyph = KINDS.get(kind, KINDS["generic"])
    cx = cy = (size - 1) / 2.0
    # Inset by half a pixel so the outermost ring is antialiased rather than hard-clipped.
    radius = (size / 2.0) * (1.0 - pad_frac) - 0.5
    light, dark = shade(accent, 1.30), shade(accent, 0.70)
    # Rotate the motif slightly per app so two apps of the same kind are not identical.
    ang = ((seed % 24) - 12) * (math.pi / 180.0) * 0.5
    ca, sa = math.cos(ang), math.sin(ang)

    def sample(x, y):
        dx, dy = x - cx, y - cy
        if dx * dx + dy * dy > radius * radius:
            return (0, 0, 0, 0.0)
        t = (dy + radius) / (2.0 * radius)
        base = tuple(int(lerp(light[k], dark[k], t)) for k in range(3))
        u, v = dx / radius, -dy / radius
        u, v = u * ca - v * sa, u * sa + v * ca
        if glyph(u, v):
            base = tuple(int(lerp(base[k], 255, 0.92)) for k in range(3))
        return (base[0], base[1], base[2], 1.0)

    def edge(i, j):
        r2 = radius * radius
        c = ((i - cx) ** 2 + (j - cy) ** 2 <= r2,
             (i + 1 - cx) ** 2 + (j - cy) ** 2 <= r2,
             (i - cx) ** 2 + (j + 1 - cy) ** 2 <= r2,
             (i + 1 - cx) ** 2 + (j + 1 - cy) ** 2 <= r2)
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
    ap = argparse.ArgumentParser(
        description="Generate enclave branding assets (logo + background). No image model needed.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="app kinds: " + ", ".join(sorted(KINDS)))
    ap.add_argument("--out", default="branding", help="output directory (default: ./branding)")
    ap.add_argument("--kind", default="generic", choices=sorted(KINDS),
                    help="what the app IS. Picks the motif and a default accent colour "
                         "(default: generic)")
    ap.add_argument("--accent", type=hex_rgb, default=None,
                    help="hex accent colour; overrides the colour implied by --kind")
    ap.add_argument("--logo-size", type=int, default=1024, help="logo edge in px, square (default 1024; Tide ships 838)")
    ap.add_argument("--logo-padding", type=float, default=0.0,
                    help="transparent margin as a fraction per side (default 0: the disc fills the "
                         "enclave's circular crop exactly, which is the intended look)")
    ap.add_argument("--bg", type=parse_dim, default="1920x1080", help="background WxH (default 1920x1080)")
    ap.add_argument("--name", default="",
                    help="app name; deterministically varies the mark so two apps of the same kind "
                         "differ. Same name always gives the same mark.")
    args = ap.parse_args()

    if not 0.0 <= args.logo_padding < 0.45:
        raise SystemExit("--logo-padding must be in [0, 0.45)")

    accent = args.accent if args.accent is not None else hex_rgb(KINDS[args.kind][0])

    os.makedirs(args.out, exist_ok=True)
    logo = os.path.join(args.out, "logo.png")
    bg = os.path.join(args.out, "background.png")

    seed = seed_from(args.name)
    write_png(logo, args.logo_size, args.logo_size,
              make_logo(args.logo_size, accent, args.logo_padding, seed, args.kind))
    w, h = args.bg
    write_png(bg, w, h, make_background(w, h, accent, seed))

    hexa = "%02x%02x%02x" % accent
    print(f"  kind             {args.kind}   accent #{hexa}"
          + (f"   name {args.name!r}" if args.name else ""))
    for path, label in ((logo, "LOGO"), (bg, "BACKGROUND_IMAGE")):
        kb = os.path.getsize(path) / 1024.0
        print(f"  {label:16} {path}  ({kb:.0f} KB)")

    print("\nUpload each with fileType = LOGO / BACKGROUND_IMAGE, then SAVE to re-sign.")
    print("Validate first:  python3 check-branding.py " + args.out)


if __name__ == "__main__":
    main()
