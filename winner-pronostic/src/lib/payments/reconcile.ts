import "server-only";
import { getServerEnv } from "@/lib/env.server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";
import { type CinetPayConfig, checkPayment } from "./cinetpay";

export function cinetpayConfig(): CinetPayConfig | null {
  const env = getServerEnv();
  if (!env.CINETPAY_API_KEY || !env.CINETPAY_SITE_ID) return null;
  return { apiKey: env.CINETPAY_API_KEY, siteId: env.CINETPAY_SITE_ID, secretKey: env.CINETPAY_SECRET_KEY, apiBase: env.CINETPAY_API_BASE };
}

export type ReconcileResult = { status: "succeeded" | "pending" | "failed" | "cancelled" | "unknown_transaction" | "not_configured"; subscriptionId?: string };

/**
 * Met à jour un paiement à partir du statut confirmé par CinetPay et active
 * l'abonnement si le paiement est accepté pour le bon montant. Idempotent :
 * appelé par la notification ET par la page de retour sans risque de doublon.
 */
export async function reconcilePayment(transactionId: string, note: Record<string, unknown> = {}): Promise<ReconcileResult> {
  const config = cinetpayConfig();
  if (!config) return { status: "not_configured" };
  const db = createAdminClient();
  const { data: payment } = await db
    .from("payments")
    .select("id, status, amount_xof, provider")
    .eq("provider", "cinetpay")
    .eq("provider_transaction_id", transactionId)
    .maybeSingle();
  if (!payment) return { status: "unknown_transaction" };
  if (payment.status === "succeeded") {
    const { data: sub } = await db.from("subscriptions").select("id").eq("payment_id", payment.id).maybeSingle();
    return { status: "succeeded", subscriptionId: sub?.id };
  }

  const check = await checkPayment(config, transactionId);
  const payload = { check: check.raw, ...note, checked_at: new Date().toISOString() } as Json;

  if (check.status === "ACCEPTED") {
    if (check.currency !== "XOF" || check.amount === null || check.amount < payment.amount_xof) {
      await db.from("payments").update({ status: "failed", raw_payload: { ...(payload as object), error: "Montant ou devise incorrects" } as Json }).eq("id", payment.id);
      return { status: "failed" };
    }
    await db.from("payments").update({ raw_payload: payload, operator: check.paymentMethod }).eq("id", payment.id);
    const { data: subscriptionId, error } = await db.rpc("activate_subscription", { p_payment_id: payment.id });
    if (error) throw new Error(`Activation impossible : ${error.message}`);
    return { status: "succeeded", subscriptionId: subscriptionId ?? undefined };
  }
  if (check.status === "REFUSED" || check.status === "CANCELED") {
    const status = check.status === "REFUSED" ? "failed" : "cancelled";
    await db.from("payments").update({ status, raw_payload: payload }).eq("id", payment.id).eq("status", "pending");
    return { status };
  }
  await db.from("payments").update({ raw_payload: payload }).eq("id", payment.id);
  return { status: "pending" };
}
