"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Disc3 } from "lucide-react";
import { useEffect, useState } from "react";
import type { GenerationPhase } from "@/hooks/useKieSuno";
import type { PublicSong, VariantId } from "@/lib/types";

const STAGES: Record<string, string> = {
  QUEUED: "En file d'attente",
  PENDING: "Préparation de l'arrangement",
  TEXT_SUCCESS: "Composition et enregistrement des voix",
  FIRST_SUCCESS: "Mixage et mastering",
  SUCCESS: "Prête !",
};

const TIPS = [
  "Deux versions sont composées en parallèle : une rythmée, une acoustique.",
  "Vous pouvez fermer cette page : votre chanson continue d'être composée. Gardez simplement ce lien.",
  "Astuce : installez DB.Mélo sur votre téléphone pour retrouver vos chansons en un geste.",
  "La page cadeau et son QR code seront prêts dès le paiement.",
];

export function GenerationProgress({ song, phase, progress, variantProgress, elapsed }: {
  song: PublicSong;
  phase: GenerationPhase;
  progress: number;
  variantProgress: Record<VariantId, number>;
  elapsed: number;
}) {
  const [tip, setTip] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTip((i) => (i + 1) % TIPS.length), 6000);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="card overflow-hidden p-6 sm:p-8" aria-live="polite">
      <div className="flex flex-col items-center text-center">
        <div className="relative">
          <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 4, ease: "linear" }}>
            <Disc3 className="size-24 text-gold" strokeWidth={1.2} />
          </motion.div>
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="rounded-full bg-studio px-2 py-0.5 font-display text-base font-bold tabular-nums">{progress}%</span>
          </span>
        </div>
        <h2 className="mt-5 font-display text-2xl font-bold">
          {phase === "submitting" ? "Envoi au studio…" : phase === "queued" ? "Le studio se prépare…" : phase === "composing" ? "Composition en cours…" : "Derniers réglages…"}
        </h2>
        <p className="mt-1 text-sm text-muted">
          Environ 1 à 5 minutes · {Math.floor(elapsed / 60)} min {String(elapsed % 60).padStart(2, "0")} s écoulées
        </p>
      </div>

      <div className="mt-8 space-y-4">
        {(["A", "B"] as const).map((v) => {
          const variant = song.variants[v];
          return (
            <div key={v}>
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="font-semibold">{v === "A" ? "Version A · rythmée" : "Version B · acoustique"}</span>
                <span className="text-muted">{variant.error ? "Échec" : STAGES[variant.status] ?? "…"}</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-line">
                <motion.div
                  className={`h-full rounded-full ${variant.error ? "bg-danger" : "bg-linear-to-r from-gold to-amber-neon"}`}
                  animate={{ width: `${variant.error ? 100 : variantProgress[v]}%` }}
                  transition={{ duration: 0.8 }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-8 flex h-10 items-end justify-center gap-1" aria-hidden="true">
        {Array.from({ length: 24 }, (_, i) => (
          <span key={i} className="w-1.5 origin-bottom animate-eq rounded-full bg-gold/70" style={{ height: "100%", animationDelay: `${(i % 6) * 0.12}s` }} />
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.p key={tip} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-6 text-center text-sm text-muted">
          {TIPS[tip]}
        </motion.p>
      </AnimatePresence>
    </section>
  );
}
