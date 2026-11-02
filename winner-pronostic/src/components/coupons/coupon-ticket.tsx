import type { ReactNode } from "react";
import { ConfidenceMeter } from "@/components/sport/confidence-meter";
import { ProbabilityBar } from "@/components/sport/probability-bar";
import { sportStyle } from "@/components/sport/sport-badge";
import { CopyButton } from "@/components/ui/copy-button";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import type { BookingCode, TicketLeg } from "@/lib/coupons/types";
import { getSport } from "@/lib/sports/catalog";
import { BookingCodeBox } from "./booking-code-box";

const when = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: DEFAULT_TIMEZONE,
});

/** Texte du coupon pour le copier ou le partager sur WhatsApp. */
export function couponAsText(legs: TicketLeg[], totalOdds: number, probability: number | null): string {
  const lines = legs.map(
    (l, i) => `${i + 1}. ${getSport(l.sport).emoji} ${l.home} – ${l.away} (${when.format(new Date(l.startsAt))})\n   ${l.label} · ${l.notation} @ ${l.odd.toFixed(2)}`,
  );
  const chance = probability ? `\nChance estimée : ${Math.round(probability * 100)} %` : "";
  return `🏆 Coupon Winner Pronostic\n\n${lines.join("\n")}\n\nCote totale : ${totalOdds.toFixed(2)}${chance}\n18+ · Les paris comportent des risques.`;
}

/** Coupon façon ticket de pari : sélections, cote totale, chance réelle, code de chargement. */
export function CouponTicket({
  title = "Votre coupon",
  legs,
  totalOdds,
  probability,
  bookingCodes = [],
  footer,
}: {
  title?: string;
  legs: TicketLeg[];
  totalOdds: number;
  probability: number | null;
  bookingCodes?: BookingCode[];
  footer?: ReactNode;
}) {
  const text = couponAsText(legs, totalOdds, probability);
  return (
    <section className="ticket overflow-hidden rounded-(--radius-card) border border-line bg-surface" style={{ ["--notch-y" as string]: "88px" }}>
      <header className="bg-pitch flex items-end justify-between gap-3 px-4 pb-3 pt-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand">Winner Pronostic</p>
          <h2 className="font-display text-2xl font-extrabold uppercase leading-none">{title}</h2>
          <p className="mt-1 text-xs text-muted">{legs.length} sélection{legs.length > 1 ? "s" : ""}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Cote totale</p>
          <p className="scoreboard text-4xl font-extrabold leading-none text-gold">{totalOdds.toFixed(2)}</p>
        </div>
      </header>

      <div className="mx-4 border-t-2 border-dashed border-line" />

      <ol className="divide-y divide-line/70 px-4">
        {legs.map((leg) => {
          const sport = getSport(leg.sport);
          return (
            <li key={leg.key} style={sportStyle(leg.sport)} className="flex items-center gap-3 py-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-(--sport)/12 text-lg ring-1 ring-(--sport)/40" aria-hidden>
                {sport.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] uppercase tracking-wide text-muted">
                  {leg.competition ? `${leg.competition} · ` : ""}
                  {when.format(new Date(leg.startsAt))}
                </p>
                <p className="truncate text-sm font-semibold">
                  {leg.home} – {leg.away}
                </p>
                <p className="text-sm leading-snug text-(--sport)">{leg.label}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="scoreboard text-xl font-extrabold">{leg.odd.toFixed(2)}</p>
                {leg.probability !== null ? (
                  <p className="flex items-center justify-end gap-1.5 text-[11px] text-muted">
                    {Math.round(leg.probability * 100)}%
                    {leg.confidence ? <ConfidenceMeter value={leg.confidence} /> : null}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="space-y-3 border-t border-line bg-surface-2/60 px-4 py-4">
        {probability !== null ? (
          <>
            <ProbabilityBar value={probability} label="Chance réelle estimée que tout passe" />
            <p className="text-xs text-muted">
              Soit environ <strong className="text-ink">1 chance sur {Math.max(1, Math.round(1 / probability))}</strong>. Aucun coupon
              n&apos;est garanti : ne misez que ce que vous pouvez perdre.
            </p>
          </>
        ) : null}
        {bookingCodes.map((b) => (
          <BookingCodeBox key={`${b.bookmaker}-${b.countryCode ?? ""}`} booking={b} />
        ))}
        <div className="flex flex-wrap gap-2">
          <CopyButton text={text} label="Copier le coupon" />
          <a
            href={`https://wa.me/?text=${encodeURIComponent(text)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#25d366]/40 bg-[#25d366]/10 px-3 text-sm font-semibold text-[#25d366]"
          >
            Partager sur WhatsApp
          </a>
        </div>
        {footer}
      </div>
    </section>
  );
}
