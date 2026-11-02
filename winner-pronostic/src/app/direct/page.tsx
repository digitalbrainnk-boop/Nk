import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "En direct" };

export default function LivePage() {
  return (
    <>
      <PageHeader kicker="Live" title="En direct" subtitle="Scores, temps de jeu, buteurs et cartons, tous sports." />
      <ComingSoon title="Matchs en direct" emoji="📡">
        Les scores en temps réel (football, basket, hockey, handball…) s&apos;afficheront ici dès la phase 2.
      </ComingSoon>
    </>
  );
}
