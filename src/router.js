// Le chef d'orchestre : reçoit les messages de tous les canaux, attend que le
// client ait fini d'écrire, demande la réponse à l'agent puis l'envoie avec un
// rythme humain (délai, "en train d'écrire...", plusieurs bulles).
import {
  addExamples,
  addMessage,
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
} from "./db.js";
import { generateReply } from "./agent.js";
import { transcribe } from "./media.js";
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
  if (kind === "audio" && input.media) {
    const t = await transcribe(input.media.path, input.media.mime).catch((e) => {
      console.error("Transcription :", e.message);
      return null;
    });
    text = t ?? "(vocal non transcrit — configure la transcription dans Réglages)";
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
  updateContact(contact.id, { unread: (getContact(contact.id).unread || 0) + 1 });
  emit("message", { contact_id: contact.id, message: msg });
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
        console.error(`Erreur agent (contact ${contactId}) :`, e);
        updateContact(contactId, { needs_human: 1, needs_human_reason: `Erreur : ${e.message}` });
        emit("contact", { contact_id: contactId });
      });
    }, wait * 1000),
  );
}

function cancel(contactId) {
  const t = timers.get(contactId);
  if (t) clearTimeout(t);
  timers.delete(contactId);
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
  const pending = unansweredClientMessages(contactId);
  if (!pending.length) return;
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
    reply = await replyGenerator(contact);
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

  updateContact(contactId, {
    memory: reply.memory || contact.memory,
    needs_human: reply.needs_human ? 1 : contact.needs_human,
    needs_human_reason: reply.needs_human ? reply.reason : contact.needs_human_reason,
  });
  markAnswered(contactId);
  if (reply.needs_human) notifyOwner(contact, reply.reason).catch(() => {});

  if (mode === "draft") {
    for (const text of reply.messages) {
      const msg = addMessage(contactId, { author: "agent", text, status: "draft" });
      emit("message", { contact_id: contactId, message: msg });
    }
    emit("contact", { contact_id: contactId });
    return;
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

async function deliver(contact, text, author) {
  const adapter = adapters.get(contact.channel);
  if (!adapter && contact.channel !== "test") throw new Error(`Canal ${contact.channel} non connecté`);
  rememberSent(contact.channel, contact.external_id, text);
  const externalMsgId = contact.channel === "test" ? null : await adapter.send(contact, text);
  if (externalMsgId) rememberSent(contact.channel, contact.external_id, text, externalMsgId);
  const msg = addMessage(contact.id, { author, text, status: "sent", external_id: externalMsgId });
  emit("message", { contact_id: contact.id, message: msg });
  return msg;
}

/** Validation d'un brouillon depuis le tableau de bord (éventuellement corrigé). */
export async function approveDraft(messageId, editedText) {
  const m = getMessage(messageId);
  if (!m || m.status !== "draft") throw new Error("Brouillon introuvable");
  const contact = getContact(m.contact_id);
  const finalText = (editedText ?? m.text).trim();
  if (editedText && finalText !== m.text.trim()) {
    // Une correction = une leçon : on la garde comme exemple de style.
    const before = listMessages(contact.id, 30).filter((x) => x.id < m.id && x.author === "client");
    const clientText = before.slice(-3).map((x) => x.text).join("\n");
    if (clientText) addExamples([{ client_text: clientText, owner_reply: finalText }], "correction");
  }
  const adapter = adapters.get(contact.channel);
  if (!adapter && contact.channel !== "test") throw new Error(`Canal ${contact.channel} non connecté`);
  rememberSent(contact.channel, contact.external_id, finalText);
  const externalMsgId = contact.channel === "test" ? null : await adapter.send(contact, finalText);
  if (externalMsgId) rememberSent(contact.channel, contact.external_id, finalText, externalMsgId);
  updateMessage(m.id, { status: "sent", text: finalText, external_id: externalMsgId, created_at: Date.now() });
  emit("message", { contact_id: contact.id, message: getMessage(m.id) });
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

async function notifyOwner(contact, reason) {
  const s = getSettings();
  const tg = adapters.get("telegram");
  if (!s.owner_telegram_chat_id || !tg?.notify) return;
  await tg.notify(
    s.owner_telegram_chat_id,
    `🔔 ${contact.name || contact.external_id} (${contact.channel}) a besoin de toi : ${reason}`,
  );
}
