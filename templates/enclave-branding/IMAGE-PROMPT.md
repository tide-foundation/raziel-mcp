# Image-model prompts for enclave branding

Use these when you **can** generate images. If you cannot, run `make-branding.py` instead — it needs
no image model and produces assets that pass every constraint.

Either way, **run `check-branding.py` on the result.** A model will happily hand you a 3000×3000 SVG
at 8 MB, and all three of those facts break the upload — and it will just as happily fill the canvas
edge to edge, which the enclave's circular crop then cuts the corners off.

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

**Canvas: 1024×1024 PNG, transparent, with every part of the mark inside the centred circle.**

Three measured facts drive this, all from the enclave's own stylesheet:

- `border-radius: 50%` — **the logo is cropped to a circle.** Corners are cut off.
- `background-size: cover` — it **fills and crops**, it does not fit-inside. A non-square canvas
  loses the ends of its long axis before the circle is even applied.
- `background-color: var(--white)` — your logo sits on a **white circle**, not on your background
  image. A white or very pale mark disappears.

For a square-ish mark that means **≥15% empty margin on every side** (exactly: a square inscribed in
a circle has side = diameter ÷ √2, so 14.65%). A round emblem can go nearly edge to edge.

### Copy-paste prompt

> A minimalist app icon for **[APP NAME]**, a **[what it does]**.
>
> **Square 1024×1024 canvas, transparent background (PNG with alpha).**
>
> **The design must be circular-safe:** it will be cropped to a circle, so keep every element well
> inside a centred circle and leave at least **15% empty margin on all four sides**. Nothing in the
> corners.
>
> It will be displayed on a **white circular background at about 150px**, so use **mid-to-dark
> colours with strong contrast against white** — no white, pale grey, or light pastel as the main
> colour.
>
> A single bold symbol — **no text, no lettering, no wordmark**. Simple geometry, flat vector style,
> thick strokes, high contrast, centred and symmetrical. It must stay readable when shrunk to 32×32.
>
> Style: [pick one — geometric / rounded-soft / sharp-technical / organic].
> Palette: [1–2 brand colours], on transparency.

**Why "no text":** the box renders at 85–153 CSS px. Lettering is unreadable at that size, and the
circular crop cuts the ends off a wordmark. Tide's own default logo *is* a wordmark, and it only
survives because it is deliberately scaled to 94% of the crop radius — that is a designed exception,
not the easy path.

**Then check:** `python3 check-branding.py logo.png --as LOGO`. It reports the exact ratio of your
artwork to the crop radius and tells you what to scale to.

---

## 2. Background — `fileType=BACKGROUND_IMAGE`

**Canvas: 1920×1080 minimum (16:9), JPEG preferred. Tide's own is 3840×2160.**

Full-viewport with `background-size: cover` and `background-position: center`, so it crops on
whichever axis is proportionally longer. The login card sits over the middle.

### Copy-paste prompt

> An abstract background image for a login screen for **[APP NAME]**, a **[what it does]**.
>
> **1920×1080, 16:9 landscape** (3840×2160 if available).
>
> **Very low contrast and visually quiet, especially through the centre** — a login card with text
> sits on top of the middle third, so that area must stay calm and near-uniform. Detail and interest
> belong in the outer edges and corners.
>
> Soft gradients, subtle geometric or organic texture, gentle depth. **No text, no logos, no faces,
> no sharp focal point in the centre.** It should read as a surface, not as a picture.
>
> Mood: [calm / technical / warm / premium]. Palette: [1–2 brand colours], muted.
>
> Also note it will be **cropped on one axis** at other screen ratios, so keep the composition
> forgiving toward the edges.

**Then check:** ≥1920×1080 and close to 16:9.

## Palette

Pass your brand colour to the generator (`--accent 2f6f4e`) or name it in the prompt. Keep the logo
readable against the background: the enclave composites one over the other, and a dark logo on a dark
background is the failure nobody notices until it ships.
