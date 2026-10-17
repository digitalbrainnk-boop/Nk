import { describe, expect, it } from "vitest";
import { alignedToLines, estimateTimings, parseTag, sungLines, toSunoLyrics } from "@/lib/lyrics/sections";

describe("balises Suno", () => {
  it("traduit les balises françaises", () => {
    const out = toSunoLyrics("[Couplet 1]\nla\n[Refrain]\nlo\n[Pont]\nli\n[Solo Instrumental]\n[Outro]\nfin", {
      voice: "male",
      instruments: ["saxophone"],
    });
    expect(out).toBe("[Verse 1]\nla\n[Chorus]\nlo\n[Bridge]\nli\n[Saxophone Solo]\n[Outro]\nfin");
  });

  it("attribue les voix en duo", () => {
    const out = toSunoLyrics("[Couplet]\na\n[Refrain]\nb\n[Couplet]\nc", { voice: "duo", instruments: [] });
    expect(out).toBe("[Verse: Male Vocal]\na\n[Chorus: Duet]\nb\n[Verse: Female Vocal]\nc");
  });

  it("respecte les voix indiquées par le parolier", () => {
    expect(parseTag("Couplet 2 - Elle")).toMatchObject({ base: "Verse", number: "2", part: "Female Vocal" });
    const out = toSunoLyrics("[Couplet 1 - Elle]\na\n[Refrain - Ensemble]\nb", { voice: "duo", instruments: [] });
    expect(out).toBe("[Verse 1: Female Vocal]\na\n[Chorus: Duet]\nb");
  });

  it("garde les balises inconnues", () => {
    expect(toSunoLyrics("[Chœur gospel]\nla", { voice: "female", instruments: [] })).toBe("[Chœur gospel]\nla");
  });

  it("estime le calage karaoké dans l'ordre et dans la durée", () => {
    const lyrics = "[Couplet 1]\nPremier vers ici\nDeuxième vers là\n[Refrain]\nRefrain joyeux";
    expect(sungLines(lyrics)).toHaveLength(3);
    const t = estimateTimings(lyrics, 120);
    expect(t).toHaveLength(3);
    expect(t[0].startS).toBeGreaterThan(0);
    expect(t[1].startS).toBeGreaterThan(t[0].startS);
    expect(t[2].endS).toBeLessThanOrEqual(120);
  });

  it("regroupe les mots horodatés Suno en vers", () => {
    const lines = alignedToLines([
      { word: "[Verse]\nBonjour", startS: 1, endS: 1.5 },
      { word: "toi\n", startS: 1.5, endS: 2 },
      { word: "Encore", startS: 3, endS: 3.4 },
    ]);
    expect(lines.map((l) => l.text)).toEqual(["Bonjour toi", "Encore"]);
    expect(lines[0].section).toBe("Verse");
    expect(lines[1].startS).toBe(3);
  });
});
