import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Pronostics" };

export default function PredictionsPage() {
  return (
    <>
      <PageHeader title="Pronostics" subtitle="Probabilités calculées et indice de confiance." />
      <ComingSoon title="Moteur de pronostics">
        1X2, double chance, plus/moins de buts, les deux équipes marquent, mi-temps/fin de match et détection des value
        bets : livré en phase 4. Aucun pronostic n&apos;est garanti.
      </ComingSoon>
    </>
  );
}
