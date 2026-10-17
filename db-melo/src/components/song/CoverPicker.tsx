"use client";

import { Check, Loader } from "lucide-react";
import type { CoverChoice } from "@/lib/types";

const LABELS: Record<CoverChoice, string> = { suno: "Pochette IA", collector: "Collector DB.Mélo", ai: "IA avec votre photo" };

/** Choix de la pochette (intégrée au MP3 et affichée sur la page cadeau). */
export function CoverPicker({
  songId,
  choices,
  value,
  pendingAi,
  onChange,
  version,
}: {
  songId: string;
  choices: CoverChoice[];
  value: CoverChoice;
  pendingAi: boolean;
  onChange: (c: CoverChoice) => void;
  version: number;
}) {
  return (
    <div>
      <p className="label">Pochette</p>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {choices.map((c) => (
          <button key={c} type="button" onClick={() => onChange(c)} aria-pressed={value === c} className="w-28 shrink-0 text-left">
            <span className={`relative block aspect-square overflow-hidden rounded-2xl border-2 ${value === c ? "border-gold" : "border-transparent"}`}>
              <img src={`/api/songs/${songId}/cover?choice=${c}&v=${version}`} alt={LABELS[c]} className="size-full object-cover" loading="lazy" />
              {value === c && (
                <span className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full bg-gold text-ink">
                  <Check className="size-4" />
                </span>
              )}
            </span>
            <span className="mt-1 block text-xs text-muted">{LABELS[c]}</span>
          </button>
        ))}
        {pendingAi && (
          <div className="flex w-28 shrink-0 flex-col">
            <span className="flex aspect-square items-center justify-center rounded-2xl border border-dashed border-line">
              <Loader className="size-5 animate-spin text-gold" />
            </span>
            <span className="mt-1 block text-xs text-muted">Pochette IA en cours…</span>
          </div>
        )}
      </div>
    </div>
  );
}
