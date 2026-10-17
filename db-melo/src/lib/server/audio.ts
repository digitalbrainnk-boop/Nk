// Audio servi au navigateur : pré-écoute tronquée (avant paiement), MP3 HD étiqueté, WAV.
// Les URL Kie/Suno ne quittent jamais le serveur.
import { BRAND, STYLES } from "../constants";
import { seedFrom, synthDemoSong } from "../audio/demo-synth";
import { tagMp3 } from "../audio/id3";
import type { SongRecord, VariantId } from "../types";
import { loadCover } from "./cover";
import { config } from "./env";
import { HttpError } from "./http";
import { DEMO_DURATION } from "./songs";
import { files } from "./store";

export interface AudioPayload {
  data: Uint8Array;
  mime: string;
  ext: "mp3" | "wav";
}

function track(song: SongRecord, variant: VariantId, take: number) {
  const v = song.variants[variant];
  const t = v?.tracks[take];
  if (!v || v.status !== "SUCCESS" || !t) throw new HttpError(404, "Cette version n'est pas encore prête.");
  return t;
}

function demo(song: SongRecord, variant: VariantId, take: number, seconds: number): AudioPayload {
  const data = synthDemoSong({ variant, seconds, seed: seedFrom(`${song.id}:${take}`) });
  return { data, mime: "audio/wav", ext: "wav" };
}

async function download(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  if (!res.ok && res.status !== 206) throw new HttpError(502, "Le fichier audio est momentanément indisponible.");
  return res;
}

/** Début du morceau seulement : la version complète n'est jamais exposée avant paiement. */
export async function previewAudio(song: SongRecord, variant: VariantId, take: number): Promise<AudioPayload> {
  const t = track(song, variant, take);
  const seconds = config.previewSeconds();
  if (song.demo) return demo(song, variant, take, Math.min(seconds, DEMO_DURATION));
  const duration = t.duration && t.duration > 0 ? t.duration : 180;
  // On ne télécharge que le nécessaire (384 kbit/s max), puis on coupe au prorata de la durée.
  const res = await download(t.audioUrl, { headers: { Range: `bytes=0-${Math.ceil(seconds * 48_000)}` } });
  const data = new Uint8Array(await res.arrayBuffer());
  const total = res.status === 206 ? Number(res.headers.get("content-range")?.split("/")[1]) : data.length;
  const cut = Number.isFinite(total) && total > 0 ? Math.floor((total * Math.min(1, seconds / duration))) : seconds * 16_000;
  return { data: data.subarray(0, Math.min(cut, data.length)), mime: "audio/mpeg", ext: "mp3" };
}

/** Morceau complet (copie locale conservée après paiement : les liens Kie expirent au bout de ~14 jours). */
export async function fullAudio(song: SongRecord, variant: VariantId, take: number): Promise<AudioPayload> {
  const t = track(song, variant, take);
  if (song.demo) return demo(song, variant, take, DEMO_DURATION);
  const name = `${song.id}-${variant}-${take}.mp3`;
  const local = await files.read(name);
  if (local) return { data: local, mime: "audio/mpeg", ext: "mp3" };
  const data = new Uint8Array(await (await download(t.audioUrl)).arrayBuffer());
  if (song.payment.status === "paid") await files.write(name, data);
  return { data, mime: "audio/mpeg", ext: "mp3" };
}

/** MP3 HD avec titre, artiste « DB.Mélo », paroles et pochette intégrés. */
export async function taggedAudio(song: SongRecord, variant: VariantId, take: number): Promise<AudioPayload> {
  const audio = await fullAudio(song, variant, take);
  if (audio.ext !== "mp3") return audio;
  const cover = await loadCover(song).catch(() => null);
  const c = song.config;
  const data = tagMp3(audio.data, {
    title: c.title,
    artist: BRAND.artist,
    album: BRAND.album,
    albumArtist: BRAND.artist,
    year: String(new Date(song.createdAt).getFullYear()),
    genre: c.styles.map((s) => STYLES.find((x) => x.id === s)?.label).filter(Boolean).join(" / "),
    comment: c.recipientName ? `Chanson créée avec ${BRAND.name} pour ${c.recipientName}` : `Chanson créée avec ${BRAND.name}`,
    lyrics: c.lyrics,
    cover: cover ?? undefined,
  });
  return { data, mime: "audio/mpeg", ext: "mp3" };
}

export async function wavAudio(song: SongRecord, variant: VariantId): Promise<AudioPayload> {
  const url = song.variants[variant]?.wav?.url;
  if (!url) throw new HttpError(404, "Le fichier WAV est en préparation.");
  const name = `${song.id}-${variant}.wav`;
  const local = await files.read(name);
  if (local) return { data: local, mime: "audio/wav", ext: "wav" };
  const data = new Uint8Array(await (await download(url)).arrayBuffer());
  await files.write(name, data);
  return { data, mime: "audio/wav", ext: "wav" };
}

export function audioFilename(song: SongRecord, variant: VariantId, ext: string): string {
  const title = song.config.title.replace(/[\\/:*?"<>|]+/g, "").trim() || "Ma chanson";
  return `${title} - ${BRAND.name} (${variant === "A" ? "version rythmée" : "version acoustique"}).${ext}`;
}

export function contentDisposition(filename: string, inline = false): string {
  const fallback = filename.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/"/g, "");
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function audioResponse(audio: AudioPayload, opts: { filename?: string; download?: boolean } = {}): Response {
  const headers: Record<string, string> = {
    "Content-Type": audio.mime,
    "Content-Length": String(audio.data.length),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (opts.filename) headers["Content-Disposition"] = contentDisposition(opts.filename, !opts.download);
  return new Response(audio.data as BodyInit, { headers });
}
