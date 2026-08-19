# Branding flow — what the agent actually says and does

The login enclave is the first screen a user sees, and by default it is Tide's logo, not theirs.
**Offer to fix that. Do not silently skip it, and do not silently do it either.**

This file is the script. It exists because the failure mode is not technical — it is that nobody
asks, so every app ships with Tide branding.

---

## Step 1 — Ask. Once, plainly.

After the realm is licensed and working, ask:

> **Want to brand the login screen?** Right now users see Tide's logo when they sign in.
>
> Three ways to do it — pick one:
>
> 1. **You already have artwork.** Drop it in `./branding/` as `logo.png` and `background.jpg`,
>    tell me when it's there, and I'll check and upload it.
> 2. **You want to make something with an image AI.** I'll write you a prompt tailored to this app —
>    you paste it into ChatGPT / Midjourney / whatever you use, save what comes back to
>    `./branding/`, and I'll upload it.
> 3. **You just want something reasonable now.** I'll generate a clean logo and background from
>    the app's colour and type. Takes about a minute, no image model needed.
>
> Or say skip and I'll leave the Tide default.

**Do not ask this more than once per session.** If they skip, note it and move on.

⚠️ **Only offer this on a LICENSED realm.** `set-branding` needs the `tide-vendor-key` component;
without it the uploads succeed and the save fails, leaving two orphaned files. `brand-tidecloak.sh`
pre-flights this for you — but it is a better experience to not offer at all than to offer and fail.

---

## Step 2a — They have artwork

Create the directory and tell them exactly where to put things:

```bash
mkdir -p branding
# they drop: branding/logo.png       (square)
#            branding/background.jpg (16:9)
```

When they say it's there:

```bash
python3 templates/enclave-branding/check-branding.py branding/
```

**Read the warnings out to them and offer to fix them.** The common ones and what to say:

| Warning | What to tell them |
|---|---|
| artwork reaches >1.0x the crop radius, outline not round | "The login screen crops logos to a circle — the corners of yours would be cut off. Want me to scale it down to fit?" |
| aspect not square | "Non-square logos get cropped on the long axis before the circle is applied. Can you re-export it square, or shall I pad it?" |
| no alpha channel | "It'll show as a block on the white circle. A transparent PNG looks better — but it's fine if you want it as is." |
| SVG | **Hard stop.** "The server rejects SVG. Export it as PNG at 1024×1024 and I'll upload it." |
| over 5 MB | **Hard stop.** "5 MB is the cap. Save the background as JPEG instead of PNG and it'll drop under." |

Then upload (Step 3).

---

## Step 2b — They want an AI prompt

**You know what the app is. Write the prompt for them — do not hand them a blank template.**

Read `IMAGE-PROMPT.md` for the constraints, then fill in the app specifics yourself. A good prompt
names the actual product and its actual subject matter. Compare:

- ✗ *"A minimalist app icon for [APP NAME], a [what it does]."* — that is the template, not a prompt.
- ✓ *"A minimalist app icon for Sashlings, a private family photo-sharing app..."*

Write both prompts to a file so they can copy them without scrolling back through chat:

```bash
mkdir -p branding
# write branding/PROMPT.md with the two filled-in prompts
```

Then say:

> I've written two prompts to `branding/PROMPT.md` — one for the logo, one for the background.
> Paste them into your image tool, then save the results as `branding/logo.png` and
> `branding/background.jpg` and tell me. I'll check them and upload.

**The four constraints that must survive into whatever prompt you write** — these are the ones an
image model gets wrong by default, and they are measured (see `evidence/`):

1. **Square canvas, 1024×1024** — a non-square logo is cropped on its long axis.
2. **Circular-safe** — it is masked to a circle, so nothing important in the corners. Either fill
   the circle deliberately, or leave ≥15% margin on all sides.
3. **Readable on white** — there is a white plate behind the logo, not your background image. No
   white or pale marks.
4. **No text** — it renders at 85–153 px. Lettering is unreadable and the circle cuts the ends off.

For the background: 16:9, ≥1920×1080, **quiet through the centre** because the login card sits there.

---

## Step 2c — Generate it

Pick the `--kind` that matches the app. This is the part that makes the art fit the product rather
than being a generic blob:

| `--kind` | For | Mark |
|---|---|---|
| `vault` | password managers, secrets, security tools | shield |
| `identity` | auth, SSO, access management | keyhole |
| `notes` | docs, notes, wikis, CMS | stacked lines |
| `chat` | messaging, social, support | speech bubble |
| `data` | analytics, dashboards, reporting | bar chart |
| `finance` | payments, invoicing, banking | bar chart, green |
| `health` | clinical, fitness, patient records | pulse trace |
| `media` | video, audio, streaming | play triangle |
| `commerce` | shops, orders, inventory | shopping bag |
| `generic` | anything else | wave bands |

```bash
python3 templates/enclave-branding/make-branding.py \
  --kind vault --name "Acme Vault" --out branding
```

`--name` varies the mark deterministically, so two vault apps do not look identical and the same app
always regenerates the same mark. `--accent RRGGBB` overrides the colour if they have a brand one.

The logo is a **filled disc**, which is deliberate: it matches the circular crop exactly, so it uses
the whole area instead of floating a small square inside a circle.

---

## Step 3 — Upload and sign

One command does check → upload both → save → re-sign → verify:

```bash
bash templates/enclave-branding/brand-tidecloak.sh --realm "$REALM"
```

It is safe to re-run: each upload replaces the previous file of that `fileType`, and `set-branding`
re-signs from the updated config.

**A save is a "save AND sign".** `set-branding` updates the Tide IdP config *and* re-signs the gVVK
settings blob that the enclave verifies, in one round trip. If the ORK sign fails, the whole thing
fails — you never end up with branding the enclave will refuse.

Then tell them to hard-refresh the login page. The serve URL is versioned, but browsers cache.

---

## Anti-patterns

- **Generating branding without asking.** They may have a brand book. Ask first.
- **Asking and then not following through** because the realm is not licensed. Pre-flight it.
- **Handing over the unfilled template prompt.** You know what the app does; write the prompt.
- **Uploading without running `check-branding.py`.** Nothing server-side validates dimensions, so a
  logo whose corners get cut uploads perfectly happily and just looks broken.
- **Telling them a logo "will be clipped" when it is a disc.** A round mark that fills the canvas is
  correct — the checker's uniformity test distinguishes the two; trust it over the raw ratio.
- **Promising a preview.** There is no preview API. The check is arithmetic plus their eyes on the
  real login page.
