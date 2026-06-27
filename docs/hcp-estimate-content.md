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
