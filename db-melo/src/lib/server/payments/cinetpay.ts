// CinetPay : agrégateur Mobile Money d'Afrique de l'Ouest et centrale
// (Orange Money, Wave, MTN MoMo, Moov Money…) en XOF / XAF.
//   POST https://api-checkout.cinetpay.com/v2/payment        → data.payment_url
//   POST https://api-checkout.cinetpay.com/v2/payment/check  → data.status (ACCEPTED, REFUSED…)
//   Notification : POST x-www-form-urlencoded + en-tête x-token (HMAC-SHA256 avec la clé secrète)
import { createHmac, timingSafeEqual } from "node:crypto";
import { COUNTRIES } from "../../constants";
import type { PaymentProvider } from "../../types";
import { config } from "../env";
import { HttpError } from "../http";

const API = "https://api-checkout.cinetpay.com/v2";

const TOKEN_FIELDS = [
  "cpm_site_id", "cpm_trans_id", "cpm_trans_date", "cpm_amount", "cpm_currency", "signature", "payment_method",
  "cel_phone_num", "cpm_phone_prefixe", "cpm_language", "cpm_version", "cpm_payment_config", "cpm_page_action",
  "cpm_custom", "cpm_designation", "cpm_error_message",
];

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  return (await res.json().catch(() => ({}))) as T;
}

/** CinetPay refuse les caractères spéciaux dans la description. */
const clean = (s: string) => s.normalize("NFD").replace(/[^A-Za-z0-9 .-]/g, " ").replace(/\s+/g, " ").trim();

export function cinetpayToken(fields: URLSearchParams, secret: string): string {
  return createHmac("sha256", secret).update(TOKEN_FIELDS.map((f) => fields.get(f) ?? "").join("")).digest("hex");
}

export const cinetpay: PaymentProvider = {
  id: "cinetpay",
  label: "CinetPay",
  methods: ["mobile_money", "card"],
  currencies: ["XOF", "XAF"],
  operators: ["orange_money", "wave", "mtn_momo", "moov_money"],

  isConfigured() {
    const c = config.cinetpay();
    return !!(c.apiKey && c.siteId && c.secretKey);
  },

  async createCheckout(input) {
    const c = config.cinetpay();
    const country = COUNTRIES.find((x) => x.code === input.country);
    const [first, ...rest] = (input.customerName || "Client DB.Melo").split(" ");
    const data = await post<{ code?: string; description?: string; message?: string; data?: { payment_url?: string; payment_token?: string } }>(
      "/payment",
      {
        apikey: c.apiKey,
        site_id: c.siteId,
        transaction_id: input.reference,
        amount: Math.round(input.amount),
        currency: input.currency,
        description: clean(`DB.Melo ${input.plan} ${input.song.config.title}`).slice(0, 100),
        notify_url: input.notifyUrl,
        return_url: input.returnUrl,
        channels: input.method === "card" ? "CREDIT_CARD" : "MOBILE_MONEY",
        lang: "FR",
        metadata: input.song.id,
        customer_id: input.song.id,
        customer_name: clean(first) || "Client",
        customer_surname: clean(rest.join(" ")) || "DBMelo",
        customer_email: input.email,
        customer_phone_number: input.phone && country ? `+${country.dial}${input.phone}` : undefined,
        customer_country: input.country,
        // Champs exigés par CinetPay pour le paiement par carte.
        customer_address: input.method === "card" ? "-" : undefined,
        customer_city: input.method === "card" ? country?.label ?? "-" : undefined,
        customer_state: input.method === "card" ? input.country : undefined,
        customer_zip_code: input.method === "card" ? "00000" : undefined,
      },
    );
    if (data.code !== "201" || !data.data?.payment_url) {
      throw new HttpError(502, `CinetPay : ${data.description || data.message || "paiement impossible à initialiser"}`);
    }
    return { redirectUrl: data.data.payment_url, providerRef: data.data.payment_token };
  },

  async verify(payment) {
    const c = config.cinetpay();
    const data = await post<{ code?: string; message?: string; data?: { status?: string; amount?: string | number; currency?: string } }>(
      "/payment/check",
      { apikey: c.apiKey, site_id: c.siteId, transaction_id: payment.reference },
    );
    const status = data.data?.status;
    if (data.code === "00" && status === "ACCEPTED") {
      return { status: "paid", amount: Number(data.data?.amount), currency: data.data?.currency, raw: data };
    }
    if (status === "REFUSED" || data.code === "600" || data.code === "627") return { status: "failed", raw: data };
    return { status: "pending", raw: data };
  },

  async parseWebhook(req, rawBody) {
    const fields = new URLSearchParams(rawBody);
    const reference = fields.get("cpm_trans_id");
    if (!reference) return null;
    const token = req.headers.get("x-token") ?? "";
    const expected = cinetpayToken(fields, config.cinetpay().secretKey);
    if (token.length !== expected.length || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
      throw new HttpError(401, "Signature CinetPay invalide.");
    }
    return { reference, claimedStatus: "pending" };
  },
};
