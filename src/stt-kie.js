// Transcription des messages vocaux avec la clé Kie.ai.
// 1. On cherche dans la documentation officielle (docs.kie.ai/llms.txt) un
//    modèle « speech to text » et le nom du champ audio de son exemple.
// 2. On envoie le fichier sur l'espace de stockage de Kie (lien temporaire).
// 3. On lance la tâche (jobs/createTask) puis on lit le texte (jobs/recordInfo).
import fs from "node:fs";
import path from "node:path";
import { getSettings, setSettings } from "./db.js";
import { kieKey } from "./openai-compat.js";

const API = "https://api.kie.ai/api/v1";
const UPLOAD_URL = "https://kieai.redpandaai.co/api/file-stream-upload";
const POLL_MS = Number(process.env.KIE_POLL_MS || 3000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${url} : ${res.status}`);
  return res.text();
}

/** Extrait d'une page de doc Kie : nom du modèle et champ qui reçoit l'audio. */
export function parseSttDoc(md) {
  const models = [...md.matchAll(/"model"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
  const keys = [...md.matchAll(/"(audio[_a-z]*|file_?url|input_audio|url)"\s*:/gi)].map((m) => m[1]);
  const audioKey = keys.find((k) => /audio/i.test(k)) || keys[0] || "audio_url";
  return models.length ? { model: models[0], audioKey } : null;
}

/** Cherche (une fois, puis mémorise) un modèle de transcription chez Kie. */
export async function discoverKieStt({ fetchDoc = fetchText, force = false } = {}) {
  const saved = getSettings().kie_stt;
  if (saved?.model && !force) return saved;
  const index = await fetchDoc("https://docs.kie.ai/llms.txt");
  const pages = [];
  for (const line of index.split("\n")) {
    if (!/speech[\s-]*to[\s-]*text|transcri|scribe|\bstt\b|\basr\b|whisper/i.test(line) || line.includes("/cn/")) continue;
    for (const m of line.matchAll(/\((https:\/\/docs\.kie\.ai\/[^)\s]+?\.md)\)/g)) if (!pages.includes(m[1])) pages.push(m[1]);
  }
  for (const page of pages.slice(0, 4)) {
    try {
      const found = parseSttDoc(await fetchDoc(page));
      if (found) {
        const stt = { ...found, doc: page };
        setSettings({ kie_stt: stt });
        return stt;
      }
    } catch {}
  }
  setSettings({ kie_stt: { none: true, checked_at: Date.now() } });
  return null;
}

export async function upload(filePath, mime) {
  const form = new FormData();
  const name = path.basename(filePath);
  form.append("file", new Blob([fs.readFileSync(filePath)], { type: (mime || "audio/ogg").split(";")[0] }), name);
  form.append("uploadPath", "agent-vocaux");
  form.append("fileName", name);
  const res = await fetch(UPLOAD_URL, { method: "POST", headers: { Authorization: `Bearer ${kieKey()}` }, body: form });
  const data = await res.json().catch(() => ({}));
  const url = data?.data?.downloadUrl || data?.data?.fileUrl || data?.data?.url;
  if (!url) throw new Error(`envoi du vocal à Kie impossible (${data?.msg || res.status})`);
  return url;
}

// Le texte peut être rangé à différents endroits selon le modèle.
function findText(obj, depth = 0) {
  if (!obj || depth > 4) return null;
  if (typeof obj === "string") return null;
  for (const k of ["text", "transcript", "transcription", "result", "content"]) {
    if (typeof obj[k] === "string" && obj[k].trim()) return obj[k].trim();
  }
  for (const v of Object.values(obj)) {
    const t = typeof v === "object" ? findText(v, depth + 1) : null;
    if (t) return t;
  }
  return null;
}

/** Transcrit un fichier audio avec Kie ; renvoie null si Kie n'a pas de modèle adapté. */
export async function transcribeWithKie(filePath, mime) {
  if (!kieKey()) return null;
  const s = getSettings();
  // Pas de modèle trouvé récemment : on ne réessaie qu'une fois par jour.
  if (s.kie_stt?.none && Date.now() - (s.kie_stt.checked_at || 0) < 86400_000) return null;
  const stt = await discoverKieStt();
  if (!stt) return null;
  const url = await upload(filePath, mime);
  const headers = { Authorization: `Bearer ${kieKey()}`, "Content-Type": "application/json" };
  const created = await (
    await fetch(`${API}/jobs/createTask`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: stt.model, input: { [stt.audioKey]: url, language_code: "fr" } }),
    })
  ).json();
  const taskId = created?.data?.taskId;
  if (!taskId) throw new Error(`transcription refusée par Kie (${created?.msg || "pas de tâche"})`);
  const until = Date.now() + 3 * 60_000;
  while (Date.now() < until) {
    const d = (await (await fetch(`${API}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, { headers })).json())?.data;
    const state = String(d?.state || "").toLowerCase();
    if (state === "success") {
      let result = d.resultJson;
      try {
        result = JSON.parse(d.resultJson);
      } catch {}
      const direct = typeof result === "string" ? result : findText(result);
      if (direct) return direct;
      // Résultat sous forme de fichier (texte ou JSON) : on le lit.
      const link = result?.resultUrls?.[0];
      if (link) {
        const raw = await fetchText(link);
        try {
          return findText(JSON.parse(raw)) || raw.trim();
        } catch {
          return raw.trim();
        }
      }
      return null;
    }
    if (state === "fail" || state === "failed") throw new Error(`transcription : ${d?.failMsg || "échec"}`);
    await sleep(POLL_MS);
  }
  throw new Error("transcription trop longue");
}
