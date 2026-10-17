import { describe, expect, it } from "vitest";
import { analyzeLyrics, countSyllables, lastWord, rhymeKey, rhymes } from "@/lib/lyrics/rhymes";

describe("rimes françaises", () => {
  it.each([
    ["amour", "toujours"],
    ["cœur", "bonheur"],
    ["coeur", "douceur"],
    ["vie", "envie"],
    ["temps", "enfant"],
    ["belle", "éternelle"],
    ["rêve", "lève"],
    ["chanté", "beauté"],
    ["aimer", "chanter"],
    ["mer", "hiver"],
    ["soleil", "merveille"],
    ["nuit", "vie"],
    ["maman", "enfant"],
    ["papa", "là"],
    ["lumière", "prière"],
    ["chance", "danse"],
    ["ciel", "miel"],
    ["jamais", "secret"],
    ["bien", "rien"],
    ["poème", "problème"],
    ["fille", "famille"],
    ["regard", "tard"],
  ])("%s / %s riment", (a, b) => {
    expect(rhymes(a, b), `${a}=${rhymeKey(a)} ${b}=${rhymeKey(b)}`).toBe(true);
  });

  it.each([
    ["amour", "jamais"],
    ["cœur", "vie"],
    ["machine", "matin"],
    ["belle", "rêve"],
    ["chanté", "chantait"],
  ])("%s / %s ne riment pas", (a, b) => {
    expect(rhymes(a, b), `${a}=${rhymeKey(a)} ${b}=${rhymeKey(b)}`).toBe(false);
  });

  it("extrait le dernier mot chantable", () => {
    expect(lastWord("Tu es mon soleil, ma lumière ! (bis)")).toBe("lumière");
    expect(lastWord("Je pense à l'amour")).toBe("amour");
    expect(lastWord("[Refrain]")).toBeNull();
  });

  it("compte les syllabes avec élision", () => {
    expect(countSyllables("Je t'aime")).toBe(2);
    expect(countSyllables("Joyeux anniversaire")).toBe(6);
    expect(countSyllables("qu'il fait beau")).toBe(3);
  });

  it("calcule le schéma de rimes par strophe", () => {
    const lines = analyzeLyrics("[Couplet 1]\nTon amour\nMa vie\nPour toujours\nMon envie\n\n[Refrain]\nSoleil");
    const lyric = lines.filter((l) => l.kind === "lyric");
    expect(lyric.map((l) => l.letter).join("")).toBe("ABABA");
    expect(lyric[0].color).toBe(0);
    expect(lyric[4].color).toBeNull(); // seul dans sa strophe
    expect(lines[0].kind).toBe("tag");
  });
});
