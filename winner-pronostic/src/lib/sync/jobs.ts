import { ACTIVE_SPORTS, type SportCode, isSportCode } from "@/lib/sports/catalog";
import type { ApiSportsClient } from "./api-client";
import { mapGame, mapIncidents, mapLeagueInfo, mapOdds, mapStandings } from "./mappers";
import { type Db, type ScoreChange, replaceOdds, replaceStandings, upsertGames, upsertIncidents } from "./store";

/**
 * Tâches de synchronisation avec API-Sports. Chaque tâche est idempotente
 * (on peut la relancer sans risque) et économe en requêtes : le quota
 * journalier dépend de l'offre API-Sports.
 */

export type JobContext = { db: Db; api: ApiSportsClient; now: Date };
export type JobResult = { items: number; details?: Record<string, unknown>; changes?: ScoreChange[] };

const DAY = 86_400_000;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const gamesPath = (sport: SportCode) => (sport === "football" ? "/fixtures" : "/games");

/** Lit un réglage de app_settings (valeur JSON) avec une valeur par défaut. */
export async function setting<T>(db: Db, key: string, fallback: T): Promise<T> {
  const { data } = await db.from("app_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value ?? fallback) as T;
}

/** Sports actifs en base ET couverts par API-Sports. */
export async function activeSports(db: Db): Promise<SportCode[]> {
  const { data } = await db.from("sports").select("code, is_enabled").eq("is_enabled", true);
  const enabled = new Set((data ?? []).map((s) => s.code));
  return ACTIVE_SPORTS.filter((s) => enabled.has(s.code)).map((s) => s.code);
}

/** Programme des prochains jours (tous sports, toutes compétitions activées). */
export async function syncSchedule(ctx: JobContext, days?: number): Promise<JobResult> {
  const horizon = days ?? (await setting(ctx.db, "sync_days_ahead", 3));
  const details: Record<string, number> = {};
  let items = 0;
  for (const sport of await activeSports(ctx.db)) {
    for (let d = 0; d < horizon; d++) {
      const date = isoDate(new Date(ctx.now.getTime() + d * DAY));
      const res = await ctx.api.get(sport, gamesPath(sport), { date, timezone: "UTC" });
      const games = res.response.map((i) => mapGame(sport, i)).filter((g) => g !== null);
      const { events } = await upsertGames(ctx.db, sport, games, { onlyEnabled: true });
      details[`${sport}:${date}`] = events;
      items += events;
    }
  }
  return { items, details };
}

/**
 * Saison complète des compétitions activées (matchs passés et à venir) : c'est
 * l'historique qui sert à calculer la forme et les forces des équipes.
 * Une compétition est resynchronisée au plus une fois par semaine.
 */
export async function syncSeasons(ctx: JobContext, maxCompetitions = 12): Promise<JobResult> {
  const sports = await activeSports(ctx.db);
  const weekAgo = new Date(ctx.now.getTime() - 7 * DAY).toISOString();
  const { data: competitions } = await ctx.db
    .from("competitions")
    .select("id, sport, external_id, current_season, season_synced_at")
    .eq("is_enabled", true)
    .in("sport", sports)
    .or(`season_synced_at.is.null,season_synced_at.lt.${weekAgo}`)
    .order("season_synced_at", { ascending: true, nullsFirst: true })
    .limit(maxCompetitions);

  let items = 0;
  const details: Record<string, number> = {};
  for (const c of competitions ?? []) {
    if (!isSportCode(c.sport)) continue;
    // Saison en cours et pays (GET /leagues)
    const info = await ctx.api.get(c.sport, "/leagues", { id: c.external_id });
    const league = info.response.map((i) => mapLeagueInfo(c.sport as SportCode, i)).find((x) => x !== null);
    const season = league?.currentSeason ?? c.current_season;
    if (league) {
      await ctx.db
        .from("competitions")
        .update({
          current_season: season,
          country_code: league.league.countryCode,
          ...(league.league.type ? { type: league.league.type } : {}),
          ...(league.league.logo ? { logo_url: league.league.logo } : {}),
        })
        .eq("id", c.id);
    }
    if (!season) continue;
    const res = await ctx.api.get(c.sport, gamesPath(c.sport), { league: c.external_id, season, timezone: "UTC" });
    const games = res.response.map((i) => mapGame(c.sport as SportCode, i)).filter((g) => g !== null);
    const { events } = await upsertGames(ctx.db, c.sport, games, { onlyEnabled: true });
    await ctx.db.from("competitions").update({ season_synced_at: ctx.now.toISOString() }).eq("id", c.id);
    details[`${c.sport}:${c.external_id}`] = events;
    items += events;
  }
  return { items, details };
}

/** Classements des compétitions activées (au plus deux fois par jour). */
export async function syncStandings(ctx: JobContext, maxCompetitions = 20): Promise<JobResult> {
  const sports = await activeSports(ctx.db);
  const halfDayAgo = new Date(ctx.now.getTime() - DAY / 2).toISOString();
  const { data: competitions } = await ctx.db
    .from("competitions")
    .select("id, sport, external_id, current_season")
    .eq("is_enabled", true)
    .in("sport", sports)
    .not("current_season", "is", null)
    .or(`standings_synced_at.is.null,standings_synced_at.lt.${halfDayAgo}`)
    .limit(maxCompetitions);
  let items = 0;
  for (const c of competitions ?? []) {
    if (!isSportCode(c.sport) || !c.current_season) continue;
    try {
      const res = await ctx.api.get(c.sport, "/standings", { league: c.external_id, season: c.current_season });
      items += await replaceStandings(ctx.db, c.sport, c.id, c.current_season, mapStandings(c.sport, res.response));
    } finally {
      // Les coupes sans classement ne sont pas redemandées à chaque fois
      await ctx.db.from("competitions").update({ standings_synced_at: ctx.now.toISOString() }).eq("id", c.id);
    }
  }
  return { items };
}

/**
 * Matchs en direct : uniquement pour les sports qui ont un match en cours ou
 * qui commence. Renvoie les changements de score (alertes « but »).
 */
export async function syncLive(ctx: JobContext): Promise<JobResult> {
  const sports = await activeSports(ctx.db);
  const from = new Date(ctx.now.getTime() - 4 * 3_600_000).toISOString();
  const to = new Date(ctx.now.getTime() + 15 * 60_000).toISOString();
  const { data: window } = await ctx.db
    .from("events")
    .select("sport")
    .in("sport", sports)
    .in("status_group", ["scheduled", "live"])
    .gte("starts_at", from)
    .lte("starts_at", to)
    .limit(1000);
  const liveSports = [...new Set((window ?? []).map((e) => e.sport))].filter(isSportCode);

  let items = 0;
  const changes: ScoreChange[] = [];
  for (const sport of liveSports) {
    const res =
      sport === "football"
        ? await ctx.api.get(sport, "/fixtures", { live: "all", timezone: "UTC" })
        : await ctx.api.get(sport, "/games", { date: isoDate(ctx.now), timezone: "UTC" });
    const games = res.response.map((i) => mapGame(sport, i)).filter((g) => g !== null);
    const result = await upsertGames(ctx.db, sport, games, { onlyEnabled: true });
    items += result.events;
    changes.push(...result.changes);

    // Football : les matchs en direct contiennent les faits de match (buteurs, cartons)
    if (sport === "football") {
      for (const raw of res.response as Record<string, unknown>[]) {
        const id = (raw.fixture as { id?: number } | undefined)?.id;
        const incidents = mapIncidents(Array.isArray(raw.events) ? raw.events : []);
        if (!id || !incidents.length) continue;
        const { data: event } = await ctx.db.from("events").select("id").eq("sport", sport).eq("external_id", id).maybeSingle();
        if (event) await upsertIncidents(ctx.db, sport, event.id, incidents);
      }
    }
  }
  // Matchs commencés mais jamais vus en direct (ex. sport sans mise à jour) : statut rafraîchi au prochain programme
  return { items, changes, details: { sports: liveSports } };
}

/** Cotes des matchs à venir (bookmakers préférés : 1xBet, Bet365, Pinnacle…). */
export async function syncOdds(ctx: JobContext, options: { days?: number; maxPerSport?: number } = {}): Promise<JobResult> {
  const preferred = await setting<string[]>(ctx.db, "odds_bookmakers", ["1xBet", "Bet365", "Pinnacle"]);
  const days = options.days ?? 2;
  const until = new Date(ctx.now.getTime() + days * DAY).toISOString();
  let items = 0;
  const details: Record<string, number> = {};

  for (const sport of await activeSports(ctx.db)) {
    const { data: upcoming } = await ctx.db
      .from("events")
      .select("id, external_id, odds_synced_at")
      .eq("sport", sport)
      .eq("status_group", "scheduled")
      .gte("starts_at", ctx.now.toISOString())
      .lte("starts_at", until)
      .order("starts_at")
      .limit(500);
    if (!upcoming?.length) continue;
    const byExternal = new Map(upcoming.map((e) => [e.external_id, e.id]));
    let count = 0;

    if (sport === "football") {
      // Football : les cotes se lisent par date, page par page
      for (let d = 0; d < days; d++) {
        const date = isoDate(new Date(ctx.now.getTime() + d * DAY));
        let page = 1;
        let total = 1;
        do {
          const res = await ctx.api.get(sport, "/odds", { date, page, timezone: "UTC" });
          total = Math.min(res.paging.total, 10);
          for (const item of res.response) {
            const { externalGameId, odds } = mapOdds(item, preferred);
            const eventId = externalGameId === null ? undefined : byExternal.get(externalGameId);
            if (eventId && odds.length) count += await replaceOdds(ctx.db, eventId, odds);
          }
          page += 1;
        } while (page <= total);
      }
    } else {
      // Autres sports : match par match, en commençant par ceux dont les cotes sont les plus anciennes
      const targets = [...upcoming]
        .sort((a, b) => (a.odds_synced_at ?? "").localeCompare(b.odds_synced_at ?? ""))
        .slice(0, options.maxPerSport ?? 25);
      for (const e of targets) {
        const res = await ctx.api.get(sport, "/odds", { game: e.external_id });
        for (const item of res.response) {
          const { odds } = mapOdds(item, preferred);
          if (odds.length) count += await replaceOdds(ctx.db, e.id, odds);
        }
      }
    }
    details[sport] = count;
    items += count;
  }
  return { items, details };
}
