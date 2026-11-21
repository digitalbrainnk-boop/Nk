import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Client CinetPay (agrégateur Mobile Money : Orange Money, Moov Money…).
 *
 * Sécurité : une notification reçue n'est JAMAIS crue sur parole. Le statut
 * d'un paiement est toujours redemandé à l'API CinetPay (vérification) avant
 * d'activer un abonnement ; le jeton HMAC « x-token » est contrôlé en plus.
 */

export type CinetPayConfig = { apiKey: string; siteId: string; secretKey?: string; apiBase?: string };

export type InitPaymentInput = {
  transactionId: string;
  amount: number;
  description: string;
  notifyUrl: string;
  returnUrl: string;
  customer?: { name?: string; phone?: string; email?: string };
};

export type PaymentCheck = {
  status: "ACCEPTED" | "REFUSED" | "CANCELED" | "WAITING" | "UNKNOWN";
  amount: number | null;
  currency: string | null;
  paymentMethod: string | null;
  raw: unknown;
};

export class CinetPayError extends Error {}

const base = (config: CinetPayConfig) => (config.apiBase ?? "https://api-checkout.cinetpay.com").replace(/\/+$/, "");

/** Identifiant de transaction : lettres et chiffres uniquement (exigence des agrégateurs). */
export function newTransactionId(now = Date.now(), random = Math.random): string {
  const rand = Math.floor(random() * 36 ** 6).toString(36).padStart(6, "0");
  return `WP${now.toString(36)}${rand}`.toUpperCase();
}

export async function initPayment(config: CinetPayConfig, input: InitPaymentInput, fetchImpl: typeof fetch = fetch) {
  if (input.amount <= 0 || input.amount % 5 !== 0) throw new CinetPayError("Le montant doit être un multiple de 5 F CFA.");
  const res = await fetchImpl(`${base(config)}/v2/payment`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      apikey: config.apiKey,
      site_id: config.siteId,
      transaction_id: input.transactionId,
      amount: input.amount,
      currency: "XOF",
      description: input.description.replace(/[^\p{L}\p{N} .,'-]/gu, "").slice(0, 100),
      notify_url: input.notifyUrl,
      return_url: input.returnUrl,
      channels: "MOBILE_MONEY",
      lang: "FR",
      customer_name: input.customer?.name?.slice(0, 50),
      customer_phone_number: input.customer?.phone,
      customer_email: input.customer?.email,
    }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string; description?: string; data?: { payment_url?: string; payment_token?: string } };
  if (body.code !== "201" || !body.data?.payment_url) {
    throw new CinetPayError(`CinetPay a refusé le paiement : ${body.message ?? res.status}${body.description ? ` (${body.description})` : ""}`);
  }
  return { paymentUrl: body.data.payment_url, token: body.data.payment_token ?? null };
}

/** Statut réel d'une transaction, demandé à CinetPay (source de vérité). */
export async function checkPayment(config: CinetPayConfig, transactionId: string, fetchImpl: typeof fetch = fetch): Promise<PaymentCheck> {
  const res = await fetchImpl(`${base(config)}/v2/payment/check`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ apikey: config.apiKey, site_id: config.siteId, transaction_id: transactionId }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string; data?: { status?: string; amount?: string | number; currency?: string; payment_method?: string } };
  const raw = String(body.data?.status ?? body.message ?? "").toUpperCase();
  const status: PaymentCheck["status"] =
    raw === "ACCEPTED" ? "ACCEPTED" : raw === "REFUSED" ? "REFUSED" : raw.startsWith("CANCEL") ? "CANCELED" : raw.includes("WAITING") || raw === "PENDING" ? "WAITING" : "UNKNOWN";
  const amount = body.data?.amount === undefined ? null : Number(body.data.amount);
  return { status, amount: Number.isFinite(amount) ? amount : null, currency: body.data?.currency ?? null, paymentMethod: body.data?.payment_method ?? null, raw: body };
}

/**
 * Contrôle du jeton « x-token » (HMAC SHA-256 avec la clé secrète du compte).
 * Deux ordres de concaténation documentés selon les versions sont acceptés ;
 * dans tous les cas le paiement est ensuite vérifié auprès de l'API.
 */
const FULL_ORDER = [
  "cpm_site_id",
  "cpm_trans_id",
  "cpm_trans_date",
  "cpm_amount",
  "cpm_currency",
  "signature",
  "payment_method",
  "cel_phone_num",
  "cpm_phone_prefixe",
  "cpm_language",
  "cpm_version",
  "cpm_payment_config",
  "cpm_page_action",
  "cpm_custom",
  "cpm_designation",
  "cpm_error_message",
];
const SHORT_ORDER = ["cpm_site_id", "cpm_trans_id", "cpm_trans_date", "cpm_amount", "cpm_currency", "signature"];

export function computeHmac(fields: Record<string, string>, secret: string, order: string[] = FULL_ORDER): string {
  return createHmac("sha256", secret).update(order.map((k) => fields[k] ?? "").join("")).digest("hex");
}

export function verifyHmac(fields: Record<string, string>, token: string | null, secret: string | undefined): boolean {
  if (!token || !secret) return false;
  const received = Buffer.from(token.toLowerCase());
  return [FULL_ORDER, SHORT_ORDER].some((order) => {
    const expected = Buffer.from(computeHmac(fields, secret, order));
    return expected.length === received.length && timingSafeEqual(expected, received);
  });
}
