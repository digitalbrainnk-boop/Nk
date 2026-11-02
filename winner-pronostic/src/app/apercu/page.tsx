import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CouponTicket } from "@/components/coupons/coupon-ticket";
import { PageHeader } from "@/components/layout/page-header";
import { EventCard, type EventCardData } from "@/components/sport/event-card";
import { Alert } from "@/components/ui/alert";
import type { TicketLeg } from "@/lib/coupons/types";

export const metadata: Metadata = { title: "Aperçu du design", robots: { index: false, follow: false } };

/*
 * Galerie des composants avec des DONNÉES FICTIVES, pour valider le design
 * avant la synchronisation des vrais matchs. Visible en développement, ou en
 * production seulement si NEXT_PUBLIC_DESIGN_PREVIEW=1.
 */

const EVENTS: EventCardData[] = [
  {
    id: 1,
    sport: "football",
    competition: "Ligue des champions",
    startsAt: "2026-11-04T20:00:00Z",
    status: "live",
    clock: "67'",
    home: { name: "Real Madrid" },
    away: { name: "Manchester City" },
    score: { home: 2, away: 1 },
    odds: [
      { label: "1", value: 1.55 },
      { label: "X", value: 3.9 },
      { label: "2", value: 6.5 },
    ],
  },
  {
    id: 2,
    sport: "basketball",
    competition: "NBA",
    startsAt: "2026-11-05T00:30:00Z",
    status: "scheduled",
    home: { name: "Los Angeles Lakers" },
    away: { name: "Boston Celtics" },
    odds: [
      { label: "1", value: 1.82 },
      { label: "2", value: 2.02 },
    ],
    tip: { label: "Plus de 221,5 points", probability: 0.64, confidence: 4, isValue: true },
  },
  {
    id: 3,
    sport: "ice_hockey",
    competition: "NHL",
    startsAt: "2026-11-04T23:00:00Z",
    status: "finished",
    home: { name: "Toronto Maple Leafs" },
    away: { name: "Montréal Canadiens" },
    score: { home: 4, away: 2 },
  },
  {
    id: 4,
    sport: "handball",
    competition: "EHF Champions League",
    startsAt: "2026-11-05T17:45:00Z",
    status: "scheduled",
    home: { name: "Paris Saint-Germain" },
    away: { name: "THW Kiel" },
    odds: [
      { label: "1", value: 1.7 },
      { label: "X", value: 9.5 },
      { label: "2", value: 2.25 },
    ],
    tip: { label: "Victoire Paris Saint-Germain", probability: 0.58, confidence: 3 },
  },
];

const LEGS: TicketLeg[] = [
  {
    key: "a",
    sport: "football",
    competition: "Premier League",
    startsAt: "2026-11-07T15:00:00Z",
    home: "Arsenal",
    away: "Everton",
    label: "Victoire Arsenal",
    notation: "1X2 · 1",
    odd: 1.45,
    probability: 0.74,
    confidence: 5,
  },
  {
    key: "b",
    sport: "basketball",
    competition: "NBA",
    startsAt: "2026-11-08T01:00:00Z",
    home: "Denver Nuggets",
    away: "Utah Jazz",
    label: "Denver Nuggets (−6,5)",
    notation: "Handicap 1 (-6.5)",
    odd: 1.88,
    probability: 0.57,
    confidence: 3,
  },
  {
    key: "c",
    sport: "ice_hockey",
    competition: "NHL",
    startsAt: "2026-11-08T00:00:00Z",
    home: "Boston Bruins",
    away: "Buffalo Sabres",
    label: "Plus de 5,5 buts",
    notation: "Total · Plus (5.5)",
    odd: 1.9,
    probability: 0.55,
    confidence: 3,
  },
];

export default function DesignPreviewPage() {
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_DESIGN_PREVIEW !== "1") notFound();
  const total = LEGS.reduce((acc, l) => acc * l.odd, 1);
  const probability = LEGS.reduce((acc, l) => acc * (l.probability ?? 1), 1);

  return (
    <div className="space-y-6">
      <PageHeader kicker="Design" title="Aperçu" subtitle="Composants avec des données d'exemple." />
      <Alert tone="warning">Données fictives, uniquement pour valider le design.</Alert>
      <section className="space-y-2.5">
        {EVENTS.map((e) => (
          <EventCard key={e.id} event={e} />
        ))}
      </section>
      <CouponTicket
        title="Code de 5"
        legs={LEGS}
        totalOdds={total}
        probability={probability}
        bookingCodes={[{ bookmaker: "1xbet", code: "7KX2M", countryCode: "BF" }]}
      />
    </div>
  );
}
