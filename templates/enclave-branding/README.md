# Enclave Branding — default logo + background

The Tide login enclave displays your realm's **logo** and **background image**. This template gets you
a correct default in one command, and validates any asset before you spend an upload on it.

## One command brands the realm

```bash
./brand-tidecloak.sh --realm myapp --accent 1f6feb --name "My App"
```

generate → validate → upload both → **save + re-sign** → verify. No image model, no Pillow, no
network for the assets; needs `jq`, `python3`, and `KC_BOOTSTRAP_ADMIN_PASSWORD` in the environment or
`./.env` (AP-41 — never inline it). Bring your own artwork instead with
`--logo path/to/logo.png --background path/to/bg.jpg`.

**VERIFIED end to end on a live Tide realm**: uploads returned SHA-256 hashes, `set-branding`
answered *"Tide branding updated and settings re-signed successfully"*, `get-branding` came back with
versioned URLs, and the public `images/{LOGO,BACKGROUND_IMAGE}` endpoints served back
**byte-identical** PNGs (hash in the URL == hash of the served bytes).

It is safe to re-run: each upload replaces the previous file of that `fileType`, generation is
deterministic for a given `--name`/`--accent`, and every save re-signs. Branding is **IGA-exempt**, so
it works even after the one-way multiAdmin flip and needs no change-request drain.

**It fails fast on a realm it cannot brand.** The pre-flight checks for the `tide-vendor-key`
component — precisely what `set-branding` requires — and refuses before uploading anything. Do *not*
substitute a check for the Tide IdP: measured, an unlicensed realm returns **200** for
`identity-provider/instances/tide` while having **no** vendor key, so that check passes and the save
then fails after two wasted uploads that stay on disk as orphans.

### Or the pieces separately

```bash
python3 make-branding.py --accent 1f6feb        # -> branding/logo.png, branding/background.png
python3 check-branding.py branding/             # validate BEFORE uploading
```

## What it generates — and what it does not

It draws **one abstract mark**: a rounded square with wave bands, plus a gradient background.

| Input | Effect |
|---|---|
| `--accent <hex>` | colour of both assets |
| `--name "<app>"` | deterministically varies the mark's **geometry** (band count, phase, amplitude, corner radius, glow placement) so two realms do not look alike. **Same name always gives the same mark** — the serve URL is versioned by content hash, so a mark that churned between runs would invalidate a deployed URL for nothing |
| `--logo-size`, `--logo-padding`, `--bg` | dimensions and safe area |

⚠️ **It does not generate artwork "for your kind of app".** It has no idea what your app does and does
not guess — there is no bank glyph, no music note, no health cross. That is deliberate: a geometric
generator reaching for *meaning* produces a mark that looks like a failed attempt at meaning, which is
worse than an obviously neutral placeholder.

**What it is for**: a default that looks intentional and is correctly sized and padded, so nothing
about the login screen looks broken while real brand assets are being made. For artwork that reflects
what the app *is*, you need an image model or a designer — [IMAGE-PROMPT.md](IMAGE-PROMPT.md), and
describe the app in the prompt.

## Why a generator rather than a prompt

**Most coding agents cannot produce image files.** Asked for "a 512×512 logo" they return nothing, a
broken file, or an SVG — and **SVG is rejected by the server**. A script sidesteps the whole problem:
any agent that can run Python can produce a valid, padded, correctly-sized asset.

If you *can* generate images, use [IMAGE-PROMPT.md](IMAGE-PROMPT.md) — same dimensions, same
constraints — then validate the output. What matters is the constraints, not how the pixels were made.

## The upload contract — VERIFIED

Read from `tide-IdP-keycloak/.../TideIdpAdminRealmResource.java` and
`tidecloak-key-provider/.../VendorResource.java`, 2026-08-11.

| | |
|---|---|
| Upload | `POST /admin/realms/{realm}/tide-idp-admin-resources/images/upload` |
| Multipart parts | `fileData`, `fileName`, `fileType` |
| `fileType` | **`LOGO`** or **`BACKGROUND_IMAGE`** |
| Formats | `png`, `jpg`, `jpeg`, `gif`, `webp` — **allowlist by file EXTENSION**; **SVG rejected** |
| Max size | **5 MB** (`413` beyond it) |
| Dimension checks | **none, server-side** — sizing is a rendering concern, not a gate |
| Returns | `{"hash":"<sha256 hex>","name":"<stored name>"}` |
| Storage | one file per `fileType`; a new upload **deletes and replaces** the previous one |
| Auth | `manage-realm` |

Uploading is only half of it. Point the realm at the image and **re-sign**:

| | |
|---|---|
| Save | `POST /admin/realms/{realm}/vendorResources/set-branding` |
| Body | `{"backgroundUrl":"...","logoUrl":"..."}` — an **absent** field is left unchanged; a present one (even `""`) overwrites |
| Writes | IdP config `ImageURL` (background) and `LogoURL` (logo) |
| Also | **re-signs the IdP settings blob from the updated config**, in the same request |

**`set-branding` is save AND sign atomically.** The enclave verifies the signed settings blob, so an
uploaded image that was never saved is not shown, and a failed ORK signing returns `500` rather than
silently leaving stale/unsigned branding. Do not try to write `ImageURL`/`LogoURL` through the generic
IdP-update endpoint and skip the signature.

> **Branding is IGA-EXEMPT.** The config write is flagged `IGA_VENDOR_PROVISIONING`, exactly like
> `sign-idp-settings`, so it is **not** captured as a change request. It is one of the few admin writes
> that needs no authorize/commit drain — even on a multiAdmin realm. That is a genuine convenience:
> you can fix branding after the one-way flip without an enclave ceremony.

### Serving URL

Build a versioned URL from the returned hash so a replaced image is not served from cache:

```
{auth-server-url}/realms/{realm}/tide-idp-resources/images/{LOGO|BACKGROUND_IMAGE}?v=<hash>
```

That path is **public** — no auth — which is why the branding assets must contain nothing sensitive.

## End to end

```bash
python3 make-branding.py --accent 1f6feb --name "Acme"
python3 check-branding.py branding/            # stop here if anything says HARD FAIL

URL=http://localhost:8080; REALM=myapp
IDP="$URL/admin/realms/$REALM/tide-idp-admin-resources"

# Mint per call — master-admin tokens live ~60 SECONDS.
tok() { curl -s -X POST "$URL/realms/master/protocol/openid-connect/token" \
  -d client_id=admin-cli -d grant_type=password \
  --data-urlencode "username=$KC_BOOTSTRAP_ADMIN_USERNAME" \
  --data-urlencode "password=$KC_BOOTSTRAP_ADMIN_PASSWORD" | jq -r .access_token; }

for pair in "LOGO:branding/logo.png" "BACKGROUND_IMAGE:branding/background.png"; do
  TYPE=${pair%%:*}; FILE=${pair#*:}
  OUT=$(curl -s -X POST "$IDP/images/upload" -H "Authorization: Bearer $(tok)" \
        -F "fileData=@$FILE" -F "fileName=$(basename "$FILE")" -F "fileType=$TYPE")
  HASH=$(echo "$OUT" | jq -r .hash)
  [ "$HASH" = null ] && { echo "upload failed: $OUT" >&2; exit 1; }
  echo "$TYPE -> $URL/realms/$REALM/tide-idp-resources/images/$TYPE?v=$HASH"
  eval "${TYPE}_URL=$URL/realms/$REALM/tide-idp-resources/images/$TYPE?v=$HASH"
done

# Save AND sign in one call.
curl -s -X POST "$URL/admin/realms/$REALM/vendorResources/set-branding" \
  -H "Authorization: Bearer $(tok)" -H 'Content-Type: application/json' \
  -d "$(jq -n --arg l "$LOGO_URL" --arg b "$BACKGROUND_IMAGE_URL" \
        '{logoUrl:$l, backgroundUrl:$b}')"
# -> "Tide branding updated and settings re-signed successfully."
```

The admin console's **Settings → Branding** tab does the same three steps with a live preview.

## Recommended geometry — ASSUMED, not enforced

Nothing server-side validates dimensions, and the enclave's exact layout is not in readable sources.
These are recommendations with reasons, so you can judge them rather than trust them:

| Asset | Recommendation | Why |
|---|---|---|
| **Logo** | **512×512 PNG**, alpha, **~12% transparent padding per side** | Scaled to fit a box (`object-contain`). Square renders predictably at any box shape; the padding is a safe area so the mark is never visually clipped |
| **Background** | **1920×1080 (16:9)**, PNG or JPEG | Full-bleed, so it crops on one axis at other ratios. 16:9 minimises surprise |
| Background centre | keep it **quiet and low-contrast** | The login card and white text sit on top of the middle. A busy centre is the failure that actually ships |
| Logo detail | readable at **32×32** | It is displayed small; thin strokes and text disappear |

`check-branding.py` reports these as **warnings**, and hard constraints as **HARD FAIL**, so the two
are never confused. Exit code reflects hard failures only.

## Verified behaviour of these scripts

- `make-branding.py` at defaults writes a **512×512 RGBA** logo (~45 KB) and a **1920×1080** background
  (~179 KB) in about **6 seconds** — both far under the 5 MB cap
- output parsed back with a from-scratch PNG reader: valid signature, **all chunk CRCs correct**,
  8-bit RGBA, correct row count
- the logo's outer ring is **fully transparent** (padding is real, alpha 0), and rounded corners carry
  **intermediate alpha** (genuinely antialiased, not stair-stepped)
- `check-branding.py` HARD-FAILs an SVG and a 6 MB file, and warns on: zero padding (detected via
  border alpha), a 128 px logo, a square background, and a JPEG logo
- adaptive antialiasing: supersampling only along the rounded-rect boundary cut generation from
  **37 s to 5.7 s** with byte-identical output size. A smooth gradient gains nothing from
  supersampling, and antialiasing is only worth paying for on a hard edge — O(perimeter), not O(area)

## Related

- `canon/tidecloak-endpoints.md` → Branding Endpoints
- `canon/tidecloak-bootstrap.md` → `sign-idp-settings` (the same signing ceremony)
- AP-41 — the admin credential these calls need belongs in `.env`, never in a script
