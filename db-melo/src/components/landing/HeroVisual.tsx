"use client";

import { motion } from "framer-motion";

const LINES = ["Aïcha, mon soleil, ma lumière", "Avec toi chaque jour est une prière", "Je t'aime plus fort que les mots", "Tu es mon plus beau cadeau"];

/** Vinyle animé + paroles qui défilent, façon karaoké. */
export function HeroVisual() {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-md">
      <div className="absolute inset-8 rounded-full bg-gold/20 blur-3xl" />
      <motion.div
        className="absolute inset-6 rounded-full border border-gold/40 shadow-[0_0_80px_-10px_rgb(229_169_60/0.5)]"
        style={{ background: "repeating-radial-gradient(circle, #111118 0px, #111118 5px, #1c1c28 6px, #111118 8px)" }}
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 14, ease: "linear" }}
      >
        <div className="absolute inset-[36%] flex items-center justify-center rounded-full bg-linear-to-br from-gold-soft via-gold to-gold-deep font-display text-2xl font-extrabold text-ink">
          DB
        </div>
      </motion.div>
      <div className="absolute inset-x-0 -bottom-2 mx-auto w-[92%] rounded-3xl border border-line bg-studio/90 p-4 backdrop-blur">
        <div className="mb-2 flex items-center gap-2 text-xs text-muted">
          <span className="flex h-3 items-end gap-0.5">
            {[0, 1, 2].map((i) => (
              <span key={i} className="w-0.5 origin-bottom animate-eq rounded-full bg-gold" style={{ height: "100%", animationDelay: `${i * 0.2}s` }} />
            ))}
          </span>
          Mode karaoké
        </div>
        <div className="h-14 overflow-hidden">
          <motion.div animate={{ y: [0, -28, -56, -84, 0] }} transition={{ repeat: Infinity, duration: 12, times: [0, 0.25, 0.5, 0.75, 1], ease: "easeInOut" }}>
            {LINES.map((l, i) => (
              <p key={l} className={`h-7 truncate font-display text-[15px] leading-7 ${i === 0 ? "text-gold-soft" : "text-cream/80"}`}>
                {l}
              </p>
            ))}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
