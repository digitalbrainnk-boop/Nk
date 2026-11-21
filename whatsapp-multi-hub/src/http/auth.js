// Accès protégé par un jeton (en-tête « Authorization: Bearer <jeton> »),
// pour l'API REST comme pour Socket.io. Les IP qui se trompent trop souvent
// sont bloquées quelques minutes.
import crypto from "node:crypto";

const MAX_FAILURES = 10;
const WINDOW_MS = 10 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;

/** Empreinte d'un jeton (pour savoir quel jeton utilise une connexion, sans le garder). */
export const tokenHash = (token) => crypto.createHash("sha256").update(String(token ?? "")).digest("base64url");

function sameToken(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a) return false;
  // Comparaison à temps constant (sur des empreintes de même longueur).
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** @param {{ getToken: () => string }} opts le jeton est relu à chaque requête (il peut changer) */
export function createAuth({ getToken, logger }) {
  const failures = new Map(); // ip -> { count, since, blockedUntil }

  function isBlocked(ip) {
    const entry = failures.get(ip);
    if (!entry) return false;
    if (entry.blockedUntil && entry.blockedUntil > Date.now()) return true;
    if (Date.now() - entry.since > WINDOW_MS) failures.delete(ip);
    return false;
  }

  function recordFailure(ip) {
    const now = Date.now();
    let entry = failures.get(ip);
    if (!entry || now - entry.since > WINDOW_MS) entry = { count: 0, since: now, blockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= MAX_FAILURES) {
      entry.blockedUntil = now + BLOCK_MS;
      logger.warn({ ip }, "Trop de jetons invalides : adresse bloquée 15 minutes");
    }
    failures.set(ip, entry);
    if (failures.size > 10000) failures.clear(); // garde-fou mémoire
  }

  function check(ip, provided) {
    if (isBlocked(ip)) return { ok: false, status: 429, message: "Trop de tentatives, réessaie plus tard." };
    if (!sameToken(provided, getToken())) {
      recordFailure(ip);
      return { ok: false, status: 401, message: "Jeton d'accès manquant ou invalide." };
    }
    failures.delete(ip);
    return { ok: true };
  }

  /** Middleware Express. */
  function http(req, res, next) {
    const header = req.get("authorization") || "";
    const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const result = check(req.ip, provided);
    if (result.ok) return next();
    res.status(result.status).json({ error: { code: result.status === 429 ? "too_many_attempts" : "unauthorized", message: result.message } });
  }

  /** Middleware Socket.io (jeton passé dans `auth: { token }` côté client). */
  function socket(sock, next) {
    const result = check(sock.handshake.address, sock.handshake.auth?.token);
    if (result.ok) {
      sock.data.tokenHash = tokenHash(sock.handshake.auth.token);
      return next();
    }
    const err = new Error(result.status === 429 ? "too_many_attempts" : "unauthorized");
    err.data = { message: result.message };
    next(err);
  }

  return { http, socket, isBlocked, recordFailure, clearFailures: (ip) => failures.delete(ip) };
}
