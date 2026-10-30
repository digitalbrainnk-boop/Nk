// Comptes clients : inscription, connexion, sessions, formules, consommation, styles enregistrés,
// demandes d'abonnement (paiement vérifié par l'administrateur).
import crypto from "node:crypto";
import { db, monthKey } from "./db.js";
import { getSettings } from "./settings.js";
import { RESOLUTION_ORDER } from "../public/js/core/style.js";

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    if (extra) Object.assign(this, extra);
  }
}

const newId = () => crypto.randomBytes(9).toString("base64url");
const now = () => Date.now();
const SESSION_DAYS = 60;
const hashToken = (t) => crypto.createHash("sha256").update(t).digest("hex");

// ---------- Mots de passe ----------
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function checkPassword(password, stored) {
  const [kind, salt, hash] = String(stored || "").split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const got = crypto.scryptSync(String(password), Buffer.from(salt, "base64"), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(got, expected);
}

export const validEmail = (e) => typeof e === "string" && e.length <= 160 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

function checkNewPassword(p) {
  if (typeof p !== "string" || p.length < 8) throw new HttpError(400, "Le mot de passe doit faire au moins 8 caractères.");
  if (p.length > 200) throw new HttpError(400, "Mot de passe trop long.");
}

// ---------- Comptes ----------
const userCols = "id, email, name, phone, role, plan, plan_until, disabled, created_at, last_login";
export const getUser = (id) => db.prepare(`SELECT ${userCols} FROM users WHERE id = ?`).get(id) || null;
const getUserWithPassword = (email) => db.prepare("SELECT * FROM users WHERE email = ?").get(String(email || "").trim()) || null;
export const countUsers = () => db.prepare("SELECT COUNT(*) AS n FROM users").get().n;

/** Le premier compte créé (ou celui de ADMIN_EMAIL) est administrateur. */
export function createUser({ email, password, name = "", phone = "" }) {
  email = String(email || "")
    .trim()
    .toLowerCase();
  if (!validEmail(email)) throw new HttpError(400, "Adresse e-mail invalide.");
  checkNewPassword(password);
  if (getUserWithPassword(email)) throw new HttpError(409, "Un compte existe déjà avec cette adresse : connecte-toi.");
  const first = countUsers() === 0;
  const admin = first || (process.env.ADMIN_EMAIL && process.env.ADMIN_EMAIL.toLowerCase() === email);
  const id = newId();
  db.prepare("INSERT INTO users (id, email, name, phone, password, role, plan, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    id,
    email,
    String(name).trim().slice(0, 80),
    String(phone).trim().slice(0, 30),
    hashPassword(password),
    admin ? "admin" : "user",
    admin ? "studio" : "free",
    now(),
  );
  return getUser(id);
}

export function login(email, password) {
  const u = getUserWithPassword(email);
  // On calcule une empreinte même si le compte n'existe pas (même durée de réponse).
  const ok = checkPassword(password, u?.password || "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
  if (!u || !ok) throw new HttpError(401, "Adresse e-mail ou mot de passe incorrect.");
  if (u.disabled) throw new HttpError(403, "Ce compte est suspendu. Contacte le support.");
  db.prepare("UPDATE users SET last_login = ? WHERE id = ?").run(now(), u.id);
  return getUser(u.id);
}

export function updateUser(id, patch) {
  const allowed = ["name", "phone", "role", "plan", "plan_until", "disabled", "email"];
  for (const [k, v] of Object.entries(patch)) {
    if (!allowed.includes(k)) continue;
    if (k === "email" && !validEmail(v)) throw new HttpError(400, "Adresse e-mail invalide.");
    if (k === "role" && !["user", "admin"].includes(v)) throw new HttpError(400, "Rôle inconnu.");
    if (k === "plan" && !getSettings().plans[v]) throw new HttpError(400, "Formule inconnue.");
    db.prepare(`UPDATE users SET ${k} = ? WHERE id = ?`).run(k === "disabled" ? (v ? 1 : 0) : v, id);
  }
  if (patch.disabled) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  return getUser(id);
}

export function setPassword(id, password) {
  checkNewPassword(password);
  db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hashPassword(password), id);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
}

export function changePassword(id, current, next) {
  const u = db.prepare("SELECT password FROM users WHERE id = ?").get(id);
  if (!u || !checkPassword(current, u.password)) throw new HttpError(400, "Mot de passe actuel incorrect.");
  setPassword(id, next);
}

export function verifyPassword(id, password) {
  const u = db.prepare("SELECT password FROM users WHERE id = ?").get(id);
  return !!u && checkPassword(password, u.password);
}

export function deleteUser(id) {
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
}

export function listUsers({ q = "", limit = 200 } = {}) {
  const month = monthKey();
  return db
    .prepare(
      `SELECT ${userCols.replace(/(\w+)/g, "u.$1")}, COALESCE(g.ai_seconds, 0) AS ai_seconds, COALESCE(g.exports, 0) AS exports,
        (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id) AS projects,
        (SELECT COALESCE(SUM(size), 0) FROM projects p WHERE p.user_id = u.id) AS storage
       FROM users u LEFT JOIN usage g ON g.user_id = u.id AND g.month = ?
       WHERE u.email LIKE ? OR u.name LIKE ? OR u.phone LIKE ?
       ORDER BY u.created_at DESC LIMIT ?`,
    )
    .all(month, `%${q}%`, `%${q}%`, `%${q}%`, limit);
}

// ---------- Sessions ----------
export function createSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(
    hashToken(token),
    userId,
    now() + SESSION_DAYS * 86400_000,
    now(),
  );
  return { token, maxAge: SESSION_DAYS * 86400 };
}

export function sessionUser(token) {
  if (!token) return null;
  const row = db.prepare("SELECT user_id, expires_at FROM sessions WHERE token = ?").get(hashToken(token));
  if (!row || row.expires_at < now()) return null;
  const u = getUser(row.user_id);
  return u && !u.disabled ? u : null;
}

export function destroySession(token) {
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(hashToken(token));
}

export function purgeSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now());
}

// ---------- Formules et limites ----------
/** Formule en vigueur (une formule payante expirée redevient gratuite). */
export function effectivePlan(user) {
  const plans = getSettings().plans;
  let id = user.plan;
  if (id !== "free" && user.plan_until && user.plan_until < now() && user.role !== "admin") id = "free";
  if (!plans[id]) id = "free";
  return { id, ...plans[id] };
}

export function usageOf(userId, month = monthKey()) {
  return (
    db.prepare("SELECT ai_seconds, exports, stems FROM usage WHERE user_id = ? AND month = ?").get(userId, month) || {
      ai_seconds: 0,
      exports: 0,
      stems: 0,
    }
  );
}

export function addUsage(userId, { ai = 0, exports = 0, stems = 0 }) {
  db.prepare(
    `INSERT INTO usage (user_id, month, ai_seconds, exports, stems) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, month) DO UPDATE SET ai_seconds = ai_seconds + excluded.ai_seconds,
       exports = exports + excluded.exports, stems = stems + excluded.stems`,
  ).run(userId, monthKey(), ai, exports, stems);
}

export const storageOf = (userId) => db.prepare("SELECT COALESCE(SUM(size), 0) AS n FROM projects WHERE user_id = ?").get(userId).n;
export const projectCount = (userId) => db.prepare("SELECT COUNT(*) AS n FROM projects WHERE user_id = ?").get(userId).n;

/** Tout ce que le navigateur doit savoir sur le compte connecté. */
export function accountInfo(user) {
  const plan = effectivePlan(user);
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      role: user.role,
      plan: user.plan,
      plan_until: user.plan_until,
    },
    plan,
    usage: usageOf(user.id),
    storage: storageOf(user.id),
    projects: projectCount(user.id),
  };
}

const QUOTA = (msg) => new HttpError(402, msg, { upgrade: true });

/** Vérifications avant une action coûteuse. Les administrateurs n'ont pas de limite. */
export const limits = {
  newProject(user, sizeBytes = 0) {
    if (user.role === "admin") return;
    const p = effectivePlan(user);
    if (projectCount(user.id) >= p.maxProjects)
      throw QUOTA(`Ta formule ${p.name} permet ${p.maxProjects} projets : supprime-en un ou passe à une formule supérieure.`);
    limits.storage(user, sizeBytes);
  },
  storage(user, extraBytes = 0) {
    if (user.role === "admin") return;
    const p = effectivePlan(user);
    if (storageOf(user.id) + extraBytes > p.storageMb * 1024 * 1024)
      throw QUOTA(`Espace de stockage plein (${p.storageMb} Mo avec la formule ${p.name}).`);
  },
  duration(user, seconds) {
    if (user.role === "admin" || !seconds) return;
    const p = effectivePlan(user);
    if (seconds > p.maxMinutes * 60 + 5) throw QUOTA(`Chanson trop longue : ${p.maxMinutes} minutes au plus avec la formule ${p.name}.`);
  },
  ai(user, seconds) {
    if (user.role === "admin") return;
    const p = effectivePlan(user);
    const used = usageOf(user.id).ai_seconds;
    if (used + seconds > p.aiMinutes * 60) {
      throw QUOTA(
        `Minutes d'IA du mois épuisées (${p.aiMinutes} min avec la formule ${p.name}). Synchronise à la main, ou passe à une formule supérieure.`,
      );
    }
  },
  stems(user) {
    if (user.role === "admin") return;
    const p = effectivePlan(user);
    if (!p.stems) throw QUOTA(`La séparation de la voix par IA est incluse à partir de la formule Pro.`);
  },
  suno(user) {
    if (user.role === "admin") return;
    if (!effectivePlan(user).suno) throw QUOTA("L'import de chansons Suno n'est pas inclus dans ta formule.");
  },
  export(user, resolution) {
    if (user.role === "admin") return;
    const p = effectivePlan(user);
    if (RESOLUTION_ORDER.indexOf(resolution) > RESOLUTION_ORDER.indexOf(p.maxResolution))
      throw QUOTA(`La qualité ${resolution} est réservée aux formules supérieures (${p.maxResolution} au plus avec ${p.name}).`);
    if (usageOf(user.id).exports >= p.exportsPerMonth)
      throw QUOTA(`Tu as utilisé tes ${p.exportsPerMonth} exports du mois avec la formule ${p.name}.`);
  },
};

// ---------- Styles enregistrés ----------
export const listPresets = (userId) =>
  db
    .prepare("SELECT id, name, style, created_at FROM presets WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId)
    .map((r) => ({ ...r, style: JSON.parse(r.style) }));

export function addPreset(userId, name, style) {
  if (!name || typeof style !== "object" || !style) throw new HttpError(400, "Style invalide.");
  const json = JSON.stringify(style);
  if (json.length > 100_000) throw new HttpError(400, "Style trop gros.");
  if (db.prepare("SELECT COUNT(*) AS n FROM presets WHERE user_id = ?").get(userId).n >= 100)
    throw new HttpError(400, "100 styles au plus.");
  const id = newId();
  db.prepare("INSERT INTO presets (id, user_id, name, style, created_at) VALUES (?, ?, ?, ?, ?)").run(
    id,
    userId,
    String(name).slice(0, 60),
    json,
    now(),
  );
  return { id };
}

export const deletePreset = (userId, id) => db.prepare("DELETE FROM presets WHERE id = ? AND user_id = ?").run(id, userId);

// ---------- Demandes d'abonnement ----------
export function createRequest(userId, { plan, months = 1, reference = "", note = "" }) {
  if (!getSettings().plans[plan] || plan === "free") throw new HttpError(400, "Formule inconnue.");
  const m = Math.max(1, Math.min(24, Math.round(Number(months) || 1)));
  if (db.prepare("SELECT COUNT(*) AS n FROM requests WHERE user_id = ? AND status = 'pending'").get(userId).n >= 3)
    throw new HttpError(429, "Tu as déjà des demandes en attente : le support les traite au plus vite.");
  const id = newId();
  db.prepare("INSERT INTO requests (id, user_id, plan, months, reference, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    id,
    userId,
    plan,
    m,
    String(reference).slice(0, 120),
    String(note).slice(0, 500),
    now(),
  );
  return { id };
}

export const listRequests = ({ status = "pending", userId } = {}) =>
  db
    .prepare(
      `SELECT r.*, u.email, u.name, u.phone FROM requests r JOIN users u ON u.id = r.user_id
       WHERE (? = 'all' OR r.status = ?) AND (? IS NULL OR r.user_id = ?) ORDER BY r.created_at DESC LIMIT 200`,
    )
    .all(status, status, userId ?? null, userId ?? null);

/** Paiement vérifié : la formule est activée (ou prolongée) pour le nombre de mois demandé. */
export function approveRequest(id) {
  const r = db.prepare("SELECT * FROM requests WHERE id = ?").get(id);
  if (!r || r.status !== "pending") throw new HttpError(404, "Demande introuvable ou déjà traitée.");
  const u = getUser(r.user_id);
  const base = u.plan === r.plan && u.plan_until > now() ? u.plan_until : now();
  updateUser(u.id, { plan: r.plan, plan_until: base + r.months * 30 * 86400_000 });
  db.prepare("UPDATE requests SET status = 'approved', handled_at = ? WHERE id = ?").run(now(), id);
  return getUser(u.id);
}

export function rejectRequest(id) {
  db.prepare("UPDATE requests SET status = 'rejected', handled_at = ? WHERE id = ? AND status = 'pending'").run(now(), id);
}

/** Chiffres pour le tableau de bord de l'administrateur. */
export function stats() {
  const month = monthKey();
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  return {
    users: one("SELECT COUNT(*) AS n FROM users").n,
    newUsers: one("SELECT COUNT(*) AS n FROM users WHERE created_at > ?", now() - 30 * 86400_000).n,
    paying: one(
      "SELECT COUNT(*) AS n FROM users WHERE plan != 'free' AND role != 'admin' AND (plan_until IS NULL OR plan_until > ?)",
      now(),
    ).n,
    projects: one("SELECT COUNT(*) AS n FROM projects").n,
    storage: one("SELECT COALESCE(SUM(size), 0) AS n FROM projects").n,
    aiMinutes: Math.round(one("SELECT COALESCE(SUM(ai_seconds), 0) AS n FROM usage WHERE month = ?", month).n / 60),
    exports: one("SELECT COALESCE(SUM(exports), 0) AS n FROM usage WHERE month = ?", month).n,
    pending: one("SELECT COUNT(*) AS n FROM requests WHERE status = 'pending'").n,
  };
}
