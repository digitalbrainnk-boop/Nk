// Projets enregistrés sur le disque : data/projects/<id>/project.json + fichiers (audio, stems, fonds, exports).
// Chaque projet appartient à un compte ; la liste et les tailles sont indexées dans la base.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db, DATA_DIR, TMP_DIR } from "./db.js";
import { HttpError } from "./accounts.js";
import { defaultStyle } from "../public/js/core/style.js";

export { DATA_DIR, TMP_DIR, HttpError };
const PROJECTS = path.join(DATA_DIR, "projects");
fs.mkdirSync(PROJECTS, { recursive: true });

// Champs gérés uniquement par le serveur : le navigateur ne peut pas les remplacer.
const SERVER_FIELDS = ["id", "owner", "createdAt", "media", "suno", "exports"];

export const newId = () => crypto.randomBytes(9).toString("base64url");
export const validId = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{6,40}$/.test(id);
const validName = (name) => typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(name) && !name.includes("..");

export function projectDir(id) {
  if (!validId(id)) throw new HttpError(404, "Projet introuvable.");
  return path.join(PROJECTS, id);
}

/** Chemin d'un fichier du projet, sans jamais sortir de son dossier. */
export function projectFile(id, name) {
  if (!validName(name)) throw new HttpError(404, "Fichier introuvable.");
  return path.join(projectDir(id), name);
}

function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

function readProject(id) {
  const file = path.join(projectDir(id), "project.json");
  if (!fs.existsSync(file)) throw new HttpError(404, "Projet introuvable.");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function dirSize(dir) {
  let n = 0;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.isFile()) n += fs.statSync(path.join(dir, f.name)).size;
  }
  return n;
}

/** Met à jour la ligne du projet dans l'index (liste, quotas). */
function index(p, { size } = {}) {
  const lines = p.lines?.length || 0;
  db.prepare(
    `INSERT INTO projects (id, user_id, title, artist, duration, mode, aspect, lines, synced, size, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, artist = excluded.artist, duration = excluded.duration,
       mode = excluded.mode, aspect = excluded.aspect, lines = excluded.lines, synced = excluded.synced,
       size = CASE WHEN excluded.size >= 0 THEN excluded.size ELSE projects.size END, updated_at = excluded.updated_at`,
  ).run(
    p.id,
    p.owner,
    String(p.title || "").slice(0, 200),
    String(p.artist || "").slice(0, 200),
    Number(p.duration || p.media?.audio?.duration || 0),
    p.style?.mode || "lyric",
    p.style?.aspect || "16:9",
    lines,
    p.sync?.method ? 1 : 0,
    size ?? -1,
    p.createdAt || Date.now(),
    p.updatedAt || Date.now(),
  );
}

/** Recalcule la place occupée par un projet (après un envoi de fichier ou un export). */
export function refreshSize(id) {
  db.prepare("UPDATE projects SET size = ? WHERE id = ?").run(dirSize(projectDir(id)), id);
}

/** Projet lisible par ce compte (le sien, ou n'importe lequel pour l'administrateur). */
export function getProject(id, user) {
  const p = readProject(id);
  if (user && p.owner !== user.id && user.role !== "admin") throw new HttpError(404, "Projet introuvable.");
  return p;
}

export function createProject(owner, fields = {}) {
  const id = newId();
  fs.mkdirSync(projectDir(id), { recursive: true });
  const now = Date.now();
  const project = {
    id,
    owner,
    title: "Nouvelle chanson",
    artist: "",
    lyricsText: "",
    lines: [],
    transcript: null,
    sync: { method: null, at: null, matched: 0, total: 0 },
    style: defaultStyle(),
    media: {},
    exports: [],
    ...fields,
    createdAt: now,
    updatedAt: now,
  };
  writeJson(path.join(projectDir(id), "project.json"), project);
  index(project, { size: 0 });
  return project;
}

/** Enregistre ce que le navigateur envoie, en gardant les champs du serveur. */
export function saveProject(id, user, incoming) {
  const current = getProject(id, user);
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) throw new HttpError(400, "Projet invalide.");
  if (incoming.lines !== undefined && !Array.isArray(incoming.lines)) throw new HttpError(400, "Lignes invalides.");
  const next = { ...current, ...incoming, updatedAt: Date.now() };
  for (const k of SERVER_FIELDS) next[k] = current[k];
  writeJson(path.join(projectDir(id), "project.json"), next);
  index(next);
  return next;
}

/** Modifie les champs gérés par le serveur (médias, exports…). */
export function updateProject(id, fn) {
  const p = readProject(id);
  fn(p);
  p.updatedAt = Date.now();
  writeJson(path.join(projectDir(id), "project.json"), p);
  index(p, { size: dirSize(projectDir(id)) });
  return p;
}

export function deleteProject(id) {
  fs.rmSync(projectDir(id), { recursive: true, force: true });
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
}

export function deleteUserProjects(userId) {
  for (const { id } of db.prepare("SELECT id FROM projects WHERE user_id = ?").all(userId)) deleteProject(id);
}

export function duplicateProject(id, user) {
  const src = getProject(id, user);
  const copy = createProject(src.owner, {});
  for (const f of fs.readdirSync(projectDir(id))) {
    if (f === "project.json" || f.startsWith("export-")) continue;
    fs.copyFileSync(path.join(projectDir(id), f), path.join(projectDir(copy.id), f));
  }
  const { id: _, owner, createdAt, updatedAt, exports, ...rest } = src;
  return updateProject(copy.id, (p) => Object.assign(p, rest, { title: `${src.title} (copie)`, exports: [] }));
}

export function listProjects(userId) {
  return db
    .prepare("SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC")
    .all(userId)
    .map((p) => ({
      id: p.id,
      title: p.title,
      artist: p.artist,
      duration: p.duration,
      mode: p.mode,
      aspect: p.aspect,
      lines: p.lines,
      synced: !!p.synced,
      size: p.size,
      thumb: fs.existsSync(path.join(PROJECTS, p.id, "thumb.jpg")) ? `/media/${p.id}/thumb.jpg?v=${p.updated_at}` : null,
      updatedAt: p.updated_at,
    }));
}

/**
 * Au démarrage : remet dans l'index les projets du disque qui n'y sont pas (sauvegarde restaurée,
 * ancienne version sans comptes : ces projets sont rattachés au premier administrateur).
 */
export function reindex() {
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1").get();
  for (const id of fs.readdirSync(PROJECTS)) {
    if (!validId(id) || db.prepare("SELECT 1 FROM projects WHERE id = ?").get(id)) continue;
    try {
      const p = readProject(id);
      if (!p.owner || !db.prepare("SELECT 1 FROM users WHERE id = ?").get(p.owner)) {
        if (!admin) continue;
        p.owner = admin.id;
        writeJson(path.join(projectDir(id), "project.json"), p);
      }
      index(p, { size: dirSize(projectDir(id)) });
    } catch {}
  }
}

/** Range un fichier reçu dans le dossier du projet sous un nom sûr et unique. */
export function adoptFile(id, srcPath, prefix, ext) {
  const name = `${prefix}-${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}.${ext}`;
  const dest = projectFile(id, name);
  try {
    fs.renameSync(srcPath, dest);
  } catch {
    fs.copyFileSync(srcPath, dest);
    fs.rmSync(srcPath, { force: true });
  }
  return name;
}

export function removeFile(id, name) {
  if (!name) return;
  try {
    fs.rmSync(projectFile(id, name), { force: true });
  } catch {}
}
