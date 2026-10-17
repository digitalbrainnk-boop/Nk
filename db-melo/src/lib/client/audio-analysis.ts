// Style Match : estimation locale du tempo (BPM) et de l'énergie d'un morceau de référence.
// Le calcul se fait dans le navigateur (Web Audio API), rien n'est envoyé pour l'analyse.
import type { ReferenceAnalysis } from "../types";

type AudioCtor = typeof AudioContext;

export async function analyzeReference(file: File): Promise<ReferenceAnalysis> {
  const Ctx: AudioCtor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
  if (!Ctx) throw new Error("Analyse audio non disponible sur ce navigateur.");
  const ctx = new Ctx();
  try {
    const audio = await ctx.decodeAudioData(await file.arrayBuffer());
    return analyzeBuffer(audio.getChannelData(0), audio.sampleRate, audio.duration);
  } finally {
    void ctx.close();
  }
}

export function analyzeBuffer(data: Float32Array, sampleRate: number, duration: number): ReferenceAnalysis {
  // Fenêtre de 30 s prise après l'intro.
  const start = Math.floor(Math.min(duration * 0.25, 30) * sampleRate);
  const len = Math.min(30 * sampleRate, data.length - start);
  const hop = 512;
  const frames = Math.floor(len / hop);
  if (frames < 64) return { bpm: null, energy: "medium", durationSec: Math.round(duration) };

  const env = new Float32Array(frames);
  let total = 0;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = 0; i < hop; i++) {
      const v = data[start + f * hop + i] ?? 0;
      sum += v * v;
    }
    env[f] = Math.sqrt(sum / hop);
    total += sum;
  }
  // Force d'attaque : hausses d'énergie d'une trame à l'autre.
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f++) onset[f] = Math.max(0, env[f] - env[f - 1]);

  const frameRate = sampleRate / hop;
  let bestLag = 0;
  let bestScore = 0;
  for (let bpm = 60; bpm <= 180; bpm += 0.5) {
    const lag = Math.round((60 * frameRate) / bpm);
    let score = 0;
    for (let f = 0; f + lag < frames; f++) score += onset[f] * onset[f + lag];
    // Légère préférence autour de 110 BPM pour éviter les erreurs d'octave (moitié / double).
    score *= Math.exp(-((Math.log2(bpm / 110)) ** 2) * 1.2);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  let bpm = bestLag ? (60 * frameRate) / bestLag : null;
  while (bpm && bpm < 70) bpm *= 2;
  while (bpm && bpm > 170) bpm /= 2;

  const rms = Math.sqrt(total / (frames * hop));
  const energy = rms < 0.08 ? "low" : rms < 0.17 ? "medium" : "high";
  return { bpm: bpm ? Math.round(bpm) : null, energy, durationSec: Math.round(duration) };
}
