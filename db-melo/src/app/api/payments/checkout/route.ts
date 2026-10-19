// POST /api/payments/checkout : crée la transaction chez la bonne passerelle et renvoie la page de paiement.
import { NextResponse } from "next/server";
import { findCountry, PLANS, validPhone } from "@/lib/constants";
import { checkoutSchema } from "@/lib/schemas";
import { baseUrl } from "@/lib/server/env";
import { apiError, HttpError, readJson } from "@/lib/server/http";
import { paymentReference } from "@/lib/server/ids";
import { momoProviderFor, resolveCardProvider } from "@/lib/server/payments";
import { clientIp, globalBudget, visitorLimit } from "@/lib/server/rate-limit";
import { requireSong } from "@/lib/server/songs";
import { payments } from "@/lib/server/store";
import type { Currency, PaymentProvider, PaymentRecord } from "@/lib/types";

export async function POST(req: Request) {
  try {
    if (!visitorLimit(req, "checkout", 20, 3600_000).ok) throw new HttpError(429, "Trop de tentatives : réessayez plus tard.");
    if (!globalBudget("checkout", 600)) throw new HttpError(503, "Beaucoup de paiements en cours : réessayez dans quelques minutes.");
    const input = checkoutSchema.parse(await readJson(req));
    const song = await requireSong(input.songId);
    if (song.payment.status === "paid") throw new HttpError(409, "Cette chanson est déjà payée.");
    if (song.generation.status === "generating") throw new HttpError(409, "La chanson est déjà en cours de composition.");
    const plan = PLANS[input.plan];
    if (!plan.enabled) throw new HttpError(400, "Cette offre n'est pas disponible.");
    const country = findCountry(input.country)!;

    let provider: PaymentProvider;
    let currency: Currency;
    if (input.method === "mobile_money") {
      const momo = momoProviderFor(country.code, song);
      if (!momo || !country.momo) throw new HttpError(400, `Le Mobile Money n'est pas disponible au ${country.label} : payez par carte bancaire.`);
      provider = momo;
      currency = country.momo.currency; // le Mobile Money se paie dans la monnaie du pays
      if (provider.id !== "demo") {
        if (!input.operator || !country.momo.operators.includes(input.operator)) throw new HttpError(400, "Choisissez votre opérateur Mobile Money.");
        if (!input.phone || !validPhone(country, input.phone)) throw new HttpError(400, "Numéro Mobile Money invalide.");
      }
    } else {
      currency = input.currency ?? "XOF";
      provider = resolveCardProvider(currency, song);
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
      plan: plan.id,
      amount: plan.prices[currency], // le prix vient toujours du serveur
      currency,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };
    await payments.put(record);

    const session = await provider.createCheckout({
      reference,
      song,
      plan: plan.id,
      amount: record.amount,
      currency,
      method: input.method,
      operator: input.operator,
      country: country.code,
      phone: input.phone,
      email: input.email,
      customerName: input.customerName,
      customerIp: /^[0-9a-fA-F.:]+$/.test(clientIp(req)) ? clientIp(req) : undefined,
      returnUrl: `${base}/api/payments/return?ref=${reference}`,
      notifyUrl: `${base}/api/payments/webhooks/${provider.id}`,
      cancelUrl: `${base}/chanson/${song.id}?paiement=annule`,
    });
    await payments.update(reference, (p) => {
      p.providerRef = session.providerRef;
    });
    return NextResponse.json({ reference, redirectUrl: session.redirectUrl, provider: provider.id, amount: record.amount, currency });
  } catch (e) {
    return apiError(e);
  }
}
