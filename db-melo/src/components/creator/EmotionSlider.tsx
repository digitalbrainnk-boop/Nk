"use client";

import { AnimatePresence, motion } from "framer-motion";
import { EMOTIONS } from "@/lib/constants";
import type { Emotion } from "@/lib/types";

/** Curseur d'émotion : Joyeux & Festif → Doux & Nostalgique → Romantique → Épique. */
export function EmotionSlider({ value, onChange }: { value: Emotion; onChange: (e: Emotion) => void }) {
  const index = Math.max(0, EMOTIONS.findIndex((e) => e.id === value));
  const current = EMOTIONS[index];
  const pct = (index / (EMOTIONS.length - 1)) * 100;

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <span className="label mb-0">Émotion de la chanson</span>
        <AnimatePresence mode="wait">
          <motion.span
            key={current.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="rounded-full px-3 py-1 text-sm font-semibold"
            style={{ background: `${current.color}22`, color: current.color }}
          >
            {current.emoji} {current.label}
          </motion.span>
        </AnimatePresence>
      </div>
      <div className="relative h-8">
        <div className="absolute top-1/2 right-0 left-0 h-2 -translate-y-1/2 rounded-full bg-line" />
        <div
          className="absolute top-1/2 left-0 h-2 -translate-y-1/2 rounded-full transition-all"
          style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${EMOTIONS.map((e) => e.color).join(", ")})` }}
        />
        <input
          type="range"
          min={0}
          max={EMOTIONS.length - 1}
          step={1}
          value={index}
          onChange={(e) => onChange(EMOTIONS[Number(e.target.value)].id)}
          aria-label="Émotion"
          aria-valuetext={current.label}
          className="emotion-range absolute inset-0 h-8 w-full cursor-pointer"
        />
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1 text-center">
        {EMOTIONS.map((e, i) => (
          <button
            key={e.id}
            type="button"
            onClick={() => onChange(e.id)}
            className={`rounded-xl px-1 py-2 text-[11px] leading-tight transition sm:text-xs ${i === index ? "bg-studio-2 text-cream" : "text-muted hover:text-cream"}`}
          >
            <span className="block text-lg">{e.emoji}</span>
            {e.label}
          </button>
        ))}
      </div>
    </div>
  );
}
