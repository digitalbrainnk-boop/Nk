// Fichiers reçus (vocaux, photos) et transcription des messages vocaux.
// Claude ne lit pas l'audio directement : on passe par un service de
// transcription compatible "Whisper" (Groq par défaut, ou OpenAI, etc.).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR, getSettings } from "./db.js";

const EXT = {
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/x-m4a": "m4a",
  "audio/webm": "webm",
  "audio/opus": "opus",
  "audio/amr": "amr",
  "video/mp4": "mp4",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function saveMedia(buffer, mime) {
  // Seuls les types connus (sons, images) sont gardés tels quels : jamais de « text/html ».
  let clean = (mime || "application/octet-stream").split(";")[0].trim().toLowerCase();
  if (!EXT[clean]) clean = "application/octet-stream";
  const ext = EXT[clean] || "bin";
  const file = path.join(DATA_DIR, "media", `${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${ext}`);
  fs.writeFileSync(file, buffer);
  return { path: file, mime: clean };
}

const MAX_DOWNLOAD = 60 * 1024 * 1024;
export async function downloadToMedia(url, headers = {}) {
  if (!/^https:\/\//i.test(String(url))) throw new Error("Adresse de fichier refusée (https uniquement).");
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Téléchargement impossible (${res.status})`);
  if (Number(res.headers.get("content-length")) > MAX_DOWNLOAD) throw new Error("Fichier trop gros.");
  // Lecture bornée : on s'arrête au-delà de 60 Mo.
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > MAX_DOWNLOAD) throw new Error("Fichier trop gros.");
    chunks.push(chunk);
  }
  const mime = res.headers.get("content-type") || "application/octet-stream";
  return saveMedia(Buffer.concat(chunks), mime);
}

/**
 * Transcrit un vocal : avec le service Whisper configuré (Groq, OpenAI…) s'il y
 * en a un, sinon avec ta clé ElevenLabs, sinon avec ta clé Kie.ai (si Kie
 * propose un modèle de transcription).
 */
export async function transcribe(filePath, mime, { contactId } = {}) {
  const s = getSettings();
  // Un vocal de plus de ~15 Mo (plus de 15 minutes) n'est pas transcrit : coût et abus.
  if (fs.statSync(filePath).size > 15 * 1024 * 1024) return "(vocal très long, non transcrit : le propriétaire l'écoutera)";
  const key = s.transcription_api_key || process.env.TRANSCRIPTION_API_KEY;
  const { elevenKey, transcribeWithEleven } = await import("./elevenlabs.js");
  if (!key && elevenKey()) {
    const text = await transcribeWithEleven(filePath, mime).catch((e) => (console.error("Transcription ElevenLabs :", e.message), null));
    if (text) return text;
  }
  if (!key) {
    const { transcribeWithKie } = await import("./stt-kie.js");
    const { withCredits } = await import("./credits.js");
    return withCredits({ contactId, kind: "transcription" }, () => transcribeWithKie(filePath, mime)).catch((e) => {
      console.error("Transcription Kie :", e.message);
      return null;
    });
  }
  const form = new FormData();
  const blob = new Blob([fs.readFileSync(filePath)], { type: mime || "audio/ogg" });
  // Les services Whisper reconnaissent le format à l'extension du nom de fichier.
  const name = path.basename(filePath).replace(/\.bin$/, ".ogg");
  form.append("file", blob, name);
  form.append("model", s.transcription_model || "whisper-large-v3");
  form.append("response_format", "json");
  const res = await fetch(s.transcription_url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    console.error("Transcription échouée :", res.status, await res.text().catch(() => ""));
    return null;
  }
  const data = await res.json();
  return (data.text || "").trim();
}
