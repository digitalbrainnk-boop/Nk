"use client";

import type { CSSProperties } from "react";
import { ACTIVE_SPORTS, type SportCode } from "@/lib/sports/catalog";
import { cn } from "@/lib/utils/cn";
import { sportStyle } from "./sport-badge";

/** Onglets de sports défilants (« Tous », ⚽, 🏀, 🏒…). */
export function SportTabs({
  value,
  onChange,
  className,
}: {
  value: SportCode | "all";
  onChange: (value: SportCode | "all") => void;
  className?: string;
}) {
  const items: { code: SportCode | "all"; label: string; emoji: string }[] = [
    { code: "all", label: "Tous", emoji: "🔥" },
    ...ACTIVE_SPORTS.map((s) => ({ code: s.code, label: s.shortName, emoji: s.emoji })),
  ];
  return (
    <div role="tablist" aria-label="Sports" className={cn("-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none", className)}>
      {items.map((item) => {
        const active = value === item.code;
        return (
          <button
            key={item.code}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.code)}
            style={item.code === "all" ? ({ "--sport": "var(--color-gold)" } as CSSProperties) : sportStyle(item.code)}
            className={cn(
              "flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors",
              active
                ? "border-(--sport) bg-(--sport)/15 text-ink shadow-[0_0_18px_-6px_var(--sport)]"
                : "border-line bg-surface text-muted hover:text-ink",
            )}
          >
            <span aria-hidden className="text-base leading-none">
              {item.emoji}
            </span>
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
