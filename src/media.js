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
  "audio/webm": "webm",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function saveMedia(buffer, mime) {
  const clean = (mime || "application/octet-stream").split(";")[0].trim();
  const ext = EXT[clean] || "bin";
  const file = path.join(DATA_DIR, "media", `${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${ext}`);
  fs.writeFileSync(file, buffer);
  return { path: file, mime: clean };
}

export async function downloadToMedia(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Téléchargement impossible (${res.status})`);
  const mime = res.headers.get("content-type") || "application/octet-stream";
  return saveMedia(Buffer.from(await res.arrayBuffer()), mime);
}

export async function transcribe(filePath, mime) {
  const s = getSettings();
  const key = s.transcription_api_key || process.env.TRANSCRIPTION_API_KEY;
  if (!key) return null;
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
