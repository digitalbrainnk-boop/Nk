import Link from "next/link";
import type { CSSProperties } from "react";
import { sportStyle } from "@/components/sport/sport-badge";
import { ACTIVE_SPORTS, type SportCode } from "@/lib/sports/catalog";
import { cn } from "@/lib/utils/cn";
import { withParams } from "./url";

/** Onglets de sports sous forme de liens (fonctionnent sans JavaScript). */
export function SportLinks({ current, params, path = "/" }: { current?: SportCode; params: Record<string, string | undefined>; path?: string }) {
  const items: { code?: SportCode; label: string; emoji: string }[] = [
    { label: "Tous", emoji: "🔥" },
    ...ACTIVE_SPORTS.map((s) => ({ code: s.code, label: s.shortName, emoji: s.emoji })),
  ];
  return (
    <nav aria-label="Sports" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none">
      {items.map((item) => {
        const active = item.code === current;
        return (
          <Link
            key={item.label}
            href={withParams(path, params, { sport: item.code, competition: undefined, pays: undefined })}
            aria-current={active ? "page" : undefined}
            style={item.code ? sportStyle(item.code) : ({ "--sport": "var(--color-gold)" } as CSSProperties)}
            className={cn(
              "flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors",
              active ? "border-(--sport) bg-(--sport)/15 text-ink shadow-[0_0_18px_-6px_var(--sport)]" : "border-line bg-surface text-muted hover:text-ink",
            )}
          >
            <span aria-hidden className="text-base leading-none">
              {item.emoji}
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
