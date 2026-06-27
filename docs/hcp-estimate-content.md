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

### Generation approach (decided)
App **auto-drafts** this section (boilerplate always included; areas / sq ft /
surfaces pulled from the form) into an **editable text area** the tech can refine
per job. Consistency without forcing every nuance into rigid fields.

### Multiple areas (edge case)
- A **"Multiple areas"** toggle (off by default).
- When on: add areas, each = **name** + **sq ft** + **its own features**.
- Pricing handling: **combined into one total** vs **priced separately** on the
  same estimate. *(See open question Q1.)*

---

## Section 2 — Power Washing / Wood Cleaning  *(line item)*

- **Name:** `Power Washing / Wood Cleaning` (always exactly this).
- **Shown only when cleaning is enabled** — skip the line entirely if no
  cleaning is needed.
- **Price:** cleaning **labor** = `breakdown.cleaning.total` (materials are
  carried separately in the Materials section). *(See open question Q2.)*

### Description (reworded — pending final approval)
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

- **Q1 — "Price areas separately" output:** when multiple areas are priced
  separately, what does the customer see?
  (A) separate line-item groups within one estimate, one total;
  (B) separate HCP options (Option #1 = Back Deck, #2 = Front Porch);
  (C) two separate estimates.
  *Lean: (A); (B) reserved for true either/or options.* — **pending**

- **Q2 — Power Washing line price:** confirm the line carries the cleaning
  **labor** total (`breakdown.cleaning.total`), with materials shown only in the
  Materials section. — **pending**

---

## Changelog
- Section 1 (Scope of Work) captured; generation approach + responsibilities
  pattern decided.
- Section 2 (Power Washing / Wood Cleaning) captured; description reworded
  (pending approval), default rot disclaimer recorded. Sections 3+ pending.
