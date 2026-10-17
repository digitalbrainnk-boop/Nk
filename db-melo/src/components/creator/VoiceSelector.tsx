"use client";

// Sélecteur vocal avec échantillons de 5 secondes. Si un échantillon n'est pas installé
// (public/samples), un aperçu synthétique (Web Speech) donne une idée du timbre.
import { motion } from "framer-motion";
import { Check, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { VOICES } from "@/lib/constants";
import type { VoiceType } from "@/lib/types";

const SAMPLE_MS = 5000;
const SPEECH: Record<VoiceType, { pitch: number; rate: number; text: string }[]> = {
  male: [{ pitch: 0.6, rate: 0.95, text: "La la la, cette chanson est pour toi." }],
  female: [{ pitch: 1.25, rate: 1, text: "La la la, cette chanson est pour toi." }],
  child: [{ pitch: 1.9, rate: 1.1, text: "Joyeux anniversaire, maman !" }],
  duo: [
    { pitch: 0.6, rate: 1, text: "Pour toi," },
    { pitch: 1.3, rate: 1, text: "pour toujours." },
  ],
};

function Equalizer({ active }: { active: boolean }) {
  return (
    <span className="flex h-4 items-end gap-0.5" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={`w-1 origin-bottom rounded-full bg-gold ${active ? "animate-eq" : ""}`}
          style={{ height: "100%", animationDelay: `${i * 0.15}s`, transform: active ? undefined : "scaleY(0.3)" }}
        />
      ))}
    </span>
  );
}

export function VoiceSelector({ value, onChange, error }: { value: VoiceType | null; onChange: (v: VoiceType) => void; error?: string }) {
  const [playing, setPlaying] = useState<VoiceType | null>(null);
  const [synthetic, setSynthetic] = useState<Set<VoiceType>>(new Set());
  const audio = useRef<HTMLAudioElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = () => {
    audio.current?.pause();
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    if (timer.current) clearTimeout(timer.current);
    setPlaying(null);
  };

  useEffect(() => stop, []);

  const speak = (voice: VoiceType) => {
    if (typeof speechSynthesis === "undefined") return stop();
    setSynthetic((s) => new Set(s).add(voice));
    const fr = speechSynthesis.getVoices().find((v) => v.lang.startsWith("fr"));
    SPEECH[voice].forEach((part, i, all) => {
      const u = new SpeechSynthesisUtterance(part.text);
      u.lang = "fr-FR";
      if (fr) u.voice = fr;
      u.pitch = part.pitch;
      u.rate = part.rate;
      if (i === all.length - 1) u.onend = () => setPlaying(null);
      speechSynthesis.speak(u);
    });
  };

  const preview = (voice: VoiceType) => {
    if (playing === voice) return stop();
    stop();
    setPlaying(voice);
    const sample = VOICES.find((v) => v.id === voice)!.sample;
    const el = new Audio(sample);
    audio.current = el;
    el.onerror = () => speak(voice);
    el.onended = () => setPlaying(null);
    el.play().then(
      () => {
        timer.current = setTimeout(stop, SAMPLE_MS);
      },
      () => speak(voice),
    );
  };

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Voix">
        {VOICES.map((v) => {
          const on = value === v.id;
          return (
            <motion.div
              key={v.id}
              whileTap={{ scale: 0.98 }}
              className={`card relative flex items-center gap-4 p-4 transition ${on ? "border-gold shadow-[0_0_0_1px_rgb(229_169_60/0.5),0_10px_40px_-15px_rgb(229_169_60/0.6)]" : "hover:border-gold/40"}`}
            >
              <button type="button" role="radio" aria-checked={on} onClick={() => onChange(v.id)} className="absolute inset-0 rounded-3xl" aria-label={v.label} />
              <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-studio-2 text-2xl">{v.emoji}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 font-display font-semibold">
                  {v.label}
                  {on && <Check className="size-4 text-gold" />}
                </span>
                <span className="block text-sm text-muted">{v.description}</span>
                {synthetic.has(v.id) && <span className="mt-1 block text-[11px] text-muted/70">Aperçu synthétique du timbre</span>}
              </span>
              <button
                type="button"
                onClick={() => preview(v.id)}
                className="relative z-10 flex h-11 shrink-0 items-center gap-2 rounded-xl border border-line bg-ink/60 px-3 text-xs font-semibold text-cream hover:border-gold/60"
                aria-label={playing === v.id ? `Arrêter l'échantillon ${v.label}` : `Écouter 5 secondes : ${v.label}`}
              >
                {playing === v.id ? <Pause className="size-4 text-gold" /> : <Play className="size-4 text-gold" />}
                {playing === v.id ? <Equalizer active /> : "5 s"}
              </button>
            </motion.div>
          );
        })}
      </div>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
