// ---------------------------------------------------------------------------
// Housecall Pro (HCP) client
// ---------------------------------------------------------------------------
// Pushes a saved estimate into Housecall Pro: upsert the customer, then create
// an estimate with line items. Requires HCP_API_KEY (Housecall Pro MAX plan).
//
// NOTE: HCP's exact estimate payload can vary by account configuration. The
// shapes below follow the public API docs (https://docs.housecallpro.com), but
// the first real push should be verified against the live account and tweaked
// here if HCP returns a validation error. All HCP-specific logic is contained
// in this one file on purpose.
// ---------------------------------------------------------------------------

import { STAIN_PROCESSES, WOOD_TYPES, STRUCTURE_TYPES } from "./pricing.js";

// HCP's public API is served at the bare host (no /v1 path segment).
const API_BASE = process.env.HCP_API_BASE || "https://api.housecallpro.com";
// HCP API keys authenticate with "Bearer <key>" (matches the CSC app).
// Override with HCP_AUTH_SCHEME=Token if your key requires it.
const AUTH_SCHEME = process.env.HCP_AUTH_SCHEME || "Bearer";

export function hcpEnabled() {
  return !!process.env.HCP_API_KEY;
}

async function hcpRequest(path, { method = "GET", body } = {}) {
  if (!hcpEnabled()) throw new Error("Housecall Pro is not configured (missing HCP_API_KEY)");
  const res = await fetch(API_BASE + path, {
    method,
    headers: {
      Authorization: `${AUTH_SCHEME} ${process.env.HCP_API_KEY}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || `HCP ${method} ${path} failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

function hcpListFromResponse(res, key) {
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res[key])) return res[key];
  if (res && Array.isArray(res.data)) return res.data;
  return [];
}

// Today's [00:00, 24:00) in America/Chicago, expressed as UTC ISO bounds.
function centralDayBoundsUTC() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const ymd = `${parts.find(p => p.type === "year").value}-${parts.find(p => p.type === "month").value}-${parts.find(p => p.type === "day").value}`;
  const probe = new Date(`${ymd}T12:00:00Z`);
  const centralHour = parseInt(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", hour12: false, hour: "2-digit",
  }).formatToParts(probe).find(p => p.type === "hour").value, 10);
  const offsetAbs = 12 - centralHour;
  const start = new Date(Date.parse(`${ymd}T00:00:00Z`) + offsetAbs * 3600 * 1000);
  const end = new Date(start.getTime() + 86400 * 1000);
  return { start: start.toISOString(), end: end.toISOString(), ymd };
}

// Quick connectivity check used by /api/hcp/test while wiring up the key.
export async function hcpTest() {
  const result = { ok: true, checks: {} };
  try {
    const ping = await hcpRequest("/customers?per_page=1");
    result.checks.auth = { ok: true, sample_response_keys: Object.keys(ping || {}) };
  } catch (e) {
    result.ok = false;
    result.checks.auth = { ok: false, error: e.message };
  }
  return result;
}

// List employees (techs) for the in-app tech picker.
export async function hcpEmployees() {
  const data = await hcpRequest("/employees?page_size=200");
  const list = hcpListFromResponse(data, "employees");
  return list
    .map(e => ({
      id: pickId(e, "id", "uuid"),
      name: `${e.first_name || ""} ${e.last_name || ""}`.trim() || e.email || "(unnamed)",
      role: e.role || null,
    }))
    .filter(e => e.id);
}

// Does an estimate's assigned_employees include the given employee id?
function estimateAssignedTo(est, employeeId) {
  if (!employeeId) return true;
  const emps = Array.isArray(est.assigned_employees) ? est.assigned_employees : [];
  return emps.some(e => pickId(e, "id", "uuid") === employeeId);
}

// Pull estimates scheduled in HCP for today (Chicago time), with customer
// contact info resolved, so a rep can tap one to prefill a new estimate.
// When employeeId is given, only that tech's appointments are returned.
export async function scheduledToday(employeeId = null) {
  const { start, end, ymd } = centralDayBoundsUTC();
  const qs = `scheduled_start_min=${encodeURIComponent(start)}&scheduled_start_max=${encodeURIComponent(end)}&per_page=100`;
  const data = await hcpRequest(`/estimates?${qs}`);
  const estimates = hcpListFromResponse(data, "estimates");
  const customerCache = new Map();
  const out = [];
  for (const est of estimates) {
    if (!estimateAssignedTo(est, employeeId)) continue;
    let cust = est.customer;
    const custId = (cust && cust.id) || est.customer_id;
    if (!cust && custId) {
      if (customerCache.has(custId)) {
        cust = customerCache.get(custId);
      } else {
        try {
          cust = await hcpRequest(`/customers/${custId}`);
          customerCache.set(custId, cust);
        } catch (e) {
          console.warn(`[scheduled-today] customer fetch ${custId} failed:`, e.message);
        }
      }
    }
    let scheduledStart = null;
    const options = Array.isArray(est.options) ? est.options : [];
    for (const opt of options) {
      const s = opt && opt.schedule && opt.schedule.scheduled_start;
      if (s && (!scheduledStart || s < scheduledStart)) scheduledStart = s;
    }
    const addresses = (cust && Array.isArray(cust.addresses)) ? cust.addresses : [];
    const a0 = addresses[0] || {};
    const addressStr = [a0.street, a0.city, a0.state, a0.zip].filter(Boolean).join(", ");
    const name = `${(cust && cust.first_name) || ""} ${(cust && cust.last_name) || ""}`.trim() || est.customer_name || "(no name)";
    out.push({
      hcp_estimate_id: est.id,
      hcp_estimate_number: est.estimate_number || null,
      customer_name: name,
      customer_phone: (cust && (cust.mobile_number || cust.home_number || cust.work_number)) || null,
      customer_email: (cust && cust.email) || null,
      customer_address: addressStr || null,
      scheduled_start: scheduledStart,
    });
  }
  out.sort((a, b) => (a.scheduled_start || "").localeCompare(b.scheduled_start || ""));
  return { ymd, start, end, count: out.length, estimates: out };
}

function splitName(fullName) {
  const parts = (fullName || "").trim().split(/\s+/);
  const first = parts.shift() || "Customer";
  const last = parts.join(" ");
  return { first, last };
}

function pickId(obj, ...keys) {
  for (const k of keys) {
    if (obj && obj[k]) return obj[k];
  }
  return null;
}

// Find an existing customer by email or phone, else create one. Returns the id.
export async function upsertCustomer(customer) {
  const { first, last } = splitName(customer.name);

  // Try to find an existing match first to avoid duplicates.
  const q = customer.email || customer.phone;
  if (q) {
    try {
      const search = await hcpRequest(`/customers?q=${encodeURIComponent(q)}&page_size=1`);
      const list = search?.customers || search?.data || [];
      if (Array.isArray(list) && list.length > 0) {
        const id = pickId(list[0], "id", "uuid");
        if (id) return id;
      }
    } catch (_) {
      // Search failure is non-fatal; fall through to create.
    }
  }

  const payload = {
    first_name: first,
    last_name: last,
    email: customer.email || undefined,
    mobile_number: customer.phone || undefined,
    notifications_enabled: false,
  };
  if (customer.address) {
    payload.addresses = [{ street: customer.address, country: "US" }];
  }

  const created = await hcpRequest("/customers", { method: "POST", body: payload });
  const id = pickId(created, "id", "uuid") || pickId(created?.customer || {}, "id", "uuid");
  if (!id) throw new Error("HCP customer created but no id was returned");
  return id;
}

// --- Estimate section copy (see docs/hcp-estimate-content.md) ---
// §2 Power Washing / Wood Cleaning
const POWER_WASH_DESC =
  "Our wood restoration process begins by applying a dedicated wood cleaner and " +
  "power washing the surface to effectively remove dirt, grime, and built-up residue. " +
  "When needed, we follow with a wood brightener to revive the wood's natural color and " +
  "vibrancy. The cost of these cleaning materials is included in the Materials section.";
const POWER_WASH_DISCLAIMER =
  "*Power washing may uncover additional rot not detected during the initial estimate. " +
  "Any additional replacement required is not included in this quote, as it will be " +
  "assessed separately upon discovery.";

// §3 Sanding / Surface Preparation — name + description vary by sanding_condition.
const SANDING_COPY = {
  never_finished: {
    name: "Light Sanding",
    description:
      "A light sanding to smooth out surface imperfections and remove roughness from the " +
      "wood's texture, creating a clean, even base for the final application.",
  },
  standard: { // oil_before, latex_before
    name: "Standard Sanding / Surface Preparation",
    description:
      "Our surface preparation includes a complete sanding of the deck in preparation for the " +
      "final application, ensuring optimal adhesion and a smooth, uniform finish. This includes " +
      "power sanding of all horizontal surfaces for thorough, consistent results.\n" +
      "- Light sanding of accessible vertical surfaces is performed as needed, at the technician's " +
      "discretion based on accessibility and the specific requirements of the project.\n" +
      "- Any loose nails, screws, or bolts discovered during the work are tightened and secured to " +
      "maintain the stability and safety of the deck surface. This inspection focuses on critical, " +
      "accessible areas to uphold structural integrity and does not cover every piece of hardware on the deck.\n\n" +
      "Note: Please note that this process will not completely remove existing coatings. Alternative " +
      "methods such as chemical stripping or sanding to bare wood are available upon request; however, " +
      "even with these methods, complete removal of previous coatings cannot be guaranteed. We provide " +
      "the most effective solutions available, but absolute removal is not assured.",
  },
  stain_removal: {
    name: "Sanding to Bare Wood / Complete Stain Removal",
    description:
      "This service involves an aggressive sanding to remove the existing coating and bring the wood " +
      "back to a bare surface, creating the ideal foundation for the new finish and maximizing adhesion. " +
      "We power sand all horizontal surfaces for thorough, consistent results, and lightly sand accessible " +
      "vertical surfaces as needed, at the technician's discretion based on accessibility and project requirements.\n" +
      "- Any loose nails, screws, or bolts discovered during the work are tightened and secured to maintain " +
      "the stability and safety of the deck surface. This inspection focuses on critical, accessible areas " +
      "and does not cover every piece of hardware on the deck.\n\n" +
      "Note: Please note that while this process is intended to return the wood to a bare surface, complete " +
      "removal of all existing coatings cannot be guaranteed. Aged stains, deep penetration, and weathering " +
      "may leave residual coating or discoloration in some areas. We use the most effective methods available " +
      "to achieve the best possible result, but absolute removal is not assured.",
  },
};
function sandingCopyFor(cond) {
  if (cond === "never_finished") return SANDING_COPY.never_finished;
  if (cond === "oil_before" || cond === "latex_before") return SANDING_COPY.standard;
  if (cond === "stain_removal") return SANDING_COPY.stain_removal;
  return null;
}

// §4 Staining / Sealing — per-product intro + shared caveats (appended to all).
const STAIN_CAVEATS =
  "- Please note that variations in color and sheen may occur.\n" +
  "- Knots and areas of hard grain may remain lighter or whiter after application.\n" +
  "- New board installations may show color variations relative to the existing decking due to " +
  "differences in age and condition. We strive for a consistent appearance, but natural variation may occur.";
// Customer-supplied product: legal disclaimer (replaces the standard caveats).
const CUSTOMER_STAIN_DISCLAIMER =
  "We do not guarantee the product, how long it will last, or the final look of the deck or the color " +
  "of the product. We will apply the product following all manufacturer recommendations. All warranty " +
  "claims should be directed to the manufacturer of the product.";
const STAIN_COPY = {
  rymar_oil_seal: {
    name: "Application of Sealer — Oil-Based Semi-Transparent Rymar Xtreme Weather Sealer",
    intro: "Our service includes the application of one coat of oil-based semi-transparent Rymar " +
      "Xtreme Weather Sealer, in a color selected by the customer.",
  },
  bm_solid: {
    name: "Application of Stain — Benjamin Moore Solid WoodLuxe",
    intro: "This service involves applying one coat of Benjamin Moore Solid WoodLuxe stain, in a " +
      "color selected by the client.",
    notes: [
      "Please note that the project is limited to one color selection.",
      "For white or light colors, an additional coat may be required to achieve the desired result. " +
      "This additional coat can be provided for an extra charge covering both labor and materials.",
    ],
  },
  ipe_oil: {
    name: "Application of Deck-Wise IPE Oil",
    intro:
      "Our service involves applying one coat of Deck-Wise Ipe oil-based sealer to your deck, privacy " +
      "fence, and other surfaces noted in the Scope of Work. This premium sealer is specifically designed " +
      "for exotic hardwoods.\n\n" +
      "Trans-oxide pigments protect against UV damage and preserve the natural beauty of exterior hardwoods " +
      "with minimal raising of the grain. Ipe Oil protects, nourishes, and conditions the wood from within " +
      "while maintaining a completely natural appearance.\n\n" +
      "Due to the nature of exotic wood, annual maintenance is required to maintain the finished appearance. " +
      "When included as part of a yearly hardwood maintenance program, Deck-Wise formulas provide proven " +
      "wood-nurturing benefits and visible results — offering exceptional protection against splits, warping, " +
      "and cracking, while helping prevent the graying of hardwoods.",
  },
  // customer_oil, customer_acrylic — wording pending.
};

// §5 Repair / Replacement — standard footers (always appended to the write-up).
const REPAIRS_FOOTER_HARDWARE =
  "*As part of our service, all discovered loose nails, screws, and bolts will be tightened and " +
  "secured (as reasonably possible) to help ensure the stability and safety of the immediate deck " +
  "surface. Please note that this inspection does not cover all hardware on the deck; it focuses on " +
  "critical, accessible areas to uphold structural integrity.";
const REPAIRS_FOOTER_MORE =
  "**Given the current condition of the deck and the number of repairs, it is likely that additional " +
  "repairs will be discovered during the removal process. All discovered repairs will be brought to " +
  "the client's attention before any extra work begins. Any additional carpentry will require " +
  "additional labor and materials, available at an added charge.";
const REPAIRS_MATERIALS_NOTE = "The cost of materials is included in the Materials section.";

// §6 Materials & Supplies — standard language on every estimate (price is the total).
const MATERIALS_DESC =
  "This section covers all necessary supplies required to complete the project efficiently, including " +
  "the cost of stain or sealant as well as any additional items such as lumber, screws, fasteners, " +
  "cleaning and prep products, brushes, and other essential supplies needed for the project.";

// Terms and Conditions — standard $0 line, always last on the estimate.
const TERMS_DESC =
  "This estimate is valid for 30 days. A 30% deposit is required to approve the estimate, reserve " +
  "scheduling, and begin project preparation. The remaining balance is due upon substantial completion " +
  "unless otherwise stated.\n\n" +
  "This estimate includes only the work listed. Additional work, hidden damage, wood rot, repairs, extra " +
  "preparation, product changes, or customer-requested changes may result in additional charges.\n\n" +
  "Scheduling and completion are weather-dependent and may change due to rain, temperature, humidity, wood " +
  "moisture, material availability, or unsafe/unforeseen conditions.\n\n" +
  "Customer is responsible for approving the final color/product, providing access, removing personal items " +
  "from the work area, and securing doors, windows, vents, and other openings before work begins.\n\n" +
  "By electronically accepting this estimate and/or paying the deposit, Customer agrees to the estimate, " +
  "payment terms, scope of work, and the Full Terms and Conditions below.";
// Appended to the T&C line when the tech marks the Workmanship Warranty (§20) as N/A.
const WARRANTY_WAIVED_APPEND =
  "Workmanship Warranty Exclusion: This project includes work and/or materials the customer has requested " +
  "that we cannot guarantee. As a result, Section 20 (Workmanship Warranty) of our Full Terms and Conditions " +
  "does not apply to this project. By accepting this quote, the customer acknowledges and understands that " +
  "no workmanship warranty is provided for this work.";

// Fallback repairs write-up body when the tech didn't enter one.
function repairsFallbackBody(breakdown) {
  const items = (breakdown.repairs && breakdown.repairs.items) || [];
  const lines = items
    .filter(i => (Number(i.cost) || 0) > 0 || i.flagged)
    .map(i => "- " + (i.item_label || i.item_id) + (i.qty > 1 ? ` (Qty ${i.qty})` : ""));
  return lines.length ? "Scope of Repair/Replacement:\n" + lines.join("\n") : "";
}

// Build HCP line items (prices in cents) from our computed breakdown. Mirrors the
// sections shown on the estimate view so the HCP estimate total matches the app:
// Cleaning, Sanding, Staining, Repairs, Materials, Extras, then a Discount line.
export function buildLineItems(record, breakdown) {
  const items = [];
  const cents = (d) => Math.round((Number(d) || 0) * 100);
  const b = breakdown || {};
  const push = (name, dollars, { description, kind = "labor", taxable = false } = {}) => {
    if (!(Number(dollars) > 0)) return;
    items.push({ name, description: description || undefined, unit_price: cents(dollars), quantity: 1, kind, taxable });
  };

  // §1 Scope of Work — descriptive, no price (always first when present).
  if (record.scope_description && record.scope_description.trim()) {
    const title = (record.scope_title || "").trim();
    items.push({
      name: title ? `Scope of Work: ${title}` : "Scope of Work",
      description: record.scope_description.trim(),
      unit_price: 0, quantity: 1, kind: "labor", taxable: false,
    });
  }

  // §2 Power Washing / Wood Cleaning (cleaning labor; materials shown separately)
  if (b.cleaning && b.cleaning.total > 0) {
    push("Power Washing / Wood Cleaning", b.cleaning.total, {
      description: POWER_WASH_DESC + "\n\n" + POWER_WASH_DISCLAIMER,
    });
  }

  // §3 Sanding / Surface Preparation (sanding labor; supply shown in Materials)
  if (b.sanding && b.sanding.total > 0) {
    const copy = sandingCopyFor(record.sanding_condition);
    if (copy) push(copy.name, b.sanding.total, { description: copy.description });
    else push("Sanding / Surface Preparation", b.sanding.total);
  }

  // §4 Staining / Sealing (staining labor; stain product in Materials)
  if (b.staining && b.staining.total > 0) {
    const proc = record.stain_process;
    if (proc === "customer_oil" || proc === "customer_acrylic") {
      // Customer-supplied product: name product from the Custom Product Description.
      const kind = proc === "customer_acrylic" ? "Acrylic" : "Oil-Based";
      const prod = (record.stain_custom_desc || "").trim();
      const name = `Application of Customer-Supplied ${kind} Stain / Sealer`;
      const desc = `Deck staining will be performed using the customer-supplied ${kind.toLowerCase()} ` +
        `stain/sealer` + (prod ? ` (${prod})` : "") + `.\n\n${CUSTOMER_STAIN_DISCLAIMER}`;
      push(name, b.staining.total, { description: desc });
    } else {
      const copy = STAIN_COPY[proc];
      const procLbl = (STAIN_PROCESSES[proc] || {}).label || "";
      const name = copy ? copy.name : (procLbl ? `Staining / Sealing — ${procLbl}` : "Staining / Sealing");
      let desc;
      if (copy) {
        const noteLines = (copy.notes || []).map(n => "- " + n).join("\n");
        desc = [copy.intro, noteLines, STAIN_CAVEATS].filter(Boolean).join("\n");
      } else {
        desc = STAIN_CAVEATS;
      }
      push(name, b.staining.total, { description: desc });
    }
  }

  // §5 Repair / Replacement (labor + debris; materials shown in Materials section)
  if (b.repairs && b.repairs.total > 0) {
    const body = (record.repairs_description || "").trim() || repairsFallbackBody(b);
    const desc = [body, REPAIRS_FOOTER_HARDWARE, REPAIRS_FOOTER_MORE, REPAIRS_MATERIALS_NOTE]
      .filter(Boolean).join("\n\n");
    push("Repair / Replacement", b.repairs.total, { description: desc });
  }

  // §6 Materials & Supplies (stain product + supplies + repair materials; standard copy)
  if (b.materials && b.materials.total > 0) {
    push("Materials and Supplies", b.materials.total, { description: MATERIALS_DESC });
  }

  // Extra services (one line each)
  for (const x of b.extras_list || []) {
    if (x && Number(x.price) > 0) push(x.description || "Extra service", x.price);
  }

  // Discount (negative line)
  if (b.discount > 0) {
    const name = b.discount_label ? `Discount — ${b.discount_label}` : "Discount";
    items.push({ name, unit_price: -cents(b.discount), quantity: 1, kind: "discount", taxable: false });
  }

  // Terms and Conditions — always the last line ($0). Warranty exclusion appended when waived.
  const termsDesc = record.warranty_waived ? (TERMS_DESC + "\n\n" + WARRANTY_WAIVED_APPEND) : TERMS_DESC;
  items.push({
    name: "Terms and Conditions",
    description: termsDesc,
    unit_price: 0, quantity: 1, kind: "labor", taxable: false,
  });

  return items;
}

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ""; }
function label(s) { return (s || "").replace(/_/g, " "); }

// Resolve the customer's first address id (HCP ties an estimate to an address).
async function firstAddressId(customerId) {
  try {
    const cust = await hcpRequest(`/customers/${customerId}`);
    const addrs = (cust && Array.isArray(cust.addresses)) ? cust.addresses
      : (cust && cust.customer && Array.isArray(cust.customer.addresses)) ? cust.customer.addresses : [];
    return addrs.length ? pickId(addrs[0], "id", "uuid") : null;
  } catch (_) {
    return null;
  }
}

// Walk-up estimates are scheduled for "today" with a default arrival window.
function todayScheduleUTC(windowMinutes = 120) {
  const start = new Date();
  const end = new Date(start.getTime() + windowMinutes * 60 * 1000);
  return { scheduled_start: start.toISOString(), scheduled_end: end.toISOString(), arrival_window: windowMinutes };
}

// Human-readable note summarizing the app estimate (shown on the HCP estimate).
function buildNote(record, breakdown) {
  const structLbl = (STRUCTURE_TYPES[record.structure_type] || {}).label || cap(record.structure_type);
  const woodLbl = (WOOD_TYPES[record.wood_type] || {}).label || label(record.wood_type);
  return [
    `Deck Expert Estimator #${record.id} — ${structLbl}${woodLbl ? `, ${woodLbl}` : ""}.`,
    record.repairs_notes ? `Repair notes: ${record.repairs_notes}` : null,
    breakdown && breakdown.total != null ? `App total: $${Number(breakdown.total).toFixed(2)}.` : null,
  ].filter(Boolean).join(" ");
}

// Fetch an estimate by id, or null if it no longer exists in HCP.
async function getEstimate(estimateId) {
  try {
    return await hcpRequest(`/estimates/${estimateId}`);
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

// Has any option already been approved? (We don't overwrite approved estimates.)
function isApproved(est) {
  const opts = Array.isArray(est && est.options) ? est.options : [];
  return opts.some(o => (o.approval_status || "").toString().toLowerCase() === "approved");
}

const optLineItemsPath = (estId, optId) => `/estimates/${estId}/options/${optId}/line_items`;

// Overwrite an option's line items. HCP has no single-item create for estimate
// line items — it uses a bulk update on the collection (like jobs): items without
// a uuid are created, so sending our full list replaces the option's line items.
async function replaceLineItems(estimateId, optionId, lineItems) {
  const path = optLineItemsPath(estimateId, optionId);
  const body = { line_items: lineItems };
  try {
    await hcpRequest(path, { method: "PUT", body });
  } catch (e) {
    // Fall back to PATCH if PUT isn't the accepted method for the collection.
    if (e.status === 404 || e.status === 405) {
      await hcpRequest(path, { method: "PATCH", body });
    } else {
      throw e;
    }
  }
}

// Update a linked HCP estimate in place: overwrite the main option's line items
// and refresh the note. Schedule, appointment, and assigned tech are untouched.
async function updateEstimateInPlace(est, record, breakdown) {
  const opts = Array.isArray(est.options) ? est.options : [];
  const mainOpt = opts[0];
  if (!mainOpt) throw new Error("Linked HCP estimate has no option to update");
  const optId = pickId(mainOpt, "id", "uuid");
  await replaceLineItems(est.id, optId, buildLineItems(record, breakdown));
  // Refresh the estimate note (best-effort — non-fatal if the field isn't writable).
  try { await hcpRequest(`/estimates/${est.id}`, { method: "PATCH", body: { note: buildNote(record, breakdown) } }); } catch (_) {}
  return pickId(est.customer || {}, "id", "uuid");
}

// Create an estimate in HCP for a customer. HCP estimates are multi-option, so
// line items live under an option (options[].line_items), not at the top level.
// opts.employeeId assigns the tech; opts.schedule (default true) puts it on today.
// Returns the estimate id.
export async function createEstimate(customerId, addressId, record, breakdown, opts = {}) {
  const note = buildNote(record, breakdown);

  const payload = {
    customer_id: customerId,
    options: [{
      name: "Option #1",
      message_from_pro: note,
      line_items: buildLineItems(record, breakdown),
    }],
    note,
  };
  if (addressId) payload.address_id = addressId;
  if (opts.employeeId) payload.assigned_employee_ids = [opts.employeeId];
  if (opts.schedule !== false) payload.schedule = todayScheduleUTC(opts.windowMinutes || 120);

  const created = await hcpRequest("/estimates", { method: "POST", body: payload });
  const id = pickId(created, "id", "uuid") || pickId(created?.estimate || {}, "id", "uuid");
  if (!id) throw new Error("HCP estimate created but no id was returned");
  return id;
}

// Orchestrates the full push. When the app estimate was prefilled from an
// existing HCP estimate (source_hcp_estimate_id) that still exists, we overwrite
// it in place; otherwise we create a new scheduled+assigned estimate (walk-up).
export async function sendEstimateToHcp(record, breakdown, opts = {}) {
  const employeeId = opts.employeeId || null;
  const sourceId = (record.source_hcp_estimate_id || "").toString().trim() || null;

  // Update path: prefilled from an existing HCP estimate that's still there and
  // not yet approved → overwrite it in place (schedule/appointment/tech kept).
  if (sourceId) {
    const est = await getEstimate(sourceId);
    if (est && !isApproved(est)) {
      const customerId = await updateEstimateInPlace(est, record, breakdown);
      return { customerId, estimateId: sourceId, mode: "updated" };
    }
    // Missing (deleted in HCP) or already approved → fall through to create new.
  }

  // Create path: walk-up (or source gone) → new estimate scheduled today + assigned.
  const customerId = await upsertCustomer({
    name: record.customer_name,
    email: record.customer_email,
    phone: record.customer_phone,
    address: record.customer_address,
  });
  const addressId = await firstAddressId(customerId);
  const estimateId = await createEstimate(customerId, addressId, record, breakdown, { employeeId });
  return { customerId, estimateId, mode: "created" };
}
