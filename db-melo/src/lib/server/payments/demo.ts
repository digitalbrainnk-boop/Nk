// Paiement simulé : chansons de démonstration, ou ALLOW_DEMO_PAYMENTS=true pour les tests.
import { COUNTRIES, CURRENCIES } from "../../constants";
import type { Currency, PaymentProvider } from "../../types";

export const demoProvider: PaymentProvider = {
  id: "demo",
  label: "Paiement de démonstration",
  methods: ["mobile_money", "card"],
  currencies: Object.keys(CURRENCIES) as Currency[],
  momoCountries: COUNTRIES.filter((c) => c.momo).map((c) => c.code),
  isConfigured: () => true,
  async createCheckout(input) {
    return { redirectUrl: input.returnUrl, providerRef: `demo-${input.reference}` };
  },
  async verify(payment) {
    return { status: "paid", amount: payment.amount, currency: payment.currency };
  },
  async parseWebhook() {
    return null;
  },
};
