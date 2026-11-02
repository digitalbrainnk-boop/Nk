import Link from "next/link";
import { ComingSoon } from "@/components/layout/coming-soon";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CalendarIcon, LiveIcon, ShieldIcon, TargetIcon, TicketIcon } from "@/components/ui/icons";

const FEATURES = [
  { Icon: CalendarIcon, title: "Programme complet", text: "Tous les matchs du jour et des 7 prochains jours, par pays et par compétition." },
  { Icon: LiveIcon, title: "Scores en direct", text: "Minute de jeu, buteurs et cartons mis à jour automatiquement." },
  { Icon: TargetIcon, title: "Pronostics analysés", text: "Probabilités calculées (Poisson, Elo, forme) et indice de confiance de 1 à 5." },
  { Icon: TicketIcon, title: "Coupons optimisés", text: "Choisissez la cote visée et le niveau de risque : nous affichons la probabilité réelle estimée." },
];

export default function HomePage() {
  return (
    <div className="space-y-5">
      <section className="rounded-(--radius-card) border border-line bg-gradient-to-br from-surface-2 to-surface p-5">
        <p className="text-xs font-bold uppercase tracking-wider text-brand">Analyse football</p>
        <h1 className="mt-1 text-2xl font-extrabold leading-tight tracking-tight">
          Les matchs, les stats et des pronostics <span className="text-brand">expliqués</span>.
        </h1>
        <p className="mt-2 text-sm text-muted">
          Winner Pronostic analyse les statistiques pour vous aider à décider. Nous ne prenons aucun pari et ne gérons
          aucune mise : aucun pronostic n&apos;est garanti.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <ButtonLink href="/inscription" className="whitespace-nowrap">
            Créer un compte gratuit
          </ButtonLink>
          <ButtonLink href="/jeu-responsable" variant="ghost" className="whitespace-nowrap">
            Jeu responsable
          </ButtonLink>
        </div>
      </section>

      <ComingSoon title="Programme des matchs">
        La liste des matchs (aujourd&apos;hui, demain, 7 jours), les filtres et la recherche d&apos;équipe arrivent avec la
        synchronisation API-Football.
      </ComingSoon>

      <section aria-labelledby="fonctionnalites" className="space-y-2">
        <h2 id="fonctionnalites" className="text-sm font-bold uppercase tracking-wide text-muted">
          Ce que vous trouverez ici
        </h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {FEATURES.map(({ Icon, title, text }) => (
            <Card key={title} className="flex gap-3 p-3.5">
              <Icon className="mt-0.5 size-6 shrink-0 text-brand" />
              <div>
                <h3 className="font-semibold">{title}</h3>
                <p className="text-sm text-muted">{text}</p>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <Link href="/jeu-responsable" className="flex items-center gap-3 rounded-(--radius-card) border border-danger/30 bg-danger/5 p-4 text-sm">
        <ShieldIcon className="size-6 shrink-0 text-danger" />
        <span className="text-muted">
          <span className="font-semibold text-ink">Interdit aux moins de 18 ans.</span> Les paris sportifs peuvent entraîner
          une dépendance et des pertes d&apos;argent. Ne misez que ce que vous pouvez vous permettre de perdre.
        </span>
      </Link>
    </div>
  );
}
