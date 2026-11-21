import { confidenceScore } from "./confidence";
import { MODEL_VERSION, computeMarkets, toProbabilityMap } from "./engine";
import { type FinishedGame, buildStrengthInput, computeElo, headToHead, setWinRate } from "./history";
import { MARKET_INFO, type Market, type Period, type ProbabilityMap, isPushFree, parseProbabilityKey, probabilityKey } from "./markets";
import { type PickResult, type SettleIncident, couponResult, settleSelection } from "./settle";
import { estimateExpectedScores, estimateSetProbability } from "./strength";
import { type SportCode, type StatusGroup, isSportCode } from "@/lib/sports/catalog";
import type { Db } from "@/lib/sync/store";
import type { Json } from "@/types/database";

/**
 * Chaîne de calcul quotidienne :
 *   1. pronostics : buts/points attendus et probabilités de tous les marchés ;
 *   2. publication : un pronostic par match (le plus solide), quelques-uns gratuits ;
 *   3. règlement : résultats des pronostics et des coupons des matchs terminés.
 */

type Ctx = { db: Db; now: Date };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Historique des matchs terminés (400 derniers jours) des sports donnés, page par page. */
async function loadHistory(db: Db, sports: SportCode[], now: Date): Promise<FinishedGame[]> {
  const since = new Date(now.getTime() - 400 * DAY).toISOString();
  const out: FinishedGame[] = [];
  for (let page = 0; page < 40; page++) {
    const { data, error } = await db
      .from("events")
      .select("id, sport, competition_id, starts_at, home_team_id, away_team_id, home_score, away_score, period_scores")
      .in("sport", sports)
      .eq("status_group", "finished")
      .gte("starts_at", since)
      .order("id")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(`Historique : ${error.message}`);
    for (const e of data ?? []) {
      if (!isSportCode(e.sport) || e.home_score === null || e.away_score === null) continue;
      // Football : score du temps réglementaire quand il est connu
      const ft = (e.period_scores as Record<string, [number | null, number | null]> | null)?.ft;
      const [hs, as] = e.sport === "football" && ft && ft[0] !== null && ft[1] !== null ? [ft[0], ft[1]] : [e.home_score, e.away_score];
      out.push({ id: e.id, sport: e.sport, competitionId: e.competition_id, startsAt: e.starts_at, homeTeamId: e.home_team_id, awayTeamId: e.away_team_id, homeScore: hs, awayScore: as });
    }
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

type UpcomingRow = {
  id: number;
  sport: string;
  competition_id: number;
  starts_at: string;
  home_team_id: number;
  away_team_id: number;
  home: { name: string } | null;
  away: { name: string } | null;
};

/** Calcule (ou recalcule) les pronostics des matchs des prochains jours. */
export async function runPredictions(ctx: Ctx, options: { hoursAhead?: number; maxEvents?: number } = {}) {
  const until = new Date(ctx.now.getTime() + (options.hoursAhead ?? 72) * HOUR).toISOString();
  const { data, error } = await ctx.db
    .from("events")
    .select(
      `id, sport, competition_id, starts_at, home_team_id, away_team_id,
       home:teams!events_home_team_id_sport_fkey(name), away:teams!events_away_team_id_sport_fkey(name)`,
    )
    .eq("status_group", "scheduled")
    .gte("starts_at", ctx.now.toISOString())
    .lte("starts_at", until)
    .order("starts_at")
    .limit(options.maxEvents ?? 400);
  if (error) throw new Error(`Matchs à venir : ${error.message}`);
  const events = ((data ?? []) as unknown as UpcomingRow[]).filter((e) => isSportCode(e.sport) && e.home && e.away);
  if (!events.length) return { items: 0 };

  const sports = [...new Set(events.map((e) => e.sport as SportCode))];
  const history = await loadHistory(ctx.db, sports, ctx.now);

  // Classement Elo recalculé sur tout l'historique, puis enregistré
  const elo = new Map<number, number>();
  for (const sport of sports) for (const [team, rating] of computeElo(history.filter((g) => g.sport === sport))) elo.set(team, rating);
  if (elo.size) {
    const ratings = Object.fromEntries([...elo].map(([k, v]) => [String(k), Math.round(v * 100) / 100]));
    await ctx.db.rpc("update_team_elo", { p_ratings: ratings });
  }

  // Classements (rang, points) pour la lecture du match
  const competitionIds = [...new Set(events.map((e) => e.competition_id))];
  const { data: standings } = await ctx.db.from("standings").select("competition_id, team_id, rank, points").in("competition_id", competitionIds);
  const rankOf = new Map((standings ?? []).map((s) => [`${s.competition_id}:${s.team_id}`, s]));

  const rows = events.map((e) => {
    const sport = e.sport as SportCode;
    const upcoming = { sport, competitionId: e.competition_id, homeTeamId: e.home_team_id, awayTeamId: e.away_team_id, homeName: e.home!.name, awayName: e.away!.name };
    let expected: { home: number; away: number };
    let strengthInfo: { factors: unknown[]; sampleSize: number } | null = null;
    if (sport === "volleyball" || sport === "tennis") {
      const p = estimateSetProbability(setWinRate(history, e.home_team_id), setWinRate(history, e.away_team_id));
      expected = { home: p, away: 1 - p };
    } else {
      const strength = estimateExpectedScores(buildStrengthInput(upcoming, history, elo));
      expected = { home: strength.home, away: strength.away };
      strengthInfo = { factors: strength.factors, sampleSize: strength.sampleSize };
    }
    const result = computeMarkets(sport, expected.home, expected.away);
    const hs = rankOf.get(`${e.competition_id}:${e.home_team_id}`);
    const as = rankOf.get(`${e.competition_id}:${e.away_team_id}`);
    const h2h = headToHead(history, e.home_team_id, e.away_team_id);
    return {
      event_id: e.id,
      model_version: MODEL_VERSION[sport],
      expected_home: Math.round(expected.home * 100) / 100,
      expected_away: Math.round(expected.away * 100) / 100,
      home_rating: elo.get(e.home_team_id) ? Math.round(elo.get(e.home_team_id)! * 100) / 100 : null,
      away_rating: elo.get(e.away_team_id) ? Math.round(elo.get(e.away_team_id)! * 100) / 100 : null,
      probabilities: toProbabilityMap(result) as Json,
      inputs: {
        strength: strengthInfo,
        context: {
          standings: hs && as ? { homeRank: hs.rank, awayRank: as.rank, homePoints: hs.points, awayPoints: as.points } : null,
          h2h: h2h.played ? h2h : null,
        },
      } as Json,
      computed_at: ctx.now.toISOString(),
    };
  });

  for (let i = 0; i < rows.length; i += 100) {
    const { error: upsertError } = await ctx.db.from("predictions").upsert(rows.slice(i, i + 100), { onConflict: "event_id,model_version" });
    if (upsertError) throw new Error(`Pronostics : ${upsertError.message}`);
  }
  return { items: rows.length, details: { sports, history: history.length } };
}

// ---------------------------------------------------------------------------
// Publication des pronostics
// ---------------------------------------------------------------------------

type Candidate = { key: string; probability: number; odd: number | null; bookmaker: string | null; confidence: number; edge: number | null };

/** Le pronostic le plus solide d'un match (fonction pure, testée). */
export function bestPick(probabilities: ProbabilityMap, odds: { key: string; odd: number; bookmaker: string }[]): Candidate | null {
  const bestOdds = new Map<string, { odd: number; bookmaker: string }>();
  for (const o of odds) if (!bestOdds.has(o.key) || bestOdds.get(o.key)!.odd < o.odd) bestOdds.set(o.key, o);
  const candidates: Candidate[] = [];
  for (const [key, probability] of Object.entries(probabilities)) {
    const ref = parseProbabilityKey(key);
    if (!ref || (ref.period !== "FT" && ref.period !== "1H")) continue;
    const kind = MARKET_INFO[ref.market].kind;
    if (kind === "exotic" || ref.market === "DNB" || !isPushFree(ref.line)) continue;
    const best = bestOdds.get(key);
    if (best) {
      if (best.odd < 1.25 || best.odd > 3.5) continue;
      const edge = probability * best.odd - 1;
      if (edge < -0.03) continue;
      const confidence = confidenceScore({ probability, market: ref.market, marketGap: probability - 1 / best.odd, edge });
      candidates.push({ key, probability, odd: best.odd, bookmaker: best.bookmaker, confidence, edge });
    } else if (bestOdds.size === 0 && kind === "main" && probability >= 0.55 && probability <= 0.85) {
      // Pas de cotes disponibles : on garde les marchés classiques assez probables
      candidates.push({ key, probability, odd: null, bookmaker: null, confidence: confidenceScore({ probability, market: ref.market }), edge: null });
    }
  }
  candidates.sort((a, b) => b.confidence - a.confidence || (b.edge ?? 0) - (a.edge ?? 0) || b.probability - a.probability);
  return candidates[0] ?? null;
}

export async function publishPicks(ctx: Ctx, options: { hoursAhead?: number } = {}) {
  const until = new Date(ctx.now.getTime() + (options.hoursAhead ?? 36) * HOUR).toISOString();
  const { data: events } = await ctx.db
    .from("events")
    .select("id, sport, competition_id, starts_at, predictions(id, probabilities, computed_at), prediction_picks(id)")
    .eq("status_group", "scheduled")
    .gte("starts_at", new Date(ctx.now.getTime() + 15 * 60_000).toISOString())
    .lte("starts_at", until)
    .order("starts_at")
    .limit(150);

  const startOfDay = new Date(Date.UTC(ctx.now.getUTCFullYear(), ctx.now.getUTCMonth(), ctx.now.getUTCDate())).toISOString();
  const { count: alreadyToday } = await ctx.db.from("prediction_picks").select("id", { count: "exact", head: true }).gte("published_at", startOfDay);
  const maxPerDay = Number((await ctx.db.from("app_settings").select("value").eq("key", "max_published_picks_per_day").maybeSingle()).data?.value ?? 30);
  let budget = Math.max(0, maxPerDay - (alreadyToday ?? 0));

  const inserts = [];
  for (const e of events ?? []) {
    if (budget <= 0) break;
    if (!isSportCode(e.sport) || (e.prediction_picks ?? []).length) continue;
    const prediction = [...(e.predictions ?? [])].sort((a, b) => b.computed_at.localeCompare(a.computed_at))[0];
    if (!prediction) continue;
    const { data: oddsRows } = await ctx.db.from("event_odds").select("period, market, line, selection, odd, bookmaker_name").eq("event_id", e.id).limit(3000);
    const odds = (oddsRows ?? []).map((o) => ({
      key: probabilityKey({ period: o.period as Period, market: o.market as Market, line: o.line === null ? null : Number(o.line), selection: o.selection }),
      odd: Number(o.odd),
      bookmaker: o.bookmaker_name,
    }));
    const pick = bestPick(prediction.probabilities as ProbabilityMap, odds);
    if (!pick) continue;
    const ref = parseProbabilityKey(pick.key)!;
    inserts.push({
      prediction_id: prediction.id,
      event_id: e.id,
      competition_id: e.competition_id,
      sport: e.sport,
      period: ref.period,
      market: ref.market,
      line: ref.line,
      selection: ref.selection,
      probability: Math.min(0.9999, Math.max(0.0001, Math.round(pick.probability * 10000) / 10000)),
      best_odd: pick.odd,
      bookmaker_name: pick.bookmaker,
      implied_probability: pick.odd ? Math.round((1 / pick.odd) * 10000) / 10000 : null,
      edge: pick.edge === null ? null : Math.round(pick.edge * 10000) / 10000,
      is_value_bet: pick.edge !== null && pick.edge >= 0.05,
      confidence: pick.confidence,
      is_premium: true,
    });
    budget -= 1;
  }
  if (inserts.length) {
    const { error } = await ctx.db.from("prediction_picks").upsert(inserts, { onConflict: "event_id,period,market,line", ignoreDuplicates: true });
    if (error) throw new Error(`Publication : ${error.message}`);
  }

  // Pronostics gratuits du jour : les plus solides des matchs d'aujourd'hui et demain
  const freeTarget = Number((await ctx.db.from("app_settings").select("value").eq("key", "free_picks_per_day").maybeSingle()).data?.value ?? 3);
  const { count: freeToday } = await ctx.db
    .from("prediction_picks")
    .select("id", { count: "exact", head: true })
    .eq("is_premium", false)
    .gte("published_at", startOfDay);
  const missing = Math.max(0, freeTarget - (freeToday ?? 0));
  if (missing > 0) {
    const { data: best } = await ctx.db
      .from("prediction_picks")
      .select("id")
      .eq("is_premium", true)
      .eq("result", "pending")
      .gte("published_at", startOfDay)
      .order("confidence", { ascending: false })
      .order("probability", { ascending: false })
      .limit(missing);
    const ids = (best ?? []).map((b) => b.id);
    if (ids.length) await ctx.db.from("prediction_picks").update({ is_premium: false }).in("id", ids);
  }
  return { items: inserts.length };
}

// ---------------------------------------------------------------------------
// Règlement des résultats
// ---------------------------------------------------------------------------

export async function runSettlement(ctx: Ctx, options: { maxEvents?: number } = {}) {
  const { data: events } = await ctx.db
    .from("events")
    .select("id, sport, status_group, starts_at, home_team_id, away_team_id, home_score, away_score, period_scores")
    .in("status_group", ["finished", "cancelled", "postponed"])
    .is("settled_at", null)
    .lte("starts_at", ctx.now.toISOString())
    .order("starts_at")
    .limit(options.maxEvents ?? 300);

  let settledItems = 0;
  const touchedCoupons = new Set<string>();
  for (const e of events ?? []) {
    if (!isSportCode(e.sport)) continue;
    const age = ctx.now.getTime() - Date.parse(e.starts_at);
    // Match reporté depuis plus de 2 jours : on rembourse
    const status = (e.status_group === "postponed" && age > 2 * DAY ? "cancelled" : e.status_group) as StatusGroup;
    if (status === "postponed") continue;

    const [{ data: picks }, { data: selections }, { data: incidentRows }] = await Promise.all([
      ctx.db.from("prediction_picks").select("id, period, market, line, selection").eq("event_id", e.id).eq("result", "pending"),
      ctx.db.from("coupon_selections").select("id, coupon_id, period, market, line, selection").eq("event_id", e.id).eq("result", "pending"),
      ctx.db.from("event_incidents").select("minute, extra_minute, type, detail, team_id").eq("event_id", e.id),
    ]);
    const incidents: SettleIncident[] | null = incidentRows?.length
      ? incidentRows.map((i) => ({
          minute: i.minute,
          extraMinute: i.extra_minute,
          type: i.type,
          detail: i.detail,
          side: i.team_id === e.home_team_id ? 1 : i.team_id === e.away_team_id ? 2 : null,
        }))
      : null;

    const settle = (s: { period: string; market: string; line: number | null; selection: string }): PickResult | null => {
      const outcome = settleSelection({
        sport: e.sport as SportCode,
        ref: { period: s.period as Period, market: s.market as Market, line: s.line === null ? null : Number(s.line), selection: s.selection },
        status,
        homeScore: e.home_score,
        awayScore: e.away_score,
        periodScores: e.period_scores as Record<string, [number | null, number | null]> | null,
        incidents,
      });
      // Résultat impossible à déterminer 3 jours après : remboursé
      return outcome ?? (age > 3 * DAY ? "void" : null);
    };

    let pending = 0;
    const nowIso = ctx.now.toISOString();
    for (const p of picks ?? []) {
      const r = settle(p);
      if (!r) {
        pending += 1;
        continue;
      }
      await ctx.db.from("prediction_picks").update({ result: r, settled_at: nowIso }).eq("id", p.id);
      settledItems += 1;
    }
    for (const s of selections ?? []) {
      const r = settle(s);
      if (!r) {
        pending += 1;
        continue;
      }
      await ctx.db.from("coupon_selections").update({ result: r }).eq("id", s.id);
      touchedCoupons.add(s.coupon_id);
      settledItems += 1;
    }
    if (pending === 0) await ctx.db.from("events").update({ settled_at: nowIso }).eq("id", e.id);
  }

  // Coupons : perdus dès qu'une sélection est perdue, gagnés quand tout est réglé
  for (const couponId of touchedCoupons) {
    const { data: legs } = await ctx.db.from("coupon_selections").select("result").eq("coupon_id", couponId);
    const status = couponResult((legs ?? []).map((l) => l.result));
    if (status !== "pending") await ctx.db.from("coupons").update({ status, settled_at: ctx.now.toISOString() }).eq("id", couponId).eq("status", "pending");
  }
  return { items: settledItems, details: { events: (events ?? []).length, coupons: touchedCoupons.size } };
}
