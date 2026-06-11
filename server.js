import express from "express";
import session from "express-session";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { db } from "./db.js";
import {
  STRUCTURE_TYPES, WOOD_TYPES, DECK_LOCATIONS, PRIOR_FINISHES, DECK_STRUCTURES,
  PERGOLA_GAZEBO_SIZES, SANDING_CONDITIONS, CLEANING_PRICING, MATERIALS_PRICING,
  STAINING_PRICING, STAIN_PROCESSES, REPAIR_ITEMS, REPAIR_MATERIALS, LUMBER, computeDeckEstimate,
} from "./pricing.js";
import { SWATCHES, listSwatches, renderFinish, visualizerEnabled } from "./render.js";
import { sendEstimateToHcp, hcpEnabled, hcpTest, scheduledToday } from "./hcp.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOADS_DIR = path.join(__dirname, "uploads");
await fs.mkdir(UPLOADS_DIR, { recursive: true });

if (!process.env.APP_PASSWORD)   { console.error("Missing APP_PASSWORD"); process.exit(1); }
if (!process.env.SESSION_SECRET) { console.error("Missing SESSION_SECRET"); process.exit(1); }

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 1000 * 60 * 60 * 12 },
  name: "dee.sid",
}));
app.use(express.json({ limit: "100kb" }));

const renderUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const estimateUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Not authenticated" });
  return res.redirect("/login?next=" + encodeURIComponent(req.originalUrl));
}

// ---- Public assets (CSS) and health ----
app.use("/static", express.static(path.join(PUBLIC_DIR, "static")));
app.get("/health", (req, res) => res.json({ status: "healthy" }));

// ---- Auth ----
app.get("/login", (req, res) => {
  if (req.session && req.session.authenticated) return res.redirect("/");
  res.sendFile(path.join(PUBLIC_DIR, "login.html"));
});
app.post("/login", express.urlencoded({ extended: false }), (req, res) => {
  if (req.body.password && req.body.password === process.env.APP_PASSWORD) {
    req.session.authenticated = true;
    return res.redirect(req.query.next || "/");
  }
  res.redirect("/login?error=1");
});
app.post("/logout", (req, res) => req.session.destroy(() => res.redirect("/login")));

// ---- Gated static (customer photos + swatch reference images) ----
app.use("/uploads", requireAuth, express.static(UPLOADS_DIR));
app.use("/swatches", requireAuth, express.static(path.join(PUBLIC_DIR, "swatches")));

// ---- Pages ----
app.get("/", requireAuth, (req, res) => res.sendFile(path.join(PUBLIC_DIR, "home.html")));
app.get("/visualizer", requireAuth, (req, res) => res.sendFile(path.join(PUBLIC_DIR, "visualizer.html")));
app.get("/estimate/new", requireAuth, (req, res) => res.sendFile(path.join(PUBLIC_DIR, "estimate-structure.html")));
app.get("/estimate/new/deck", requireAuth, (req, res) => res.sendFile(path.join(PUBLIC_DIR, "new-estimate-deck.html")));
app.get("/estimate/new/:structure", requireAuth, (req, res) => res.sendFile(path.join(PUBLIC_DIR, "coming-soon.html")));
app.get("/estimate/:id", requireAuth, (req, res) => res.sendFile(path.join(PUBLIC_DIR, "estimate-view.html")));

// ---- Config / options for the UI ----
app.get("/api/config", requireAuth, (req, res) => {
  res.json({
    structures: STRUCTURE_TYPES,
    visualizer_enabled: visualizerEnabled(),
    hcp_enabled: hcpEnabled(),
  });
});

app.get("/api/pricing/deck", requireAuth, (req, res) => {
  res.json({
    wood_types: WOOD_TYPES,
    deck_locations: DECK_LOCATIONS,
    prior_finishes: PRIOR_FINISHES,
    structures: DECK_STRUCTURES,
    pergola_gazebo_sizes: PERGOLA_GAZEBO_SIZES,
    sanding_conditions: SANDING_CONDITIONS,
    cleaning_pricing: CLEANING_PRICING,
    materials_pricing: MATERIALS_PRICING,
    staining_pricing: STAINING_PRICING,
    stain_processes: STAIN_PROCESSES,
    repair_items: REPAIR_ITEMS,
    lumber: LUMBER,
  });
});

app.get("/api/swatches", requireAuth, async (req, res) => {
  try {
    res.json({ brands: await listSwatches() });
  } catch (err) {
    console.error("[swatches] error:", err);
    res.status(500).json({ error: err.message || "Failed to list swatches" });
  }
});

// ---- Housecall Pro: connectivity test + today's scheduled appointments ----
app.get("/api/hcp/test", requireAuth, async (req, res) => {
  if (!hcpEnabled()) return res.status(503).json({ error: "Housecall Pro not configured" });
  try { res.json(await hcpTest()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/hcp/scheduled-today", requireAuth, async (req, res) => {
  try {
    if (!hcpEnabled()) return res.status(503).json({ error: "Housecall Pro not configured" });
    const result = await scheduledToday();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[scheduled-today] error:", err.message);
    res.status(500).json({ error: err.message || "Failed to fetch scheduled estimates" });
  }
});

// ---- AI render ----
app.post("/api/render", requireAuth, renderUpload.single("photo"), async (req, res) => {
  try {
    if (!visualizerEnabled()) return res.status(503).json({ error: "Visualizer not configured" });
    const { swatch_id } = req.body;
    if (!req.file) return res.status(400).json({ error: "No photo uploaded" });
    if (!swatch_id || !SWATCHES[swatch_id]) return res.status(400).json({ error: "Unknown swatch_id" });
    console.log(`[render] swatch=${swatch_id} size=${req.file.size}b`);
    const b64 = await renderFinish(req.file.buffer, swatch_id);
    res.json({ ok: true, swatch_id, image_base64: b64 });
  } catch (err) {
    console.error("[render] error:", err);
    res.status(500).json({ error: err.message || "Render failed" });
  }
});

// ---- Estimates: list ----
app.get("/api/estimates", requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT id, created_at, customer_name, structure_type, wood_type,
           surface_sqft, pricing_snapshot, status
    FROM estimates ORDER BY datetime(created_at) DESC LIMIT 100
  `).all();
  res.json(rows.map(r => {
    let total = 0;
    try { total = JSON.parse(r.pricing_snapshot || "{}").total || 0; } catch (_) {}
    const photoCount = db.prepare("SELECT COUNT(*) AS c FROM estimate_photos WHERE estimate_id = ?").get(r.id).c;
    return {
      id: r.id, created_at: r.created_at, customer_name: r.customer_name,
      structure_type: r.structure_type, wood_type: r.wood_type,
      surface_sqft: r.surface_sqft, status: r.status, total, photo_count: photoCount,
    };
  }));
});

// ---- Estimates: detail ----
app.get("/api/estimate/:id", requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  const row = db.prepare("SELECT * FROM estimates WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Not found" });
  const photos = db.prepare("SELECT id, filename, kind, swatch_id, is_design FROM estimate_photos WHERE estimate_id = ? ORDER BY id ASC").all(id);
  let breakdown = {};
  try { breakdown = JSON.parse(row.pricing_snapshot || "{}"); } catch (_) {}
  res.json({
    id: row.id, created_at: row.created_at, updated_at: row.updated_at, status: row.status,
    customer: { name: row.customer_name, phone: row.customer_phone, email: row.customer_email, address: row.customer_address },
    structure_type: row.structure_type,
    project: (() => {
      let structures = [];
      try { structures = JSON.parse(row.structures || "[]"); } catch (_) {}
      return {
        wood_type: row.wood_type,
        deck_location: row.deck_location,
        multilevel_levels: row.multilevel_levels,
        surface_sqft: row.surface_sqft,
        steps_included: !!row.steps_included,
        has_railing: !!row.has_railing,
        has_metal_spindles: !!row.has_metal_spindles,
        railing_lf: row.railing_lf,
        stairs_count: row.stairs_count,
        structures,
        structures_other: row.structures_other,
        prior_finish: row.prior_finish,
        cleaning_enabled: !!row.cleaning_enabled,
        chicago_surcharge: !!row.chicago_surcharge,
        light_clean: !!row.light_clean,
        pergola_gazebo_size: row.pergola_gazebo_size,
        sanding_condition: row.sanding_condition,
        vertical_sanding: !!row.vertical_sanding,
        vertical_length: row.vertical_length,
        vertical_height: row.vertical_height,
        staining_enabled: !!row.staining_enabled,
        stain_process: row.stain_process,
        stain_color: row.stain_color,
        stain_custom_desc: row.stain_custom_desc,
        stain_customer_supplied: !!row.stain_customer_supplied,
        stain_vertical_sqft: row.stain_vertical_sqft,
        repairs_notes: row.repairs_notes,
      };
    })(),
    labels: {
      wood: (WOOD_TYPES[row.wood_type] || {}).label,
      deck_location: (DECK_LOCATIONS[row.deck_location] || {}).label,
      prior_finish: (PRIOR_FINISHES[row.prior_finish] || {}).label,
      pergola_gazebo_size: (PERGOLA_GAZEBO_SIZES[row.pergola_gazebo_size] || {}).label,
      sanding: (SANDING_CONDITIONS[row.sanding_condition] || {}).label,
      stain_process: (STAIN_PROCESSES[row.stain_process] || {}).label,
      structures: (() => {
        let s = [];
        try { s = JSON.parse(row.structures || "[]"); } catch (_) {}
        return s.map(id => (DECK_STRUCTURES[id] || {}).label || id);
      })(),
    },
    breakdown,
    hcp: { customer_id: row.hcp_customer_id, estimate_id: row.hcp_estimate_id, synced_at: row.hcp_synced_at, enabled: hcpEnabled() },
    photos: photos.map(p => ({
      id: p.id, filename: p.filename, kind: p.kind, swatch_id: p.swatch_id,
      swatch_name: p.swatch_id ? (SWATCHES[p.swatch_id] ? `${SWATCHES[p.swatch_id].brand_name} ${SWATCHES[p.swatch_id].name}` : p.swatch_id) : null,
      is_design: !!p.is_design, url: `/uploads/${row.id}/${p.filename}`,
    })),
  });
});

// ---- Estimates: delete ----
app.delete("/api/estimate/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const row = db.prepare("SELECT id FROM estimates WHERE id = ?").get(id);
    if (!row) return res.status(404).json({ error: "Not found" });
    db.prepare("DELETE FROM estimates WHERE id = ?").run(id);
    await fs.rm(path.join(UPLOADS_DIR, String(id)), { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err) {
    console.error("[estimate] delete error:", err);
    res.status(500).json({ error: err.message || "Failed to delete" });
  }
});

// ---- Estimates: create (deck) ----
app.post("/api/estimate", requireAuth, estimateUpload.fields([
  { name: "photos", maxCount: 10 },
  { name: "rendered_image", maxCount: 1 },
]), async (req, res) => {
  try {
    const b = req.body || {};
    const structure_type = (b.structure_type || "").trim();
    if (structure_type !== "deck") return res.status(400).json({ error: "Only deck estimates are supported right now" });

    const customer_name = (b.customer_name || "").trim();
    const customer_phone = (b.customer_phone || "").trim() || null;
    const customer_email = (b.customer_email || "").trim() || null;
    const customer_address = (b.customer_address || "").trim() || null;

    const wood_type = (b.wood_type || "").trim();
    const deck_location = (b.deck_location || "").trim() || null;
    const prior_finish = (b.prior_finish || "").trim() || null;
    const multilevel_levels = b.multilevel_levels ? parseInt(b.multilevel_levels, 10) : 0;
    const steps_included = b.steps_included ? 1 : 0;
    const has_railing = b.has_railing ? 1 : 0;
    const has_metal_spindles = b.has_metal_spindles ? 1 : 0;
    const surface_sqft = parseFloat(b.surface_sqft);
    const railing_lf = b.railing_lf ? parseFloat(b.railing_lf) : 0;
    const stairs_count = b.stairs_count ? parseInt(b.stairs_count, 10) : 0;
    const discount = b.discount ? parseFloat(b.discount) : 0;
    const source_hcp_estimate_id = (b.source_hcp_estimate_id || "").trim() || null;
    const structures_other = (b.structures_other || "").trim() || null;
    // Cleaning inputs
    const cleaning_enabled = b.cleaning_enabled ? 1 : 0;
    const chicago_surcharge = b.chicago_surcharge ? 1 : 0;
    const light_clean = b.light_clean ? 1 : 0;
    const pergola_gazebo_size = (b.pergola_gazebo_size || "").trim() || null;
    // Sanding inputs
    const sanding_condition = (b.sanding_condition || "").trim() || null;
    const vertical_sanding = b.vertical_sanding ? 1 : 0;
    const vertical_length = b.vertical_length ? parseFloat(b.vertical_length) : 0;
    const vertical_height = b.vertical_height ? parseFloat(b.vertical_height) : 0;
    // Staining / sealing inputs
    const staining_enabled = b.staining_enabled ? 1 : 0;
    const stain_process = (b.stain_process || "").trim() || null;
    const stain_color = (b.stain_color || "").trim() || null;
    const stain_custom_desc = (b.stain_custom_desc || "").trim() || null;
    const stain_customer_supplied = b.stain_customer_supplied ? 1 : 0;
    const stain_vertical_sqft = b.stain_vertical_sqft ? parseFloat(b.stain_vertical_sqft) : 0;
    // Discreet per-section adjustment multipliers (internal)
    const cleaning_multiplier = b.cleaning_multiplier ? parseFloat(b.cleaning_multiplier) : 1;
    const sanding_multiplier = b.sanding_multiplier ? parseFloat(b.sanding_multiplier) : 1;
    const staining_multiplier = b.staining_multiplier ? parseFloat(b.staining_multiplier) : 1;
    // Repairs / replacement
    let repairsIn = [];
    try { repairsIn = b.repairs ? JSON.parse(b.repairs) : []; } catch (_) { repairsIn = []; }
    const repairs = (Array.isArray(repairsIn) ? repairsIn : [])
      .filter(r => r && REPAIR_ITEMS[r.item_id] && Array.isArray(r.lines))
      .map(r => {
        const def = REPAIR_ITEMS[r.item_id];
        const mode = def.mode || "material";
        let lines;
        if (mode === "options") {
          lines = r.lines
            .filter(ln => ln && Number(ln.qty) > 0 && def.options && def.options[ln.option])
            .map(ln => ({ option: ln.option, qty: Number(ln.qty) }));
        } else if (mode === "qty") {
          lines = r.lines
            .filter(ln => ln && Number(ln.qty) > 0)
            .map(ln => ({ qty: Number(ln.qty) }));
        } else {
          lines = r.lines
            .filter(ln => ln && Number(ln.qty) > 0 && REPAIR_MATERIALS.includes(ln.material))
            .map(ln => {
              const line = {
                material: ln.material,
                board: (LUMBER[ln.material] && LUMBER[ln.material].items[ln.board]) ? ln.board : null,
                qty: Number(ln.qty),
              };
              if (def.custom_labor) line.unit_labor = Math.max(0, parseFloat(ln.unit_labor) || 0);
              return line;
            });
        }
        const entry = { item_id: r.item_id, lines };
        if (def.toggle && r.toggled === true) entry.toggled = true;
        return entry;
      })
      .filter(r => r.lines.length > 0);
    const repairs_notes = (b.repairs_notes || "").trim() || null;
    const debris_removal = Math.max(0, parseFloat(b.debris_removal) || 0);
    let extras = [];
    try { extras = b.extra_items ? JSON.parse(b.extra_items) : []; } catch (_) { extras = []; }
    let structuresIn = [];
    try { structuresIn = b.structures ? JSON.parse(b.structures) : []; } catch (_) { structuresIn = []; }
    const structures = (Array.isArray(structuresIn) ? structuresIn : []).filter(s => DECK_STRUCTURES[s]);

    // Validation
    if (!customer_name) return res.status(400).json({ error: "Customer name is required" });
    if (!customer_phone && !customer_email) return res.status(400).json({ error: "Phone or email required" });
    if (!WOOD_TYPES[wood_type]) return res.status(400).json({ error: "Invalid wood type" });
    if (deck_location && !DECK_LOCATIONS[deck_location]) return res.status(400).json({ error: "Invalid deck location" });
    if (prior_finish && !PRIOR_FINISHES[prior_finish]) return res.status(400).json({ error: "Invalid prior finish" });
    if (pergola_gazebo_size && !PERGOLA_GAZEBO_SIZES[pergola_gazebo_size]) return res.status(400).json({ error: "Invalid pergola/gazebo size" });
    if (sanding_condition && !SANDING_CONDITIONS[sanding_condition]) return res.status(400).json({ error: "Invalid sanding condition" });
    if (stain_process && !STAIN_PROCESSES[stain_process]) return res.status(400).json({ error: "Invalid stain process" });
    if (!Number.isFinite(surface_sqft) || surface_sqft <= 0) return res.status(400).json({ error: "Invalid square footage" });
    if (!Number.isFinite(railing_lf) || railing_lf < 0) return res.status(400).json({ error: "Invalid railing length" });
    if (!Number.isFinite(stairs_count) || stairs_count < 0) return res.status(400).json({ error: "Invalid stair count" });
    if (!Number.isFinite(multilevel_levels) || multilevel_levels < 0) return res.status(400).json({ error: "Invalid level count" });
    if (!Number.isFinite(discount) || discount < 0) return res.status(400).json({ error: "Invalid discount" });

    const cleanExtras = [];
    for (const item of extras) {
      const desc = (item.description || "").trim();
      const price = parseFloat(item.price);
      if (!desc) continue;
      if (!Number.isFinite(price) || price < 0) return res.status(400).json({ error: "Invalid extra item price" });
      cleanExtras.push({ description: desc, price });
    }

    const breakdown = computeDeckEstimate({
      wood_type, deck_location, cleaning_enabled, surface_sqft, has_railing, has_metal_spindles, multilevel_levels,
      light_clean, chicago_surcharge, pergola_gazebo_size,
      sanding_condition, vertical_sanding, vertical_length, vertical_height,
      staining_enabled, stain_process, stain_customer_supplied, vertical_sqft: stain_vertical_sqft,
      cleaning_multiplier, sanding_multiplier, staining_multiplier,
      repairs, debris_removal,
      discount, extra_items: cleanExtras,
    });

    const result = db.prepare(`
      INSERT INTO estimates (
        customer_name, customer_phone, customer_email, customer_address,
        structure_type, wood_type, deck_location, multilevel_levels,
        surface_sqft, steps_included, has_railing, has_metal_spindles, railing_lf, stairs_count,
        structures, structures_other, prior_finish,
        cleaning_enabled, chicago_surcharge, light_clean, pergola_gazebo_size, cleaning_multiplier,
        sanding_condition, vertical_sanding, vertical_length, vertical_height, sanding_multiplier,
        staining_enabled, stain_process, stain_color, stain_custom_desc, stain_customer_supplied, stain_vertical_sqft, staining_multiplier,
        repairs, repairs_notes, debris_removal,
        extra_items, discount_cents, pricing_snapshot, source_hcp_estimate_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      customer_name, customer_phone, customer_email, customer_address,
      structure_type, wood_type, deck_location, multilevel_levels,
      surface_sqft, steps_included, has_railing, has_metal_spindles, railing_lf, stairs_count,
      JSON.stringify(structures), structures_other, prior_finish,
      cleaning_enabled, chicago_surcharge, light_clean, pergola_gazebo_size, cleaning_multiplier,
      sanding_condition, vertical_sanding, vertical_length, vertical_height, sanding_multiplier,
      staining_enabled, stain_process, stain_color, stain_custom_desc, stain_customer_supplied, stain_vertical_sqft, staining_multiplier,
      JSON.stringify(repairs), repairs_notes, debris_removal,
      JSON.stringify(cleanExtras), Math.round(discount * 100), JSON.stringify(breakdown), source_hcp_estimate_id
    );
    const estimateId = result.lastInsertRowid;

    const estimateDir = path.join(UPLOADS_DIR, String(estimateId));
    await fs.mkdir(estimateDir, { recursive: true });
    const insertPhoto = db.prepare("INSERT INTO estimate_photos (estimate_id, filename, kind, swatch_id, is_design) VALUES (?, ?, ?, ?, ?)");

    const designIdx = b.design_photo_index !== undefined ? parseInt(b.design_photo_index, 10) : -1;
    const photoFiles = (req.files && req.files.photos) || [];
    for (let i = 0; i < photoFiles.length; i++) {
      const file = photoFiles[i];
      const ext = (path.extname(file.originalname) || ".jpg").toLowerCase();
      const filename = `photo-${i + 1}${ext}`;
      await fs.writeFile(path.join(estimateDir, filename), file.buffer);
      insertPhoto.run(estimateId, filename, "original", null, i === designIdx ? 1 : 0);
    }

    const renderFiles = (req.files && req.files.rendered_image) || [];
    const renderSwatchId = (b.swatch_id || "").trim() || null;
    if (renderFiles.length > 0 && renderSwatchId) {
      const filename = `render-${renderSwatchId}.png`;
      await fs.writeFile(path.join(estimateDir, filename), renderFiles[0].buffer);
      insertPhoto.run(estimateId, filename, "render", renderSwatchId, 0);
    }

    res.json({ ok: true, id: estimateId });
  } catch (err) {
    console.error("[estimate] save error:", err);
    res.status(500).json({ error: err.message || "Failed to save estimate" });
  }
});

// ---- Estimates: push to Housecall Pro ----
app.post("/api/estimate/:id/send-to-hcp", requireAuth, async (req, res) => {
  try {
    if (!hcpEnabled()) return res.status(503).json({ error: "Housecall Pro not configured" });
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const row = db.prepare("SELECT * FROM estimates WHERE id = ?").get(id);
    if (!row) return res.status(404).json({ error: "Not found" });

    let breakdown = {};
    try { breakdown = JSON.parse(row.pricing_snapshot || "{}"); } catch (_) {}

    const { customerId, estimateId } = await sendEstimateToHcp(row, breakdown);
    db.prepare(`
      UPDATE estimates SET hcp_customer_id = ?, hcp_estimate_id = ?, hcp_synced_at = datetime('now'),
        status = 'sent', updated_at = datetime('now') WHERE id = ?
    `).run(String(customerId), String(estimateId), id);

    res.json({ ok: true, hcp_customer_id: customerId, hcp_estimate_id: estimateId });
  } catch (err) {
    console.error("[hcp] send error:", err);
    res.status(502).json({ error: err.message || "Failed to send to Housecall Pro" });
  }
});

app.listen(PORT, "127.0.0.1", () => console.log(`deck-expert-estimator listening on http://127.0.0.1:${PORT}`));
