"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import { useLocationPart } from "@/lib/utils/use-location";
import { CouponAnalyzer } from "./coupon-analyzer";
import { GeneratorForm } from "./generator-form";

type Tab = "generer" | "analyser";

/** Onglets « Générer un code » / « Analyser un coupon » (#analyser dans l'URL ouvre l'analyse). */
export function CouponsTabs() {
  const hash = useLocationPart("hash");
  const [chosen, setTab] = useState<Tab | null>(null);
  const tab: Tab = chosen ?? (hash === "#analyser" ? "analyser" : "generer");

  const tabs: { id: Tab; label: string; emoji: string }[] = [
    { id: "generer", label: "Générer un code", emoji: "⚡" },
    { id: "analyser", label: "Analyser un coupon", emoji: "🔍" },
  ];

  return (
    <div>
      <div role="tablist" aria-label="Outils coupons" className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              setTab(t.id);
              history.replaceState(null, "", t.id === "analyser" ? "#analyser" : location.pathname + location.search);
            }}
            className={cn(
              "flex h-11 items-center justify-center gap-1.5 rounded-lg font-display text-[15px] font-extrabold uppercase tracking-wide transition-colors",
              tab === t.id ? "bg-brand text-brand-ink" : "text-muted hover:text-ink",
            )}
          >
            <span aria-hidden>{t.emoji}</span>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{tab === "generer" ? <GeneratorForm /> : <CouponAnalyzer />}</div>
    </div>
  );
}
