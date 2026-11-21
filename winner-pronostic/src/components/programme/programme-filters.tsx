"use client";

import { useRouter } from "next/navigation";
import { withParams } from "./url";

type Competition = { id: number; name: string; country_name: string };

/** Filtres pays / compétition et recherche d'équipe. */
export function ProgrammeFilters({
  competitions,
  params,
  path = "/",
}: {
  competitions: Competition[];
  params: Record<string, string | undefined>;
  path?: string;
}) {
  const router = useRouter();
  const countries = [...new Set(competitions.map((c) => c.country_name))].sort((a, b) => a.localeCompare(b, "fr"));
  const visible = params.pays ? competitions.filter((c) => c.country_name === params.pays) : competitions;
  const select = "h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-sm text-ink focus:border-brand focus:outline-none";

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <select
          aria-label="Pays"
          className={select}
          value={params.pays ?? ""}
          onChange={(e) => router.push(withParams(path, params, { pays: e.target.value || undefined, competition: undefined }))}
        >
          <option value="">Tous les pays</option>
          {countries.map((c) => (
            <option key={c} value={c}>
              {c === "World" ? "International" : c}
            </option>
          ))}
        </select>
        <select
          aria-label="Compétition"
          className={select}
          value={params.competition ?? ""}
          onChange={(e) => router.push(withParams(path, params, { competition: e.target.value || undefined }))}
        >
          <option value="">Toutes les compétitions</option>
          {visible.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <form action={path} className="flex gap-2" role="search">
        {Object.entries(params).map(([k, v]) => (k !== "q" && v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
        <input
          name="q"
          defaultValue={params.q}
          maxLength={40}
          placeholder="Rechercher une équipe (ex. Lakers, ASFA)…"
          aria-label="Rechercher une équipe"
          className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none"
        />
        <button type="submit" className="h-10 rounded-lg bg-surface-3 px-3 text-sm font-semibold ring-1 ring-line">
          🔍
        </button>
      </form>
    </div>
  );
}
