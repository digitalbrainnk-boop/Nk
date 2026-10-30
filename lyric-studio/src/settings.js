// Réglages (clés des services d'IA) dans data/settings.json, ou dans les variables d'environnement.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "./store.js";

const FILE = path.join(DATA_DIR, "settings.json");

const DEFAULTS = {
  // Service de transcription compatible Whisper (Groq par défaut, ou OpenAI…)
  transcription_url: "https://api.groq.com/openai/v1/audio/transcriptions",
  transcription_model: "whisper-large-v3",
  transcription_api_key: "",
  elevenlabs_api_key: "",
  elevenlabs_model: "scribe_v1",
  kie_api_key: "",
  // auto = ElevenLabs si sa clé est là (plus précis sur le chant), sinon Whisper
  transcription_provider: "auto",
  language: "",
};

const ENV = {
  transcription_url: "TRANSCRIPTION_URL",
  transcription_model: "TRANSCRIPTION_MODEL",
  transcription_api_key: "TRANSCRIPTION_API_KEY",
  elevenlabs_api_key: "ELEVENLABS_API_KEY",
  kie_api_key: "KIE_API_KEY",
};

export const SECRET_KEYS = ["transcription_api_key", "elevenlabs_api_key", "kie_api_key"];

let cache = null;
function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    cache = {};
  }
  return cache;
}

export function getSettings() {
  const s = { ...DEFAULTS, ...load() };
  for (const [k, env] of Object.entries(ENV)) if (!s[k] && process.env[env]) s[k] = process.env[env];
  return s;
}

export function setSettings(patch) {
  const next = { ...load() };
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULTS) && k !== "secret") continue;
    next[k] = typeof v === "string" ? v.trim() : v;
  }
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
  cache = next;
  return getSettings();
}

/** Réglages montrables dans le navigateur : les clés sont masquées. */
export function publicSettings() {
  const s = getSettings();
  const out = {};
  for (const k of Object.keys(DEFAULTS)) {
    out[k] = SECRET_KEYS.includes(k) ? (s[k] ? `••••${s[k].slice(-4)}` : "") : s[k];
  }
  return out;
}

/** Secret de signature des sessions (créé une fois). */
export function sessionSecret() {
  const s = load();
  if (s.secret) return s.secret;
  const secret = crypto.randomBytes(32).toString("hex");
  setSettings({ secret });
  return secret;
}
