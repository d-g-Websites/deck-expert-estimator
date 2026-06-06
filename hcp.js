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

const API_BASE = process.env.HCP_API_BASE || "https://api.housecallpro.com/v1";
// HCP API keys authenticate with "Token <key>". Some integrations use "Bearer".
// Override with HCP_AUTH_SCHEME=Bearer if your key requires it.
const AUTH_SCHEME = process.env.HCP_AUTH_SCHEME || "Token";

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

// Build HCP line items (prices in cents) from our computed breakdown.
function buildLineItems(record, breakdown) {
  const items = [];
  const cents = (d) => Math.round((Number(d) || 0) * 100);

  if (breakdown.surface > 0) {
    items.push({
      name: `${cap(record.service_type)} — ${cap(record.structure_type)} surface`,
      description: `${record.surface_sqft} sq ft of ${label(record.wood_type)}, ${label(record.opacity)}`,
      unit_price: cents(breakdown.surface),
      quantity: 1,
      kind: "labor",
      taxable: false,
    });
  }
  if (breakdown.railing > 0) {
    items.push({ name: "Railing", unit_price: cents(breakdown.railing), quantity: 1, kind: "labor", taxable: false });
  }
  if (breakdown.stairs > 0) {
    items.push({ name: `Stairs (${record.stairs_count} steps)`, unit_price: cents(breakdown.stairs), quantity: 1, kind: "labor", taxable: false });
  }
  for (const x of breakdown.extras_list || []) {
    items.push({ name: x.description, unit_price: cents(x.price), quantity: 1, kind: "labor", taxable: false });
  }
  if (breakdown.discount > 0) {
    items.push({ name: "Discount", unit_price: -cents(breakdown.discount), quantity: 1, kind: "discount", taxable: false });
  }
  return items;
}

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ""; }
function label(s) { return (s || "").replace(/_/g, " "); }

// Create an estimate in HCP for a customer. Returns the estimate id.
export async function createEstimate(customerId, record, breakdown) {
  const payload = {
    customer_id: customerId,
    line_items: buildLineItems(record, breakdown),
    note: `Estimate #${record.id} — ${cap(record.structure_type)} ${record.service_type} (${label(record.wood_type)}). Generated by Deck Expert Estimator.`,
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
