// Paystack : cartes (dont Apple Pay) et Mobile Money (Ghana, Kenya, Côte d'Ivoire…).
//   POST https://api.paystack.co/transaction/initialize → data.authorization_url
//   GET  https://api.paystack.co/transaction/verify/:reference → data.status === "success"
//   Webhook : en-tête x-paystack-signature = HMAC-SHA512(clé secrète, corps brut)
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentProvider } from "../../types";
import { config } from "../env";
import { HttpError } from "../http";

const API = "https://api.paystack.co";

async function paystackApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${config.paystackSecret()}`, "Content-Type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: T };
  if (!res.ok || !data.status) throw new HttpError(502, `Paystack : ${data.message ?? res.status}`);
  return data.data as T;
}

export function paystackSignature(rawBody: string, secret: string): string {
  return createHmac("sha512", secret).update(rawBody).digest("hex");
}

export const paystack: PaymentProvider = {
  id: "paystack",
  label: "Paystack",
  methods: ["card", "mobile_money"],
  currencies: ["XOF", "USD"],
  operators: ["mtn_momo", "orange_money", "moov_money", "wave"],

  isConfigured: () => !!config.paystackSecret(),

  async createCheckout(input) {
    if (!input.email) throw new HttpError(400, "Une adresse e-mail est nécessaire pour payer avec Paystack.");
    const data = await paystackApi<{ authorization_url: string; reference: string }>("/transaction/initialize", {
      method: "POST",
      body: {
        email: input.email,
        // Paystack attend la sous-unité de la devise (montant × 100), y compris pour le XOF.
        amount: String(Math.round(input.amount * 100)),
        currency: input.currency,
        reference: input.reference,
        callback_url: input.returnUrl,
        channels: input.method === "card" ? ["card", "apple_pay"] : ["mobile_money"],
        metadata: { songId: input.song.id, plan: input.plan, cancel_action: input.cancelUrl },
      },
    });
    return { redirectUrl: data.authorization_url, providerRef: data.reference };
  },

  async verify(payment) {
    const data = await paystackApi<{ status: string; amount: number; currency: string }>(
      `/transaction/verify/${encodeURIComponent(payment.reference)}`,
    );
    if (data.status === "success") return { status: "paid", amount: data.amount / 100, currency: data.currency, raw: data };
    if (data.status === "failed" || data.status === "reversed") return { status: "failed", raw: data };
    return { status: "pending", raw: data };
  },

  async parseWebhook(req, rawBody) {
    const signature = req.headers.get("x-paystack-signature") ?? "";
    const expected = paystackSignature(rawBody, config.paystackSecret());
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      throw new HttpError(401, "Signature Paystack invalide.");
    }
    const event = JSON.parse(rawBody) as { event?: string; data?: { reference?: string } };
    if (!event.data?.reference) return null;
    return { reference: event.data.reference, claimedStatus: event.event === "charge.success" ? "paid" : "pending" };
  },
};
