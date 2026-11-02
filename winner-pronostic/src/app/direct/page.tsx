import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Matchs en direct" };

export default function LivePage() {
  return (
    <>
      <PageHeader title="En direct" subtitle="Scores, minute de jeu, buteurs et cartons." />
      <ComingSoon title="Matchs en direct">Les scores en temps réel seront affichés ici dès la phase 2.</ComingSoon>
    </>
  );
}
