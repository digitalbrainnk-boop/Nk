// Tâches longues (séparation de la voix, assemblage d'un export) suivies par le navigateur.
import crypto from "node:crypto";

const jobs = new Map();

export function startJob(kind, projectId, fn) {
  const id = crypto.randomBytes(8).toString("hex");
  const controller = new AbortController();
  const job = { id, kind, projectId, state: "running", progress: 0, message: "", result: null, error: null, startedAt: Date.now() };
  jobs.set(id, { job, controller });
  const update = (patch) => Object.assign(job, patch);
  Promise.resolve()
    .then(() => fn({ update, signal: controller.signal }))
    .then((result) => update({ state: "done", progress: 1, result }))
    .catch((e) => update({ state: "error", error: e.message || String(e) }))
    .finally(() => (job.endedAt = Date.now()));
  // Ménage : on oublie les tâches finies depuis plus d'une heure.
  for (const [k, { job: j }] of jobs) if (j.endedAt && Date.now() - j.endedAt > 3600_000) jobs.delete(k);
  return job;
}

export function getJob(id) {
  return jobs.get(id)?.job || null;
}

export function cancelJob(id) {
  const j = jobs.get(id);
  if (j && j.job.state === "running") {
    j.controller.abort();
    j.job.state = "error";
    j.job.error = "Annulé.";
  }
}

export function runningJob(projectId, kind) {
  for (const { job } of jobs.values()) if (job.projectId === projectId && job.kind === kind && job.state === "running") return job;
  return null;
}
