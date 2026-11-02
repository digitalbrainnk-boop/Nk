import { ConfidenceMeter } from "@/components/sport/confidence-meter";
import { sportStyle } from "@/components/sport/sport-badge";
import { TeamCrest } from "@/components/sport/team-crest";
import type { MatchReport, ReportRow } from "@/lib/predictions/report";
import { betNotation } from "@/lib/predictions/markets";
import { getSport } from "@/lib/sports/catalog";
import { cn } from "@/lib/utils/cn";

const pct = (p: number) => `${Math.round(p * 100)}%`;
const odd = (x: number) => (Number.isFinite(x) && x < 1000 ? x.toFixed(2) : "—");
const num = (x: number) => x.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

function barColor(p: number) {
  return p >= 0.65 ? "bg-brand" : p >= 0.45 ? "bg-gold" : p >= 0.25 ? "bg-warning" : "bg-danger/80";
}

function PickCard({ row, variant }: { row: ReportRow; variant: "top" | "value" }) {
  return (
    <li className={cn("rounded-xl border p-3", variant === "value" ? "border-gold/40 bg-gold/[0.06]" : "border-line bg-surface-2/70")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-snug">{row.label}</p>
          <p className="mt-0.5 text-[11px] text-muted">{betNotation(row.ref)}</p>
        </div>
        <span className={cn("scoreboard shrink-0 text-2xl font-extrabold leading-none", variant === "value" ? "text-gold" : "text-brand")}>
          {pct(row.probability)}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          Confiance <ConfidenceMeter value={row.confidence} />
        </span>
        <span>
          Cote juste <strong className="scoreboard text-sm text-ink">{odd(row.fairOdd)}</strong>
          {row.bestOdd ? (
            <>
              {" · "}Bookmaker <strong className="scoreboard text-sm text-ink">{odd(row.bestOdd)}</strong>
            </>
          ) : null}
        </span>
      </div>
      {variant === "value" && row.edge !== null ? (
        <p className="mt-1.5 text-[11px] font-semibold text-gold">Avantage estimé : +{Math.round(row.edge * 100)} % par rapport à la cote</p>
      ) : null}
    </li>
  );
}

function MarketRow({ row }: { row: ReportRow }) {
  const refund = row.outcome ? row.outcome.push + row.outcome.halfLoss + row.outcome.halfWin : 0;
  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 py-2">
      <span className="text-sm leading-snug">{row.label}</span>
      <span className="flex items-center gap-2">
        {row.bestOdd ? (
          <span
            className={cn(
              "scoreboard rounded-md px-1.5 py-0.5 text-sm font-extrabold",
              row.isValue ? "bg-gold/15 text-gold ring-1 ring-gold/40" : "bg-surface-3 text-ink",
            )}
            title={row.bookmaker ? `Cote ${row.bookmaker}` : "Cote du bookmaker"}
          >
            {odd(row.bestOdd)}
          </span>
        ) : null}
        <span className="scoreboard w-11 text-right text-base font-extrabold">{pct(row.probability)}</span>
      </span>
      <span className="col-span-2 flex items-center gap-2">
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
          <span className={cn("block h-full rounded-full", barColor(row.probability))} style={{ width: `${Math.max(2, row.probability * 100)}%` }} />
        </span>
        <span className="w-24 text-right text-[10px] text-faint">
          {refund > 0.005 ? `remb. ${Math.round(refund * 100)} % · ` : ""}juste {odd(row.fairOdd)}
        </span>
      </span>
    </li>
  );
}

/** Rapport complet d'un match (rendu serveur, sans JavaScript côté téléphone). */
export function MatchReportView({ report, competition, startsAt }: { report: MatchReport; competition?: string; startsAt?: string }) {
  const sport = getSport(report.sport);
  const isSets = report.sport === "volleyball" || report.sport === "tennis";
  const total = report.expected.home + report.expected.away;
  const homeShare = isSets ? report.expected.home : total > 0 ? report.expected.home / total : 0.5;

  return (
    <div className="space-y-5" style={sportStyle(report.sport)}>
      {/* En-tête façon tableau d'affichage */}
      <section className="bg-pitch relative overflow-hidden rounded-(--radius-card) border border-(--sport)/30 p-4">
        <p className="text-center text-[11px] font-semibold uppercase tracking-wider text-muted">
          {sport.emoji} {sport.name}
          {competition ? ` · ${competition}` : ""}
          {startsAt ? ` · ${startsAt}` : ""}
        </p>
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div className="flex flex-col items-center gap-1.5 text-center">
            <TeamCrest name={report.teams.home} size={44} />
            <span className="text-sm font-bold leading-tight">{report.teams.home}</span>
          </div>
          <div className="text-center">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted">{isSets ? "Set gagné" : `${report.unit} attendus`}</p>
            <p className="scoreboard whitespace-nowrap text-[32px] font-extrabold leading-none">
              {isSets ? `${Math.round(report.expected.home * 100)}%` : `${num(report.expected.home)}`}
              <span className="mx-1 text-faint">–</span>
              {isSets ? `${Math.round(report.expected.away * 100)}%` : `${num(report.expected.away)}`}
            </p>
          </div>
          <div className="flex flex-col items-center gap-1.5 text-center">
            <TeamCrest name={report.teams.away} size={44} />
            <span className="text-sm font-bold leading-tight">{report.teams.away}</span>
          </div>
        </div>
        <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-surface-3">
          <span className="bg-(--sport)" style={{ width: `${homeShare * 100}%` }} />
          <span className="flex-1 bg-info/70" />
        </div>
        <p className="mt-3 text-center font-display text-xl font-extrabold uppercase">{report.headline}</p>
        <p className="text-center text-[11px] text-muted">{report.marketCount} marchés analysés</p>
      </section>

      {/* Lecture du match */}
      <section aria-labelledby="lecture" className="space-y-2">
        <h2 id="lecture" className="font-display text-2xl font-extrabold uppercase">
          Lecture du match
        </h2>
        <ul className="space-y-2">
          {report.insights.map((i) => (
            <li key={i.title} className="flex gap-3 rounded-xl border border-line bg-surface p-3">
              <span className="text-xl leading-none" aria-hidden>
                {i.icon}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-wide text-(--sport)">{i.title}</p>
                <p className="text-sm text-muted">{i.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {report.topPicks.length ? (
        <section aria-labelledby="top" className="space-y-2">
          <h2 id="top" className="font-display text-2xl font-extrabold uppercase">
            Sélections les plus solides
          </h2>
          <ul className="space-y-2">
            {report.topPicks.map((r) => (
              <PickCard key={`${r.ref.period}${r.ref.market}${r.ref.line}${r.ref.selection}`} row={r} variant="top" />
            ))}
          </ul>
        </section>
      ) : null}

      {report.valueBets.length ? (
        <section aria-labelledby="value" className="space-y-2">
          <h2 id="value" className="font-display text-2xl font-extrabold uppercase text-gold">
            Value bets
          </h2>
          <p className="text-xs text-muted">Sélections où notre probabilité dépasse celle de la cote proposée.</p>
          <ul className="space-y-2">
            {report.valueBets.map((r) => (
              <PickCard key={`v${r.ref.period}${r.ref.market}${r.ref.line}${r.ref.selection}`} row={r} variant="value" />
            ))}
          </ul>
        </section>
      ) : null}

      {report.likelyScores.length ? (
        <section aria-labelledby="scores" className="space-y-2">
          <h2 id="scores" className="font-display text-2xl font-extrabold uppercase">
            Scores probables
          </h2>
          <ul className="grid grid-cols-3 gap-2">
            {report.likelyScores.map((s, i) => (
              <li key={s.score} className={cn("rounded-xl border bg-surface p-2.5 text-center", i === 0 ? "border-(--sport)/60" : "border-line")}>
                <p className="scoreboard text-2xl font-extrabold leading-none">{s.score}</p>
                <p className="mt-1 text-xs text-muted">{pct(s.probability)}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Tous les marchés, regroupés comme chez les bookmakers */}
      <section aria-labelledby="marches" className="space-y-2">
        <h2 id="marches" className="font-display text-2xl font-extrabold uppercase">
          Tous les marchés
        </h2>
        <p className="text-xs text-muted">
          Probabilité estimée, cote « juste » correspondante (1 ÷ probabilité) et cote du bookmaker quand elle est connue (en or si
          elle est intéressante).
        </p>
        <div className="space-y-2">
          {report.groups.map((g, i) => (
            <details key={g.id} open={i < 2} className="group overflow-hidden rounded-xl border border-line bg-surface">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-3 [&::-webkit-details-marker]:hidden">
                <span className="font-semibold">{g.title}</span>
                <span className="flex items-center gap-2 text-xs text-muted">
                  ({g.rows.length})
                  <span className="transition-transform group-open:rotate-180" aria-hidden>
                    ▾
                  </span>
                </span>
              </summary>
              <div className="border-t border-line px-3.5 pb-2">
                {g.note ? <p className="pt-2 text-[11px] text-warning">{g.note}</p> : null}
                <ul className="divide-y divide-line/60">
                  {g.rows.map((r) => (
                    <MarketRow key={`${r.ref.period}${r.ref.market}${r.ref.line}${r.ref.selection}`} row={r} />
                  ))}
                </ul>
              </div>
            </details>
          ))}
        </div>
      </section>

      <p className="rounded-xl border border-line bg-surface p-3 text-xs text-muted">
        Probabilités estimées par notre modèle statistique à partir des performances des équipes. Elles ne garantissent aucun
        résultat : ne misez que ce que vous pouvez vous permettre de perdre.
      </p>
    </div>
  );
}
