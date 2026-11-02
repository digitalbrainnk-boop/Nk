import type { ReactNode } from "react";

/** Section en construction (fonctionnalité livrée dans une phase ultérieure). */
export function ComingSoon({ title, emoji = "🏟️", children }: { title: string; emoji?: string; children: ReactNode }) {
  return (
    <section className="bg-field-lines relative overflow-hidden rounded-(--radius-card) border border-dashed border-line bg-surface p-5 text-center">
      <p className="text-3xl" aria-hidden>
        {emoji}
      </p>
      <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-brand">Bientôt disponible</p>
      <h2 className="font-display text-xl font-extrabold uppercase">{title}</h2>
      <div className="mx-auto mt-1 max-w-sm text-sm text-muted">{children}</div>
    </section>
  );
}
