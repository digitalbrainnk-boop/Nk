import Link from "next/link";
import { ConfidenceMeter } from "@/components/sport/confidence-meter";
import { ProbabilityBar } from "@/components/sport/probability-bar";
import { sportStyle } from "@/components/sport/sport-badge";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import type { PickView } from "@/lib/data/picks";
import { getSport } from "@/lib/sports/catalog";
import { cn } from "@/lib/utils/cn";

const when = new Intl.DateTimeFormat("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: DEFAULT_TIMEZONE });
const RESULT = {
  won: { label: "Gagné", className: "bg-brand/15 text-brand", icon: "✓" },
  lost: { label: "Perdu", className: "bg-danger/15 text-danger", icon: "✗" },
  void: { label: "Remboursé", className: "bg-surface-3 text-muted", icon: "↺" },
  pending: { label: "En attente", className: "bg-info/15 text-info", icon: "⏳" },
} as const;

export function PickCard({ pick }: { pick: PickView }) {
  const result = RESULT[pick.result];
  return (
    <Link href={`/match/${pick.eventId}`} style={sportStyle(pick.sport)} className="block rounded-(--radius-card) border border-line bg-surface p-3.5 hover:border-(--sport)/50">
      <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-wide text-muted">
        <span className="truncate">
          {getSport(pick.sport).emoji} {pick.competition} · {when.format(new Date(pick.startsAt))}
        </span>
        <span className="flex shrink-0 gap-1">
          {pick.isValue ? <span className="rounded bg-gold/15 px-1.5 py-0.5 font-bold text-gold">Value</span> : null}
          {!pick.isPremium ? <span className="rounded bg-brand/15 px-1.5 py-0.5 font-bold text-brand">Gratuit</span> : null}
          {pick.result !== "pending" ? <span className={cn("rounded px-1.5 py-0.5 font-bold", result.className)}>{result.icon} {result.label}</span> : null}
        </span>
      </div>
      <p className="mt-1 truncate font-semibold">
        {pick.home} – {pick.away}
        {pick.score ? <span className="scoreboard ml-2 text-muted">{pick.score}</span> : null}
      </p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold leading-snug text-(--sport)">{pick.label}</p>
          <p className="text-[11px] text-faint">{pick.notation}</p>
        </div>
        <div className="shrink-0 text-right">
          {pick.odd ? <p className="scoreboard text-2xl font-extrabold leading-none">{pick.odd.toFixed(2)}</p> : null}
          <p className="mt-1 flex items-center justify-end gap-1.5 text-[11px] text-muted">
            Confiance <ConfidenceMeter value={pick.confidence} />
          </p>
        </div>
      </div>
      <ProbabilityBar className="mt-2" value={pick.probability} />
    </Link>
  );
}
