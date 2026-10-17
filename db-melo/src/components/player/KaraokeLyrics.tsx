"use client";

import { useEffect, useRef } from "react";
import type { TimedLine } from "@/lib/lyrics/sections";

/** Mode karaoké : le vers en cours est mis en avant et défile au centre ; un toucher y saute. */
export function KaraokeLyrics({ lines, time, onSeek }: { lines: TimedLine[]; time: number; onSeek?: (t: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  let active = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i].startS <= time + 0.15) active = i;

  useEffect(() => {
    const container = box.current;
    const el = container?.querySelector<HTMLElement>(`[data-line="${active}"]`);
    if (!container || !el) return;
    container.scrollTo({ top: el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2, behavior: "smooth" });
  }, [active]);

  if (!lines.length) return <p className="py-8 text-center text-sm text-muted">Les paroles s&apos;afficheront ici.</p>;

  return (
    <div
      ref={box}
      className="no-scrollbar relative max-h-80 overflow-y-auto py-24 text-center"
      style={{ maskImage: "linear-gradient(transparent, black 22%, black 78%, transparent)", WebkitMaskImage: "linear-gradient(transparent, black 22%, black 78%, transparent)" }}
      aria-live="off"
    >
      {lines.map((l, i) => {
        const showSection = l.section && l.section !== lines[i - 1]?.section;
        const state = i === active ? "active" : i < active ? "past" : "future";
        return (
          <div key={i}>
            {showSection && <p className="mt-5 mb-1 text-[10px] font-bold tracking-[0.25em] text-gold/70 uppercase">{l.section}</p>}
            <button
              type="button"
              data-line={i}
              onClick={() => onSeek?.(l.startS)}
              className={`block w-full px-2 py-1.5 font-display leading-snug transition-all duration-300 ${
                state === "active" ? "scale-[1.04] text-xl font-semibold text-cream sm:text-2xl" : state === "past" ? "text-base text-muted/45" : "text-base text-cream/70"
              }`}
            >
              {l.words && state === "active"
                ? l.words.map((w, j) => (
                    <span key={j} className={w.startS <= time ? "text-gold-soft" : undefined}>
                      {w.word}{" "}
                    </span>
                  ))
                : l.text}
            </button>
          </div>
        );
      })}
    </div>
  );
}
