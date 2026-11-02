import { CopyButton } from "@/components/ui/copy-button";
import type { BookingCode } from "@/lib/coupons/types";

const BOOKMAKER_NAMES: Record<string, string> = { "1xbet": "1xBet" };

/**
 * Code de chargement d'un coupon chez un bookmaker : l'utilisateur copie le
 * code puis le charge dans son application de paris (aucune saisie match par match).
 */
export function BookingCodeBox({ booking }: { booking: BookingCode }) {
  const name = BOOKMAKER_NAMES[booking.bookmaker] ?? booking.bookmaker;
  return (
    <div className="rounded-xl border border-gold/40 bg-gold/[0.07] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gold">
            Code {name}
            {booking.countryCode ? ` · ${booking.countryCode}` : ""}
          </p>
          <p className="scoreboard truncate text-3xl font-extrabold tracking-[0.12em] text-ink">{booking.code}</p>
        </div>
        <CopyButton text={booking.code} label="Copier le code" variant="primary" />
      </div>
      <details className="mt-2 text-xs text-muted">
        <summary className="cursor-pointer font-medium text-ink/80">Comment charger ce code ?</summary>
        <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
          <li>Ouvrez {name} et connectez-vous à votre compte.</li>
          <li>Ouvrez le coupon (panier de paris) et choisissez « Charger un coupon ».</li>
          <li>Collez le code : les sélections s&apos;ajoutent toutes seules. Vérifiez les cotes avant de valider.</li>
        </ol>
      </details>
    </div>
  );
}
