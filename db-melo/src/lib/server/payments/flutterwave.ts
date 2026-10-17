// Flutterwave : Mobile Money au Ghana, Kenya (M-Pesa), Ouganda, Rwanda, Zambie, Tanzanie,
// et en zone francophone ; cartes bancaires dans toute l'Afrique.
//   POST https://api.flutterwave.com/v3/payments → data.link (page de paiement hébergée)
//   GET  https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=… → data.status === "successful"
//   Webhook : en-tête verif-hash = « Secret hash » défini dans le tableau de bord Flutterwave
import { timingSafeEqual } from "node:crypto";
import { BRAND, findCountry } from "../../constants";
import type { PaymentProvider } from "../../types";
import { config } from "../env";
import { HttpError } from "../http";

const API = "https://api.flutterwave.com/v3";

/** Option de paiement Flutterwave pour le Mobile Money de chaque pays. */
const MOMO_OPTION: Record<string, string> = {
  GH: "mobilemoneyghana",
  KE: "mpesa",
  UG: "mobilemoneyuganda",
  RW: "mobilemoneyrwanda",
  ZM: "mobilemoneyzambia",
  TZ: "mobilemoneytanzania",
  CI: "mobilemoneyfranco",
  SN: "mobilemoneyfranco",
  CM: "mobilemoneyfranco",
  BF: "mobilemoneyfranco",
};

async function flw<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status?: string; message?: string; data?: T }> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${config.flutterwave().secretKey}`, "Content-Type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  return (await res.json().catch(() => ({}))) as { status?: string; message?: string; data?: T };
}

export const flutterwave: PaymentProvider = {
  id: "flutterwave",
  label: "Flutterwave",
  methods: ["mobile_money", "card"],
  currencies: ["XOF", "XAF", "GHS", "KES", "UGX", "RWF", "ZMW", "TZS", "EUR", "USD"],
  momoCountries: Object.keys(MOMO_OPTION),

  isConfigured: () => !!config.flutterwave().secretKey,

  async createCheckout(input) {
    const country = findCountry(input.country);
    const email = input.email || config.merchantEmail();
    if (!email) throw new HttpError(400, "Indiquez votre adresse e-mail pour recevoir le reçu.");
    const option = input.method === "card" ? "card" : MOMO_OPTION[input.country ?? ""];
    if (!option) throw new HttpError(400, "Mobile Money indisponible dans ce pays avec Flutterwave.");
    const r = await flw<{ link?: string }>("/payments", {
      method: "POST",
      body: {
        tx_ref: input.reference,
        amount: input.amount,
        currency: input.currency,
        redirect_url: input.returnUrl,
        payment_options: option,
        customer: {
          email,
          phonenumber: input.phone && country ? `+${country.dial}${input.phone}` : undefined,
          name: input.customerName || "Client DB.Mélo",
        },
        customizations: {
          title: BRAND.name,
          description: `Chanson « ${input.song.config.title} »`,
          logo: `${new URL(input.returnUrl).origin}/icons/192`,
        },
        meta: { songId: input.song.id },
      },
    });
    if (r.status !== "success" || !r.data?.link) throw new HttpError(502, `Flutterwave : ${r.message ?? "paiement impossible à initialiser"}`);
    return { redirectUrl: r.data.link };
  },

  async verify(payment) {
    const r = await flw<{ status?: string; amount?: number; currency?: string; id?: number }>(
      `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(payment.reference)}`,
    );
    const d = r.data;
    if (r.status === "success" && d?.status === "successful") {
      return { status: "paid", amount: d.amount, currency: d.currency, providerRef: d.id ? String(d.id) : undefined };
    }
    if (d?.status === "failed") return { status: "failed" };
    return { status: "pending" };
  },

  async parseWebhook(req, rawBody) {
    const expected = config.flutterwave().webhookHash;
    const given = req.headers.get("verif-hash") ?? "";
    if (!expected || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
      throw new HttpError(401, "Signature Flutterwave invalide.");
    }
    const event = JSON.parse(rawBody) as { data?: { tx_ref?: string; status?: string } };
    if (!event.data?.tx_ref) return null;
    return { reference: event.data.tx_ref, claimedStatus: event.data.status === "successful" ? "paid" : "pending" };
  },
};
