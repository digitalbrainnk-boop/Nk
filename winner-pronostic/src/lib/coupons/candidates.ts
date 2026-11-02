import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { confidenceFrom } from "@/lib/predictions/confidence";
import { MARKETS_BY_SPORT, type Market, type ProbabilityMap, probabilityOf } from "@/lib/predictions/markets";
import { type SportCode, isSportCode } from "@/lib/sports/catalog";
import type { Candidate } from "./generator";
import { expectedValue } from "./odds";
import { type CouponPeriod, periodWindow } from "./period";

type EventRow = {
  id: number;
  sport: string;
  starts_at: string;
  competition: { name: string; is_enabled: boolean } | null;
  home: { name: string } | null;
  away: { name: string } | null;
  predictions: { probabilities: ProbabilityMap; computed_at: string }[];
  event_odds: { market: Market; line: number | null; selection: string; odd: number }[];
};

/**
 * Sélections candidates pour le générateur : événements à venir de la
 * période, avec une prédiction du modèle et des cotes disponibles.
 * Lecture avec la clé serveur (les probabilités détaillées sont premium).
 */
export async function loadCandidates(period: CouponPeriod, now: Date = new Date()): Promise<Candidate[]> {
  const { from, to } = periodWindow(period, now);
  const { data, error } = await createAdminClient()
    .from("events")
    .select(
      `id, sport, starts_at,
       competition:competitions!events_competition_id_sport_fkey!inner(name, is_enabled),
       home:teams!events_home_team_id_sport_fkey(name),
       away:teams!events_away_team_id_sport_fkey(name),
       predictions(probabilities, computed_at),
       event_odds(market, line, selection, odd)`,
    )
    .eq("status_group", "scheduled")
    .eq("competition.is_enabled", true)
    .gte("starts_at", from.toISOString())
    .lt("starts_at", to.toISOString())
    .order("starts_at")
    .limit(500);

  if (error) {
    console.error("[coupons] lecture des événements impossible :", error.message);
    throw new Error("Lecture des événements impossible");
  }
  return buildCandidates((data ?? []) as unknown as EventRow[]);
}

/** Transforme les événements (prédictions + cotes) en sélections candidates. Fonction pure. */
export function buildCandidates(rows: EventRow[]): Candidate[] {
  const candidates: Candidate[] = [];
  for (const row of rows) {
    if (!isSportCode(row.sport) || !row.home || !row.away) continue;
    const sport: SportCode = row.sport;
    const prediction = [...row.predictions].sort((a, b) => b.computed_at.localeCompare(a.computed_at))[0];
    if (!prediction) continue;

    // Meilleure cote par sélection, tous bookmakers confondus
    const best = new Map<string, { market: Market; line: number | null; selection: string; odd: number }>();
    for (const o of row.event_odds) {
      if (!MARKETS_BY_SPORT[sport].includes(o.market)) continue;
      const line = o.line === null ? null : Number(o.line);
      const key = `${o.market}:${line ?? ""}:${o.selection}`;
      const odd = Number(o.odd);
      if (!best.has(key) || best.get(key)!.odd < odd) best.set(key, { market: o.market, line, selection: o.selection, odd });
    }

    for (const [key, o] of best) {
      const probability = probabilityOf(prediction.probabilities, o.market, o.line, o.selection);
      if (probability === null) continue;
      candidates.push({
        key: `${row.id}:${key}`,
        eventId: row.id,
        sport,
        competition: row.competition?.name,
        startsAt: row.starts_at,
        home: row.home.name,
        away: row.away.name,
        market: o.market,
        line: o.line,
        selection: o.selection,
        odd: o.odd,
        probability,
        confidence: confidenceFrom(probability, expectedValue(probability, o.odd)),
      });
    }
  }
  return candidates;
}
