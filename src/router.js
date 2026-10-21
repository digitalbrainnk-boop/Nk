// Le chef d'orchestre : reçoit les messages de tous les canaux, attend que le
// client ait fini d'écrire, demande la réponse à l'agent puis l'envoie avec un
// rythme humain (délai, "en train d'écrire...", plusieurs bulles).
import {
  activeOrder,
  addExamples,
  dueLyrics,
  dueReminders,
  pendingMessages,
  agentRepliesSince,
  getOrder,
  isPaid,
  findContactByOwnerNote,
  isIgnored,
  rememberOwnerNote,
  logCredits,
  addMessage,
  db,
  getContact,
  getMessage,
  getSettings,
  listMessages,
  markAnswered,
  messageExists,
  unansweredClientMessages,
  updateContact,
  updateMessage,
  upsertContact,
  saveOrder,
} from "./db.js";
import { friendlyError, generateReply, songBrief } from "./agent.js";
import { transcribe } from "./media.js";
import { emitHook } from "./integrations.js";
import { withCredits } from "./credits.js";

const who = (c) => ({ id: c.id, name: c.name, channel: c.channel, phone: c.meta?.phone || null });
import { emit } from "./events.js";

const adapters = new Map();
export function registerAdapter(adapter) {
  adapters.set(adapter.channel, adapter);
}
export function getAdapter(channel) {
  return adapters.get(channel);
}

// Remplaçable dans les tests pour ne pas appeler l'API.
let replyGenerator = generateReply;
export function setReplyGenerator(fn) {
  replyGenerator = fn;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const timers = new Map();
const busy = new Set();
const rerun = new Set();

// Ce que l'agent vient d'envoyer : sert à ne pas confondre l'écho de nos
// propres messages avec une prise de main du propriétaire.
const recentlySent = new Map(); // clé -> expiration
function rememberSent(channel, externalId, text, msgId) {
  const exp = Date.now() + 3 * 60_000;
  if (msgId) recentlySent.set(`id:${msgId}`, exp);
  recentlySent.set(`txt:${channel}:${externalId}:${(text || "").trim()}`, exp);
}
function wasSentByUs(channel, externalId, text, msgId) {
  const t = Date.now();
  for (const [k, exp] of recentlySent) if (exp < t) recentlySent.delete(k);
  return (
    (msgId && recentlySent.has(`id:${msgId}`)) ||
    recentlySent.has(`txt:${channel}:${externalId}:${(text || "").trim()}`)
  );
}

export function channelMode(channel) {
  const s = getSettings();
  if (channel === "test") return "auto";
  if (channel === "whatsapp" && s.whatsapp_learning_only) return "off";
  return s.channel_modes?.[channel] || s.reply_mode || "draft";
}

/**
 * Message entrant d'un client.
 * @param {{channel:string, externalId:string, name?:string, kind?:string, text?:string,
 *   media?:{path:string, mime:string}, externalMsgId?:string, meta?:object, createdAt?:number,
 *   noReply?:boolean}} input
 */
export async function handleIncoming(input) {
  const contact = upsertContact(input.channel, input.externalId, input.name, input.meta);
  if (messageExists(contact.id, input.externalMsgId)) return;

  let text = input.text || "";
  let kind = input.kind || "text";
  // Un client qui inonde l'agent n'obtient plus de transcriptions (protection des crédits).
  const flooding = (Number(getSettings().max_replies_per_hour) || 0) > 0 &&
    agentRepliesSince(contact.id, Date.now() - 3600_000) >= Number(getSettings().max_replies_per_hour);
  if (kind === "audio" && input.media && flooding) {
    text = "(vocal non transcrit : trop de messages de ce client en une heure)";
  } else if (kind === "audio" && input.media) {
    const t = await transcribe(input.media.path, input.media.mime, { contactId: contact.id }).catch((e) => {
      console.error("Transcription :", e.message);
      return null;
    });
    text = t ?? "(vocal reçu mais pas compris — Réglages → « Comprendre les vocaux des clients »)";
  }

  const msg = addMessage(contact.id, {
    author: "client",
    kind,
    text,
    media_path: input.media?.path,
    media_type: input.media?.mime,
    status: "received",
    external_id: input.externalMsgId,
    created_at: input.createdAt,
  });
  updateContact(contact.id, { unread: (getContact(contact.id).unread || 0) + 1, followups: 0 });
  emit("message", { contact_id: contact.id, message: msg });
  emitHook("message.received", { contact: who(contact), message: { id: msg.id, kind, text } });
  if (input.noReply) {
    markAnswered(contact.id);
    return;
  }
  schedule(contact.id);
}

/**
 * Message écrit par le propriétaire lui-même depuis son téléphone : on
 * l'enregistre, on apprend de lui et on met l'agent en pause pour ce contact.
 */
export function handleOwnerMessage({ channel, externalId, name, text, externalMsgId, kind }) {
  if (wasSentByUs(channel, externalId, text, externalMsgId)) return;
  const contact = upsertContact(channel, externalId, name);
  if (messageExists(contact.id, externalMsgId)) return;
  learnFromOwnerReply(contact.id, text);
  const msg = addMessage(contact.id, {
    author: "owner",
    kind: kind || "text",
    text: text || "",
    external_id: externalMsgId,
  });
  const s = getSettings();
  const pausedUntil = Date.now() + s.owner_takeover_hours * 3600_000;
  updateContact(contact.id, { paused_until: pausedUntil, needs_human: 0, needs_human_reason: null });
  markAnswered(contact.id);
  cancel(contact.id);
  emit("message", { contact_id: contact.id, message: msg });
  emit("contact", { contact_id: contact.id });
}

function learnFromOwnerReply(contactId, ownerText) {
  if (!ownerText?.trim()) return;
  const pending = unansweredClientMessages(contactId);
  const clientText = pending.map((m) => m.text).filter(Boolean).join("\n");
  if (clientText) addExamples([{ client_text: clientText, owner_reply: ownerText }], "live");
}

export function schedule(contactId, delaySeconds) {
  cancel(contactId);
  const contact = getContact(contactId);
  const s = getSettings();
  const wait = delaySeconds ?? (contact?.channel === "test" ? 1 : s.debounce_seconds);
  timers.set(
    contactId,
    setTimeout(() => {
      timers.delete(contactId);
      processContact(contactId).catch((e) => {
        const message = friendlyError(e);
        console.error(`⚠️  Erreur agent (contact ${contactId}) : ${message}`);
        updateContact(contactId, { needs_human: 1, needs_human_reason: `Erreur : ${message}` });
        emit("contact", { contact_id: contactId });
        emit("error", { contact_id: contactId, message });
      });
    }, wait * 1000),
  );
}

/** L'agent est en train de traiter (ou va traiter) ce client. */
export function isBusy(contactId) {
  return busy.has(contactId) || timers.has(contactId);
}

function cancel(contactId) {
  const t = timers.get(contactId);
  if (t) clearTimeout(t);
  timers.delete(contactId);
}

/** L'agent répond-il à cette heure ? (de open_hour à close_hour ; 0 = minuit) */
export function isOpen(date = new Date()) {
  const s = getSettings();
  const open = Number(s.open_hour) || 0;
  const close = Number(s.close_hour) || 24;
  if (open === close % 24) return true; // ouvert 24 h/24
  const h = date.getHours();
  return open < close ? h >= open && h < close : h >= open || h < close;
}
function msUntilOpen(date = new Date()) {
  const s = getSettings();
  const next = new Date(date);
  next.setHours(Number(s.open_hour) || 0, 0, 0, 0);
  if (next <= date) next.setDate(next.getDate() + 1);
  return next - date;
}

function rand(min, max) {
  return min + Math.random() * Math.max(0, max - min);
}

async function processContact(contactId) {
  if (busy.has(contactId)) {
    rerun.add(contactId);
    return;
  }
  busy.add(contactId);
  try {
    await runAgent(contactId);
  } finally {
    busy.delete(contactId);
    if (rerun.delete(contactId)) schedule(contactId, 1);
  }
}

async function runAgent(contactId) {
  let contact = getContact(contactId);
  if (!contact) return;
  const mode = channelMode(contact.channel);
  if (mode === "off") return;
  if (contact.paused_until > Date.now()) return;
  if (isIgnored(contact)) {
    markAnswered(contactId); // numéro dans la liste « ne jamais répondre »
    return;
  }
  const pending = unansweredClientMessages(contactId);
  if (!pending.length) return;
  // Protection : un client (ou un robot) qui envoie des messages sans arrêt ne vide pas tes crédits.
  const maxPerHour = Number(getSettings().max_replies_per_hour) || 0;
  if (contact.channel !== "test" && maxPerHour > 0 && agentRepliesSince(contactId, Date.now() - 3600_000) >= maxPerHour) {
    markAnswered(contactId);
    if (!String(contact.needs_human_reason || "").startsWith("🛑")) {
      const reason = `🛑 Ce client a reçu ${maxPerHour} réponses en une heure : l'agent fait une pause avec lui (protection de tes crédits). Réponds-lui toi-même si besoin.`;
      updateContact(contactId, { needs_human: 1, needs_human_reason: reason });
      emit("contact", { contact_id: contactId });
      notifyOwner(contact, reason, { plain: true }).catch(() => {});
    }
    return;
  }
  // Hors des heures d'ouverture : on répondra à l'ouverture (avec un petit décalage, comme un humain).
  if (contact.channel !== "test" && !isOpen()) {
    schedule(contactId, Math.round(msUntilOpen() / 1000 + rand(1, 15) * 60));
    return;
  }
  const lastPendingId = pending[pending.length - 1].id;

  const s = getSettings();
  const isTest = contact.channel === "test";
  const adapter = adapters.get(contact.channel);

  // Délai de "lecture" : un humain ne répond pas à la seconde.
  if (!isTest && mode === "auto") {
    await sleep(rand(s.min_reply_delay_seconds, s.max_reply_delay_seconds) * 1000);
    await adapter?.markRead?.(contact, pending).catch(() => {});
  }

  emit("thinking", { contact_id: contactId, on: true });
  let reply;
  try {
    reply = await withCredits({ contactId, kind: "reply" }, () =>
      replyGenerator(contact, { onAction: (r) => noteAction(contactId, r) }),
    );
  } finally {
    emit("thinking", { contact_id: contactId, on: false });
  }

  // Le client a écrit autre chose pendant qu'on réfléchissait : on recommence
  // avec tout le contexte, comme le ferait une personne.
  const newer = unansweredClientMessages(contactId).some((m) => m.id > lastPendingId);
  if (newer) {
    rerun.add(contactId);
    return;
  }
  contact = getContact(contactId);
  if (contact.paused_until > Date.now()) return; // le propriétaire a pris la main entre-temps

  const lastPending = pending[pending.length - 1];
  await applyReply(contact, reply, mode, { clientSentVoice: lastPending.kind === "audio" });
  if (reply.special_request) await handleSpecialRequest(contactId, reply.special_request);
  if (reply.asked_review && reply.messages.length) updateContact(contactId, { review_asked_at: Date.now() });
  if (reply.discount_request) await handleDiscountRequest(contactId, reply.discount_request);
  if (reply.remind_in_days > 0) planReminder(contactId, reply.remind_in_days, reply.remind_about);
  if (reply.song_step && reply.song_step !== "none") {
    await handleSongStep(contactId, reply, mode).catch((e) => {
      console.error("Chanson :", e.message);
      const note = addMessage(contactId, { author: "system", kind: "note", text: `⚠️ Chanson : ${friendlyError(e)}`, status: "note" });
      emit("message", { contact_id: contactId, message: note });
    });
  }
}

// Trace visible (pour toi seulement) des actions lancées par l'agent.
function noteAction(contactId, r) {
  const msg = addMessage(contactId, {
    author: "system",
    kind: "note",
    text: `🔌 ${r.name} : ${r.ok ? "ok" : "échec"} — ${String(r.result).slice(0, 200)}`,
    status: "note",
  });
  emit("message", { contact_id: contactId, message: msg });
}

/** Enregistre la commande proposée par l'agent (jamais les paiements). */
function applyOrder(contactId, o) {
  if (!o) return;
  // Seuls ces champs viennent de l'IA (jamais le montant payé, le texte ou le statut).
  const ALLOWED = ["stage", "title", "occasion", "price", "due_date"];
  const clean = Object.fromEntries(
    Object.entries(o).filter(([k, v]) => ALLOWED.includes(k) && v !== null && v !== undefined && v !== ""),
  );
  if (clean.stage && !["nouveau", "devis"].includes(clean.stage)) delete clean.stage;
  if (clean.price !== undefined && !(Number(clean.price) > 0)) delete clean.price;
  if (!Object.keys(clean).length) return;
  const cur = activeOrder(contactId);
  if (cur) {
    // L'agent ne fait jamais reculer une commande déjà payée ou en création.
    if (clean.stage && ["acompte", "creation"].includes(cur.stage)) delete clean.stage;
    if (clean.stage === "nouveau" && cur.stage === "devis") delete clean.stage;
    // Un client ne peut pas faire baisser le prix en discutant avec l'agent : seul toi
    // (tableau de bord) peux baisser un prix déjà annoncé ; et rien ne change après paiement.
    if (clean.price !== undefined && cur.price > 0 && (Number(clean.price) < cur.price || isPaid(cur))) delete clean.price;
    saveOrder({ id: cur.id, ...clean });
  } else {
    saveOrder({ contact_id: contactId, stage: clean.stage || "nouveau", ...clean });
  }
  emit("order", { contact_id: contactId });
  emitHook("order.updated", { contact: who(getContact(contactId)), order: activeOrder(contactId) });
}

/** Applique une réponse de l'agent : mémoire, commande, brouillons ou envoi. */
async function applyReply(contact, reply, mode, { clientSentVoice = false, followup = false } = {}) {
  const contactId = contact.id;
  const s = getSettings();
  const isTest = contact.channel === "test";
  const adapter = adapters.get(contact.channel);
  updateContact(contactId, {
    memory: reply.memory || contact.memory,
    needs_human: reply.needs_human ? 1 : contact.needs_human,
    needs_human_reason: reply.needs_human ? reply.reason : contact.needs_human_reason,
  });
  markAnswered(contactId);
  try {
    applyOrder(contactId, reply.order);
  } catch (e) {
    console.error("Commande :", e.message);
  }
  // (Un paiement annoncé a son propre message pour toi, avec la capture.)
  if (reply.needs_human && reply.song_step !== "payment_claimed" && !reply.special_request && !reply.discount_request) notifyOwner(contact, reply.reason).catch(() => {});
  if (reply.demo) maybeAutoDemo(contactId).catch((e) => console.error("Démo :", e.message));
  if (!reply.messages.length) {
    // Silence voulu (ex. « ok merci ») ou problème : dans ce cas on l'affiche.
    if (reply.needs_human && reply.reason) {
      const note = addMessage(contactId, { author: "system", kind: "note", text: `⚠️ L'agent n'a pas répondu : ${reply.reason}`, status: "note" });
      emit("message", { contact_id: contactId, message: note });
      emit("error", { contact_id: contactId, message: `L'agent n'a pas répondu : ${reply.reason}` });
    }
    return;
  }
  if (followup) updateContact(contactId, { followups: (contact.followups || 0) + 1, last_followup_at: Date.now() });

  // Un lien (ex : ta page Facebook) part toujours en texte, pour être cliquable.
  const hasLink = reply.messages.some((m) => /https?:\/\//.test(m));
  const useVoice =
    !hasLink && (s.voice_replies === "always" || (s.voice_replies === "mirror" && clientSentVoice && !followup));

  if (mode === "draft") {
    if (useVoice) {
      // Un seul vocal : la voix est créée au moment où tu valides (texte modifiable).
      const msg = addMessage(contactId, { author: "agent", kind: "voice", text: reply.messages.join(" "), status: "draft" });
      emit("message", { contact_id: contactId, message: msg });
    } else {
      for (const text of reply.messages) {
        const msg = addMessage(contactId, { author: "agent", text, status: "draft" });
        emit("message", { contact_id: contactId, message: msg });
      }
    }
    emit("contact", { contact_id: contactId });
    return;
  }

  if (useVoice && !isTest) {
    const text = reply.messages.join(" ");
    try {
      await adapter?.recording?.(contact).catch(() => {});
      await sendVoiceText(contact, text);
      emit("contact", { contact_id: contactId });
      return;
    } catch (e) {
      console.error("Vocal impossible, envoi en texte :", e.message);
    }
  }

  for (const [i, text] of reply.messages.entries()) {
    if (!isTest) {
      const typingMs = Math.min(15_000, (text.length / s.typing_chars_per_second) * 1000) + rand(300, 1200);
      await adapter?.typing?.(contact, typingMs).catch(() => {});
      await sleep(typingMs);
      if (i > 0) await sleep(rand(400, 1500));
      if (getContact(contactId).paused_until > Date.now()) return;
    }
    await deliver(contact, text, "agent");
  }
  emit("contact", { contact_id: contactId });
}

/** Crée la voix d'un texte puis l'envoie comme note vocale. */
async function sendVoiceText(contact, text, existingMessageId) {
  const { textToSpeech } = await import("./tts.js");
  const { assertBudget } = await import("./credits.js");
  assertBudget("vocal");
  const adapter = adapters.get(contact.channel);
  if (contact.channel !== "test" && !adapter?.sendAudio) throw new Error("Ce canal ne permet pas d'envoyer un vocal.");
  const audio = await withCredits({ contactId: contact.id, kind: "voice" }, () => textToSpeech(text));
  let externalMsgId = null;
  let error = null;
  if (contact.channel !== "test") {
    try {
      externalMsgId = await adapter.sendAudio(contact, { ...audio, voice: true });
      if (externalMsgId) rememberSent(contact.channel, contact.external_id, "", externalMsgId);
    } catch (e) {
      error = e.message; // le vocal est gardé et repartira tel quel à la reconnexion
    }
  }
  const fields = {
    kind: "voice",
    text,
    media_path: audio.path,
    media_type: audio.mime,
    media_url: audio.url,
    status: error ? "pending" : "sent",
    error,
    external_id: externalMsgId,
  };
  let msg;
  if (existingMessageId) {
    updateMessage(existingMessageId, { ...fields, created_at: Date.now() });
    msg = getMessage(existingMessageId);
  } else {
    msg = addMessage(contact.id, { author: "agent", ...fields });
  }
  emit("message", { contact_id: contact.id, message: msg });
  return msg;
}

async function deliver(contact, text, author) {
  const adapter = adapters.get(contact.channel);
  rememberSent(contact.channel, contact.external_id, text);
  let externalMsgId = null;
  let error = null;
  if (contact.channel !== "test") {
    try {
      if (!adapter) throw new Error(`Canal ${contact.channel} non connecté`);
      externalMsgId = await adapter.send(contact, text);
    } catch (e) {
      error = e.message; // gardé dans la file d'envoi : il repartira tel quel à la reconnexion
    }
  }
  if (externalMsgId) rememberSent(contact.channel, contact.external_id, text, externalMsgId);
  const msg = addMessage(contact.id, { author, text, status: error ? "pending" : "sent", external_id: externalMsgId });
  if (error) updateMessage(msg.id, { error });
  emit("message", { contact_id: contact.id, message: getMessage(msg.id) });
  emitHook("message.sent", { contact: who(contact), message: { id: msg.id, author, text } });
  return msg;
}

// Une correction = une leçon : on la garde comme exemple de style.
function learnFromCorrection(contact, m, finalText) {
  const before = listMessages(contact.id, 30).filter((x) => x.id < m.id && x.author === "client");
  const clientText = before.slice(-3).map((x) => x.text).join("\n");
  if (clientText) addExamples([{ client_text: clientText, owner_reply: finalText }], "correction");
}

/** Validation d'un brouillon depuis le tableau de bord (éventuellement corrigé). */
export async function approveDraft(messageId, editedText) {
  const m = getMessage(messageId);
  if (!m || m.status !== "draft") throw new Error("Brouillon introuvable");
  const contact = getContact(m.contact_id);
  if (m.kind === "audio" && m.media_path) return sendSong(contact, m);
  const finalText = (editedText ?? m.text).trim();
  if (m.kind === "voice") {
    if (editedText && finalText !== m.text.trim()) learnFromCorrection(contact, m, finalText);
    await sendVoiceText(contact, finalText, m.id);
    return;
  }
  if (editedText && finalText !== m.text.trim()) learnFromCorrection(contact, m, finalText);
  const adapter = adapters.get(contact.channel);
  if (!adapter && contact.channel !== "test") throw new Error(`Canal ${contact.channel} non connecté`);
  rememberSent(contact.channel, contact.external_id, finalText);
  const externalMsgId = contact.channel === "test" ? null : await adapter.send(contact, finalText);
  if (externalMsgId) rememberSent(contact.channel, contact.external_id, finalText, externalMsgId);
  updateMessage(m.id, { status: "sent", text: finalText, external_id: externalMsgId, created_at: Date.now() });
  emit("message", { contact_id: contact.id, message: getMessage(m.id) });
}

// ---------- Chansons (Suno) ----------

export async function sendSong(contact, m, { queue = true } = {}) {
  const adapter = adapters.get(contact.channel);
  let externalMsgId = null;
  if (contact.channel !== "test") {
    try {
      if (!adapter) throw new Error(`Canal ${contact.channel} non connecté`);
      if (adapter.sendAudio) {
        externalMsgId = await adapter.sendAudio(contact, { path: m.media_path, mime: m.media_type, url: m.media_url, title: m.text });
      } else if (m.media_url) {
        // Canal sans envoi de fichier (ex. commentaire public) : on envoie le lien.
        externalMsgId = await adapter.send(contact, `${m.text}\n${m.media_url}`);
      } else {
        throw new Error("Ce canal ne permet pas d'envoyer un fichier audio.");
      }
    } catch (e) {
      if (!queue) throw e;
      // La chanson est gardée telle quelle et repartira à la reconnexion (jamais recomposée).
      updateMessage(m.id, { status: "pending", error: e.message });
      emit("message", { contact_id: contact.id, message: getMessage(m.id) });
      return false;
    }
  }
  if (externalMsgId) rememberSent(contact.channel, contact.external_id, "", externalMsgId);
  updateMessage(m.id, { status: "sent", external_id: externalMsgId, error: null, created_at: Date.now() });
  emit("message", { contact_id: contact.id, message: getMessage(m.id) });
  // Chanson envoyée après paiement : la commande passe en « livrée ».
  const order = activeOrder(contact.id);
  if (order && ["acompte", "creation"].includes(order.stage)) {
    saveOrder({ id: order.id, stage: "livree" });
    emit("order", { contact_id: contact.id });
  }
  return true;
}

/**
 * File d'envoi : renvoie, dans l'ordre et TELS QUELS, les messages, vocaux et
 * chansons qui n'ont pas pu partir (WhatsApp coupé…). Rien n'est régénéré.
 * Appelée à la reconnexion de WhatsApp et chaque minute.
 */
let flushing = false;
export async function flushOutbox() {
  if (flushing) return 0;
  flushing = true;
  let n = 0;
  const down = new Set(); // canal encore coupé : on garde l'ordre des messages
  try {
    for (const m of pendingMessages()) {
      const contact = getContact(m.contact_id);
      if (!contact || down.has(contact.channel)) continue;
      if (Date.now() - m.created_at > 48 * 3600_000) {
        updateMessage(m.id, { status: "failed" }); // trop vieux : la surveillance te l'a signalé
        emit("message", { contact_id: contact.id, message: getMessage(m.id) });
        continue;
      }
      try {
        const adapter = adapters.get(contact.channel);
        if (!adapter) throw new Error(`Canal ${contact.channel} non connecté`);
        if (m.kind === "audio") {
          await sendSong(contact, m, { queue: false });
        } else {
          const id =
            m.kind === "voice"
              ? await adapter.sendAudio(contact, { path: m.media_path, mime: m.media_type, url: m.media_url, voice: true })
              : await adapter.send(contact, m.text);
          if (id) rememberSent(contact.channel, contact.external_id, m.kind === "voice" ? "" : m.text, id);
          updateMessage(m.id, { status: "sent", external_id: id || null, error: null });
          emit("message", { contact_id: contact.id, message: getMessage(m.id) });
        }
        n++;
      } catch (e) {
        updateMessage(m.id, { tries: (m.tries || 0) + 1, error: e.message });
        down.add(contact.channel);
      }
    }
  } finally {
    flushing = false;
  }
  return n;
}

/**
 * Lance Suno en arrière-plan. Chaque version créée apparaît comme un brouillon
 * audio que le propriétaire écoute puis envoie (ou rejette).
 */
export async function createSong(contactId, brief, { orderId, autoSend = false } = {}) {
  const { assertBudget } = await import("./credits.js");
  assertBudget("chanson");
  const { startSong, waitSong } = await import("./suno.js");
  const { downloadToMedia } = await import("./media.js");
  const title = brief.title || "Chanson";
  const placeholder = addMessage(contactId, {
    author: "agent",
    kind: "audio",
    text: `🎵 Création de « ${title} » en cours avec Suno… (1 à 5 minutes)`,
    status: "generating",
  });
  emit("message", { contact_id: contactId, message: placeholder });
  const taskId = await startSong(brief);
  const { getBalance } = await import("./credits.js");
  const balanceBefore = await getBalance();
  (async () => {
    try {
      const tracks = await waitSong(taskId, {
        onStatus: (st) => {
          const label = { PENDING: "en attente", TEXT_SUCCESS: "paroles prêtes", FIRST_SUCCESS: "première version presque prête" }[st];
          if (!label) return;
          updateMessage(placeholder.id, { text: `🎵 « ${title} » : ${label}…` });
          emit("message", { contact_id: contactId, message: getMessage(placeholder.id) });
        },
      });
      for (const [i, t] of tracks.entries()) {
        const media = await downloadToMedia(t.audioUrl);
        const mime = media.mime.startsWith("audio/") ? media.mime : "audio/mpeg";
        const text = `🎵 ${t.title || title}${tracks.length > 1 ? ` (version ${i + 1})` : ""}`;
        const fields = { kind: "audio", text, media_path: media.path, media_type: mime, media_url: t.audioUrl, status: "draft" };
        if (i === 0) updateMessage(placeholder.id, fields);
        else addMessage(contactId, { author: "agent", ...fields });
      }
      // Coût de la chanson : différence de solde entre le lancement et la fin.
      const after = await getBalance();
      if (balanceBefore !== null && after !== null && balanceBefore > after) {
        logCredits({ contactId, kind: "song", credits: Math.round((balanceBefore - after) * 100) / 100, balanceAfter: after });
      }
      emitHook("song.ready", {
        contact: who(getContact(contactId)),
        title,
        tracks: tracks.map((t) => ({ title: t.title, url: t.audioUrl })),
      });
      if (orderId) {
        saveOrder({ id: orderId, lyrics_status: "composed" });
        emit("order", { contact_id: contactId });
        if (autoSend) {
          // Un envoi raté (WhatsApp déconnecté…) ne relance PAS la composition :
          // la chanson reste « composée » et la surveillance retente seulement l'envoi.
          await sendSong(getContact(contactId), getMessage(placeholder.id)).catch((e) => {
            console.error("Envoi de la chanson :", e.message);
            updateContact(contactId, { needs_human: 1, needs_human_reason: `🎵 Chanson prête mais pas encore envoyée : ${e.message}` });
          });
        } else {
          updateContact(contactId, {
            needs_human: 1,
            needs_human_reason: "🎵 La chanson est prête : écoute les versions et clique « Envoyer au client ».",
          });
          notifyOwner(getContact(contactId), "chanson prête à écouter").catch(() => {});
        }
      }
    } catch (e) {
      updateMessage(placeholder.id, { text: `❌ Chanson « ${title} » : ${e.message}`, status: "rejected" });
      if (orderId) {
        saveOrder({ id: orderId, lyrics_status: "validated" });
        updateContact(contactId, { needs_human: 1, needs_human_reason: `La composition a échoué : ${e.message}` });
      }
    }
    emit("message", { contact_id: contactId, message: getMessage(placeholder.id) });
    emit("contact", { contact_id: contactId });
  })();
  return { taskId, message_id: placeholder.id };
}

// ---------- Processus chanson : texte -> validation du client -> composition ----------

/** Écrit (ou corrige) le texte de la chanson et l'envoie au client pour validation. */
export async function proposeLyrics(contactId, { revise = false, notes = "", mode, resend = false } = {}) {
  const contact = getContact(contactId);
  let order = activeOrder(contactId) || saveOrder({ contact_id: contactId, stage: "nouveau" });
  const isRevision = revise && !!order.lyrics;
  if (resend && order.lyrics) {
    // Le texte est déjà écrit (seul l'envoi avait échoué) : on le renvoie sans repayer l'IA.
    order = saveOrder({ id: order.id, lyrics_status: "proposed" });
  } else {
    const brief = await withCredits({ contactId, kind: "lyrics" }, () =>
      songBrief(contact, isRevision ? { previous: order.lyrics, notes } : {}),
    );
    order = saveOrder({
      id: order.id,
      lyrics: brief.lyrics,
      song_title: brief.title,
      song_style: brief.style,
      lyrics_status: "proposed",
      lyrics_version: (order.lyrics_version || 0) + 1,
      title: order.title || brief.title,
    });
  }
  emit("order", { contact_id: contactId });
  const text = `🎵 ${order.song_title}${isRevision ? " (version corrigée)" : ""}\n\n${order.lyrics}\n\nDis-moi si ce texte te plaît, ou ce que tu veux changer 😊`;
  if ((mode || channelMode(contact.channel)) === "draft") {
    const msg = addMessage(contactId, { author: "agent", text, status: "draft" });
    emit("message", { contact_id: contactId, message: msg });
  } else {
    try {
      await deliver(contact, text, "agent");
    } catch (e) {
      e.sendFailed = true;
      throw e;
    }
  }
  return order;
}

/** Lance la composition avec Suno à partir du texte validé. */
export async function startComposition(contactId) {
  const order = activeOrder(contactId);
  if (!order?.lyrics) throw new Error("Aucun texte validé pour ce client.");
  const { assertBudget } = await import("./credits.js");
  assertBudget("composition");
  const s = getSettings();
  saveOrder({
    id: order.id,
    lyrics_status: "composing",
    compose_tries: (order.compose_tries || 0) + 1,
    stage: ["nouveau", "devis", "acompte"].includes(order.stage) ? "creation" : order.stage,
  });
  emit("order", { contact_id: contactId });
  const brief = { title: order.song_title || order.title || "Chanson", style: order.song_style, lyrics: order.lyrics };
  try {
    // Par défaut : UNE création Suno, qui donne 2 versions du même texte (envoyées toutes les deux).
    const jobs =
      s.song_versions === "two_styles"
        ? [
            { style: rhythmicStyle(brief.style), labels: ["version rythmée"] },
            { style: acousticStyle(brief.style), labels: ["version acoustique"] },
          ]
        : [{ style: brief.style, labels: ["version 1", "version 2"] }];
    return await composeVersions(contactId, brief, jobs, { orderId: order.id, autoSend: !!s.song_auto_send });
  } catch (e) {
    // Suno n'a pas pu démarrer (crédit, clé…) : on revient à « validé » pour pouvoir relancer.
    saveOrder({ id: order.id, lyrics_status: "validated" });
    emit("order", { contact_id: contactId });
    throw e;
  }
}

// Styles des deux versions, à partir du style choisi pour la chanson.
const voiceOf = (style) => (String(style).match(/\b(fe)?male (vocals?|voice)\b/i) || [""])[0];
export const rhythmicStyle = (style) => [style, "upbeat, rhythmic, danceable groove"].filter(Boolean).join(", ");
export const acousticStyle = (style) =>
  ["acoustic unplugged version, acoustic guitar, soft percussion, warm and intimate", voiceOf(style)].filter(Boolean).join(", ");

/**
 * Composition d'une chanson. Chaque « création » Suno donne 2 versions du même texte :
 * - réglage par défaut : 1 création, les 2 versions sont envoyées (version 1 et version 2) ;
 * - « rythmée + acoustique » : 2 créations (une par style), on garde la 1re version de chacune.
 * Une version ratée n'est jamais recomposée automatiquement (tu es prévenu).
 */
async function composeVersions(contactId, brief, jobs, { orderId, autoSend }) {
  const { startSong, waitSong } = await import("./suno.js");
  const { downloadToMedia } = await import("./media.js");
  const { getBalance } = await import("./credits.js");
  const balanceBefore = await getBalance();
  const started = [];
  const failed = [];
  for (const job of jobs) {
    try {
      const taskId = await startSong({ ...brief, style: job.style });
      // Une ligne par version attendue (elles s'affichent au fur et à mesure dans la conversation).
      const placeholders = job.labels.map((label) => {
        const p = addMessage(contactId, {
          author: "agent",
          kind: "audio",
          text: `🎵 « ${brief.title} » (${label}) : création en cours avec Suno… (1 à 5 minutes)`,
          status: "generating",
        });
        emit("message", { contact_id: contactId, message: p });
        return { label, id: p.id };
      });
      started.push({ ...job, taskId, placeholders });
    } catch (e) {
      if (!started.length) throw e; // rien n'a démarré : l'appelant remet la commande en « validé »
      failed.push(`${job.labels.join(" + ")} : ${e.message}`);
    }
  }
  (async () => {
    const results = await Promise.allSettled(
      started.map(async (job) => {
        const tracks = await waitSong(job.taskId);
        const out = [];
        for (const [i, p] of job.placeholders.entries()) {
          const t = tracks[i];
          if (!t) {
            updateMessage(p.id, { text: `❌ ${brief.title} (${p.label}) : Suno n'a pas rendu cette version`, status: "rejected" });
            emit("message", { contact_id: contactId, message: getMessage(p.id) });
            failed.push(`${p.label} : version manquante`);
            continue;
          }
          const media = await downloadToMedia(t.audioUrl);
          const mime = media.mime.startsWith("audio/") ? media.mime : "audio/mpeg";
          updateMessage(p.id, {
            text: `🎵 ${brief.title} — ${p.label}`,
            media_path: media.path,
            media_type: mime,
            media_url: t.audioUrl,
            status: "draft",
          });
          emit("message", { contact_id: contactId, message: getMessage(p.id) });
          out.push(getMessage(p.id));
        }
        return out;
      }),
    );
    const ready = [];
    results.forEach((r, i) => {
      const job = started[i];
      if (r.status === "fulfilled") ready.push(...r.value);
      else {
        const why = r.reason?.message || String(r.reason);
        failed.push(`${job.labels.join(" + ")} : ${why}`);
        for (const p of job.placeholders) {
          updateMessage(p.id, { text: `❌ ${brief.title} (${p.label}) : ${why}`, status: "rejected" });
          emit("message", { contact_id: contactId, message: getMessage(p.id) });
        }
      }
    });
    const after = await getBalance();
    if (balanceBefore !== null && after !== null && balanceBefore > after) {
      logCredits({ contactId, kind: "song", credits: Math.round((balanceBefore - after) * 100) / 100, balanceAfter: after });
    }
    if (!ready.length) {
      saveOrder({ id: orderId, lyrics_status: "validated" });
      updateContact(contactId, { needs_human: 1, needs_human_reason: `La composition a échoué : ${failed.join(" ; ")}` });
      emit("order", { contact_id: contactId });
      emit("contact", { contact_id: contactId });
      return;
    }
    saveOrder({ id: orderId, lyrics_status: "composed" });
    emit("order", { contact_id: contactId });
    emitHook("song.ready", {
      contact: who(getContact(contactId)),
      title: brief.title,
      tracks: ready.map((m) => ({ title: m.text, url: m.media_url })),
    });
    if (failed.length) {
      const reason = `🎵 Une version n'a pas pu être créée (${failed.join(" ; ")}). ${ready.length ? "Le client reçoit l'autre." : ""}`;
      updateContact(contactId, { needs_human: 1, needs_human_reason: reason });
      notifyOwner(getContact(contactId), reason, { plain: true }).catch(() => {});
    }
    if (autoSend) {
      const contact = getContact(contactId);
      const twoStyles = jobs.length > 1 && ready.length > 1;
      await deliver(
        contact,
        twoStyles
          ? "🎶 Voici ta chanson en 2 versions : une version rythmée et une version acoustique. J'espère qu'elle te plaira !"
          : ready.length > 1
            ? "🎶 Voici ta chanson en 2 versions, choisis celle que tu préfères ! J'espère qu'elle te plaira 😊"
            : "🎶 Voici ta chanson, j'espère qu'elle te plaira !",
        "agent",
      ).catch(() => {});
      for (const m of ready) await sendSong(getContact(contactId), m); // en cas de coupure : file d'envoi
    } else {
      updateContact(contactId, {
        needs_human: 1,
        needs_human_reason: "🎵 La chanson est prête (2 versions) : écoute-les et clique « Envoyer au client ».",
      });
      notifyOwner(getContact(contactId), "chanson prête à écouter (2 versions)").catch(() => {});
    }
    emit("contact", { contact_id: contactId });
  })().catch((e) => console.error("Composition :", e.message));
  return { taskIds: started.map((j) => j.taskId), message_ids: started.flatMap((j) => j.placeholders.map((p) => p.id)) };
}

/**
 * Écriture du texte avec un délai « humain » (entre lyrics_delay_min et
 * lyrics_delay_max minutes, 12 max) : la commande passe en « writing » et
 * runLyricsQueue l'envoie à l'heure prévue.
 */
export function scheduleLyrics(contactId, { revise = false, notes = "" } = {}) {
  const s = getSettings();
  const order = activeOrder(contactId) || saveOrder({ contact_id: contactId, stage: "nouveau" });
  const min = Math.max(0, Math.min(12, Number(s.lyrics_delay_min) || 0));
  const max = Math.max(min, Math.min(12, Number(s.lyrics_delay_max) || 0));
  const delayMs = rand(min, max) * 60_000;
  saveOrder({
    id: order.id,
    lyrics_status: "writing",
    lyrics_due_at: Date.now() + delayMs,
    lyrics_notes: JSON.stringify({ revise: revise && !!order.lyrics, notes }),
  });
  emit("order", { contact_id: contactId });
  return delayMs;
}

/** Envoie les textes dont l'heure est arrivée (appelé toutes les 30 secondes). */
let lyricsRunning = false;
export async function runLyricsQueue(at = Date.now()) {
  if (lyricsRunning) return 0; // le tour précédent attend encore l'IA : pas de double envoi
  lyricsRunning = true;
  let n = 0;
  try {
    for (const o of dueLyrics(at)) {
      if (getOrder(o.id)?.lyrics_status !== "writing") continue;
      let opts = {};
      try {
        opts = JSON.parse(o.lyrics_notes || "{}");
      } catch {}
      // On passe tout de suite en « proposed » pour ne pas l'envoyer deux fois.
      saveOrder({ id: o.id, lyrics_status: o.lyrics ? "proposed" : "", lyrics_due_at: 0 });
      try {
        await proposeLyrics(o.contact_id, { revise: !!opts.revise, notes: opts.notes || "", resend: !!opts.resend });
        n++;
      } catch (e) {
        console.error("Texte de chanson :", e.message);
        // Nouvel essai dans 1, 2, 4, 8, 16 min, puis arrêt (la surveillance te prévient).
        const tries = (Number(opts.tries) || 0) + 1;
        const wait = tries >= 6 ? 365 * 24 * 3600_000 : 2 ** (tries - 1) * 60_000;
        saveOrder({
          id: o.id,
          lyrics_status: "writing",
          lyrics_due_at: Date.now() + wait,
          lyrics_notes: JSON.stringify({ ...opts, tries, error: friendlyError(e), resend: !!opts.resend || !!e.sendFailed }),
        });
      }
    }
  } finally {
    lyricsRunning = false;
  }
  return n;
}

/** Le client demande un rabais : TU décides, l'agent te prévient. */
async function handleDiscountRequest(contactId, what) {
  const reason = `💸 Demande de rabais : ${String(what).slice(0, 300)}`;
  updateContact(contactId, { needs_human: 1, needs_human_reason: reason });
  emit("contact", { contact_id: contactId });
  const order = activeOrder(contactId);
  const s = getSettings();
  const price = order?.price ? `\nPrix annoncé : ${order.price} ${s.currency}` : "";
  await notifyOwner(getContact(contactId), `${reason}${price}\nL'agent lui a dit qu'il revient vers lui : réponds-lui toi-même.`, { kind: "discount", plain: true }).catch(() => {});
}

/** « Je reviendrai pour une autre chanson » : relance prévue dans N jours (vers 10 h). */
function planReminder(contactId, days, about) {
  const when = new Date(Date.now() + days * 24 * 3600_000);
  when.setHours(10, Math.floor(rand(0, 50)), 0, 0);
  updateContact(contactId, { remind_at: when.getTime(), remind_note: String(about || "").slice(0, 300) });
  const note = addMessage(contactId, {
    author: "system",
    kind: "note",
    text: `🔔 Relance prévue le ${when.toLocaleDateString("fr-FR")}${about ? ` : ${about}` : ""}`,
    status: "note",
  });
  emit("message", { contact_id: contactId, message: note });
}

/** Relances prévues arrivées à échéance (pendant les heures d'ouverture). */
export async function runReminders(now = Date.now()) {
  if (!isOpen(new Date(now))) return 0;
  let n = 0;
  for (const id of dueReminders(now)) {
    const contact = getContact(id);
    const note = contact.remind_note || "il reviendrait pour une autre chanson";
    const mode = channelMode(contact.channel);
    if (busy.has(id) || contact.paused_until > now) continue; // on réessaie au prochain tour
    updateContact(id, { remind_at: 0 }); // une seule fois, même en cas d'erreur
    if (mode === "off" || isIgnored(contact)) continue;
    busy.add(id);
    try {
      const reply = await withCredits({ contactId: id, kind: "reply" }, () =>
        replyGenerator(contact, { followup: true, reminder: note, onAction: (r) => noteAction(id, r) }),
      );
      if (reply.messages.length) n++;
      await applyReply(getContact(id), reply, mode, { followup: true });
    } catch (e) {
      console.error(`Relance prévue (contact ${id}) :`, friendlyError(e));
    } finally {
      busy.delete(id);
    }
  }
  return n;
}

/** Chanson + vidéo lyrics, montage… : c'est TOI qui t'en occupes. */
async function handleSpecialRequest(contactId, what) {
  let order = activeOrder(contactId) || saveOrder({ contact_id: contactId, stage: "nouveau" });
  if (order.special) return; // déjà signalé
  order = saveOrder({ id: order.id, special: String(what).slice(0, 200) });
  emit("order", { contact_id: contactId });
  const reason = `🎬 Demande spéciale à faire par toi : ${order.special}`;
  updateContact(contactId, { needs_human: 1, needs_human_reason: reason });
  emit("contact", { contact_id: contactId });
  await notifyOwner(getContact(contactId), `${reason}
(L'agent ne lance rien automatiquement pour cette commande.)`, { kind: "special", plain: true }).catch(() => {});
}

async function handleSongStep(contactId, reply, mode) {
  const s = getSettings();
  if (!s.song_flow) return;
  if (activeOrder(contactId)?.special) return; // commande spéciale : tu la gères toi-même
  const contact = getContact(contactId);
  if (reply.song_step === "propose_lyrics" || reply.song_step === "revise_lyrics") {
    const current = activeOrder(contactId);
    // UN seul texte : on n'en écrit pas un autre tant que le client n'a pas demandé de correction.
    if (reply.song_step === "propose_lyrics" && current?.lyrics && ["proposed", "validated", "payment_claimed", "composing", "composed"].includes(current.lyrics_status)) return;
    if (current?.lyrics_status === "writing") {
      // Déjà en cours d'écriture : on ajoute seulement les corrections demandées entre-temps.
      if (reply.revision_notes) {
        let opts = {};
        try {
          opts = JSON.parse(current.lyrics_notes || "{}");
        } catch {}
        const notes = [opts.notes, reply.revision_notes].filter(Boolean).join(" ; ");
        saveOrder({ id: current.id, lyrics_notes: JSON.stringify({ ...opts, notes, revise: opts.revise || !!current.lyrics }) });
      }
      return;
    }
    const revise = reply.song_step === "revise_lyrics";
    if (revise && current && (current.compose_tries > 0 || ["composing", "composed"].includes(current.lyrics_status))) {
      // La chanson est déjà composée (et payée) : une nouvelle version coûte une nouvelle composition.
      const reason = `✍️ Le client veut modifier sa chanson déjà composée : ${reply.revision_notes || "voir la conversation"}. À toi de décider (nouvelle composition = nouveaux crédits).`;
      updateContact(contactId, { needs_human: 1, needs_human_reason: reason });
      emit("contact", { contact_id: contactId });
      await notifyOwner(contact, reason, { plain: true }).catch(() => {});
      return;
    }
    if (revise && (current?.lyrics_version || 0) >= (Number(s.max_lyrics_versions) || 5)) {
      // Beaucoup de corrections : c'est toi qui prends la main (et ça évite de dépenser sans fin).
      const reason = `✍️ Le client demande encore des corrections après ${current.lyrics_version} versions du texte : ${reply.revision_notes || "voir la conversation"}`;
      updateContact(contactId, { needs_human: 1, needs_human_reason: reason });
      emit("contact", { contact_id: contactId });
      await notifyOwner(contact, reason, { plain: true }).catch(() => {});
      return;
    }
    if (contact.channel === "test" || !(Number(s.lyrics_delay_max) > 0)) {
      await proposeLyrics(contactId, { revise, notes: reply.revision_notes, mode });
    } else {
      scheduleLyrics(contactId, { revise, notes: reply.revision_notes });
    }
    return;
  }
  let order = activeOrder(contactId);
  if (reply.song_step === "client_validated") {
    if (!order?.lyrics || !["proposed", "validated"].includes(order.lyrics_status)) return;
    if (s.compose_requires_payment && !isPaid(order)) {
      // Texte validé : l'agent vient de demander le paiement ; rien n'est composé avant ta vérification.
      saveOrder({ id: order.id, lyrics_status: "validated" });
      emit("order", { contact_id: contactId });
      return;
    }
    await startComposition(contactId);
    return;
  }
  if (reply.song_step === "payment_claimed") {
    if (!order) order = saveOrder({ contact_id: contactId, stage: "devis" });
    if (order.lyrics_status === "composing" || order.lyrics_status === "composed") return;
    // Si le texte n'est pas encore validé, il garde son état : on compose seulement quand il l'est.
    if (!order.lyrics || order.lyrics_status === "validated") saveOrder({ id: order.id, lyrics_status: "payment_claimed" });
    emit("order", { contact_id: contactId });
    // Preuve envoyée par le client (capture) : on te la transfère.
    const proof = listMessages(contactId, 15)
      .filter((m) => m.author === "client" && m.kind === "image" && m.media_path && Date.now() - m.created_at < 3600_000)
      .at(-1);
    const emoji = s.payment_confirm_emoji || "✅";
    const amount = order.price ? `${order.price} ${s.currency}` : "le montant convenu";
    await notifyOwner(
      contact,
      `💰 Ce client dit avoir payé ${amount}${order.song_title || order.title ? ` pour « ${order.song_title || order.title} »` : ""}.\nVérifie ton compte. Si c'est bon, réagis à CE message avec ${emoji} : je compose la chanson et je la lui envoie.\n(Tant que tu n'as pas réagi, rien n'est composé.)`,
      { kind: "payment", orderId: order.id, imagePath: proof?.media_path, imageMime: proof?.media_type, plain: true },
    );
    updateContact(contactId, { needs_human: 1, needs_human_reason: `Paiement annoncé par le client : vérifie-le puis réagis avec ${emoji} (WhatsApp) ou clique « Paiement vérifié ».` });
    emit("contact", { contact_id: contactId });
  }
}

/**
 * TU as vérifié le paiement : la chanson est composée puis livrée au client.
 * Appelé par ta réaction emoji sur WhatsApp ou par le bouton du tableau de bord.
 */
export async function confirmPayment(contactId, { by = "tableau de bord" } = {}) {
  const s = getSettings();
  const contact = getContact(contactId);
  const order = activeOrder(contactId);
  if (!order) throw new Error("Aucune commande en cours pour ce client.");
  if (["composing", "composed"].includes(order.lyrics_status)) return order; // déjà lancé
  const ready = order.lyrics && ["validated", "payment_claimed"].includes(order.lyrics_status);
  saveOrder({
    id: order.id,
    paid: order.paid > 0 ? order.paid : order.price || 0,
    payment_confirmed_at: Date.now(),
    stage: ["nouveau", "devis"].includes(order.stage) ? "acompte" : order.stage,
    // Pris tout de suite : une 2e confirmation (bouton + emoji) ou la surveillance ne relance rien.
    ...(ready ? { lyrics_status: "composing" } : {}),
  });
  updateContact(contactId, { needs_human: 0, needs_human_reason: null });
  emitHook("order.paid", { contact: who(contact), order: activeOrder(contactId), confirmed_by: by });
  if (order.lyrics_status === "payment_claimed" && !order.lyrics) saveOrder({ id: order.id, lyrics_status: "" });
  const say = (text) => deliver(contact, text, "agent").catch((e) => console.error("Message de confirmation :", e.message));
  if (!ready) {
    // Payé avant d'avoir validé le texte : la composition partira dès qu'il le valide.
    await say("Paiement bien reçu, merci 🙏");
    emit("order", { contact_id: contactId });
    return activeOrder(contactId);
  }
  await say("Paiement bien reçu, merci 🙏 Je compose ta chanson maintenant, tu la reçois dans une dizaine de minutes 🎶");
  try {
    await startComposition(contactId);
  } catch (e) {
    saveOrder({ id: order.id, lyrics_status: "validated" }); // la surveillance la relancera
    throw e;
  }
  notifyOwner(contact, `✅ Paiement confirmé (${by}) : composition lancée.`, { plain: true }).catch(() => {});
  return activeOrder(contactId);
}

/** Réaction emoji venue de TON WhatsApp. */
export async function handleOwnerReaction({ channel, chatJid, targetId, emoji, ownerChat }) {
  const s = getSettings();
  const norm = (e) => String(e || "").replace(/[\uFE0F\u{1F3FB}-\u{1F3FF}]/gu, "");
  if (norm(emoji) !== norm(s.payment_confirm_emoji || "✅")) return null;
  // 1. Réaction sur le message que l'agent t'a envoyé.
  const note = findContactByOwnerNote(targetId);
  let contactId = note?.kind === "payment" ? note.contactId : null;
  // 2. Ou réaction directement dans la discussion du client (sur sa capture, par exemple).
  if (!contactId && !ownerChat) {
    const c = upsertContact(channel, chatJid);
    const o = activeOrder(c.id);
    const claimed = String(c.needs_human_reason || "").startsWith("Paiement annoncé");
    if (o && (claimed || o.lyrics_status === "payment_claimed")) contactId = c.id;
  }
  if (!contactId) return null;
  return confirmPayment(contactId, { by: `ta réaction ${emoji} sur WhatsApp` });
}

/** Démo automatique : une seule fois par client, toujours en brouillon à valider. */
async function maybeAutoDemo(contactId) {
  const s = getSettings();
  const contact = getContact(contactId);
  if (!s.auto_demo || contact.demo_at || contact.channel === "test") return;
  const { kieKey } = await import("./openai-compat.js");
  if (!kieKey()) return;
  updateContact(contactId, { demo_at: Date.now() });
  const brief = await songBrief(contact);
  await createSong(contactId, { ...brief, title: `Démo – ${brief.title}`.slice(0, 80) });
  updateContact(contactId, {
    needs_human: 1,
    needs_human_reason: "Une démo de chanson a été préparée : écoute-la et envoie-la si elle te plaît.",
  });
  emit("contact", { contact_id: contactId });
  notifyOwner(contact, "démo de chanson prête à écouter").catch(() => {});
}

/**
 * Relances : clients qui n'ont pas répondu depuis X heures alors qu'une
 * commande est en cours (demande ou devis). Lancé régulièrement par le serveur.
 */
export async function runFollowups(now = Date.now()) {
  const s = getSettings();
  if (!s.followup_enabled || !isOpen(new Date(now))) return 0;
  const since = now - s.followup_hours * 3600_000;
  const rows = db
    .prepare(
      `SELECT c.id FROM contacts c
       JOIN orders o ON o.contact_id = c.id AND o.stage IN ('nouveau', 'devis')
       WHERE c.channel NOT IN ('test', 'facebook_comment')
         AND c.paused_until < ?
         AND c.followups < ?
         AND c.last_followup_at < ?
         AND (SELECT author FROM messages WHERE contact_id = c.id AND status IN ('sent', 'received') ORDER BY id DESC LIMIT 1) IN ('agent', 'owner')
         AND (SELECT MAX(created_at) FROM messages WHERE contact_id = c.id AND status IN ('sent', 'received')) < ?
         AND NOT EXISTS (SELECT 1 FROM messages WHERE contact_id = c.id AND status = 'draft')
       GROUP BY c.id`,
    )
    .all(now, s.followup_max, since, since);
  let n = 0;
  for (const { id } of rows) {
    const contact = getContact(id);
    const mode = channelMode(contact.channel);
    if (mode === "off" || busy.has(id) || isIgnored(contact)) continue;
    busy.add(id);
    try {
      const reply = await withCredits({ contactId: id, kind: "reply" }, () =>
        replyGenerator(contact, { followup: true, onAction: (r) => noteAction(id, r) }),
      );
      if (reply.messages.length) n++;
      else updateContact(id, { followups: s.followup_max }); // l'agent juge qu'il ne faut pas relancer
      await applyReply(getContact(id), reply, mode, { followup: true });
    } catch (e) {
      console.error(`Relance (contact ${id}) :`, friendlyError(e));
    } finally {
      busy.delete(id);
    }
  }
  return n;
}

export function rejectDraft(messageId) {
  const m = getMessage(messageId);
  if (!m || m.status !== "draft") return;
  updateMessage(m.id, { status: "rejected" });
  emit("message", { contact_id: m.contact_id, message: getMessage(m.id) });
}

/** Message envoyé à la main depuis le tableau de bord. */
export async function sendManual(contactId, text) {
  const contact = getContact(contactId);
  learnFromOwnerReply(contactId, text);
  markAnswered(contactId);
  cancel(contactId);
  updateContact(contactId, { needs_human: 0, needs_human_reason: null });
  return deliver(contact, text, "owner");
}

export async function notifyOwner(contact, reason, { kind, orderId, imagePath, imageMime, plain = false } = {}) {
  if (kind !== "payment") emitHook("needs_human", { contact: who(contact), reason });
  const phone = contact.meta?.phone ? ` +${contact.meta.phone}` : "";
  const text = `${plain ? "" : "🔔 "}${contact.name || contact.external_id} (${contact.channel}${phone})${plain ? "\n" : " a besoin de toi : "}${reason}`;
  const id = await messageOwner(text, { imagePath, imageMime });
  if (id && id !== true) rememberOwnerNote(id, { contactId: contact.id, orderId, kind: kind || "info" });
}

/**
 * Message pour TOI : sur ton WhatsApp (ton numéro ou ta discussion « moi »),
 * sinon sur Telegram. Renvoie l'identifiant du message (ou true), null si rien n'a pu partir.
 */
export async function messageOwner(text, { imagePath, imageMime } = {}) {
  const wa = adapters.get("whatsapp");
  if (wa?.notifyOwner) {
    try {
      const id = await wa.notifyOwner(text, { imagePath, imageMime });
      if (id) rememberSent("whatsapp", "owner", text, id);
      return id || true;
    } catch (e) {
      console.error("Message WhatsApp pour toi :", e.message);
    }
  }
  const s = getSettings();
  const tg = adapters.get("telegram");
  if (s.owner_telegram_chat_id && tg?.notify) {
    await tg.notify(s.owner_telegram_chat_id, text);
    return true;
  }
  return null;
}
