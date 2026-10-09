// WhatsApp (ton numéro personnel/Business app) via Baileys : on scanne un QR
// code comme pour WhatsApp Web. L'historique synchronisé sert aussi à apprendre
// ta façon de répondre.
import path from "node:path";
import fs from "node:fs";
import pino from "pino";
import QRCode from "qrcode";
import {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  getContentType,
  isJidBroadcast,
  isJidGroup,
  makeWASocket,
  normalizeMessageContent,
  useMultiFileAuthState,
} from "baileys";
import { DATA_DIR, addExamples, getSettings, setSettings } from "../db.js";
import { saveMedia } from "../media.js";
import { handleIncoming, handleOwnerMessage, registerAdapter } from "../router.js";
import { buildPairs } from "../learning.js";
import { emit } from "../events.js";

const AUTH_DIR = path.join(DATA_DIR, "wa-auth");
const logger = pino({ level: "silent" });
let sock = null;
let state = { status: "déconnecté", qr: null, me: null, error: null, learned: 0 };
let stopping = false;
let retries = 0;
let generation = 0;

function setState(patch) {
  state = { ...state, ...patch };
  emit("channel", { channel: "whatsapp" });
}

function ignorable(jid) {
  return (
    !jid ||
    isJidGroup(jid) ||
    isJidBroadcast(jid) ||
    jid === "status@broadcast" ||
    jid.endsWith("@newsletter")
  );
}

function extract(msg) {
  const content = normalizeMessageContent(msg.message);
  if (!content) return null;
  const type = getContentType(content);
  const inner = content[type];
  switch (type) {
    case "conversation":
      return { kind: "text", text: content.conversation };
    case "extendedTextMessage":
      return { kind: "text", text: inner.text };
    case "audioMessage":
      return { kind: "audio", text: "", mime: inner.mimetype };
    case "imageMessage":
      return { kind: "image", text: inner.caption || "", mime: inner.mimetype };
    case "videoMessage":
    case "documentMessage":
    case "stickerMessage":
      return { kind: "other", text: inner?.caption || "" };
    default:
      return null; // réactions, accusés, messages système...
  }
}

async function onUpsert({ messages, type }) {
  for (const msg of messages) {
    try {
      const jid = msg.key.remoteJid;
      if (ignorable(jid)) continue;
      const data = extract(msg);
      if (!data) continue;
      const ts = Number(msg.messageTimestamp || 0) * 1000 || Date.now();
      const recent = Date.now() - ts < 5 * 60_000;

      if (msg.key.fromMe) {
        // Message que TU as tapé sur ton téléphone : prise de main + apprentissage.
        if (recent) {
          handleOwnerMessage({
            channel: "whatsapp",
            externalId: jid,
            text: data.text,
            kind: data.kind,
            externalMsgId: msg.key.id,
          });
        }
        continue;
      }
      if (type !== "notify" || !recent) continue;

      let media;
      if (data.kind === "audio" || data.kind === "image") {
        const buf = await downloadMediaMessage(msg, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
        media = saveMedia(buf, data.mime);
      }
      await handleIncoming({
        channel: "whatsapp",
        externalId: jid,
        name: msg.pushName,
        kind: data.kind,
        text: data.text,
        media,
        externalMsgId: msg.key.id,
        createdAt: ts,
        meta: { phone: (msg.key.remoteJidAlt || jid).split("@")[0] },
      });
    } catch (e) {
      console.error("WhatsApp message :", e);
    }
  }
}

// Historique synchronisé à la connexion -> exemples de style.
function onHistory({ messages }) {
  const byChat = new Map();
  for (const msg of messages || []) {
    const jid = msg.key?.remoteJid;
    if (ignorable(jid)) continue;
    const data = extract(msg);
    if (!data?.text) continue;
    if (!byChat.has(jid)) byChat.set(jid, []);
    byChat.get(jid).push({
      author: msg.key.fromMe ? "__owner__" : "client",
      text: data.text,
      ts: Number(msg.messageTimestamp || 0),
    });
  }
  let added = 0;
  for (const list of byChat.values()) {
    list.sort((a, b) => a.ts - b.ts);
    added += addExamples(buildPairs(list, "__owner__"), "whatsapp-history");
  }
  if (added) setState({ learned: state.learned + added });
}

export async function startWhatsApp() {
  stopping = false;
  const gen = ++generation;
  const old = sock;
  sock = null;
  try {
    old?.end(undefined); // ses événements seront ignorés (génération périmée)
  } catch {}
  setSettings({ whatsapp_enabled: true });
  const { state: auth, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
  setState({ status: "connexion…", error: null });
  if (gen !== generation) return;
  const me = makeWASocket({
    version,
    auth,
    logger,
    browser: Browsers.macOS("Desktop"),
    syncFullHistory: true,
    markOnlineOnConnect: false, // tu continues à recevoir les notifications sur ton téléphone
  });
  sock = me;
  const current = () => gen === generation && !stopping;
  me.ev.on("creds.update", saveCreds);
  me.ev.on("connection.update", async (u) => {
    if (gen !== generation) return;
    if (u.qr) setState({ status: "scanne le QR code", qr: await QRCode.toDataURL(u.qr) });
    if (u.connection === "open") {
      retries = 0;
      setState({ status: "connecté", qr: null, error: null, me: sock.user?.id?.split(":")[0] || sock.user?.id });
    }
    if (u.connection === "close") {
      const code = u.lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        setState({ status: "déconnecté (session fermée sur le téléphone)", qr: null, me: null });
        if (current()) setTimeout(() => current() && startWhatsApp().catch(() => {}), 1000);
      } else if (current()) {
        // Nouvelle tentative avec un délai qui grandit (3 s, 6 s, 12 s… max 2 min).
        const wait = Math.min(120_000, 3000 * 2 ** retries++);
        setState({ status: "reconnexion…", error: u.lastDisconnect?.error?.message || null });
        setTimeout(() => current() && startWhatsApp().catch((e) => setState({ status: "erreur", error: e.message })), wait);
      }
    }
  });
  me.ev.on("messages.upsert", (e) => current() && onUpsert(e));
  me.ev.on("messaging-history.set", (e) => current() && onHistory(e));
}

export async function stopWhatsApp({ logout = false } = {}) {
  stopping = true;
  generation++;
  setSettings({ whatsapp_enabled: false });
  try {
    if (logout) await sock?.logout();
    else sock?.end(undefined);
  } catch {}
  if (logout) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  sock = null;
  setState({ status: "déconnecté", qr: null, me: null });
}

export function whatsappStatus() {
  return state;
}

registerAdapter({
  channel: "whatsapp",
  async send(contact, text) {
    if (!sock || state.status !== "connecté") throw new Error("WhatsApp n'est pas connecté");
    const r = await sock.sendMessage(contact.external_id, { text });
    await sock.sendPresenceUpdate("paused", contact.external_id).catch(() => {});
    return r?.key?.id;
  },
  async typing(contact) {
    await sock?.sendPresenceUpdate("composing", contact.external_id);
  },
  async markRead(contact, msgs) {
    const keys = msgs
      .filter((m) => m.external_id)
      .map((m) => ({ remoteJid: contact.external_id, id: m.external_id, fromMe: false }));
    if (keys.length) await sock?.readMessages(keys);
  },
});

export function maybeAutoStartWhatsApp() {
  if (getSettings().whatsapp_enabled && fs.existsSync(path.join(AUTH_DIR, "creds.json"))) {
    startWhatsApp().catch((e) => setState({ status: "erreur", error: e.message }));
  }
}
