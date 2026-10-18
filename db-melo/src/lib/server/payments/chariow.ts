// Chariow : boutique de produits numériques avec paiement Mobile Money et carte, en FCFA.
// Le prix est celui du produit créé dans la boutique Chariow (type « Licence » : un même client peut
// acheter plusieurs chansons ; les autres types répondent « already_purchased »).
//   POST /v1/checkout      → data.step = payment | completed | already_purchased, data.payment.checkout_url
//   GET  /v1/sales/:id     → data.status = awaiting_payment | completed | settled | failed | abandoned
//   Pulse (webhook) : en-tête x-chariow-signature = "sha256=" + HMAC-SHA256(secret, corps brut)
// L'API autorise 100 requêtes par minute : les vérifications d'une même vente sont espacées.
import { createHmac, timingSafeEqual } from "node:crypto";
import { BRAND, COUNTRIES } from "../../constants";
import type { PaymentProvider, PaymentVerification } from "../../types";
import { config } from "../env";
import { HttpError } from "../http";

const API = "https://api.chariow.com/v1";
const VERIFY_CACHE_MS = 8_000;

const PAID = new Set(["completed", "settled"]);
const FAILED = new Set(["failed", "abandoned"]);

interface Amount {
  value: number;
  currency: string;
}

interface CheckoutResult {
  step?: "payment" | "completed" | "already_purchased";
  message?: string | null;
  purchase?: { id?: string };
  payment?: { checkout_url?: string | null; transaction_id?: string | null };
}

interface Sale {
  id: string;
  status: string;
  amount?: Amount;
  original_amount?: Amount;
}

async function chariowApi<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${config.chariow().apiBase || API}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${config.chariow().apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const envelope = (await res.json().catch(() => ({}))) as { message?: string; data?: T; errors?: Record<string, string[]> };
  if (!res.ok) {
    const detail = Object.values(envelope.errors ?? {}).flat()[0];
    throw new HttpError(res.status >= 500 ? 502 : res.status === 422 ? 422 : 400, `Chariow : ${detail || envelope.message || `erreur ${res.status}`}`);
  }
  return envelope.data as T;
}

export function chariowSignature(rawBody: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

// Dernière réponse par vente, pour ménager la limite de l'API pendant que la page du client patiente.
const recent = new Map<string, { at: number; result: PaymentVerification }>();

export const chariow: PaymentProvider = {
  id: "chariow",
  label: "Chariow",
  methods: ["mobile_money", "card"],
  currencies: ["XOF"],
  momoCountries: ["BJ", "BF", "CI", "ML", "NE", "SN", "TG"],

  isConfigured() {
    const c = config.chariow();
    return !!(c.apiKey && c.productId);
  },

  async createCheckout(input) {
    const country = COUNTRIES.find((c) => c.code === input.country);
    const [first, ...rest] = (input.customerName || "").trim().split(/\s+/).filter(Boolean);
    const body = {
      product_id: config.chariow().productId,
      // Chariow exige un e-mail : sans celui du client, le reçu part à DB.Mélo.
      email: input.email || config.merchantEmail(),
      first_name: (first || "Client").slice(0, 50),
      last_name: (rest.join(" ") || BRAND.name).slice(0, 50),
      phone: { number: input.phone || "", country_code: country?.code ?? "BF" },
      payment_currency: input.currency,
      redirect_url: input.returnUrl,
      custom_metadata: { reference: input.reference, song_id: input.song.id },
      // Sans l'adresse IP du client, Chariow croirait l'acheteur dans le pays du serveur.
      ...(input.customerIp ? { customer_ip: input.customerIp } : {}),
    };
    if (!body.phone.number) {
      // Paiement par carte sans numéro saisi : Chariow en réclame un.
      throw new HttpError(400, "Indiquez votre numéro de téléphone pour payer.");
    }
    let result: CheckoutResult;
    try {
      result = await chariowApi<CheckoutResult>("/checkout", { method: "POST", body });
    } catch (e) {
      // Indicatif refusé sous forme de code pays : nouvel essai avec l'indicatif (+226…).
      if ((e as HttpError).status !== 422 || !country) throw e;
      result = await chariowApi<CheckoutResult>("/checkout", { method: "POST", body: { ...body, phone: { ...body.phone, country_code: `+${country.dial}` } } });
    }
    if (result.step === "already_purchased") {
      throw new HttpError(502, "Chariow : le produit DB.Mélo doit être de type « Licence » pour être acheté plusieurs fois.");
    }
    if (result.step !== "payment" || !result.payment?.checkout_url || !result.purchase?.id) {
      throw new HttpError(502, `Chariow : ${result.message || "page de paiement indisponible (le produit doit avoir un prix)"}`);
    }
    return { redirectUrl: result.payment.checkout_url, providerRef: result.purchase.id };
  },

  async verify(payment) {
    const id = payment.providerRef;
    if (!id) return { status: "pending" };
    const cached = recent.get(id);
    if (cached && Date.now() - cached.at < VERIFY_CACHE_MS) return cached.result;
    const sale = await chariowApi<Sale>(`/sales/${encodeURIComponent(id)}`);
    // « amount » est le net versé au marchand (après frais) : on contrôle le prix d'origine, s'il est
    // dans la devise de la commande (boutique Chariow en FCFA).
    const price = sale.original_amount;
    const comparable = price && price.currency.toUpperCase() === payment.currency;
    if (price && !comparable) console.warn(`[DB.Mélo] Chariow : vente ${id} en ${price.currency}, commande en ${payment.currency}.`);
    const result: PaymentVerification = PAID.has(sale.status)
      ? { status: "paid", ...(comparable ? { amount: price.value, currency: price.currency } : {}), raw: sale }
      : { status: FAILED.has(sale.status) ? "failed" : "pending", raw: sale };
    recent.set(id, { at: Date.now(), result });
    if (recent.size > 1000) recent.delete(recent.keys().next().value!);
    return result;
  },

  async parseWebhook(req, rawBody) {
    const secret = config.chariow().pulseSecret;
    // Sans secret, l'avis est accepté : la vente est de toute façon relue chez Chariow avant tout déblocage.
    if (secret) {
      const given = req.headers.get("x-chariow-signature") ?? "";
      const expected = chariowSignature(rawBody, secret);
      if (given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
        throw new HttpError(401, "Signature Chariow invalide.");
      }
    }
    const event = JSON.parse(rawBody) as { event?: string; sale?: { custom_metadata?: Record<string, string> | null } };
    if (!event.event?.endsWith(".sale")) return null;
    const reference = event.sale?.custom_metadata?.reference;
    return reference ? { reference, claimedStatus: event.event === "successful.sale" ? "paid" : "pending" } : null;
  },
};
