// Sauvegardes automatiques : une copie complète et cohérente de la base chaque jour
// (après le bilan de 03 h 00), les 30 dernières conservées, vérifiées à la création.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getDataDir, raw, getSetting, setSetting } from "./db.js";
import { now, localParts } from "./time.js";
import { bad, notFound } from "./util.js";

const KEEP = Number(process.env.BACKUP_KEEP || 30);
const dir = () => path.join(getDataDir(), "sauvegardes");
const pad = (n) => String(n).padStart(2, "0");

export function verifyBackupFile(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const ok = db.prepare("PRAGMA integrity_check").get();
    const users = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
    return { ok: Object.values(ok)[0] === "ok", users };
  } finally {
    db.close();
  }
}

export function backupNow(reason = "manuelle") {
  const p = localParts(now());
  const name = `maquis-${p.y}${pad(p.m)}${pad(p.d)}-${pad(p.H)}${pad(p.M)}${pad(p.S)}.db`;
  const file = path.join(dir(), name);
  if (fs.existsSync(file)) fs.rmSync(file);
  raw().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const check = verifyBackupFile(file);
  if (!check.ok) {
    fs.rmSync(file, { force: true });
    throw new Error("La sauvegarde créée est invalide.");
  }
  setSetting("last_backup", { at: now(), name, reason });
  rotate();
  return { name, size: fs.statSync(file).size };
}

function rotate() {
  const files = listBackups();
  for (const f of files.slice(KEEP)) fs.rmSync(path.join(dir(), f.name), { force: true });
}

export function listBackups() {
  if (!fs.existsSync(dir())) return [];
  return fs
    .readdirSync(dir())
    .filter((f) => /^maquis-\d{8}-\d{6}\.db$/.test(f))
    .map((name) => ({ name, size: fs.statSync(path.join(dir(), name)).size, at: fs.statSync(path.join(dir(), name)).mtimeMs }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

export function backupPath(name) {
  if (!/^maquis-\d{8}-\d{6}\.db$/.test(String(name))) throw bad("Nom de sauvegarde invalide.");
  const file = path.join(dir(), name);
  if (!fs.existsSync(file)) throw notFound("Sauvegarde introuvable.");
  return file;
}

export function backupIfDue() {
  const last = getSetting("last_backup");
  if (last?.at && now() - last.at < 20 * 3600000) return null;
  try {
    return backupNow("automatique");
  } catch (e) {
    console.error("Sauvegarde automatique impossible :", e.message);
    return null;
  }
}

// Restauration : la copie choisie remplacera la base au prochain démarrage (l'actuelle est gardée).
export function scheduleRestore(file) {
  const check = verifyBackupFile(file);
  if (!check.ok || !check.users) throw bad("Ce fichier n'est pas une sauvegarde valide de MAQUIS PRO MANAGER.");
  fs.copyFileSync(file, path.join(getDataDir(), "restauration-en-attente.db"));
  return check;
}
