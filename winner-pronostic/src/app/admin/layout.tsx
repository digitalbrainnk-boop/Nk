import Link from "next/link";

const LINKS = [
  { href: "/admin", label: "📊 Tableau" },
  { href: "/admin/competitions", label: "🏆 Compétitions" },
  { href: "/admin/coupons", label: "🎟️ Coupons du jour" },
  { href: "/admin/utilisateurs", label: "👥 Utilisateurs" },
  { href: "/admin/paiements", label: "💰 Paiements" },
  { href: "/admin/synchro", label: "🔄 Synchro" },
  { href: "/admin/reglages", label: "⚙️ Réglages" },
  { href: "/admin/outils", label: "🔑 Outils" },
];

/** Navigation de l'espace admin (chaque page revérifie le rôle administrateur). */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="space-y-4">
      <nav aria-label="Administration" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 scrollbar-none">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="shrink-0 rounded-lg bg-surface px-3 py-2 text-xs font-semibold text-muted ring-1 ring-line hover:text-ink">
            {l.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
