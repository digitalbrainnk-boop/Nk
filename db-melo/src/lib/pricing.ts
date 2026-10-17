// Prix et formats monétaires (partagé navigateur / serveur).
import { CURRENCIES, PLANS } from "./constants";
import type { Currency, PlanId } from "./types";

export const priceOf = (plan: PlanId, currency: Currency) => PLANS[plan].prices[currency];

export function formatPrice(amount: number, currency: Currency): string {
  if (currency === "XOF" || currency === "XAF") {
    return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(amount)} FCFA`;
  }
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(amount);
}

/** Montant en plus petite unité (centimes) ; XOF et XAF n'ont pas de décimales. */
export const toMinor = (amount: number, currency: Currency) =>
  CURRENCIES[currency].zeroDecimal ? Math.round(amount) : Math.round(amount * 100);

const XOF_ZONES = ["Abidjan", "Dakar", "Ouagadougou", "Bamako", "Lome", "Porto-Novo", "Niamey", "Bissau"];
const XAF_ZONES = ["Douala", "Libreville", "Brazzaville", "Bangui", "Ndjamena", "Malabo"];

/** Devise probable d'après le fuseau horaire et la langue du navigateur. */
export function guessCurrency(timeZone?: string, language?: string): Currency {
  const tz = timeZone ?? "";
  if (XOF_ZONES.some((z) => tz.endsWith(z))) return "XOF";
  if (XAF_ZONES.some((z) => tz.endsWith(z))) return "XAF";
  if (tz.startsWith("Europe/")) return "EUR";
  if (/^fr/i.test(language ?? "") && tz.startsWith("Africa/")) return "XOF";
  return "USD";
}
