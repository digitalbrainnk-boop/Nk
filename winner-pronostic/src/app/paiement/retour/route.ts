import { NextResponse } from "next/server";

/**
 * Retour du client après le paiement (CinetPay peut utiliser GET ou POST).
 * On redirige vers la page de confirmation, qui vérifie le statut réel.
 */
async function handle(request: Request) {
  const url = new URL(request.url);
  let transaction = url.searchParams.get("transaction") ?? url.searchParams.get("transaction_id");
  if (!transaction && request.method === "POST") {
    try {
      const form = await request.formData();
      transaction = String(form.get("transaction_id") ?? form.get("cpm_trans_id") ?? "");
    } catch {
      transaction = null;
    }
  }
  const safe = transaction && /^[A-Za-z0-9_-]{4,64}$/.test(transaction) ? transaction : "";
  return NextResponse.redirect(new URL(`/premium/merci${safe ? `?transaction=${safe}` : ""}`, url.origin), 303);
}

export const GET = handle;
export const POST = handle;
