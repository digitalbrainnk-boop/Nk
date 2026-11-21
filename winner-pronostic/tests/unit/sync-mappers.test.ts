import { describe, expect, it } from "vitest";
import { mapGame, mapIncidents, mapInjuries, mapLeagueInfo, mapLineups, mapOdds, mapStandings } from "@/lib/sync/mappers";

// Exemples au format documenté d'API-Sports (réduits aux champs utiles).
const footballFixture = {
  fixture: {
    id: 1208021,
    referee: "M. Oliver",
    timezone: "UTC",
    date: "2026-11-02T20:00:00+00:00",
    timestamp: 1793649600,
    venue: { id: 562, name: "St. James' Park", city: "Newcastle upon Tyne" },
    status: { long: "Second Half", short: "2H", elapsed: 67, extra: null },
  },
  league: { id: 39, name: "Premier League", country: "England", logo: "https://media.api-sports.io/football/leagues/39.png", flag: "https://media.api-sports.io/flags/gb.svg", season: 2026, round: "Regular Season - 11" },
  teams: { home: { id: 34, name: "Newcastle", logo: "n.png", winner: true }, away: { id: 45, name: "Everton", logo: "e.png", winner: false } },
  goals: { home: 2, away: 1 },
  score: { halftime: { home: 1, away: 0 }, fulltime: { home: null, away: null }, extratime: { home: null, away: null }, penalty: { home: null, away: null } },
};

describe("conversion des matchs", () => {
  it("football (GET /fixtures)", () => {
    const g = mapGame("football", footballFixture)!;
    expect(g).toMatchObject({
      externalId: 1208021,
      startsAt: "2026-11-02T20:00:00.000Z",
      statusShort: "2H",
      statusGroup: "live",
      liveClock: "67'",
      league: { externalId: 39, name: "Premier League", season: "2026", countryName: "England" },
      round: "Regular Season - 11",
      home: { externalId: 34, name: "Newcastle" },
      away: { externalId: 45, name: "Everton" },
      homeScore: 2,
      awayScore: 1,
      periodScores: { ht: [1, 0] },
      venueName: "St. James' Park",
      referee: "M. Oliver",
    });
  });

  it("basketball (GET /games) avec quarts-temps et mi-temps calculée", () => {
    const g = mapGame("basketball", {
      id: 412345,
      date: "2026-11-05T00:30:00+00:00",
      timestamp: 1794011400,
      status: { long: "Quarter 3", short: "Q3", timer: "7" },
      league: { id: 12, name: "NBA", type: "League", season: "2026-2027", logo: "nba.png" },
      country: { id: 5, name: "USA", code: "US", flag: "us.svg" },
      teams: { home: { id: 145, name: "Los Angeles Lakers", logo: "l.png" }, away: { id: 133, name: "Boston Celtics", logo: "b.png" } },
      scores: {
        home: { quarter_1: 28, quarter_2: 25, quarter_3: 14, quarter_4: null, over_time: null, total: 67 },
        away: { quarter_1: 22, quarter_2: 30, quarter_3: 10, quarter_4: null, over_time: null, total: 62 },
      },
    })!;
    expect(g).toMatchObject({
      statusGroup: "live",
      liveClock: "Q3 7'",
      league: { season: "2026-2027", countryCode: "US", type: "league" },
      homeScore: 67,
      awayScore: 62,
      periodScores: { q1: [28, 22], q2: [25, 30], q3: [14, 10], ht: [53, 52] },
    });
  });

  it("hockey (périodes « 1-0 »)", () => {
    const g = mapGame("ice_hockey", {
      id: 9001,
      date: "2026-11-05T00:00:00+00:00",
      timestamp: 1794009600,
      status: { long: "Finished", short: "FT" },
      league: { id: 57, name: "NHL", type: "League", season: 2026 },
      country: { name: "USA", code: "US" },
      teams: { home: { id: 1, name: "Boston Bruins" }, away: { id: 2, name: "Buffalo Sabres" } },
      scores: { home: 4, away: 2 },
      periods: { first: "1-0", second: "2-1", third: "1-1", overtime: null, penalties: null },
    })!;
    expect(g).toMatchObject({ statusGroup: "finished", homeScore: 4, awayScore: 2, periodScores: { p1: [1, 0], p2: [2, 1], p3: [1, 1] } });
  });

  it("volleyball (sets) et football américain (format « game »)", () => {
    const volley = mapGame("volleyball", {
      id: 77,
      timestamp: 1794000000,
      status: { short: "S4", long: "Set 4" },
      league: { id: 97, name: "SuperLega", season: 2026 },
      country: { name: "Italy", code: "IT" },
      teams: { home: { id: 1, name: "Perugia" }, away: { id: 2, name: "Modena" } },
      scores: { home: 2, away: 1 },
      periods: { first: { home: 25, away: 20 }, second: { home: 22, away: 25 }, third: { home: 25, away: 18 }, fourth: { home: 10, away: 8 } },
    })!;
    expect(volley).toMatchObject({ statusGroup: "live", liveClock: "Set 4", periodScores: { s1: [25, 20], s4: [10, 8] } });

    const nfl = mapGame("american_football", {
      game: {
        id: 5050,
        week: "Week 9",
        date: { timezone: "UTC", date: "2026-11-08", time: "18:00", timestamp: 1794160800 },
        venue: { name: "Arrowhead Stadium", city: "Kansas City" },
        status: { short: "NS", long: "Not Started", timer: null },
      },
      league: { id: 1, name: "NFL", season: "2026", country: { name: "USA", code: "US" } },
      teams: { home: { id: 17, name: "Kansas City Chiefs" }, away: { id: 20, name: "Buffalo Bills" } },
      scores: { home: { quarter_1: null, total: null }, away: { quarter_1: null, total: null } },
    })!;
    expect(nfl).toMatchObject({ externalId: 5050, statusGroup: "scheduled", round: "Week 9", venueName: "Arrowhead Stadium", league: { countryCode: "US" } });
  });

  it("ignore un élément inutilisable sans planter", () => {
    expect(mapGame("football", { fixture: { id: 1 } })).toBeNull();
    expect(mapGame("basketball", null)).toBeNull();
    expect(mapGame("handball", "texte")).toBeNull();
  });

  it("lit la saison en cours d'une compétition (GET /leagues)", () => {
    const info = mapLeagueInfo("football", {
      league: { id: 39, name: "Premier League", type: "League", logo: "pl.png" },
      country: { name: "England", code: "GB", flag: "gb.svg" },
      seasons: [{ year: 2025, current: false }, { year: 2026, current: true }],
    });
    expect(info).toMatchObject({ currentSeason: "2026", league: { countryCode: "GB", type: "league" } });
    const basket = mapLeagueInfo("basketball", { id: 12, name: "NBA", type: "League", country: { name: "USA", code: "US" }, seasons: [{ season: "2025-2026", current: false }, { season: "2026-2027", current: true }] });
    expect(basket?.currentSeason).toBe("2026-2027");
  });
});

describe("conversion des classements", () => {
  it("football : avec séparation domicile/extérieur", () => {
    const rows = mapStandings("football", [
      {
        league: {
          id: 39,
          standings: [
            [
              {
                rank: 5,
                team: { id: 34, name: "Newcastle", logo: "n.png" },
                points: 18,
                goalsDiff: 8,
                group: "Premier League",
                form: "WDWLW",
                description: "Promotion - Europa League",
                all: { played: 10, win: 5, draw: 3, lose: 2, goals: { for: 18, against: 10 } },
                home: { played: 5, win: 4, draw: 1, lose: 0, goals: { for: 11, against: 4 } },
                away: { played: 5, win: 1, draw: 2, lose: 2, goals: { for: 7, against: 6 } },
              },
            ],
          ],
        },
      },
    ]);
    expect(rows[0]).toMatchObject({ rank: 5, points: 18, played: 10, won: 5, scored: 18, home: { played: 5, scored: 11, conceded: 4 }, form: "WDWLW" });
  });

  it("basketball : victoires/défaites et points marqués", () => {
    const rows = mapStandings("basketball", [
      [
        {
          position: 1,
          group: { name: "Western Conference" },
          team: { id: 145, name: "Los Angeles Lakers" },
          games: { played: 12, win: { total: 9, percentage: "0.750" }, lose: { total: 3 } },
          points: { for: 1380, against: 1300 },
          form: "WWLWW",
        },
      ],
    ]);
    expect(rows[0]).toMatchObject({ rank: 1, group: "Western Conference", played: 12, won: 9, lost: 3, scored: 1380, conceded: 1300, points: 18, home: null });
  });
});

describe("conversion des cotes", () => {
  const item = {
    fixture: { id: 1208021 },
    bookmakers: [
      { id: 8, name: "Bet365", bets: [{ id: 1, name: "Match Winner", values: [{ value: "Home", odd: "1.65" }] }] },
      {
        id: 11,
        name: "1xBet",
        bets: [
          { id: 1, name: "Match Winner", values: [{ value: "Home", odd: "1.70" }, { value: "Draw", odd: "4.10" }, { value: "Away", odd: "5.20" }] },
          { id: 5, name: "Goals Over/Under", values: [{ value: "Over 2.5", odd: "1.80" }, { value: "Under 2.5", odd: "2.00" }] },
          { id: 8, name: "Both Teams Score", values: [{ value: "Yes", odd: "1.85" }, { value: "No", odd: "1.95" }] },
          { id: 4, name: "Asian Handicap", values: [{ value: "Home -1", odd: "2.20" }, { value: "Away +1", odd: "1.70" }, { value: "Home -0.75", odd: "1.95" }] },
          { id: 10, name: "Exact Score", values: [{ value: "2:1", odd: "8.50" }] },
          { id: 16, name: "Total - Home", values: [{ value: "Over 1.5", odd: "1.90" }] },
          { id: 7, name: "HT/FT Double", values: [{ value: "Home/Home", odd: "2.60" }, { value: "Draw/Away", odd: "15.0" }] },
          { id: 12, name: "Double Chance", values: [{ value: "Home/Draw", odd: "1.15" }] },
          { id: 6, name: "Goals Over/Under First Half", values: [{ value: "Over 0.5", odd: "1.40" }] },
          { id: 24, name: "Results/Both Teams Score", values: [{ value: "Home/Yes", odd: "3.40" }] },
          { id: 25, name: "Result/Total Goals", values: [{ value: "Home/Over 2.5", odd: "2.50" }] },
          { id: 999, name: "Player to be Booked", values: [{ value: "Someone", odd: "3.0" }] },
          { id: 1, name: "Match Winner", values: [{ value: "Home", odd: "0.9" }] },
        ],
      },
    ],
  };

  it("garde les bookmakers préférés et traduit les paris en marchés", () => {
    const { externalGameId, odds } = mapOdds(item, ["1xBet"]);
    expect(externalGameId).toBe(1208021);
    expect(new Set(odds.map((o) => o.bookmakerName))).toEqual(new Set(["1xBet"]));
    const find = (period: string, market: string, selection: string, line: number | null = null) =>
      odds.find((o) => o.period === period && o.market === market && o.selection === selection && o.line === line)?.odd;
    expect(find("FT", "1X2", "1")).toBe(1.7);
    expect(find("FT", "TOTAL", "OVER", 2.5)).toBe(1.8);
    expect(find("FT", "BTTS", "NO")).toBe(1.95);
    expect(find("FT", "HCP", "1", -1)).toBe(2.2);
    expect(find("FT", "HCP", "2", -1)).toBe(1.7); // « Away +1 » = équipe 1 −1 du point de vue domicile
    expect(find("FT", "HCP", "1", -0.75)).toBe(1.95);
    expect(find("FT", "CS", "2-1")).toBe(8.5);
    expect(find("FT", "TT1", "OVER", 1.5)).toBe(1.9);
    expect(find("FT", "HTFT", "1/1")).toBe(2.6);
    expect(find("FT", "HTFT", "X/2")).toBe(15);
    expect(find("FT", "DC", "1X")).toBe(1.15);
    expect(find("1H", "TOTAL", "OVER", 0.5)).toBe(1.4);
    expect(find("FT", "RES_BTTS", "1&YES")).toBe(3.4);
    expect(find("FT", "RES_TOTAL", "1&OVER", 2.5)).toBe(2.5);
    expect(odds.some((o) => o.odd < 1)).toBe(false); // cote invalide ignorée
  });

  it("prend le premier bookmaker quand aucun préféré n'est disponible", () => {
    const { odds } = mapOdds(item, ["Pinnacle"]);
    expect(new Set(odds.map((o) => o.bookmakerName))).toEqual(new Set(["Bet365"]));
  });

  it("gère le vainqueur prolongations incluses (basket)", () => {
    const { odds, externalGameId } = mapOdds(
      { game: { id: 412345 }, bookmakers: [{ id: 1, name: "Bwin", bets: [{ id: 2, name: "Home/Away", values: [{ value: "Home", odd: "1.55" }, { value: "Away", odd: "2.45" }] }, { id: 3, name: "Over/Under", values: [{ value: "Over 221.5", odd: "1.9" }] }] }] },
      [],
    );
    expect(externalGameId).toBe(412345);
    expect(odds.map((o) => [o.market, o.selection, o.line, o.odd])).toEqual([
      ["ML", "1", null, 1.55],
      ["ML", "2", null, 2.45],
      ["TOTAL", "OVER", 221.5, 1.9],
    ]);
  });
});

describe("fiche match football", () => {
  it("faits de match, blessés et compositions", () => {
    const incidents = mapIncidents([
      { time: { elapsed: 23, extra: null }, team: { id: 34 }, player: { name: "A. Isak" }, assist: { name: "B. Guimarães" }, type: "Goal", detail: "Normal Goal" },
      { time: { elapsed: 90, extra: 3 }, team: { id: 45 }, player: { name: "J. Tarkowski" }, type: "Card", detail: "Red Card" },
    ]);
    expect(incidents[0]).toMatchObject({ minute: 23, type: "Goal", player: "A. Isak", assist: "B. Guimarães" });
    expect(incidents[1]).toMatchObject({ minute: 90, extraMinute: 3, detail: "Red Card" });
    expect(new Set(incidents.map((i) => i.key)).size).toBe(2);

    expect(mapInjuries([{ player: { name: "J. Willock", type: "Missing Fixture", reason: "Knee Injury" }, team: { id: 34 } }])).toEqual([
      { teamExternalId: 34, player: "J. Willock", type: "Missing Fixture", reason: "Knee Injury" },
    ]);
    expect(
      mapLineups([{ team: { id: 34 }, formation: "4-3-3", coach: { name: "E. Howe" }, startXI: [{ player: { name: "N. Pope" } }], substitutes: [{ player: { name: "M. Dúbravka" } }] }]),
    ).toEqual([{ teamExternalId: 34, formation: "4-3-3", coach: "E. Howe", startXI: ["N. Pope"], substitutes: ["M. Dúbravka"] }]);
  });
});
