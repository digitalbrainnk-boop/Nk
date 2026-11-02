import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "Conditions d'utilisation" };

const SECTIONS = [
  {
    title: "1. Objet du service",
    text: "Winner Pronostic fournit des informations sur les matchs de football (programme, scores, statistiques) et des pronostics issus d'un modèle statistique. Il s'agit d'un outil d'analyse et de conseil : l'application ne prend aucun pari, ne reçoit aucune mise et n'est pas un opérateur de jeux d'argent.",
  },
  {
    title: "2. Âge minimum",
    text: "L'inscription est réservée aux personnes âgées de 18 ans ou plus. En créant un compte, vous certifiez avoir l'âge requis. Tout compte créé par une personne mineure pourra être supprimé.",
  },
  {
    title: "3. Aucune garantie de résultat",
    text: "Les pronostics, probabilités et coupons sont des estimations. Aucun résultat n'est garanti. Vous restez seul responsable des décisions que vous prenez, notamment auprès d'opérateurs de paris agréés. Les taux de réussite passés sont publiés pour transparence et ne préjugent pas des résultats futurs.",
  },
  {
    title: "4. Abonnement premium",
    text: "Certaines fonctionnalités sont accessibles avec un abonnement hebdomadaire ou mensuel payé par Mobile Money. Le prix et la durée sont indiqués avant paiement. L'abonnement donne accès à des contenus d'analyse, jamais à un gain.",
  },
  {
    title: "5. Données personnelles",
    text: "Nous collectons uniquement les données nécessaires au service : nom ou pseudo, e-mail ou numéro de téléphone, date de naissance (contrôle de l'âge), pays et préférences. Elles ne sont jamais vendues. Vous pouvez demander la suppression de votre compte à tout moment.",
  },
  {
    title: "6. Jeu responsable",
    text: "Les paris comportent des risques. Consultez la page « Jeu responsable » pour des conseils et des ressources d'aide.",
  },
];

export default function TermsPage() {
  return (
    <>
      <PageHeader title="Conditions d'utilisation" subtitle="Version du 2 novembre 2026." />
      <div className="space-y-3 text-sm leading-relaxed">
        {SECTIONS.map((s) => (
          <Card key={s.title}>
            <h2 className="font-bold">{s.title}</h2>
            <p className="mt-1.5 text-muted">{s.text}</p>
          </Card>
        ))}
      </div>
    </>
  );
}
