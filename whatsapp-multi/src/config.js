// Configuration lue depuis les variables d'environnement (fichier .env).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readInt(env, name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`Variable ${name} invalide : « ${raw} » (attendu : entier entre ${min} et ${max})`);
  }
  return n;
}

function readBool(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "oui", "on"].includes(String(raw).toLowerCase());
}

function readList(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseTrustProxy(raw) {
  if (!raw) return false;
  if (/^\d+$/.test(raw)) return Number(raw); // nombre de proxys devant le serveur
  if (raw === "true") return true;
  return raw; // ex. "loopback" ou une liste d'adresses
}

/**
 * Jeton d'accès à l'API : API_TOKEN si défini, sinon un jeton généré une fois
 * puis conservé dans data/api-token.txt (il survit aux redémarrages).
 */
function resolveApiToken(env, dataDir) {
  if (env.API_TOKEN) return { token: env.API_TOKEN.trim(), source: "env" };
  const file = path.join(dataDir, "api-token.txt");
  try {
    const saved = fs.readFileSync(file, "utf8").trim();
    if (saved) return { token: saved, source: "file", file };
  } catch {
    // pas encore de jeton enregistré
  }
  const token = crypto.randomBytes(24).toString("base64url");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return { token, source: "generated", file };
}

export function loadConfig(env = process.env, overrides = {}) {
  const dataDir = path.resolve(overrides.dataDir ?? env.DATA_DIR ?? path.join(ROOT_DIR, "data"));
  const auth = overrides.apiToken
    ? { token: overrides.apiToken, source: "override" }
    : resolveApiToken(env, dataDir);

  return {
    port: overrides.port ?? readInt(env, "PORT", 3000, { min: 0, max: 65535 }),
    host: env.HOST || "0.0.0.0",
    // Derrière un proxy (Nginx, Caddy, Cloudflare…) : ex. TRUST_PROXY=1 pour lire la vraie IP.
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    dataDir,
    sessionsDir: path.join(dataDir, "sessions"),
    publicDir: path.join(ROOT_DIR, "public"),
    apiToken: auth.token,
    apiTokenSource: auth.source,
    apiTokenFile: auth.file ?? null,
    // Origines autorisées à appeler l'API depuis un autre domaine (app Capacitor, autre front…).
    corsOrigins: readList(env, "CORS_ORIGINS", ["capacitor://localhost", "http://localhost", "https://localhost"]),
    logLevel: env.LOG_LEVEL || "info",
    baileysLogLevel: env.BAILEYS_LOG_LEVEL || "silent",
    maxSessions: readInt(env, "MAX_SESSIONS", 10, { min: 1, max: 100 }),
    maxMessagesPerChat: readInt(env, "MAX_MESSAGES_PER_CHAT", 200, { min: 10, max: 5000 }),
    maxChatsPerSession: readInt(env, "MAX_CHATS_PER_SESSION", 500, { min: 10, max: 10000 }),
    historySync: readBool(env, "HISTORY_SYNC", true),
    reconnect: {
      baseDelayMs: readInt(env, "RECONNECT_BASE_DELAY_MS", 2000, { min: 100 }),
      maxDelayMs: readInt(env, "RECONNECT_MAX_DELAY_MS", 120000, { min: 1000 }),
      // 0 = on réessaie indéfiniment (avec un délai plafonné).
      maxAttempts: readInt(env, "RECONNECT_MAX_ATTEMPTS", 0, { min: 0 }),
    },
    ...overrides,
  };
}
