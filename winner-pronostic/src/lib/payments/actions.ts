"use server";

import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/dal";
import { getPublicEnv } from "@/lib/env";
import { rateLimit } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { CinetPayError, initPayment, newTransactionId } from "./cinetpay";
import { cinetpayConfig } from "./reconcile";

export type CheckoutState = { status: "idle" | "error"; message?: string };

/** Démarre le paiement Mobile Money d'une offre Premium puis redirige vers CinetPay. */
export async function startCheckout(_prev: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion?suivant=/premium");
  const planCode = String(formData.get("plan") ?? "");
  if (!/^[a-z_]{2,30}$/.test(planCode)) return { status: "error", message: "Offre invalide." };
  if (!(await rateLimit("checkout", profile.id))) return { status: "error", message: "Trop de tentatives de paiement. Patientez quelques minutes." };

  const config = cinetpayConfig();
  if (!config) return { status: "error", message: "Le paiement Mobile Money n'est pas encore activé. Réessayez bientôt." };

  const db = createAdminClient();
  const { data: plan } = await db.from("plans").select("code, name, price_xof, is_active").eq("code", planCode).maybeSingle();
  if (!plan || !plan.is_active) return { status: "error", message: "Cette offre n'est plus disponible." };

  const transactionId = newTransactionId();
  const { data: payment, error } = await db
    .from("payments")
    .insert({
      user_id: profile.id,
      plan_code: plan.code,
      provider: "cinetpay",
      provider_transaction_id: transactionId,
      amount_xof: plan.price_xof,
      phone: profile.phone,
    })
    .select("id")
    .single();
  if (error || !payment) return { status: "error", message: "Le paiement n'a pas pu être préparé. Réessayez." };

  const site = getPublicEnv().NEXT_PUBLIC_SITE_URL;
  let paymentUrl: string;
  try {
    const result = await initPayment(config, {
      transactionId,
      amount: plan.price_xof,
      description: `Winner Pronostic ${plan.name}`,
      notifyUrl: `${site}/api/webhooks/cinetpay`,
      returnUrl: `${site}/paiement/retour?transaction=${transactionId}`,
      customer: { name: profile.display_name, phone: profile.phone ? `+${profile.phone.replace(/^\+/, "")}` : undefined, email: profile.email ?? undefined },
    });
    paymentUrl = result.paymentUrl;
    if (result.token) await db.from("payments").update({ provider_reference: result.token }).eq("id", payment.id);
  } catch (err) {
    await db.from("payments").update({ status: "failed", raw_payload: { error: (err as Error).message } }).eq("id", payment.id);
    return { status: "error", message: err instanceof CinetPayError ? err.message : "CinetPay est indisponible. Réessayez dans un instant." };
  }
  redirect(paymentUrl);
}
