// Messages vocaux : synthèse de la voix (ElevenLabs via Kie.ai).
//   POST https://api.kie.ai/api/v1/jobs/createTask  { model, input }  -> data.taskId
//   GET  https://api.kie.ai/api/v1/jobs/recordInfo?taskId=...
//        -> data.state (waiting, queuing, generating, success, fail)
//        -> data.resultJson = '{"resultUrls": ["https://...mp3"]}'
// Si ffmpeg est installé, le MP3 est converti en OGG/Opus pour s'afficher
// comme une vraie note vocale sur WhatsApp et Telegram.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { getSettings } from "./db.js";
import { kieKey } from "./openai-compat.js";
import { downloadToMedia } from "./media.js";

const BASE = "https://api.kie.ai/api/v1";
const POLL_MS = Number(process.env.KIE_POLL_MS || 3000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const TTS_VOICES = [
  "Brian", "George", "Daniel", "Roger", "Eric", "Chris", "Liam", "Will", "Bill", "Callum", "Charlie",
  "Sarah", "Laura", "Alice", "Matilda", "Jessica", "Lily", "Aria", "Charlotte", "Rachel", "River",
];

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
    throw new Error(`Voix (Kie.ai) : ${data.msg || data.message || `erreur ${res.status}`}`);
  }
  return data.data;
}

let ffmpegChecked = null;
function hasFfmpeg() {
  if (ffmpegChecked === null) {
    try {
      ffmpegChecked = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
    } catch {
      ffmpegChecked = false;
    }
  }
  return ffmpegChecked;
}

/** Convertit en note vocale OGG/Opus si possible ; sinon renvoie le fichier tel quel. */
function toVoiceNote(media) {
  if (!hasFfmpeg()) return media;
  const out = media.path.replace(/\.[a-z0-9]+$/i, "") + ".ogg";
  const r = spawnSync("ffmpeg", ["-y", "-i", media.path, "-c:a", "libopus", "-b:a", "32k", "-ac", "1", out], { stdio: "ignore" });
  if (r.status !== 0 || !fs.existsSync(out)) return media;
  return { path: out, mime: "audio/ogg; codecs=opus" };
}

/**
 * Transforme un texte en message vocal.
 * @returns {Promise<{path: string, mime: string, url: string, voiceNote: boolean}>}
 */
export async function textToSpeech(text) {
  const s = getSettings();
  const data = await kie("/jobs/createTask", {
    method: "POST",
    body: {
      model: "elevenlabs/text-to-speech-multilingual-v2", // gère bien le français
      input: {
        text: text.slice(0, 5000),
        voice: s.tts_voice || "Brian",
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0,
        speed: 1,
      },
    },
  });
  const taskId = data?.taskId;
  if (!taskId) throw new Error("Voix : pas de numéro de tâche.");
  const until = Date.now() + 3 * 60_000;
  while (Date.now() < until) {
    const d = await kie(`/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
    const state = String(d?.state || "").toLowerCase();
    if (state === "success") {
      let urls = [];
      try {
        urls = JSON.parse(d.resultJson || "{}").resultUrls || [];
      } catch {}
      if (!urls.length) throw new Error("Voix : aucun fichier audio renvoyé.");
      const media = await downloadToMedia(urls[0]);
      if (!media.mime.startsWith("audio/")) media.mime = "audio/mpeg";
      const voice = toVoiceNote(media);
      return { ...voice, url: urls[0], voiceNote: voice.mime.startsWith("audio/ogg") };
    }
    if (state === "fail" || state === "failed") throw new Error(`Voix : ${d?.failMsg || "échec de la synthèse"}`);
    await sleep(POLL_MS);
  }
  throw new Error("Voix : trop long, réessaie.");
}
