"use client";

import { useState } from "react";
import { ProbabilityBar } from "@/components/sport/probability-bar";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { type CouponAnalysis, type LegVerdict, MAX_ANALYZED_LEGS, analyzeCoupon } from "@/lib/coupons/analyzer";
import { cn } from "@/lib/utils/cn";

type Row = { id: number; label: string; odd: string };

const VERDICTS: Record<LegVerdict, { label: string; className: string }> = {
  solide: { label: "Solide", className: "bg-brand/15 text-brand" },
  correct: { label: "Correct", className: "bg-info/15 text-info" },
  risque: { label: "Risqué", className: "bg-warning/15 text-warning" },
  a_eviter: { label: "À éviter", className: "bg-danger/15 text-danger" },
};

const COUPON_TONE: Record<CouponAnalysis["verdict"], string> = {
  bon: "border-brand/40 bg-brand/10",
  moyen: "border-gold/40 bg-gold/10",
  faible: "border-warning/40 bg-warning/10",
  tres_faible: "border-danger/40 bg-danger/10",
};

function parseOdd(value: string): number | null {
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) && n > 1 && n <= 1000 ? n : null;
}

let nextId = 3;

/**
 * Analyse d'un coupon : l'utilisateur recopie ses sélections et leurs cotes.
 * Calcul fait directement sur le téléphone (instantané, même hors ligne).
 * Quand les matchs seront synchronisés, les sélections reconnues utiliseront
 * les probabilités de notre modèle.
 */
export function CouponAnalyzer() {
  const [rows, setRows] = useState<Row[]>([
    { id: 1, label: "", odd: "" },
    { id: 2, label: "", odd: "" },
  ]);
  const [submitted, setSubmitted] = useState(false);

  const valid = rows
    .map((r, i) => ({ label: r.label.trim() || `Sélection ${i + 1}`, odd: parseOdd(r.odd) }))
    .filter((r): r is { label: string; odd: number } => r.odd !== null);
  // Calcul instantané (quelques multiplications) : inutile de le mémoriser.
  const analysis = valid.length ? analyzeCoupon(valid) : null;

  function update(id: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  return (
    <div className="space-y-5">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(true);
        }}
      >
        <p className="text-sm text-muted">Recopiez les sélections de votre coupon et leur cote (ex. 1,85).</p>
        <ol className="space-y-2">
          {rows.map((row, i) => (
            <li key={row.id} className="flex items-center gap-2">
              <span className="scoreboard w-5 text-center text-lg font-extrabold text-faint">{i + 1}</span>
              <input
                value={row.label}
                onChange={(e) => update(row.id, { label: e.target.value.slice(0, 80) })}
                placeholder="Match / pari (facultatif)"
                aria-label={`Sélection ${i + 1}`}
                className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3 text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none"
              />
              <input
                value={row.odd}
                onChange={(e) => update(row.id, { odd: e.target.value.replace(/[^\d.,]/g, "").slice(0, 7) })}
                inputMode="decimal"
                placeholder="Cote"
                aria-label={`Cote de la sélection ${i + 1}`}
                className={cn(
                  "scoreboard h-11 w-20 rounded-xl border bg-surface-2 px-2 text-center text-lg font-extrabold text-ink placeholder:font-sans placeholder:text-sm placeholder:font-normal placeholder:text-faint focus:border-brand focus:outline-none",
                  row.odd && parseOdd(row.odd) === null ? "border-danger" : "border-line",
                )}
              />
              <button
                type="button"
                onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== row.id) : rs))}
                aria-label={`Retirer la sélection ${i + 1}`}
                className="grid size-9 shrink-0 place-items-center rounded-lg text-faint hover:bg-surface-2 hover:text-danger"
              >
                ✕
              </button>
            </li>
          ))}
        </ol>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={rows.length >= MAX_ANALYZED_LEGS}
            onClick={() => setRows((rs) => [...rs, { id: nextId++, label: "", odd: "" }])}
          >
            + Ajouter une sélection
          </Button>
        </div>
        <Button type="submit" size="lg" className="w-full font-display text-lg uppercase tracking-wide" disabled={!valid.length}>
          🔍 Analyser mon coupon
        </Button>
      </form>

      {submitted && analysis ? (
        <section className="space-y-3" aria-live="polite">
          <div className={cn("rounded-(--radius-card) border p-4", COUPON_TONE[analysis.verdict])}>
            <div className="flex items-end justify-between gap-3">
              <p className="font-display text-xl font-extrabold uppercase leading-tight">{analysis.headline}</p>
              <div className="shrink-0 text-right">
                <p className="text-[10px] font-bold uppercase text-muted">Cote totale</p>
                <p className="scoreboard text-3xl font-extrabold text-gold">{analysis.totalOdds.toFixed(2)}</p>
              </div>
            </div>
            <ProbabilityBar className="mt-3" value={analysis.estimatedProbability} label="Chance réelle estimée" />
            <p className="mt-2 text-xs text-muted">
              Le bookmaker affiche {Math.round(analysis.impliedProbability * 1000) / 10} % de chances, marge incluse. La chance réelle est
              plus faible car chaque sélection contient sa marge.
            </p>
          </div>

          <ol className="space-y-2">
            {analysis.legs.map((leg, i) => (
              <li
                key={i}
                className={cn(
                  "flex items-start gap-3 rounded-xl border bg-surface p-3",
                  i === analysis.weakestIndex && analysis.legs.length > 1 ? "border-danger/50" : "border-line",
                )}
              >
                <span className="scoreboard w-5 pt-0.5 text-center text-lg font-extrabold text-faint">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold">{leg.label}</p>
                    <span className="scoreboard text-lg font-extrabold">{leg.odd.toFixed(2)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-bold", VERDICTS[leg.verdict].className)}>
                      {VERDICTS[leg.verdict].label}
                    </span>
                    {i === analysis.weakestIndex && analysis.legs.length > 1 ? (
                      <span className="text-[11px] font-semibold text-danger">Maillon le plus faible</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-muted">{leg.reason}</p>
                </div>
              </li>
            ))}
          </ol>

          {analysis.suggestions.length ? (
            <div className="rounded-xl border border-line bg-surface-2 p-3">
              <p className="text-sm font-bold">💡 Pour augmenter vos chances</p>
              <ul className="mt-1.5 space-y-1 text-sm text-muted">
                {analysis.suggestions.map((s) => (
                  <li key={s.removeIndex}>
                    Sans « {s.label} » : cote <strong className="text-ink">{s.newOdds.toFixed(2)}</strong>, chance{" "}
                    <strong className="text-ink">{Math.round(s.newProbability * 100)} %</strong>.
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {analysis.warnings.map((w) => (
            <Alert key={w} tone="warning">
              {w}
            </Alert>
          ))}
        </section>
      ) : null}
    </div>
  );
}
