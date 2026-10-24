import Link from "next/link";
import { BRAND } from "@/lib/constants";

export function Footer() {
  return (
    <footer className="safe-bottom mt-20 border-t border-line/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>
          © {new Date().getFullYear()} {BRAND.name} — {BRAND.tagline}
        </p>
        <nav className="flex flex-wrap gap-4">
          <Link href="/studio" className="hover:text-cream">
            Créer une chanson
          </Link>
          <Link href="/mes-chansons" className="hover:text-cream">
            Mes chansons
          </Link>
          <Link href="/installer" className="hover:text-cream">
            Télécharger l&apos;application
          </Link>
          <Link href="/#faq" className="hover:text-cream">
            Questions fréquentes
          </Link>
          <Link href="/conditions" className="hover:text-cream">
            Conditions de vente
          </Link>
          <Link href="/confidentialite" className="hover:text-cream">
            Confidentialité
          </Link>
          <Link href="/contact" className="hover:text-cream">
            Contact
          </Link>
        </nav>
      </div>
    </footer>
  );
}
