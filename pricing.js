// ---------------------------------------------------------------------------
// PRICING / OPTIONS CONFIG  (deck)
// ---------------------------------------------------------------------------
// Edit prices here. All numbers are PLACEHOLDERS until Deck Expert's real rates
// are set. The form's "Project" section captures wood type, deck location,
// multi-level, railing, stairs, structures, square footage, and prior finish;
// quantitative fields (sq ft / railing lf / stairs) drive the placeholder total,
// the rest are captured for pricing later.
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

// ---------------------------------------------------------------------------
// DECK RATE TABLE — EDIT THESE NUMBERS (placeholders).
// ---------------------------------------------------------------------------
export const DECK_PRICING = {
  // $ per square foot by wood type
  surface_sqft: { pressure_treated: 3.00, cedar: 3.25, hardwood: 4.00, composite: 2.75 },
  // $ per linear foot of railing
  railing_lf: 4.00,
  // $ per stair step
  stairs_each: 15.00,
};

// Compute a deck estimate from raw inputs. Returns the price breakdown that is
// frozen into estimates.pricing_snapshot at save time.
export function computeDeckEstimate(input) {
  const woodRate = DECK_PRICING.surface_sqft[input.wood_type];
  const rate = (woodRate === undefined || woodRate === null) ? null : woodRate;

  const sqft = Number(input.surface_sqft) || 0;
  const railingLf = Number(input.railing_lf) || 0;
  const stairs = Number(input.stairs_count) || 0;
  const discount = Number(input.discount) || 0;

  const surface = rate == null ? 0 : rate * sqft;
  const railing = DECK_PRICING.railing_lf * railingLf;
  const stairsTotal = DECK_PRICING.stairs_each * stairs;

  const extras = Array.isArray(input.extra_items) ? input.extra_items : [];
  const extrasTotal = extras.reduce((s, x) => s + (parseFloat(x.price) || 0), 0);

  const subtotal = surface + railing + stairsTotal + extrasTotal;
  const total = Math.max(0, subtotal - discount);

  return {
    rate_per_sqft: rate,
    rate_available: rate != null,
    surface,
    railing,
    stairs: stairsTotal,
    extras: extrasTotal,
    extras_list: extras,
    subtotal,
    discount,
    total,
  };
}
