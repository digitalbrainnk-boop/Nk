// Base de données SQLite (intégrée à Node) : un seul fichier, transactions, et registres
// protégés par des déclencheurs : une opération validée ne peut être ni modifiée ni effacée,
// seulement annulée par une écriture inverse qui laisse une trace.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

let db = null;
let dataDir = null;
const stmts = new Map();

export const getDataDir = () => dataDir;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('owner','manager','cashier','waiter')),
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  created_by INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  device_id TEXT NOT NULL DEFAULT '',
  device_label TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  revoked_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS known_devices (
  user_id INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (user_id, device_id)
);

CREATE TABLE IF NOT EXISTS login_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  username TEXT NOT NULL,
  user_id INTEGER,
  success INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  device_id TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_login_events_at ON login_events(at);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  user_id INTEGER,
  user_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  entity TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '{}',
  ip TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT '',
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);

CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, value INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  sort INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  brand TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  reference TEXT NOT NULL UNIQUE,
  photo TEXT,
  purchase_price INTEGER NOT NULL CHECK (purchase_price >= 0),
  sale_price INTEGER NOT NULL CHECK (sale_price >= 0),
  units_per_crate INTEGER NOT NULL DEFAULT 12 CHECK (units_per_crate >= 1),
  pack_label TEXT NOT NULL DEFAULT 'casier',
  min_stock INTEGER NOT NULL DEFAULT 0,
  supplier_id INTEGER REFERENCES suppliers(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  purchase_price INTEGER NOT NULL,
  sale_price INTEGER NOT NULL,
  at INTEGER NOT NULL,
  user_id INTEGER
);

-- Grand livre du stock : stock disponible = somme des quantités (positives = entrées).
-- kind : initial, entry, sale, offered, staff, broken, lost, expired, other, inventory.
-- Une annulation ajoute une ligne de même nature et de signe opposé (reversal_of).
CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  business_day TEXT NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('initial','entry','sale','offered','staff','broken','lost','expired','other','inventory')),
  unit_cost INTEGER NOT NULL DEFAULT 0,
  unit_price INTEGER NOT NULL DEFAULT 0,
  ref_type TEXT NOT NULL DEFAULT '',
  ref_id INTEGER,
  user_id INTEGER,
  waiter_id INTEGER,
  reversal_of INTEGER,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mov_product ON stock_movements(product_id, at);
CREATE INDEX IF NOT EXISTS idx_mov_day ON stock_movements(business_day);
CREATE INDEX IF NOT EXISTS idx_mov_at ON stock_movements(at);

CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no TEXT NOT NULL UNIQUE,
  at INTEGER NOT NULL,
  business_day TEXT NOT NULL,
  supplier_id INTEGER REFERENCES suppliers(id),
  invoice_no TEXT NOT NULL DEFAULT '',
  total_amount INTEGER NOT NULL,
  paid_amount INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT '',
  user_id INTEGER NOT NULL,
  observation TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','cancelled')),
  cancelled_at INTEGER, cancelled_by INTEGER, cancel_reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS entry_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  crates INTEGER NOT NULL DEFAULT 0,
  units_per_crate INTEGER NOT NULL,
  extra_units INTEGER NOT NULL DEFAULT 0,
  qty INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL,
  line_total INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no TEXT NOT NULL UNIQUE,
  at INTEGER NOT NULL,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  entry_id INTEGER REFERENCES entries(id),
  amount INTEGER NOT NULL,
  method TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  user_id INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS exits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no TEXT NOT NULL UNIQUE,
  at INTEGER NOT NULL,
  business_day TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('offered','staff','broken','lost','expired','other')),
  responsible_name TEXT NOT NULL DEFAULT '',
  waiter_id INTEGER REFERENCES users(id),
  user_id INTEGER NOT NULL,
  observation TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','cancelled')),
  cancelled_at INTEGER, cancelled_by INTEGER, cancel_reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS exit_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exit_id INTEGER NOT NULL REFERENCES exits(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  crates INTEGER NOT NULL DEFAULT 0,
  units_per_crate INTEGER NOT NULL,
  extra_units INTEGER NOT NULL DEFAULT 0,
  qty INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL,
  unit_price INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  at INTEGER NOT NULL,
  business_day TEXT NOT NULL,
  waiter_id INTEGER NOT NULL REFERENCES users(id),
  table_label TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','served','cancelled','rejected')),
  sale_id INTEGER,
  handled_by INTEGER,
  handled_at INTEGER,
  status_reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE TABLE IF NOT EXISTS order_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL,
  unit_price INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cash_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no TEXT UNIQUE,
  cashier_id INTEGER NOT NULL REFERENCES users(id),
  opened_at INTEGER NOT NULL,
  business_day TEXT NOT NULL,
  opening_float INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_at INTEGER,
  closed_by INTEGER,
  theoretical INTEGER,
  counted INTEGER,
  variance INTEGER,
  details TEXT NOT NULL DEFAULT '{}',
  closing_note TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_session ON cash_sessions(cashier_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no TEXT NOT NULL UNIQUE,
  at INTEGER NOT NULL,
  business_day TEXT NOT NULL,
  cashier_id INTEGER NOT NULL REFERENCES users(id),
  waiter_id INTEGER REFERENCES users(id),
  order_id INTEGER REFERENCES orders(id),
  session_id INTEGER NOT NULL REFERENCES cash_sessions(id),
  customer_name TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  total INTEGER NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('paid','partial','credit','cancelled')),
  note TEXT NOT NULL DEFAULT '',
  cancelled_at INTEGER, cancelled_by INTEGER, cancel_reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_day ON sales(business_day);
CREATE TABLE IF NOT EXISTS sale_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL,
  line_total INTEGER NOT NULL
);

-- Encaissements (vente payée tout de suite, paiement partiel ou règlement d'un crédit).
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no TEXT,
  at INTEGER NOT NULL,
  business_day TEXT NOT NULL,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  session_id INTEGER NOT NULL REFERENCES cash_sessions(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('sale','credit')),
  user_id INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_session ON payments(session_id);

-- Mouvements de caisse hors ventes : ajouts, retraits, remboursements.
CREATE TABLE IF NOT EXISTS cash_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no TEXT NOT NULL UNIQUE,
  at INTEGER NOT NULL,
  business_day TEXT NOT NULL,
  session_id INTEGER NOT NULL REFERENCES cash_sessions(id),
  kind TEXT NOT NULL CHECK (kind IN ('deposit','withdrawal','refund')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  ref_type TEXT NOT NULL DEFAULT '',
  ref_id INTEGER,
  user_id INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no TEXT NOT NULL UNIQUE,
  at INTEGER NOT NULL,
  business_day TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL,
  session_id INTEGER REFERENCES cash_sessions(id),
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','cancelled')),
  cancelled_at INTEGER, cancelled_by INTEGER, cancel_reason TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS inventories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no TEXT UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('daily','weekly','monthly')),
  started_at INTEGER NOT NULL,
  validated_at INTEGER,
  business_day TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  validated_by INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','validated','abandoned')),
  note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS inventory_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_id INTEGER NOT NULL REFERENCES inventories(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  theoretical INTEGER,
  counted INTEGER,
  difference INTEGER,
  justification TEXT NOT NULL DEFAULT '',
  UNIQUE (inventory_id, product_id)
);

-- Consignes : party = supplier (le maquis verse / récupère) ou customer (le client verse / est remboursé).
CREATE TABLE IF NOT EXISTS consignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no TEXT NOT NULL UNIQUE,
  at INTEGER NOT NULL,
  party TEXT NOT NULL CHECK (party IN ('supplier','customer')),
  supplier_id INTEGER REFERENCES suppliers(id),
  customer_name TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('paid','recovered','refunded')),
  crates INTEGER NOT NULL DEFAULT 0,
  bottles INTEGER NOT NULL DEFAULT 0,
  amount INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  user_id INTEGER NOT NULL
);

-- Reçus et documents : contenu figé au moment de l'opération (jamais modifié).
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  ref_type TEXT NOT NULL DEFAULT '',
  ref_id INTEGER,
  at INTEGER NOT NULL,
  business_day TEXT NOT NULL,
  user_id INTEGER,
  user_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  amount INTEGER,
  payload TEXT NOT NULL,
  search_text TEXT NOT NULL DEFAULT '',
  rectifies TEXT,
  hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_at ON documents(at);
CREATE INDEX IF NOT EXISTS idx_documents_ref ON documents(ref_type, ref_id);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('daily','weekly')),
  period_key TEXT NOT NULL,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  trigger TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  doc_no TEXT NOT NULL,
  data TEXT NOT NULL,
  UNIQUE (kind, period_key, version)
);
CREATE TABLE IF NOT EXISTS report_dirty (
  kind TEXT NOT NULL,
  period_key TEXT NOT NULL,
  since INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (kind, period_key)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  read_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, id);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE,
  keys TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

-- Anti-doublons de la synchronisation hors connexion (un identifiant par opération).
CREATE TABLE IF NOT EXISTS sync_ops (
  user_id INTEGER NOT NULL,
  op_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  status INTEGER NOT NULL,
  response TEXT NOT NULL,
  PRIMARY KEY (user_id, op_id)
);
`;

// Tables en écriture unique : ni modification, ni suppression.
const APPEND_ONLY = [
  "audit_log",
  "login_events",
  "stock_movements",
  "entry_lines",
  "exit_lines",
  "sale_lines",
  "order_lines",
  "payments",
  "cash_movements",
  "supplier_payments",
  "consignments",
  "documents",
  "price_history",
];
// Tables d'opérations : jamais supprimées ; seuls le statut et les champs d'annulation évoluent.
const NO_DELETE = ["entries", "exits", "sales", "expenses", "orders", "cash_sessions", "inventories", "reports", "users", "products"];
const FROZEN_COLUMNS = {
  entries: ["doc_no", "at", "business_day", "supplier_id", "total_amount", "paid_amount", "user_id"],
  exits: ["doc_no", "at", "business_day", "reason", "user_id"],
  sales: ["doc_no", "at", "business_day", "cashier_id", "waiter_id", "session_id", "total"],
  expenses: ["doc_no", "at", "business_day", "amount", "method", "session_id", "user_id", "category"],
  reports: ["kind", "period_key", "version", "data", "generated_at", "doc_no"],
};

function triggers() {
  let sql = "";
  for (const t of APPEND_ONLY) {
    sql += `CREATE TRIGGER IF NOT EXISTS ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, 'Enregistrement définitif : modification interdite'); END;\n`;
    sql += `CREATE TRIGGER IF NOT EXISTS ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, 'Enregistrement définitif : suppression interdite'); END;\n`;
  }
  for (const t of NO_DELETE) {
    sql += `CREATE TRIGGER IF NOT EXISTS ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, 'Suppression interdite : utilisez l''annulation traçable'); END;\n`;
  }
  for (const [t, cols] of Object.entries(FROZEN_COLUMNS)) {
    const cond = cols.map((c) => `NEW.${c} IS NOT OLD.${c}`).join(" OR ");
    sql += `CREATE TRIGGER IF NOT EXISTS ${t}_frozen BEFORE UPDATE ON ${t} WHEN ${cond} BEGIN SELECT RAISE(ABORT, 'Opération validée : montant, date et auteur non modifiables'); END;\n`;
  }
  return sql;
}

const DEFAULT_CATEGORIES = ["Bières", "Sucreries", "Eaux minérales", "Jus", "Boissons énergisantes", "Vins et spiritueux", "Autres boissons"];

export function openDb(dir = process.env.DATA_DIR || "data") {
  if (db) return db;
  dataDir = path.resolve(dir);
  for (const sub of ["", "uploads", "uploads/products", "sauvegardes"]) fs.mkdirSync(path.join(dataDir, sub), { recursive: true });
  const file = path.join(dataDir, "maquis.db");
  const pending = path.join(dataDir, "restauration-en-attente.db");
  if (fs.existsSync(pending)) {
    // Restauration demandée (scripts/restaurer.js) : appliquée avant toute ouverture.
    if (fs.existsSync(file)) fs.renameSync(file, path.join(dataDir, "sauvegardes", `avant-restauration-${Date.now()}.db`));
    for (const ext of ["-wal", "-shm"]) fs.rmSync(file + ext, { force: true });
    fs.renameSync(pending, file);
    console.log("✅ Sauvegarde restaurée.");
  }
  db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 8000; PRAGMA synchronous = NORMAL;");
  db.exec(SCHEMA);
  db.exec(triggers());
  const n = db.prepare("SELECT COUNT(*) AS n FROM categories").get().n;
  if (!n) {
    const ins = db.prepare("INSERT INTO categories (name, sort) VALUES (?, ?)");
    DEFAULT_CATEGORIES.forEach((c, i) => ins.run(c, (i + 1) * 10));
  }
  return db;
}

export function closeDb() {
  if (db) db.close();
  db = null;
  stmts.clear();
}

function stmt(sql) {
  let s = stmts.get(sql);
  if (!s) {
    s = db.prepare(sql);
    stmts.set(sql, s);
  }
  return s;
}
export const all = (sql, ...p) => stmt(sql).all(...p);
export const get = (sql, ...p) => stmt(sql).get(...p);
export const run = (sql, ...p) => stmt(sql).run(...p);
export const exec = (sql) => db.exec(sql);
export const raw = () => db;

// Transaction (imbriquable grâce aux points de sauvegarde).
let depth = 0;
let pendingAfterCommit = [];
export function tx(fn) {
  const sp = `sp${depth}`;
  if (depth === 0) db.exec("BEGIN IMMEDIATE");
  else db.exec(`SAVEPOINT ${sp}`);
  depth++;
  try {
    const out = fn();
    depth--;
    if (depth === 0) {
      db.exec("COMMIT");
      const jobs = pendingAfterCommit;
      pendingAfterCommit = [];
      for (const job of jobs) setImmediate(job);
    } else db.exec(`RELEASE ${sp}`);
    return out;
  } catch (e) {
    depth--;
    if (depth === 0) {
      db.exec("ROLLBACK");
      pendingAfterCommit = [];
    } else db.exec(`ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw e;
  }
}
// Action à lancer une fois les données réellement enregistrées (notifications push, temps réel).
export function afterCommit(job) {
  if (depth === 0) setImmediate(job);
  else pendingAfterCommit.push(job);
}

// ---------- Réglages ----------
export const DEFAULT_SETTINGS = {
  maquis_name: "Mon maquis",
  address: "",
  phone: "",
  receipt_footer: "Merci de votre visite !",
  logo: "",
  payment_methods: ["Espèces", "Orange Money", "Moov Money", "Wave"],
  expense_categories: ["Glace", "Électricité", "Eau", "Transport", "Salaire / avance", "Paiement fournisseur", "Entretien", "Achat divers", "Autre"],
  idle_minutes: { owner: 1440, manager: 720, cashier: 720, waiter: 720 },
  installed_day: "",
};

export function getSetting(key) {
  const row = get("SELECT value FROM settings WHERE key = ?", key);
  if (!row) return structuredClone(DEFAULT_SETTINGS[key]);
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}
export function setSetting(key, value) {
  run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, JSON.stringify(value));
}
export function allSettings() {
  const out = structuredClone(DEFAULT_SETTINGS);
  for (const r of all("SELECT key, value FROM settings")) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      out[r.key] = r.value;
    }
  }
  return out;
}

// Numérotation unique et continue des documents : VTE-2026-000123.
export function nextNumber(prefix, year) {
  const key = `${prefix}-${year}`;
  run("INSERT INTO counters (key, value) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET value = value + 1", key);
  const v = get("SELECT value FROM counters WHERE key = ?", key).value;
  return `${prefix}-${year}-${String(v).padStart(6, "0")}`;
}
