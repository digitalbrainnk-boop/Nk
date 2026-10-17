"use client";

// Charge un fichier audio en mémoire : URL locale (lecture fluide, compatible Safari),
// forme d'onde calculée, et `File` réutilisable pour l'enregistrement sur le téléphone.
import { useEffect, useRef, useState } from "react";
import { prepareFile } from "@/lib/client/download-to-mobile";

export interface AudioFileState {
  file: File | null;
  url: string | null;
  peaks: number[] | null;
  progress: number;
  error: string | null;
}

const BARS = 96;

function resample(values: number[], bars = BARS): number[] {
  if (!values.length) return [];
  const out: number[] = [];
  const step = values.length / bars;
  for (let i = 0; i < bars; i++) {
    const slice = values.slice(Math.floor(i * step), Math.max(Math.floor(i * step) + 1, Math.floor((i + 1) * step)));
    out.push(Math.max(...slice.map(Math.abs)));
  }
  const max = Math.max(...out, 1e-6);
  return out.map((v) => Math.max(0.06, v / max));
}

async function computePeaks(file: File): Promise<number[]> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return [];
  const ctx = new Ctx();
  try {
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    const data = buffer.getChannelData(0);
    const block = Math.floor(data.length / BARS);
    const raw: number[] = [];
    for (let i = 0; i < BARS; i++) {
      let peak = 0;
      for (let j = 0; j < block; j += 16) peak = Math.max(peak, Math.abs(data[i * block + j]));
      raw.push(peak);
    }
    return resample(raw);
  } finally {
    void ctx.close();
  }
}

export function useAudioFile(src: string | null, filename: string, waveform?: number[] | null): AudioFileState {
  const [state, setState] = useState<AudioFileState>({ file: null, url: null, peaks: null, progress: 0, error: null });
  // La forme d'onde Kie arrive avec chaque rafraîchissement : on ne relance pas le téléchargement pour autant.
  const wave = useRef(waveform);
  wave.current = waveform;

  useEffect(() => {
    if (!src) return;
    const waveform = wave.current;
    const ctrl = new AbortController();
    let url: string | null = null;
    setState({ file: null, url: null, peaks: waveform?.length ? resample(waveform) : null, progress: 0, error: null });
    prepareFile(src, { filename, signal: ctrl.signal, onProgress: (p) => setState((s) => ({ ...s, progress: p })) })
      .then(async (file) => {
        url = URL.createObjectURL(file);
        setState((s) => ({ ...s, file, url, progress: 1 }));
        if (!waveform?.length) {
          const peaks = await computePeaks(file).catch(() => []);
          if (!ctrl.signal.aborted) setState((s) => ({ ...s, peaks: peaks.length ? peaks : null }));
        }
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") setState((s) => ({ ...s, error: e.message }));
      });
    return () => {
      ctrl.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [src, filename]);

  return state;
}
