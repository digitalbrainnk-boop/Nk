// Choix de la passerelle selon le moyen de paiement, la devise et les clés configurées.
import type { Currency, PaymentMethod, PaymentOptions, PaymentProvider, PaymentProviderId, SongRecord } from "../../types";
import { config } from "../env";
import { HttpError } from "../http";
import { cinetpay } from "./cinetpay";
import { demoProvider } from "./demo";
import { paystack } from "./paystack";
import { stripeProvider } from "./stripe";

export const PROVIDERS: Record<PaymentProviderId, PaymentProvider> = {
  cinetpay,
  paystack,
  stripe: stripeProvider,
  demo: demoProvider,
};

// Ordre de préférence : agrégateur régional pour le Mobile Money, Stripe pour les cartes.
const PREFERENCE: Record<PaymentMethod, PaymentProviderId[]> = {
  mobile_money: ["cinetpay", "paystack"],
  card: ["stripe", "paystack", "cinetpay"],
};

const demoAllowed = (song?: SongRecord | null) => config.allowDemoPayments() || !!song?.demo;

function providerFor(method: PaymentMethod, song?: SongRecord | null): PaymentProvider | null {
  // Une chanson de démonstration ne se paie jamais réellement.
  if (song?.demo) return demoProvider;
  const real = PREFERENCE[method].map((id) => PROVIDERS[id]).find((p) => p.isConfigured() && p.methods.includes(method));
  return real ?? (demoAllowed(song) ? demoProvider : null);
}

export function paymentOptions(song?: SongRecord | null): PaymentOptions {
  const mm = providerFor("mobile_money", song);
  const card = providerFor("card", song);
  return {
    mobileMoney: mm ? { provider: mm.id, currencies: mm.currencies, operators: mm.operators } : null,
    card: card ? { provider: card.id, currencies: card.currencies } : null,
    demo: mm?.id === "demo" || card?.id === "demo",
  };
}

export function resolveProvider(method: PaymentMethod, currency: Currency, song: SongRecord): PaymentProvider {
  const provider = providerFor(method, song);
  if (!provider) throw new HttpError(503, "Ce moyen de paiement n'est pas encore disponible.");
  if (!provider.currencies.includes(currency)) {
    throw new HttpError(400, `Devise ${currency} non disponible avec ce moyen de paiement (${provider.currencies.join(", ")}).`);
  }
  return provider;
}
