import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/dal";
import { buttonClasses } from "@/components/ui/button";

/** Lien « Connexion » ou initiale de l'utilisateur. Lit la session : à placer sous <Suspense>. */
export async function UserMenu() {
  const profile = await getCurrentProfile().catch(() => null);

  if (!profile) {
    return (
      <Link href="/connexion" className={buttonClasses("secondary", "sm")}>
        Connexion
      </Link>
    );
  }

  const initial = profile.display_name.trim().charAt(0).toUpperCase() || "?";
  return (
    <Link href="/compte" className="flex items-center gap-2" aria-label={`Mon compte (${profile.display_name})`}>
      {profile.isPremium ? (
        <span className="rounded-md bg-gold/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold">
          Premium
        </span>
      ) : null}
      <span className="grid size-9 place-items-center rounded-full bg-surface-3 text-sm font-bold text-ink ring-1 ring-line">
        {initial}
      </span>
    </Link>
  );
}

export function UserMenuFallback() {
  return <span className="block h-9 w-24 animate-pulse rounded-xl bg-surface-2" aria-hidden />;
}
