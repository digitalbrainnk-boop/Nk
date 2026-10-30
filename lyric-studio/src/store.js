// Projets enregistrés sur le disque : data/projects/<id>/project.json + fichiers (audio, stems, fonds, exports).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { defaultStyle } from "../public/js/core/style.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(here, "..", "data"));
const PROJECTS = path.join(DATA_DIR, "projects");
export const TMP_DIR = path.join(DATA_DIR, "tmp");
fs.mkdirSync(PROJECTS, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

// Champs gérés uniquement par le serveur : le navigateur ne peut pas les remplacer.
const SERVER_FIELDS = ["id", "createdAt", "media", "suno", "exports"];

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

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

export function getProject(id) {
  const file = path.join(projectDir(id), "project.json");
  if (!fs.existsSync(file)) throw new HttpError(404, "Projet introuvable.");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function createProject(fields = {}) {
  const id = newId();
  fs.mkdirSync(projectDir(id), { recursive: true });
  const now = Date.now();
  const project = {
    id,
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
  return project;
}

/** Enregistre ce que le navigateur envoie, en gardant les champs du serveur. */
export function saveProject(id, incoming) {
  const current = getProject(id);
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) throw new HttpError(400, "Projet invalide.");
  if (incoming.lines !== undefined && !Array.isArray(incoming.lines)) throw new HttpError(400, "Lignes invalides.");
  const next = { ...current, ...incoming, updatedAt: Date.now() };
  for (const k of SERVER_FIELDS) next[k] = current[k];
  writeJson(path.join(projectDir(id), "project.json"), next);
  return next;
}

/** Modifie les champs gérés par le serveur (médias, exports…). */
export function updateProject(id, fn) {
  const p = getProject(id);
  fn(p);
  p.updatedAt = Date.now();
  writeJson(path.join(projectDir(id), "project.json"), p);
  return p;
}

export function deleteProject(id) {
  fs.rmSync(projectDir(id), { recursive: true, force: true });
}

export function duplicateProject(id) {
  const src = getProject(id);
  const copy = createProject({});
  for (const f of fs.readdirSync(projectDir(id))) {
    if (f === "project.json" || f.startsWith("export-")) continue;
    fs.copyFileSync(path.join(projectDir(id), f), path.join(projectDir(copy.id), f));
  }
  const { id: _, createdAt, updatedAt, exports, ...rest } = src;
  return updateProject(copy.id, (p) => Object.assign(p, rest, { title: `${src.title} (copie)`, exports: [] }));
}

export function listProjects() {
  const out = [];
  for (const id of fs.readdirSync(PROJECTS)) {
    try {
      const p = getProject(id);
      out.push({
        id: p.id,
        title: p.title,
        artist: p.artist,
        duration: p.media?.audio?.duration || 0,
        mode: p.style?.mode || "lyric",
        aspect: p.style?.aspect || "16:9",
        lines: p.lines?.length || 0,
        synced: p.sync?.method ? true : false,
        thumb: fs.existsSync(path.join(projectDir(id), "thumb.jpg")) ? `/media/${id}/thumb.jpg?v=${p.updatedAt}` : null,
        updatedAt: p.updatedAt,
      });
    } catch {}
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
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
