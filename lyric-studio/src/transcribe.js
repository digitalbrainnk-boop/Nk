// Transcription minutée mot par mot par l'IA :
//   - service compatible Whisper (Groq, OpenAI…) : verbose_json + timestamp_granularities[]=word ;
//   - ElevenLabs Scribe : /v1/speech-to-text avec timestamps_granularity=word.
// Résultat commun : { provider, language, text, words: [{ text, start, end }] }.
import fs from "node:fs";
import path from "node:path";
import { getSettings } from "./settings.js";

const ELEVEN_BASE = process.env.ELEVENLABS_BASE || "https://api.elevenlabs.io/v1";

export function availableProviders(s = getSettings()) {
  const out = [];
  if (s.elevenlabs_api_key) out.push("elevenlabs");
  if (s.transcription_api_key && s.transcription_url) out.push("whisper");
  return out;
}

export function pickProvider(wanted, s = getSettings()) {
  const list = availableProviders(s);
  if (wanted && wanted !== "auto") {
    if (!list.includes(wanted))
      throw fail(
        400,
        wanted === "elevenlabs" ? "Clé ElevenLabs manquante (Réglages)." : "Clé de transcription Whisper manquante (Réglages).",
      );
    return wanted;
  }
  if (s.transcription_provider && s.transcription_provider !== "auto" && list.includes(s.transcription_provider))
    return s.transcription_provider;
  return list[0] || null;
}

const num = (x) => (Number.isFinite(+x) ? Math.round(+x * 1000) / 1000 : null);

const fail = (status, message) => Object.assign(new Error(message), { status });

async function readError(res, label) {
  const data = await res.json().catch(() => null);
  const d = data?.error?.message || data?.detail?.message || data?.detail || data?.message;
  const msg = typeof d === "string" ? d : `erreur ${res.status}`;
  if (res.status === 401 || res.status === 403) return fail(502, `${label} : clé refusée (${msg}).`);
  if (res.status === 413) return fail(502, `${label} : fichier trop gros pour le service.`);
  if (res.status === 429) return fail(502, `${label} : trop de demandes ou crédit épuisé, réessaie plus tard.`);
  return fail(502, `${label} : ${msg}`);
}

async function whisper(file, { language, prompt, s }) {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(file)], { type: "audio/wav" }), path.basename(file));
  form.append("model", s.transcription_model || "whisper-large-v3");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("timestamp_granularities[]", "segment");
  form.append("temperature", "0");
  if (language) form.append("language", language);
  // Les paroles connues guident la reconnaissance (Whisper lit ~200 mots au plus).
  if (prompt) form.append("prompt", prompt.replace(/\s+/g, " ").slice(0, 700));
  const res = await fetch(s.transcription_url, {
    method: "POST",
    headers: { Authorization: `Bearer ${s.transcription_api_key}` },
    body: form,
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) throw await readError(res, "Transcription");
  const data = await res.json();
  let words = (data.words || []).map((w) => ({ text: String(w.word ?? w.text ?? "").trim(), start: num(w.start), end: num(w.end) }));
  // Certains services ne donnent les mots que dans les segments.
  if (!words.length)
    for (const seg of data.segments || [])
      for (const w of seg.words || []) words.push({ text: String(w.word ?? "").trim(), start: num(w.start), end: num(w.end) });
  words = words.filter((w) => w.text && w.start !== null && w.end !== null);
  if (!words.length && data.text)
    throw fail(502, "Le service de transcription ne donne pas le minutage des mots : utilise Groq, OpenAI (whisper-1) ou ElevenLabs.");
  return { provider: "whisper", language: data.language || language || "", text: data.text || "", words };
}

async function eleven(file, { language, s }) {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(file)], { type: "audio/wav" }), path.basename(file));
  form.append("model_id", s.elevenlabs_model || "scribe_v1");
  form.append("timestamps_granularity", "word");
  form.append("tag_audio_events", "false");
  if (language) form.append("language_code", language);
  const res = await fetch(`${ELEVEN_BASE}/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": s.elevenlabs_api_key },
    body: form,
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) throw await readError(res, "ElevenLabs");
  const data = await res.json();
  const words = (data.words || [])
    .filter((w) => (w.type || "word") === "word")
    .map((w) => ({ text: String(w.text || "").trim(), start: num(w.start), end: num(w.end) }))
    .filter((w) => w.text && w.start !== null && w.end !== null);
  return { provider: "elevenlabs", language: data.language_code || language || "", text: data.text || "", words };
}

/**
 * @param file  WAV (mono 16 kHz préparé par le navigateur)
 * @param opts  { provider: auto|whisper|elevenlabs, language, prompt (paroles connues) }
 */
export async function transcribe(file, { provider = "auto", language = "", prompt = "" } = {}) {
  const s = getSettings();
  const p = pickProvider(provider, s);
  if (!p) throw fail(400, "Aucun service de transcription configuré : ajoute une clé dans Réglages (Groq, OpenAI ou ElevenLabs).");
  const lang = String(language || s.language || "")
    .slice(0, 5)
    .toLowerCase();
  return p === "elevenlabs" ? eleven(file, { language: lang, s }) : whisper(file, { language: lang, prompt, s });
}
