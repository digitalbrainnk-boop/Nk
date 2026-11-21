// Fichiers (photos, vidéos, vocaux, documents) : extensions, conversion des
// vocaux et préparation du contenu à envoyer via Baileys.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const EXT_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "video/mp4": ".mp4",
  "video/3gpp": ".3gp",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "audio/ogg": ".ogg",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/aac": ".aac",
  "audio/webm": ".webm",
  "audio/wav": ".wav",
  "application/pdf": ".pdf",
  "application/zip": ".zip",
  "text/plain": ".txt",
};

/** Extension de fichier sûre à partir du type MIME (ou du nom d'origine). */
export function extFor(mimetype, fileName) {
  const base = String(mimetype || "").split(";")[0].trim().toLowerCase();
  if (EXT_BY_MIME[base]) return EXT_BY_MIME[base];
  const fromName = path.extname(String(fileName || "")).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(fromName) ? fromName : ".bin";
}

/** Nom de fichier sans risque pour un identifiant de message WhatsApp. */
export const safeFileId = (id) => String(id).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);

/** Nom d'origine nettoyé (affiché au destinataire). */
export function cleanFileName(name, fallback = "fichier") {
  const clean = String(name || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .trim()
    .slice(0, 120);
  return clean || fallback;
}

let ffmpegAvailable;
/** ffmpeg sert à convertir les vocaux enregistrés dans l'app au format WhatsApp (OGG/Opus). */
export function hasFfmpeg() {
  if (ffmpegAvailable === undefined) {
    try {
      ffmpegAvailable = spawnSync("ffmpeg", ["-version"], { stdio: "ignore", timeout: 5000 }).status === 0;
    } catch {
      ffmpegAvailable = false;
    }
  }
  return ffmpegAvailable;
}

/** Convertit un enregistrement (webm, mp4, ogg…) en note vocale OGG/Opus. */
export function convertToVoiceNote(input, output) {
  return new Promise((resolve, reject) => {
    const args = ["-y", "-i", input, "-vn", "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "32k", "-application", "voip", output];
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(output) : reject(new Error(`ffmpeg a échoué (${code}) : ${stderr.split("\n").slice(-3).join(" ")}`))));
  });
}

/**
 * Contenu Baileys pour un fichier envoyé depuis l'app.
 * Les formats que WhatsApp n'affiche pas directement partent en document.
 * @returns {{ content: object, kind: string }}
 */
export function buildMediaContent({ filePath, mimetype, fileName, caption, voice }) {
  const mime = String(mimetype || "application/octet-stream").toLowerCase();
  const media = { url: filePath };
  const text = caption || undefined;
  if (voice) return { kind: "voice", content: { audio: media, ptt: true, mimetype: "audio/ogg; codecs=opus" } };
  if (["image/jpeg", "image/png", "image/webp"].includes(mime.split(";")[0])) {
    return { kind: "image", content: { image: media, caption: text, mimetype: mime } };
  }
  if (mime.startsWith("video/mp4") || mime.startsWith("video/3gpp")) {
    return { kind: "video", content: { video: media, caption: text, mimetype: mime } };
  }
  if (/^audio\/(mpeg|mp4|aac|ogg)/.test(mime)) {
    return { kind: "audio", content: { audio: media, mimetype: mime } };
  }
  return { kind: "document", content: { document: media, mimetype: mime, fileName: cleanFileName(fileName), caption: text } };
}

export function removeQuietly(file) {
  if (!file) return;
  fs.promises.rm(file, { force: true }).catch(() => {});
}
