"use client";

// useKieSuno : lancement de la création Suno (via /api/generate-music), polling du statut,
// estimation de la progression et états de chargement. Le polling se met en pause quand
// l'onglet est masqué et ralentit en cas d'erreur réseau.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { PublicSong, VariantId, VariantStatus } from "@/lib/types";

export type GenerationPhase =
  | "loading" // chargement initial de la chanson
  | "idle" // configuration enregistrée, création pas encore lancée
  | "submitting" // envoi à Kie en cours
  | "queued" // tâche acceptée, en file d'attente
  | "composing" // paroles et arrangement (TEXT_SUCCESS)
  | "streaming" // premier mixage disponible (FIRST_SUCCESS)
  | "ready" // les deux variantes sont prêtes
  | "partial" // une seule variante a réussi
  | "failed";

export interface UseKieSunoOptions {
  /** Intervalle de polling nominal (ms). */
  intervalMs?: number;
  /**
   * Lance la création si elle ne l'est pas encore. En parcours « paiement d'abord », elle démarre
   * d'elle-même dès que la chanson est payée (le serveur la lance aussi à la confirmation).
   */
  autoStart?: boolean;
}

export interface UseKieSunoResult {
  song: PublicSong | null;
  phase: GenerationPhase;
  /** Progression estimée globale, 0 à 100. */
  progress: number;
  variantProgress: Record<VariantId, number>;
  /** Secondes écoulées depuis le lancement. */
  elapsed: number;
  error: string | null;
  isPolling: boolean;
  startGeneration: () => Promise<void>;
  refresh: () => Promise<void>;
  setSong: (song: PublicSong) => void;
}

const FAILED = new Set<VariantStatus>(["CREATE_TASK_FAILED", "GENERATE_AUDIO_FAILED", "CALLBACK_EXCEPTION", "SENSITIVE_WORD_ERROR"]);
const STAGE: Record<VariantStatus, number> = {
  QUEUED: 0,
  PENDING: 1,
  TEXT_SUCCESS: 2,
  FIRST_SUCCESS: 3,
  SUCCESS: 4,
  CREATE_TASK_FAILED: 4,
  GENERATE_AUDIO_FAILED: 4,
  CALLBACK_EXCEPTION: 4,
  SENSITIVE_WORD_ERROR: 4,
};
const FLOOR = [2, 8, 35, 70, 100];

/** Progression d'une variante : palier du statut Kie + avance douce selon le temps écoulé. */
export function estimateProgress(status: VariantStatus, elapsedSec: number): number {
  const stage = STAGE[status];
  if (stage === 4) return 100;
  const floor = FLOOR[stage];
  const ceiling = FLOOR[stage + 1] - 3;
  const byTime = 97 * (1 - Math.exp(-elapsedSec / 75)); // ~1 à 3 minutes en général
  return Math.round(Math.min(ceiling, Math.max(floor, byTime)));
}

function needsPolling(song: PublicSong | null): boolean {
  if (!song) return false;
  if (song.generation.status === "generating") return true;
  // Offre Prestige : WAV et pochette IA préparés après le paiement.
  if (song.payment.status === "paid" && song.payment.plan === "prestige" && !song.demo) {
    const variants = Object.values(song.variants);
    return (
      variants.some((v) => v.status === "SUCCESS" && (!v.wavStatus || v.wavStatus === "pending")) ||
      !song.aiCoverStatus ||
      song.aiCoverStatus === "pending"
    );
  }
  return false;
}

export function useKieSuno(songId: string, opts: UseKieSunoOptions = {}): UseKieSunoResult {
  const intervalMs = opts.intervalMs ?? 5000;
  const [song, setSong] = useState<PublicSong | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const failures = useRef(0);
  const autoStarted = useRef(false);
  const inflight = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    try {
      const { song: s } = await api<{ song: PublicSong }>(`/api/generate-music?songId=${encodeURIComponent(songId)}`, { signal: ctrl.signal });
      setSong(s);
      failures.current = 0;
      setError(s.generation.status === "failed" ? s.generation.error ?? "La création a échoué." : null);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      failures.current += 1;
      setError((e as Error).message);
    }
  }, [songId]);

  const startGeneration = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const { song: s } = await api<{ song: PublicSong }>("/api/generate-music", { body: { songId } });
      setSong(s);
      if (s.generation.status === "failed") setError(s.generation.error ?? "La création n'a pas pu démarrer.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [songId]);

  // Chargement initial.
  useEffect(() => {
    void refresh();
    return () => inflight.current?.abort();
  }, [refresh]);

  // Démarrage automatique (une seule fois), si le parcours le permet.
  useEffect(() => {
    if (!song || autoStarted.current || song.generation.status !== "idle") return;
    const allowed = song.flowMode === "pay_first" ? song.payment.status === "paid" : opts.autoStart;
    if (!allowed) return;
    autoStarted.current = true;
    void startGeneration();
  }, [opts.autoStart, song, startGeneration]);

  // Polling avec pause en arrière-plan et ralentissement après erreurs.
  const polling = needsPolling(song);
  useEffect(() => {
    if (!polling) return;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const schedule = () => {
      const delay = Math.min(30_000, intervalMs * Math.pow(1.6, failures.current));
      timer = setTimeout(async () => {
        if (stopped) return;
        if (document.visibilityState === "visible") await refresh();
        schedule();
      }, delay);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [polling, intervalMs, refresh]);

  // Horloge pour animer la progression pendant la création.
  const generating = song?.generation.status === "generating";
  useEffect(() => {
    if (!generating) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [generating]);

  const elapsed = song?.generation.startedAt ? Math.max(0, Math.round((now - song.generation.startedAt) / 1000)) : 0;

  const variantProgress = useMemo<Record<VariantId, number>>(
    () => ({
      A: song ? estimateProgress(song.variants.A.status, elapsed) : 0,
      B: song ? estimateProgress(song.variants.B.status, Math.max(0, elapsed - 4)) : 0,
    }),
    [song, elapsed],
  );

  const phase = useMemo<GenerationPhase>(() => {
    if (submitting) return "submitting";
    if (!song) return "loading";
    const g = song.generation.status;
    if (g === "idle") return "idle";
    const statuses = [song.variants.A.status, song.variants.B.status];
    if (g === "ready") return statuses.every((s) => s === "SUCCESS") ? "ready" : "partial";
    if (g === "failed") return "failed";
    const alive = statuses.filter((s) => !FAILED.has(s));
    const stage = Math.min(...alive.map((s) => STAGE[s]));
    return stage <= 1 ? "queued" : stage === 2 ? "composing" : "streaming";
  }, [song, submitting]);

  return {
    song,
    phase,
    progress: Math.round((variantProgress.A + variantProgress.B) / 2),
    variantProgress,
    elapsed,
    error,
    isPolling: polling,
    startGeneration,
    refresh,
    setSong,
  };
}
