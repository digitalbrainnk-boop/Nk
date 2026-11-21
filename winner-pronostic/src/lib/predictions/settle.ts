import type { SportCode, StatusGroup } from "@/lib/sports/catalog";
import type { SelectionRef } from "./markets";

/**
 * Règlement d'une sélection (gagnée, perdue, remboursée) à partir du score
 * final, des scores par période et, si besoin, des faits de match.
 * Renvoie null quand le résultat ne peut pas (encore) être déterminé.
 */

export type PickResult = "won" | "lost" | "void";

export type SettleIncident = { minute: number | null; extraMinute: number | null; type: string; detail: string | null; side: 1 | 2 | null };

export type SettleInput = {
  sport: SportCode;
  ref: SelectionRef;
  status: StatusGroup;
  homeScore: number | null;
  awayScore: number | null;
  periodScores: Record<string, [number | null, number | null]> | null;
  /** Faits de match (null = inconnus). */
  incidents: SettleIncident[] | null;
};

type Score = [number, number];

function score(pair: [number | null, number | null] | undefined): Score | null {
  return pair && pair[0] !== null && pair[1] !== null ? [pair[0], pair[1]] : null;
}

const add = (a: Score, b: Score): Score => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Score, b: Score): Score => [a[0] - b[0], a[1] - b[1]];
const result = ([h, a]: Score) => (h > a ? "1" : h === a ? "X" : "2");

/** Score du temps réglementaire (les marchés 1X2, totaux… du football portent sur 90 minutes). */
function regulation(input: SettleInput): Score | null {
  const total = input.homeScore !== null && input.awayScore !== null ? ([input.homeScore, input.awayScore] as Score) : null;
  const ps = input.periodScores ?? {};
  if (input.sport === "football") return score(ps.ft) ?? (ps.et || ps.pen ? null : total);
  if (input.sport === "ice_hockey") {
    const p = [score(ps.p1), score(ps.p2), score(ps.p3)];
    return p.every(Boolean) ? (p as Score[]).reduce(add) : ps.ot || ps.pen ? null : total;
  }
  if (input.sport === "basketball" || input.sport === "american_football") {
    const q = [score(ps.q1), score(ps.q2), score(ps.q3), score(ps.q4)];
    return q.every(Boolean) ? (q as Score[]).reduce(add) : total;
  }
  return total;
}

function scoreFor(input: SettleInput): Score | null {
  const ps = input.periodScores ?? {};
  const total = input.homeScore !== null && input.awayScore !== null ? ([input.homeScore, input.awayScore] as Score) : null;
  const { period, market } = input.ref;
  // « Vainqueur », handicaps et totaux du basket/hockey/baseball : prolongations incluses
  const includesOvertime = market === "ML" || (input.sport !== "football" && input.sport !== "handball" && input.sport !== "rugby" && (market === "HCP" || market === "TOTAL" || market === "TT1" || market === "TT2" || market === "ODD_EVEN"));
  switch (period) {
    case "FT":
      return includesOvertime ? total : regulation(input);
    case "1H":
      return score(ps.ht);
    case "2H": {
      const full = regulation(input);
      const ht = score(ps.ht);
      return full && ht ? sub(full, ht) : null;
    }
    case "P1":
    case "P2":
    case "P3":
      return score(ps[period.toLowerCase()]);
    case "Q1":
    case "Q2":
    case "Q3":
    case "Q4":
      return score(ps[period.toLowerCase()]);
    case "S1":
    case "S2":
    case "S3":
    case "S4":
    case "S5": {
      const set = score(ps[period.toLowerCase()]);
      return set ? (set[0] > set[1] ? [1, 0] : [0, 1]) : null;
    }
  }
}

/** Gagné / perdu / remboursé pour une ligne (quart de ligne : demi-gain → gagné, demi-perte → perdu). */
function lineResult(value: number, line: number, over: boolean): PickResult {
  const margin = over ? value - line : line - value;
  if (Math.abs(margin) < 1e-9) return "void";
  return margin > 0 ? "won" : "lost";
}

const yes = (b: boolean, selection: string): PickResult => ((selection === "YES") === b ? "won" : "lost");
const is = (b: boolean): PickResult => (b ? "won" : "lost");

/** Minute d'un but ; le temps additionnel (45+2) reste rattaché à la 45e minute, comme chez les bookmakers. */
function goalMinute(i: SettleIncident): number {
  return i.minute ?? 0;
}

export function settleSelection(input: SettleInput): PickResult | null {
  if (input.status === "cancelled") return "void";
  if (input.status !== "finished") return null;
  const { market, line, selection } = input.ref;
  const s = scoreFor(input);
  const goals = (input.incidents ?? []).filter((i) => i.type.toLowerCase() === "goal" && !/missed/i.test(i.detail ?? ""));

  if (market === "PENALTY" || market === "RED_CARD" || market === "PEN_RED_COMBO") {
    if (!input.incidents) return null;
    const pen = input.incidents.some((i) => /penalty/i.test(i.detail ?? "") && i.type.toLowerCase() !== "var");
    const red = input.incidents.some((i) => i.type.toLowerCase() === "card" && /red|second yellow/i.test(i.detail ?? ""));
    if (market === "PENALTY") return yes(pen, selection);
    if (market === "RED_CARD") return yes(red, selection);
    return is(
      { PEN_AND_RED: pen && red, PEN_NO_RED: pen && !red, RED_NO_PEN: red && !pen, NEITHER: !pen && !red, PEN_OR_RED: pen || red }[selection] ?? false,
    );
  }
  if (market === "CORNERS" || market === "CARDS" || market === "SCORER") return null;

  if (market === "FIRST_GOAL" || market === "GOAL_INTERVAL" || market === "TEAM_FIRST_GOAL_INTERVAL") {
    const reg = regulation(input);
    if (reg && reg[0] + reg[1] === 0) {
      if (market === "FIRST_GOAL") return is(selection === "NONE");
      if (market === "GOAL_INTERVAL") return is(selection.endsWith(":NO"));
      return "lost";
    }
    if (!input.incidents || !goals.length || goals.some((g) => g.side === null)) return null;
    const sorted = [...goals].sort((a, b) => goalMinute(a) - goalMinute(b));
    if (market === "FIRST_GOAL") return is(String(sorted[0].side) === selection);
    if (market === "GOAL_INTERVAL") {
      const [rangeText, yn] = selection.split(":");
      const [a, b] = rangeText.split("-").map(Number);
      return yes(goals.some((g) => goalMinute(g) >= a && goalMinute(g) <= b), yn);
    }
    const [team, rangeText] = selection.split(":");
    const [a, b] = rangeText.split("-").map(Number);
    const first = sorted.find((g) => String(g.side) === team);
    return is(first !== undefined && goalMinute(first) >= a && goalMinute(first) <= b);
  }

  // Marchés « deux mi-temps » (football)
  if (["SCORE_BOTH_HALVES", "TEAM_SCORE_BOTH_HALVES", "WIN_BOTH_HALVES", "WIN_EITHER_HALF", "DRAW_BOTH_HALVES", "HIGHEST_HALF", "HTFT"].includes(market)) {
    const full = regulation(input);
    const first = score(input.periodScores?.ht);
    if (!full || !first) return null;
    const second = sub(full, first);
    switch (market) {
      case "SCORE_BOTH_HALVES":
        return yes(first[0] + first[1] > 0 && second[0] + second[1] > 0, selection);
      case "TEAM_SCORE_BOTH_HALVES": {
        const [team, yn] = selection.split(":");
        const i = team === "1" ? 0 : 1;
        return yes(first[i] > 0 && second[i] > 0, yn);
      }
      case "WIN_BOTH_HALVES":
        return is(result(first) === selection && result(second) === selection);
      case "WIN_EITHER_HALF":
        return is(result(first) === selection || result(second) === selection);
      case "DRAW_BOTH_HALVES":
        return yes(result(first) === "X" && result(second) === "X", selection);
      case "HIGHEST_HALF": {
        const t1 = first[0] + first[1];
        const t2 = second[0] + second[1];
        return is((t1 > t2 ? "1H" : t2 > t1 ? "2H" : "EQ") === selection);
      }
      case "HTFT":
        return is(`${result(first)}/${result(full)}` === selection);
    }
  }

  if (!s) return null;
  const [h, a] = s;
  const total = h + a;
  const r = result(s);
  switch (market) {
    case "1X2":
      return is(r === selection);
    case "DC":
      return is(selection.includes(r));
    case "DNB":
      return r === "X" ? "void" : is(r === selection);
    case "ML":
      return h === a ? "void" : is(r === selection);
    case "TOTAL":
      return lineResult(total, line ?? 0, selection === "OVER");
    case "TT1":
      return lineResult(h, line ?? 0, selection === "OVER");
    case "TT2":
      return lineResult(a, line ?? 0, selection === "OVER");
    case "HCP": {
      const margin = h - a + (line ?? 0);
      return lineResult(selection === "1" ? margin : -margin, 0, true);
    }
    case "BTTS":
      return yes(h > 0 && a > 0, selection);
    case "CS":
      return is(`${h}-${a}` === selection);
    case "ODD_EVEN":
      return is((total % 2 === 1 ? "ODD" : "EVEN") === selection);
    case "RES_TOTAL":
    case "DC_TOTAL": {
      const [res, ou] = selection.split("&");
      const okResult = market === "RES_TOTAL" ? r === res : res.includes(r);
      const okTotal = lineResult(total, line ?? 0, ou === "OVER");
      return okTotal === "void" ? (okResult ? "void" : "lost") : is(okResult && okTotal === "won");
    }
    case "RES_BTTS":
    case "DC_BTTS": {
      const [res, yn] = selection.split("&");
      const okResult = market === "RES_BTTS" ? r === res : res.includes(r);
      return is(okResult && (yn === "YES") === (h > 0 && a > 0));
    }
    case "WIN_NIL":
      return is(selection === "1" ? h > a && a === 0 : a > h && h === 0);
    case "CLEAN_SHEET":
      return is(selection === "1" ? a === 0 : h === 0);
    case "DRAW_GOALS":
      return yes(h === a && h > 0, selection);
    default:
      return null;
  }
}

/** Résultat d'un coupon à partir des résultats de ses sélections. */
export function couponResult(results: ("pending" | PickResult)[]): "pending" | PickResult {
  if (results.includes("lost")) return "lost";
  if (results.includes("pending")) return "pending";
  if (results.every((r) => r === "void")) return "void";
  return "won";
}
