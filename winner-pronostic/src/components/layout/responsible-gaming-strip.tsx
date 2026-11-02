import Link from "next/link";

/** Bandeau de prévention, visible en permanence au-dessus de la navigation. */
export function ResponsibleGamingStrip() {
  return (
    <Link
      href="/jeu-responsable"
      className="flex h-7 items-center justify-center gap-2 border-t border-line bg-surface px-3 text-[11px] text-muted hover:text-ink"
    >
      <span className="rounded bg-danger/20 px-1.5 py-px font-bold text-danger">18+</span>
      <span className="truncate">Parier comporte des risques. Jouez modérément.</span>
    </Link>
  );
}
