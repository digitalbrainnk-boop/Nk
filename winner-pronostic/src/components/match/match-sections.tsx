import type { Absence, Lineup } from "@/lib/sync/mappers";
import type { FormEntry, MatchHeader, Split, StandingRow } from "@/lib/data/match";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { type Market, selectionLabel } from "@/lib/predictions/markets";
import { getSport } from "@/lib/sports/catalog";
import { cn } from "@/lib/utils/cn";

const shortDate = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", timeZone: DEFAULT_TIMEZONE });
const RESULT_STYLE = { W: "bg-brand text-brand-ink", D: "bg-surface-3 text-ink", L: "bg-danger/80 text-white" } as const;
const RESULT_LABEL = { W: "V", D: "N", L: "D" } as const;

export function Section({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="space-y-2">
      <h2 className="font-display text-xl font-extrabold uppercase">{title}</h2>
      {note ? <p className="text-xs text-muted">{note}</p> : null}
      {children}
    </section>
  );
}

export function FormStrip({ team, form }: { team: string; form: FormEntry[] }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-semibold">{team}</p>
        <div className="flex gap-1" aria-label={`Forme de ${team}`}>
          {form.map((f) => (
            <span key={f.eventId} className={cn("grid size-6 place-items-center rounded-md text-[11px] font-extrabold", RESULT_STYLE[f.result])}>
              {RESULT_LABEL[f.result]}
            </span>
          ))}
        </div>
      </div>
      {form.length ? (
        <ul className="mt-2 space-y-1 text-xs text-muted">
          {form.map((f) => (
            <li key={f.eventId} className="flex justify-between gap-2">
              <span className="truncate">
                {shortDate.format(new Date(f.date))} · {f.venue === "D" ? "vs" : "à"} {f.opponent}
              </span>
              <span className="scoreboard shrink-0 text-sm font-bold text-ink">
                {f.scored}-{f.conceded}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted">Pas encore de match enregistré.</p>
      )}
    </div>
  );
}

export function SplitCompare({ match, home, away }: { match: MatchHeader; home: Split; away: Split }) {
  const unit = getSport(match.sport).scoreUnit;
  const avg = (s: Split, k: "scored" | "conceded") => (s.played ? (s[k] / s.played).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : "—");
  const rows = [
    { label: `${unit} marqués / match`, home: avg(home, "scored"), away: avg(away, "scored") },
    { label: `${unit} encaissés / match`, home: avg(home, "conceded"), away: avg(away, "conceded") },
    { label: "Matchs pris en compte", home: String(home.played), away: String(away.played) },
  ];
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface text-sm">
      <div className="grid grid-cols-[1fr_auto_1fr] gap-2 border-b border-line px-3 py-2 text-[11px] font-bold uppercase text-muted">
        <span className="truncate">{match.home.name} (domicile)</span>
        <span />
        <span className="truncate text-right">{match.away.name} (extérieur)</span>
      </div>
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[3rem_1fr_3rem] items-center gap-2 px-3 py-2">
          <span className="scoreboard text-lg font-extrabold">{r.home}</span>
          <span className="text-center text-xs text-muted">{r.label}</span>
          <span className="scoreboard text-right text-lg font-extrabold">{r.away}</span>
        </div>
      ))}
    </div>
  );
}

export function StandingsTable({ rows, highlight }: { rows: StandingRow[]; highlight: number[] }) {
  if (!rows.length) return <p className="text-sm text-muted">Classement non disponible pour cette compétition.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full text-xs">
        <thead className="text-muted">
          <tr className="border-b border-line">
            <th className="px-2 py-2 text-left">#</th>
            <th className="px-2 py-2 text-left">Équipe</th>
            <th className="px-1 py-2">J</th>
            <th className="px-1 py-2">G</th>
            <th className="px-1 py-2">N</th>
            <th className="px-1 py-2">P</th>
            <th className="px-1 py-2">+/−</th>
            <th className="px-2 py-2">Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.teamId} className={cn("border-b border-line/50", highlight.includes(r.teamId) && "bg-brand/10 font-semibold text-ink")}>
              <td className="px-2 py-1.5">{r.rank}</td>
              <td className="max-w-36 truncate px-2 py-1.5">{r.name}</td>
              <td className="px-1 py-1.5 text-center">{r.played}</td>
              <td className="px-1 py-1.5 text-center">{r.won}</td>
              <td className="px-1 py-1.5 text-center">{r.drawn}</td>
              <td className="px-1 py-1.5 text-center">{r.lost}</td>
              <td className="px-1 py-1.5 text-center">{r.scored - r.conceded}</td>
              <td className="scoreboard px-2 py-1.5 text-center text-sm font-extrabold">{r.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HeadToHead({ games, home }: { games: FormEntry[]; home: string }) {
  if (!games.length) return <p className="text-sm text-muted">Aucune confrontation récente enregistrée.</p>;
  return (
    <ul className="divide-y divide-line/60 rounded-xl border border-line bg-surface text-sm">
      {games.map((g) => (
        <li key={g.eventId} className="flex items-center justify-between gap-2 px-3 py-2">
          <span className="text-xs text-muted">{shortDate.format(new Date(g.date))}</span>
          <span className="truncate">{g.venue === "D" ? `${home} – ${g.opponent}` : `${g.opponent} – ${home}`}</span>
          <span className="scoreboard shrink-0 text-base font-extrabold">{g.venue === "D" ? `${g.scored}-${g.conceded}` : `${g.conceded}-${g.scored}`}</span>
        </li>
      ))}
    </ul>
  );
}

type Incident = { minute: number | null; extra_minute: number | null; type: string; detail: string | null; player_name: string | null; assist_name: string | null; side: number | null };

export function Incidents({ incidents }: { incidents: Incident[] }) {
  const icon = (i: Incident) => (i.type === "Goal" ? (/missed/i.test(i.detail ?? "") ? "❌" : "⚽") : i.type === "Card" ? (/red|second/i.test(i.detail ?? "") ? "🟥" : "🟨") : i.type === "subst" ? "🔁" : "📺");
  return (
    <ul className="space-y-1.5 rounded-xl border border-line bg-surface p-3 text-sm">
      {incidents.map((i, k) => (
        <li key={k} className={cn("flex items-center gap-2", i.side === 2 && "flex-row-reverse text-right")}>
          <span className="scoreboard w-10 shrink-0 text-center font-bold text-muted">
            {i.minute ?? "?"}
            {i.extra_minute ? `+${i.extra_minute}` : ""}&apos;
          </span>
          <span aria-hidden>{icon(i)}</span>
          <span className="truncate">
            {i.player_name ?? i.detail}
            {i.assist_name && i.type === "Goal" ? <span className="text-xs text-muted"> (passe : {i.assist_name})</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Absences({ match, injuries }: { match: MatchHeader; injuries: Absence[] }) {
  const of = (externalId: number) => injuries.filter((i) => i.teamExternalId === externalId);
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {[match.home, match.away].map((t) => (
        <div key={t.id} className="rounded-xl border border-line bg-surface p-3">
          <p className="text-sm font-semibold">{t.name}</p>
          {of(t.externalId).length ? (
            <ul className="mt-1 space-y-0.5 text-xs text-muted">
              {of(t.externalId).map((p) => (
                <li key={p.player}>
                  🚑 {p.player}
                  {p.reason ? ` — ${p.reason}` : ""}
                  {p.type === "Questionable" ? " (incertain)" : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-muted">Aucune absence signalée.</p>
          )}
        </div>
      ))}
    </div>
  );
}

export function Lineups({ match, lineups }: { match: MatchHeader; lineups: Lineup[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {[match.home, match.away].map((t) => {
        const l = lineups.find((x) => x.teamExternalId === t.externalId);
        return (
          <div key={t.id} className="rounded-xl border border-line bg-surface p-3">
            <p className="text-sm font-semibold">
              {t.name} {l?.formation ? <span className="text-muted">· {l.formation}</span> : null}
            </p>
            {l ? (
              <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-xs text-muted">
                {l.startXI.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ol>
            ) : (
              <p className="mt-1 text-xs text-muted">Composition pas encore publiée.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function MainOdds({ match, odds }: { match: MatchHeader; odds: { market: string; line: number | null; selection: string; odd: number; bookmaker: string }[] }) {
  if (!odds.length) return <p className="text-sm text-muted">Cotes pas encore disponibles pour ce match.</p>;
  const unit = getSport(match.sport).scoreUnit;
  const teams = { home: match.home.name, away: match.away.name };
  const order = ["1X2", "ML", "DC", "BTTS", "TOTAL"];
  // Total : on montre la ligne la plus équilibrée
  const totals = odds.filter((o) => o.market === "TOTAL");
  const centralLine = totals.length ? totals.reduce((best, o) => (Math.abs(o.odd - 1.9) < Math.abs(best.odd - 1.9) ? o : best)).line : null;
  const shown = odds
    .filter((o) => o.market !== "TOTAL" || o.line === centralLine)
    .sort((a, b) => order.indexOf(a.market) - order.indexOf(b.market) || a.selection.localeCompare(b.selection));
  return (
    <ul className="grid grid-cols-2 gap-2">
      {shown.map((o) => (
        <li key={`${o.market}${o.line}${o.selection}`} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2">
          <span className="min-w-0">
            <span className="block truncate text-xs">{selectionLabel({ period: "FT", market: o.market as Market, line: o.line, selection: o.selection }, teams, unit)}</span>
            <span className="block truncate text-[10px] text-faint">{o.bookmaker}</span>
          </span>
          <span className="scoreboard text-lg font-extrabold">{o.odd.toFixed(2)}</span>
        </li>
      ))}
    </ul>
  );
}
