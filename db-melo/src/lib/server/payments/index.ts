// Choix de la passerelle selon le pays, le moyen de paiement, la devise et les clés configurées.
import { CARD_CURRENCIES, COUNTRIES } from "../../constants";
import type { CountryCode, Currency, PaymentOptions, PaymentProvider, PaymentProviderId, SongRecord } from "../../types";
import { config } from "../env";
import { HttpError } from "../http";
import { chariow } from "./chariow";
import { cinetpay } from "./cinetpay";
import { demoProvider } from "./demo";
import { fedapay } from "./fedapay";
import { flutterwave } from "./flutterwave";
import { paystack } from "./paystack";
import { stripeProvider } from "./stripe";

export const PROVIDERS: Record<PaymentProviderId, PaymentProvider> = {
  chariow,
  fedapay,
  cinetpay,
  flutterwave,
  paystack,
  stripe: stripeProvider,
  demo: demoProvider,
};

// Ordre de préférence : Chariow puis les agrégateurs régionaux pour le Mobile Money ; pour les cartes,
// Chariow puis Stripe, FedaPay…
const MOMO_ORDER: PaymentProviderId[] = ["chariow", "fedapay", "cinetpay", "flutterwave", "paystack"];
const CARD_ORDER: PaymentProviderId[] = ["chariow", "stripe", "fedapay", "flutterwave", "paystack", "cinetpay"];

const demoAllowed = (song?: SongRecord | null) => config.allowDemoPayments() || !!song?.demo;

/** Passerelle Mobile Money pour ce pays (dans la monnaie locale), ou null. */
export function momoProviderFor(country: CountryCode, song?: SongRecord | null): PaymentProvider | null {
  const info = COUNTRIES.find((c) => c.code === country);
  if (!info?.momo) return null;
  // Une chanson de démonstration ne se paie jamais réellement.
  if (song?.demo) return demoProvider;
  const currency = info.momo.currency;
  const real = MOMO_ORDER.map((id) => PROVIDERS[id]).find(
    (p) => p.isConfigured() && p.momoCountries.includes(country) && p.currencies.includes(currency),
  );
  return real ?? (demoAllowed(song) ? demoProvider : null);
}

export function cardProviderFor(song?: SongRecord | null): PaymentProvider | null {
  if (song?.demo) return demoProvider;
  const real = CARD_ORDER.map((id) => PROVIDERS[id]).find((p) => p.isConfigured() && p.methods.includes("card"));
  return real ?? (demoAllowed(song) ? demoProvider : null);
}

export function paymentOptions(song?: SongRecord | null): PaymentOptions {
  const mobileMoney: Record<CountryCode, PaymentProviderId> = {};
  for (const c of COUNTRIES) {
    const p = momoProviderFor(c.code, song);
    if (p) mobileMoney[c.code] = p.id;
  }
  const card = cardProviderFor(song);
  return {
    mobileMoney,
    card: card ? { provider: card.id, currencies: CARD_CURRENCIES.filter((c) => card.currencies.includes(c)) } : null,
    demo: Object.values(mobileMoney).includes("demo") || card?.id === "demo",
  };
}

export function resolveCardProvider(currency: Currency, song: SongRecord): PaymentProvider {
  const provider = cardProviderFor(song);
  if (!provider) throw new HttpError(503, "Le paiement par carte n'est pas encore disponible.");
  if (!CARD_CURRENCIES.includes(currency) || !provider.currencies.includes(currency)) {
    throw new HttpError(400, `Devise ${currency} non disponible pour le paiement par carte.`);
  }
  return provider;
}
