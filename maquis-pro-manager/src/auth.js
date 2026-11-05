// Comptes, mots de passe, sessions et permissions (vérifiés côté serveur à chaque requête).
import crypto from "node:crypto";
import { promisify } from "node:util";
import { all, get, run, tx, getSetting } from "./db.js";
import { now } from "./time.js";
import { audit } from "./audit.js";
import { AppError, bad, forbidden, notFound, str, oneOf } from "./util.js";
import { notify } from "./notify.js";

const scrypt = promisify(crypto.scrypt);
export const ROLES = ["owner", "manager", "cashier", "waiter"];
export const ROLE_LABELS = { owner: "Propriétaire", manager: "Gérant", cashier: "Caissier", waiter: "Serveur" };
const SESSION_MAX_DAYS = 30;
export const COOKIE = "mpm_session";

// ---------- Mots de passe (scrypt, sel aléatoire) ----------
export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("base64")}$${key.toString("base64")}`;
}
export async function verifyPassword(pw, stored) {
  const [alg, N, r, p, salt, hash] = String(stored || "").split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(hash, "base64");
  const key = await scrypt(String(pw), Buffer.from(salt, "base64"), expected.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(key, expected);
}
export function checkPasswordStrength(pw, role) {
  const min = role === "owner" || role === "manager" ? 8 : 6;
  if (typeof pw !== "string" || pw.length < min) throw bad(`Le mot de passe doit contenir au moins ${min} caractères.`);
  if (pw.length > 200) throw bad("Mot de passe trop long.");
  if (/^(.)\1+$/.test(pw) || ["12345678", "password", "motdepasse", "azertyui", "123456"].includes(pw.toLowerCase()))
    throw bad("Mot de passe trop facile à deviner.");
}

// ---------- Anti-devinette ----------
const failures = new Map(); // clé ip|identifiant -> { count, until }
export function loginBlockedFor(key) {
  const f = failures.get(key);
  if (!f || f.until <= Date.now()) return 0;
  return Math.ceil((f.until - Date.now()) / 1000);
}
function recordFailure(key) {
  const f = failures.get(key) || { count: 0, until: 0 };
  f.count++;
  if (f.count >= 5) f.until = Date.now() + Math.min(3600, 30 * 2 ** (f.count - 5)) * 1000;
  failures.set(key, f);
  return f.count;
}
export function resetLoginLimiter() {
  failures.clear();
}

const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
export const publicUser = (u) =>
  u && { id: u.id, username: u.username, full_name: u.full_name, phone: u.phone, role: u.role, role_label: ROLE_LABELS[u.role], active: !!u.active, must_change_password: !!u.must_change_password, created_at: u.created_at };

export async function login({ username, password, device_id, device_label }, req) {
  username = str(username, "Identifiant", { required: true, max: 60 });
  const ip = req.ip || "";
  const ua = String(req.headers["user-agent"] || "").slice(0, 300);
  device_id = str(device_id, "Appareil", { max: 80 }) || sha(ua).slice(0, 16);
  const key = `${ip}|${username.toLowerCase()}`;
  const wait = loginBlockedFor(key);
  if (wait) throw new AppError(429, `Trop d'essais. Réessayez dans ${Math.ceil(wait / 60)} minute(s).`);

  const user = get("SELECT * FROM users WHERE username = ?", username);
  const ok = user && user.active && (await verifyPassword(String(password || ""), user.password_hash));
  const at = now();
  if (!ok) {
    const count = recordFailure(key);
    run(
      "INSERT INTO login_events (at, username, user_id, success, reason, ip, user_agent, device_id) VALUES (?,?,?,?,?,?,?,?)",
      at, username, user?.id ?? null, 0, !user ? "identifiant inconnu" : !user.active ? "compte désactivé" : "mot de passe incorrect", ip, ua, device_id,
    );
    if (count === 5) {
      notify({
        roles: ["owner"],
        type: "security",
        severity: "danger",
        title: "Tentatives de connexion suspectes",
        body: `5 essais de mot de passe incorrects pour l'identifiant « ${username} » (adresse ${ip}).`,
        link: "#/admin/connexions",
      });
    }
    throw new AppError(401, "Identifiant ou mot de passe incorrect.");
  }
  failures.delete(key);

  const token = crypto.randomBytes(32).toString("base64url");
  const known = get("SELECT 1 FROM known_devices WHERE user_id = ? AND device_id = ?", user.id, device_id);
  tx(() => {
    run(
      `INSERT INTO sessions (token_hash, user_id, device_id, device_label, user_agent, ip, created_at, last_seen_at, expires_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      sha(token), user.id, device_id, str(device_label, "Appareil", { max: 80 }) || deviceName(ua), ua, ip, at, at, at + SESSION_MAX_DAYS * 86400000,
    );
    run(
      "INSERT INTO known_devices (user_id, device_id, first_seen, last_seen) VALUES (?,?,?,?) ON CONFLICT DO UPDATE SET last_seen = excluded.last_seen",
      user.id, device_id, at, at,
    );
    run("INSERT INTO login_events (at, username, user_id, success, reason, ip, user_agent, device_id) VALUES (?,?,?,?,?,?,?,?)", at, user.username, user.id, 1, known ? "" : "nouvel appareil", ip, ua, device_id);
    audit({ user, ip, device: deviceName(ua) }, "connexion", "user", user.id, `Connexion de ${user.full_name}`);
    const firstEver = !get("SELECT 1 FROM known_devices WHERE user_id = ? AND device_id != ?", user.id, device_id);
    if (!known && !firstEver) {
      notify({
        roles: ["owner"],
        type: "security",
        severity: "warn",
        title: "Connexion depuis un nouvel appareil",
        body: `${user.full_name} (${ROLE_LABELS[user.role]}) s'est connecté depuis un appareil inconnu : ${deviceName(ua)}, adresse ${ip}.`,
        link: "#/admin/appareils",
      });
    }
  });
  return { token, user: publicUser(user) };
}

export function deviceName(ua = "") {
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Appareil";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return br ? `${os} · ${br}` : os;
}

export function readToken(req) {
  const c = (req.headers.cookie || "").split(";").map((x) => x.trim()).find((x) => x.startsWith(COOKIE + "="));
  return c ? decodeURIComponent(c.slice(COOKIE.length + 1)) : "";
}

// Vérifie la session : existante, non révoquée, non expirée, et pas d'inactivité trop longue.
export function sessionFromRequest(req) {
  const token = readToken(req);
  if (!token || token.length < 32) return null;
  const s = get("SELECT * FROM sessions WHERE token_hash = ?", sha(token));
  if (!s || s.revoked_at) return null;
  const user = get("SELECT * FROM users WHERE id = ?", s.user_id);
  if (!user || !user.active) return null;
  const t = now();
  const idle = (getSetting("idle_minutes") || {})[user.role] || 720;
  if (s.expires_at < t || t - s.last_seen_at > idle * 60000) {
    run("UPDATE sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ?", t, s.expires_at < t ? "expirée" : "inactivité", s.id);
    return null;
  }
  if (t - s.last_seen_at > 60000) run("UPDATE sessions SET last_seen_at = ?, ip = ? WHERE id = ?", t, req.ip || s.ip, s.id);
  return { session: s, user };
}

export function logout(req) {
  const token = readToken(req);
  if (token) run("UPDATE sessions SET revoked_at = ?, revoked_reason = 'déconnexion' WHERE token_hash = ? AND revoked_at IS NULL", now(), sha(token));
}

// ---------- Gestion des comptes ----------
// Le propriétaire gère tous les comptes ; le gérant peut gérer les caissiers et serveurs.
function canManage(actor, role) {
  if (actor.role === "owner") return true;
  return actor.role === "manager" && (role === "cashier" || role === "waiter");
}

export async function createUser(ctx, body) {
  const role = oneOf(body.role, "Rôle", ROLES);
  // Sans compte connecté : uniquement l'installation (premier compte, propriétaire).
  if (!ctx.user) {
    if (role !== "owner" || get("SELECT 1 FROM users LIMIT 1")) throw forbidden();
  } else if (!canManage(ctx.user, role)) throw forbidden("Vous ne pouvez pas créer ce type de compte.");
  const username = str(body.username, "Identifiant", { required: true, max: 40, min: 3 }).toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(username)) throw bad("Identifiant : lettres sans accent, chiffres, point, tiret uniquement.");
  const full_name = str(body.full_name, "Nom complet", { required: true, max: 80 });
  const phone = str(body.phone, "Téléphone", { max: 30 });
  checkPasswordStrength(body.password, role);
  if (get("SELECT 1 FROM users WHERE username = ?", username)) throw bad("Cet identifiant est déjà utilisé.");
  const hash = await hashPassword(body.password);
  return tx(() => {
    const t = now();
    const id = Number(
      run(
        "INSERT INTO users (username, full_name, phone, role, password_hash, must_change_password, created_at, created_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        username, full_name, phone, role, hash, ctx.user ? 1 : 0, t, ctx.user?.id ?? null, t,
      ).lastInsertRowid,
    );
    audit(ctx, "compte_cree", "user", id, `Compte ${ROLE_LABELS[role]} créé : ${full_name} (${username})`);
    if (ctx.user && ctx.user.role !== "owner")
      notify({ roles: ["owner"], type: "security", title: "Nouveau compte créé", body: `${ctx.user.full_name} a créé le compte ${ROLE_LABELS[role]} de ${full_name}.`, link: "#/admin/comptes" });
    return publicUser(get("SELECT * FROM users WHERE id = ?", id));
  });
}

export function updateUser(ctx, id, body) {
  const u = get("SELECT * FROM users WHERE id = ?", id);
  if (!u) throw notFound("Compte introuvable.");
  if (!canManage(ctx.user, u.role)) throw forbidden("Vous ne pouvez pas modifier ce compte.");
  const full_name = body.full_name !== undefined ? str(body.full_name, "Nom complet", { required: true, max: 80 }) : u.full_name;
  const phone = body.phone !== undefined ? str(body.phone, "Téléphone", { max: 30 }) : u.phone;
  let active = body.active !== undefined ? (body.active ? 1 : 0) : u.active;
  let role = u.role;
  if (body.role !== undefined && body.role !== u.role) {
    role = oneOf(body.role, "Rôle", ROLES);
    if (ctx.user.role !== "owner") throw forbidden("Seul le propriétaire peut changer un rôle.");
  }
  if (u.id === ctx.user.id && (!active || role !== u.role)) throw bad("Vous ne pouvez pas désactiver ou changer le rôle de votre propre compte.");
  if (u.role === "owner" && (!active || role !== "owner") && get("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1").n <= 1)
    throw bad("Il doit toujours rester un compte propriétaire actif.");
  return tx(() => {
    run("UPDATE users SET full_name = ?, phone = ?, active = ?, role = ?, updated_at = ? WHERE id = ?", full_name, phone, active, role, now(), id);
    if (!active) run("UPDATE sessions SET revoked_at = ?, revoked_reason = 'compte désactivé' WHERE user_id = ? AND revoked_at IS NULL", now(), id);
    audit(ctx, "compte_modifie", "user", id, `Compte de ${full_name} modifié`, { avant: publicUser(u), apres: { full_name, phone, active: !!active, role } });
    return publicUser(get("SELECT * FROM users WHERE id = ?", id));
  });
}

export async function resetPassword(ctx, id, password) {
  const u = get("SELECT * FROM users WHERE id = ?", id);
  if (!u) throw notFound("Compte introuvable.");
  if (!canManage(ctx.user, u.role) || (u.role === "owner" && u.id !== ctx.user.id && ctx.user.role !== "owner")) throw forbidden();
  checkPasswordStrength(password, u.role);
  const hash = await hashPassword(password);
  tx(() => {
    run("UPDATE users SET password_hash = ?, must_change_password = ?, updated_at = ? WHERE id = ?", hash, u.id === ctx.user.id ? 0 : 1, now(), id);
    run("UPDATE sessions SET revoked_at = ?, revoked_reason = 'mot de passe réinitialisé' WHERE user_id = ? AND revoked_at IS NULL", now(), id);
    audit(ctx, "mot_de_passe_reinitialise", "user", id, `Mot de passe de ${u.full_name} réinitialisé`);
  });
}

export async function changeOwnPassword(ctx, current, next, currentSessionId) {
  const u = get("SELECT * FROM users WHERE id = ?", ctx.user.id);
  if (!(await verifyPassword(String(current || ""), u.password_hash))) throw bad("Mot de passe actuel incorrect.");
  checkPasswordStrength(next, u.role);
  if (current === next) throw bad("Choisissez un mot de passe différent de l'actuel.");
  const hash = await hashPassword(next);
  tx(() => {
    run("UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?", hash, now(), u.id);
    run("UPDATE sessions SET revoked_at = ?, revoked_reason = 'mot de passe changé' WHERE user_id = ? AND id != ? AND revoked_at IS NULL", now(), u.id, currentSessionId);
    audit(ctx, "mot_de_passe_change", "user", u.id, `${u.full_name} a changé son mot de passe`);
  });
}

export function listUsers(ctx) {
  const rows = all("SELECT * FROM users ORDER BY active DESC, CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'cashier' THEN 2 ELSE 3 END, full_name");
  return rows.filter((u) => ctx.user.role === "owner" || u.role === "cashier" || u.role === "waiter" || u.id === ctx.user.id).map(publicUser);
}

export function listSessions(ctx) {
  const where = ctx.user.role === "owner" ? "" : "AND u.role IN ('cashier','waiter')";
  return all(
    `SELECT s.id, s.user_id, u.full_name, u.role, s.device_label, s.ip, s.created_at, s.last_seen_at, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.revoked_at IS NULL AND s.expires_at > ? ${where} ORDER BY s.last_seen_at DESC LIMIT 300`,
    now(),
  ).map((s) => ({ ...s, role_label: ROLE_LABELS[s.role] }));
}

export function revokeSession(ctx, id) {
  const s = get("SELECT s.*, u.role, u.full_name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?", id);
  if (!s) throw notFound("Session introuvable.");
  if (ctx.user.role !== "owner" && !(s.role === "cashier" || s.role === "waiter")) throw forbidden();
  tx(() => {
    run("UPDATE sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL", now(), `déconnecté par ${ctx.user.full_name}`, id);
    audit(ctx, "appareil_deconnecte", "session", id, `Appareil ${s.device_label} de ${s.full_name} déconnecté`);
  });
}
