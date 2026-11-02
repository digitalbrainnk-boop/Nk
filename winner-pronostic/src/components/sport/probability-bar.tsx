import { cn } from "@/lib/utils/cn";

/** Barre de probabilité avec pourcentage. */
export function ProbabilityBar({ value, label, className }: { value: number; label?: string; className?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const color = pct >= 65 ? "bg-brand" : pct >= 40 ? "bg-gold" : pct >= 20 ? "bg-warning" : "bg-danger";
  return (
    <div className={cn("space-y-1", className)}>
      {label ? (
        <div className="flex justify-between text-xs text-muted">
          <span>{label}</span>
          <span className="scoreboard text-sm font-extrabold text-ink">{pct} %</span>
        </div>
      ) : null}
      <div className="h-2 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
    </div>
  );
}
