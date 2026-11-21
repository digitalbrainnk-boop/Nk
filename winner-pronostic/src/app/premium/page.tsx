import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { CheckoutButton } from "@/components/premium/checkout-button";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { getCurrentProfile } from "@/lib/auth/dal";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { cinetpayConfig } from "@/lib/payments/reconcile";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Premium", description: "Tous les pronostics, les rapports complets et les codes illimités. Paiement Orange Money et Moov Money." };

const BENEFITS = [
  "Tous les pronostics du jour, tous sports",
  "Rapport d'analyse complet de chaque match (plus de 400 marchés)",
  "Codes illimités (« code de 2, 5, 10… »)",
  "Coupons du jour mis en avant, avec code de chargement",
  "Alertes avant le coup d'envoi et à chaque but",
  "Sans publicité",
];

const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short", timeZone: DEFAULT_TIMEZONE });
const xof = new Intl.NumberFormat("fr-FR");

async function PremiumContent() {
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const [{ data: plans }, until] = await Promise.all([
    supabase.from("plans").select("code, name, price_xof, duration_days").eq("is_active", true).order("display_order"),
    profile ? supabase.rpc("premium_until").then((r) => r.data) : Promise.resolve(null),
  ]);
  const configured = cinetpayConfig() !== null;

  return (
    <div className="space-y-5">
      {until ? <Alert tone="success">👑 Vous êtes Premium jusqu&apos;au {dateFmt.format(new Date(until))}. Un nouveau paiement prolonge votre abonnement.</Alert> : null}
      {!configured ? <Alert tone="warning">Le paiement Mobile Money sera activé très bientôt.</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {(plans ?? []).map((p, i) => {
          const perDay = Math.round(p.price_xof / p.duration_days);
          const highlight = i === (plans ?? []).length - 1;
          return (
            <section key={p.code} className={cn("relative rounded-(--radius-card) border p-4", highlight ? "border-gold/60 bg-gold/[0.06]" : "border-line bg-surface")}>
              {highlight ? <span className="absolute -top-2.5 right-3 rounded-full bg-gold px-2 py-0.5 text-[10px] font-extrabold uppercase text-brand-ink">Le plus avantageux</span> : null}
              <h2 className="font-display text-xl font-extrabold uppercase">{p.name}</h2>
              <p className="mt-1">
                <span className="scoreboard text-4xl font-extrabold text-gold">{xof.format(p.price_xof)}</span>
                <span className="ml-1 text-sm text-muted">F CFA / {p.duration_days} jours</span>
              </p>
              <p className="mb-3 text-xs text-muted">soit environ {xof.format(perDay)} F par jour</p>
              {profile ? (
                <CheckoutButton plan={p.code} label={`Payer ${xof.format(p.price_xof)} F`} highlight={highlight} />
              ) : (
                <ButtonLink href="/connexion?suivant=/premium" className="w-full" variant={highlight ? "primary" : "secondary"}>
                  Se connecter pour payer
                </ButtonLink>
              )}
            </section>
          );
        })}
      </div>
      <p className="text-center text-xs text-muted">Paiement sécurisé par CinetPay : Orange Money, Moov Money et autres opérateurs Mobile Money.</p>
    </div>
  );
}

export default function PremiumPage() {
  return (
    <div className="space-y-5">
      <PageHeader kicker="Abonnement" title="Premium 👑" subtitle="Toute l'analyse, sans limite." />
      <ul className="space-y-1.5 rounded-(--radius-card) border border-line bg-surface p-4 text-sm">
        {BENEFITS.map((b) => (
          <li key={b} className="flex gap-2">
            <span className="text-brand">✓</span>
            {b}
          </li>
        ))}
      </ul>
      <Suspense fallback={<div className="h-48 animate-pulse rounded-(--radius-card) bg-surface" aria-hidden />}>
        <PremiumContent />
      </Suspense>
      <p className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-xs text-muted">
        Premium donne accès à des analyses, jamais à un gain garanti. Les paris comportent des risques : ne misez que ce que vous pouvez
        vous permettre de perdre. Interdit aux moins de 18 ans.
      </p>
    </div>
  );
}
