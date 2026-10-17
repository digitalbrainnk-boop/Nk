"use client";

// Lecteur audio DB.Mélo : forme d'onde, mode karaoké synchronisé, contrôles sur l'écran
// verrouillé (Media Session), filigrane sonore en pré-écoute.
import { AnimatePresence, motion } from "framer-motion";
import { Loader, Mic2, Pause, Play, RotateCcw, RotateCw, ShieldCheck } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { playWatermarkChime } from "@/lib/client/watermark";
import { BRAND } from "@/lib/constants";
import { alignedToLines, estimateTimings } from "@/lib/lyrics/sections";
import type { AlignedWord } from "@/lib/types";
import { KaraokeLyrics } from "./KaraokeLyrics";
import { useAudioFile } from "./useAudioFile";
import { Waveform } from "./Waveform";

export interface AudioPlayerProps {
  src: string | null;
  filename: string;
  title: string;
  subtitle?: string;
  lyrics: string;
  alignedWords?: AlignedWord[] | null;
  /** Durée réelle du morceau (le karaoké estimé reste juste pendant la pré-écoute). */
  trackDuration?: number;
  waveform?: number[] | null;
  preview?: boolean;
  previewSeconds?: number;
  coverUrl?: string;
  defaultKaraoke?: boolean;
  onFileReady?: (file: File) => void;
}

const fmt = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");
const PLAY_EVENT = "dbmelo:play";

export function AudioPlayer(p: AudioPlayerProps) {
  const id = useId();
  const audio = useRef<HTMLAudioElement>(null);
  const chimeCtx = useRef<AudioContext | null>(null);
  const { file, url, peaks, progress, error } = useAudioFile(p.src, p.filename, p.waveform);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [karaoke, setKaraoke] = useState(!!p.defaultKaraoke);
  const onFileReady = useRef(p.onFileReady);
  onFileReady.current = p.onFileReady;

  useEffect(() => {
    if (file) onFileReady.current?.(file);
  }, [file]);

  // Un seul lecteur à la fois sur la page.
  useEffect(() => {
    const onOther = (e: Event) => (e as CustomEvent<string>).detail !== id && audio.current?.pause();
    window.addEventListener(PLAY_EVENT, onOther);
    return () => window.removeEventListener(PLAY_EVENT, onOther);
  }, [id]);

  // Position fluide pour le karaoké (≈ 12 images/s).
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      if (t - last > 80 && audio.current) {
        last = t;
        setTime(audio.current.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Filigrane de pré-écoute : une signature sonore toutes les 12 s.
  useEffect(() => {
    if (!playing || !p.preview) return;
    const ring = () => chimeCtx.current && playWatermarkChime(chimeCtx.current);
    const first = setTimeout(ring, 5000);
    const every = setInterval(ring, 12_000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [playing, p.preview]);

  const lines = useMemo(() => {
    if (p.alignedWords?.length) return alignedToLines(p.alignedWords);
    return estimateTimings(p.lyrics, p.trackDuration || duration);
  }, [p.alignedWords, p.lyrics, p.trackDuration, duration]);

  const toggle = async () => {
    const el = audio.current;
    if (!el || !url) return;
    if (!el.paused) return el.pause();
    if (p.preview && !chimeCtx.current) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) chimeCtx.current = new Ctx();
    }
    window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: id }));
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: p.title,
        artist: BRAND.artist,
        album: BRAND.album,
        artwork: p.coverUrl ? [{ src: p.coverUrl, sizes: "800x800" }] : [],
      });
    }
    await el.play().catch(() => setPlaying(false));
  };

  const seek = (seconds: number) => {
    const el = audio.current;
    if (!el || !duration) return;
    el.currentTime = Math.min(duration, Math.max(0, seconds));
    setTime(el.currentTime);
  };

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.setActionHandler("seekbackward", () => seek(time - 10));
    navigator.mediaSession.setActionHandler("seekforward", () => seek(time + 10));
  });

  useEffect(() => () => void chimeCtx.current?.close(), []);

  const loading = !url && !error;

  return (
    <div className="card overflow-hidden p-4 sm:p-5">
      <div className="flex items-center gap-3">
        {p.coverUrl && (
          <img src={p.coverUrl} alt="" className={`size-14 shrink-0 rounded-xl object-cover ${playing ? "shadow-[0_0_25px_rgb(229_169_60/0.45)]" : ""}`} />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-display font-semibold">{p.title}</p>
          {p.subtitle && <p className="truncate text-sm text-muted">{p.subtitle}</p>}
        </div>
        {p.preview && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-2.5 py-1 text-[11px] font-semibold text-gold-soft">
            <ShieldCheck className="size-3.5" /> Pré-écoute {p.previewSeconds ? `${p.previewSeconds} s` : ""}
          </span>
        )}
      </div>

      <div className="relative mt-4">
        <Waveform peaks={peaks} progress={duration ? time / duration : 0} duration={duration} onSeek={(r) => seek(r * duration)} />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-xl bg-ink/50 text-sm text-muted">
            <Loader className="size-4 animate-spin text-gold" /> Chargement {Math.round(progress * 100)} %
          </div>
        )}
        {error && <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-ink/70 px-3 text-center text-sm text-danger">{error}</div>}
      </div>

      <div className="mt-1 flex justify-between text-xs text-muted tabular-nums">
        <span>{fmt(time)}</span>
        <span>
          {fmt(duration)}
          {p.preview && p.trackDuration ? ` / ${fmt(p.trackDuration)}` : ""}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-center gap-4">
        <button type="button" onClick={() => seek(time - 10)} className="btn-quiet p-2" aria-label="Reculer de 10 secondes" disabled={!url}>
          <RotateCcw className="size-5" />
        </button>
        <motion.button
          type="button"
          whileTap={{ scale: 0.92 }}
          onClick={toggle}
          disabled={!url}
          className="flex size-16 items-center justify-center rounded-full bg-linear-to-b from-gold-soft to-gold text-ink shadow-[0_10px_30px_-8px_rgb(229_169_60/0.7)] disabled:opacity-50"
          aria-label={playing ? "Pause" : "Lecture"}
        >
          {playing ? <Pause className="size-7" fill="currentColor" /> : <Play className="ml-1 size-7" fill="currentColor" />}
        </motion.button>
        <button type="button" onClick={() => seek(time + 10)} className="btn-quiet p-2" aria-label="Avancer de 10 secondes" disabled={!url}>
          <RotateCw className="size-5" />
        </button>
        <button
          type="button"
          onClick={() => setKaraoke((k) => !k)}
          aria-pressed={karaoke}
          className={`ml-2 inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${karaoke ? "border-gold bg-gold/15 text-gold-soft" : "border-line text-muted hover:text-cream"}`}
        >
          <Mic2 className="size-4" /> Karaoké
        </button>
      </div>

      <AnimatePresence initial={false}>
        {karaoke && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-4 rounded-2xl border border-line bg-ink/50">
              <KaraokeLyrics lines={lines} time={time} onSeek={seek} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {url && (
        <audio
          ref={audio}
          src={url}
          preload="auto"
          playsInline
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setTime(0);
          }}
          onSeeked={(e) => setTime(e.currentTarget.currentTime)}
        />
      )}
    </div>
  );
}
