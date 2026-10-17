// POST /api/payments/checkout : crée la transaction chez la bonne passerelle et renvoie la page de paiement.
import { NextResponse } from "next/server";
import { COUNTRIES } from "@/lib/constants";
import { priceOf } from "@/lib/pricing";
import { checkoutSchema } from "@/lib/schemas";
import { baseUrl } from "@/lib/server/env";
import { apiError, HttpError, readJson } from "@/lib/server/http";
import { paymentReference } from "@/lib/server/ids";
import { resolveProvider } from "@/lib/server/payments";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { requireSong } from "@/lib/server/songs";
import { payments } from "@/lib/server/store";
import type { PaymentRecord } from "@/lib/types";

export async function POST(req: Request) {
  try {
    if (!rateLimit(`checkout:${clientIp(req)}`, 20, 3600_000).ok) throw new HttpError(429, "Trop de tentatives : réessayez plus tard.");
    const input = checkoutSchema.parse(await readJson(req));
    const song = await requireSong(input.songId);
    if (song.payment.status === "paid") throw new HttpError(409, "Cette chanson est déjà débloquée.");
    if (song.generation.status === "generating") throw new HttpError(409, "Patientez jusqu'à la fin de la création pour choisir votre offre.");
    if (song.generation.status === "failed") throw new HttpError(409, "La création a échoué : relancez-la avant de payer.");
    const provider = resolveProvider(input.method, input.currency, song);

    if (input.method === "mobile_money" && provider.id !== "demo") {
      const country = COUNTRIES.find((c) => c.code === input.country);
      if (!country || !input.operator || !input.phone) throw new HttpError(400, "Choisissez le pays, l'opérateur et le numéro Mobile Money.");
      if (!country.operators.includes(input.operator)) throw new HttpError(400, "Cet opérateur n'est pas disponible dans ce pays.");
      if (!country.digits.includes(input.phone.length)) throw new HttpError(400, `Le numéro doit comporter ${country.digits.join(" ou ")} chiffres.`);
      if (country.currency !== input.currency) throw new HttpError(400, `En ${country.label}, le paiement Mobile Money se fait en ${country.currency}.`);
    }

    const base = baseUrl(req);
    const reference = paymentReference();
    const now = Date.now();
    const record: PaymentRecord = {
      reference,
      songId: song.id,
      provider: provider.id,
      method: input.method,
      operator: input.operator,
      plan: input.plan,
      amount: priceOf(input.plan, input.currency), // le prix vient toujours du serveur
      currency: input.currency,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };
    await payments.put(record);

    const session = await provider.createCheckout({
      reference,
      song,
      plan: input.plan,
      amount: record.amount,
      currency: input.currency,
      method: input.method,
      operator: input.operator,
      country: input.country,
      phone: input.phone,
      email: input.email,
      customerName: input.customerName,
      returnUrl: `${base}/api/payments/return?ref=${reference}`,
      notifyUrl: `${base}/api/payments/webhooks/${provider.id}`,
      cancelUrl: `${base}/chanson/${song.id}?paiement=annule`,
    });
    await payments.update(reference, (p) => {
      p.providerRef = session.providerRef;
    });
    return NextResponse.json({ reference, redirectUrl: session.redirectUrl, provider: provider.id });
  } catch (e) {
    return apiError(e);
  }
}
