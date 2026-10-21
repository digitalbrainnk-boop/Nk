// Le chef d'orchestre : reçoit les messages de tous les canaux, attend que le
// client ait fini d'écrire, demande la réponse à l'agent puis l'envoie avec un
// rythme humain (délai, "en train d'écrire...", plusieurs bulles).
import {
  activeOrder,
  addExamples,
  dueLyrics,
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
  if (kind === "audio" && input.media) {
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
  const clean = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ""));
  if (!Object.keys(clean).length) return;
  const cur = activeOrder(contactId);
  if (cur) {
    // L'agent ne fait jamais reculer une commande déjà payée ou en création.
    if (clean.stage && ["acompte", "creation"].includes(cur.stage)) delete clean.stage;
    if (clean.stage === "nouveau" && cur.stage === "devis") delete clean.stage;
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
  if (reply.needs_human && reply.song_step !== "payment_claimed" && !reply.special_request) notifyOwner(contact, reply.reason).catch(() => {});
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
  const audio = await withCredits({ contactId: contact.id, kind: "voice" }, () => textToSpeech(text));
  const adapter = adapters.get(contact.channel);
  let externalMsgId = null;
  if (contact.channel !== "test") {
    if (!adapter?.sendAudio) throw new Error("Ce canal ne permet pas d'envoyer un vocal.");
    externalMsgId = await adapter.sendAudio(contact, { ...audio, voice: true });
    if (externalMsgId) rememberSent(contact.channel, contact.external_id, "", externalMsgId);
  }
  const fields = {
    kind: "voice",
    text,
    media_path: audio.path,
    media_type: audio.mime,
    media_url: audio.url,
    status: "sent",
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
  if (!adapter && contact.channel !== "test") throw new Error(`Canal ${contact.channel} non connecté`);
  rememberSent(contact.channel, contact.external_id, text);
  const externalMsgId = contact.channel === "test" ? null : await adapter.send(contact, text);
  if (externalMsgId) rememberSent(contact.channel, contact.external_id, text, externalMsgId);
  const msg = addMessage(contact.id, { author, text, status: "sent", external_id: externalMsgId });
  emit("message", { contact_id: contact.id, message: msg });
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

export async function sendSong(contact, m) {
  const adapter = adapters.get(contact.channel);
  if (!adapter && contact.channel !== "test") throw new Error(`Canal ${contact.channel} non connecté`);
  let externalMsgId = null;
  if (contact.channel !== "test") {
    if (adapter.sendAudio) {
      externalMsgId = await adapter.sendAudio(contact, { path: m.media_path, mime: m.media_type, url: m.media_url, title: m.text });
    } else if (m.media_url) {
      // Canal sans envoi de fichier (ex. commentaire public) : on envoie le lien.
      externalMsgId = await adapter.send(contact, `${m.text}\n${m.media_url}`);
    } else {
      throw new Error("Ce canal ne permet pas d'envoyer un fichier audio.");
    }
  }
  if (externalMsgId) rememberSent(contact.channel, contact.external_id, "", externalMsgId);
  updateMessage(m.id, { status: "sent", external_id: externalMsgId, created_at: Date.now() });
  emit("message", { contact_id: contact.id, message: getMessage(m.id) });
  // Chanson envoyée après paiement : la commande passe en « livrée ».
  const order = activeOrder(contact.id);
  if (order && ["acompte", "creation"].includes(order.stage)) {
    saveOrder({ id: order.id, stage: "livree" });
    emit("order", { contact_id: contact.id });
  }
}

/**
 * Lance Suno en arrière-plan. Chaque version créée apparaît comme un brouillon
 * audio que le propriétaire écoute puis envoie (ou rejette).
 */
export async function createSong(contactId, brief, { orderId, autoSend = false } = {}) {
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
          await sendSong(getContact(contactId), getMessage(placeholder.id));
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
export async function proposeLyrics(contactId, { revise = false, notes = "", mode } = {}) {
  const contact = getContact(contactId);
  let order = activeOrder(contactId) || saveOrder({ contact_id: contactId, stage: "nouveau" });
  const isRevision = revise && !!order.lyrics;
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
  emit("order", { contact_id: contactId });
  const text = `🎵 ${brief.title}${isRevision ? " (version corrigée)" : ""}\n\n${brief.lyrics}\n\nDis-moi si ce texte te plaît, ou ce que tu veux changer 😊`;
  if ((mode || channelMode(contact.channel)) === "draft") {
    const msg = addMessage(contactId, { author: "agent", text, status: "draft" });
    emit("message", { contact_id: contactId, message: msg });
  } else {
    await deliver(contact, text, "agent");
  }
  return order;
}

/** Lance la composition avec Suno à partir du texte validé. */
export async function startComposition(contactId) {
  const order = activeOrder(contactId);
  if (!order?.lyrics) throw new Error("Aucun texte validé pour ce client.");
  const s = getSettings();
  saveOrder({
    id: order.id,
    lyrics_status: "composing",
    stage: ["nouveau", "devis", "acompte"].includes(order.stage) ? "creation" : order.stage,
  });
  emit("order", { contact_id: contactId });
  try {
    return await createSong(
      contactId,
      { title: order.song_title || order.title || "Chanson", style: order.song_style, lyrics: order.lyrics },
      { orderId: order.id, autoSend: !!s.song_auto_send },
    );
  } catch (e) {
    // Suno n'a pas pu démarrer (crédit, clé…) : on revient à « validé » pour pouvoir relancer.
    saveOrder({ id: order.id, lyrics_status: "validated" });
    emit("order", { contact_id: contactId });
    throw e;
  }
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
export async function runLyricsQueue(at = Date.now()) {
  let n = 0;
  for (const o of dueLyrics(at)) {
    let opts = {};
    try {
      opts = JSON.parse(o.lyrics_notes || "{}");
    } catch {}
    // On passe tout de suite en « proposed » pour ne pas l'envoyer deux fois.
    saveOrder({ id: o.id, lyrics_status: o.lyrics ? "proposed" : "", lyrics_due_at: 0 });
    try {
      await proposeLyrics(o.contact_id, { revise: !!opts.revise, notes: opts.notes || "" });
      n++;
    } catch (e) {
      console.error("Texte de chanson :", e.message);
      // Nouvel essai dans 1 min ; l'erreur est gardée pour la surveillance.
      const tries = (Number(opts.tries) || 0) + 1;
      saveOrder({
        id: o.id,
        lyrics_status: "writing",
        lyrics_due_at: Date.now() + 60_000,
        lyrics_notes: JSON.stringify({ ...opts, tries, error: friendlyError(e) }),
      });
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
    const revise = reply.song_step === "revise_lyrics";
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
    if (s.compose_requires_payment && !(order.paid > 0)) {
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
  saveOrder({
    id: order.id,
    paid: order.paid > 0 ? order.paid : order.price || 0,
    stage: ["nouveau", "devis"].includes(order.stage) ? "acompte" : order.stage,
  });
  updateContact(contactId, { needs_human: 0, needs_human_reason: null });
  emitHook("order.paid", { contact: who(contact), order: activeOrder(contactId), confirmed_by: by });
  const ready = order.lyrics && ["validated", "payment_claimed"].includes(order.lyrics_status);
  if (order.lyrics_status === "payment_claimed" && !order.lyrics) saveOrder({ id: order.id, lyrics_status: "" });
  const say = (text) => deliver(contact, text, "agent").catch((e) => console.error("Message de confirmation :", e.message));
  if (!ready) {
    // Payé avant d'avoir validé le texte : la composition partira dès qu'il le valide.
    await say("Paiement bien reçu, merci 🙏");
    emit("order", { contact_id: contactId });
    return activeOrder(contactId);
  }
  await say("Paiement bien reçu, merci 🙏 Je compose ta chanson maintenant, tu la reçois dans une dizaine de minutes 🎶");
  await startComposition(contactId);
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
    if (o && (claimed || ["payment_claimed", "validated"].includes(o.lyrics_status))) contactId = c.id;
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
  if (!s.followup_enabled) return 0;
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
