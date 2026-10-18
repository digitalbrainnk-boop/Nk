// FedaPay : Mobile Money (Bénin, Togo, Côte d'Ivoire, Sénégal, Burkina Faso, Niger, Mali) et cartes, en FCFA.
// Passerelle choisie pour démarrer en indépendant, sans RCCM.
//   POST /v1/transactions             → { "v1/transaction": { id, status… } }
//   POST /v1/transactions/:id/token   → { token, url } (page de paiement FedaPay)
//   GET  /v1/transactions/:id         → status : approved, declined, canceled…
//   Webhook : en-tête x-fedapay-signature « t=<horodatage>,s=<HMAC-SHA256(secret, "t.corps")> »
// Une clé « sk_sandbox_… » utilise automatiquement le bac à sable (paiements fictifs).
import { createHmac, timingSafeEqual } from "node:crypto";
import { BRAND, COUNTRIES } from "../../constants";
import type { PaymentProvider } from "../../types";
import { config } from "../env";
import { HttpError } from "../http";

/** Tolérance sur l'horodatage des webhooks, comme le SDK officiel. */
const WEBHOOK_TOLERANCE_S = 300;

const PAID = new Set(["approved", "transferred", "approved_partially_refunded", "transferred_partially_refunded"]);
const FAILED = new Set(["declined", "canceled", "cancelled", "expired", "refunded"]);

interface FedaTransaction {
  id: number;
  status: string;
  amount: number;
  callback_url?: string;
  custom_metadata?: { reference?: string } | null;
}

export function fedapayApiBase(): string {
  const { secretKey, apiBase } = config.fedapay();
  if (apiBase) return apiBase;
  return secretKey.startsWith("sk_sandbox") ? "https://sandbox-api.fedapay.com/v1" : "https://api.fedapay.com/v1";
}

async function fedapayApi<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${fedapayApiBase()}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${config.fedapay().secretKey}`, "Content-Type": "application/json", Accept: "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new HttpError(res.status >= 500 ? 502 : 400, `FedaPay : ${data.message || `erreur ${res.status}`}`);
  return data;
}

const transactionOf = (data: Record<string, unknown>) => (data["v1/transaction"] ?? data.transaction ?? data) as FedaTransaction;

export function fedapaySignature(timestamp: number | string, rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

/** Notre référence de paiement, depuis les métadonnées ou l'adresse de retour de la transaction. */
function referenceOf(tx: Partial<FedaTransaction> | undefined): string | null {
  const fromMeta = tx?.custom_metadata?.reference;
  if (fromMeta) return fromMeta;
  try {
    return tx?.callback_url ? new URL(tx.callback_url).searchParams.get("ref")?.split("?")[0] || null : null;
  } catch {
    return null;
  }
}

export const fedapay: PaymentProvider = {
  id: "fedapay",
  label: "FedaPay",
  methods: ["mobile_money", "card"],
  currencies: ["XOF"],
  momoCountries: ["BJ", "TG", "CI", "SN", "BF", "NE", "ML"],

  isConfigured: () => !!config.fedapay().secretKey,

  async createCheckout(input) {
    const country = COUNTRIES.find((c) => c.code === input.country);
    const [first, ...rest] = (input.customerName || "Client").trim().split(/\s+/);
    const email = input.email || config.merchantEmail();
    const customer = {
      firstname: first || "Client",
      lastname: rest.join(" ") || BRAND.name,
      ...(email ? { email } : {}),
    };
    const phone = input.phone && country ? { number: `+${country.dial}${input.phone}`, country: country.code.toLowerCase() } : undefined;
    const body = {
      description: `${BRAND.name} — ${input.song.config.title}`.slice(0, 100),
      amount: Math.round(input.amount),
      currency: { iso: input.currency },
      callback_url: input.returnUrl,
      custom_metadata: { reference: input.reference, song_id: input.song.id },
      customer: phone ? { ...customer, phone_number: phone } : customer,
    };
    let created: Record<string, unknown>;
    try {
      created = await fedapayApi("/transactions", { method: "POST", body });
    } catch (e) {
      // Numéro refusé par FedaPay : le client le saisira sur la page de paiement.
      if (!phone || (e as HttpError).status !== 400) throw e;
      created = await fedapayApi("/transactions", { method: "POST", body: { ...body, customer } });
    }
    const tx = transactionOf(created);
    if (!tx?.id) throw new HttpError(502, "FedaPay n'a pas créé la transaction.");
    const token = await fedapayApi<{ url?: string }>(`/transactions/${tx.id}/token`, { method: "POST" });
    if (!token.url) throw new HttpError(502, "FedaPay n'a pas fourni la page de paiement.");
    return { redirectUrl: token.url, providerRef: String(tx.id) };
  },

  async verify(payment) {
    if (!payment.providerRef) return { status: "pending" };
    const tx = transactionOf(await fedapayApi(`/transactions/${encodeURIComponent(payment.providerRef)}`));
    if (PAID.has(tx.status)) return { status: "paid", amount: Number(tx.amount), raw: tx };
    if (FAILED.has(tx.status)) return { status: "failed", raw: tx };
    return { status: "pending", raw: tx };
  },

  async parseWebhook(req, rawBody) {
    const secret = config.fedapay().webhookSecret;
    // Sans secret, on accepte l'avis : le statut est de toute façon relu chez FedaPay avant tout déblocage.
    if (secret) {
      const header = req.headers.get("x-fedapay-signature") ?? "";
      const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=", 2) as [string, string]));
      const t = Number(parts.t);
      const expected = fedapaySignature(parts.t ?? "", rawBody, secret);
      const given = parts.s ?? "";
      const valid = given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
      if (!valid || !Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > WEBHOOK_TOLERANCE_S) {
        throw new HttpError(401, "Signature FedaPay invalide.");
      }
    }
    const event = JSON.parse(rawBody) as { name?: string; entity?: Partial<FedaTransaction> };
    if (!event.name?.startsWith("transaction.")) return null;
    const reference = referenceOf(event.entity);
    return reference ? { reference, claimedStatus: event.name === "transaction.approved" ? "paid" : "pending" } : null;
  },
};
