// ---------------------------------------------------------------------------
// PRICING / OPTIONS CONFIG  (deck)
// ---------------------------------------------------------------------------
// Edit prices here. The deck estimate is built up section by section; today the
// priced section is CLEANING (power washing). Other sections (staining/sealing,
// repairs) will be added the same way. Square footage in the cleaning table is
// horizontal deck surface only.
// ---------------------------------------------------------------------------

export const STRUCTURE_TYPES = {
  deck:    { label: "Deck",    enabled: true },
  porch:   { label: "Porch",   enabled: false },
  fence:   { label: "Fence",   enabled: false },
  pergola: { label: "Pergola", enabled: false },
  gazebo:  { label: "Gazebo",  enabled: false },
};

export const WOOD_TYPES = {
  pressure_treated:    { label: "Pressure-treated" },
  cedar:               { label: "Cedar" },
  hardwood:            { label: "Hardwood (Ipe / Mahogany)" },
  engineered_hardwood: { label: "Engineered hardwood", no_horizontal_sanding: true },
  composite:           { label: "Composite" },
};

export const DECK_LOCATIONS = {
  above_ground: { label: "Above ground" },
  rooftop:      { label: "Rooftop" },
};

export const PRIOR_FINISHES = {
  bare_wood:            { label: "Bare Wood" },
  solid_stain_acrylic:  { label: "Solid Stain (Acrylic)" },
  oil_based_color_seal: { label: "Oil-Based Color Seal" },
  clear_seal:           { label: "Clear Seal" },
};

// Structures on the deck that can be included in the quote (multi-select).
export const DECK_STRUCTURES = {
  pergola:         { label: "Pergola" },
  gazebo:          { label: "Gazebo" },
  wood_benches:    { label: "Wood Benches" },
  planters:        { label: "Planters" },
  patio_furniture: { label: "Patio Furniture" },
  other:           { label: "Other" },
};

// Pergola/gazebo exterior cleaning add-on, by footprint size.
export const PERGOLA_GAZEBO_SIZES = {
  none:   { label: "None",  price: 0 },
  s15x10: { label: "15×10", price: 200 },
  s20x15: { label: "20×15", price: 400 },
  s25x20: { label: "25×20", price: 600 },
  s30x25: { label: "30×25", price: 750 },
};

// Sanding (labor) by deck condition. rate = $/sq ft on the horizontal area;
// min = minimum labor charge; supply = which sanding supply cost also applies.
export const SANDING_CONDITIONS = {
  never_finished: { label: "Deck never finished",       rate: 0.75, min: 150, supply: "never" },
  oil_before:     { label: "Sealed with oil before",    rate: 1.25, min: 300, supply: "prior" },
  latex_before:   { label: "Stained with latex before", rate: 2.00, min: 0,   supply: "prior" },
  stain_removal:  { label: "Stain removal to bare wood", rate: 4.00, min: 0,   supply: "removal" },
};

// ---------------------------------------------------------------------------
// CLEANING (power washing) RATE TABLE — EDIT THESE NUMBERS.
// sq ft tiers (index): 0 = under 200, 1 = 200–400, 2 = 400–600, 3 = above 600.
// ---------------------------------------------------------------------------
export const CLEANING_PRICING = {
  base_no_railing:   [400, 500, 600, 600],
  base_with_railing: [450, 600, 700, 700],
  // Above 600 sq ft: add this per each extra 200 sq ft beyond 600.
  over_600_extra_per_200: 50,
  // Story multiplier by stories -> per sq ft tier. Stories come from the
  // Project "Multi-level deck" line (levels): none/1 = 1 story, 2 = 2-story, 3+ = 3-story.
  story_multiplier: {
    1: [1.0, 1.0, 1.0, 1.0],
    2: [1.5, 1.5, 1.3, 1.2],
    3: [2.0, 2.0, 2.0, 2.0],
  },
  chicago_surcharge: 0.10,     // Chicago / town by Michigan: +10%
  light_clean_discount: 0.30,  // new deck, light clean only: -30%
};

function sqftTier(sqft) {
  if (sqft < 200) return 0;
  if (sqft <= 400) return 1;
  if (sqft <= 600) return 2;
  return 3;
}

export function computeCleaning(input) {
  if (!input.cleaning_enabled) return { enabled: false, total: 0 };

  const sqft = Number(input.surface_sqft) || 0;
  const hasRailing = !!input.has_railing;
  const tier = sqftTier(sqft);

  const table = hasRailing ? CLEANING_PRICING.base_with_railing : CLEANING_PRICING.base_no_railing;
  let base = table[tier];
  if (tier === 3 && sqft > 600) {
    const extraBlocks = Math.ceil((sqft - 600) / 200);
    base += extraBlocks * CLEANING_PRICING.over_600_extra_per_200;
  }

  const levels = Number(input.multilevel_levels) || 0;
  const stories = levels >= 2 ? Math.min(3, levels) : 1;
  const mult = (CLEANING_PRICING.story_multiplier[stories] || CLEANING_PRICING.story_multiplier[1])[tier];

  let deckWash = base * mult;
  if (input.light_clean) deckWash *= (1 - CLEANING_PRICING.light_clean_discount);

  const pergola = (PERGOLA_GAZEBO_SIZES[input.pergola_gazebo_size] || PERGOLA_GAZEBO_SIZES.none).price;

  let total = deckWash + pergola;
  if (input.chicago_surcharge) total *= (1 + CLEANING_PRICING.chicago_surcharge);
  total = Math.round(total * 100) / 100;

  return {
    enabled: true,
    base,
    tier,
    story_multiplier: mult,
    deck_wash: Math.round(deckWash * 100) / 100,
    pergola_gazebo: pergola,
    light_clean: !!input.light_clean,
    chicago_surcharge: !!input.chicago_surcharge,
    total,
  };
}

// ---------------------------------------------------------------------------
// MATERIALS & SUPPLIES COSTS — EDIT THESE NUMBERS.
// Stain material: gallons = ceil(area / coverage_sqft); cost = gallons × $/gal.
//   Stain area = vertical + horizontal combined (per the rate sheet).
// Supplies: cost = price × max(1, area / per_sqft) — prorated up for larger
//   areas, never reduced below the baseline price for smaller ("don't deduct").
// ---------------------------------------------------------------------------
export const MATERIALS_PRICING = {
  stain_brands: {
    rymar:          { label: "Rymar",          coverage_sqft: 250, price_per_gallon: 150 },
    benjamin_moore: { label: "Benjamin Moore", coverage_sqft: 250, price_per_gallon: 75 },
    twp:            { label: "TWP",            coverage_sqft: 150, price_per_gallon: 75 },
    ipe_oil:        { label: "Ipe Oil",        coverage_sqft: 300, price_per_gallon: 100 },
    ready_seal:     { label: "Ready Seal",     coverage_sqft: 150, price_per_gallon: 60 },
  },
  supplies: {
    cleaner_brightener: { label: "Cleaner & Brightener + gas (PW)", per_sqft: 300, price: 20,  area: "horizontal" },
    stain_supplies:     { label: "Brush/roller/tape/covers",        per_sqft: 300, price: 50,  area: "combined" },
    sand_never:         { label: "Sanding — never finished",        per_sqft: 300, price: 30,  area: "horizontal" },
    sand_prior:         { label: "Sanding — previously finished",   per_sqft: 300, price: 50,  area: "horizontal" },
    sand_removal:       { label: "Sanding — stain removal",         per_sqft: 300, price: 100, area: "horizontal" },
  },
};

const round2 = (v) => Math.round(v * 100) / 100;
function proratedSupply(item, area) {
  return round2(item.price * Math.max(1, (Number(area) || 0) / item.per_sqft));
}

// Compute materials & supplies cost. Each component activates only when its
// inputs exist — today that's the cleaner/brightener (tied to cleaning). Stain
// material, staining supplies, and sanding switch on once the staining/prep
// sections feed in stain_brand, vertical area, and sanding choice.
export function computeMaterials(input) {
  const items = [];
  const horizontal = Number(input.surface_sqft) || 0;
  const vertical = Number(input.vertical_sqft) || 0;   // captured later (staining section)
  const combined = horizontal + vertical;

  // Cleaner & Brightener + gas — included whenever we power wash / clean.
  if (input.cleaning_enabled) {
    const s = MATERIALS_PRICING.supplies.cleaner_brightener;
    items.push({ id: "cleaner_brightener", label: s.label, cost: proratedSupply(s, horizontal) });
  }

  // Staining material + supplies (needs staining on + combined area).
  // Brush/roller supplies always apply when staining; the stain product itself is
  // skipped when the customer supplies it, or when the process has no priced product.
  if (input.staining_enabled && combined > 0) {
    const proc = STAIN_PROCESSES[input.stain_process];
    const matKey = proc && proc.material;
    const brand = (matKey && !input.stain_customer_supplied) ? MATERIALS_PRICING.stain_brands[matKey] : null;
    if (brand) {
      const gallons = Math.ceil(combined / brand.coverage_sqft);
      items.push({ id: "stain_material", label: `${brand.label} stain (${gallons} gal)`, cost: round2(gallons * brand.price_per_gallon) });
    }
    const ss = MATERIALS_PRICING.supplies.stain_supplies;
    items.push({ id: "stain_supplies", label: ss.label, cost: proratedSupply(ss, combined) });
  }

  // Sanding supply (needs a sanding condition). Horizontals only — skipped when
  // the wood type can't be surface-sanded (e.g. engineered hardwood).
  const sandCond = SANDING_CONDITIONS[input.sanding_condition];
  const noHorizSand = !!(WOOD_TYPES[input.wood_type] && WOOD_TYPES[input.wood_type].no_horizontal_sanding);
  if (sandCond && sandCond.supply && !noHorizSand) {
    const key = { never: "sand_never", prior: "sand_prior", removal: "sand_removal" }[sandCond.supply];
    const s = MATERIALS_PRICING.supplies[key];
    if (s) items.push({ id: key, label: s.label, cost: proratedSupply(s, horizontal) });
  }

  const total = round2(items.reduce((s, x) => s + x.cost, 0));
  return { items, total };
}

// Sanding labor. Horizontal = chosen rate × surface sq ft (floored at the min).
// Verticals (railings) = same chosen rate × (length × height). Chicago +10%.
export function computeSanding(input) {
  const cond = SANDING_CONDITIONS[input.sanding_condition];
  if (!cond) return { enabled: false, total: 0 };
  const noHoriz = !!(WOOD_TYPES[input.wood_type] && WOOD_TYPES[input.wood_type].no_horizontal_sanding);
  const horizontal = Number(input.surface_sqft) || 0;
  const horizLabor = noHoriz ? 0 : Math.max(cond.min || 0, cond.rate * horizontal);
  let vertical_sqft = 0, vertLabor = 0;
  if (input.vertical_sanding) {
    vertical_sqft = (Number(input.vertical_length) || 0) * (Number(input.vertical_height) || 0);
    vertLabor = cond.rate * vertical_sqft;
  }
  let total = horizLabor + vertLabor, surcharge = 0;
  if (input.chicago_surcharge) { surcharge = total * CLEANING_PRICING.chicago_surcharge; total += surcharge; }
  return {
    enabled: true, condition: input.sanding_condition, rate: cond.rate,
    horizontal_labor: round2(horizLabor), vertical_sqft, vertical_labor: round2(vertLabor),
    surcharge: round2(surcharge), total: round2(total),
  };
}

// ---------------------------------------------------------------------------
// STAINING / SEALING (labor) RATE TABLES — per product/brand. EDIT THESE.
// sq ft tiers (index): 0=<200, 1=200–300, 2=300–400, 3=400–500, 4=500–600, 5=>600.
// Only brands listed here are priced; others get added as their tables arrive.
// ---------------------------------------------------------------------------
export const STAINING_PRICING = {
  rymar: {
    label: "Rymar",
    base_no_railing:   [600, 700, 800, 900, 950, 950],
    base_with_railing: [950, 1050, 1150, 1200, 1250, 1250],
    over_600_extra_per_200_no_railing: 100,
    over_600_extra_per_200_with_railing: 150,
    story_multiplier: { 1: [1, 1, 1, 1, 1, 1], 2: [1.5, 1.5, 1.5, 1.4, 1.3, 1.2], 3: [2, 2, 2, 2, 2, 2] },
    pergola_gazebo: { none: 0, s15x10: 600, s20x15: 800, s25x20: 1100, s30x25: 1300 },
  },
  benjamin_moore: {
    label: "Benjamin Moore Solid",
    base_no_railing:   [500, 600, 700, 775, 850, 850],
    base_with_railing: [850, 950, 1050, 1100, 1150, 1150],
    over_600_extra_per_200_no_railing: 100,
    over_600_extra_per_200_with_railing: 150,
    story_multiplier: { 1: [1, 1, 1, 1, 1, 1], 2: [1.5, 1.5, 1.5, 1.4, 1.3, 1.2], 3: [2, 2, 2, 2, 2, 2] },
    pergola_gazebo: { none: 0, s15x10: 600, s20x15: 800, s25x20: 1100, s30x25: 1300 },
    metal_spindles_surcharge: 0.10,
  },
};

// Staining/sealing processes the tech can choose. `labor` -> STAINING_PRICING key
// (null = labor table not added yet); `material` -> MATERIALS_PRICING.stain_brands
// key (null = no priced product). customer_choice processes show a description
// field + "customer supplied" toggle.
export const STAIN_PROCESSES = {
  rymar_oil_seal:   { label: "Rymar — Oil-Based Seal",            labor: "rymar",          material: "rymar" },
  bm_solid:         { label: "Benjamin Moore — Solid Stain",      labor: "benjamin_moore", material: "benjamin_moore" },
  ipe_oil:          { label: "IPE Oil",                           labor: "ipe_oil",        material: "ipe_oil" },
  customer_oil:     { label: "Customer Choice — Oil-Based Product",  labor: null, material: null, customer_choice: true },
  customer_acrylic: { label: "Customer Choice — Acrylic Product",    labor: null, material: null, customer_choice: true },
};

function sqftTier6(sqft) {
  if (sqft < 200) return 0;
  if (sqft <= 300) return 1;
  if (sqft <= 400) return 2;
  if (sqft <= 500) return 3;
  if (sqft <= 600) return 4;
  return 5;
}

// Staining/sealing labor for the chosen product. Same shape as cleaning:
// base by sq-ft tier × railing, × story multiplier (from multi-level), + pergola
// add-on, + Chicago 10%.
export function computeStaining(input) {
  if (!input.staining_enabled) return { enabled: false, total: 0 };
  const proc = STAIN_PROCESSES[input.stain_process];
  const brand = proc && proc.labor ? STAINING_PRICING[proc.labor] : null;
  if (!brand) return { enabled: true, priced: false, process: input.stain_process || null, labor: 0, pergola_gazebo: 0, chicago_surcharge: 0, metal_surcharge: 0, surcharge: 0, total: 0 };

  const sqft = Number(input.surface_sqft) || 0;
  const hasRailing = !!input.has_railing;
  const tier = sqftTier6(sqft);

  const table = hasRailing ? brand.base_with_railing : brand.base_no_railing;
  let base = table[tier];
  if (tier === 5 && sqft > 600) {
    const per = hasRailing ? brand.over_600_extra_per_200_with_railing : brand.over_600_extra_per_200_no_railing;
    base += Math.ceil((sqft - 600) / 200) * per;
  }

  const levels = Number(input.multilevel_levels) || 0;
  const stories = levels >= 2 ? Math.min(3, levels) : 1;
  const mult = (brand.story_multiplier[stories] || brand.story_multiplier[1])[tier];

  const labor = base * mult;
  const pergola = brand.pergola_gazebo[input.pergola_gazebo_size] || 0;

  const subtotal = labor + pergola;
  const chicago_surcharge = input.chicago_surcharge ? subtotal * CLEANING_PRICING.chicago_surcharge : 0;
  const metal_surcharge = (input.has_metal_spindles && input.has_railing && brand.metal_spindles_surcharge)
    ? subtotal * brand.metal_spindles_surcharge : 0;
  const surcharge = chicago_surcharge + metal_surcharge;
  const total = subtotal + surcharge;

  return {
    enabled: true, priced: true, process: input.stain_process, base, story_multiplier: mult,
    labor: round2(labor), pergola_gazebo: pergola,
    chicago_surcharge: round2(chicago_surcharge), metal_surcharge: round2(metal_surcharge),
    surcharge: round2(surcharge), total: round2(total),
  };
}

// Build the full deck estimate breakdown (frozen into pricing_snapshot at save).
export function computeDeckEstimate(input) {
  const cleaning = computeCleaning(input);
  const sanding = computeSanding(input);
  const staining = computeStaining(input);
  const materials = computeMaterials(input);
  const discount = Number(input.discount) || 0;

  const extras = Array.isArray(input.extra_items) ? input.extra_items : [];
  const extrasTotal = extras.reduce((s, x) => s + (parseFloat(x.price) || 0), 0);

  const subtotal = cleaning.total + sanding.total + staining.total + materials.total + extrasTotal;
  const total = Math.max(0, subtotal - discount);

  return {
    cleaning,
    sanding,
    staining,
    materials,
    extras: extrasTotal,
    extras_list: extras,
    subtotal,
    discount,
    total,
  };
}
