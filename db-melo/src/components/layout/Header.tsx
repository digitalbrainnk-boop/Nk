import Link from "next/link";
import { Logo } from "../brand/Logo";
import { InstallButton } from "../pwa/InstallPrompt";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-line/60 bg-ink/75 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
        <Logo />
        <nav className="flex items-center gap-1 text-sm sm:gap-2">
          <Link href="/mes-chansons" className="btn-quiet hidden rounded-xl px-3 py-2 font-semibold sm:inline-flex">
            Mes chansons
          </Link>
          <InstallButton />
          <Link href="/studio" className="btn btn-gold min-h-10 rounded-xl px-4 py-2 text-sm">
            Créer
          </Link>
        </nav>
      </div>
    </header>
  );
}
