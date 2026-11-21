import type { Metadata } from "next";
import { after, connection } from "next/server";
import { Suspense } from "react";
import { ComingSoon } from "@/components/layout/coming-soon";
import { PageHeader } from "@/components/layout/page-header";
import { CompetitionGroup } from "@/components/programme/competition-group";
import { AutoRefresh } from "@/components/ui/auto-refresh";
import { groupByCompetition, listEvents, liveWindow } from "@/lib/data/events";
import { refreshLiveInBackground } from "@/lib/sync/lazy";

export const metadata: Metadata = { title: "En direct" };

async function LiveContent() {
  // Page calculée à chaque visite (l'heure courante change à chaque requête)
  await connection();
  const { from, to, now } = liveWindow();
  const events = await listEvents({ from, to, limit: 400 });
  // Mise à jour des scores après l'envoi de la page (sans ralentir l'affichage)
  after(refreshLiveInBackground);

  const live = events.filter((e) => e.status === "live");
  const soon = events.filter((e) => e.status === "scheduled" && Date.parse(e.startsAt) >= now - 15 * 60_000);
  const finished = events.filter((e) => e.status === "finished").reverse();

  return (
    <div className="space-y-6">
      <AutoRefresh seconds={30} />
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-display text-2xl font-extrabold uppercase">
          <span className="size-2.5 animate-live-pulse rounded-full bg-live" aria-hidden />
          En cours <span className="text-base text-muted">({live.length})</span>
        </h2>
        {live.length ? (
          groupByCompetition(live).map((g) => <CompetitionGroup key={g.id} group={g} />)
        ) : (
          <ComingSoon title="Aucun match en cours" emoji="📡">
            Les scores s&apos;afficheront ici dès le coup d&apos;envoi. La page se met à jour toute seule.
          </ComingSoon>
        )}
      </section>
      {soon.length ? (
        <section className="space-y-3">
          <h2 className="font-display text-2xl font-extrabold uppercase">Bientôt</h2>
          {groupByCompetition(soon.slice(0, 40)).map((g) => (
            <CompetitionGroup key={g.id} group={g} />
          ))}
        </section>
      ) : null}
      {finished.length ? (
        <section className="space-y-3">
          <h2 className="font-display text-2xl font-extrabold uppercase">Terminés récemment</h2>
          {groupByCompetition(finished.slice(0, 40)).map((g) => (
            <CompetitionGroup key={g.id} group={g} />
          ))}
        </section>
      ) : null}
    </div>
  );
}

export default function LivePage() {
  return (
    <>
      <PageHeader kicker="Live" title="En direct" subtitle="Scores, temps de jeu, tous sports. Mise à jour automatique." />
      <Suspense fallback={<div className="h-40 animate-pulse rounded-(--radius-card) bg-surface" aria-hidden />}>
        <LiveContent />
      </Suspense>
    </>
  );
}
