import { randomBytes } from "node:crypto";

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
// Octets rejetés au-delà du plus grand multiple de la taille de l'alphabet : pas de biais modulo.
const LIMIT = 256 - (256 % ALPHA.length);

/** Identifiant aléatoire non devinable (≈ 5,8 bits par caractère). */
export function randomId(length = 22): string {
  const bytes = randomBytes(length * 2);
  let out = "";
  for (let i = 0; out.length < length && i < bytes.length; i++) {
    const b = bytes[i];
    if (b < LIMIT) out += ALPHA[b % ALPHA.length];
  }
  return out.length === length ? out : randomId(length);
}

/** Référence de paiement : lettres majuscules et chiffres (accepté par FedaPay, CinetPay, Paystack et Stripe). */
export function paymentReference(): string {
  return `DBM${Date.now().toString(36).toUpperCase()}${randomBytes(5).toString("hex").toUpperCase()}`;
}
