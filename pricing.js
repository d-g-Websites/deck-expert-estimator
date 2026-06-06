// ---------------------------------------------------------------------------
// PRICING CONFIG
// ---------------------------------------------------------------------------
// This is the single place to edit prices. All numbers below are PLACEHOLDERS —
// replace them with Chicago Deck Expert's real rates. Changing a number here
// changes the estimator immediately (no other code changes needed).
//
// Pricing model for a DECK (v1):
//   surface  = surfaceRate(service, opacity, wood_type) * surface_sqft * prepMultiplier
//   railing  = RAILING_LF_RATE[service] * railing_lf
//   stairs   = STAIRS_EACH_RATE * stairs_count
//   extras   = sum of free-form line items
//   subtotal = surface + railing + stairs + extras
//   total    = max(0, subtotal - discount)
//
// Other structures (porch / fence / pergola / gazebo) will reuse this shape
// with their own rate tables once we adapt the deck workflow to them.
// ---------------------------------------------------------------------------

// Selectable options (id + human label). Order here = order shown in the form.
export const STRUCTURE_TYPES = {
  deck:    { label: "Deck",    enabled: true },
  porch:   { label: "Porch",   enabled: false },
  fence:   { label: "Fence",   enabled: false },
  pergola: { label: "Pergola", enabled: false },
  gazebo:  { label: "Gazebo",  enabled: false },
};

export const SERVICE_TYPES = {
  stain: { label: "Stain" },
  seal:  { label: "Seal" },
};

export const OPACITIES = {
  clear:            { label: "Clear / Natural" },
  semi_transparent: { label: "Semi-transparent" },
  semi_solid:       { label: "Semi-solid" },
  solid:            { label: "Solid" },
};

export const WOOD_TYPES = {
  pressure_treated: { label: "Pressure-treated" },
  cedar:            { label: "Cedar" },
  redwood:          { label: "Redwood" },
  hardwood:         { label: "Hardwood (Ipe / Mahogany)" },
  composite:        { label: "Composite" },
};

export const PREP_LEVELS = {
  standard:       { label: "Standard clean & prep", multiplier: 1.00 },
  weathered:      { label: "Weathered / heavy cleaning", multiplier: 1.15 },
  failing_finish: { label: "Stripping failing finish", multiplier: 1.30 },
};

// ---------------------------------------------------------------------------
// DECK RATE TABLES — EDIT THESE NUMBERS.
// surface[service][opacity][wood_type] = dollars per square foot.
// Use null where a combination isn't offered (e.g. solid stain on composite).
// ---------------------------------------------------------------------------
export const DECK_PRICING = {
  surface: {
    stain: {
      clear:            { pressure_treated: 2.50, cedar: 2.75, redwood: 2.75, hardwood: 3.50, composite: null },
      semi_transparent: { pressure_treated: 2.75, cedar: 3.00, redwood: 3.00, hardwood: 3.75, composite: null },
      semi_solid:       { pressure_treated: 3.00, cedar: 3.25, redwood: 3.25, hardwood: 4.00, composite: null },
      solid:            { pressure_treated: 3.25, cedar: 3.50, redwood: 3.50, hardwood: 4.25, composite: null },
    },
    seal: {
      clear:            { pressure_treated: 2.00, cedar: 2.25, redwood: 2.25, hardwood: 3.00, composite: 2.00 },
      semi_transparent: { pressure_treated: 2.25, cedar: 2.50, redwood: 2.50, hardwood: 3.25, composite: null },
      semi_solid:       { pressure_treated: null, cedar: null, redwood: null, hardwood: null, composite: null },
      solid:            { pressure_treated: null, cedar: null, redwood: null, hardwood: null, composite: null },
    },
  },
  // Per linear foot of railing, by service.
  railing_lf: { stain: 4.00, seal: 3.50 },
  // Per stair step.
  stairs_each: 15.00,
};

export function surfaceRate(service, opacity, woodType) {
  const byOpacity = DECK_PRICING.surface[service];
  if (!byOpacity) return null;
  const byWood = byOpacity[opacity];
  if (!byWood) return null;
  const rate = byWood[woodType];
  return rate == null ? null : rate;
}

// Compute a deck estimate from raw inputs. Returns a full breakdown object that
// also gets frozen into estimates.pricing_snapshot at save time.
export function computeDeckEstimate(input) {
  const service = input.service_type;
  const opacity = input.opacity;
  const woodType = input.wood_type;
  const prep = PREP_LEVELS[input.prep_level] || PREP_LEVELS.standard;

  const sqft = Number(input.surface_sqft) || 0;
  const railingLf = Number(input.railing_lf) || 0;
  const stairs = Number(input.stairs_count) || 0;
  const discount = Number(input.discount) || 0;

  const rate = surfaceRate(service, opacity, woodType);
  const surface = rate == null ? 0 : rate * sqft * prep.multiplier;
  const railing = (DECK_PRICING.railing_lf[service] || 0) * railingLf;
  const stairsTotal = DECK_PRICING.stairs_each * stairs;

  const extras = Array.isArray(input.extra_items) ? input.extra_items : [];
  const extrasTotal = extras.reduce((s, x) => s + (parseFloat(x.price) || 0), 0);

  const subtotal = surface + railing + stairsTotal + extrasTotal;
  const total = Math.max(0, subtotal - discount);

  return {
    rate_per_sqft: rate,
    rate_available: rate != null,
    prep_multiplier: prep.multiplier,
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
