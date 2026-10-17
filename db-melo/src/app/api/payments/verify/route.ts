// POST /api/payments/verify { reference } : interroge la passerelle (paiement Mobile Money validé sur le téléphone…).
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, HttpError, readJson } from "@/lib/server/http";
import { PROVIDERS } from "@/lib/server/payments";
import { applyPaymentResult } from "@/lib/server/songs";
import { payments } from "@/lib/server/store";

export async function POST(req: Request) {
  try {
    const { reference } = z.object({ reference: z.string().regex(/^[A-Z0-9]{8,40}$/) }).parse(await readJson(req));
    let payment = await payments.get(reference);
    if (!payment) throw new HttpError(404, "Paiement introuvable.");
    if (payment.status === "pending") {
      payment = await applyPaymentResult(payment, await PROVIDERS[payment.provider].verify(payment));
    }
    return NextResponse.json({ status: payment.status, songId: payment.songId, plan: payment.plan });
  } catch (e) {
    return apiError(e);
  }
}
