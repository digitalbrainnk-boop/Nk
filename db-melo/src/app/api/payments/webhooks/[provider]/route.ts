// Webhooks des passerelles : signature vérifiée, puis statut relu auprès du prestataire avant tout déblocage.
import { NextResponse } from "next/server";
import { apiError, HttpError } from "@/lib/server/http";
import { PROVIDERS } from "@/lib/server/payments";
import { applyPaymentResult } from "@/lib/server/songs";
import { payments } from "@/lib/server/store";
import type { PaymentProviderId } from "@/lib/types";

type Ctx = { params: Promise<{ provider: string }> };

export async function POST(req: Request, { params }: Ctx) {
  try {
    const { provider: id } = await params;
    const provider = PROVIDERS[id as PaymentProviderId];
    if (!provider || id === "demo" || !provider.isConfigured()) throw new HttpError(404, "Passerelle inconnue.");
    const raw = await req.text();
    const event = await provider.parseWebhook(req, raw);
    if (event) {
      const payment = await payments.get(event.reference);
      if (payment && payment.provider === provider.id && payment.status !== "paid") {
        await applyPaymentResult(payment, await provider.verify(payment));
      }
    }
    return NextResponse.json({ received: true });
  } catch (e) {
    return apiError(e);
  }
}

// CinetPay teste la disponibilité de l'adresse de notification par un GET.
export async function GET() {
  return NextResponse.json({ ok: true });
}
