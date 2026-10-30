// Appels au serveur du studio.

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);

export async function api(path, { method = "GET", json, form, body, headers = {}, signal } = {}) {
  const opts = { method, headers: { ...headers }, signal };
  if (json !== undefined) {
    opts.headers["content-type"] = "application/json";
    opts.body = JSON.stringify(json);
  } else if (form) opts.body = form;
  else if (body) opts.body = body;
  let res;
  try {
    res = await fetch(path, opts);
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new ApiError("Le studio ne répond pas : vérifie qu'il est bien lancé.", 0);
  }
  if (res.status === 401 && !path.startsWith("/api/login")) onUnauthorized();
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error || `Erreur ${res.status}`, res.status);
  return data;
}

/** Envoi d'un fichier avec suivi de l'avancement. */
export function upload(path, form, onProgress, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status === 401) onUnauthorized();
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(data?.error || `Erreur ${xhr.status}`, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError("Envoi interrompu : vérifie ta connexion.", 0));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.onabort = () => reject(new DOMException("Annulé", "AbortError"));
    xhr.send(form);
  });
}

/** Attend la fin d'une tâche du serveur (séparation, export). */
export async function waitJob(job, onProgress, { signal } = {}) {
  let j = job;
  while (j.state === "running") {
    onProgress?.(j);
    await new Promise((r) => setTimeout(r, 1000));
    if (signal?.aborted) {
      await api(`/api/jobs/${j.id}`, { method: "DELETE" }).catch(() => {});
      throw new DOMException("Annulé", "AbortError");
    }
    j = await api(`/api/jobs/${j.id}`);
  }
  if (j.state === "error") throw new ApiError(j.error || "La tâche a échoué.", 500);
  onProgress?.(j);
  return j.result;
}

export const mediaUrl = (project, file) => (file ? `/media/${project.id}/${encodeURIComponent(file)}` : null);
