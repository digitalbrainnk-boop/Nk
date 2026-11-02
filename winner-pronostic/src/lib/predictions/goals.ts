import { type LineOutcome, clamp, distributionOf, lineOutcome, outer, poissonVector, resolveTies, sumWhere } from "./math";
import type { Market, Period } from "./markets";
import type { MarketProbability } from "./types";

/**
 * Modèle des sports « à buts » (football, hockey, baseball) : les buts de
 * chaque équipe suivent une loi de Poisson de moyenne λ (domicile) et μ
 * (extérieur). Pour le football, la correction de Dixon-Coles ajuste les
 * petits scores (0-0, 1-0, 0-1, 1-1), sous-estimés par Poisson seul.
 *
 * À partir de la matrice des scores on déduit TOUS les marchés : 1X2, double
 * chance, totaux (y compris asiatiques), totaux par équipe, handicaps, les deux
 * marquent, score exact, combinés, mi-temps, MT-Fin, intervalles de temps…
 */

/** Matrice des scores [buts domicile][buts extérieur] (somme = 1). */
export function scoreMatrix(lambda: number, mu: number, rho = 0, maxGoals = 10): number[][] {
  const m = outer(poissonVector(lambda, maxGoals), poissonVector(mu, maxGoals));
  if (rho !== 0) {
    m[0][0] *= Math.max(0, 1 - lambda * mu * rho);
    m[0][1] *= Math.max(0, 1 + lambda * rho);
    m[1][0] *= Math.max(0, 1 + mu * rho);
    m[1][1] *= Math.max(0, 1 - rho);
  }
  const total = m.flat().reduce((a, b) => a + b, 0);
  return m.map((row) => row.map((p) => p / total));
}

const range = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let x = from; x <= to + 1e-9; x += step) out.push(Math.round(x * 100) / 100);
  return out;
};

type Push = (period: Period, market: Market, line: number | null, selection: string, probability: number, outcome?: LineOutcome, basis?: MarketProbability["basis"]) => void;

function collector() {
  const markets: MarketProbability[] = [];
  const push: Push = (period, market, line, selection, probability, outcome, basis = "model") => {
    markets.push({ period, market, line, selection, probability: clamp(probability, 0, 1), outcome, basis });
  };
  const pushLine = (period: Period, market: Market, line: number, selection: string, outcome: LineOutcome) =>
    push(period, market, line, selection, outcome.win + outcome.halfWin, outcome.push + outcome.halfWin + outcome.halfLoss > 1e-9 ? outcome : undefined);
  return { markets, push, pushLine };
}

export type ScoreMarketsConfig = {
  totalLines: number[];
  teamTotalLines: number[];
  handicapLines: number[];
  comboLines: number[];
  correctScoreMax: number;
  /** Marchés « avancés » (combinés, sans encaisser…) : football uniquement. */
  advanced: boolean;
  /** Remplace le 1X2 par le vainqueur prolongations incluses pour les handicaps (hockey, baseball). */
  tieHomeShare?: number;
};

/** Marchés déduits d'une matrice de scores pour une période donnée. */
export function scoreMarkets(period: Period, matrix: number[][], config: ScoreMarketsConfig, push: Push, pushLine: (p: Period, m: Market, l: number, s: string, o: LineOutcome) => void) {
  const home = sumWhere(matrix, (h, a) => h > a);
  const draw = sumWhere(matrix, (h, a) => h === a);
  const away = 1 - home - draw;

  push(period, "1X2", null, "1", home);
  push(period, "1X2", null, "X", draw);
  push(period, "1X2", null, "2", away);
  push(period, "DC", null, "1X", home + draw);
  push(period, "DC", null, "12", home + away);
  push(period, "DC", null, "X2", away + draw);

  const totals = distributionOf(matrix, (h, a) => h + a);
  const homeGoals = distributionOf(matrix, (h) => h);
  const awayGoals = distributionOf(matrix, (_h, a) => a);
  let diff = distributionOf(matrix, (h, a) => h - a);

  if (config.tieHomeShare !== undefined) {
    // Prolongations / tirs au but / manches supplémentaires : le nul n'existe pas pour le vainqueur
    diff = resolveTies(diff, config.tieHomeShare);
    push(period, "ML", null, "1", home + draw * config.tieHomeShare);
    push(period, "ML", null, "2", away + draw * (1 - config.tieHomeShare));
  } else {
    push(period, "DNB", null, "1", home, { win: home, halfWin: 0, push: draw, halfLoss: 0, loss: away });
    push(period, "DNB", null, "2", away, { win: away, halfWin: 0, push: draw, halfLoss: 0, loss: home });
  }

  for (const line of config.totalLines) {
    pushLine(period, "TOTAL", line, "OVER", lineOutcome(totals, line, (v, l) => v - l));
    pushLine(period, "TOTAL", line, "UNDER", lineOutcome(totals, line, (v, l) => l - v));
  }
  for (const line of config.teamTotalLines) {
    pushLine(period, "TT1", line, "OVER", lineOutcome(homeGoals, line, (v, l) => v - l));
    pushLine(period, "TT1", line, "UNDER", lineOutcome(homeGoals, line, (v, l) => l - v));
    pushLine(period, "TT2", line, "OVER", lineOutcome(awayGoals, line, (v, l) => v - l));
    pushLine(period, "TT2", line, "UNDER", lineOutcome(awayGoals, line, (v, l) => l - v));
  }
  for (const line of config.handicapLines) {
    pushLine(period, "HCP", line, "1", lineOutcome(diff, line, (v, l) => v + l));
    pushLine(period, "HCP", line, "2", lineOutcome(diff, line, (v, l) => -(v + l)));
  }

  const btts = sumWhere(matrix, (h, a) => h > 0 && a > 0);
  push(period, "BTTS", null, "YES", btts);
  push(period, "BTTS", null, "NO", 1 - btts);

  const odd = sumWhere(matrix, (h, a) => (h + a) % 2 === 1);
  push(period, "ODD_EVEN", null, "ODD", odd);
  push(period, "ODD_EVEN", null, "EVEN", 1 - odd);

  matrix.forEach((row, h) =>
    row.forEach((p, a) => {
      if (h <= config.correctScoreMax && a <= config.correctScoreMax && p >= 0.0005) push(period, "CS", null, `${h}-${a}`, p);
    }),
  );

  if (!config.advanced) return;

  const result = (h: number, a: number) => (h > a ? "1" : h === a ? "X" : "2");
  const dcOf: Record<string, string[]> = { "1X": ["1", "X"], "12": ["1", "2"], X2: ["X", "2"] };
  for (const line of config.comboLines) {
    for (const r of ["1", "X", "2"]) {
      push(period, "RES_TOTAL", line, `${r}&OVER`, sumWhere(matrix, (h, a) => result(h, a) === r && h + a > line));
      push(period, "RES_TOTAL", line, `${r}&UNDER`, sumWhere(matrix, (h, a) => result(h, a) === r && h + a < line));
    }
    for (const [dc, results] of Object.entries(dcOf)) {
      push(period, "DC_TOTAL", line, `${dc}&OVER`, sumWhere(matrix, (h, a) => results.includes(result(h, a)) && h + a > line));
      push(period, "DC_TOTAL", line, `${dc}&UNDER`, sumWhere(matrix, (h, a) => results.includes(result(h, a)) && h + a < line));
    }
  }
  for (const r of ["1", "X", "2"]) {
    push(period, "RES_BTTS", null, `${r}&YES`, sumWhere(matrix, (h, a) => result(h, a) === r && h > 0 && a > 0));
    push(period, "RES_BTTS", null, `${r}&NO`, sumWhere(matrix, (h, a) => result(h, a) === r && (h === 0 || a === 0)));
  }
  for (const [dc, results] of Object.entries(dcOf)) {
    push(period, "DC_BTTS", null, `${dc}&YES`, sumWhere(matrix, (h, a) => results.includes(result(h, a)) && h > 0 && a > 0));
    push(period, "DC_BTTS", null, `${dc}&NO`, sumWhere(matrix, (h, a) => results.includes(result(h, a)) && (h === 0 || a === 0)));
  }
  push(period, "WIN_NIL", null, "1", sumWhere(matrix, (h, a) => h > a && a === 0));
  push(period, "WIN_NIL", null, "2", sumWhere(matrix, (h, a) => a > h && h === 0));
  push(period, "CLEAN_SHEET", null, "1", sumWhere(matrix, (_h, a) => a === 0));
  push(period, "CLEAN_SHEET", null, "2", sumWhere(matrix, (h) => h === 0));
  const drawGoals = sumWhere(matrix, (h, a) => h === a && h > 0);
  push(period, "DRAW_GOALS", null, "YES", drawGoals);
  push(period, "DRAW_GOALS", null, "NO", 1 - drawGoals);
}

// ---------------------------------------------------------------------------
// Football
// ---------------------------------------------------------------------------

export const GOAL_INTERVALS = ["1-15", "16-30", "31-45", "46-60", "61-75", "76-90"] as const;

export type FootballOptions = {
  /** Paramètre de Dixon-Coles (négatif : plus de 0-0 et 1-1 que Poisson). */
  rho?: number;
  /** Part des buts marqués en 1re mi-temps (≈ 45 % dans les grands championnats). */
  firstHalfShare?: number;
  /** Pénaltys accordés par match (moyenne de la ligue). */
  penaltyRate?: number;
  /** Expulsions par match (moyenne de la ligue). */
  redCardRate?: number;
  /** Corners moyens attendus par équipe. */
  corners?: { home: number; away: number } | null;
  /** Cartons moyens attendus par équipe. */
  cards?: { home: number; away: number } | null;
  /** Buteurs : part des buts de l'équipe et part du temps de jeu attendue. */
  scorers?: { id: string; name: string; team: 1 | 2; goalShare: number; minutesShare: number }[];
};

export const FOOTBALL_DEFAULTS = { rho: -0.08, firstHalfShare: 0.45, penaltyRate: 0.28, redCardRate: 0.16 };

/** Buts attendus d'une équipe entre la minute a et b (intensité constante dans chaque mi-temps). */
function expectedBetween(rate1H: number, rate2H: number, from: number, to: number): number {
  const overlap = (a: number, b: number, c: number, d: number) => Math.max(0, Math.min(b, d) - Math.max(a, c));
  return (rate1H / 45) * overlap(from, to, 0, 45) + (rate2H / 45) * overlap(from, to, 45, 90);
}

export function footballMarkets(lambda: number, mu: number, options: FootballOptions = {}) {
  const rho = options.rho ?? FOOTBALL_DEFAULTS.rho;
  const share = options.firstHalfShare ?? FOOTBALL_DEFAULTS.firstHalfShare;
  const { markets, push, pushLine } = collector();

  const full = scoreMatrix(lambda, mu, rho, 10);
  scoreMarkets(
    "FT",
    full,
    {
      totalLines: range(0.5, 6.5, 0.25),
      teamTotalLines: range(0.5, 3.5, 0.25),
      handicapLines: range(-3.5, 3.5, 0.25),
      comboLines: [1.5, 2.5, 3.5, 4.5],
      correctScoreMax: 6,
      advanced: true,
    },
    push,
    pushLine,
  );

  // Mi-temps : buts indépendants dans chaque période (Poisson)
  const [l1, l2, m1, m2] = [lambda * share, lambda * (1 - share), mu * share, mu * (1 - share)];
  const first = scoreMatrix(l1, m1, 0, 8);
  const second = scoreMatrix(l2, m2, 0, 8);
  const halfConfig = { totalLines: [0.5, 1.5, 2.5], teamTotalLines: [0.5, 1.5], handicapLines: [-0.5, 0.5], comboLines: [], correctScoreMax: 3, advanced: false };
  scoreMarkets("1H", first, halfConfig, push, pushLine);
  scoreMarkets("2H", second, halfConfig, push, pushLine);

  // MT-Fin
  const outcome = (h: number, a: number) => (h > a ? "1" : h === a ? "X" : "2");
  const htft = new Map<string, number>();
  first.forEach((r1, h1) =>
    r1.forEach((p1, a1) =>
      second.forEach((r2, h2) =>
        r2.forEach((p2, a2) => {
          const key = `${outcome(h1, a1)}/${outcome(h1 + h2, a1 + a2)}`;
          htft.set(key, (htft.get(key) ?? 0) + p1 * p2);
        }),
      ),
    ),
  );
  for (const [key, p] of htft) push("FT", "HTFT", null, key, p);

  // Marchés « mi-temps » du match entier
  const win1 = sumWhere(first, (h, a) => h > a);
  const win2 = sumWhere(second, (h, a) => h > a);
  const lose1 = sumWhere(first, (h, a) => h < a);
  const lose2 = sumWhere(second, (h, a) => h < a);
  const draw1 = 1 - win1 - lose1;
  const draw2 = 1 - win2 - lose2;
  const both = (1 - first[0][0]) * (1 - second[0][0]);
  push("FT", "SCORE_BOTH_HALVES", null, "YES", both);
  push("FT", "SCORE_BOTH_HALVES", null, "NO", 1 - both);
  const homeBoth = (1 - Math.exp(-l1)) * (1 - Math.exp(-l2));
  const awayBoth = (1 - Math.exp(-m1)) * (1 - Math.exp(-m2));
  push("FT", "TEAM_SCORE_BOTH_HALVES", null, "1:YES", homeBoth);
  push("FT", "TEAM_SCORE_BOTH_HALVES", null, "1:NO", 1 - homeBoth);
  push("FT", "TEAM_SCORE_BOTH_HALVES", null, "2:YES", awayBoth);
  push("FT", "TEAM_SCORE_BOTH_HALVES", null, "2:NO", 1 - awayBoth);
  push("FT", "WIN_BOTH_HALVES", null, "1", win1 * win2);
  push("FT", "WIN_BOTH_HALVES", null, "2", lose1 * lose2);
  push("FT", "WIN_EITHER_HALF", null, "1", 1 - (1 - win1) * (1 - win2));
  push("FT", "WIN_EITHER_HALF", null, "2", 1 - (1 - lose1) * (1 - lose2));
  push("FT", "DRAW_BOTH_HALVES", null, "YES", draw1 * draw2);
  push("FT", "DRAW_BOTH_HALVES", null, "NO", 1 - draw1 * draw2);

  const t1 = poissonVector(l1 + m1, 12);
  const t2 = poissonVector(l2 + m2, 12);
  let more1 = 0;
  let equal = 0;
  t1.forEach((p, i) => t2.forEach((q, j) => {
    if (i > j) more1 += p * q;
    else if (i === j) equal += p * q;
  }));
  push("FT", "HIGHEST_HALF", null, "1H", more1);
  push("FT", "HIGHEST_HALF", null, "2H", 1 - more1 - equal);
  push("FT", "HIGHEST_HALF", null, "EQ", equal);

  // Premier but et intervalles de temps (processus de Poisson)
  const noGoal = full[0][0];
  push("FT", "FIRST_GOAL", null, "1", (1 - noGoal) * (lambda / (lambda + mu)));
  push("FT", "FIRST_GOAL", null, "2", (1 - noGoal) * (mu / (lambda + mu)));
  push("FT", "FIRST_GOAL", null, "NONE", noGoal);
  for (const interval of GOAL_INTERVALS) {
    const [a, b] = interval.split("-").map(Number);
    const expected = expectedBetween(l1 + m1, l2 + m2, a - 1, b);
    push("FT", "GOAL_INTERVAL", null, `${interval}:YES`, 1 - Math.exp(-expected));
    push("FT", "GOAL_INTERVAL", null, `${interval}:NO`, Math.exp(-expected));
    for (const [team, r1, r2] of [["1", l1, l2], ["2", m1, m2]] as const) {
      const before = expectedBetween(r1, r2, 0, a - 1);
      const during = expectedBetween(r1, r2, a - 1, b);
      push("FT", "TEAM_FIRST_GOAL_INTERVAL", null, `${team}:${interval}`, Math.exp(-before) * (1 - Math.exp(-during)));
    }
  }

  // Pénaltys et expulsions (moyennes de la ligue, ajustées par le volume offensif)
  const pen = (options.penaltyRate ?? FOOTBALL_DEFAULTS.penaltyRate) * clamp((lambda + mu) / 2.7, 0.7, 1.4);
  const red = options.redCardRate ?? FOOTBALL_DEFAULTS.redCardRate;
  const pPen = 1 - Math.exp(-pen);
  const pRed = 1 - Math.exp(-red);
  push("FT", "PENALTY", null, "YES", pPen, undefined, "league_average");
  push("FT", "PENALTY", null, "NO", 1 - pPen, undefined, "league_average");
  push("FT", "RED_CARD", null, "YES", pRed, undefined, "league_average");
  push("FT", "RED_CARD", null, "NO", 1 - pRed, undefined, "league_average");
  push("FT", "PEN_RED_COMBO", null, "PEN_AND_RED", pPen * pRed, undefined, "league_average");
  push("FT", "PEN_RED_COMBO", null, "PEN_NO_RED", pPen * (1 - pRed), undefined, "league_average");
  push("FT", "PEN_RED_COMBO", null, "RED_NO_PEN", (1 - pPen) * pRed, undefined, "league_average");
  push("FT", "PEN_RED_COMBO", null, "NEITHER", (1 - pPen) * (1 - pRed), undefined, "league_average");
  push("FT", "PEN_RED_COMBO", null, "PEN_OR_RED", 1 - (1 - pPen) * (1 - pRed), undefined, "league_average");

  // Corners et cartons (si les moyennes des équipes sont connues)
  for (const [market, means, lines] of [
    ["CORNERS", options.corners, range(7.5, 12.5, 1)],
    ["CARDS", options.cards, range(2.5, 6.5, 1)],
  ] as const) {
    if (!means) continue;
    const dist = new Map(poissonVector(means.home + means.away, 40).map((p, k) => [k, p] as [number, number]));
    for (const line of lines) {
      pushLine("FT", market, line, "OVER", lineOutcome(dist, line, (v, l) => v - l));
      pushLine("FT", market, line, "UNDER", lineOutcome(dist, line, (v, l) => l - v));
    }
  }

  // Buteurs
  for (const s of options.scorers ?? []) {
    const teamRate = s.team === 1 ? lambda : mu;
    const rate = teamRate * clamp(s.goalShare, 0, 1) * clamp(s.minutesShare, 0, 1);
    push("FT", "SCORER", null, `P${s.id}`, 1 - Math.exp(-rate));
  }

  return { markets, scoreMatrix: full };
}

// ---------------------------------------------------------------------------
// Hockey sur glace et baseball (Poisson sans correction, nul départagé)
// ---------------------------------------------------------------------------

export function hockeyMarkets(lambda: number, mu: number) {
  const { markets, push, pushLine } = collector();
  const full = scoreMatrix(lambda, mu, 0, 14);
  scoreMarkets(
    "FT",
    full,
    {
      totalLines: range(3.5, 7.5, 0.5),
      teamTotalLines: range(1.5, 4.5, 1),
      handicapLines: [-2.5, -1.5, 1.5, 2.5],
      comboLines: [],
      correctScoreMax: 6,
      advanced: false,
      tieHomeShare: 0.52,
    },
    push,
    pushLine,
  );
  // 1X2 « temps réglementaire » conservé : on ajoute aussi la double chance
  for (const period of ["P1", "P2", "P3"] as const) {
    const m = scoreMatrix(lambda / 3, mu / 3, 0, 8);
    scoreMarkets(period, m, { totalLines: [0.5, 1.5, 2.5], teamTotalLines: [], handicapLines: [], comboLines: [], correctScoreMax: -1, advanced: false }, push, pushLine);
  }
  const noGoal = full[0][0];
  push("FT", "FIRST_GOAL", null, "1", (1 - noGoal) * (lambda / (lambda + mu)));
  push("FT", "FIRST_GOAL", null, "2", (1 - noGoal) * (mu / (lambda + mu)));
  push("FT", "FIRST_GOAL", null, "NONE", noGoal);
  return { markets, scoreMatrix: full };
}

export function baseballMarkets(lambda: number, mu: number) {
  const { markets, push, pushLine } = collector();
  const full = scoreMatrix(lambda, mu, 0, 20);
  scoreMarkets(
    "FT",
    full,
    {
      totalLines: range(6.5, 11.5, 1),
      teamTotalLines: range(2.5, 6.5, 1),
      handicapLines: [-2.5, -1.5, 1.5, 2.5],
      comboLines: [],
      correctScoreMax: -1,
      advanced: false,
      tieHomeShare: 0.53,
    },
    push,
    pushLine,
  );
  return { markets: markets.filter((m) => m.market !== "1X2" && m.market !== "DC" && m.market !== "BTTS"), scoreMatrix: full };
}
