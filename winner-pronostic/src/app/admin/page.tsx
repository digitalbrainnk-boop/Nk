import type { Metadata } from "next";
import { Suspense } from "react";
import { StatTile } from "@/components/admin/stat-tile";
import { PageHeader } from "@/components/layout/page-header";
import { sportStyle } from "@/components/sport/sport-badge";
import { requireAdmin } from "@/lib/auth/dal";
import { isSportCode } from "@/lib/sports/catalog";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Administration", robots: { index: false, follow: false } };

const xof = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

async function AdminDashboard() {
  await requireAdmin();
  const supabase = await createClient();

  // Ces lectures passent par la RLS : seules les politiques « admin » les autorisent.
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();

  const [users, premium, revenue, coupons, sports, competitions] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "active").gt("ends_at", now.toISOString()),
    supabase.from("payments").select("amount_xof").eq("status", "succeeded").gte("paid_at", monthStart).limit(10000),
    supabase.from("coupons").select("id", { count: "exact", head: true }).gte("created_at", dayStart),
    supabase.from("sports").select("code, name, emoji, is_enabled").order("display_order"),
    supabase.from("competitions").select("sport").eq("is_enabled", true).limit(5000),
  ]);

  const revenueTotal = (revenue.data ?? []).reduce((sum, p) => sum + p.amount_xof, 0);
  const competitionsBySport = new Map<string, number>();
  for (const c of competitions.data ?? []) competitionsBySport.set(c.sport, (competitionsBySport.get(c.sport) ?? 0) + 1);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-2">
        <StatTile icon="👥" label="Utilisateurs" value={xof.format(users.count ?? 0)} />
        <StatTile icon="👑" label="Abonnés premium" value={xof.format(premium.count ?? 0)} accent="gold" />
        <StatTile icon="💰" label="Revenus du mois" value={`${xof.format(revenueTotal)} F`} hint="Paiements Mobile Money confirmés" accent="info" />
        <StatTile icon="🎟️" label="Coupons du jour" value={xof.format(coupons.count ?? 0)} accent="live" />
      </div>

      <section className="space-y-2">
        <h2 className="font-display text-xl font-extrabold uppercase">Sports et compétitions</h2>
        <ul className="grid grid-cols-2 gap-2">
          {(sports.data ?? []).map((s) => (
            <li
              key={s.code}
              style={isSportCode(s.code) ? sportStyle(s.code) : undefined}
              className={cn(
                "flex items-center justify-between rounded-xl border bg-surface px-3 py-2.5",
                s.is_enabled ? "border-(--sport)/40" : "border-line opacity-60",
              )}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <span aria-hidden>{s.emoji}</span>
                {s.name}
              </span>
              <span className="scoreboard text-lg font-extrabold text-(--sport)">{competitionsBySport.get(s.code) ?? 0}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">Nombre de compétitions affichées par sport. La gestion complète arrive en phase 7.</p>
      </section>

      <section className="rounded-(--radius-card) border border-dashed border-line bg-surface p-4 text-sm text-muted">
        <p className="font-semibold text-ink">À venir dans l&apos;espace admin</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li>Activer/désactiver sports et compétitions</li>
          <li>Publier le « coupon du jour » et y ajouter le code de chargement 1xBet</li>
          <li>Suivi des abonnements, paiements et taux de réussite</li>
        </ul>
      </section>
    </div>
  );
}

export default function AdminPage() {
  return (
    <>
      <PageHeader kicker="Back-office" title="Tableau de bord" subtitle="Réservé aux administrateurs." />
      <Suspense fallback={<div className="h-48 animate-pulse rounded-(--radius-card) bg-surface" aria-hidden />}>
        <AdminDashboard />
      </Suspense>
    </>
  );
}
