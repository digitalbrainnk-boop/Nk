import { ButtonLink } from "@/components/ui/button";

/** Encart affiché aux comptes gratuits à la place du rapport complet. */
export function PremiumTeaser({ loggedIn }: { loggedIn: boolean }) {
  return (
    <section className="rounded-(--radius-card) border border-gold/40 bg-gold/[0.06] p-5 text-center">
      <p className="text-3xl" aria-hidden>
        👑
      </p>
      <h2 className="mt-1 font-display text-2xl font-extrabold uppercase">Rapport complet Premium</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
        Lecture du match, buts attendus, sélections les plus solides, value bets et probabilités de plus de 300 marchés (1X2,
        totaux, handicaps, MT-Fin, score exact, intervalles de temps…).
      </p>
      <ButtonLink href={loggedIn ? "/compte" : "/connexion"} className="mt-4">
        {loggedIn ? "Découvrir Premium" : "Se connecter"}
      </ButtonLink>
    </section>
  );
}
