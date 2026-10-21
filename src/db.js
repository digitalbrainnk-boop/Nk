// Stockage local (SQLite intégré à Node) : contacts, messages, mémoire,
// exemples de style, base de connaissances et réglages.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = path.resolve(process.env.DATA_DIR || "data");
fs.mkdirSync(path.join(DATA_DIR, "media"), { recursive: true });

// Restauration d'une sauvegarde demandée depuis le tableau de bord : appliquée au démarrage.
const DB_FILE = path.join(DATA_DIR, "agent.db");
const PENDING = path.join(DATA_DIR, "restauration.db");
if (fs.existsSync(PENDING)) {
  if (fs.existsSync(DB_FILE)) fs.renameSync(DB_FILE, path.join(DATA_DIR, `agent-avant-restauration-${Date.now()}.db`));
  for (const ext of ["-wal", "-shm"]) fs.rmSync(DB_FILE + ext, { force: true });
  fs.renameSync(PENDING, DB_FILE);
  console.log("✅ Sauvegarde restaurée.");
}

export const db = new DatabaseSync(DB_FILE);
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  external_id TEXT NOT NULL,
  name TEXT,
  memory TEXT NOT NULL DEFAULT '',
  paused_until INTEGER NOT NULL DEFAULT 0,
  needs_human INTEGER NOT NULL DEFAULT 0,
  needs_human_reason TEXT,
  unread INTEGER NOT NULL DEFAULT 0,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(channel, external_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  author TEXT NOT NULL,            -- client | agent | owner
  kind TEXT NOT NULL DEFAULT 'text', -- text | audio | image | comment | other
  text TEXT NOT NULL DEFAULT '',
  media_path TEXT,
  media_type TEXT,
  status TEXT NOT NULL DEFAULT 'sent', -- sent | draft | rejected | received
  external_id TEXT,
  answered INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id, id);
CREATE TABLE IF NOT EXISTS examples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_text TEXT NOT NULL,
  owner_reply TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(client_text, owner_reply)
);
CREATE TABLE IF NOT EXISTS knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

// Migrations légères pour les bases créées par une version précédente.
for (const sql of [
  "ALTER TABLE messages ADD COLUMN media_url TEXT",
  "ALTER TABLE contacts ADD COLUMN followups INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE contacts ADD COLUMN last_followup_at INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE contacts ADD COLUMN demo_at INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE contacts ADD COLUMN credits_used REAL NOT NULL DEFAULT 0",
  // Après la livraison : l'agent a demandé au client un commentaire sur ta page Facebook.
  "ALTER TABLE contacts ADD COLUMN review_asked_at INTEGER NOT NULL DEFAULT 0",
  // Relance prévue (ex : « je reviendrai pour une autre chanson ») : quand et pourquoi.
  "ALTER TABLE contacts ADD COLUMN remind_at INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE contacts ADD COLUMN remind_note TEXT NOT NULL DEFAULT ''",
]) {
  try {
    db.exec(sql);
  } catch {}
}

// Crédits Kie dépensés (mesurés par la différence de solde avant / après).
db.exec(`
CREATE TABLE IF NOT EXISTS credit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER,
  kind TEXT NOT NULL,             -- reply | song | voice | transcription | other
  credits REAL NOT NULL,
  balance_after REAL,
  created_at INTEGER NOT NULL
);
`);

// Commandes : une ligne par chanson commandée.
db.exec(`
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'nouveau', -- nouveau | devis | acompte | creation | livree | annulee
  title TEXT NOT NULL DEFAULT '',
  occasion TEXT NOT NULL DEFAULT '',
  price REAL NOT NULL DEFAULT 0,
  paid REAL NOT NULL DEFAULT 0,
  due_date TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  delivered_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_orders_contact ON orders(contact_id);
`);
// Texte de la chanson : statut '' | writing (en cours d'écriture) | proposed (envoyé au client)
// | validated (validé, paiement demandé) | payment_claimed (le client dit avoir payé, en attente
// de ta vérification) | composing | composed
for (const sql of [
  "ALTER TABLE orders ADD COLUMN lyrics TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE orders ADD COLUMN song_title TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE orders ADD COLUMN song_style TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE orders ADD COLUMN lyrics_status TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE orders ADD COLUMN lyrics_version INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE orders ADD COLUMN lyrics_due_at INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE orders ADD COLUMN lyrics_notes TEXT NOT NULL DEFAULT ''",
  // Demande spéciale que TU traites toi-même (ex : chanson + vidéo lyrics, montage).
  "ALTER TABLE orders ADD COLUMN special TEXT NOT NULL DEFAULT ''",
]) {
  try {
    db.exec(sql);
  } catch {}
}

// Problèmes repérés par la surveillance automatique (une ligne par problème).
db.exec(`
CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  contact_id INTEGER,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open', -- open | resolved
  notified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

// Publications automatiques sur la page Facebook / Instagram.
db.exec(`
CREATE TABLE IF NOT EXISTS social_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  image_url TEXT,
  fb_id TEXT,
  ig_id TEXT,
  status TEXT NOT NULL, -- published | failed | preview
  error TEXT,
  created_at INTEGER NOT NULL
);
`);

const now = () => Date.now();

// ---------- Réglages ----------
export const DEFAULT_SETTINGS = {
  owner_name: "",
  business_description: "",
  style_profile: "",
  extra_rules: "",
  reply_mode: "draft", // auto | draft | off  (draft = je valide avant envoi)
  channel_modes: {}, // ex: { whatsapp: "auto", telegram: "draft" }
  model: "claude-opus-5-5",
  effort: "medium",
  debounce_seconds: 8,
  min_reply_delay_seconds: 3,
  max_reply_delay_seconds: 20,
  typing_chars_per_second: 7,
  owner_takeover_hours: 6,
  open_hour: 5, // l'agent répond de 5 h…
  close_hour: 0, // …à minuit (0 = minuit) ; la nuit, les messages attendent l'ouverture
  ignored_contacts: [], // numéros (ou @pseudos) auxquels l'agent ne répond jamais
  currency: "FCFA",
  followup_enabled: true,
  followup_hours: 20, // < 24 h : Messenger/Instagram n'autorisent pas les messages après 24 h sans réponse
  followup_max: 2,
  voice_replies: "off", // off | mirror (vocal quand le client envoie un vocal) | always
  tts_voice: "Brian",
  auto_demo: false,
  song_flow: true, // l'agent propose le texte, le client valide, puis Suno compose
  compose_requires_payment: true, // composer seulement après TA confirmation du paiement
  song_auto_send: true, // livrer la chanson dès qu'elle est prête (le paiement a déjà été vérifié par toi)
  lyrics_delay_min: 3, // le texte est envoyé entre 3 et 10 minutes après la confirmation des infos
  lyrics_delay_max: 10,
  owner_whatsapp: "", // numéro où l'agent te laisse ses messages (vide = ton propre WhatsApp)
  payment_confirm_emoji: "✅", // ta réaction pour confirmer un paiement
  review_request: true, // après la livraison : « tu as aimé ? » puis lien pour laisser un commentaire
  facebook_page_url: "", // lien de ta page Facebook (rempli tout seul quand la page est connectée)
  social_enabled: false, // publier tout seul sur ta page Facebook (désactivé tant que tu ne l'actives pas)
  social_every_days: 3,
  social_hour: 10, // publier à partir de cette heure (heure du téléphone)
  social_instagram: false, // publier aussi sur Instagram (nécessite une image)
  social_images: true, // illustrer avec une image créée par l'IA (Kie.ai)
  social_guidelines: "", // tes consignes pour les publications
  watchdog_enabled: true, // vérification automatique toutes les minutes (blocages, erreurs)
  daily_report_enabled: true, // bilan de la journée sur ton WhatsApp
  daily_report_hour: 21, // heure du bilan (heure du téléphone)
  voice_provider: "kie", // kie (voix toute faite) | elevenlabs (TA voix clonée)
  elevenlabs_api_key: "",
  elevenlabs_voice_id: "",
  history_messages: 40,
  whatsapp_learning_only: false,
  whatsapp_enabled: false,
  telegram_token: "",
  owner_telegram_chat_id: "",
  facebook_page_token: "",
  facebook_app_secret: "",
  facebook_verify_token: "",
  facebook_reply_comments: true,
  wa_cloud_token: "",
  wa_cloud_phone_number_id: "",
  transcription_url: "https://api.groq.com/openai/v1/audio/transcriptions",
  transcription_model: "whisper-large-v3",
  transcription_api_key: "",
  anthropic_api_key: "",
  brain: process.env.BRAIN || "kie", // kie (par défaut) | claude | openai (autre service compatible OpenAI)
  kie_api_key: "",
  kie_chat_model: "deepseek-v4-1-flash",
  kie_chat_url: "",
  suno_model: "V5",
  llm_url: "",
  llm_api_key: "",
  llm_model: "",
};

export function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of db.prepare("SELECT key, value FROM settings").all()) {
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      out[row.key] = row.value;
    }
  }
  // Clé enregistrée dans la case Claude qui n'est pas une clé Claude : c'est une clé Kie.
  if (out.anthropic_api_key && !String(out.anthropic_api_key).startsWith("sk-ant-")) {
    if (!out.kie_api_key) out.kie_api_key = out.anthropic_api_key;
    out.anthropic_api_key = "";
  }
  // Même chose pour une clé donnée à l'installation (.env) à la place de la clé Claude.
  let envClaude = process.env.ANTHROPIC_API_KEY || "";
  if (envClaude && !envClaude.startsWith("sk-ant-")) {
    if (!out.kie_api_key && !process.env.KIE_API_KEY) out.kie_api_key = envClaude;
    envClaude = "";
  }
  // Pas de clé Claude mais une clé Kie : on utilise Kie automatiquement.
  const hasClaude = out.anthropic_api_key || envClaude;
  const hasKie = out.kie_api_key || process.env.KIE_API_KEY;
  if (out.brain === "claude" && !hasClaude && hasKie) out.brain = "kie";
  if (out.brain === "kie" && !hasKie && hasClaude) out.brain = "claude";
  return out;
}

export function getSetting(key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  if (!row) return DEFAULT_SETTINGS[key];
  return JSON.parse(row.value);
}

export function setSettings(patch) {
  const stmt = db.prepare(
    "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  for (const [k, v] of Object.entries(patch)) stmt.run(k, JSON.stringify(v));
}

// ---------- Contacts ----------
export function upsertContact(channel, externalId, name, meta) {
  const existing = db
    .prepare("SELECT * FROM contacts WHERE channel = ? AND external_id = ?")
    .get(channel, String(externalId));
  if (existing) {
    const patchName = name && name !== existing.name ? name : existing.name;
    const mergedMeta = meta
      ? JSON.stringify({ ...JSON.parse(existing.meta), ...meta })
      : existing.meta;
    db.prepare("UPDATE contacts SET name = ?, meta = ? WHERE id = ?").run(
      patchName,
      mergedMeta,
      existing.id,
    );
    return getContact(existing.id);
  }
  const r = db
    .prepare(
      "INSERT INTO contacts(channel, external_id, name, meta, created_at, updated_at) VALUES(?,?,?,?,?,?)",
    )
    .run(channel, String(externalId), name || null, JSON.stringify(meta || {}), now(), now());
  return getContact(Number(r.lastInsertRowid));
}

export function getContact(id) {
  const c = db.prepare("SELECT * FROM contacts WHERE id = ?").get(id);
  if (c) c.meta = JSON.parse(c.meta);
  return c;
}

export function updateContact(id, patch) {
  const allowed = [
    "name",
    "memory",
    "paused_until",
    "needs_human",
    "needs_human_reason",
    "unread",
    "followups",
    "last_followup_at",
    "demo_at",
    "review_asked_at",
    "remind_at",
    "remind_note",
  ];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (!keys.length) return;
  const sql = `UPDATE contacts SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`;
  db.prepare(sql).run(...keys.map((k) => patch[k]), id);
}

export function listContacts() {
  return db
    .prepare(
      `SELECT c.*, m.text AS last_text, m.author AS last_author, m.created_at AS last_at,
        (SELECT COUNT(*) FROM messages d WHERE d.contact_id = c.id AND d.status = 'draft') AS drafts
       FROM contacts c
       LEFT JOIN messages m ON m.id = (SELECT MAX(id) FROM messages WHERE contact_id = c.id AND status != 'rejected')
       ORDER BY c.updated_at DESC LIMIT 500`,
    )
    .all();
}

export function deleteContact(id) {
  db.prepare("DELETE FROM orders WHERE contact_id = ?").run(id);
  db.prepare("DELETE FROM messages WHERE contact_id = ?").run(id);
  db.prepare("DELETE FROM contacts WHERE id = ?").run(id);
}

// ---------- Messages ----------
export function addMessage(contactId, msg) {
  const r = db
    .prepare(
      `INSERT INTO messages(contact_id, author, kind, text, media_path, media_type, media_url, status, external_id, answered, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      contactId,
      msg.author,
      msg.kind || "text",
      msg.text || "",
      msg.media_path || null,
      msg.media_type || null,
      msg.media_url || null,
      msg.status || "sent",
      msg.external_id || null,
      msg.author === "client" ? 0 : 1,
      msg.created_at || now(),
    );
  db.prepare("UPDATE contacts SET updated_at = ? WHERE id = ?").run(now(), contactId);
  return db.prepare("SELECT * FROM messages WHERE id = ?").get(Number(r.lastInsertRowid));
}

export function getMessage(id) {
  return db.prepare("SELECT * FROM messages WHERE id = ?").get(id);
}

export function updateMessage(id, patch) {
  const keys = Object.keys(patch);
  db.prepare(`UPDATE messages SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(
    ...keys.map((k) => patch[k]),
    id,
  );
}

export function messageExists(contactId, externalId) {
  if (!externalId) return false;
  return !!db
    .prepare("SELECT 1 FROM messages WHERE contact_id = ? AND external_id = ?")
    .get(contactId, String(externalId));
}

export function listMessages(contactId, limit = 200) {
  return db
    .prepare(
      "SELECT * FROM (SELECT * FROM messages WHERE contact_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC",
    )
    .all(contactId, limit);
}

export function markAnswered(contactId) {
  db.prepare("UPDATE messages SET answered = 1 WHERE contact_id = ? AND author = 'client'").run(
    contactId,
  );
}

export function unansweredClientMessages(contactId) {
  return db
    .prepare(
      "SELECT * FROM messages WHERE contact_id = ? AND author = 'client' AND answered = 0 ORDER BY id",
    )
    .all(contactId);
}

// ---------- Exemples de style (apprentissage) ----------
export function addExamples(pairs, source) {
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO examples(client_text, owner_reply, source, created_at) VALUES(?,?,?,?)",
  );
  let n = 0;
  db.exec("BEGIN");
  try {
    for (const p of pairs) {
      if (!p.client_text?.trim() || !p.owner_reply?.trim()) continue;
      const r = stmt.run(p.client_text.slice(0, 2000), p.owner_reply.slice(0, 2000), source, now());
      n += Number(r.changes);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return n;
}

export function allExamples() {
  return db.prepare("SELECT * FROM examples ORDER BY id DESC").all();
}

export function exampleStats() {
  return db.prepare("SELECT source, COUNT(*) AS n FROM examples GROUP BY source").all();
}

export function clearExamples(source) {
  if (source) db.prepare("DELETE FROM examples WHERE source = ?").run(source);
  else db.exec("DELETE FROM examples");
}

// ---------- Base de connaissances ----------
export function listKnowledge() {
  return db.prepare("SELECT * FROM knowledge ORDER BY id").all();
}

export function saveKnowledge({ id, title, content }) {
  if (id) {
    db.prepare("UPDATE knowledge SET title = ?, content = ?, updated_at = ? WHERE id = ?").run(
      title,
      content,
      now(),
      id,
    );
    return id;
  }
  const r = db
    .prepare("INSERT INTO knowledge(title, content, updated_at) VALUES(?,?,?)")
    .run(title, content, now());
  return Number(r.lastInsertRowid);
}

export function deleteKnowledge(id) {
  db.prepare("DELETE FROM knowledge WHERE id = ?").run(id);
}

// ---------- Commandes ----------
export const STAGES = ["nouveau", "devis", "acompte", "creation", "livree", "annulee"];
const OPEN_STAGES = ["nouveau", "devis", "acompte", "creation"];

export function getOrder(id) {
  return db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
}

/** Commande en cours du client (la plus récente non livrée / non annulée). */
export function activeOrder(contactId) {
  return db
    .prepare(
      `SELECT * FROM orders WHERE contact_id = ? AND stage IN (${OPEN_STAGES.map(() => "?").join(",")}) ORDER BY id DESC LIMIT 1`,
    )
    .get(contactId, ...OPEN_STAGES);
}

export function listOrders({ contactId } = {}) {
  if (contactId) return db.prepare("SELECT * FROM orders WHERE contact_id = ? ORDER BY id DESC").all(contactId);
  return db
    .prepare(
      `SELECT o.*, c.name AS contact_name, c.channel, c.external_id
       FROM orders o JOIN contacts c ON c.id = o.contact_id
       ORDER BY o.updated_at DESC LIMIT 500`,
    )
    .all();
}

export function saveOrder(o) {
  const fields = [
    "stage", "title", "occasion", "price", "paid", "due_date", "notes",
    "lyrics", "song_title", "song_style", "lyrics_status", "lyrics_version", "lyrics_due_at", "lyrics_notes", "special",
  ];
  if (o.stage && !STAGES.includes(o.stage)) throw new Error(`Étape inconnue : ${o.stage}`);
  if (o.id) {
    const cur = getOrder(o.id);
    if (!cur) throw new Error("Commande introuvable");
    const next = { ...cur };
    for (const f of fields) if (o[f] !== undefined && o[f] !== null) next[f] = o[f];
    const delivered = next.stage === "livree" && cur.stage !== "livree" ? now() : cur.delivered_at;
    db.prepare(
      `UPDATE orders SET stage=?, title=?, occasion=?, price=?, paid=?, due_date=?, notes=?, lyrics=?, song_title=?, song_style=?,
       lyrics_status=?, lyrics_version=?, lyrics_due_at=?, lyrics_notes=?, special=?, updated_at=?, delivered_at=? WHERE id=?`,
    ).run(
      next.stage,
      next.title,
      next.occasion,
      Number(next.price) || 0,
      Number(next.paid) || 0,
      next.due_date,
      next.notes,
      next.lyrics || "",
      next.song_title || "",
      next.song_style || "",
      next.lyrics_status || "",
      Number(next.lyrics_version) || 0,
      Number(next.lyrics_due_at) || 0,
      next.lyrics_notes || "",
      next.special || "",
      now(),
      delivered,
      o.id,
    );
    return getOrder(o.id);
  }
  const r = db
    .prepare(
      `INSERT INTO orders(contact_id, stage, title, occasion, price, paid, due_date, notes, lyrics, song_title, song_style,
         lyrics_status, lyrics_version, special, created_at, updated_at, delivered_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      o.contact_id,
      o.stage || "nouveau",
      o.title || "",
      o.occasion || "",
      Number(o.price) || 0,
      Number(o.paid) || 0,
      o.due_date || "",
      o.notes || "",
      o.lyrics || "",
      o.song_title || "",
      o.song_style || "",
      o.lyrics_status || "",
      Number(o.lyrics_version) || 0,
      o.special || "",
      now(),
      now(),
      o.stage === "livree" ? now() : null,
    );
  return getOrder(Number(r.lastInsertRowid));
}

export function deleteOrder(id) {
  db.prepare("DELETE FROM orders WHERE id = ?").run(id);
}

/** Chiffres pour l'onglet Ventes. */
export function salesStats() {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const m = monthStart.getTime();
  const week = now() - 7 * 86400_000;
  const one = (sql, ...a) => Object.values(db.prepare(sql).get(...a))[0] || 0;
  const byStage = Object.fromEntries(STAGES.map((st) => [st, 0]));
  for (const r of db.prepare("SELECT stage, COUNT(*) AS n FROM orders GROUP BY stage").all()) byStage[r.stage] = r.n;
  // Encaissements par semaine (8 dernières semaines), d'après la date de mise à jour des commandes payées.
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const end = now() - i * 7 * 86400_000;
    const start = end - 7 * 86400_000;
    weeks.push({
      start,
      paid: one("SELECT SUM(paid) FROM orders WHERE paid > 0 AND updated_at > ? AND updated_at <= ?", start, end),
      delivered: one("SELECT COUNT(*) FROM orders WHERE delivered_at > ? AND delivered_at <= ?", start, end),
    });
  }
  return {
    clients: one("SELECT COUNT(*) FROM contacts WHERE channel != 'test'"),
    new_clients_week: one("SELECT COUNT(*) FROM contacts WHERE channel != 'test' AND created_at > ?", week),
    active_week: one(
      "SELECT COUNT(DISTINCT m.contact_id) FROM messages m JOIN contacts c ON c.id = m.contact_id WHERE c.channel != 'test' AND m.author = 'client' AND m.created_at > ?",
      week,
    ),
    open_orders: OPEN_STAGES.reduce((a, st) => a + byStage[st], 0),
    delivered_month: one("SELECT COUNT(*) FROM orders WHERE delivered_at > ?", m),
    paid_month: one("SELECT SUM(paid) FROM orders WHERE updated_at > ? AND paid > 0", m),
    paid_total: one("SELECT SUM(paid) FROM orders"),
    due_total: one(`SELECT SUM(price - paid) FROM orders WHERE price > paid AND stage IN (${OPEN_STAGES.map(() => "?").join(",")})`, ...OPEN_STAGES),
    songs_made: one("SELECT COUNT(*) FROM messages WHERE kind = 'audio' AND author = 'agent' AND media_path IS NOT NULL"),
    needs_human: one("SELECT COUNT(*) FROM contacts WHERE needs_human = 1 AND channel != 'test'"),
    by_stage: byStage,
    weeks,
  };
}

// ---------- Contacts ignorés ----------
const digits = (v) => String(v || "").replace(/@.*$/, "").replace(/\D/g, "").replace(/^0+/, "");

/** Un contact est ignoré si son numéro (ou pseudo) est dans la liste « ne jamais répondre ». */
export function isIgnored(contact, list = getSettings().ignored_contacts) {
  if (!contact || !Array.isArray(list) || !list.length) return false;
  const ids = [contact.external_id, contact.meta?.phone].map(digits).filter((d) => d.length >= 6);
  const names = [contact.meta?.username, contact.name].filter(Boolean).map((n) => String(n).toLowerCase().replace(/^@/, ""));
  return list.some((raw) => {
    const entry = String(raw).trim();
    if (!entry) return false;
    const d = digits(entry);
    // Numéro : on accepte avec ou sans indicatif du pays (comparaison par la fin).
    if (d.length >= 6 && /^[+\d\s().-]+$/.test(entry)) return ids.some((id) => id.endsWith(d) || d.endsWith(id));
    return names.includes(entry.toLowerCase().replace(/^@/, ""));
  });
}

/** Identifiant le plus parlant d'un contact pour la liste des ignorés. */
export function contactKey(contact) {
  const phone = digits(contact.meta?.phone) || digits(contact.external_id);
  if (phone.length >= 6) return phone;
  return contact.meta?.username ? "@" + contact.meta.username : contact.external_id;
}

// ---------- Crédits ----------
export function logCredits({ contactId = null, kind, credits, balanceAfter = null }) {
  if (!(credits > 0)) return;
  db.prepare("INSERT INTO credit_log(contact_id, kind, credits, balance_after, created_at) VALUES(?,?,?,?,?)").run(
    contactId,
    kind,
    credits,
    balanceAfter,
    now(),
  );
  if (contactId) db.prepare("UPDATE contacts SET credits_used = credits_used + ? WHERE id = ?").run(credits, contactId);
}

export function creditStats() {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  const month = new Date(day);
  month.setDate(1);
  const sum = (since) => db.prepare("SELECT COALESCE(SUM(credits), 0) AS n FROM credit_log WHERE created_at >= ?").get(since).n;
  const byKind = Object.fromEntries(
    db.prepare("SELECT kind, SUM(credits) AS n FROM credit_log WHERE created_at >= ? GROUP BY kind").all(month.getTime()).map((r) => [r.kind, r.n]),
  );
  const conv = db
    .prepare("SELECT COUNT(DISTINCT contact_id) AS c, COALESCE(SUM(credits),0) AS n FROM credit_log WHERE kind = 'reply' AND contact_id IS NOT NULL")
    .get();
  const replies = db.prepare("SELECT COUNT(*) AS c, COALESCE(SUM(credits),0) AS n FROM credit_log WHERE kind = 'reply'").get();
  const last = db.prepare("SELECT balance_after FROM credit_log WHERE balance_after IS NOT NULL ORDER BY id DESC LIMIT 1").get();
  return {
    today: sum(day.getTime()),
    month: sum(month.getTime()),
    by_kind_month: byKind,
    per_conversation: conv.c ? conv.n / conv.c : 0,
    per_reply: replies.c ? replies.n / replies.c : 0,
    last_balance: last?.balance_after ?? null,
  };
}

/** Clients à relancer maintenant (relance prévue arrivée à échéance). */
export function dueReminders(at = now()) {
  return db.prepare("SELECT id FROM contacts WHERE remind_at > 0 AND remind_at <= ? AND channel != 'test'").all(at).map((r) => r.id);
}

/** Dernière chanson livrée à ce client (depuis moins de `days` jours). */
export function lastDeliveredOrder(contactId, days = 14) {
  return db
    .prepare("SELECT * FROM orders WHERE contact_id = ? AND stage = 'livree' AND delivered_at > ? ORDER BY delivered_at DESC LIMIT 1")
    .get(contactId, now() - days * 24 * 3600_000);
}

/** Commandes dont le texte doit être envoyé maintenant. */
export function dueLyrics(at = now()) {
  return db.prepare("SELECT * FROM orders WHERE lyrics_status = 'writing' AND lyrics_due_at <= ?").all(at);
}

/** Commande dont un message (notification de paiement) attend ta réaction. */
export function findContactByOwnerNote(msgId) {
  const map = getSettings().owner_notes || {};
  return map[msgId] || null;
}
export function rememberOwnerNote(msgId, data) {
  const map = { ...(getSettings().owner_notes || {}) };
  map[msgId] = { ...data, at: now() };
  // On ne garde que les 200 dernières.
  const keys = Object.keys(map).sort((a, b) => map[a].at - map[b].at);
  for (const k of keys.slice(0, Math.max(0, keys.length - 200))) delete map[k];
  setSettings({ owner_notes: map });
}

// ---------- Surveillance : problèmes repérés ----------

/** Signale (ou re-signale) un problème ; renvoie la ligne avec le nombre de tentatives. */
export function reportIncident({ key, contactId = null, kind, text }) {
  const cur = db.prepare("SELECT * FROM incidents WHERE key = ?").get(key);
  if (cur && cur.status === "open") {
    db.prepare("UPDATE incidents SET attempts = attempts + 1, text = ?, updated_at = ? WHERE id = ?").run(text, now(), cur.id);
  } else if (cur) {
    db.prepare("UPDATE incidents SET attempts = 1, text = ?, status = 'open', notified = 0, updated_at = ? WHERE id = ?").run(text, now(), cur.id);
  } else {
    db.prepare("INSERT INTO incidents(key, contact_id, kind, text, attempts, created_at, updated_at) VALUES(?,?,?,?,1,?,?)").run(
      key, contactId, kind, text, now(), now(),
    );
  }
  return db.prepare("SELECT * FROM incidents WHERE key = ?").get(key);
}
export function markIncidentNotified(id) {
  db.prepare("UPDATE incidents SET notified = 1 WHERE id = ?").run(id);
}
/** Les problèmes ouverts qui n'ont pas été revus à ce tour sont réglés. */
export function resolveIncidentsExcept(keys) {
  const open = db.prepare("SELECT * FROM incidents WHERE status = 'open'").all();
  const gone = open.filter((i) => !keys.has(i.key));
  for (const i of gone) db.prepare("UPDATE incidents SET status = 'resolved', updated_at = ? WHERE id = ?").run(now(), i.id);
  return gone;
}
export function listIncidents({ since = 0 } = {}) {
  return db
    .prepare(
      `SELECT i.*, c.name AS contact_name, c.channel, c.external_id FROM incidents i
       LEFT JOIN contacts c ON c.id = i.contact_id WHERE i.updated_at >= ? ORDER BY i.updated_at DESC LIMIT 200`,
    )
    .all(since);
}

// ---------- Publications ----------
export function addSocialPost(p) {
  const r = db
    .prepare("INSERT INTO social_posts(text, image_url, fb_id, ig_id, status, error, created_at) VALUES(?,?,?,?,?,?,?)")
    .run(p.text, p.image_url || null, p.fb_id || null, p.ig_id || null, p.status, p.error || null, now());
  return db.prepare("SELECT * FROM social_posts WHERE id = ?").get(Number(r.lastInsertRowid));
}
export function listSocialPosts(limit = 30) {
  return db.prepare("SELECT * FROM social_posts ORDER BY id DESC LIMIT ?").all(limit);
}
export function lastPublishedPost() {
  return db.prepare("SELECT * FROM social_posts WHERE status = 'published' ORDER BY id DESC LIMIT 1").get();
}

// ---------- Sauvegarde ----------

/** Copie cohérente de toute la base (clients, conversations, réglages). Renvoie le chemin du fichier. */
export function backupDatabase() {
  const file = path.join(DATA_DIR, `sauvegarde-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

/** Prépare la restauration d'une sauvegarde (appliquée au prochain démarrage). */
export function scheduleRestore(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.subarray(0, 16).toString("latin1") !== "SQLite format 3\0") {
    throw new Error("Ce fichier n'est pas une sauvegarde de l'agent (.db).");
  }
  fs.writeFileSync(PENDING, buffer);
}
