const Database = require('better-sqlite3');
const path = require('path');

// DB_PATH lets this point at a mounted persistent disk in production (e.g.
// Render) instead of the app directory, which is ephemeral there and gets
// wiped on every deploy/restart unless a persistent disk is attached.
// Defaults to the old behavior (a file next to the project root) for local dev.
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'litbyaura.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// NOTE ON MONEY: every price/amount column below is an INTEGER in pesewas
// (1 GHS = 100 pesewas), never a decimal. Convert to/from cedis only at the
// UI boundary (see public/js/main.js `formatMoney`). This avoids
// floating-point rounding bugs in totals.

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  price_pesewas INTEGER NOT NULL,
  compare_at_pesewas INTEGER,
  image_url     TEXT NOT NULL DEFAULT '/images/placeholder.png',
  stock         INTEGER NOT NULL DEFAULT 0,
  brand         TEXT NOT NULL DEFAULT '',        -- admin free-types this; "Brands" nav lists distinct values in use
  is_best_seller INTEGER NOT NULL DEFAULT 0,     -- admin toggle; powers the "Best Sellers" nav
  is_active     INTEGER NOT NULL DEFAULT 1,  -- soft delete: 0 = hidden, row kept forever
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number      TEXT UNIQUE NOT NULL,
  customer_id       INTEGER REFERENCES customers(id),  -- null for guest checkout
  customer_name     TEXT NOT NULL,
  phone             TEXT NOT NULL,
  email             TEXT,                        -- optional, used for status notifications
  address           TEXT NOT NULL,
  city              TEXT NOT NULL,
  notes             TEXT DEFAULT '',
  subtotal_pesewas  INTEGER NOT NULL,
  payment_method    TEXT NOT NULL,             -- 'cod' | 'paystack' | 'hubtel'
  payment_status    TEXT NOT NULL DEFAULT 'pending', -- pending|paid|failed|cancelled
  fulfillment_status TEXT NOT NULL DEFAULT 'processing', -- processing|confirmed|shipped|delivered|completed|cancelled (free text, admin can extend)
  provider_reference TEXT,                     -- external tx ref, for online payments
  stock_restored    INTEGER NOT NULL DEFAULT 0, -- guards rollback from firing twice
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      INTEGER NOT NULL REFERENCES orders(id),
  product_id    INTEGER NOT NULL REFERENCES products(id),
  product_name  TEXT NOT NULL,     -- snapshot, so it displays correctly even if product changes/is deleted
  unit_price_pesewas INTEGER NOT NULL, -- snapshot of price at time of order
  quantity      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id    INTEGER NOT NULL REFERENCES admins(id),
  token_hash  TEXT NOT NULL,        -- hashed, never store the raw token
  expires_at  TEXT NOT NULL,        -- 1 hour from creation
  used        INTEGER NOT NULL DEFAULT 0, -- single-use
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customer_password_reset_tokens (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id   INTEGER NOT NULL REFERENCES customers(id),
  token_hash    TEXT NOT NULL,        -- hashed, never store the raw token
  expires_at    TEXT NOT NULL,        -- 1 hour from creation
  used          INTEGER NOT NULL DEFAULT 0, -- single-use
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---- Customer accounts ----
CREATE TABLE IF NOT EXISTS customers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  phone         TEXT DEFAULT '',
  address       TEXT DEFAULT '',   -- saved shipping info, reused/pre-filled on future checkouts
  city          TEXT DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---- Fixed taxonomy: "Shop by Concern" and "Shop by Skin Type" ----
-- Unlike the old free-form categories system, these two lists are FIXED —
-- there is no admin CRUD for them. The admin picks (multi-select) from this
-- fixed set per product; customers browse via dropdown nav. Seeded once
-- below, right after this schema block.
CREATE TABLE IF NOT EXISTS concerns (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  slug  TEXT UNIQUE NOT NULL,
  name  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skin_types (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  slug  TEXT UNIQUE NOT NULL,
  name  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_concerns (
  product_id  INTEGER NOT NULL REFERENCES products(id),
  concern_id  INTEGER NOT NULL REFERENCES concerns(id),
  PRIMARY KEY (product_id, concern_id)
);

CREATE TABLE IF NOT EXISTS product_skin_types (
  product_id    INTEGER NOT NULL REFERENCES products(id),
  skin_type_id  INTEGER NOT NULL REFERENCES skin_types(id),
  PRIMARY KEY (product_id, skin_type_id)
);

-- ---- Multiple product images ("angles"), ordered ----
CREATE TABLE IF NOT EXISTS product_images (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  url         TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- ---- Trust-bar / announcement marquee messages ----
-- Admin-editable (Settings tab) so the site owner can change these at any
-- time without touching code or redeploying - see /api/announcements and
-- /api/admin/announcements.
CREATE TABLE IF NOT EXISTS announcements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  text        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---- Homepage hero slideshow ----
-- Admin-editable list of image URLs (any number - not capped at 4), each
-- with an optional caption. See /api/hero-slides (public) and
-- /api/admin/hero-slides (admin CRUD + reorder), same pattern as announcements.
CREATE TABLE IF NOT EXISTS hero_slides (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  image_url   TEXT NOT NULL,
  caption     TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---- Migrations for databases created before a column existed ----
// CREATE TABLE IF NOT EXISTS above only creates tables that are missing; it
// does NOT add new columns to a table that already exists on disk. Anyone
// running this against a pre-existing litbyaura.db (from before customer
// accounts / order emails were added) needs these columns backfilled, or
// every order/customer query referencing them throws SQLITE_ERROR "no such
// column". This runs on every boot; each ALTER is a no-op once applied.
function ensureColumn(table, column, definition) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!existing.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[migration] added ${table}.${column}`);
  }
}

ensureColumn('orders', 'customer_id', 'INTEGER REFERENCES customers(id)');
ensureColumn('orders', 'email', 'TEXT');
ensureColumn('products', 'brand', "TEXT NOT NULL DEFAULT ''"); // admin free-types this; "Brands" nav lists distinct values in use
ensureColumn('products', 'is_best_seller', 'INTEGER NOT NULL DEFAULT 0'); // admin toggle; powers the "Best Sellers" nav

// ---- Seed the fixed concern/skin-type lists (idempotent, runs every boot) ----
// These are NOT admin-editable (no create/delete route exists for them) —
// they're a fixed taxonomy the business asked for. If the list of options
// ever needs to change, edit the arrays below; existing product_concerns/
// product_skin_types rows referencing a removed slug would need handling.
const CONCERNS = [
  'Acne & Breakouts', 'Dark Spots & Hyperpigmentation', 'Anti-Aging', 'Dry Skin',
  'Oily Skin', 'Sensitive Skin', 'Redness', 'Large Pores', 'Dull Skin', 'Uneven Skin Tone',
];
const SKIN_TYPES = ['Normal', 'Dry', 'Oily', 'Combination', 'Sensitive'];

function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function seedFixedList(table, names) {
  const insert = db.prepare(`INSERT OR IGNORE INTO ${table} (slug, name) VALUES (?, ?)`);
  const insertMany = db.transaction((rows) => rows.forEach((name) => insert.run(slugify(name), name)));
  insertMany(names);
}

seedFixedList('concerns', CONCERNS);
seedFixedList('skin_types', SKIN_TYPES);

// ---- Seed default trust-bar messages (idempotent - only if the table is
// completely empty, so it never overwrites messages the admin has since
// edited/added/removed) ----
const DEFAULT_ANNOUNCEMENTS = [
  '✅ Pay cash on delivery — no card needed',
  '💬 24/7 customer support',
  '🚚 Quick delivery',
  '⭐ High quality products',
];
const announcementCount = db.prepare('SELECT COUNT(*) as n FROM announcements').get().n;
if (announcementCount === 0) {
  const insert = db.prepare('INSERT INTO announcements (text, sort_order) VALUES (?, ?)');
  const insertMany = db.transaction((rows) => rows.forEach((text, i) => insert.run(text, i)));
  insertMany(DEFAULT_ANNOUNCEMENTS);
}

// ---- Seed default hero slides (idempotent - only if table is empty) ----
const heroSlideCount = db.prepare('SELECT COUNT(*) as n FROM hero_slides').get().n;
if (heroSlideCount === 0) {
  const insert = db.prepare('INSERT INTO hero_slides (image_url, caption, sort_order) VALUES (?, ?, ?)');
  const insertMany = db.transaction((rows) => rows.forEach((url, i) => insert.run(url, '', i)));
  insertMany(['/images/hero-slide-1.jpg', '/images/hero-slide-2.jpg', '/images/hero-slide-3.jpg', '/images/hero-slide-4.jpg']);
}

module.exports = db;
