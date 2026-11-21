import { connection } from "next/server";
import { ComingSoon } from "@/components/layout/coming-soon";
import { currentDay, dayBounds, groupByCompetition, listCompetitions, listEvents, searchWindow } from "@/lib/data/events";
import { type SportCode, isSportCode } from "@/lib/sports/catalog";
import { CompetitionGroup } from "./competition-group";
import { DayTabs } from "./day-tabs";
import { ProgrammeFilters } from "./programme-filters";
import { SportLinks } from "./sport-links";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Programme des matchs (lit l'URL : jour, sport, pays, compétition, recherche). */
export async function Programme({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const raw = await searchParams;
  // Rendu à chaque requête : le programme dépend de la date du jour
  await connection();
  const today = currentDay();
  const jour = first(raw.jour);
  const day = jour && /^\d{4}-\d{2}-\d{2}$/.test(jour) ? jour : today;
  const sportParam = first(raw.sport);
  const sport: SportCode | undefined = isSportCode(sportParam) ? sportParam : undefined;
  const competition = Number(first(raw.competition)) || undefined;
  const pays = first(raw.pays)?.slice(0, 60);
  const q = first(raw.q)?.trim().slice(0, 40) || undefined;
  const params = { jour: day === today ? undefined : day, sport, pays, competition: competition ? String(competition) : undefined, q };

  const bounds = q ? searchWindow() : dayBounds(day);
  const [events, competitions] = await Promise.all([
    listEvents({ ...bounds, sport, country: pays, competitionId: competition, teamQuery: q }),
    listCompetitions(sport),
  ]);
  const groups = groupByCompetition(events);
  const live = events.filter((e) => e.status === "live").length;

  return (
    <section aria-labelledby="programme" className="space-y-3">
      <div className="flex items-end justify-between">
        <h2 id="programme" className="font-display text-2xl font-extrabold uppercase">
          Programme
        </h2>
        <span className="text-xs font-semibold text-muted">
          {events.length} match{events.length > 1 ? "s" : ""}
          {live ? <span className="ml-1 text-live">· {live} en direct</span> : null}
        </span>
      </div>
      <SportLinks current={sport} params={params} />
      {!q ? <DayTabs today={today} current={day} params={params} /> : null}
      <ProgrammeFilters competitions={competitions} params={params} />
      {q ? <p className="text-sm text-muted">Résultats pour « {q} » (matchs récents et à venir).</p> : null}
      {groups.length ? (
        <div className="space-y-5">
          {groups.map((g) => (
            <CompetitionGroup key={g.id} group={g} />
          ))}
        </div>
      ) : (
        <ComingSoon title={q ? "Aucun match trouvé" : "Aucun match pour ce choix"} emoji="🗓️">
          {competitions.length
            ? "Essayez un autre jour, un autre sport ou retirez un filtre."
            : "Les matchs apparaîtront dès la première synchronisation des données (clé API-Sports et tâche planifiée)."}
        </ComingSoon>
      )}
    </section>
  );
}

export function ProgrammeSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="h-8 w-40 rounded bg-surface" />
      <div className="h-10 rounded-full bg-surface" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-32 animate-pulse rounded-(--radius-card) bg-surface" />
      ))}
    </div>
  );
}
