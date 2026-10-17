"use client";

import { motion } from "framer-motion";
import { INSTRUMENTS, LIMITS, STYLES } from "@/lib/constants";
import type { InstrumentId, MusicStyleId, ReferenceAudio } from "@/lib/types";
import { ReferenceDropzone } from "./ReferenceDropzone";

interface Props {
  styles: MusicStyleId[];
  onStyles: (v: MusicStyleId[]) => void;
  inspiration: string;
  onInspiration: (v: string) => void;
  instruments: InstrumentId[];
  onInstruments: (v: InstrumentId[]) => void;
  reference: ReferenceAudio | null | undefined;
  onReference: (v: ReferenceAudio | null) => void;
  errors?: Record<string, string>;
}

function toggle<T>(list: T[], item: T, max: number): T[] {
  if (list.includes(item)) return list.filter((x) => x !== item);
  return list.length >= max ? [...list.slice(1), item] : [...list, item];
}

export function StyleSelector({ styles, onStyles, inspiration, onInspiration, instruments, onInstruments, reference, onReference, errors = {} }: Props) {
  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="font-display text-lg font-semibold">Style musical</h3>
          <span className="text-xs text-muted">
            {styles.length}/{LIMITS.stylesMax} — mélangez jusqu&apos;à {LIMITS.stylesMax} styles
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {STYLES.map((s) => {
            const on = styles.includes(s.id);
            return (
              <motion.button
                key={s.id}
                type="button"
                whileTap={{ scale: 0.96 }}
                onClick={() => onStyles(toggle(styles, s.id, LIMITS.stylesMax))}
                aria-pressed={on}
                className={`rounded-2xl border p-3 text-left transition ${on ? "border-gold bg-gold/12" : "border-line bg-studio-2/60 hover:border-gold/40"}`}
              >
                <span className="text-xl">{s.emoji}</span>
                <span className={`mt-1 block font-semibold ${on ? "text-gold-soft" : ""}`}>{s.label}</span>
                <span className="block text-xs text-muted">{s.hint}</span>
              </motion.button>
            );
          })}
        </div>
        {errors.styles && <p className="error-text">{errors.styles}</p>}
      </section>

      <section>
        <label htmlFor="inspiration" className="label">
          Inspiration libre <span className="font-normal text-muted">(facultatif)</span>
        </label>
        <input
          id="inspiration"
          className="field"
          value={inspiration}
          maxLength={LIMITS.inspirationMax}
          onChange={(e) => onInspiration(e.target.value)}
          placeholder="Ex. ambiance mariage en plein air, chœurs gospel au refrain, guitare à la Fally…"
        />
        {errors.customInspiration && <p className="error-text">{errors.customInspiration}</p>}
      </section>

      <section>
        <h3 className="mb-3 font-display text-lg font-semibold">Analyse audio — Style Match</h3>
        <ReferenceDropzone value={reference} onChange={onReference} error={errors["referenceAudio.rightsConfirmed"]} />
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="font-display text-lg font-semibold">Instruments prioritaires</h3>
          <span className="text-xs text-muted">
            {instruments.length}/{LIMITS.instrumentsMax}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {INSTRUMENTS.map((i) => {
            const on = instruments.includes(i.id);
            return (
              <button
                key={i.id}
                type="button"
                aria-pressed={on}
                onClick={() => onInstruments(toggle(instruments, i.id, LIMITS.instrumentsMax))}
                className={`chip min-h-11 px-4 ${on ? "chip-on" : "hover:border-gold/40"}`}
              >
                <span>{i.emoji}</span> {i.label}
              </button>
            );
          })}
        </div>
        {errors.instruments && <p className="error-text">{errors.instruments}</p>}
      </section>
    </div>
  );
}
