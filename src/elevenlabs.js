// TA voix : clonage, synthèse et transcription avec ElevenLabs (clé ElevenLabs).
//   POST https://api.elevenlabs.io/v1/voices/add            (name, files[])  -> voice_id
//   POST https://api.elevenlabs.io/v1/text-to-speech/{id}   (text, model_id)  -> MP3
//   POST https://api.elevenlabs.io/v1/speech-to-text        (file, model_id)  -> text
// Le clonage instantané demande un abonnement ElevenLabs « Starter » ou plus.
import fs from "node:fs";
import path from "node:path";
import { getSettings } from "./db.js";

const BASE = process.env.ELEVENLABS_BASE || "https://api.elevenlabs.io/v1";

export const elevenKey = () => getSettings().elevenlabs_api_key || process.env.ELEVENLABS_API_KEY || "";

async function call(p, { method = "POST", body, json } = {}) {
  const key = elevenKey();
  if (!key) throw new Error("Clé ElevenLabs manquante : colle-la dans Réglages → Ma voix.");
  const headers = { "xi-api-key": key };
  if (json) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${p}`, { method, headers, body: json ? JSON.stringify(json) : body });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const d = data?.detail;
    const msg = typeof d === "string" ? d : d?.message || d?.status || data?.message || `erreur ${res.status}`;
    if (res.status === 401) throw new Error("ElevenLabs : clé refusée (vérifie-la).");
    throw new Error(`ElevenLabs : ${msg}`);
  }
  return res;
}

const blobOf = (file, mime) => new Blob([fs.readFileSync(file)], { type: (mime || "audio/mpeg").split(";")[0] });

/** Crée ta voix à partir d'un ou plusieurs enregistrements. Renvoie son identifiant. */
export async function cloneVoice(files, name = "Ma voix") {
  if (!files?.length) throw new Error("Ajoute au moins un enregistrement de ta voix.");
  const form = new FormData();
  form.append("name", name.slice(0, 60));
  form.append("description", "Voix du propriétaire pour les vocaux de l'agent");
  form.append("remove_background_noise", "true");
  for (const f of files) form.append("files", blobOf(f.path, f.mime), path.basename(f.path));
  const data = await (await call("/voices/add", { body: form })).json();
  if (!data.voice_id) throw new Error("ElevenLabs n'a pas renvoyé de voix.");
  return data.voice_id;
}

/** Lit un texte avec ta voix. Renvoie le MP3. */
export async function speakWithMyVoice(text) {
  const s = getSettings();
  if (!s.elevenlabs_voice_id) throw new Error("Ta voix n'est pas encore créée : enregistre-toi dans Réglages → Ma voix.");
  const res = await call(`/text-to-speech/${encodeURIComponent(s.elevenlabs_voice_id)}?output_format=mp3_44100_128`, {
    json: {
      text: text.slice(0, 5000),
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.45, similarity_boost: 0.85, style: 0.15, use_speaker_boost: true },
    },
  });
  return Buffer.from(await res.arrayBuffer());
}

/** Transcrit un vocal (toutes langues, très fiable). */
export async function transcribeWithEleven(file, mime) {
  const form = new FormData();
  form.append("model_id", "scribe_v1");
  form.append("file", blobOf(file, mime || "audio/ogg"), path.basename(file).replace(/\.bin$/, ".ogg"));
  const data = await (await call("/speech-to-text", { body: form })).json();
  return String(data.text || "").trim() || null;
}
