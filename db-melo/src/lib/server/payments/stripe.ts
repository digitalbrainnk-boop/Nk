// Stripe Checkout : Visa, Mastercard, Apple Pay, Google Pay (EUR, USD, XOF, XAF).
// Les moyens affichés (dont Apple Pay / Google Pay) se règlent dans le tableau de bord Stripe.
import Stripe from "stripe";
import { BRAND, PLANS } from "../../constants";
import { toMinor } from "../../pricing";
import { CURRENCIES } from "../../constants";
import type { Currency, PaymentProvider } from "../../types";
import { config } from "../env";
import { HttpError } from "../http";

let client: Stripe | null = null;
const stripe = () => (client ??= new Stripe(config.stripeSecret()));

export const stripeProvider: PaymentProvider = {
  id: "stripe",
  label: "Stripe",
  methods: ["card"],
  currencies: ["EUR", "USD", "XOF", "XAF"],
  momoCountries: [],

  isConfigured: () => !!config.stripeSecret(),

  async createCheckout(input) {
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: toMinor(input.amount, input.currency),
            product_data: {
              name: `${BRAND.name} — ${PLANS[input.plan].name}`,
              description: `Chanson personnalisée « ${input.song.config.title} »`,
            },
          },
        },
      ],
      success_url: input.returnUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.reference,
      customer_email: input.email,
      metadata: { reference: input.reference, songId: input.song.id, plan: input.plan },
      payment_intent_data: { metadata: { reference: input.reference, songId: input.song.id } },
      locale: "fr",
    });
    if (!session.url) throw new HttpError(502, "Stripe n'a pas renvoyé de page de paiement.");
    return { redirectUrl: session.url, providerRef: session.id };
  },

  async verify(payment) {
    if (!payment.providerRef) return { status: "pending" };
    const s = await stripe().checkout.sessions.retrieve(payment.providerRef);
    const currency = (s.currency ?? "").toUpperCase() as Currency;
    const amount = s.amount_total == null ? undefined : CURRENCIES[currency]?.zeroDecimal ? s.amount_total : s.amount_total / 100;
    if (s.payment_status === "paid" || s.payment_status === "no_payment_required") {
      return { status: "paid", amount, currency, providerRef: s.id };
    }
    if (s.status === "expired") return { status: "failed", providerRef: s.id };
    return { status: "pending", providerRef: s.id };
  },

  async parseWebhook(req, rawBody) {
    const signature = req.headers.get("stripe-signature") ?? "";
    let event: Stripe.Event;
    try {
      event = stripe().webhooks.constructEvent(rawBody, signature, config.stripeWebhookSecret());
    } catch {
      throw new HttpError(400, "Signature Stripe invalide.");
    }
    if (!event.type.startsWith("checkout.session.")) return null;
    const session = event.data.object as Stripe.Checkout.Session;
    const reference = session.client_reference_id ?? session.metadata?.reference;
    if (!reference) return null;
    const paid = event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded";
    const failed = event.type === "checkout.session.async_payment_failed" || event.type === "checkout.session.expired";
    return { reference, claimedStatus: paid ? "paid" : failed ? "failed" : "pending" };
  },
};
