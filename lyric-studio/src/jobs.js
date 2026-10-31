// Tâches longues (séparation de la voix, assemblage d'un export) suivies par le navigateur.
// L'état est gardé dans la base : chez un hébergeur (Passenger, o2switch…), plusieurs copies du serveur
// tournent parfois en même temps, et le navigateur peut interroger une autre copie que celle qui travaille.
import crypto from "node:crypto";
import { db } from "./db.js";

db.exec(`
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  project_id TEXT NOT NULL,
  state TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  result TEXT,
  error TEXT,
  pid INTEGER NOT NULL,
  cancel INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);
`);

const local = new Map(); // tâches qui tournent dans ce processus : id -> AbortController

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

const toJob = (r) =>
  r && {
    id: r.id,
    kind: r.kind,
    projectId: r.project_id,
    state: r.state,
    progress: r.progress,
    message: r.message,
    result: r.result ? JSON.parse(r.result) : null,
    error: r.error,
    startedAt: r.started_at,
    endedAt: r.ended_at,
  };

function finish(id, patch) {
  db.prepare("UPDATE jobs SET state = ?, progress = ?, result = ?, error = ?, ended_at = ? WHERE id = ? AND state = 'running'").run(
    patch.state,
    patch.progress ?? 0,
    patch.result === undefined ? null : JSON.stringify(patch.result),
    patch.error ?? null,
    Date.now(),
    id,
  );
}

export function startJob(kind, projectId, fn) {
  const id = crypto.randomBytes(8).toString("hex");
  db.prepare("INSERT INTO jobs (id, kind, project_id, state, pid, started_at) VALUES (?, ?, ?, 'running', ?, ?)").run(
    id,
    kind,
    projectId,
    process.pid,
    Date.now(),
  );
  const controller = new AbortController();
  local.set(id, controller);
  // Avancement écrit au plus 3 fois par seconde (le message, lui, tout de suite).
  let last = 0;
  let lastMessage = "";
  const update = (patch) => {
    const t = Date.now();
    const msgChanged = patch.message !== undefined && patch.message !== lastMessage;
    if (!msgChanged && t - last < 300) return;
    last = t;
    if (patch.message !== undefined) lastMessage = patch.message;
    db.prepare("UPDATE jobs SET progress = COALESCE(?, progress), message = COALESCE(?, message) WHERE id = ?").run(
      patch.progress ?? null,
      patch.message ?? null,
      id,
    );
  };
  // Une annulation demandée par une autre copie du serveur arrive par la base.
  const watch = setInterval(() => {
    if (db.prepare("SELECT cancel FROM jobs WHERE id = ?").get(id)?.cancel) controller.abort();
  }, 1000);
  watch.unref?.();
  Promise.resolve()
    .then(() => fn({ update, signal: controller.signal }))
    .then((result) => finish(id, { state: "done", progress: 1, result }))
    .catch((e) => finish(id, { state: "error", error: controller.signal.aborted ? "Annulé." : e.message || String(e) }))
    .finally(() => {
      clearInterval(watch);
      local.delete(id);
    });
  // Ménage : on oublie les tâches finies depuis plus d'un jour.
  db.prepare("DELETE FROM jobs WHERE ended_at IS NOT NULL AND ended_at < ?").run(Date.now() - 86400_000);
  return getJob(id);
}

export function getJob(id) {
  const r = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
  if (!r) return null;
  // La copie du serveur qui faisait la tâche s'est arrêtée (redémarrage) : la tâche ne finira jamais.
  if (r.state === "running" && !local.has(id) && !alive(r.pid)) {
    finish(id, { state: "error", error: "Le serveur a redémarré pendant la tâche : relance-la." });
    return toJob(db.prepare("SELECT * FROM jobs WHERE id = ?").get(id));
  }
  return toJob(r);
}

export function cancelJob(id) {
  db.prepare("UPDATE jobs SET cancel = 1 WHERE id = ?").run(id);
  local.get(id)?.abort();
  finish(id, { state: "error", error: "Annulé." });
}

export function runningJob(projectId, kind) {
  for (const r of db.prepare("SELECT id FROM jobs WHERE project_id = ? AND kind = ? AND state = 'running'").all(projectId, kind)) {
    const j = getJob(r.id);
    if (j.state === "running") return j;
  }
  return null;
}

/** File d'attente : au plus `max` tâches lourdes en même temps, les autres attendent leur tour. */
export function queue(max = 1) {
  let active = 0;
  const waiting = [];
  const next = () => {
    while (active < max && waiting.length) {
      const w = waiting.shift();
      if (w.signal?.aborted) {
        w.reject(new Error("Annulé."));
        continue;
      }
      active++;
      Promise.resolve()
        .then(w.fn)
        .then(w.resolve, w.reject)
        .finally(() => {
          active--;
          next();
        });
    }
  };
  return (fn, signal) =>
    new Promise((resolve, reject) => {
      waiting.push({ fn, resolve, reject, signal });
      next();
    });
}
