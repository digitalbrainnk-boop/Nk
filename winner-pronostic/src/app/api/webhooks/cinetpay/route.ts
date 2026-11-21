import { NextResponse } from "next/server";
import { verifyHmac } from "@/lib/payments/cinetpay";
import { cinetpayConfig, reconcilePayment } from "@/lib/payments/reconcile";
import { rateLimit } from "@/lib/security/rate-limit";
import { getClientIp } from "@/lib/security/request";

/**
 * Notification de paiement CinetPay (notify_url). Le contenu reçu sert
 * uniquement à identifier la transaction : son statut est ensuite vérifié
 * auprès de l'API CinetPay avant toute activation d'abonnement.
 */
export async function POST(request: Request) {
  if (!(await rateLimit("webhook", getClientIp(request.headers)))) return NextResponse.json({ error: "Trop de requêtes" }, { status: 429 });
  const config = cinetpayConfig();
  if (!config) return NextResponse.json({ error: "Paiement non configuré" }, { status: 503 });

  const type = request.headers.get("content-type") ?? "";
  const fields: Record<string, string> = {};
  try {
    if (type.includes("application/json")) {
      for (const [k, v] of Object.entries((await request.json()) as Record<string, unknown>)) if (typeof v === "string" || typeof v === "number") fields[k] = String(v);
    } else {
      for (const [k, v] of (await request.formData()).entries()) if (typeof v === "string") fields[k] = v;
    }
  } catch {
    return NextResponse.json({ error: "Corps illisible" }, { status: 400 });
  }

  const transactionId = fields.cpm_trans_id ?? fields.transaction_id;
  if (!transactionId || !/^[A-Za-z0-9_-]{4,64}$/.test(transactionId)) return NextResponse.json({ error: "Transaction absente" }, { status: 400 });
  if (fields.cpm_site_id && fields.cpm_site_id !== config.siteId) return NextResponse.json({ error: "Site inconnu" }, { status: 400 });

  const hmacValid = verifyHmac(fields, request.headers.get("x-token"), config.secretKey);
  if (config.secretKey && !hmacValid) console.warn(`[cinetpay] jeton x-token invalide pour ${transactionId} : vérification par l'API`);

  try {
    const result = await reconcilePayment(transactionId, { notification: { hmac_valid: hmacValid, method: fields.payment_method ?? null } });
    return NextResponse.json({ received: true, status: result.status });
  } catch (err) {
    console.error("[cinetpay] notification :", (err as Error).message);
    // 500 : CinetPay renverra la notification plus tard
    return NextResponse.json({ error: "Traitement impossible" }, { status: 500 });
  }
}

/** CinetPay peut tester la disponibilité de l'URL de notification. */
export function GET() {
  return NextResponse.json({ ok: true });
}
