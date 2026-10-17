// Traduction d'une SongConfig en requêtes Suno (Kie.ai) : variante A rythmée, variante B acoustique.
import { EMOTIONS, INSTRUMENTS, LANGUAGES, STYLES, VOICES } from "./constants";
import { toSunoLyrics } from "./lyrics/sections";
import type { KieGenerationRequest, KieSunoModel, SongConfig, VariantId } from "./types";

const MOODS: Record<VariantId, { style: string; negative: string }> = {
  A: {
    style: "upbeat rhythmic version, danceable groove, punchy drums, energetic, radio-ready mix",
    negative: "slow, sleepy, lo-fi",
  },
  B: {
    style: "acoustic version, soft and intimate, stripped-back arrangement, gentle tempo, warm and tender",
    negative: "heavy drums, EDM, distorted guitars, aggressive",
  },
};

const ENERGY: Record<string, string> = { low: "calm energy", medium: "mid-tempo energy", high: "high energy" };

const limits = (model: KieSunoModel) =>
  model === "V3_5" || model === "V4" ? { prompt: 3000, style: 200, title: 80 } : { prompt: 5000, style: 1000, title: 80 };

/** Description de style envoyée à Suno (en anglais, plus fiable). */
export function buildStyle(config: SongConfig, variant: VariantId): string {
  const styles = config.styles.map((id) => STYLES.find((s) => s.id === id)?.suno).filter(Boolean);
  const instruments = config.instruments.map((id) => INSTRUMENTS.find((i) => i.id === id)?.suno).filter(Boolean);
  const analysis = config.referenceAudio?.analysis;
  const parts = [
    styles.join(", "),
    config.customInspiration?.trim().replace(/[\[\]{}<>]/g, "").slice(0, 200),
    VOICES.find((v) => v.id === config.voice)?.suno,
    EMOTIONS.find((e) => e.id === config.emotion)?.suno,
    instruments.length ? `featuring ${instruments.join(", ")}` : "",
    LANGUAGES.find((l) => l.id === config.language)?.suno,
    // Style Match : tempo et énergie mesurés sur le morceau de référence (variante rythmée uniquement).
    variant === "A" && analysis?.bpm ? `${Math.round(analysis.bpm)} BPM` : "",
    variant === "A" && analysis ? ENERGY[analysis.energy] : "",
    MOODS[variant].style,
    "studio quality, professional mix and master",
  ];
  return parts.filter(Boolean).join(", ");
}

export function buildNegativeTags(config: SongConfig, variant: VariantId): string {
  const tags = [MOODS[variant].negative, "explicit lyrics", "low quality"];
  if (config.voice === "male") tags.push("female lead vocals");
  if (config.voice === "female") tags.push("male lead vocals");
  if (config.voice === "child") tags.push("adult vocals", "growl");
  return tags.join(", ");
}

export interface BuildOptions {
  model: KieSunoModel;
  callbackUrl: (variant: VariantId) => string;
  /** URL publique du morceau de référence si l'utilisateur l'utilise comme base (upload-cover). */
  uploadUrl?: string;
}

/** Deux requêtes « Custom Generation » : mêmes paroles, deux arrangements. */
export function buildKieRequests(config: SongConfig, opts: BuildOptions): Record<VariantId, KieGenerationRequest> {
  const max = limits(opts.model);
  const prompt = toSunoLyrics(config.lyrics, { voice: config.voice, instruments: config.instruments }).slice(0, max.prompt);
  const vocalGender = config.voice === "male" ? "m" : config.voice === "female" ? "f" : undefined;
  const make = (variant: VariantId): KieGenerationRequest => ({
    customMode: true,
    instrumental: false,
    model: opts.model,
    prompt,
    style: buildStyle(config, variant).slice(0, max.style),
    title: config.title.trim().slice(0, max.title),
    callBackUrl: opts.callbackUrl(variant),
    negativeTags: buildNegativeTags(config, variant),
    vocalGender,
    styleWeight: 0.65,
    weirdnessConstraint: 0.3,
    ...(opts.uploadUrl ? { uploadUrl: opts.uploadUrl, audioWeight: 0.6 } : {}),
  });
  return { A: make("A"), B: make("B") };
}
