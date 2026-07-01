# HCP Estimate Content Spec

Living spec for the **exact content** the app writes into Housecall Pro (HCP)
estimates — line-item names, descriptions, wording, and which parts are
boilerplate vs. auto-filled from app data vs. tech free-text.

> Status: **in progress** — being built section by section from real estimate
> examples. Build is deferred until the spec is complete and open questions are
> resolved.

---

## How estimates map to HCP (context)

- An HCP estimate is **multi-option**: `estimate → options[] → line_items[]`.
- Line items live under an option, endpoint
  `/estimates/{id}/options/{option_id}/line_items`.
- Line-item fields we set: `name`, `description`, `unit_price` (cents),
  `quantity`, `kind` (`labor`/`discount`), `taxable`.
- A line item can be **$0** (used for descriptive / scope / terms sections).
- Push behavior (already built): linked estimates are **overwritten in place**
  (schedule/appointment/tech untouched); walk-ups **create** a new estimate
  scheduled today + assigned to the picked tech.

The estimate is composed of an **ordered list of line items**. Some are purely
descriptive ($0), some carry the priced work.

---

## Section 1 — Scope of Work  *(line item, $0, no price)*

The first line item. Purely descriptive: what's being done and general
condition, **no price**.

### Name
`Scope of Work: <short title>`

Examples:
- `Scope of Work: Front/Back Deck Refinishing`
- `Scope of Work: Side/Back Deck Refinishing`
- `Scope of Work: Deck Refinishing`

Title is a short, tech-editable field, defaulting from the structure(s)
(e.g. "Deck Refinishing").

### Description (structured narrative)

Built from a fixed skeleton = **constant boilerplate** + **job-specific inserts**:

1. **Area block(s)** — one per area:
   ```
   <Area name> Area: <N> sq ft. - This includes refinishing of all accessible
   surfaces including <surface list>.
   ```
   - Optional extra line, e.g. `*Project includes accessible exterior surfaces of gazebo.`
   - Surface list derives from the form (railing assemblies, deck floor, stair
     treads, risers/skirting, apron, privacy fence/wall, benches, etc.).

2. **Client Responsibilities:** (bulleted)
   - **Always-on defaults:**
     - Clearing the deck surface and removing all hanging items before work begins.
     - Notifying adjacent neighbors of the scheduled project dates to help ensure
       the crew can remain focused and minimize interruptions during work hours.
     - Ensuring accessibility and proper functioning of a water source and power
       outlet throughout the project duration.
   - **+ job-specific** added by the tech (quick-pick common ones + free text),
     e.g. replace post caps, remove/reinstall screens.

3. **Exclusions:** (bulleted)
   - **Default:** The underside of the deck is not included in this refinishing proposal.
   - **+ job-specific** (synthetic surfaces, gazebo interior, support beams/posts, …).

4. **Additional Services:** (bulleted)
   - **Default:** Upon-request inspection / maintenance wash within 18 months of
     project completion.
   - **+ job-specific** add-more.

5. **Special notes:** optional free-text block(s) — e.g. the Privacy Fence
   appearance disclaimer. Verbatim, tech-entered.

### Generation approach (decided + BUILT)
App **auto-drafts** this section (standard boilerplate + an area line built from
sq ft / railing / stairs / gazebo-pergola) into an **editable text area** the
tech refines per job. Stored as `scope_title` + `scope_description`; pushed as a
$0 `Scope of Work: <title>` line (first item). ✅ **BUILT** (form card with
"Regenerate draft", save, edit-prefill, estimate-view card, HCP line).

Because the description is free text, **multiple areas are handled descriptively
today** — the tech writes additional area blocks in the box. The only deferred
piece is *structured per-area pricing* (see Multiple areas + Q1).

### Multiple areas (edge case) — pricing piece DEFERRED
- A **"Multiple areas"** toggle (off by default).
- When on: add areas, each = **name** + **sq ft** + **its own features**.
- Pricing handling, tech-selectable: **combined** vs **itemized in one estimate**
  vs **separate HCP option per area**. The *separate-HCP-option* path needs the
  Options feature machinery, so structured multi-area pricing is built **together
  with the Options feature** (Phase 3). Descriptive multi-area already works via
  the editable scope text.

---

## Section 2 — Power Washing / Wood Cleaning  *(line item)*

- **Name:** `Power Washing / Wood Cleaning` (always exactly this).
- **Shown only when cleaning is enabled** — skip the line entirely if no
  cleaning is needed.
- **Price:** cleaning **labor** = `breakdown.cleaning.total` (materials are
  carried separately in the Materials section). ✅ confirmed (Q2)
- **Status:** ✅ **BUILT** in `hcp.js` (`buildLineItems`).

### Description (approved)
> Our wood restoration process begins by applying a dedicated wood cleaner and
> power washing the surface to effectively remove dirt, grime, and built-up
> residue. When needed, we follow with a wood brightener to revive the wood's
> natural color and vibrancy. The cost of these cleaning materials is included
> in the Materials section.

### Default disclaimer (always appended, verbatim)
> *Power washing may uncover additional rot not detected during the initial
> estimate. Any additional replacement required is not included in this quote,
> as it will be assessed separately upon discovery.

---

## Section 3 — Sanding / Surface Preparation  *(line item)*  — ✅ BUILT

- **Shown only when a sanding condition is selected** (skip if none / no sanding).
- **Price:** sanding **labor** = `breakdown.sanding.total` (sanding supply is in
  the Materials section).
- **Status:** ✅ **BUILT** in `hcp.js` (`buildLineItems`). Light Sanding kept
  minimal (no hardware line).
- **Name + description vary by `sanding_condition`:**

| `sanding_condition` | Line name |
|---|---|
| `never_finished` | Light Sanding |
| `oil_before`, `latex_before` | Standard Sanding / Surface Preparation |
| `stain_removal` | Sanding to Bare Wood / Complete Stain Removal |

### Light Sanding (`never_finished`)
> A light sanding to smooth out surface imperfections and remove roughness from
> the wood's texture, creating a clean, even base for the final application.

### Standard Sanding / Surface Preparation (`oil_before`, `latex_before`)
> Our surface preparation includes a complete sanding of the deck in preparation
> for the final application, ensuring optimal adhesion and a smooth, uniform
> finish. This includes power sanding of all horizontal surfaces for thorough,
> consistent results.
> - Light sanding of accessible vertical surfaces is performed as needed, at the
>   technician's discretion based on accessibility and the specific requirements
>   of the project.
> - Any loose nails, screws, or bolts discovered during the work are tightened
>   and secured to maintain the stability and safety of the deck surface. This
>   inspection focuses on critical, accessible areas to uphold structural
>   integrity and does not cover every piece of hardware on the deck.
>
> Note: Please note that this process will not completely remove existing
> coatings. Alternative methods such as chemical stripping or sanding to bare
> wood are available upon request; however, even with these methods, complete
> removal of previous coatings cannot be guaranteed. We provide the most
> effective solutions available, but absolute removal is not assured.

### Sanding to Bare Wood / Complete Stain Removal (`stain_removal`)
> This service involves an aggressive sanding to remove the existing coating and
> bring the wood back to a bare surface, creating the ideal foundation for the
> new finish and maximizing adhesion. We power sand all horizontal surfaces for
> thorough, consistent results, and lightly sand accessible vertical surfaces as
> needed, at the technician's discretion based on accessibility and project
> requirements.
> - Any loose nails, screws, or bolts discovered during the work are tightened
>   and secured to maintain the stability and safety of the deck surface. This
>   inspection focuses on critical, accessible areas and does not cover every
>   piece of hardware on the deck.
>
> Note: Please note that while this process is intended to return the wood to a
> bare surface, complete removal of all existing coatings cannot be guaranteed.
> Aged stains, deep penetration, and weathering may leave residual coating or
> discoloration in some areas. We use the most effective methods available to
> achieve the best possible result, but absolute removal is not assured.

---

## Section 4 — Staining / Sealing  *(line item)*  — ✅ BUILT (Rymar); others pending wording

- **Shown only when staining is enabled** (skip if `staining.total` is 0).
- **Price:** staining **labor** = `breakdown.staining.total` (stain product is in
  the Materials section).
- **Name + intro vary by `stain_process`**; the **three caveats are shared** and
  appended to **every** staining line.
- **Color:** NOT inserted yet (deferred) — intro says "in a color selected by the
  customer."

### Shared caveats (appended to all staining lines)
> - Please note that variations in color and sheen may occur.
> - Knots and areas of hard grain may remain lighter or whiter after application.
> - New board installations may show color variations relative to the existing
>   decking due to differences in age and condition. We strive for a consistent
>   appearance, but natural variation may occur.

Per-product structure: **intro** + optional **product-specific notes** (bullets)
+ **shared caveats** (bullets).

### Rymar (`rymar_oil_seal`) — ✅ BUILT
- **Name:** Application of Sealer — Oil-Based Semi-Transparent Rymar Xtreme Weather Sealer
- **Intro:** Our service includes the application of one coat of oil-based
  semi-transparent Rymar Xtreme Weather Sealer, in a color selected by the customer.

### Benjamin Moore Solid (`bm_solid`) — ✅ BUILT
- **Name:** Application of Stain — Benjamin Moore Solid WoodLuxe
- **Intro:** This service involves applying one coat of Benjamin Moore Solid
  WoodLuxe stain, in a color selected by the client.
- **Product notes:** (1) project limited to one color selection; (2) white/light
  colors may need an extra coat at additional labor+materials cost.

### IPE Oil (`ipe_oil`) — ✅ BUILT
- **Name:** Application of Deck-Wise IPE Oil
- **Intro:** 3-paragraph Deck-Wise Ipe oil blurb (grammar lightly polished;
  fence/etc. tied to Scope of Work). + shared caveats.

### Customer-supplied (`customer_oil`, `customer_acrylic`) — ✅ BUILT
- **Name:** Application of Customer-Supplied {Oil-Based|Acrylic} Stain / Sealer
- **Intro:** "Deck staining will be performed using the customer-supplied
  {oil-based|acrylic} stain/sealer (<Custom Product Description>)." — the product
  name comes from `stain_custom_desc` (omitted if blank).
- **Disclaimer (replaces the shared caveats):** "We do not guarantee the product,
  how long it will last, or the final look of the deck or the color of the
  product. We will apply the product following all manufacturer recommendations.
  All warranty claims should be directed to the manufacturer of the product."

**§4 complete — all five `stain_process` values covered.**

---

## Section 5 — Repair / Replacement  *(line item)*  — ✅ BUILT

- **Name:** `Repair / Replacement`
- **Shown only when there are repairs** (`repairs.total > 0`, i.e. labor + debris).
- **Price:** repairs **labor + debris**. Repair **materials are billed in the
  Materials section** (decision **B** — pricing split). Grand total unchanged.
- **Description = tech-editable write-up body + standard footers (auto-added):**
  1. Body: auto-drafted `Scope of Repair/Replacement:` + a bullet per repair, into
     an **editable textarea** in the Repairs screen (`repairs_description`). Tech
     expands for larger jobs (staircase narrative, per-area grouping, etc.).
  2. Footer `*` — loose nails/hardware note (improved wording).
  3. Footer `**` — "more repairs likely discovered" note (improved wording).
  4. `The cost of materials is included in the Materials section.`
- Fallback: if the tech leaves the write-up blank, the body is generated
  server-side from the repair items.
- Per-area grouping rides on the Multiple-areas feature (deferred).

### Improved footers (verbatim)
> *As part of our service, all discovered loose nails, screws, and bolts will be
> tightened and secured (as reasonably possible) to help ensure the stability and
> safety of the immediate deck surface. Please note that this inspection does not
> cover all hardware on the deck; it focuses on critical, accessible areas to
> uphold structural integrity.

> **Given the current condition of the deck and the number of repairs, it is
> likely that additional repairs will be discovered during the removal process.
> All discovered repairs will be brought to the client's attention before any
> extra work begins. Any additional carpentry will require additional labor and
> materials, available at an added charge.

---

## Section 6 — Materials and Supplies  *(line item)*  — ✅ BUILT

- **Name:** `Materials and Supplies`
- **Shown when `materials.total > 0`.**
- **Price:** the full materials total — stain product + cleaning/stain/sanding
  supplies + **repair materials** (folded in by decision B).
- **Description:** standard language on every estimate (no itemization):
  > This section covers all necessary supplies required to complete the project
  > efficiently, including the cost of stain or sealant as well as any additional
  > items such as lumber, screws, fasteners, cleaning and prep products, brushes,
  > and other essential supplies needed for the project.

---

## Data model implications (running list)

Scope of Work needs:
- `scope_title` (short text; line-item name suffix).
- `areas[]`: `{ name, sqft, surfaces/features }` (1+ when "Multiple areas" on).
- `multi_area_pricing`: combined | separate.
- Editable bullet lists: `responsibilities[]`, `exclusions[]`,
  `additional_services[]` — each = defaults + tech extras.
- `special_notes` free text.

(Will be reconciled into concrete DB columns / JSON once the full spec is in.)

---

## Open questions

- ~~**Q1 — "Price areas separately" output**~~ → ✅ decided: tech chooses
  **itemized in one estimate** (A) or **separate HCP option per area** (B).
  Built with the Options feature (Phase 3). Descriptive multi-area already works
  via the editable scope text.

- ~~**Q2 — Power Washing line price**~~ → ✅ confirmed: cleaning **labor**
  total, materials shown only in the Materials section.

---

## Changelog
- Section 1 (Scope of Work) captured; generation approach + responsibilities
  pattern decided.
- Section 2 (Power Washing / Wood Cleaning) **BUILT** — description approved,
  rot disclaimer appended, price = cleaning labor. Sections 3+ pending.
- Section 1 (Scope of Work) **BUILT** (single-area + descriptive multi-area):
  DB `scope_title`/`scope_description`, form card with auto-draft + editable text,
  save/edit-prefill, estimate-view card, $0 HCP line. Structured per-area
  *pricing* deferred to the Options feature (Phase 3).
