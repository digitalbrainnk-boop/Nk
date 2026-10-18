// Mise en page commune des pages légales (conditions de vente, confidentialité, contact).
export function LegalPage({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mx-auto max-w-3xl px-4 pt-10 pb-6 sm:pt-16">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="mt-3 font-display text-3xl font-bold sm:text-4xl">{title}</h1>
      <div className="mt-8 space-y-8">{children}</div>
    </section>
  );
}

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      <div className="mt-3 space-y-3 leading-relaxed text-muted">{children}</div>
    </div>
  );
}

/** « Nom (RCCM …), Ville, Pays » : l'éditeur tel que configuré. */
export function sellerLine(m: { name: string; registration: string; address: string }): string {
  return [m.name || "L'éditeur de DB.Mélo", m.registration && `immatriculé ${m.registration}`, m.address].filter(Boolean).join(", ");
}
