# Image-model prompts for enclave branding

Use these when you **can** generate images. If you cannot, run `make-branding.py` instead — it needs
no image model and produces assets that pass every constraint.

Either way, **run `check-branding.py` on the result.** A model will happily hand you a 3000×3000 SVG
at 8 MB, and all three of those facts break the upload.

---

## Hard constraints — the upload is rejected otherwise

| Constraint | Value |
|---|---|
| Format | **PNG, JPG/JPEG, GIF, WebP.** **SVG is rejected** — the server allowlists by file extension |
| Size | **≤ 5 MB** per file |
| Transparency | PNG or WebP only. JPEG and (practically) GIF cannot give you a clean alpha channel |

The server does **no dimension validation**, so everything below is a rendering recommendation, not a
gate. It still matters: the enclave scales what you give it.

---

## 1. Logo — `fileType=LOGO`

**Canvas: 512×512 PNG, transparent background, ~12% empty padding on every side.**

Square because the enclave scales the logo to fit a box (`object-contain`): a square canvas renders
predictably at any box shape, and the padding is a safe area so the mark is never visually clipped
against the box edge.

> **Prompt:**
>
> A minimal, flat vector-style app logo mark on a **fully transparent background**.
> **Square 512×512** canvas. The mark occupies only the **centre ~76%** — leave roughly **12% empty
> transparent margin on all four sides**. No text, no wordmark, no lettering. No drop shadow, no
> outer glow, no background shape filling the canvas. Simple geometric forms, 2–3 colours maximum,
> high contrast so it reads clearly at **32×32**. Crisp edges, centred, symmetrical balance.
> Output **PNG with alpha**.

**Then check:** square, ≥256 px, has an alpha channel, and a fully transparent border ring.
`check-branding.py` verifies all four.

**Common failures:**
- an opaque white/coloured card behind the mark — shows as a rectangle against the enclave background
- artwork bleeding to the canvas edge — no safe area, so it looks cropped
- fine detail or thin strokes — invisible at small sizes
- text in the logo — unreadable when scaled down, and usually redundant

## 2. Background — `fileType=BACKGROUND_IMAGE`

**Canvas: 1920×1080 (16:9), PNG or JPEG.**

Full-bleed behind the login/approval UI, so it is cropped on one axis at other viewport ratios.

> **Prompt:**
>
> An abstract, **very low-contrast** background image for a login screen. **1920×1080, 16:9.**
> Dark, muted, desaturated palette. Soft large-scale gradients and gentle organic shapes only —
> **no sharp detail, no text, no logos, no faces, no busy texture**. The **centre third must be
> visually quiet and near-uniform** so white UI text and a card overlay on top of it stay legible;
> put any visual interest in the corners and outer edges. No hard horizon lines or high-contrast
> diagonals through the middle. Subtle film-grain at most. Photorealistic or abstract, not
> illustrative.

**Then check:** ≥1280×720 and close to 16:9. Prefer JPEG if PNG exceeds ~2 MB — the background has no
transparency to preserve.

**Common failures:**
- a busy or high-contrast centre — the login card becomes unreadable, and this is the one that
  actually gets shipped
- text or a logo baked into the background — it will be cropped, duplicated, or fight the real logo
- a portrait or square image — cropped hard on a wide viewport
- 4K PNG at 9 MB — over the cap

---

## Making it reflect the app

This is where a model earns its keep and the generator cannot follow: **describe the app** and let the
model choose the imagery. Insert a clause after the first sentence of the logo prompt, e.g.

> *"...app logo mark for **a music-licensing and provenance registry** — suggest sound or waveform
> motifs abstractly, without literal instruments."*

Keep every hard constraint intact (square, transparent, padded, no text) — those are what make the
asset usable, and a model will happily drop all four while chasing the theme. Say the domain, name a
motif direction, and forbid literal objects and lettering; anything more specific tends to produce a
cluttered illustration that dies at 32×32.

## Palette

Pass your brand colour to the generator (`--accent 2f6f4e`) or name it in the prompt. Keep the logo
readable against the background: the enclave composites one over the other, and a dark logo on a dark
background is the failure nobody notices until it ships.
