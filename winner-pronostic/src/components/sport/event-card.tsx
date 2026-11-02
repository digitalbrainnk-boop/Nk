import Link from "next/link";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { type SportCode, getSport } from "@/lib/sports/catalog";
import { cn } from "@/lib/utils/cn";
import { ConfidenceMeter } from "./confidence-meter";
import { LiveBadge } from "./live-badge";
import { sportStyle } from "./sport-badge";
import { TeamCrest } from "./team-crest";

export type EventCardData = {
  id: number | string;
  sport: SportCode;
  competition: string;
  startsAt: string;
  status: "scheduled" | "live" | "finished" | "postponed" | "cancelled";
  clock?: string | null;
  home: { name: string; logoUrl?: string | null };
  away: { name: string; logoUrl?: string | null };
  score?: { home: number; away: number } | null;
  odds?: { label: string; value: number }[];
  tip?: { label: string; probability: number; confidence: number; isValue?: boolean } | null;
  href?: string;
};

const timeFmt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: DEFAULT_TIMEZONE });

/** Carte de match façon tableau d'affichage, avec cotes et pronostic. */
export function EventCard({ event }: { event: EventCardData }) {
  const sport = getSport(event.sport);
  const live = event.status === "live";
  const showScore = event.score && (live || event.status === "finished");
  const homeWins = showScore && event.score!.home > event.score!.away;
  const awayWins = showScore && event.score!.away > event.score!.home;

  const content = (
    <article
      style={sportStyle(event.sport)}
      className="relative overflow-hidden rounded-(--radius-card) border border-line bg-surface transition-colors hover:border-(--sport)/50"
    >
      <span className="absolute inset-y-0 left-0 w-1 bg-(--sport)" aria-hidden />
      <header className="flex items-center justify-between gap-2 border-b border-line/70 px-3.5 py-2 pl-4 text-[11px] text-muted">
        <span className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden>{sport.emoji}</span>
          <span className="truncate font-semibold uppercase tracking-wide">{event.competition}</span>
        </span>
        {live ? (
          <LiveBadge clock={event.clock} />
        ) : event.status === "finished" ? (
          <span className="font-semibold uppercase">Terminé</span>
        ) : event.status === "postponed" ? (
          <span className="font-semibold uppercase text-warning">Reporté</span>
        ) : (
          <span className="scoreboard text-sm font-extrabold text-ink">{timeFmt.format(new Date(event.startsAt))}</span>
        )}
      </header>

      <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 px-3.5 py-3 pl-4">
        {[
          { team: event.home, score: event.score?.home, wins: homeWins },
          { team: event.away, score: event.score?.away, wins: awayWins },
        ].map(({ team, score, wins }, i) => (
          <div key={i} className="contents">
            <div className="flex min-w-0 items-center gap-2.5">
              <TeamCrest name={team.name} logoUrl={team.logoUrl} />
              <span className={cn("truncate text-[15px] font-semibold", showScore && !wins && "text-muted")}>{team.name}</span>
            </div>
            <span className={cn("scoreboard min-w-6 text-right text-2xl font-extrabold leading-none", live ? "text-live" : wins ? "text-ink" : "text-muted")}>
              {showScore ? score : ""}
            </span>
          </div>
        ))}
      </div>

      {event.odds?.length ? (
        <div className={cn("grid gap-1.5 px-3.5 pb-3 pl-4", event.odds.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
          {event.odds.map((o) => (
            <span key={o.label} className="flex items-center justify-between rounded-lg border border-line bg-surface-2 px-2.5 py-1.5">
              <span className="text-xs font-semibold text-muted">{o.label}</span>
              <span className="scoreboard text-base font-extrabold">{o.value.toFixed(2)}</span>
            </span>
          ))}
        </div>
      ) : null}

      {event.tip ? (
        <footer className="flex items-center justify-between gap-2 border-t border-line/70 bg-(--sport)/[0.06] px-3.5 py-2.5 pl-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-(--sport)">
              Pronostic{event.tip.isValue ? " · Value bet" : ""}
            </p>
            <p className="truncate text-sm font-semibold">{event.tip.label}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <span className="scoreboard text-xl font-extrabold text-(--sport)">{Math.round(event.tip.probability * 100)}%</span>
            <ConfidenceMeter value={event.tip.confidence} />
          </div>
        </footer>
      ) : null}
    </article>
  );

  return event.href ? (
    <Link href={event.href} className="block">
      {content}
    </Link>
  ) : (
    content
  );
}
