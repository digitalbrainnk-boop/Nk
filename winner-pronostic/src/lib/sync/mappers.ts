import { type Market, type Period, isValidSelection } from "@/lib/predictions/markets";
import { type SportCode, type StatusGroup, statusGroupOf } from "@/lib/sports/catalog";

/**
 * Conversion des réponses d'API-Sports (8 sports aux formats différents) vers
 * un format unique. Les fonctions sont volontairement tolérantes : un champ
 * absent ou inattendu donne « null », jamais une exception, et un élément
 * inutilisable est ignoré (puis signalé dans le journal de synchronisation).
 */

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
export const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

export type NormalizedLeague = {
  externalId: number;
  name: string;
  type: "league" | "cup" | null;
  season: string | null;
  logo: string | null;
  countryName: string;
  countryCode: string | null;
  countryFlag: string | null;
};

export type NormalizedTeam = { externalId: number; name: string; logo: string | null };

export type NormalizedGame = {
  sport: SportCode;
  externalId: number;
  startsAt: string;
  statusShort: string;
  statusLong: string | null;
  statusGroup: StatusGroup;
  elapsed: number | null;
  liveClock: string | null;
  league: NormalizedLeague;
  round: string | null;
  home: NormalizedTeam;
  away: NormalizedTeam;
  homeScore: number | null;
  awayScore: number | null;
  periodScores: Record<string, [number | null, number | null]> | null;
  venueName: string | null;
  venueCity: string | null;
  referee: string | null;
};

function team(v: unknown): NormalizedTeam | null {
  const t = obj(v);
  const id = num(t.id);
  const name = str(t.name);
  return id !== null && name ? { externalId: id, name, logo: str(t.logo) } : null;
}

function leagueType(v: unknown): "league" | "cup" | null {
  const t = str(v)?.toLowerCase();
  return t === "cup" ? "cup" : t === "league" ? "league" : null;
}

function startsAtOf(timestamp: unknown, date: unknown): string | null {
  const ts = num(timestamp);
  if (ts !== null && ts > 0) return new Date(ts * 1000).toISOString();
  const d = str(date);
  if (d && !Number.isNaN(Date.parse(d))) return new Date(d).toISOString();
  return null;
}

const pair = (h: unknown, a: unknown): [number | null, number | null] | null => {
  const ph = num(h);
  const pa = num(a);
  return ph === null && pa === null ? null : [ph, pa];
};

function withEntries(entries: [string, [number | null, number | null] | null][]): Record<string, [number | null, number | null]> | null {
  const out: Record<string, [number | null, number | null]> = {};
  for (const [k, v] of entries) if (v) out[k] = v;
  return Object.keys(out).length ? out : null;
}

/** « 1-0 » (hockey) → [1, 0] */
function dashPair(v: unknown): [number | null, number | null] | null {
  const s = str(v);
  const m = s ? /^(\d+)\s*-\s*(\d+)$/.exec(s) : null;
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function liveClockOf(sport: SportCode, short: string, group: StatusGroup, elapsed: number | null, extra: number | null, timer: string | null): string | null {
  if (group !== "live") return null;
  if (short === "HT") return "MT";
  if (sport === "football") return elapsed !== null ? `${elapsed}${extra ? `+${extra}` : ""}'` : short;
  if (sport === "volleyball" && /^S\d$/.test(short)) return `Set ${short.slice(1)}`;
  if (sport === "baseball" && /^IN\d+$/.test(short)) return `Manche ${short.slice(2)}`;
  return timer ? `${short} ${timer}'` : short;
}

/** Match de football (GET /fixtures). */
function mapFootball(item: Json): NormalizedGame | null {
  const f = obj(item.fixture);
  const l = obj(item.league);
  const teams = obj(item.teams);
  const goals = obj(item.goals);
  const score = obj(item.score);
  const status = obj(f.status);
  const id = num(f.id);
  const startsAt = startsAtOf(f.timestamp, f.date);
  const home = team(teams.home);
  const away = team(teams.away);
  const leagueId = num(l.id);
  const leagueName = str(l.name);
  if (id === null || !startsAt || !home || !away || leagueId === null || !leagueName) return null;
  const short = (str(status.short) ?? "NS").toUpperCase();
  const group = statusGroupOf("football", short);
  const elapsed = num(status.elapsed);
  const half = obj(score.halftime);
  const fullTime = obj(score.fulltime);
  const extraTime = obj(score.extratime);
  const penalty = obj(score.penalty);
  return {
    sport: "football",
    externalId: id,
    startsAt,
    statusShort: short,
    statusLong: str(status.long),
    statusGroup: group,
    elapsed,
    liveClock: liveClockOf("football", short, group, elapsed, num(status.extra), null),
    league: {
      externalId: leagueId,
      name: leagueName,
      type: leagueType(l.type),
      season: str(l.season),
      logo: str(l.logo),
      countryName: str(l.country) ?? "World",
      countryCode: null,
      countryFlag: str(l.flag),
    },
    round: str(l.round),
    home,
    away,
    homeScore: num(goals.home),
    awayScore: num(goals.away),
    periodScores: withEntries([
      ["ht", pair(half.home, half.away)],
      // Score à la fin du temps réglementaire (les marchés « match » portent sur les 90 minutes)
      ["ft", pair(fullTime.home, fullTime.away)],
      ["et", pair(extraTime.home, extraTime.away)],
      ["pen", pair(penalty.home, penalty.away)],
    ]),
    venueName: str(obj(f.venue).name),
    venueCity: str(obj(f.venue).city),
    referee: str(f.referee),
  };
}

/** Matchs des autres sports (GET /games), y compris le format « game » du football américain. */
function mapGeneric(sport: SportCode, item: Json): NormalizedGame | null {
  const game = obj(item.game);
  const status = obj(item.status ?? game.status);
  const l = obj(item.league);
  const country = obj(item.country ?? l.country);
  const teams = obj(item.teams);
  const scores = obj(item.scores);
  const id = num(item.id ?? game.id);
  const date = obj(game.date);
  const startsAt = startsAtOf(item.timestamp ?? date.timestamp, typeof item.date === "string" ? item.date : date.date);
  const home = team(teams.home);
  const away = team(teams.away);
  const leagueId = num(l.id);
  const leagueName = str(l.name);
  if (id === null || !startsAt || !home || !away || leagueId === null || !leagueName) return null;

  const short = (str(status.short) ?? "NS").toUpperCase();
  const group = statusGroupOf(sport, short);
  const timer = str(status.timer ?? item.timer);
  const homeScores = scores.home;
  const awayScores = scores.away;
  const scoreOf = (v: unknown) => (typeof v === "object" && v !== null ? num(obj(v).total) : num(v));

  let periodScores: NormalizedGame["periodScores"] = null;
  if (sport === "basketball" || sport === "american_football") {
    const h = obj(homeScores);
    const a = obj(awayScores);
    periodScores = withEntries([
      ["q1", pair(h.quarter_1, a.quarter_1)],
      ["q2", pair(h.quarter_2, a.quarter_2)],
      ["q3", pair(h.quarter_3, a.quarter_3)],
      ["q4", pair(h.quarter_4, a.quarter_4)],
      ["ot", pair(h.over_time ?? h.overtime, a.over_time ?? a.overtime)],
    ]);
    // Mi-temps = Q1 + Q2 (utile pour les marchés « 1re mi-temps »)
    const q1 = periodScores?.q1;
    const q2 = periodScores?.q2;
    if (periodScores && q1 && q2 && q1[0] !== null && q2[0] !== null && q1[1] !== null && q2[1] !== null) {
      periodScores.ht = [q1[0] + q2[0], q1[1] + q2[1]];
    }
  } else if (sport === "ice_hockey") {
    const p = obj(item.periods);
    periodScores = withEntries([
      ["p1", dashPair(p.first)],
      ["p2", dashPair(p.second)],
      ["p3", dashPair(p.third)],
      ["ot", dashPair(p.overtime)],
      ["pen", dashPair(p.penalties)],
    ]);
  } else if (sport === "baseball") {
    const hi = obj(obj(homeScores).innings);
    const ai = obj(obj(awayScores).innings);
    periodScores = withEntries(Object.keys(hi).map((k) => [`in${k}`, pair(hi[k], ai[k])] as [string, [number | null, number | null] | null]));
  } else {
    const p = obj(item.periods);
    const names: [string, string][] = [
      ["first", sport === "volleyball" ? "s1" : "h1"],
      ["second", sport === "volleyball" ? "s2" : "h2"],
      ["third", "s3"],
      ["fourth", "s4"],
      ["fifth", "s5"],
      ["overtime", "ot"],
    ];
    periodScores = withEntries(names.map(([k, key]) => [key, pair(obj(p[k]).home, obj(p[k]).away)]));
    if (periodScores?.h1) periodScores.ht = periodScores.h1;
  }

  const venue = obj(game.venue);
  return {
    sport,
    externalId: id,
    startsAt,
    statusShort: short,
    statusLong: str(status.long),
    statusGroup: group,
    elapsed: null,
    liveClock: liveClockOf(sport, short, group, null, null, timer),
    league: {
      externalId: leagueId,
      name: leagueName,
      type: leagueType(l.type),
      season: str(l.season),
      logo: str(l.logo),
      countryName: str(country.name) ?? "World",
      countryCode: str(country.code)?.toUpperCase().slice(0, 2) ?? null,
      countryFlag: str(country.flag),
    },
    round: str(item.week ?? game.week ?? item.stage ?? game.stage),
    home,
    away,
    homeScore: scoreOf(homeScores),
    awayScore: scoreOf(awayScores),
    periodScores,
    venueName: str(venue.name),
    venueCity: str(venue.city),
    referee: null,
  };
}

export function mapGame(sport: SportCode, item: unknown): NormalizedGame | null {
  const o = obj(item);
  try {
    return sport === "football" ? mapFootball(o) : mapGeneric(sport, o);
  } catch {
    return null;
  }
}

/** Codes ISO de pays depuis GET /leagues (le football ne les donne pas dans /fixtures). */
export function mapLeagueInfo(sport: SportCode, item: unknown): { league: NormalizedLeague; currentSeason: string | null } | null {
  const o = obj(item);
  const l = obj(o.league ?? o);
  const country = obj(o.country ?? l.country);
  const id = num(l.id);
  const name = str(l.name);
  if (id === null || !name) return null;
  const seasons = arr(o.seasons ?? l.seasons).map(obj);
  const current = seasons.find((s) => s.current === true) ?? seasons[seasons.length - 1];
  const season = current ? str(sport === "football" ? current.year : current.season ?? current.year) : null;
  return {
    league: {
      externalId: id,
      name,
      type: leagueType(l.type),
      season,
      logo: str(l.logo),
      countryName: str(country.name) ?? "World",
      countryCode: str(country.code)?.toUpperCase().slice(0, 2) ?? null,
      countryFlag: str(country.flag),
    },
    currentSeason: season,
  };
}

// ---------------------------------------------------------------------------
// Classements
// ---------------------------------------------------------------------------
export type NormalizedStanding = {
  team: NormalizedTeam;
  group: string;
  rank: number;
  points: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  scored: number;
  conceded: number;
  home: { played: number; won: number; drawn: number; lost: number; scored: number; conceded: number } | null;
  away: { played: number; won: number; drawn: number; lost: number; scored: number; conceded: number } | null;
  form: string | null;
  description: string | null;
};

const n0 = (v: unknown) => num(v) ?? 0;
const totalOf = (v: unknown) => (typeof v === "object" && v !== null ? n0(obj(v).total) : n0(v));

function split(v: unknown) {
  const s = obj(v);
  if (!Object.keys(s).length) return null;
  const goals = obj(s.goals);
  return { played: n0(s.played), won: n0(s.win), drawn: n0(s.draw), lost: n0(s.lose), scored: n0(goals.for), conceded: n0(goals.against) };
}

export function mapStandings(sport: SportCode, response: unknown[]): NormalizedStanding[] {
  // Football : response[0].league.standings = [[…]] ; autres sports : response = [[…]]
  const groups: unknown[] = sport === "football" ? arr(obj(obj(response[0]).league).standings) : response;
  const rows = groups.flatMap((g) => (Array.isArray(g) ? g : [g])).map(obj);
  const out: NormalizedStanding[] = [];
  for (const row of rows) {
    const t = team(row.team);
    if (!t) continue;
    if (sport === "football") {
      const all = split(row.all) ?? { played: 0, won: 0, drawn: 0, lost: 0, scored: 0, conceded: 0 };
      out.push({
        team: t,
        group: str(row.group) ?? "",
        rank: n0(row.rank),
        points: n0(row.points),
        ...all,
        home: split(row.home),
        away: split(row.away),
        form: str(row.form),
        description: str(row.description),
      });
      continue;
    }
    const games = obj(row.games);
    const totals = obj(row.goals ?? (typeof row.points === "object" ? row.points : undefined));
    const groupName = typeof row.group === "object" ? str(obj(row.group).name) : str(row.group);
    const won = Object.keys(games).length ? totalOf(games.win) : n0(row.won);
    const lost = Object.keys(games).length ? totalOf(games.lose) : n0(row.lost);
    const drawn = Object.keys(games).length ? totalOf(games.draw) : n0(row.ties);
    out.push({
      team: t,
      group: groupName ?? str(row.conference) ?? "",
      rank: n0(row.position ?? row.rank),
      points: typeof row.points === "object" ? won * 2 + drawn : n0(row.points),
      played: Object.keys(games).length ? n0(games.played) : won + lost + drawn,
      won,
      drawn,
      lost,
      scored: n0(totals.for),
      conceded: n0(totals.against),
      home: null,
      away: null,
      form: str(row.form),
      description: str(row.description),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cotes
// ---------------------------------------------------------------------------
export type NormalizedOdd = {
  bookmakerId: number;
  bookmakerName: string;
  period: Period;
  market: Market;
  line: number | null;
  selection: string;
  odd: number;
};

const SIDE: Record<string, string> = { home: "1", draw: "X", away: "2", "1": "1", x: "X", "2": "2" };
const YESNO: Record<string, string> = { yes: "YES", no: "NO" };
const DC: Record<string, string> = { "home/draw": "1X", "home/away": "12", "draw/away": "X2", "1x": "1X", "12": "12", x2: "X2" };

const ou = (v: string) => /^(over|under)\s*([\d.,]+)$/i.exec(v.trim());
const parseLine = (s: string) => Number(s.replace(",", "."));

type BetParser = (value: string) => { selection: string; line: number | null } | null;

const sideParser: BetParser = (v) => (SIDE[v.toLowerCase()] ? { selection: SIDE[v.toLowerCase()], line: null } : null);
const yesNoParser: BetParser = (v) => (YESNO[v.toLowerCase()] ? { selection: YESNO[v.toLowerCase()], line: null } : null);
const ouParser: BetParser = (v) => {
  const m = ou(v);
  return m ? { selection: m[1].toUpperCase(), line: parseLine(m[2]) } : null;
};
const handicapParser: BetParser = (v) => {
  const m = /^(home|away)\s*([+-]?[\d.,]+)$/i.exec(v.trim());
  if (!m) return null;
  const line = parseLine(m[2]);
  // Ligne stockée du point de vue de l'équipe 1
  return m[1].toLowerCase() === "home" ? { selection: "1", line } : { selection: "2", line: line === 0 ? 0 : -line };
};

/** Nom de pari (normalisé) → période, marché et analyse de la valeur. */
const BETS: { match: RegExp; period: Period; market: Market; parse: BetParser }[] = [
  { match: /^(match winner|3way result|1x2|full time result)$/, period: "FT", market: "1X2", parse: sideParser },
  { match: /^(home\/away|moneyline|match winner \(incl\. (ot|overtime)\)|winner)$/, period: "FT", market: "ML", parse: sideParser },
  { match: /^double chance$/, period: "FT", market: "DC", parse: (v) => (DC[v.toLowerCase()] ? { selection: DC[v.toLowerCase()], line: null } : null) },
  { match: /^double chance - first half$/, period: "1H", market: "DC", parse: (v) => (DC[v.toLowerCase()] ? { selection: DC[v.toLowerCase()], line: null } : null) },
  { match: /^draw no bet$/, period: "FT", market: "DNB", parse: sideParser },
  { match: /^(goals over\/under|over\/under|total|total goals)$/, period: "FT", market: "TOTAL", parse: ouParser },
  { match: /^(goals over\/under first half|over\/under 1st half|1st half over\/under|goals over\/under - first half)$/, period: "1H", market: "TOTAL", parse: ouParser },
  { match: /^(goals over\/under - second half|goals over\/under second half|over\/under 2nd half)$/, period: "2H", market: "TOTAL", parse: ouParser },
  { match: /^(both teams score|both teams to score)$/, period: "FT", market: "BTTS", parse: yesNoParser },
  { match: /^(both teams score - first half|both teams to score - first half)$/, period: "1H", market: "BTTS", parse: yesNoParser },
  { match: /^(both teams score - second half|both teams to score - second half)$/, period: "2H", market: "BTTS", parse: yesNoParser },
  {
    match: /^(exact score|correct score)$/,
    period: "FT",
    market: "CS",
    parse: (v) => {
      const m = /^(\d{1,2})\s*[:\-]\s*(\d{1,2})$/.exec(v.trim());
      return m ? { selection: `${Number(m[1])}-${Number(m[2])}`, line: null } : null;
    },
  },
  { match: /^(asian handicap|handicap|point spread|spread)$/, period: "FT", market: "HCP", parse: handicapParser },
  { match: /^(asian handicap first half|handicap 1st half)$/, period: "1H", market: "HCP", parse: handicapParser },
  { match: /^(total - home|home team total|total home)$/, period: "FT", market: "TT1", parse: ouParser },
  { match: /^(total - away|away team total|total away)$/, period: "FT", market: "TT2", parse: ouParser },
  { match: /^(first half winner|1st half winner|1st half 3way result)$/, period: "1H", market: "1X2", parse: sideParser },
  { match: /^(second half winner|2nd half winner)$/, period: "2H", market: "1X2", parse: sideParser },
  {
    match: /^(ht\/ft double|half time\/full time)$/,
    period: "FT",
    market: "HTFT",
    parse: (v) => {
      const [a, b] = v.toLowerCase().split("/").map((x) => SIDE[x.trim()]);
      return a && b ? { selection: `${a}/${b}`, line: null } : null;
    },
  },
  { match: /^(odd\/even|total odd\/even)$/, period: "FT", market: "ODD_EVEN", parse: (v) => (/^(odd|even)$/i.test(v) ? { selection: v.toUpperCase(), line: null } : null) },
  {
    match: /^(results\/both teams score|result\/both teams score)$/,
    period: "FT",
    market: "RES_BTTS",
    parse: (v) => {
      const [r, yn] = v.toLowerCase().split("/").map((x) => x.trim());
      return SIDE[r] && YESNO[yn] ? { selection: `${SIDE[r]}&${YESNO[yn]}`, line: null } : null;
    },
  },
  {
    match: /^(result\/total goals|results\/total goals)$/,
    period: "FT",
    market: "RES_TOTAL",
    parse: (v) => {
      const [r, rest] = v.split("/").map((x) => x.trim());
      const m = rest ? ou(rest) : null;
      return SIDE[r?.toLowerCase()] && m ? { selection: `${SIDE[r.toLowerCase()]}&${m[1].toUpperCase()}`, line: parseLine(m[2]) } : null;
    },
  },
  { match: /^win to nil - home$/, period: "FT", market: "WIN_NIL", parse: (v) => (/^yes$/i.test(v) ? { selection: "1", line: null } : null) },
  { match: /^win to nil - away$/, period: "FT", market: "WIN_NIL", parse: (v) => (/^yes$/i.test(v) ? { selection: "2", line: null } : null) },
  { match: /^clean sheet - home$/, period: "FT", market: "CLEAN_SHEET", parse: (v) => (/^yes$/i.test(v) ? { selection: "1", line: null } : null) },
  { match: /^clean sheet - away$/, period: "FT", market: "CLEAN_SHEET", parse: (v) => (/^yes$/i.test(v) ? { selection: "2", line: null } : null) },
  {
    match: /^(team to score first|first team to score)$/,
    period: "FT",
    market: "FIRST_GOAL",
    parse: (v) => {
      const k = v.toLowerCase();
      if (k === "home" || k === "1") return { selection: "1", line: null };
      if (k === "away" || k === "2") return { selection: "2", line: null };
      if (k === "draw" || k.includes("no goal")) return { selection: "NONE", line: null };
      return null;
    },
  },
  { match: /^(corners over under|corners over\/under|total corners)$/, period: "FT", market: "CORNERS", parse: ouParser },
  { match: /^(cards over\/under|total cards|cards over under)$/, period: "FT", market: "CARDS", parse: ouParser },
];

/**
 * Cotes d'un match (GET /odds) : on garde les bookmakers préférés (1xBet en
 * tête), sinon le premier disponible, et uniquement les marchés analysés.
 */
export function mapOdds(item: unknown, preferredBookmakers: string[] = []): { externalGameId: number | null; odds: NormalizedOdd[] } {
  const o = obj(item);
  const externalGameId = num(obj(o.fixture).id ?? obj(o.game).id ?? o.id);
  const bookmakers = arr(o.bookmakers).map(obj);
  const preferred = preferredBookmakers.map((b) => b.toLowerCase());
  let kept = bookmakers.filter((b) => preferred.includes(String(b.name ?? "").toLowerCase()));
  if (!kept.length && bookmakers.length) kept = [bookmakers[0]];

  const odds: NormalizedOdd[] = [];
  for (const bookmaker of kept) {
    const bookmakerId = num(bookmaker.id);
    const bookmakerName = str(bookmaker.name);
    if (bookmakerId === null || !bookmakerName) continue;
    for (const bet of arr(bookmaker.bets).map(obj)) {
      const name = String(bet.name ?? "").toLowerCase().replace(/\s+/g, " ").trim();
      const def = BETS.find((b) => b.match.test(name));
      if (!def) continue;
      for (const value of arr(bet.values).map(obj)) {
        const raw = str(value.value);
        const odd = num(value.odd);
        if (!raw || odd === null || odd <= 1 || odd > 1000) continue;
        const parsed = def.parse(raw);
        if (!parsed || !isValidSelection(def.market, parsed.line, parsed.selection)) continue;
        odds.push({ bookmakerId, bookmakerName, period: def.period, market: def.market, line: parsed.line, selection: parsed.selection, odd });
      }
    }
  }
  // Doublons éventuels (même pari listé deux fois) : on garde la meilleure cote
  const unique = new Map<string, NormalizedOdd>();
  for (const odd of odds) {
    const key = `${odd.bookmakerId}|${odd.period}|${odd.market}|${odd.line}|${odd.selection}`;
    if (!unique.has(key) || unique.get(key)!.odd < odd.odd) unique.set(key, odd);
  }
  return { externalGameId, odds: [...unique.values()] };
}

// ---------------------------------------------------------------------------
// Football : faits de match, blessés, compositions (fiche match)
// ---------------------------------------------------------------------------
export type NormalizedIncident = {
  minute: number | null;
  extraMinute: number | null;
  teamExternalId: number | null;
  player: string | null;
  assist: string | null;
  type: string;
  detail: string | null;
  comments: string | null;
  key: string;
};

export function mapIncidents(response: unknown[]): NormalizedIncident[] {
  return response.map(obj).flatMap((e, i) => {
    const time = obj(e.time);
    const type = str(e.type);
    if (!type) return [];
    const minute = num(time.elapsed);
    const extra = num(time.extra);
    const teamId = num(obj(e.team).id);
    const player = str(obj(e.player).name);
    const detail = str(e.detail);
    return [
      {
        minute,
        extraMinute: extra,
        teamExternalId: teamId,
        player,
        assist: str(obj(e.assist).name),
        type,
        detail,
        comments: str(e.comments),
        key: `${minute ?? "?"}-${extra ?? 0}-${teamId ?? 0}-${type}-${detail ?? ""}-${player ?? i}`.slice(0, 200),
      },
    ];
  });
}

export type Absence = { teamExternalId: number | null; player: string; type: string | null; reason: string | null };

export function mapInjuries(response: unknown[]): Absence[] {
  return response.map(obj).flatMap((r) => {
    const player = obj(r.player);
    const name = str(player.name);
    return name ? [{ teamExternalId: num(obj(r.team).id), player: name, type: str(player.type), reason: str(player.reason) }] : [];
  });
}

export type Lineup = { teamExternalId: number | null; formation: string | null; coach: string | null; startXI: string[]; substitutes: string[] };

export function mapLineups(response: unknown[]): Lineup[] {
  const names = (v: unknown) => arr(v).flatMap((p) => {
    const n = str(obj(obj(p).player).name);
    return n ? [n] : [];
  });
  return response.map(obj).map((l) => ({
    teamExternalId: num(obj(l.team).id),
    formation: str(l.formation),
    coach: str(obj(l.coach).name),
    startXI: names(l.startXI),
    substitutes: names(l.substitutes),
  }));
}
