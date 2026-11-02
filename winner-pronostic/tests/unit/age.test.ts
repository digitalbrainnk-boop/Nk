import { describe, expect, it } from "vitest";
import { computeAge, isAdult, latestAllowedBirthDate, parseIsoDate } from "@/lib/validation/age";

const day = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("âge", () => {
  it("rejette les dates inexistantes", () => {
    expect(parseIsoDate("2005-02-30")).toBeNull();
    expect(parseIsoDate("2005-13-01")).toBeNull();
    expect(parseIsoDate("01/02/2005")).toBeNull();
    expect(parseIsoDate("2004-02-29")).toEqual({ year: 2004, month: 2, day: 29 });
  });

  it("calcule l'âge révolu", () => {
    expect(computeAge("2008-11-02", day("2026-11-02"))).toBe(18);
    expect(computeAge("2008-11-03", day("2026-11-02"))).toBe(17);
    expect(computeAge("1990-01-01", day("2026-11-02"))).toBe(36);
  });

  it("applique la majorité le jour exact des 18 ans", () => {
    expect(isAdult("2008-11-02", day("2026-11-02"))).toBe(true);
    expect(isAdult("2008-11-03", day("2026-11-02"))).toBe(false);
  });

  it("gère les personnes nées un 29 février (comme la base de données)", () => {
    expect(isAdult("2008-02-29", day("2026-02-28"))).toBe(false);
    expect(isAdult("2008-02-29", day("2026-03-01"))).toBe(true);
  });

  it("donne la date de naissance maximale du sélecteur", () => {
    expect(latestAllowedBirthDate(day("2026-11-02"))).toBe("2008-11-02");
    expect(latestAllowedBirthDate(day("2028-02-29"))).toBe("2010-02-28");
  });
});
