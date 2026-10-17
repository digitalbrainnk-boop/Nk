// Retour depuis la passerelle (GET pour Stripe/Paystack, POST pour CinetPay) → page de la chanson.
import { NextResponse } from "next/server";
import { baseUrl } from "@/lib/server/env";
import { PROVIDERS } from "@/lib/server/payments";
import { applyPaymentResult } from "@/lib/server/songs";
import { payments } from "@/lib/server/store";

async function handle(req: Request) {
  const base = baseUrl(req);
  const ref = new URL(req.url).searchParams.get("ref") ?? "";
  const payment = /^[A-Z0-9]{8,40}$/.test(ref) ? await payments.get(ref) : null;
  if (!payment) return NextResponse.redirect(`${base}/`, 303);
  if (payment.status === "pending") {
    try {
      await applyPaymentResult(payment, await PROVIDERS[payment.provider].verify(payment), base);
    } catch (e) {
      console.warn("[DB.Mélo] Vérification au retour :", (e as Error).message); // la page réessaiera
    }
  }
  return NextResponse.redirect(`${base}/chanson/${payment.songId}?paiement=${ref}`, 303);
}

export const GET = handle;
export const POST = handle;
