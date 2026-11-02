import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { MatchReportView } from "@/components/report/match-report";
import { Alert } from "@/components/ui/alert";
import { exampleFootballReportInput } from "@/lib/predictions/example";
import { buildMatchReport } from "@/lib/predictions/report";

export const metadata: Metadata = { title: "Exemple de rapport d'analyse", robots: { index: false, follow: false } };

export default function ExampleReportPage() {
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_DESIGN_PREVIEW !== "1") notFound();
  const report = buildMatchReport(exampleFootballReportInput());
  return (
    <div className="space-y-4">
      <PageHeader kicker="Exemple" title="Rapport d'analyse" />
      <Alert tone="warning">Exemple fictif : statistiques, cotes et joueurs inventés pour présenter le rapport.</Alert>
      <MatchReportView report={report} competition="Premier League" startsAt="dim. 2 nov. · 20:00" />
    </div>
  );
}
