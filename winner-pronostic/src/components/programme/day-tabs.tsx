import Link from "next/link";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { cn } from "@/lib/utils/cn";
import { withParams } from "./url";

const weekday = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", timeZone: DEFAULT_TIMEZONE });

/** Aujourd'hui, Demain, puis les 5 jours suivants. */
export function DayTabs({ today, current, params, path = "/" }: { today: string; current: string; params: Record<string, string | undefined>; path?: string }) {
  const start = new Date(`${today}T12:00:00Z`);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start.getTime() + i * 86_400_000);
    const iso = d.toISOString().slice(0, 10);
    return { iso, label: i === 0 ? "Aujourd'hui" : i === 1 ? "Demain" : weekday.format(d).replace(".", "") };
  });
  return (
    <nav aria-label="Jours" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 scrollbar-none">
      {days.map((d) => (
        <Link
          key={d.iso}
          href={withParams(path, params, { jour: d.iso === today ? undefined : d.iso })}
          aria-current={d.iso === current ? "date" : undefined}
          className={cn(
            "flex h-9 shrink-0 items-center rounded-lg px-3 text-sm font-semibold capitalize",
            d.iso === current ? "bg-brand text-brand-ink" : "bg-surface text-muted ring-1 ring-line hover:text-ink",
          )}
        >
          {d.label}
        </Link>
      ))}
    </nav>
  );
}
