import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Pronostics" };

export default function PredictionsPage() {
  return (
    <>
      <PageHeader kicker="Analyse" title="Pronostics" subtitle="Probabilités calculées et indice de confiance, tous sports." />
      <ComingSoon title="Pronostics du jour" emoji="🎯">
        Vainqueur, double chance, plus/moins, handicap, les deux équipes marquent… avec détection des value bets. Livré en
        phase 4. Aucun pronostic n&apos;est garanti.
      </ComingSoon>
    </>
  );
}
