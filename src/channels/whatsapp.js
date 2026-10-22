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
import { flushOutbox, handleIncoming, handleOwnerMessage, handleOwnerReaction, registerAdapter } from "../router.js";
import { buildPairs } from "../learning.js";
import { emit } from "../events.js";

const AUTH_DIR = path.join(DATA_DIR, "wa-auth");
const logger = pino({ level: "silent" });
let sock = null;
let state = { status: "déconnecté", qr: null, pairingCode: null, me: null, error: null, learned: 0 };
// Numéro pour la connexion par code (utile quand l'agent tourne sur le
// téléphone lui-même : impossible de scanner son propre écran).
let pairingPhone = null;
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

// Ta propre discussion (« moi ») et le numéro où l'agent te laisse ses messages :
// ce ne sont pas des clients.
const bare = (jid) => String(jid || "").replace(/:\d+@/, "@");
function ownerJid() {
  const d = String(getSettings().owner_whatsapp || "").replace(/\D/g, "");
  return d ? `${d}@s.whatsapp.net` : bare(sock?.user?.id);
}
// WhatsApp désigne souvent une discussion par un identifiant « @lid » plutôt que par le
// numéro : on retrouve celui de ton numéro « propriétaire » (gardé en mémoire).
let ownerLid = { pn: "", lid: "" };
async function refreshOwnerLid() {
  const pn = getSettings().owner_whatsapp ? ownerJid() : "";
  if (!pn || ownerLid.pn === pn) return;
  const lid = await sock?.signalRepository?.lidMapping?.getLIDForPN?.(pn).catch(() => null);
  ownerLid = { pn, lid: lid ? bare(lid) : "" };
}
/** Le numéro « propriétaire » réglé dans les Réglages (pas ton propre numéro). */
function isOwnerNumber(...jids) {
  if (!getSettings().owner_whatsapp) return false;
  const pn = ownerJid();
  return jids.some((j) => j && (bare(j) === pn || (ownerLid.pn === pn && ownerLid.lid && bare(j) === ownerLid.lid)));
}
function isOwnerChat(jid, alt) {
  const j = bare(jid);
  if (!j) return false;
  return j === bare(sock?.user?.id) || j === bare(sock?.user?.lid) || j === ownerJid() || isOwnerNumber(jid, alt);
}

const seenReactions = new Set();
function onReaction({ chatJid, chatAlt, targetId, emoji, fromMe, reactionId }) {
  // Seule TA réaction compte (depuis ton WhatsApp, ou depuis ton numéro « propriétaire »
  // dans la discussion où l'agent te prévient) ; celle d'un client est toujours ignorée.
  const fromOwnerNumber = isOwnerNumber(chatJid, chatAlt);
  if (!(fromMe || fromOwnerNumber) || !emoji) return;
  const k = reactionId || `${chatJid}|${targetId}|${emoji}`;
  if (seenReactions.has(k)) return;
  seenReactions.add(k);
  if (seenReactions.size > 500) seenReactions.clear();
  handleOwnerReaction({ channel: "whatsapp", chatJid, targetId, emoji, ownerChat: isOwnerChat(chatJid, chatAlt) }).catch((e) =>
    console.error("Confirmation du paiement :", e.message),
  );
}

async function onUpsert({ messages, type }) {
  await refreshOwnerLid();
  for (const msg of messages) {
    try {
      const jid = msg.key.remoteJid;
      if (ignorable(jid)) continue;
      const content = normalizeMessageContent(msg.message);
      if (content?.reactionMessage) {
        const r = content.reactionMessage;
        onReaction({ chatJid: jid, chatAlt: msg.key.remoteJidAlt, targetId: r.key?.id, emoji: r.text, fromMe: !!msg.key.fromMe, reactionId: msg.key.id });
        continue;
      }
      if (isOwnerChat(jid, msg.key.remoteJidAlt)) continue; // tes notes à toi-même et les messages de l'agent pour toi
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

// Raisons de coupure renvoyées par WhatsApp, expliquées simplement.
function explainClose(code, message) {
  const why = {
    401: "WhatsApp a fermé la session (appareil déconnecté depuis le téléphone).",
    403: "WhatsApp refuse ce numéro pour le moment (compte restreint) : attends quelques heures.",
    405: "WhatsApp a refusé la connexion : trop d'essais d'affilée ou limite d'appareils connectés atteinte (4 max). Supprime un ancien appareil dans « Appareils connectés » et attends 15 à 30 minutes avant de réessayer.",
    408: "Pas de réponse de WhatsApp (internet lent ou coupé).",
    428: "Connexion fermée par WhatsApp, nouvel essai…",
    440: "Ce numéro a été connecté ailleurs (un autre agent ou WhatsApp Web) : une seule connexion à la fois.",
    500: "Session abîmée : clique « Déconnecter l'appareil » puis reconnecte-toi.",
    503: "WhatsApp est momentanément indisponible.",
  }[code];
  return why || `WhatsApp a coupé la connexion (${code || "?"}${message ? ` : ${message}` : ""}).`;
}

// Une session commencée mais jamais validée (QR non scanné, code non saisi)
// bloque les tentatives suivantes : on repart de zéro.
function clearUnfinishedSession() {
  try {
    const creds = JSON.parse(fs.readFileSync(path.join(AUTH_DIR, "creds.json"), "utf8"));
    if (creds.registered) return false;
  } catch {
    // pas de session enregistrée
  }
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  return true;
}

export async function startWhatsApp({ phone } = {}) {
  if (phone !== undefined) {
    pairingPhone = String(phone || "").replace(/\D/g, "").replace(/^0+/, "") || null;
    // Nouvelle demande de connexion (code ou QR) : on efface l'essai précédent non abouti.
    clearUnfinishedSession();
    // Le code d'appairage exige le navigateur par défaut de Baileys ; on garde ce choix ensuite.
    setSettings({ wa_browser: pairingPhone ? "chrome" : "desktop" });
  }
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
  setState({ status: "connexion…", error: null, pairingCode: null });
  if (gen !== generation) return;
  const me = makeWASocket({
    version,
    auth,
    logger,
    // « Desktop » récupère tout l'historique (QR) ; « Chrome » est requis pour le code d'appairage.
    browser: getSettings().wa_browser === "chrome" ? Browsers.macOS("Chrome") : Browsers.macOS("Desktop"),
    syncFullHistory: true,
    markOnlineOnConnect: false, // tu continues à recevoir les notifications sur ton téléphone
  });
  sock = me;
  const current = () => gen === generation && !stopping;
  me.ev.on("creds.update", saveCreds);
  me.ev.on("connection.update", async (u) => {
    if (gen !== generation) return;
    if (u.qr) {
      if (pairingPhone && !auth.creds.registered) {
        // WhatsApp est prêt : on demande un code à 8 caractères au lieu du QR.
        if (!state.pairingCode) {
          try {
            const code = (await me.requestPairingCode(pairingPhone)).match(/.{1,4}/g).join("-");
            setState({ status: "tape le code dans WhatsApp", qr: null, pairingCode: code });
            console.log(`\n📱 CODE WHATSAPP : ${code}\n   Dans WhatsApp : Appareils connectés → Connecter un appareil → « Associer avec le numéro de téléphone »\n`);
          } catch (e) {
            setState({ status: "erreur", error: `Code impossible : ${e.message}` });
          }
        }
      } else {
        setState({ status: "scanne le QR code", pairingCode: null, qr: await QRCode.toDataURL(u.qr) });
      }
    }
    if (u.connection === "open") {
      retries = 0;
      pairingPhone = null;
      setState({ status: "connecté", qr: null, pairingCode: null, error: null, me: sock.user?.id?.split(":")[0] || sock.user?.id });
      console.log("✅ WhatsApp connecté à l'agent");
      // Ce qui n'a pas pu partir pendant la coupure repart tel quel.
      setTimeout(() => flushOutbox().catch((e) => console.error("File d'envoi :", e.message)), 3000);
    }
    if (u.connection === "close") {
      const code = u.lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        setState({ status: "déconnecté (session fermée sur le téléphone)", qr: null, me: null });
        if (current()) setTimeout(() => current() && startWhatsApp().catch(() => {}), 1000);
      } else if (code === DisconnectReason.restartRequired && current()) {
        // Normal juste après le QR ou le code : WhatsApp demande de rouvrir la connexion tout de suite.
        setState({ status: "code accepté ✓ — finalisation de la connexion…", qr: null, pairingCode: null, error: null });
        console.log("✓ WhatsApp a accepté l'appareil, finalisation de la connexion…");
        setTimeout(() => current() && startWhatsApp().catch((e) => setState({ status: "erreur", error: e.message })), 500);
      } else if (current()) {
        // Nouvelle tentative avec un délai qui grandit (3 s, 6 s, 12 s… max 2 min).
        const wait = Math.min(120_000, 3000 * 2 ** retries++);
        const why = explainClose(code, u.lastDisconnect?.error?.message);
        console.log(`⚠️  WhatsApp : ${why} Nouvel essai dans ${Math.round(wait / 1000)} s.`);
        setState({ status: `reconnexion dans ${Math.round(wait / 1000)} s…`, error: why });
        setTimeout(() => current() && startWhatsApp().catch((e) => setState({ status: "erreur", error: e.message })), wait);
      }
    }
  });
  me.ev.on("messages.upsert", (e) => current() && onUpsert(e));
  me.ev.on("messages.reaction", async (list) => {
    if (!current()) return;
    await refreshOwnerLid();
    for (const r of list || []) {
      onReaction({
        chatJid: r.key?.remoteJid,
        chatAlt: r.key?.remoteJidAlt,
        targetId: r.key?.id,
        emoji: r.reaction?.text,
        fromMe: !!r.reaction?.key?.fromMe,
        reactionId: r.reaction?.key?.id,
      });
    }
  });
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
  setState({ status: "déconnecté", qr: null, pairingCode: null, me: null });
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
  async recording(contact) {
    await sock?.sendPresenceUpdate("recording", contact.external_id);
  },
  async sendAudio(contact, { path: file, mime, voice, voiceNote }) {
    if (!sock || state.status !== "connecté") throw new Error("WhatsApp n'est pas connecté");
    // ptt = note vocale (micro vert) ; WhatsApp l'exige en OGG/Opus.
    const r = await sock.sendMessage(contact.external_id, {
      audio: fs.readFileSync(file),
      mimetype: mime || "audio/mpeg",
      ptt: !!(voice && voiceNote),
    });
    await sock.sendPresenceUpdate("paused", contact.external_id).catch(() => {});
    return r?.key?.id;
  },
  // Message pour TOI (sur ton numéro, ou ta propre discussion « moi »).
  async notifyOwner(text, { imagePath, imageMime } = {}) {
    if (!sock || state.status !== "connecté") throw new Error("WhatsApp n'est pas connecté");
    const to = ownerJid();
    let r;
    if (imagePath) {
      r = await sock.sendMessage(to, { image: fs.readFileSync(imagePath), mimetype: imageMime || "image/jpeg", caption: text });
    } else {
      r = await sock.sendMessage(to, { text });
    }
    return r?.key?.id;
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
