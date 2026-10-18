// Client de l'API Kie.ai : Suno (musique, paroles horodatées, WAV), fichiers et images.
//   POST /api/v1/generate                       → data.taskId
//   POST /api/v1/generate/upload-cover          → data.taskId (avec morceau de référence)
//   GET  /api/v1/generate/record-info?taskId=   → data.status, data.response.sunoData[]
//   POST /api/v1/generate/get-timestamped-lyrics → data.alignedWords[], data.waveformData[]
//   POST /api/v1/wav/generate · GET /api/v1/wav/record-info
//   POST /api/v1/jobs/createTask · GET /api/v1/jobs/recordInfo (images)
//   POST https://kieai.redpandaai.co/api/file-stream-upload (fichiers publics temporaires)
import { config } from "./env";
import type { AlignedWord, KieGenerationRequest, KieRecordInfo } from "../types";


export class KieError extends Error {
  constructor(
    message: string,
    public code?: number,
  ) {
    super(message);
  }
}

const MESSAGES: Record<number, string> = {
  401: "Clé Kie.ai refusée : vérifie KIE_API_KEY.",
  402: "Crédit Kie.ai insuffisant : recharge ton compte Kie.",
  413: "Paroles ou style trop longs pour Suno.",
  429: "Trop de demandes envoyées à Kie.ai : réessaie dans une minute.",
  430: "Trop de demandes envoyées à Kie.ai : réessaie dans une minute.",
  455: "Kie.ai est en maintenance : réessaie un peu plus tard.",
};

async function kie<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  const key = config.kieKey();
  if (!key) throw new KieError("Clé Kie.ai manquante (KIE_API_KEY).", 401);
  let res: Response;
  try {
    res = await fetch(`${config.kieApiBase()}${path}`, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new KieError(`Impossible de joindre Kie.ai : ${(e as Error).message}`);
  }
  const data = (await res.json().catch(() => ({}))) as { code?: number; msg?: string; data?: T };
  // Kie renvoie parfois HTTP 200 avec { code: 4xx } dans le corps.
  const code = typeof data.code === "number" ? data.code : res.status;
  if (!res.ok || code !== 200) {
    throw new KieError(MESSAGES[code] ?? `Kie.ai : ${data.msg || `erreur ${code}`}`, code);
  }
  return data.data as T;
}

/** Refus qui ne dépendent pas du modèle (clé, crédit, cadence, maintenance) : inutile d'en changer. */
const NOT_MODEL_RELATED = new Set([401, 402, 429, 430, 455]);

/** Kie a répondu, mais a refusé la création : un autre modèle Suno peut passer. */
export function isModelRejection(e: unknown): boolean {
  return e instanceof KieError && e.code !== undefined && !NOT_MODEL_RELATED.has(e.code);
}

/** Lance une création Suno (Custom Generation, ou upload-cover si `uploadUrl` est fourni). */
export async function startSunoTask(req: KieGenerationRequest): Promise<string> {
  const path = req.uploadUrl ? "/generate/upload-cover" : "/generate";
  const data = await kie<{ taskId?: string }>(path, { method: "POST", body: req });
  if (!data?.taskId) throw new KieError("Suno n'a pas renvoyé de numéro de tâche.");
  return data.taskId;
}

export async function getSunoTask(taskId: string): Promise<KieRecordInfo> {
  const data = await kie<KieRecordInfo>(`/generate/record-info?taskId=${encodeURIComponent(taskId)}`);
  return { ...data, status: String(data?.status || "PENDING").toUpperCase() as KieRecordInfo["status"] };
}

export async function getTimestampedLyrics(taskId: string, audioId: string): Promise<{ words: AlignedWord[]; waveform: number[] }> {
  const data = await kie<{ alignedWords?: AlignedWord[]; waveformData?: number[] }>("/generate/get-timestamped-lyrics", {
    method: "POST",
    body: { taskId, audioId },
  });
  const words = (data?.alignedWords ?? [])
    .filter((w) => typeof w.word === "string" && Number.isFinite(w.startS) && Number.isFinite(w.endS))
    .map((w) => ({ word: w.word, startS: w.startS, endS: w.endS, success: w.success }));
  return { words, waveform: (data?.waveformData ?? []).filter((n) => Number.isFinite(n)) };
}

export async function startWavTask(taskId: string, audioId: string, callBackUrl: string): Promise<string> {
  const data = await kie<{ taskId?: string }>("/wav/generate", { method: "POST", body: { taskId, audioId, callBackUrl } });
  if (!data?.taskId) throw new KieError("La conversion WAV n'a pas démarré.");
  return data.taskId;
}

export async function getWavTask(taskId: string): Promise<{ status: "pending" | "ready" | "failed"; url?: string }> {
  const data = await kie<{ successFlag?: string; response?: { audioWavUrl?: string } }>(
    `/wav/record-info?taskId=${encodeURIComponent(taskId)}`,
  );
  const flag = String(data?.successFlag || "PENDING").toUpperCase();
  if (flag === "SUCCESS" && data?.response?.audioWavUrl) return { status: "ready", url: data.response.audioWavUrl };
  if (/FAIL|EXCEPTION/.test(flag)) return { status: "failed" };
  return { status: "pending" };
}

/** Génération d'image (pochette IA) via le marché de modèles Kie. */
export async function startImageTask(prompt: string, imageUrl?: string): Promise<string> {
  const model = imageUrl ? config.imageEditModel() : config.imageModel();
  const input: Record<string, unknown> = { prompt, output_format: "png", image_size: "1:1" };
  if (imageUrl) input.image_urls = [imageUrl];
  const data = await kie<{ taskId?: string }>("/jobs/createTask", { method: "POST", body: { model, input } });
  if (!data?.taskId) throw new KieError("La pochette IA n'a pas démarré.");
  return data.taskId;
}

export async function getImageTask(taskId: string): Promise<{ status: "pending" | "ready" | "failed"; url?: string; error?: string }> {
  const data = await kie<{ state?: string; resultJson?: string; failMsg?: string }>(`/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
  const state = String(data?.state || "waiting").toLowerCase();
  if (state === "success") {
    try {
      const url = (JSON.parse(data?.resultJson || "{}") as { resultUrls?: string[] }).resultUrls?.[0];
      return url ? { status: "ready", url } : { status: "failed", error: "Aucune image renvoyée." };
    } catch {
      return { status: "failed", error: "Réponse image illisible." };
    }
  }
  if (state === "fail") return { status: "failed", error: data?.failMsg || "Échec de la pochette IA." };
  return { status: "pending" };
}

/** Dépose un fichier sur le stockage temporaire de Kie (≈ 3 jours) et renvoie son URL publique. */
export async function uploadToKie(data: Uint8Array, fileName: string, mime: string): Promise<string> {
  const key = config.kieKey();
  if (!key) throw new KieError("Clé Kie.ai manquante (KIE_API_KEY).", 401);
  const form = new FormData();
  form.append("file", new Blob([data as BlobPart], { type: mime }), fileName);
  form.append("uploadPath", "dbmelo");
  form.append("fileName", fileName);
  const res = await fetch(`${config.kieUploadBase()}/api/file-stream-upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; code?: number; msg?: string; data?: { downloadUrl?: string } };
  if (!res.ok || !json.data?.downloadUrl) throw new KieError(`Envoi du fichier à Kie impossible : ${json.msg || res.status}`, json.code);
  return json.data.downloadUrl;
}

export const FAILED_STATUSES = new Set(["CREATE_TASK_FAILED", "GENERATE_AUDIO_FAILED", "CALLBACK_EXCEPTION", "SENSITIVE_WORD_ERROR"]);

export function failureMessage(status: string, detail?: string | null): string {
  if (status === "SENSITIVE_WORD_ERROR") return "Suno a refusé certains mots des paroles. Modifiez-les puis relancez.";
  return detail ? `Suno a échoué : ${detail}` : "Suno n'a pas réussi cette version.";
}
