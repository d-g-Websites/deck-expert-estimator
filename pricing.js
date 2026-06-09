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
  pressure_treated: { label: "Pressure-treated" },
  cedar:            { label: "Cedar" },
  hardwood:         { label: "Hardwood (Ipe / Mahogany)" },
  composite:        { label: "Composite" },
};

export const DECK_LOCATIONS = {
  above_ground: { label: "Above ground" },
  rooftop:      { label: "Rooftop" },
};

// Deck height (stories tall) — drives the cleaning story multiplier.
export const DECK_HEIGHTS = {
  ground:      { label: "Ground / 1st floor", stories: 1 },
  two_story:   { label: "2 stories",          stories: 2 },
  three_story: { label: "3 stories",          stories: 3 },
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

// ---------------------------------------------------------------------------
// CLEANING (power washing) RATE TABLE — EDIT THESE NUMBERS.
// sq ft tiers (index): 0 = under 200, 1 = 200–400, 2 = 400–600, 3 = above 600.
// ---------------------------------------------------------------------------
export const CLEANING_PRICING = {
  base_no_railing:   [400, 500, 600, 600],
  base_with_railing: [450, 600, 700, 700],
  // Above 600 sq ft: add this per each extra 200 sq ft beyond 600.
  over_600_extra_per_200: 50,
  // Story multiplier by stories -> per sq ft tier.
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

  const stories = (DECK_HEIGHTS[input.deck_height] || DECK_HEIGHTS.ground).stories;
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

// Build the full deck estimate breakdown (frozen into pricing_snapshot at save).
export function computeDeckEstimate(input) {
  const cleaning = computeCleaning(input);
  const discount = Number(input.discount) || 0;

  const extras = Array.isArray(input.extra_items) ? input.extra_items : [];
  const extrasTotal = extras.reduce((s, x) => s + (parseFloat(x.price) || 0), 0);

  const subtotal = cleaning.total + extrasTotal;
  const total = Math.max(0, subtotal - discount);

  return {
    cleaning,
    extras: extrasTotal,
    extras_list: extras,
    subtotal,
    discount,
    total,
  };
}
