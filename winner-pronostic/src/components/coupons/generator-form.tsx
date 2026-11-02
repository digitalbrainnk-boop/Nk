"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { sportStyle } from "@/components/sport/sport-badge";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { generateCouponAction } from "@/lib/coupons/actions";
import { RISK_RULES, type RiskLevel } from "@/lib/coupons/generator";
import { type CouponPeriod, PERIOD_LABELS } from "@/lib/coupons/period";
import { initialGenerateState } from "@/lib/coupons/types";
import { ACTIVE_SPORTS } from "@/lib/sports/catalog";
import { cn } from "@/lib/utils/cn";
import { useLocationPart } from "@/lib/utils/use-location";
import { CouponTicket } from "./coupon-ticket";

const TARGETS = [2, 3, 5, 10, 20, 50];

function Segmented<T extends string>({
  name,
  options,
  value,
  onChange,
}: {
  name: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid gap-1 rounded-xl bg-surface-2 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <label
          key={o.value}
          className={cn(
            "flex h-10 cursor-pointer items-center justify-center rounded-lg text-sm font-semibold transition-colors",
            value === o.value ? "bg-surface-3 text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink",
          )}
        >
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
          {o.label}
        </label>
      ))}
    </div>
  );
}

/** Formulaire « Je veux un code de X » + affichage du coupon généré. */
export function GeneratorForm() {
  const [state, action] = useActionState(generateCouponAction, initialGenerateState);
  const search = useLocationPart("search");
  const [chosenTarget, setTarget] = useState<string | null>(null);
  // Lien direct depuis l'accueil : /coupons?cote=10
  const fromUrl = new URLSearchParams(search).get("cote");
  const target = chosenTarget ?? (fromUrl && /^\d{1,4}([.,]\d{1,2})?$/.test(fromUrl) ? fromUrl : "5");
  const [risk, setRisk] = useState<RiskLevel>("equilibre");
  const [period, setPeriod] = useState<CouponPeriod>("jour");

  const exclude = state.status === "ok" ? state.legs.map((l) => l.key).join(",") : "";

  return (
    <div className="space-y-5">
      <form action={action} className="space-y-5">
        <fieldset className="space-y-2">
          <legend className="text-sm font-bold">Je veux un code de…</legend>
          <div className="grid grid-cols-6 gap-1.5">
            {TARGETS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTarget(String(t))}
                className={cn(
                  "scoreboard h-12 rounded-xl border text-xl font-extrabold transition-colors",
                  target === String(t) ? "border-gold bg-gold/15 text-gold shadow-[0_0_20px_-8px_var(--color-gold)]" : "border-line bg-surface-2 text-ink",
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-muted">
            Autre cote :
            <input
              name="targetOdds"
              inputMode="decimal"
              value={target}
              onChange={(e) => setTarget(e.target.value.replace(/[^\d.,]/g, "").slice(0, 7))}
              className="scoreboard h-10 w-24 rounded-lg border border-line bg-surface-2 px-2 text-center text-lg font-extrabold text-ink focus:border-brand focus:outline-none"
              aria-label="Cote totale visée"
            />
          </label>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-bold">Niveau de risque</legend>
          <Segmented
            name="risk"
            value={risk}
            onChange={setRisk}
            options={(Object.keys(RISK_RULES) as RiskLevel[]).map((r) => ({ value: r, label: RISK_RULES[r].label }))}
          />
          <p className="text-xs text-muted">{RISK_RULES[risk].description}</p>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-bold">Période</legend>
          <Segmented
            name="period"
            value={period}
            onChange={setPeriod}
            options={(Object.keys(PERIOD_LABELS) as CouponPeriod[]).map((p) => ({ value: p, label: PERIOD_LABELS[p].label }))}
          />
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-bold">
            Sports <span className="font-normal text-muted">(aucun coché = tous mélangés)</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {ACTIVE_SPORTS.map((s) => (
              <label key={s.code} style={sportStyle(s.code)} className="cursor-pointer">
                <input type="checkbox" name="sports" value={s.code} className="peer sr-only" />
                <span className="flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-sm font-semibold text-muted transition-colors peer-checked:border-(--sport) peer-checked:bg-(--sport)/15 peer-checked:text-ink peer-focus-visible:outline-2 peer-focus-visible:outline-brand">
                  <span aria-hidden>{s.emoji}</span>
                  {s.shortName}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <SubmitButton size="lg" className="w-full font-display text-lg uppercase tracking-wide" pendingLabel="Analyse des matchs…">
          ⚡ Générer mon code de {target || "…"}
        </SubmitButton>
      </form>

      {state.status === "login_required" ? (
        <Alert tone="info">
          {state.message}{" "}
          <Link href="/connexion?suivant=/coupons" className="font-semibold underline">
            Se connecter
          </Link>
        </Alert>
      ) : null}
      {state.status === "quota" ? (
        <Alert tone="warning">
          {state.message}{" "}
          <Link href="/compte" className="font-semibold underline">
            Voir les offres
          </Link>
        </Alert>
      ) : null}
      {state.status === "empty" ? <Alert tone="info">{state.message}</Alert> : null}
      {state.status === "error" ? <Alert tone="error">{state.message}</Alert> : null}

      {state.status === "ok" ? (
        <CouponTicket
          title={`Code de ${state.params.targetOdds.toLocaleString("fr-FR")}`}
          legs={state.legs}
          totalOdds={state.totalOdds}
          probability={state.probability}
          footer={
            <form action={action}>
              <input type="hidden" name="targetOdds" value={state.params.targetOdds} />
              <input type="hidden" name="risk" value={state.params.risk} />
              <input type="hidden" name="period" value={state.params.period} />
              {state.params.sports.map((s) => (
                <input key={s} type="hidden" name="sports" value={s} />
              ))}
              <input type="hidden" name="exclude" value={exclude} />
              <button type="submit" className={buttonClasses("ghost", "sm", "w-full")}>
                🔄 Proposer un autre code
              </button>
            </form>
          }
        />
      ) : null}
    </div>
  );
}
