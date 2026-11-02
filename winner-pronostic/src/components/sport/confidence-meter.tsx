import { cn } from "@/lib/utils/cn";

/** Indice de confiance de 1 à 5, en barres façon « réseau ». */
export function ConfidenceMeter({ value, className }: { value: number; className?: string }) {
  const level = Math.max(0, Math.min(5, Math.round(value)));
  const color = level >= 4 ? "bg-brand" : level === 3 ? "bg-gold" : "bg-warning";
  return (
    <span className={cn("inline-flex items-end gap-[3px]", className)} role="img" aria-label={`Confiance ${level} sur 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cn("w-[4px] rounded-sm", i <= level ? color : "bg-line")} style={{ height: 4 + i * 2.4 }} />
      ))}
    </span>
  );
}
