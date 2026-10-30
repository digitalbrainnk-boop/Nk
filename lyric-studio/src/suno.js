// Chansons créées avec Suno via Kie.ai : son, pochette, paroles et paroles horodatées (synchro parfaite),
// et séparation voix / instrumental faite par Suno.
//   GET  /api/v1/generate/record-info?taskId=…            -> response.sunoData[] { id, audioUrl, imageUrl, title, prompt, duration }
//   POST /api/v1/generate/get-timestamped-lyrics           { taskId, audioId } -> alignedWords[] { word, startS, endS }
//   POST /api/v1/vocal-removal/generate                    { taskId, audioId, type, callBackUrl } -> taskId
//   GET  /api/v1/vocal-removal/record-info?taskId=…        -> response { vocalUrl, instrumentalUrl, … }
import fs from "node:fs";
import { getSettings } from "./settings.js";

const BASE = process.env.KIE_BASE || "https://api.kie.ai/api/v1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POLL_MS = Number(process.env.KIE_POLL_MS || 5000);

async function kie(p, { method = "GET", body } = {}) {
  const key = getSettings().kie_api_key;
  if (!key) throw Object.assign(new Error("Clé Kie.ai manquante : ajoute-la dans Réglages."), { status: 400 });
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (typeof data.code === "number" && data.code !== 200)) {
    const code = data.code || res.status;
    const msg = data.msg || data.message || `erreur ${res.status}`;
    const fail = (m) => Object.assign(new Error(m), { status: 502 });
    if (code === 401) throw fail(`Clé Kie.ai refusée : ${msg}`);
    if (code === 402) throw fail(`Crédit Kie.ai insuffisant : ${msg}`);
    throw fail(`Kie.ai : ${msg}`);
  }
  return data.data;
}

/** Morceau Suno : on prend celui demandé (audioId) ou le premier. */
export async function fetchSunoTrack(taskId, audioId) {
  const d = await kie(`/generate/record-info?taskId=${encodeURIComponent(taskId)}`);
  const tracks = (d?.response?.sunoData || []).filter((t) => t.audioUrl || t.sourceAudioUrl);
  if (!tracks.length) throw new Error("Cette tâche Suno n'a pas (encore) de morceau terminé.");
  const t = (audioId && tracks.find((x) => x.id === audioId)) || tracks[0];
  return {
    audioId: t.id,
    title: t.title || "",
    audioUrl: t.audioUrl || t.sourceAudioUrl,
    imageUrl: t.imageUrl || t.sourceImageUrl || null,
    lyrics: t.prompt || "",
    style: t.tags || "",
    duration: Number(t.duration) || 0,
    versions: tracks.map((x) => ({ id: x.id, title: x.title, duration: x.duration })),
  };
}

/**
 * Mots horodatés de Suno -> mots de transcription { text, start, end, br }.
 * Un mot Suno peut contenir des retours à la ligne et des repères ("[Verse]\nHello ").
 * br = 1 : nouvelle ligne ; br = 2 : nouveau couplet.
 */
export function normalizeAlignedWords(aligned) {
  const out = [];
  let pending = 0;
  for (const a of aligned || []) {
    const start = Number(a.startS ?? a.start_s ?? a.start);
    const end = Number(a.endS ?? a.end_s ?? a.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const raw = String(a.word ?? a.text ?? "");
    const parts = raw.split("\n");
    const found = [];
    parts.forEach((part, k) => {
      if (k > 0) pending = Math.max(pending, k > 1 && !parts[k - 1].trim() ? 2 : 1);
      let txt = part;
      if (/\[[^\]]*\]/.test(txt)) {
        pending = 2;
        txt = txt.replace(/\[[^\]]*\]/g, " ");
      }
      for (const w of txt.split(/\s+/).filter(Boolean)) {
        found.push({ text: w, br: out.length + found.length ? pending : 0 });
        pending = 0;
      }
    });
    // Plusieurs mots dans un même élément : on partage son temps.
    found.forEach((f, i) => {
      const s = start + ((end - start) * i) / found.length;
      const e = start + ((end - start) * (i + 1)) / found.length;
      const w = { text: f.text, start: Math.round(s * 1000) / 1000, end: Math.round(e * 1000) / 1000 };
      if (f.br) w.br = f.br;
      out.push(w);
    });
  }
  return out;
}

export async function fetchTimestampedLyrics(taskId, audioId) {
  const d = await kie("/generate/get-timestamped-lyrics", { method: "POST", body: { taskId, audioId } });
  const words = normalizeAlignedWords(d?.alignedWords);
  if (!words.length) throw new Error("Suno n'a pas renvoyé de paroles horodatées pour ce morceau.");
  return { provider: "suno", language: "", text: words.map((w) => w.text).join(" "), words };
}

/** Cherche dans une réponse les liens de la voix et de l'instrumental, quel que soit le nom des champs. */
export function findStemUrls(obj) {
  const found = {};
  const visit = (o) => {
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "string" && /^https?:\/\//.test(v)) {
        const key = k.toLowerCase();
        if (/instrument|backing|accomp/.test(key)) found.instrumental ??= v;
        else if (/vocal/.test(key) && !/remov/.test(key)) found.vocals ??= v;
      } else visit(v);
    }
  };
  visit(obj);
  return found;
}

export async function separateWithSuno(taskId, audioId, { onStatus, signal, timeoutMs = 10 * 60_000 } = {}) {
  const d = await kie("/vocal-removal/generate", {
    method: "POST",
    body: { taskId, audioId, type: "separate_vocal", callBackUrl: "https://example.invalid/kie-callback" },
  });
  const jobId = d?.taskId;
  if (!jobId) throw new Error("Kie.ai n'a pas renvoyé de numéro de tâche pour la séparation.");
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (signal?.aborted) throw new Error("Annulé.");
    await sleep(POLL_MS);
    const r = await kie(`/vocal-removal/record-info?taskId=${encodeURIComponent(jobId)}`);
    const status = String(r?.successFlag ?? r?.status ?? "").toUpperCase();
    onStatus?.(status);
    if (/FAIL|ERROR/.test(status)) throw new Error(`La séparation Suno a échoué (${r?.errorMessage || status}).`);
    const urls = findStemUrls(r?.response || r);
    if (urls.instrumental && (status === "SUCCESS" || status === "" || urls.vocals)) return urls;
  }
  throw new Error("La séparation Suno met trop de temps : réessaie plus tard.");
}

const MAX_DOWNLOAD = 300 * 1024 * 1024;
/** Télécharge un fichier https vers dest (taille bornée). */
export async function download(url, dest) {
  if (!/^https:\/\//i.test(String(url))) throw new Error("Adresse refusée (https uniquement).");
  const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`Téléchargement impossible (${res.status}).`);
  if (Number(res.headers.get("content-length")) > MAX_DOWNLOAD) throw new Error("Fichier trop gros.");
  const out = fs.createWriteStream(dest);
  let size = 0;
  try {
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > MAX_DOWNLOAD) throw new Error("Fichier trop gros.");
      if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
    }
    await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
  } catch (e) {
    out.destroy();
    fs.rmSync(dest, { force: true });
    throw e;
  }
  return { size, type: res.headers.get("content-type") || "" };
}
