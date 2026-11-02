import { cn } from "@/lib/utils/cn";

export function StatTile({
  label,
  value,
  hint,
  accent = "brand",
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: "brand" | "gold" | "info" | "live";
  icon: string;
}) {
  const ring = { brand: "from-brand/25", gold: "from-gold/25", info: "from-info/25", live: "from-live/25" }[accent];
  const text = { brand: "text-brand", gold: "text-gold", info: "text-info", live: "text-live" }[accent];
  return (
    <div className={cn("relative overflow-hidden rounded-(--radius-card) border border-line bg-gradient-to-br to-surface p-3.5", ring)}>
      <span className="absolute right-2.5 top-2 text-xl opacity-80" aria-hidden>
        {icon}
      </span>
      <p className="pr-7 text-[10px] font-bold uppercase tracking-wider text-muted">{label}</p>
      <p className={cn("scoreboard mt-1 text-3xl font-extrabold leading-none", text)}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-faint">{hint}</p> : null}
    </div>
  );
}
