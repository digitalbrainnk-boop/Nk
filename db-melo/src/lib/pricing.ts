// Prix et formats monétaires (partagé navigateur / serveur).
import { CURRENCIES, PLANS } from "./constants";
import type { Currency, PlanId } from "./types";

export const priceOf = (plan: PlanId, currency: Currency) => PLANS[plan].prices[currency];

export function formatPrice(amount: number, currency: Currency): string {
  const whole = Number.isInteger(amount);
  if (currency === "XOF" || currency === "XAF") {
    return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(amount)} FCFA`;
  }
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(amount);
}

/** Montant en plus petite unité (centimes) ; XOF, XAF… n'ont pas de décimales. */
export const toMinor = (amount: number, currency: Currency) =>
  CURRENCIES[currency].zeroDecimal ? Math.round(amount) : Math.round(amount * 100);
