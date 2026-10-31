// Réglages du site (modifiables par l'administrateur) : clés des services d'IA, nom et contact,
// formules et prix, texte de paiement, conditions. Gardés dans la base, ou dans les variables d'environnement.
import fs from "node:fs";
import path from "node:path";
import { db, DATA_DIR } from "./db.js";
import { DEFAULT_PLANS } from "../public/js/core/style.js";

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
  // Le site
  app_name: "Africa Lyrics",
  tagline: "Tes chansons en vidéos lyriques et karaoké, synchronisées mot par mot",
  support_whatsapp: "",
  support_email: "",
  watermark_text: "Fait avec {app}",
  signup_open: true,
  plans: DEFAULT_PLANS,
  payment_instructions:
    "Paie par Mobile Money (Orange Money, MTN MoMo, Wave…) au numéro indiqué par le support, puis envoie la référence de la transaction ci-dessous. Ton compte est activé dès la vérification du paiement.",
  terms: "",
  privacy: "",
  // Application Android (Play Store / APK) : valeurs données par PWABuilder ou Bubblewrap.
  android_package: "",
  android_sha256: "",
  android_app_url: "",
};

const ENV = {
  transcription_url: "TRANSCRIPTION_URL",
  transcription_model: "TRANSCRIPTION_MODEL",
  transcription_api_key: "TRANSCRIPTION_API_KEY",
  elevenlabs_api_key: "ELEVENLABS_API_KEY",
  kie_api_key: "KIE_API_KEY",
  app_name: "APP_NAME",
  support_whatsapp: "SUPPORT_WHATSAPP",
  support_email: "SUPPORT_EMAIL",
  android_package: "ANDROID_PACKAGE",
  android_sha256: "ANDROID_SHA256",
  android_app_url: "ANDROID_APP_URL",
};

export const SECRET_KEYS = ["transcription_api_key", "elevenlabs_api_key", "kie_api_key"];

const getStmt = db.prepare("SELECT key, value FROM settings");
const putStmt = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");

// Ancienne version : réglages dans data/settings.json -> repris une fois.
const OLD = path.join(DATA_DIR, "settings.json");
if (fs.existsSync(OLD)) {
  try {
    const old = JSON.parse(fs.readFileSync(OLD, "utf8"));
    for (const [k, v] of Object.entries(old)) if (k in DEFAULTS) putStmt.run(k, JSON.stringify(v));
    fs.renameSync(OLD, `${OLD}.importe`);
  } catch {}
}

// Relu toutes les 2 secondes : une autre copie du serveur a peut-être enregistré des réglages.
let cache = null;
let cacheAt = 0;
function stored() {
  if (!cache || Date.now() - cacheAt > 2000) {
    cache = Object.fromEntries(getStmt.all().map((r) => [r.key, JSON.parse(r.value)]));
    cacheAt = Date.now();
  }
  return cache;
}

export function getSettings() {
  const s = { ...DEFAULTS, ...stored() };
  for (const [k, env] of Object.entries(ENV)) if (!s[k] && process.env[env]) s[k] = process.env[env];
  // Formules : on complète celles enregistrées avec les champs ajoutés depuis.
  const plans = {};
  for (const [id, p] of Object.entries(s.plans || DEFAULT_PLANS)) plans[id] = { ...(DEFAULT_PLANS[id] || DEFAULT_PLANS.pro), ...p };
  if (!plans.free) plans.free = DEFAULT_PLANS.free;
  s.plans = plans;
  return s;
}

export function setSettings(patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULTS)) continue;
    putStmt.run(k, JSON.stringify(typeof v === "string" ? v.trim() : v));
  }
  cache = null;
  return getSettings();
}

/** Réglages montrés à l'administrateur : les clés sont masquées. */
export function adminSettings() {
  const s = getSettings();
  const out = {};
  for (const k of Object.keys(DEFAULTS)) out[k] = SECRET_KEYS.includes(k) ? (s[k] ? `••••${s[k].slice(-4)}` : "") : s[k];
  return out;
}

/** Ce que tout visiteur peut voir (page d'accueil, tarifs, conditions). */
export function publicConfig() {
  const s = getSettings();
  return {
    app_name: s.app_name,
    tagline: s.tagline,
    support_whatsapp: s.support_whatsapp,
    support_email: s.support_email,
    signup_open: !!s.signup_open,
    plans: s.plans,
    payment_instructions: s.payment_instructions,
    terms: s.terms,
    privacy: s.privacy,
    android_app_url: s.android_app_url,
  };
}

export const watermarkText = () => {
  const s = getSettings();
  return String(s.watermark_text || "").replace(/\{app\}/g, s.app_name || "Africa Lyrics");
};
