import type { Metadata } from "next";
import { Suspense } from "react";
import { SyncPanel } from "@/components/admin/sync-panel";
import { PageHeader } from "@/components/layout/page-header";
import { requireAdmin } from "@/lib/auth/dal";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { hasServerEnv } from "@/lib/env.server";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Synchronisation · Admin", robots: { index: false } };
export const maxDuration = 300;

const when = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "medium", timeZone: DEFAULT_TIMEZONE });

async function Content() {
  await requireAdmin();
  const supabase = await createClient();
  const { data: runs } = await supabase.from("sync_runs").select("id, job, status, api_requests, items_upserted, error, started_at, finished_at").order("started_at", { ascending: false }).limit(40);
  const config = [
    { label: "Clé API-Sports (API_SPORTS_KEY)", ok: hasServerEnv("API_SPORTS_KEY") },
    { label: "Secret des tâches planifiées (CRON_SECRET)", ok: hasServerEnv("CRON_SECRET") },
    { label: "Clé secrète Supabase (SUPABASE_SECRET_KEY)", ok: hasServerEnv("SUPABASE_SECRET_KEY") },
    { label: "CinetPay (CINETPAY_API_KEY + SITE_ID)", ok: hasServerEnv("CINETPAY_API_KEY") && hasServerEnv("CINETPAY_SITE_ID") },
    { label: "Notifications (clés VAPID)", ok: hasServerEnv("VAPID_PRIVATE_KEY") && Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) },
  ];
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h2 className="font-display text-xl font-extrabold uppercase">Configuration</h2>
        <ul className="space-y-1 rounded-xl border border-line bg-surface p-3 text-sm">
          {config.map((c) => (
            <li key={c.label} className={c.ok ? "text-brand" : "text-warning"}>
              {c.ok ? "✓" : "⚠"} {c.label}
            </li>
          ))}
        </ul>
      </section>
      <SyncPanel />
      <section className="space-y-2">
        <h2 className="font-display text-xl font-extrabold uppercase">Journal</h2>
        <ul className="divide-y divide-line/60 rounded-xl border border-line bg-surface text-xs">
          {(runs ?? []).map((r) => (
            <li key={r.id} className="px-3 py-2">
              <div className="flex justify-between gap-2">
                <span className="font-semibold">{r.job}</span>
                <span className={cn(r.status === "success" ? "text-brand" : r.status === "error" ? "text-danger" : "text-info")}>{r.status}</span>
              </div>
              <p className="text-muted">
                {when.format(new Date(r.started_at))} · {r.items_upserted} élément(s) · {r.api_requests} requête(s)
              </p>
              {r.error ? <p className="mt-0.5 break-words text-danger">{r.error}</p> : null}
            </li>
          ))}
        </ul>
        {!runs?.length ? <p className="text-sm text-muted">Aucune synchronisation pour l&apos;instant.</p> : null}
      </section>
    </div>
  );
}

export default function AdminSyncPage() {
  return (
    <>
      <PageHeader kicker="Admin" title="Synchronisation" />
      <Suspense fallback={<div className="h-40 animate-pulse rounded-(--radius-card) bg-surface" aria-hidden />}>
        <Content />
      </Suspense>
    </>
  );
}
