import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/admin/action-form";
import { PageHeader } from "@/components/layout/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { grantPremium } from "@/lib/admin/actions";
import { requireAdmin } from "@/lib/auth/dal";
import { formatLongDate } from "@/lib/format/date";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Utilisateurs · Admin", robots: { index: false } };

async function Content({ searchParams }: { searchParams: PageProps<"/admin/utilisateurs">["searchParams"] }) {
  await requireAdmin();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().replace(/[%_,()]/g, " ").slice(0, 60) : "";
  const supabase = await createClient();
  let query = supabase.from("profiles").select("id, display_name, email, phone, country_code, role, created_at").order("created_at", { ascending: false }).limit(50);
  if (q) query = query.or(`display_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`);
  const [{ data: users }, { data: plans }] = await Promise.all([query, supabase.from("plans").select("code, name").order("display_order")]);
  const ids = (users ?? []).map((u) => u.id);
  const { data: subs } = ids.length
    ? await supabase.from("subscriptions").select("user_id, ends_at").in("user_id", ids).eq("status", "active").gt("ends_at", new Date().toISOString())
    : { data: [] };
  const premiumUntil = new Map<string, string>();
  for (const s of subs ?? []) if (!premiumUntil.has(s.user_id) || premiumUntil.get(s.user_id)! < s.ends_at) premiumUntil.set(s.user_id, s.ends_at);

  return (
    <div className="space-y-4">
      <form action="/admin/utilisateurs" className="flex gap-2">
        <input name="q" defaultValue={q} placeholder="Nom, e-mail ou téléphone…" className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm" />
        <button className="h-10 rounded-lg bg-surface-3 px-3 text-sm font-semibold ring-1 ring-line">Rechercher</button>
      </form>
      <ul className="space-y-2">
        {(users ?? []).map((u) => (
          <li key={u.id} className="rounded-xl border border-line bg-surface p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate font-semibold">
                {u.display_name} {u.role === "admin" ? <span className="text-xs text-gold">(admin)</span> : null}
              </p>
              {premiumUntil.get(u.id) ? <span className="shrink-0 text-xs font-bold text-gold">👑 jusqu&apos;au {formatLongDate(premiumUntil.get(u.id)!)}</span> : <span className="text-xs text-muted">Gratuit</span>}
            </div>
            <p className="truncate text-xs text-muted">
              {u.email ?? (u.phone ? `+${u.phone}` : "—")} · {u.country_code} · inscrit le {formatLongDate(u.created_at)}
            </p>
            <ActionForm action={grantPremium} className="mt-2 flex flex-wrap items-center gap-2">
              <input type="hidden" name="userId" value={u.id} />
              <select name="plan" className="h-8 rounded-lg border border-line bg-surface-2 px-2 text-xs">
                {(plans ?? []).map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </select>
              <SubmitButton size="sm" variant="secondary" pendingLabel="…">
                Offrir Premium
              </SubmitButton>
            </ActionForm>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">Pour nommer un autre administrateur : README, section « Devenir administrateur » (commande SQL).</p>
    </div>
  );
}

export default function AdminUsersPage(props: PageProps<"/admin/utilisateurs">) {
  return (
    <>
      <PageHeader kicker="Admin" title="Utilisateurs" />
      <Suspense fallback={<div className="h-40 animate-pulse rounded-(--radius-card) bg-surface" aria-hidden />}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
