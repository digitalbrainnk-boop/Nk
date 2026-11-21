import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { sportStyle } from "@/components/sport/sport-badge";
import { toggleSport, updateCompetition } from "@/lib/admin/actions";
import { requireAdmin } from "@/lib/auth/dal";
import { isSportCode } from "@/lib/sports/catalog";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Compétitions · Admin", robots: { index: false } };

async function Content({ searchParams }: { searchParams: PageProps<"/admin/competitions">["searchParams"] }) {
  await requireAdmin();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 40) : "";
  const sport = typeof params.sport === "string" && isSportCode(params.sport) ? params.sport : "";
  const only = params.actives === "1";
  const supabase = await createClient();
  const [{ data: sports }, { data: competitions }] = await Promise.all([
    supabase.from("sports").select("code, name, emoji, is_enabled").order("display_order"),
    (() => {
      let query = supabase.from("competitions").select("id, sport, name, country_name, is_enabled, is_featured, display_order").order("is_enabled", { ascending: false }).order("display_order").order("name").limit(150);
      if (q) query = query.or(`name.ilike.%${q.replace(/[%_,()]/g, " ")}%,country_name.ilike.%${q.replace(/[%_,()]/g, " ")}%`);
      if (sport) query = query.eq("sport", sport);
      if (only) query = query.eq("is_enabled", true);
      return query;
    })(),
  ]);

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h2 className="font-display text-xl font-extrabold uppercase">Sports</h2>
        <div className="grid grid-cols-2 gap-2">
          {(sports ?? []).map((s) => (
            <form key={s.code} action={toggleSport.bind(null, s.code, !s.is_enabled)} style={isSportCode(s.code) ? sportStyle(s.code) : undefined}>
              <button type="submit" className={cn("flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-sm", s.is_enabled ? "border-(--sport)/50 bg-surface" : "border-line bg-surface opacity-60")}>
                <span>
                  {s.emoji} {s.name}
                </span>
                <span className={cn("text-xs font-bold", s.is_enabled ? "text-brand" : "text-muted")}>{s.is_enabled ? "Actif" : "Inactif"}</span>
              </button>
            </form>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-xl font-extrabold uppercase">Compétitions</h2>
        <p className="text-xs text-muted">
          Toutes les compétitions vues par la synchronisation apparaissent ici. Activez celles à afficher (le championnat burkinabè y
          apparaîtra s&apos;il est couvert par API-Sports).
        </p>
        <form className="flex flex-wrap gap-2" action="/admin/competitions">
          <input name="q" defaultValue={q} placeholder="Nom ou pays…" className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm" />
          <select name="sport" defaultValue={sport} className="h-10 rounded-lg border border-line bg-surface px-2 text-sm">
            <option value="">Tous sports</option>
            {(sports ?? []).map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" name="actives" value="1" defaultChecked={only} /> Actives
          </label>
          <button className="h-10 rounded-lg bg-surface-3 px-3 text-sm font-semibold ring-1 ring-line">Filtrer</button>
        </form>
        <ul className="divide-y divide-line/60 rounded-xl border border-line bg-surface">
          {(competitions ?? []).map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {isSportCode(c.sport) ? <span aria-hidden>{(sports ?? []).find((s) => s.code === c.sport)?.emoji} </span> : null}
                <span className={c.is_enabled ? "font-semibold" : "text-muted"}>{c.name}</span>
                <span className="text-xs text-faint"> · {c.country_name}</span>
              </span>
              <form action={updateCompetition}>
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="enabled" value={String(!c.is_enabled)} />
                <button className={cn("rounded-md px-2 py-1 text-xs font-bold", c.is_enabled ? "bg-brand/15 text-brand" : "bg-surface-3 text-muted")}>{c.is_enabled ? "Affichée" : "Masquée"}</button>
              </form>
              <form action={updateCompetition}>
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="featured" value={String(!c.is_featured)} />
                <button className={cn("rounded-md px-2 py-1 text-xs font-bold", c.is_featured ? "bg-gold/15 text-gold" : "bg-surface-3 text-muted")}>★</button>
              </form>
              <form action={updateCompetition} className="flex items-center gap-1">
                <input type="hidden" name="id" value={c.id} />
                <input name="order" type="number" min={0} max={32000} defaultValue={c.display_order} aria-label="Ordre" className="h-8 w-16 rounded-md border border-line bg-surface-2 px-1 text-xs" />
                <button className="rounded-md bg-surface-3 px-2 py-1 text-xs">OK</button>
              </form>
            </li>
          ))}
        </ul>
        {!competitions?.length ? (
          <p className="text-sm text-muted">
            Aucune compétition trouvée. Lancez la synchronisation depuis <Link href="/admin/synchro" className="text-brand underline">Synchro</Link>.
          </p>
        ) : null}
      </section>
    </div>
  );
}

export default function AdminCompetitionsPage(props: PageProps<"/admin/competitions">) {
  return (
    <>
      <PageHeader kicker="Admin" title="Compétitions" />
      <Suspense fallback={<div className="h-40 animate-pulse rounded-(--radius-card) bg-surface" aria-hidden />}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
