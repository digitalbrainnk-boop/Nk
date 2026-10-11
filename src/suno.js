// Création de chansons avec Suno via Kie.ai.
//   POST https://api.kie.ai/api/v1/generate               -> { data: { taskId } }
//   GET  https://api.kie.ai/api/v1/generate/record-info?taskId=...
//        -> data.status (PENDING, TEXT_SUCCESS, FIRST_SUCCESS, SUCCESS, ...)
//        -> data.response.sunoData[] { audioUrl, streamAudioUrl, imageUrl, title, duration }
import { getSettings } from "./db.js";
import { kieKey } from "./openai-compat.js";

const BASE = "https://api.kie.ai/api/v1";
const FAILED = new Set(["CREATE_TASK_FAILED", "GENERATE_AUDIO_FAILED", "CALLBACK_EXCEPTION", "SENSITIVE_WORD_ERROR", "FAILED", "ERROR"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POLL_MS = Number(process.env.SUNO_POLL_MS || 6000);

async function kie(path, { method = "GET", body } = {}) {
  const key = kieKey();
  if (!key) throw new Error("Clé Kie.ai manquante : colle-la dans Réglages → Kie.ai.");
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (typeof data.code === "number" && data.code !== 200)) {
    const msg = data.msg || data.message || `Erreur ${res.status}`;
    if ((data.code || res.status) === 401) throw new Error(`Clé Kie.ai refusée : ${msg}`);
    if ((data.code || res.status) === 402) throw new Error(`Crédit Kie.ai insuffisant : ${msg}`);
    throw new Error(`Suno (Kie.ai) : ${msg}`);
  }
  return data.data;
}

/**
 * Lance la création. Paroles fournies -> mode personnalisé (titre + style + paroles).
 * @returns {Promise<string>} taskId
 */
export async function startSong({ title, style, lyrics, instrumental = false, callBackUrl }) {
  const body = {
    customMode: true,
    instrumental,
    model: getSettings().suno_model || "V5",
    title: (title || "Ma chanson").slice(0, 80),
    style: (style || "").slice(0, 1000),
    prompt: instrumental ? undefined : (lyrics || "").slice(0, 5000),
    // Obligatoire pour Kie ; on suit l'avancement nous-mêmes, l'adresse peut être injoignable.
    callBackUrl: callBackUrl || "https://example.invalid/kie-callback",
  };
  const data = await kie("/generate", { method: "POST", body });
  if (!data?.taskId) throw new Error("Suno n'a pas renvoyé de numéro de tâche.");
  return data.taskId;
}

/** Attend la fin (1 à 5 minutes en général) et renvoie les morceaux créés. */
export async function waitSong(taskId, { onStatus, timeoutMs = 12 * 60_000 } = {}) {
  const until = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < until) {
    const d = await kie(`/generate/record-info?taskId=${encodeURIComponent(taskId)}`);
    const status = String(d?.status || "PENDING").toUpperCase();
    if (status !== last) onStatus?.(status);
    last = status;
    if (FAILED.has(status)) {
      throw new Error(status === "SENSITIVE_WORD_ERROR" ? "Suno a refusé les paroles (mot sensible)." : `Suno a échoué (${status}).`);
    }
    const tracks = (d?.response?.sunoData || []).filter((t) => t.audioUrl);
    if (status === "SUCCESS" && tracks.length) return tracks;
    await sleep(POLL_MS);
  }
  throw new Error("Suno met trop de temps : réessaie plus tard.");
}
