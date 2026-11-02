"use client";

import { useState } from "react";
import { ComingSoon } from "@/components/layout/coming-soon";
import { SportTabs } from "@/components/sport/sport-tabs";
import { type SportCode, getSport } from "@/lib/sports/catalog";

/** Programme par sport (les matchs arrivent avec la synchronisation, phase 2). */
export function HomeSports() {
  const [sport, setSport] = useState<SportCode | "all">("all");
  const def = sport === "all" ? null : getSport(sport);
  return (
    <section aria-labelledby="programme" className="space-y-3">
      <div className="flex items-end justify-between">
        <h2 id="programme" className="font-display text-2xl font-extrabold uppercase">
          Programme
        </h2>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Aujourd&apos;hui</span>
      </div>
      <SportTabs value={sport} onChange={setSport} />
      <ComingSoon title={def ? `Matchs de ${def.name.toLowerCase()}` : "Tous les matchs du jour"} emoji={def?.emoji ?? "🏟️"}>
        Programme, scores en direct et cotes de {def ? def.name.toLowerCase() : "tous les sports"} dès la synchronisation des
        données (phase 2).
      </ComingSoon>
    </section>
  );
}
