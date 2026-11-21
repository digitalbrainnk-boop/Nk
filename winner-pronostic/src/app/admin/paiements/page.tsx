import type { Metadata } from "next";
import { Suspense } from "react";
import { StatTile } from "@/components/admin/stat-tile";
import { PageHeader } from "@/components/layout/page-header";
import { recheckPayment } from "@/lib/admin/actions";
import { requireAdmin } from "@/lib/auth/dal";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Paiements · Admin", robots: { index: false } };

const when = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: DEFAULT_TIMEZONE });
const xof = new Intl.NumberFormat("fr-FR");
const STATUS = {
  succeeded: { label: "Payé", className: "text-brand" },
  pending: { label: "En attente", className: "text-info" },
  failed: { label: "Échoué", className: "text-danger" },
  cancelled: { label: "Annulé", className: "text-muted" },
  refunded: { label: "Remboursé", className: "text-warning" },
} as const;

async function Content() {
  await requireAdmin();
  const supabase = await createClient();
  const { data: payments } = await supabase
    .from("payments")
    .select("id, user_id, provider_transaction_id, plan_code, amount_xof, status, operator, created_at, paid_at")
    .order("created_at", { ascending: false })
    .limit(100);
  // payments.user_id pointe vers auth.users : les noms viennent des profils
  const userIds = [...new Set((payments ?? []).map((p) => p.user_id).filter((x): x is string => Boolean(x)))];
  const { data: profiles } = userIds.length ? await supabase.from("profiles").select("id, display_name").in("id", userIds) : { data: [] };
  const names = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));
  const rows = (payments ?? []).map((p) => ({ ...p, status: p.status as keyof typeof STATUS, user: p.user_id && names.has(p.user_id) ? { display_name: names.get(p.user_id)! } : null }));
  const paid = rows.filter((p) => p.status === "succeeded");
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <StatTile icon="💰" label="Encaissé (100 derniers)" value={`${xof.format(paid.reduce((s, p) => s + p.amount_xof, 0))} F`} />
        <StatTile icon="⏳" label="En attente" value={String(rows.filter((p) => p.status === "pending").length)} accent="info" />
      </div>
      <ul className="divide-y divide-line/60 rounded-xl border border-line bg-surface text-sm">
        {rows.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="min-w-0">
              <span className="block truncate font-semibold">{p.user?.display_name ?? "Compte supprimé"}</span>
              <span className="block truncate text-xs text-muted">
                {when.format(new Date(p.created_at))} · {p.plan_code} · {p.operator ?? "Mobile Money"} · {p.provider_transaction_id}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="scoreboard block text-lg font-extrabold">{xof.format(p.amount_xof)} F</span>
              <span className={cn("block text-xs font-bold", STATUS[p.status]?.className)}>{STATUS[p.status]?.label ?? p.status}</span>
              {p.status === "pending" ? (
                <form action={recheckPayment.bind(null, p.provider_transaction_id)}>
                  <button className="text-[11px] text-brand underline">Vérifier</button>
                </form>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {!rows.length ? <p className="text-sm text-muted">Aucun paiement pour l&apos;instant.</p> : null}
    </div>
  );
}

export default function AdminPaymentsPage() {
  return (
    <>
      <PageHeader kicker="Admin" title="Paiements" />
      <Suspense fallback={<div className="h-40 animate-pulse rounded-(--radius-card) bg-surface" aria-hidden />}>
        <Content />
      </Suspense>
    </>
  );
}
