"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toggleFavorite } from "@/lib/favorites/actions";
import { cn } from "@/lib/utils/cn";

/** Étoile « Suivre l'équipe » (alertes avant le match et à chaque but). */
export function FavoriteButton({ teamId, name, initial, loggedIn }: { teamId: number; name: string; initial: boolean; loggedIn: boolean }) {
  const [favorite, setFavorite] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!loggedIn) {
    return (
      <Link href="/connexion" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-muted">
        ☆ Suivre {name}
      </Link>
    );
  }
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        disabled={pending}
        aria-pressed={favorite}
        onClick={() =>
          startTransition(async () => {
            const res = await toggleFavorite(teamId);
            if (res.ok) setFavorite(Boolean(res.favorite));
            setMessage(res.ok ? null : (res.message ?? null));
          })
        }
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors",
          favorite ? "border-gold/50 bg-gold/15 text-gold" : "border-line bg-surface text-muted hover:text-ink",
        )}
      >
        {favorite ? "★" : "☆"} {favorite ? "Suivie" : "Suivre"} · <span className="max-w-24 truncate">{name}</span>
      </button>
      {message ? <span className="mt-1 text-[11px] text-danger">{message}</span> : null}
    </span>
  );
}
