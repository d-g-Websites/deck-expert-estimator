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

import { STAIN_PROCESSES, SANDING_CONDITIONS, WOOD_TYPES, STRUCTURE_TYPES } from "./pricing.js";

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

// Pull estimates scheduled in HCP for today (Chicago time), with customer
// contact info resolved, so a rep can tap one to prefill a new estimate.
export async function scheduledToday() {
  const { start, end, ymd } = centralDayBoundsUTC();
  const qs = `scheduled_start_min=${encodeURIComponent(start)}&scheduled_start_max=${encodeURIComponent(end)}&per_page=100`;
  const data = await hcpRequest(`/estimates?${qs}`);
  const estimates = hcpListFromResponse(data, "estimates");
  const customerCache = new Map();
  const out = [];
  for (const est of estimates) {
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

  // Cleaning / power washing
  if (b.cleaning && b.cleaning.total > 0) {
    const sqft = record.surface_sqft ? `${record.surface_sqft} sq ft` : null;
    const desc = [sqft, record.has_railing ? "incl. railing" : null].filter(Boolean).join(", ");
    push("Power washing / cleaning", b.cleaning.total, { description: desc || undefined });
  }

  // Sanding / prep
  if (b.sanding && b.sanding.total > 0) {
    const lbl = (SANDING_CONDITIONS[record.sanding_condition] || {}).label || b.sanding.label || "";
    push(lbl ? `Sanding / prep — ${lbl}` : "Sanding / prep", b.sanding.total);
  }

  // Staining / sealing
  if (b.staining && b.staining.total > 0) {
    const lbl = (STAIN_PROCESSES[record.stain_process] || {}).label || "";
    const desc = (record.stain_color || record.stain_custom_desc || "") || undefined;
    push(lbl ? `Staining / sealing — ${lbl}` : "Staining / sealing", b.staining.total, { description: desc });
  }

  // Repairs / replacement
  if (b.repairs && b.repairs.total > 0) {
    const lines = (b.repairs.items || [])
      .filter(i => (Number(i.cost) || 0) > 0)
      .map(i => (i.qty > 1 ? `${i.qty}× ` : "") + (i.item_label || i.item_id));
    push("Repairs / replacement", b.repairs.total, { description: lines.join("; ") || undefined });
  }

  // Materials & supplies
  if (b.materials && b.materials.total > 0) {
    const desc = (b.materials.items || []).map(i => i.label).filter(Boolean).join("; ");
    push("Materials & supplies", b.materials.total, { description: desc || undefined });
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

  return items;
}

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ""; }
function label(s) { return (s || "").replace(/_/g, " "); }

// Create an estimate in HCP for a customer. Returns the estimate id.
export async function createEstimate(customerId, record, breakdown) {
  const structLbl = (STRUCTURE_TYPES[record.structure_type] || {}).label || cap(record.structure_type);
  const woodLbl = (WOOD_TYPES[record.wood_type] || {}).label || label(record.wood_type);
  const noteParts = [
    `Deck Expert Estimator #${record.id} — ${structLbl}${woodLbl ? `, ${woodLbl}` : ""}.`,
    record.repairs_notes ? `Repair notes: ${record.repairs_notes}` : null,
    breakdown && breakdown.total != null ? `App total: $${Number(breakdown.total).toFixed(2)}.` : null,
  ].filter(Boolean);
  const payload = {
    customer_id: customerId,
    line_items: buildLineItems(record, breakdown),
    note: noteParts.join(" "),
  };
  const created = await hcpRequest("/estimates", { method: "POST", body: payload });
  const id = pickId(created, "id", "uuid") || pickId(created?.estimate || {}, "id", "uuid");
  if (!id) throw new Error("HCP estimate created but no id was returned");
  return id;
}

// Orchestrates the full push: customer then estimate.
export async function sendEstimateToHcp(record, breakdown) {
  const customerId = await upsertCustomer({
    name: record.customer_name,
    email: record.customer_email,
    phone: record.customer_phone,
    address: record.customer_address,
  });
  const estimateId = await createEstimate(customerId, record, breakdown);
  return { customerId, estimateId };
}
