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
    service_type TEXT,       -- stain | seal
    opacity TEXT,            -- clear | semi_transparent | semi_solid | solid
    wood_type TEXT,          -- pressure_treated | cedar | redwood | hardwood | composite
    prep_level TEXT,         -- standard | weathered | failing_finish
    surface_sqft REAL,
    railing_lf REAL DEFAULT 0,
    stairs_count INTEGER DEFAULT 0,

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
const estimateCols = db.prepare("PRAGMA table_info(estimates)").all().map(c => c.name);
if (!estimateCols.includes("source_hcp_estimate_id")) {
  db.exec("ALTER TABLE estimates ADD COLUMN source_hcp_estimate_id TEXT");
}
