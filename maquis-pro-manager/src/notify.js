// Notifications : centre de notifications dans l'application (Android, iPhone, Web),
// mises à jour en temps réel, et notifications push (même application fermée) via Web Push.
import { EventEmitter } from "node:events";
import webpush from "web-push";
import { all, get, run, afterCommit, getSetting, setSetting } from "./db.js";
import { now } from "./time.js";

export const bus = new EventEmitter();
bus.setMaxListeners(500);

export const NOTIF_TYPES = {
  entry: "Nouvelle entrée de marchandises",
  exit: "Nouvelle sortie (offerte, cassée, perdue…)",
  sale: "Nouvelle vente",
  expense: "Nouvelle dépense",
  cash_variance: "Écart de caisse",
  low_stock: "Stock faible",
  out_of_stock: "Rupture de stock",
  cash_close: "Fermeture de caisse",
  daily_report: "Nouveau bilan quotidien",
  weekly_report: "Nouveau bilan hebdomadaire",
  security: "Connexion inhabituelle et sécurité",
  exceptional: "Opération exceptionnelle (annulation, écart d'inventaire…)",
  sync: "Synchronisation hors connexion",
};
// Par défaut : tout en push, sauf chaque vente (seulement dans l'application, pour ne pas inonder le téléphone).
const DEFAULT_PREFS = Object.fromEntries(Object.keys(NOTIF_TYPES).map((k) => [k, k === "sale" ? "app" : "push"]));

export function getPrefs(userId) {
  return { ...DEFAULT_PREFS, ...(getSetting(`prefs_${userId}`) || {}) };
}
export function setPrefs(userId, prefs) {
  const clean = {};
  for (const k of Object.keys(NOTIF_TYPES)) if (["push", "app", "off"].includes(prefs?.[k])) clean[k] = prefs[k];
  setSetting(`prefs_${userId}`, clean);
  return getPrefs(userId);
}

// Envoie une notification aux comptes visés (par rôle et/ou par identifiant).
export function notify({ roles = [], userIds = [], type, title, body = "", link = "", severity = "info", exceptUserId = null }) {
  const ids = new Set(userIds);
  if (roles.length) {
    for (const u of all(`SELECT id FROM users WHERE active = 1 AND role IN (${roles.map(() => "?").join(",")})`, ...roles)) ids.add(u.id);
  }
  if (exceptUserId) ids.delete(exceptUserId);
  const at = now();
  const pushes = [];
  for (const id of ids) {
    const pref = getPrefs(id)[type] || "push";
    if (pref === "off") continue;
    const nid = Number(run("INSERT INTO notifications (at, user_id, type, severity, title, body, link) VALUES (?,?,?,?,?,?,?)", at, id, type, severity, title, body, link).lastInsertRowid);
    pushes.push({ userId: id, nid, pref });
  }
  afterCommit(() => {
    for (const p of pushes) {
      bus.emit("event", { userId: p.userId, type: "notification", data: { id: p.nid, title, body, link, severity, notif_type: type } });
      if (p.pref === "push") sendPush(p.userId, { title, body, link, tag: `${type}-${p.nid}` }).catch(() => {});
    }
  });
}

// Signal temps réel (sans notification) : par ex. nouvelle commande pour les caissiers.
export function signal(roles, type, data = {}) {
  afterCommit(() => bus.emit("event", { roles, type, data }));
}

export function listNotifications(userId, { limit = 50, before } = {}) {
  const rows = before
    ? all("SELECT * FROM notifications WHERE user_id = ? AND id < ? ORDER BY id DESC LIMIT ?", userId, before, limit)
    : all("SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?", userId, limit);
  return { items: rows, unread: unreadCount(userId) };
}
export const unreadCount = (userId) => get("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL", userId).n;
export function markRead(userId, ids) {
  const t = now();
  if (ids === "all") run("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL", t, userId);
  else for (const id of ids || []) run("UPDATE notifications SET read_at = ? WHERE user_id = ? AND id = ? AND read_at IS NULL", t, userId, Number(id));
  return unreadCount(userId);
}

// ---------- Web Push (clés VAPID créées une fois et conservées) ----------
let vapidReady = false;
export function vapidPublicKey() {
  let keys = getSetting("vapid");
  if (!keys?.publicKey) {
    keys = webpush.generateVAPIDKeys();
    setSetting("vapid", keys);
  }
  if (!vapidReady) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:contact@maquis-pro-manager.app", keys.publicKey, keys.privateKey);
    vapidReady = true;
  }
  return keys.publicKey;
}

export function saveSubscription(userId, sub, ua = "") {
  if (!sub || typeof sub.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return false;
  run(
    `INSERT INTO push_subscriptions (user_id, endpoint, keys, user_agent, created_at) VALUES (?,?,?,?,?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, keys = excluded.keys, user_agent = excluded.user_agent`,
    userId, sub.endpoint.slice(0, 1000), JSON.stringify({ p256dh: String(sub.keys.p256dh).slice(0, 200), auth: String(sub.keys.auth).slice(0, 100) }), ua.slice(0, 300), now(),
  );
  return true;
}
export function removeSubscription(userId, endpoint) {
  run("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?", userId, String(endpoint || ""));
}

export async function sendPush(userId, payload) {
  if (process.env.NODE_ENV === "test") return;
  const subs = all("SELECT * FROM push_subscriptions WHERE user_id = ?", userId);
  if (!subs.length) return;
  vapidPublicKey();
  const body = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys) }, body, { TTL: 86400 });
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) run("DELETE FROM push_subscriptions WHERE id = ?", s.id);
      }
    }),
  );
}
