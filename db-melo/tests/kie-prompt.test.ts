import { describe, expect, it } from "vitest";
import { buildKieRequest, buildKieRequests, buildStyle } from "@/lib/kie-prompt";
import type { SongConfig } from "@/lib/types";

const config: SongConfig = {
  mode: "studio",
  title: "Maman Awa",
  lyrics: "[Couplet 1]\nTu m'as tout donné\n[Refrain]\nMaman Awa",
  language: "fr",
  voice: "child",
  emotion: "nostalgic",
  styles: ["afropop", "gospel"],
  instruments: ["kora", "intimate_piano"],
  referenceAudio: { uploadId: "abcdef12", fileName: "ref.mp3", useAsCover: false, rightsConfirmed: false, analysis: { bpm: 96.4, energy: "high", durationSec: 200 } },
};

describe("requêtes Kie", () => {
  it("produit deux variantes Custom Generation", () => {
    const r = buildKieRequests(config, { model: "V5", callbackUrl: (v) => `https://x.test/cb?v=${v}` });
    expect(r.A.customMode).toBe(true);
    expect(r.A.prompt).toBe("[Verse 1]\nTu m'as tout donné\n[Chorus]\nMaman Awa");
    expect(r.A.prompt).toBe(r.B.prompt);
    expect(r.A.style).toContain("upbeat");
    expect(r.B.style).toContain("acoustic");
    expect(r.A.style).toContain("96 BPM");
    expect(r.B.style).not.toContain("BPM");
    expect(r.A.style).toContain("child vocals");
    expect(r.A.style).toContain("featuring kora, intimate piano");
    expect(r.A.vocalGender).toBeUndefined();
    expect(r.A.callBackUrl).toBe("https://x.test/cb?v=A");
    expect(r.A.uploadUrl).toBeUndefined();
  });

  it("respecte les limites du modèle et le genre vocal", () => {
    const long = { ...config, voice: "female" as const, lyrics: "la ".repeat(3000) };
    const r = buildKieRequests(long, { model: "V4", callbackUrl: () => "https://x.test", uploadUrl: "https://files.test/ref.mp3" });
    expect(r.A.prompt.length).toBeLessThanOrEqual(3000);
    expect(r.A.style.length).toBeLessThanOrEqual(200);
    expect(r.A.vocalGender).toBe("f");
    expect(r.A.uploadUrl).toBe("https://files.test/ref.mp3");
    expect(r.A.audioWeight).toBeGreaterThan(0);
  });

  it("compose une seule fois pour deux prises, sans imposer d'arrangement", () => {
    const r = buildKieRequest(config, "both", { model: "V5", callbackUrl: (v) => `https://x.test/cb?v=${v}` });
    expect(r.style).not.toContain("upbeat");
    expect(r.style).not.toContain("acoustic version");
    expect(r.style).toContain("96 BPM");
    expect(r.negativeTags).toBe("explicit lyrics, low quality, adult vocals, growl");
    expect(r.callBackUrl).toBe("https://x.test/cb?v=A");
  });

  it("nettoie l'inspiration libre", () => {
    expect(buildStyle({ ...config, customInspiration: "comme [Fally] <script>" }, "B")).toContain("comme Fally script");
  });
});
