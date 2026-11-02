import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Administration", robots: { index: false, follow: false } };

async function AdminOverview() {
  await requireAdmin();
  const supabase = await createClient();

  // Ces lectures passent par la RLS : seules les politiques « admin » les autorisent.
  const nowIso = new Date().toISOString();
  const [users, premium, competitions] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "active").gt("ends_at", nowIso),
    supabase.from("competitions").select("id", { count: "exact", head: true }).eq("is_enabled", true),
  ]);

  const stats = [
    { label: "Utilisateurs", value: users.count ?? 0 },
    { label: "Abonnés premium", value: premium.count ?? 0 },
    { label: "Compétitions affichées", value: competitions.count ?? 0 },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {stats.map((s) => (
          <Card key={s.label} className="p-3 text-center">
            <p className="text-2xl font-black tabular-nums">{s.value}</p>
            <p className="mt-0.5 text-[11px] leading-tight text-muted">{s.label}</p>
          </Card>
        ))}
      </div>
      <Card className="text-sm text-muted">
        Le tableau de bord complet (revenus, gestion des compétitions, coupons mis en avant) sera livré en phase 7.
      </Card>
    </div>
  );
}

export default function AdminPage() {
  return (
    <>
      <PageHeader title="Administration" subtitle="Réservé aux administrateurs." />
      <Suspense fallback={<div className="h-24 animate-pulse rounded-(--radius-card) bg-surface" aria-hidden />}>
        <AdminOverview />
      </Suspense>
    </>
  );
}
