import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Jeu responsable",
  description: "Les paris sportifs comportent des risques. Conseils pour garder le contrôle.",
};

const TIPS = [
  "Fixez-vous un budget à l'avance et ne le dépassez jamais.",
  "Ne misez jamais l'argent du loyer, de la nourriture, de l'école ou de la famille.",
  "N'empruntez pas pour parier et ne cherchez pas à « vous refaire » après une perte.",
  "Un pronostic reste une estimation : même une probabilité élevée peut perdre.",
  "Faites des pauses et gardez du temps pour vos proches, le travail et le sport.",
  "Ne pariez pas sous l'effet de l'alcool, du stress ou de la colère.",
];

const WARNING_SIGNS = [
  "Vous pariez plus souvent ou plus d'argent qu'avant.",
  "Vous cachez vos paris à vos proches.",
  "Vous empruntez ou vendez des biens pour jouer.",
  "Vous êtes irritable quand vous ne pouvez pas parier.",
];

export default function ResponsibleGamingPage() {
  return (
    <>
      <PageHeader title="Jeu responsable" subtitle="Les paris sportifs comportent des risques." />
      <div className="space-y-4 text-sm leading-relaxed">
        <Card className="border-danger/30 bg-danger/5">
          <p className="font-bold text-danger">Interdit aux moins de 18 ans.</p>
          <p className="mt-1 text-muted">
            Winner Pronostic est un outil d&apos;analyse statistique. Nous ne prenons aucun pari, ne gérons aucune mise et ne
            promettons aucun gain. Les paris d&apos;argent peuvent entraîner endettement, isolement et dépendance.
          </p>
        </Card>

        <Card>
          <h2 className="font-bold">Garder le contrôle</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted">
            {TIPS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </Card>

        <Card>
          <h2 className="font-bold">Les signaux d&apos;alerte</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted">
            {WARNING_SIGNS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </Card>

        <Card>
          <h2 className="font-bold">Besoin d&apos;aide ?</h2>
          <p className="mt-2 text-muted">
            Si le jeu devient un problème pour vous ou un proche, parlez-en à une personne de confiance ou à un
            professionnel de santé (médecin, centre de santé, psychologue). Vous pouvez aussi supprimer l&apos;application et
            demander à votre opérateur de paris de bloquer votre compte.
          </p>
        </Card>
      </div>
    </>
  );
}
