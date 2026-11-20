// Conversion des messages bruts de Baileys (protobuf) en objets simples,
// sérialisables et identiques pour toutes les sessions.
import { WAMessageStatus, getContentType, normalizeMessageContent } from "baileys";

/** Horodatage WhatsApp (secondes, nombre ou Long) -> millisecondes. */
export function toMillis(ts) {
  if (ts === null || ts === undefined) return Date.now();
  const seconds = typeof ts === "object" && typeof ts.toNumber === "function" ? ts.toNumber() : Number(ts);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Date.now();
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

/**
 * Contenu affichable d'un message : { type, text } ou null pour ce qui n'est
 * pas un message de conversation (réactions, accusés, messages techniques…).
 */
export function parseContent(message) {
  const content = normalizeMessageContent(message);
  if (!content) return null;
  const type = getContentType(content);
  if (!type) return null;
  const inner = content[type] ?? {};

  switch (type) {
    case "conversation":
      return { type: "text", text: content.conversation ?? "" };
    case "extendedTextMessage":
      return { type: "text", text: inner.text ?? "" };
    case "imageMessage":
      return { type: "image", text: inner.caption ?? "" };
    case "videoMessage":
    case "ptvMessage":
      return { type: inner.gifPlayback ? "gif" : "video", text: inner.caption ?? "" };
    case "audioMessage":
      return { type: inner.ptt ? "voice" : "audio", text: "" };
    case "documentMessage":
      return { type: "document", text: inner.caption || inner.fileName || "" };
    case "stickerMessage":
      return { type: "sticker", text: "" };
    case "locationMessage":
    case "liveLocationMessage": {
      const coords = inner.degreesLatitude != null ? `${inner.degreesLatitude}, ${inner.degreesLongitude}` : "";
      return { type: "location", text: inner.name || inner.address || coords };
    }
    case "contactMessage":
      return { type: "contact", text: inner.displayName ?? "" };
    case "contactsArrayMessage":
      return { type: "contact", text: inner.displayName || `${inner.contacts?.length ?? 0} contacts` };
    case "pollCreationMessage":
    case "pollCreationMessageV2":
    case "pollCreationMessageV3":
      return { type: "poll", text: inner.name ?? "" };
    case "buttonsResponseMessage":
    case "templateButtonReplyMessage":
      return { type: "text", text: inner.selectedDisplayText ?? "" };
    case "listResponseMessage":
      return { type: "text", text: inner.title ?? "" };
    case "interactiveResponseMessage":
      return { type: "text", text: inner.body?.text ?? "" };
    case "eventMessage":
      return { type: "event", text: inner.name ?? "" };
    default:
      // reactionMessage, protocolMessage (suppression/modification gérées via messages.update),
      // pollUpdateMessage, messages techniques…
      return null;
  }
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
  return {
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
}
