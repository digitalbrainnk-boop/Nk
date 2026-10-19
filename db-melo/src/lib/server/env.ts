// Configuration serveur (lue à chaque appel : les variables peuvent changer sans rebuild).
// Ne jamais importer ce fichier depuis un composant client.
import { createHash } from "node:crypto";
import { CONTACT } from "../constants";
import type { FlowMode, KieSunoModel, VersionsMode } from "../types";

const str = (key: string) => (process.env[key] ?? "").trim();
const num = (key: string, fallback: number, min: number, max: number) => {
  const n = Number(str(key));
  return Number.isFinite(n) && n > 0 ? Math.min(max, Math.max(min, n)) : fallback;
};

export const config = {
  kieKey: () => str("KIE_API_KEY"),
  /** Adresses Kie (modifiables pour un proxy ou des tests). */
  kieApiBase: () => (str("KIE_API_BASE") || "https://api.kie.ai/api/v1").replace(/\/+$/, ""),
  kieUploadBase: () => (str("KIE_UPLOAD_BASE") || "https://kieai.redpandaai.co").replace(/\/+$/, ""),
  sunoModel: () => (str("KIE_SUNO_MODEL") || "V6") as KieSunoModel,
  /** Modèle de secours : si Kie refuse le modèle principal, et pour les relances après un échec. */
  sunoFallbackModel: () => (str("KIE_SUNO_FALLBACK_MODEL") || "V5") as KieSunoModel,
  /** Par défaut, une seule composition Suno par chanson : ses deux prises font les deux versions. */
  versionsMode: (): VersionsMode => (str("VERSIONS_MODE") === "styles" ? "styles" : "takes"),
  /** Alerte e-mail quand le crédit Kie passe sous ce seuil (0 = pas d'alerte). */
  kieCreditAlert: () => {
    const n = Number(str("KIE_CREDIT_ALERT") || 50);
    return Number.isFinite(n) && n >= 0 ? n : 50;
  },
  /** Sans clé Kie, les chansons sont des maquettes de démonstration synthétisées localement. */
  demoMusic: () => !str("KIE_API_KEY"),
  callbackSecret: () => str("KIE_CALLBACK_SECRET") || createHash("sha256").update(`dbmelo-callback:${str("KIE_API_KEY")}`).digest("hex"),
  imageModel: () => str("KIE_IMAGE_MODEL") || "google/nano-banana",
  imageEditModel: () => str("KIE_IMAGE_EDIT_MODEL") || "google/nano-banana-edit",

  anthropicKey: () => str("ANTHROPIC_API_KEY"),
  lyricsModel: () => str("LYRICS_MODEL") || "claude-opus-5-5",
  kieChatModel: () => str("KIE_CHAT_MODEL") || "deepseek-v4-1-flash",

  publicBaseUrl: () => str("PUBLIC_BASE_URL").replace(/\/+$/, ""),
  /** Par défaut, le client paie avant la composition : aucun son n'existe avant le paiement. */
  flowMode: (): FlowMode => (str("FLOW_MODE") === "preview_first" ? "preview_first" : "pay_first"),
  /** Lancements Suno autorisés par chanson (relances comprises, après un échec). */
  maxAttempts: () => num("MAX_GENERATION_ATTEMPTS", 3, 1, 20),
  previewSeconds: () => num("PREVIEW_SECONDS", 45, 10, 90),
  generationsPerHour: () => num("GENERATIONS_PER_HOUR", 4, 1, 1000),

  stripeSecret: () => str("STRIPE_SECRET_KEY"),
  stripeWebhookSecret: () => str("STRIPE_WEBHOOK_SECRET"),
  chariow: () => ({
    apiKey: str("CHARIOW_API_KEY"),
    /** Identifiant (prd_…) ou slug du produit « chanson » de la boutique, de type Licence. */
    productId: str("CHARIOW_PRODUCT_ID"),
    pulseSecret: str("CHARIOW_PULSE_SECRET"),
    /** Pour les tests uniquement. */
    apiBase: str("CHARIOW_API_BASE"),
  }),
  fedapay: () => ({
    secretKey: str("FEDAPAY_SECRET_KEY"),
    webhookSecret: str("FEDAPAY_WEBHOOK_SECRET"),
    /** Pour les tests uniquement ; sinon déduite de la clé (sandbox ou réelle). */
    apiBase: str("FEDAPAY_API_BASE"),
  }),
  cinetpay: () => ({ apiKey: str("CINETPAY_API_KEY"), siteId: str("CINETPAY_SITE_ID"), secretKey: str("CINETPAY_SECRET_KEY") }),
  paystackSecret: () => str("PAYSTACK_SECRET_KEY"),
  flutterwave: () => ({ secretKey: str("FLUTTERWAVE_SECRET_KEY"), webhookHash: str("FLUTTERWAVE_WEBHOOK_HASH") }),
  /** E-mail du marchand, utilisé quand une passerelle exige un e-mail et que le client n'en donne pas. */
  merchantEmail: () => str("MERCHANT_EMAIL") || CONTACT.email,
  /** Destinataire des alertes (crédit Kie bas…) : par défaut, l'e-mail du marchand. */
  alertEmail: () => str("ALERT_EMAIL") || str("MERCHANT_EMAIL") || CONTACT.email,
  /** Envoi des alertes par le sendmail du serveur (présent chez o2switch et sur cPanel). */
  sendmailPath: () => str("SENDMAIL_PATH") || "/usr/sbin/sendmail",
  /** Identité du vendeur sur les pages légales (vérifiée par les passerelles de paiement). */
  merchant: () => ({
    name: str("MERCHANT_NAME"),
    email: str("MERCHANT_EMAIL") || CONTACT.email,
    whatsapp: str("MERCHANT_WHATSAPP") || CONTACT.whatsapp,
    phone: str("MERCHANT_PHONE") || CONTACT.phone,
    address: str("MERCHANT_ADDRESS") || CONTACT.address,
    registration: str("MERCHANT_REGISTRATION"),
    host: str("HOSTING_INFO"),
  }),
  /** Paiement simulé : explicitement autorisé, ou chanson de démo (sans valeur marchande). */
  allowDemoPayments: () => str("ALLOW_DEMO_PAYMENTS") === "true",

  dataDir: () => str("DATA_DIR") || ".data",
  upstash: () => ({ url: str("UPSTASH_REDIS_REST_URL").replace(/\/+$/, ""), token: str("UPSTASH_REDIS_REST_TOKEN") }),
};

/** Adresse publique du site : PUBLIC_BASE_URL, sinon déduite de la requête (proxy compris). */
export function baseUrl(req: Request): string {
  const fixed = config.publicBaseUrl();
  if (fixed) return fixed;
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host") || url.host;
  return `${proto}://${host}`;
}

/** Les webhooks ne peuvent pas joindre une adresse locale. */
export function isPublicUrl(url: string): boolean {
  try {
    const { hostname, protocol } = new URL(url);
    return protocol === "https:" && !/^(localhost|127\.|10\.|192\.168\.|0\.0\.0\.0|\[::1\])/.test(hostname) && !hostname.endsWith(".local");
  } catch {
    return false;
  }
}
