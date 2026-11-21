import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ComingSoon } from "@/components/layout/coming-soon";
import { FeaturedCoupons } from "@/components/coupons/featured-coupons";
import { AdSlot } from "@/components/layout/ad-slot";
import { PageHeader } from "@/components/layout/page-header";
import { PickCard } from "@/components/picks/pick-card";
import { ButtonLink } from "@/components/ui/button";
import { upcomingPicks } from "@/lib/data/picks";

export const metadata: Metadata = { title: "Pronostics du jour" };

async function PicksContent() {
  const { picks, hidden } = await upcomingPicks(48);
  return (
    <div className="space-y-4">
      {picks.length ? (
        <div className="space-y-2.5">
          {picks.map((p) => (
            <PickCard key={p.id} pick={p} />
          ))}
        </div>
      ) : (
        <ComingSoon title="Pas encore de pronostic publié" emoji="🎯">
          Les pronostics sont calculés chaque jour pour les matchs des 36 prochaines heures.
        </ComingSoon>
      )}
      {hidden > 0 ? (
        <section className="rounded-(--radius-card) border border-gold/40 bg-gold/[0.06] p-4 text-center">
          <p className="font-display text-xl font-extrabold uppercase">
            👑 {hidden} pronostic{hidden > 1 ? "s" : ""} Premium
          </p>
          <p className="mt-1 text-sm text-muted">Réservés aux abonnés, avec le rapport d&apos;analyse complet de chaque match.</p>
          <ButtonLink href="/premium" className="mt-3">
            Passer Premium
          </ButtonLink>
        </section>
      ) : null}
      <p className="text-center text-xs text-muted">
        Transparence : tous nos pronostics passés et leur taux de réussite réel sont sur la page{" "}
        <Link href="/historique" className="font-semibold text-brand underline">
          Historique
        </Link>
        . Aucun pronostic n&apos;est garanti.
      </p>
    </div>
  );
}

export default function PredictionsPage() {
  return (
    <>
      <PageHeader kicker="Analyse" title="Pronostics" subtitle="Le pronostic le plus solide de chaque match, tous sports." />
      <div className="space-y-6">
        <Suspense fallback={<div className="h-40 animate-pulse rounded-(--radius-card) bg-surface" aria-hidden />}>
          <PicksContent />
        </Suspense>
        <Suspense fallback={null}>
          <AdSlot />
        </Suspense>
        <Suspense fallback={null}>
          <FeaturedCoupons />
        </Suspense>
      </div>
    </>
  );
}
