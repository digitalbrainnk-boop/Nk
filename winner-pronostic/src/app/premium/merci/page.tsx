import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { AutoRefresh } from "@/components/ui/auto-refresh";
import { ButtonLink } from "@/components/ui/button";
import { getSessionUser } from "@/lib/auth/dal";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { reconcilePayment } from "@/lib/payments/reconcile";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Paiement", robots: { index: false } };

const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: DEFAULT_TIMEZONE });

async function PaymentStatus({ searchParams }: { searchParams: PageProps<"/premium/merci">["searchParams"] }) {
  const user = await getSessionUser();
  if (!user) redirect("/connexion?suivant=/premium");
  const params = await searchParams;
  const tx = typeof params.transaction === "string" && /^[A-Za-z0-9_-]{4,64}$/.test(params.transaction) ? params.transaction : null;
  if (!tx) return <Alert tone="error">Transaction introuvable. Si vous avez été débité, contactez-nous avec votre reçu Mobile Money.</Alert>;

  const supabase = await createClient();
  // RLS : l'utilisateur ne voit que ses propres paiements
  const { data: payment } = await supabase.from("payments").select("status, amount_xof, plan_code").eq("provider_transaction_id", tx).maybeSingle();
  if (!payment) return <Alert tone="error">Ce paiement n&apos;existe pas ou ne vous appartient pas.</Alert>;

  let status = payment.status;
  if (status === "pending") {
    // La notification peut arriver après le retour du client : on vérifie directement auprès de CinetPay
    const result = await reconcilePayment(tx, { source: "return_page" }).catch(() => null);
    if (result && result.status !== "unknown_transaction" && result.status !== "not_configured") status = result.status === "pending" ? "pending" : result.status;
  }

  if (status === "succeeded") {
    const { data: until } = await supabase.rpc("premium_until");
    return (
      <div className="space-y-4 text-center">
        <p className="text-5xl">🏆</p>
        <h2 className="font-display text-3xl font-extrabold uppercase text-gold">Bienvenue en Premium !</h2>
        <p className="text-sm text-muted">{until ? `Votre accès est actif jusqu'au ${dateFmt.format(new Date(until))}.` : "Votre accès est actif."}</p>
        <ButtonLink href="/pronostics">Voir les pronostics du jour</ButtonLink>
      </div>
    );
  }
  if (status === "pending") {
    return (
      <div className="space-y-3">
        <AutoRefresh seconds={8} />
        <Alert tone="info">⏳ Paiement en cours de confirmation par votre opérateur. Cette page se met à jour toute seule.</Alert>
        <p className="text-center text-xs text-muted">Validez la demande reçue sur votre téléphone (code Orange Money / Moov Money) si ce n&apos;est pas déjà fait.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <Alert tone="error">Le paiement n&apos;a pas abouti ({status === "cancelled" ? "annulé" : "refusé"}). Vous n&apos;avez pas été débité.</Alert>
      <ButtonLink href="/premium" variant="secondary" className="w-full">
        Réessayer
      </ButtonLink>
    </div>
  );
}

export default function PaymentThanksPage(props: PageProps<"/premium/merci">) {
  return (
    <>
      <PageHeader kicker="Premium" title="Paiement" />
      <Suspense fallback={<div className="h-32 animate-pulse rounded-(--radius-card) bg-surface" aria-hidden />}>
        <PaymentStatus searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
