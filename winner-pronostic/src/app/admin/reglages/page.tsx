import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/admin/action-form";
import { PageHeader } from "@/components/layout/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { updateSettings } from "@/lib/admin/actions";
import { requireAdmin } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Réglages · Admin", robots: { index: false } };

const FIELDS: { key: string; label: string; type: "number" | "bool" | "list" }[] = [
  { key: "free_picks_per_day", label: "Pronostics gratuits par jour", type: "number" },
  { key: "free_coupons_per_day", label: "Codes générés par jour (gratuit)", type: "number" },
  { key: "max_published_picks_per_day", label: "Pronostics publiés par jour (maximum)", type: "number" },
  { key: "sync_days_ahead", label: "Jours de programme synchronisés", type: "number" },
  { key: "live_sync_seconds", label: "Intervalle de mise à jour du direct (secondes)", type: "number" },
  { key: "ads_enabled", label: "Publicité pour les comptes gratuits", type: "bool" },
  { key: "odds_bookmakers", label: "Bookmakers suivis (séparés par des virgules)", type: "list" },
];

async function Content() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data: settings }, { data: plans }] = await Promise.all([
    supabase.from("app_settings").select("key, value"),
    supabase.from("plans").select("code, name, price_xof, duration_days, is_active").order("display_order"),
  ]);
  const value = (key: string) => settings?.find((s) => s.key === key)?.value;
  const input = "mt-1 block h-10 w-full rounded-lg border border-line bg-surface-2 px-3 text-sm";
  return (
    <ActionForm action={updateSettings} className="space-y-5">
      <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
        <h2 className="font-display text-xl font-extrabold uppercase">Application</h2>
        {FIELDS.map((f) => (
          <label key={f.key} className="block text-sm">
            {f.label}
            {f.type === "bool" ? (
              <select name={f.key} defaultValue={String(value(f.key) ?? true)} className={input}>
                <option value="true">Oui</option>
                <option value="false">Non</option>
              </select>
            ) : (
              <input
                name={f.key}
                type={f.type === "number" ? "number" : "text"}
                defaultValue={f.type === "list" ? ((value(f.key) as string[] | undefined) ?? []).join(", ") : String(value(f.key) ?? "")}
                className={input}
              />
            )}
          </label>
        ))}
      </section>
      <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
        <h2 className="font-display text-xl font-extrabold uppercase">Offres Premium</h2>
        {(plans ?? []).map((p) => (
          <div key={p.code} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="plan_code" value={p.code} />
            <label className="min-w-0 flex-1 text-sm">
              {p.name} ({p.duration_days} jours) — prix en F CFA
              <input name={`price_${p.code}`} type="number" min={100} step={5} defaultValue={p.price_xof} className={input} />
            </label>
            <label className="flex h-10 items-center gap-2 text-sm">
              <input type="checkbox" name={`active_${p.code}`} defaultChecked={p.is_active} /> Active
            </label>
          </div>
        ))}
      </section>
      <SubmitButton pendingLabel="Enregistrement…">Enregistrer</SubmitButton>
    </ActionForm>
  );
}

export default function AdminSettingsPage() {
  return (
    <>
      <PageHeader kicker="Admin" title="Réglages" />
      <Suspense fallback={<div className="h-40 animate-pulse rounded-(--radius-card) bg-surface" aria-hidden />}>
        <Content />
      </Suspense>
    </>
  );
}
