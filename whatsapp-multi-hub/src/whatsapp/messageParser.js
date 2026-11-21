// Conversion des messages bruts de Baileys (protobuf) en objets simples,
// sérialisables et identiques pour toutes les sessions.
import { BufferJSON, WAMessageStatus, getContentType, normalizeMessageContent } from "baileys";

/** Nombre WhatsApp (nombre ou Long) -> nombre JS. */
export function toNumber(value) {
  if (value === null || value === undefined) return null;
  const n = typeof value === "object" && typeof value.toNumber === "function" ? value.toNumber() : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Horodatage WhatsApp (secondes, nombre ou Long) -> millisecondes. */
export function toMillis(ts) {
  const seconds = toNumber(ts);
  return seconds && seconds > 0 ? seconds * 1000 : Date.now();
}

const ACK_TO_STATUS = {
  [WAMessageStatus.ERROR]: "error",
  [WAMessageStatus.PENDING]: "pending",
  [WAMessageStatus.SERVER_ACK]: "sent",
  [WAMessageStatus.DELIVERY_ACK]: "delivered",
  [WAMessageStatus.READ]: "read",
  [WAMessageStatus.PLAYED]: "read",
};

/** Accusé WhatsApp (0..5) -> statut lisible ; null si inconnu. */
export function statusFromAck(ack) {
  if (ack === null || ack === undefined) return null;
  return ACK_TO_STATUS[Number(ack)] ?? null;
}

// Types de message qui transportent un fichier.
const MEDIA_TYPES = new Set(["imageMessage", "videoMessage", "ptvMessage", "audioMessage", "documentMessage", "stickerMessage"]);

const MAX_THUMB_BYTES = 12 * 1024;

function mediaInfo(type, inner) {
  if (!MEDIA_TYPES.has(type)) return null;
  const thumb = inner.jpegThumbnail?.length && inner.jpegThumbnail.length <= MAX_THUMB_BYTES && type !== "stickerMessage"
    ? `data:image/jpeg;base64,${Buffer.from(inner.jpegThumbnail).toString("base64")}`
    : null;
  return {
    mimetype: inner.mimetype || null,
    fileName: inner.fileName || null,
    size: toNumber(inner.fileLength),
    seconds: toNumber(inner.seconds),
    width: toNumber(inner.width),
    height: toNumber(inner.height),
    thumb,
  };
}

/**
 * Contenu affichable d'un message : { type, text, media?, inner } ou null pour
 * ce qui n'est pas un message de conversation (accusés, messages techniques…).
 */
export function parseContent(message) {
  const content = normalizeMessageContent(message);
  if (!content) return null;
  const type = getContentType(content);
  if (!type) return null;
  const inner = content[type] ?? {};
  const media = mediaInfo(type, inner);
  const out = (kind, text = "") => ({ type: kind, text: text ?? "", media, contentType: type, inner });

  switch (type) {
    case "conversation":
      return out("text", content.conversation);
    case "extendedTextMessage":
      return out("text", inner.text);
    case "imageMessage":
      return out("image", inner.caption);
    case "videoMessage":
    case "ptvMessage":
      return out(inner.gifPlayback ? "gif" : "video", inner.caption);
    case "audioMessage":
      return out(inner.ptt ? "voice" : "audio");
    case "documentMessage":
      return out("document", inner.caption || "");
    case "stickerMessage":
      return out("sticker");
    case "locationMessage":
    case "liveLocationMessage": {
      const coords = inner.degreesLatitude != null ? `${inner.degreesLatitude}, ${inner.degreesLongitude}` : "";
      const result = out("location", inner.name || inner.address || coords);
      result.location = inner.degreesLatitude != null ? { lat: inner.degreesLatitude, lng: inner.degreesLongitude } : null;
      return result;
    }
    case "contactMessage":
      return out("contact", inner.displayName);
    case "contactsArrayMessage":
      return out("contact", inner.displayName || `${inner.contacts?.length ?? 0} contacts`);
    case "pollCreationMessage":
    case "pollCreationMessageV2":
    case "pollCreationMessageV3":
      return out("poll", [inner.name, ...(inner.options ?? []).map((o) => `• ${o.optionName}`)].filter(Boolean).join("\n"));
    case "buttonsResponseMessage":
    case "templateButtonReplyMessage":
      return out("text", inner.selectedDisplayText);
    case "listResponseMessage":
      return out("text", inner.title);
    case "interactiveResponseMessage":
      return out("text", inner.body?.text);
    case "eventMessage":
      return out("event", inner.name);
    default:
      // reactionMessage (traité à part), protocolMessage (suppression/modification
      // via messages.update), pollUpdateMessage, messages techniques…
      return null;
  }
}

/** Texte court pour une citation (« Réponse à … »). */
export function previewOf(content) {
  if (!content) return "";
  const labels = { image: "📷 Photo", video: "🎬 Vidéo", gif: "🎬 GIF", voice: "🎤 Message vocal", audio: "🎵 Audio", document: "📄 Document", sticker: "Autocollant", location: "📍 Position", contact: "👤 Contact", poll: "📊 Sondage", event: "📅 Événement" };
  const text = (content.text || content.media?.fileName || "").replace(/\s+/g, " ").trim();
  const label = labels[content.type];
  return (label && text ? `${label} · ${text}` : text || label || "Message").slice(0, 160);
}

/** Message auquel celui-ci répond (citation), s'il y en a un. */
function quotedOf(inner) {
  const ctx = inner?.contextInfo;
  if (!ctx?.stanzaId) return null;
  return {
    id: ctx.stanzaId,
    author: ctx.participant || null,
    text: previewOf(parseContent(ctx.quotedMessage)),
  };
}

/**
 * Message brut Baileys -> message simplifié (sans l'identifiant de discussion,
 * calculé par la session à cause des identifiants @lid).
 */
export function parseMessage(raw) {
  if (!raw?.key?.id || !raw.message) return null;
  const content = parseContent(raw.message);
  if (!content) return null;
  const fromMe = Boolean(raw.key.fromMe);
  const message = {
    id: raw.key.id,
    fromMe,
    // Dans un groupe : l'auteur du message.
    author: raw.key.participant || null,
    authorName: fromMe ? null : raw.pushName || null,
    type: content.type,
    text: content.text,
    timestamp: toMillis(raw.messageTimestamp),
    status: fromMe ? (statusFromAck(raw.status) ?? "sent") : "received",
  };
  if (content.media) message.media = content.media;
  if (content.location) message.location = content.location;
  const quoted = quotedOf(content.inner);
  if (quoted) message.quoted = quoted;
  return message;
}

/** Réaction (emoji) : { targetId, emoji } — emoji vide = réaction retirée. */
export function parseReaction(raw) {
  const reaction = normalizeMessageContent(raw?.message)?.reactionMessage;
  if (!reaction?.key?.id) return null;
  return { targetId: reaction.key.id, emoji: reaction.text || "" };
}

/**
 * Référence de téléchargement d'un média (clés de chiffrement + adresse) :
 * permet de récupérer le fichier plus tard, même après un redémarrage.
 */
export function mediaRef(raw) {
  const content = normalizeMessageContent(raw.message);
  const type = content && getContentType(content);
  if (!type || !MEDIA_TYPES.has(type)) return null;
  const inner = { ...content[type] };
  delete inner.jpegThumbnail;
  delete inner.contextInfo;
  return JSON.stringify({ key: raw.key, message: { [type]: inner } }, BufferJSON.replacer);
}

export function readMediaRef(ref) {
  return JSON.parse(ref, BufferJSON.reviver);
}
