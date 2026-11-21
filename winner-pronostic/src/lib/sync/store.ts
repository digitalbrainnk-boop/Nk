import type { SupabaseClient } from "@supabase/supabase-js";
import type { SportCode } from "@/lib/sports/catalog";
import type { Database, Json } from "@/types/database";
import type { NormalizedGame, NormalizedIncident, NormalizedOdd, NormalizedStanding, NormalizedTeam } from "./mappers";

/**
 * Écriture en base des données synchronisées (avec la clé serveur).
 * Les compétitions et équipes sont toujours enregistrées (pour que l'admin
 * puisse activer une compétition), les matchs seulement pour les compétitions
 * activées.
 */

export type Db = SupabaseClient<Database>;

export type ScoreChange = {
  eventId: number;
  sport: SportCode;
  homeTeamId: number;
  awayTeamId: number;
  before: { home: number; away: number };
  after: { home: number; away: number };
};

const CHUNK = 400;

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what} : ${result.error.message}`);
  return result.data;
}

/** Enregistre les compétitions ; renvoie (id fournisseur → { id interne, activée }). */
export async function upsertCompetitions(db: Db, sport: SportCode, games: NormalizedGame[]) {
  const leagues = new Map(games.map((g) => [g.league.externalId, g.league]));
  const map = new Map<number, { id: number; enabled: boolean }>();
  for (const part of chunks([...leagues.values()])) {
    const rows = check(
      await db
        .from("competitions")
        .upsert(
          part.map((l) => ({
            sport,
            external_id: l.externalId,
            name: l.name,
            country_name: l.countryName,
            country_flag_url: l.countryFlag,
            logo_url: l.logo,
            current_season: l.season,
          })),
          { onConflict: "sport,external_id" },
        )
        .select("id, external_id, is_enabled"),
      "Compétitions",
    );
    for (const r of rows ?? []) map.set(r.external_id, { id: r.id, enabled: r.is_enabled });
  }
  return map;
}

/** Enregistre les équipes ; renvoie (id fournisseur → id interne). */
export async function upsertTeams(db: Db, sport: SportCode, teams: NormalizedTeam[]) {
  const unique = new Map(teams.map((t) => [t.externalId, t]));
  const map = new Map<number, number>();
  for (const part of chunks([...unique.values()])) {
    const rows = check(
      await db
        .from("teams")
        .upsert(
          part.map((t) => ({ sport, external_id: t.externalId, name: t.name, logo_url: t.logo })),
          { onConflict: "sport,external_id" },
        )
        .select("id, external_id"),
      "Équipes",
    );
    for (const r of rows ?? []) map.set(r.external_id, r.id);
  }
  return map;
}

/**
 * Enregistre des matchs d'un sport. Renvoie le nombre de matchs écrits et les
 * changements de score (pour les alertes « but »).
 */
export async function upsertGames(db: Db, sport: SportCode, games: NormalizedGame[], options: { onlyEnabled?: boolean } = {}) {
  if (!games.length) return { events: 0, changes: [] as ScoreChange[], skipped: 0 };
  const competitions = await upsertCompetitions(db, sport, games);
  const kept = games.filter((g) => !options.onlyEnabled || competitions.get(g.league.externalId)?.enabled);
  if (!kept.length) return { events: 0, changes: [], skipped: games.length };
  const teams = await upsertTeams(db, sport, kept.flatMap((g) => [g.home, g.away]));

  // Scores actuels, pour détecter les buts marqués depuis la dernière synchronisation
  const previous = new Map<number, { id: number; home: number | null; away: number | null }>();
  for (const part of chunks(kept.map((g) => g.externalId))) {
    const rows = check(
      await db.from("events").select("id, external_id, home_score, away_score").eq("sport", sport).in("external_id", part),
      "Lecture des matchs",
    );
    for (const r of rows ?? []) previous.set(r.external_id, { id: r.id, home: r.home_score, away: r.away_score });
  }

  const now = new Date().toISOString();
  const payload = kept.flatMap((g) => {
    const competitionId = competitions.get(g.league.externalId)?.id;
    const home = teams.get(g.home.externalId);
    const away = teams.get(g.away.externalId);
    if (!competitionId || !home || !away || home === away) return [];
    return [
      {
        sport,
        external_id: g.externalId,
        competition_id: competitionId,
        season: g.league.season,
        round: g.round,
        starts_at: g.startsAt,
        status_short: g.statusShort,
        status_long: g.statusLong,
        status_group: g.statusGroup,
        live_clock: g.liveClock,
        elapsed: g.elapsed,
        home_team_id: home,
        away_team_id: away,
        home_score: g.homeScore,
        away_score: g.awayScore,
        period_scores: g.periodScores as Json,
        venue_name: g.venueName,
        venue_city: g.venueCity,
        referee: g.referee,
        last_synced_at: now,
      },
    ];
  });

  const changes: ScoreChange[] = [];
  let written = 0;
  for (const part of chunks(payload)) {
    const rows = check(
      await db.from("events").upsert(part, { onConflict: "sport,external_id" }).select("id, external_id, home_team_id, away_team_id, home_score, away_score"),
      "Matchs",
    );
    written += rows?.length ?? 0;
    for (const r of rows ?? []) {
      const before = previous.get(r.external_id);
      if (!before || before.home === null || before.away === null || r.home_score === null || r.away_score === null) continue;
      if (r.home_score + r.away_score > before.home + before.away) {
        changes.push({
          eventId: r.id,
          sport,
          homeTeamId: r.home_team_id,
          awayTeamId: r.away_team_id,
          before: { home: before.home, away: before.away },
          after: { home: r.home_score, away: r.away_score },
        });
      }
    }
  }
  return { events: written, changes, skipped: games.length - kept.length };
}

/** Classement d'une compétition (remplacé en entier à chaque synchronisation). */
export async function replaceStandings(db: Db, sport: SportCode, competitionId: number, season: string, rows: NormalizedStanding[]) {
  if (!rows.length) return 0;
  const teams = await upsertTeams(db, sport, rows.map((r) => r.team));
  check(await db.from("standings").delete().eq("competition_id", competitionId).eq("season", season), "Classement (suppression)");
  const payload = rows.flatMap((r) => {
    const teamId = teams.get(r.team.externalId);
    if (!teamId) return [];
    return [
      {
        competition_id: competitionId,
        season,
        group_name: r.group,
        team_id: teamId,
        rank: r.rank,
        points: r.points,
        played: r.played,
        won: r.won,
        drawn: r.drawn,
        lost: r.lost,
        scored: r.scored,
        conceded: r.conceded,
        home_played: r.home?.played ?? 0,
        home_won: r.home?.won ?? 0,
        home_drawn: r.home?.drawn ?? 0,
        home_lost: r.home?.lost ?? 0,
        home_scored: r.home?.scored ?? 0,
        home_conceded: r.home?.conceded ?? 0,
        away_played: r.away?.played ?? 0,
        away_won: r.away?.won ?? 0,
        away_drawn: r.away?.drawn ?? 0,
        away_lost: r.away?.lost ?? 0,
        away_scored: r.away?.scored ?? 0,
        away_conceded: r.away?.conceded ?? 0,
        form: r.form,
        description: r.description,
        updated_at: new Date().toISOString(),
      },
    ];
  });
  // Une équipe peut apparaître dans deux groupes : la clé primaire inclut le groupe
  const unique = new Map(payload.map((p) => [`${p.group_name}|${p.team_id}`, p]));
  for (const part of chunks([...unique.values()])) {
    check(await db.from("standings").upsert(part, { onConflict: "competition_id,season,group_name,team_id" }), "Classement");
  }
  return unique.size;
}

/** Remplace les cotes d'un match par la dernière photographie. */
export async function replaceOdds(db: Db, eventId: number, odds: NormalizedOdd[]) {
  if (!odds.length) return 0;
  check(await db.from("event_odds").delete().eq("event_id", eventId), "Cotes (suppression)");
  const now = new Date().toISOString();
  const payload = odds.map((o) => ({
    event_id: eventId,
    bookmaker_id: o.bookmakerId,
    bookmaker_name: o.bookmakerName,
    period: o.period,
    market: o.market,
    line: o.line,
    selection: o.selection,
    odd: o.odd,
    updated_at: now,
  }));
  for (const part of chunks(payload)) check(await db.from("event_odds").insert(part), "Cotes");
  check(await db.from("events").update({ odds_synced_at: now }).eq("id", eventId), "Cotes (date)");
  return payload.length;
}

/** Faits de match (buts, cartons…) d'un match de football. */
export async function upsertIncidents(db: Db, sport: SportCode, eventId: number, incidents: NormalizedIncident[]) {
  if (!incidents.length) return 0;
  const teamIds = [...new Set(incidents.map((i) => i.teamExternalId).filter((x): x is number => x !== null))];
  const teamMap = new Map<number, number>();
  if (teamIds.length) {
    const rows = check(await db.from("teams").select("id, external_id").eq("sport", sport).in("external_id", teamIds), "Équipes (faits de match)");
    for (const r of rows ?? []) teamMap.set(r.external_id, r.id);
  }
  const payload = incidents.map((i) => ({
    event_id: eventId,
    minute: i.minute,
    extra_minute: i.extraMinute,
    team_id: i.teamExternalId === null ? null : (teamMap.get(i.teamExternalId) ?? null),
    player_name: i.player,
    assist_name: i.assist,
    type: i.type,
    detail: i.detail,
    comments: i.comments,
    incident_key: i.key,
  }));
  check(await db.from("event_incidents").upsert(payload, { onConflict: "event_id,incident_key" }), "Faits de match");
  return payload.length;
}

/** Cache des réponses brutes de l'API (compositions, blessés…). */
export async function readCache<T>(db: Db, key: string): Promise<T | null> {
  const { data } = await db.from("api_cache").select("payload, expires_at").eq("cache_key", key).maybeSingle();
  if (!data || Date.parse(data.expires_at) < Date.now()) return null;
  return data.payload as T;
}

export async function writeCache(db: Db, key: string, payload: unknown, ttlSeconds: number) {
  await db.from("api_cache").upsert({
    cache_key: key,
    payload: payload as Json,
    fetched_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  });
}
