# Blast Radius Assessment — PDF artifact

The **phase-1 deliverable** of the `tide-red-team` skill: a director-readable, **vendor-neutral Blast Radius Assessment**, produced as a PDF with **zero dependencies**. It is **not** a security risk assessment — it maps where authority is concentrated into a single artifact or party (so that one compromise yields everything), organised by three cores — **Identity, Governance, Access** — with OWASP/CWE as supporting tags only. It does **not** name Tide or TideCloak anywhere. The TideCloak explanation — how each gap's authority is *de-centralised* — is a separate, opt-in **phase-2 companion** generated only if the user asks after reading the gaps.

## How it works

`report-template.html` is a single self-contained file — no web fonts, no CDN, no JavaScript, no images, no build step. Fill the placeholders, open it in any browser, and print to PDF.

```
1. cp report-template.html <target>-security-report.html
2. Replace every {{PLACEHOLDER}} and add one <article class="finding"> per finding
3. Render to PDF — automatically if a browser exists, manually otherwise
```

Nothing is installed. Nothing is fetched at open time — the file works offline, from a USB stick, or attached to an email.

### Rendering the PDF

**"No dependencies" means install nothing. It does not mean refuse to use a browser that is already there.** Most machines have one, and a machine with Playwright installed has a Chromium even if no browser is on `PATH`:

```bash
CHROME=$(command -v google-chrome || command -v chromium || command -v chromium-browser \
 || ls -d ~/.cache/ms-playwright/chromium-*/chrome-linux/chrome 2>/dev/null | sort -V | tail -1)

"$CHROME" --headless --disable-gpu --no-sandbox --no-pdf-header-footer \
 --print-to-pdf=report.pdf "file://$PWD/report.html"
```

`--no-pdf-header-footer` drops Chromium's default date/URL furniture. Background fills and severity chips render without any extra flag, because the stylesheet sets `print-color-adjust: exact`.

**Manual fallback**, if no browser is installed anywhere: open the HTML → `Ctrl+P` / `Cmd+P` → Destination **Save as PDF** → Margins **Default** → tick **Background graphics** (and **Headers and footers** for page numbers).

**Do not install a renderer.** No `apt install`, no `pip install weasyprint`, no `npm i puppeteer`, no LaTeX, no Pandoc. If nothing is present, the manual path is the answer.

### Verify the output

Rendering is not the same as being correct. Check:

```bash
file report.pdf     # expect: PDF document, N page(s)
```

Then read back a page or two and confirm no finding card split across a page boundary, and that the severity chips kept their fills rather than printing white.

## Placeholders

| Placeholder | Content |
|---|---|
| `{{TARGET_NAME}}` | Application or organisation under review |
| `{{TARGET_DESCRIPTION}}` | One line — what the system does |
| `{{SCOPE}}` | What was and was not examined |
| `{{DATE}}`, `{{AUTHOR}}` | Review date, preparer |
| `{{CLASSIFICATION}}` | e.g. `Confidential` — shown on the cover and in the footer |
| `{{RUNTIME_NOTE}}` | `""` for static-only, or `" + authorized runtime probing"` |
| `{{ONE_LINE_VERDICT}}` | The single sentence a director will remember |
| `{{EXEC_PARA_1/2}}` | Plain language, no crypto internals |
| `{{N_*}}` | Counts for the headline table |
| `{{TAKEAWAY_1..3}}` | Action-oriented, not restatements |
| `{{EXPOSED_LIST}}`, `{{STILL_EXPOSED_LIST}}` | `<li>` items |
| `{{SEVERITY_ROWS}}` | `<tr>` per finding — ID, name, CWE, severity (current build, one column), precedent |
| `{{PRECEDENT_ROWS}}` | `<tr>` per precedent cited — ID, incident, confidence, source |
| `{{VERIFICATION_COMMANDS}}` | Commands used, for independent re-execution |
| `{{LIMITATIONS}}` | What this review could not establish |

Per finding card: `{{PLAYBOOK}}`, `{{OWNER}}`, `{{EFFORT}}`.

## Writing the finding cards

Five sections, no "Recommendation" box: **Overview, Description, Proof of concept, Business impact, Standards & mappings.** No vendor is named anywhere — Business impact makes the *liability* case, not a product case.

- **Business impact carries an average cost on EVERY finding — varied per finding, not one figure repeated, and size-matched.** Draw from the verified multi-source anchor set (`canon/breach-precedents.md` → "Average-cost anchors"): **IBM 2025** (modeled, enterprise-weighted — global $4.44M, US $10.22M, public sector $2.86M, healthcare $7.42M/$398-record, credential-initiated $4.67M, ~$160–168/record); **NetDiligence 2025** (real insurance claims, SME-dominated — **~$246K** avg SME incident, use for small/mid-market/self-hosted targets); **Verizon DBIR 2025** (stolen credentials 22%, human element 60%, third-party doubled); **Sophos 2025** (ransomware recovery $1.53M, ransom $1.0M); **FBI IC3 2024** ($16.6B total, BEC $2.7B). Match the source to the target's size and the finding's class; rotate them. Cite the breach (BP-xx) for the mechanism; the average for the money — never the precedent's one-off total.
- **Frame architectural findings as inherent liabilities:** the artifact (stored hash, single signing key, bearer token, server-readable data, god-role admin) makes the app inherently exposed — not a bug to patch — then the historical breach and the average cost. State that the exposure is inherent to holding the artifact; do **not** name a solution or vendor. That is phase-2 material.
- **Keep it true:** coding/config/CVE findings get the real fix; architectural findings state the liability honestly without overclaiming.


## Never paste secrets into the report

A finding about a committed or hard-coded credential must show the **key name and `file:line`**, with the value masked (`SEQ_API_KEY=‹redacted›`). Never copy a real password, API key, token, client secret, or connection string into the report — the report is a shareable artifact, and a pasted secret re-leaks it. This holds even when the whole finding is about that secret.

## Layout behaviour

Handled for you, but worth knowing when editing:

- Finding cards, table rows, and callouts never split across a page (`break-inside: avoid`).
- Table headers repeat when a table crosses pages.
- Section headings never orphan at the foot of a page.
- Severity is carried by **label + border weight + fill**, so it survives greyscale printing and colour-blind readers. Never signal severity by colour alone.
- `print-color-adjust: exact` keeps chip fills in the PDF instead of dropping to white.
- Link URLs are printed after each link, so a paper copy stays verifiable.
- The blue "how to make the PDF" banner is `.no-print` and never appears in the output.
- Page size is A4. For US readers change `@page { size: A4; }` to `letter` at the top of the stylesheet.

## Language and framing

The reader is a manager or director. Two rules, enforced by the skill:

- **Phase 1 names no vendor.** Neither Tide nor TideCloak appears in the assessment.
- **Phase 2 uses the correct cryptographic terms, glossed once, not vague euphemisms.** The whole point of the companion is to explain *why* one compromise stops yielding everything, so name the real mechanism: **threshold signature** (a deployment-set number of independent nodes must each contribute a partial signature to sign; the key is never assembled in one place), **distributed key generation** (no node ever holds the whole key), **admin quorum**, **threshold password verification** (a live check across the nodes with nothing stored to crack). Give a one-line plain gloss on first use. Do **not** hide the mechanism behind "the operator network" or "signed by the network" — those obscure what is happening. Tide's internal proper nouns (ORK, VVK, PRISM) may be named once in parentheses if it aids a reader who will look them up, but lead with the descriptive term. **Never hardcode the threshold count** (I-02); write "a deployment-set threshold, for example k of n." In both phases keep `DPoP`, `SG-xx`, `BP-xx`, CVE ids and `file:line` — checkable references, not jargon.
- **Relatable cost, not big numbers.** Convert impact into the reader's own units — their record count, their client count, their notification duty. If you use a per-record industry average, cite it, label it an estimate and show the arithmetic. Never present a derived figure as measured.

## Honesty constraints carried into the layout

The template makes the honest thing the easy thing. A concentrated-trust artifact is still rated by its exposure, never marked "none".

**No disclaimer boilerplate.** The template carries no cover or footer disclaimer (no "not an audit / no claim of compliance / no guarantee of security / not a forecast" block); do not add one. Keep at most a one-line factual scope note in the footer (what was and was not tested, Verified vs Inferred). Honesty about the cost numbers lives inline, per figure, where it qualifies a specific number ("class average, not a forecast for this target"), not in a boilerplate block.

The **Coverage** section (§3) is part of the same idea: a verdict for all eight scrutiny surfaces, including "Not checked". A review that silently omits a surface looks identical to one that found it clean — the table is what makes the difference visible.
