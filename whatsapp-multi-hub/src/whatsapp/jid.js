// Numéros de téléphone et identifiants WhatsApp (JID).
import {
  isJidBroadcast,
  isJidGroup,
  isJidMetaAI,
  isJidNewsletter,
  isJidStatusBroadcast,
  isLidUser,
  isPnUser,
  jidDecode,
  jidNormalizedUser,
} from "baileys";
import { badRequest } from "../errors.js";

/**
 * Numéro international en chiffres uniquement : indicatif pays + numéro,
 * sans « + » ni « 00 » (ex. 33612345678, 22670123456).
 */
export function normalizePhone(input) {
  let digits = String(input ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) {
    throw badRequest("Numéro incomplet : commence par l'indicatif du pays (ex. 33 pour la France, 225 pour la Côte d'Ivoire), sans le 0.", "invalid_phone");
  }
  if (digits.length < 8 || digits.length > 15) {
    throw badRequest("Numéro invalide : indicatif pays + numéro, 8 à 15 chiffres (ex. 33612345678).", "invalid_phone");
  }
  return digits;
}

export const phoneToJid = (digits) => `${digits}@s.whatsapp.net`;

/** Numéro de téléphone d'un JID « téléphone » (null pour un groupe ou un @lid). */
export function jidToPhone(jid) {
  if (!jid || !isPnUser(jid)) return null;
  return jidDecode(jid)?.user ?? null;
}

export const isGroupJid = (jid) => Boolean(jid && isJidGroup(jid));

/** Conversations qu'on n'affiche pas : statuts, listes de diffusion, chaînes, IA Meta. */
export function isIgnoredJid(jid) {
  return (
    !jid ||
    isJidStatusBroadcast(jid) ||
    isJidBroadcast(jid) ||
    isJidNewsletter(jid) ||
    Boolean(isJidMetaAI(jid))
  );
}

/** Destinataire saisi par l'utilisateur : numéro de téléphone ou JID complet. */
export function resolveRecipient(to) {
  const raw = String(to ?? "").trim();
  if (!raw) throw badRequest("Destinataire manquant (champ « to »).", "missing_recipient");
  if (raw.includes("@")) {
    const jid = jidNormalizedUser(raw);
    if (!jid || !(isPnUser(jid) || isLidUser(jid) || isJidGroup(jid))) {
      throw badRequest(`Identifiant WhatsApp invalide : ${raw}`, "invalid_recipient");
    }
    return { jid, fromPhone: false };
  }
  return { jid: phoneToJid(normalizePhone(raw)), fromPhone: true };
}

export { isLidUser, isPnUser, jidNormalizedUser };
