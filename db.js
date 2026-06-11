import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "estimator.db");

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS estimates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    -- Customer (used to match/create in Housecall Pro)
    customer_name TEXT NOT NULL,
    customer_phone TEXT,
    customer_email TEXT,
    customer_address TEXT,

    -- What is being estimated: deck | porch | fence | pergola | gazebo
    structure_type TEXT NOT NULL,

    -- Deck/structure project details (nullable so other structures can extend later)
    wood_type TEXT,          -- pressure_treated | cedar | hardwood | composite
    deck_location TEXT,      -- above_ground | rooftop
    multilevel_levels INTEGER NOT NULL DEFAULT 0,  -- 0 = single level; drives cleaning story multiplier
    surface_sqft REAL,
    steps_included INTEGER NOT NULL DEFAULT 0,      -- sq ft includes the stairs?
    has_railing INTEGER NOT NULL DEFAULT 0,
    has_metal_spindles INTEGER NOT NULL DEFAULT 0,
    railing_lf REAL DEFAULT 0,
    stairs_count INTEGER DEFAULT 0,
    structures TEXT NOT NULL DEFAULT '[]',          -- JSON array of structure ids
    structures_other TEXT,                          -- free text when "other" selected
    prior_finish TEXT,       -- bare_wood | solid_stain_acrylic | oil_based_color_seal | clear_seal

    -- Cleaning (power washing) inputs
    cleaning_enabled INTEGER NOT NULL DEFAULT 1,
    chicago_surcharge INTEGER NOT NULL DEFAULT 0,
    light_clean INTEGER NOT NULL DEFAULT 0,
    pergola_gazebo_size TEXT,
    cleaning_multiplier REAL DEFAULT 1,

    -- Sanding (prep) inputs
    sanding_condition TEXT,
    vertical_sanding INTEGER NOT NULL DEFAULT 0,
    vertical_length REAL DEFAULT 0,
    vertical_height REAL DEFAULT 0,
    sanding_multiplier REAL DEFAULT 1,

    -- Staining / sealing inputs
    staining_enabled INTEGER NOT NULL DEFAULT 0,
    stain_process TEXT,
    stain_color TEXT,
    stain_custom_desc TEXT,
    stain_customer_supplied INTEGER NOT NULL DEFAULT 0,
    stain_vertical_sqft REAL DEFAULT 0,
    staining_multiplier REAL DEFAULT 1,

    -- Repairs / replacement (JSON array of {item_id, qty}) + notes
    repairs TEXT NOT NULL DEFAULT '[]',
    repairs_notes TEXT,

    -- Legacy columns (no longer collected; kept for older rows)
    service_type TEXT,
    opacity TEXT,
    prep_level TEXT,

    extra_items TEXT NOT NULL DEFAULT '[]',   -- JSON array of {description, price}
    discount_cents INTEGER NOT NULL DEFAULT 0,

    -- Frozen price breakdown at save time (so historical estimates don't shift
    -- when the rate config changes). JSON produced by pricing.js.
    pricing_snapshot TEXT,

    status TEXT NOT NULL DEFAULT 'draft',     -- draft | sent

    -- Source HCP estimate this was prefilled from (today's-appointments sync)
    source_hcp_estimate_id TEXT,

    -- Housecall Pro linkage (populated after a successful push)
    hcp_customer_id TEXT,
    hcp_estimate_id TEXT,
    hcp_synced_at TEXT
  );

  CREATE TABLE IF NOT EXISTS estimate_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    estimate_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'original',   -- original | render
    swatch_id TEXT,                          -- stain/seal swatch used for a render
    is_design INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (estimate_id) REFERENCES estimates(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_estimate_photos_estimate ON estimate_photos(estimate_id);
`);

// --- lightweight migrations for databases created before a column was added ---
const MIGRATIONS = {
  source_hcp_estimate_id: "TEXT",
  deck_location: "TEXT",
  multilevel_levels: "INTEGER NOT NULL DEFAULT 0",
  steps_included: "INTEGER NOT NULL DEFAULT 0",
  has_railing: "INTEGER NOT NULL DEFAULT 0",
  has_metal_spindles: "INTEGER NOT NULL DEFAULT 0",
  structures: "TEXT NOT NULL DEFAULT '[]'",
  structures_other: "TEXT",
  prior_finish: "TEXT",
  cleaning_enabled: "INTEGER NOT NULL DEFAULT 1",
  chicago_surcharge: "INTEGER NOT NULL DEFAULT 0",
  light_clean: "INTEGER NOT NULL DEFAULT 0",
  pergola_gazebo_size: "TEXT",
  cleaning_multiplier: "REAL DEFAULT 1",
  sanding_condition: "TEXT",
  vertical_sanding: "INTEGER NOT NULL DEFAULT 0",
  vertical_length: "REAL DEFAULT 0",
  vertical_height: "REAL DEFAULT 0",
  sanding_multiplier: "REAL DEFAULT 1",
  staining_enabled: "INTEGER NOT NULL DEFAULT 0",
  stain_process: "TEXT",
  stain_color: "TEXT",
  stain_custom_desc: "TEXT",
  stain_customer_supplied: "INTEGER NOT NULL DEFAULT 0",
  stain_vertical_sqft: "REAL DEFAULT 0",
  staining_multiplier: "REAL DEFAULT 1",
  repairs: "TEXT NOT NULL DEFAULT '[]'",
  repairs_notes: "TEXT",
};
const estimateCols = new Set(db.prepare("PRAGMA table_info(estimates)").all().map(c => c.name));
for (const [name, ddl] of Object.entries(MIGRATIONS)) {
  if (!estimateCols.has(name)) db.exec(`ALTER TABLE estimates ADD COLUMN ${name} ${ddl}`);
}
