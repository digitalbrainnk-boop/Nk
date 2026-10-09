// Stockage local (SQLite intégré à Node) : contacts, messages, mémoire,
// exemples de style, base de connaissances et réglages.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = path.resolve(process.env.DATA_DIR || "data");
fs.mkdirSync(path.join(DATA_DIR, "media"), { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, "agent.db"));
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
  const allowed = ["name", "memory", "paused_until", "needs_human", "needs_human_reason", "unread"];
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
  db.prepare("DELETE FROM messages WHERE contact_id = ?").run(id);
  db.prepare("DELETE FROM contacts WHERE id = ?").run(id);
}

// ---------- Messages ----------
export function addMessage(contactId, msg) {
  const r = db
    .prepare(
      `INSERT INTO messages(contact_id, author, kind, text, media_path, media_type, status, external_id, answered, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      contactId,
      msg.author,
      msg.kind || "text",
      msg.text || "",
      msg.media_path || null,
      msg.media_type || null,
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
