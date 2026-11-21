import type { Metadata } from "next";
import { Suspense } from "react";
import { StatTile } from "@/components/admin/stat-tile";
import { ComingSoon } from "@/components/layout/coming-soon";
import { PageHeader } from "@/components/layout/page-header";
import { PickCard } from "@/components/picks/pick-card";
import { settledPicks, successStats } from "@/lib/data/picks";
import { MARKET_INFO, type Market } from "@/lib/predictions/markets";
import { getSport, isSportCode } from "@/lib/sports/catalog";

export const metadata: Metadata = {
  title: "Historique et taux de réussite",
  description: "Tous les pronostics publiés et leur résultat réel, par sport, marché et compétition.",
};

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(Number(x) * 100)} %`);

function StatTable({ title, rows, labelOf }: { title: string; rows: { key: string; settled: number; won: number; win_rate: number | null; roi: number | null }[]; labelOf: (key: string) => string }) {
  if (!rows.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="font-display text-xl font-extrabold uppercase">{title}</h2>
      <div className="overflow-hidden rounded-xl border border-line bg-surface text-sm">
        {rows.map((r) => (
          <div key={r.key} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-line/50 px-3 py-2 last:border-0">
            <span className="truncate">{labelOf(r.key)}</span>
            <span className="text-xs text-muted">
              {r.won}/{r.settled}
            </span>
            <span className="scoreboard w-14 text-right text-lg font-extrabold text-brand">{pct(r.win_rate)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

async function HistoryContent() {
  const [stats, recent] = await Promise.all([successStats(), settledPicks(40)]);
  const global = stats.find((s) => s.level === "global");
  if (!global || !global.settled) {
    return (
      <ComingSoon title="Historique en construction" emoji="📊">
        Les résultats s&apos;afficheront ici dès que les premiers pronostics publiés seront terminés. Rien n&apos;est effacé : chaque
        pronostic publié est figé et son résultat est enregistré.
      </ComingSoon>
    );
  }
  const bySport = stats.filter((s) => s.level === "sport").map((s) => ({ key: s.sport ?? "", settled: Number(s.settled), won: Number(s.won), win_rate: s.win_rate, roi: s.roi }));
  const byMarket = stats
    .filter((s) => s.level === "market" && Number(s.settled) > 0)
    .map((s) => ({ key: `${s.sport}|${s.market}`, settled: Number(s.settled), won: Number(s.won), win_rate: s.win_rate, roi: s.roi }))
    .sort((a, b) => b.settled - a.settled)
    .slice(0, 15);
  const byCompetition = stats
    .filter((s) => s.level === "competition" && Number(s.settled) > 0)
    .map((s) => ({ key: s.competition ?? "", settled: Number(s.settled), won: Number(s.won), win_rate: s.win_rate, roi: s.roi }))
    .sort((a, b) => b.settled - a.settled)
    .slice(0, 15);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-2">
        <StatTile icon="🎯" label="Taux de réussite" value={pct(global.win_rate)} hint={`${global.won} gagnés sur ${global.settled}`} />
        <StatTile icon="📈" label="Rendement théorique" value={global.roi === null ? "—" : `${Number(global.roi) >= 0 ? "+" : ""}${Math.round(Number(global.roi) * 100)} %`} hint="1 unité misée par pronostic" accent="gold" />
        <StatTile icon="💰" label="Cote moyenne" value={global.avg_odd ? Number(global.avg_odd).toFixed(2) : "—"} accent="info" />
        <StatTile icon="↺" label="Remboursés" value={String(global.void ?? 0)} accent="live" />
      </div>
      <StatTable title="Par sport" rows={bySport} labelOf={(k) => (isSportCode(k) ? `${getSport(k).emoji} ${getSport(k).name}` : k)} />
      <StatTable
        title="Par marché"
        rows={byMarket}
        labelOf={(k) => {
          const [sport, market] = k.split("|");
          return `${isSportCode(sport) ? getSport(sport).emoji : ""} ${MARKET_INFO[market as Market]?.label ?? market}`;
        }}
      />
      <StatTable title="Par compétition" rows={byCompetition} labelOf={(k) => k} />
      <section className="space-y-2">
        <h2 className="font-display text-xl font-extrabold uppercase">Derniers résultats</h2>
        <div className="space-y-2.5">
          {recent.map((p) => (
            <PickCard key={p.id} pick={p} />
          ))}
        </div>
      </section>
      <p className="text-xs text-muted">
        Les taux passés ne garantissent pas les résultats futurs. Les pronostics premium deviennent publics dès la fin du match.
      </p>
    </div>
  );
}

export default function HistoryPage() {
  return (
    <>
      <PageHeader kicker="Transparence" title="Historique" subtitle="Tous nos pronostics publiés et leur résultat réel." />
      <Suspense fallback={<div className="h-40 animate-pulse rounded-(--radius-card) bg-surface" aria-hidden />}>
        <HistoryContent />
      </Suspense>
    </>
  );
}
