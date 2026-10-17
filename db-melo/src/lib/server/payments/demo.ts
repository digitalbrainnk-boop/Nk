// Paiement simulé : chansons de démonstration, ou ALLOW_DEMO_PAYMENTS=true pour les tests.
import type { PaymentProvider } from "../../types";

export const demoProvider: PaymentProvider = {
  id: "demo",
  label: "Paiement de démonstration",
  methods: ["mobile_money", "card"],
  currencies: ["XOF", "XAF", "EUR", "USD"],
  operators: ["orange_money", "wave", "mtn_momo", "moov_money"],
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
