"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { type ApiStatus, runSync, testApi } from "@/lib/admin/actions";
import type { StepReport } from "@/lib/sync/run";
import { cn } from "@/lib/utils/cn";

const LABELS: Record<string, string> = {
  seasons: "Saisons (historique)",
  schedule: "Programme",
  standings: "Classements",
  odds: "Cotes",
  live: "Direct",
  predictions: "Calcul des pronostics",
  publish: "Publication",
  settle: "Résultats",
  notify: "Notifications",
  maintenance: "Maintenance",
};

export function SyncPanel() {
  const [state, action] = useActionState<{ reports: StepReport[] } | null, FormData>(runSync, null);
  const [api, setApi] = useState<ApiStatus[] | null>(null);
  const [testing, startTest] = useTransition();
  return (
    <div className="space-y-4">
      <form action={action} className="space-y-3 rounded-xl border border-line bg-surface p-3">
        <p className="text-sm font-semibold">Lancer maintenant</p>
        <div className="grid grid-cols-2 gap-1.5 text-sm">
          {Object.entries(LABELS).map(([step, label]) => (
            <label key={step} className="flex items-center gap-2">
              <input type="checkbox" name="steps" value={step} defaultChecked={["schedule", "predictions", "publish", "settle"].includes(step)} />
              {label}
            </label>
          ))}
        </div>
        <SubmitButton pendingLabel="Synchronisation en cours (jusqu'à 4 min)…">🔄 Lancer</SubmitButton>
      </form>
      {state?.reports.length ? (
        <ul className="divide-y divide-line/60 rounded-xl border border-line bg-surface text-sm">
          {state.reports.map((r) => (
            <li key={r.step} className="flex items-center justify-between gap-2 px-3 py-2">
              <span>{LABELS[r.step] ?? r.step}</span>
              <span className={cn("text-right text-xs", r.status === "success" ? "text-brand" : r.status === "error" ? "text-danger" : "text-muted")}>
                {r.status === "success" ? `✓ ${r.items} élément(s), ${r.apiRequests} requête(s), ${Math.round(r.ms / 100) / 10} s` : `${r.status === "error" ? "✗" : "—"} ${r.message ?? ""}`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="space-y-2">
        <Button variant="secondary" size="sm" disabled={testing} onClick={() => startTest(async () => setApi(await testApi()))}>
          {testing ? "Test en cours…" : "🔑 Tester la clé API-Sports"}
        </Button>
        {api ? (
          <ul className="space-y-1 text-xs">
            {api.map((a) => (
              <li key={a.sport} className={a.ok ? "text-brand" : "text-danger"}>
                {a.ok ? "✓" : "✗"} {a.sport} : {a.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
