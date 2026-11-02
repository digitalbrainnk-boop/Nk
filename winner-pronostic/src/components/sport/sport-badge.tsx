import type { CSSProperties } from "react";
import { type SportCode, getSport } from "@/lib/sports/catalog";
import { cn } from "@/lib/utils/cn";

/** Style CSS qui expose la couleur du sport dans --sport. */
export function sportStyle(sport: SportCode): CSSProperties {
  return { "--sport": `var(${getSport(sport).colorVar})` } as CSSProperties;
}

export function SportBadge({ sport, short = false, className }: { sport: SportCode; short?: boolean; className?: string }) {
  const def = getSport(sport);
  return (
    <span
      style={sportStyle(sport)}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-(--sport)/35 bg-(--sport)/12 px-2 py-0.5 text-[11px] font-semibold text-(--sport)",
        className,
      )}
    >
      <span aria-hidden>{def.emoji}</span>
      {short ? def.shortName : def.name}
    </span>
  );
}
