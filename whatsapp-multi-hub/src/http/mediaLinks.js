// Liens signés vers les fichiers d'une ligne : une balise <img>/<video>/<audio>
// ne peut pas envoyer le jeton d'accès, on lui donne donc une adresse signée
// (valable 1 à 2 jours) qui n'ouvre QUE ce fichier-là.
import crypto from "node:crypto";

const DAY = 24 * 60 * 60 * 1000;

export function createMediaLinks(secret) {
  const key = crypto.createHash("sha256").update(`media-links:${secret}`).digest();
  const sign = (sessionId, chatId, messageId, exp) =>
    crypto.createHmac("sha256", key).update(`${sessionId}\n${chatId}\n${messageId}\n${exp}`).digest("base64url");

  return {
    /** Adresse relative (à préfixer par l'adresse du serveur côté client). */
    url(sessionId, chatId, messageId) {
      // Expiration arrondie au jour : la même adresse reste valable (et en cache) toute la journée.
      const exp = (Math.floor(Date.now() / DAY) + 2) * DAY;
      const enc = encodeURIComponent;
      return `/media/${enc(sessionId)}/${enc(chatId)}/${enc(messageId)}?exp=${exp}&sig=${sign(sessionId, chatId, messageId, exp)}`;
    },
    verify(sessionId, chatId, messageId, exp, sig) {
      const expires = Number(exp);
      if (!Number.isFinite(expires) || expires < Date.now() || typeof sig !== "string") return false;
      const expected = Buffer.from(sign(sessionId, chatId, messageId, expires));
      const given = Buffer.from(sig);
      return expected.length === given.length && crypto.timingSafeEqual(expected, given);
    },
    /** Copie du message avec l'adresse de son fichier (jamais modifié en place). */
    decorate(sessionId, message) {
      if (!message?.media || message.deleted) return message;
      return { ...message, media: { ...message.media, url: this.url(sessionId, message.chatId, message.id) } };
    },
  };
}
