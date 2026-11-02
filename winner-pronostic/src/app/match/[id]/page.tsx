import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { MatchReportView } from "@/components/report/match-report";
import { PremiumTeaser } from "@/components/report/premium-teaser";
import { EventCard } from "@/components/sport/event-card";
import { Alert } from "@/components/ui/alert";
import { getSessionUser } from "@/lib/auth/dal";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { MARKETS, PERIODS, type Market, type Period } from "@/lib/predictions/markets";
import { buildMatchReport } from "@/lib/predictions/report";
import { isSportCode } from "@/lib/sports/catalog";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Analyse du match" };

/** Données d'entrée enregistrées avec la prédiction (validées : jamais de confiance aveugle dans le JSON). */
const inputsSchema = z
  .object({
    strength: z
      .object({
        sampleSize: z.number(),
        factors: z.array(z.object({ key: z.string(), label: z.string(), detail: z.string(), homeMultiplier: z.number(), awayMultiplier: z.number() })),
      })
      .nullish(),
    context: z
      .object({
        standings: z.object({ homeRank: z.number(), awayRank: z.number(), homePoints: z.number(), awayPoints: z.number() }).nullish(),
        h2h: z.object({ played: z.number(), homeWins: z.number(), draws: z.number(), awayWins: z.number(), avgGoals: z.number() }).nullish(),
      })
      .nullish(),
    options: z
      .object({
        rho: z.number().optional(),
        firstHalfShare: z.number().optional(),
        penaltyRate: z.number().optional(),
        redCardRate: z.number().optional(),
        corners: z.object({ home: z.number(), away: z.number() }).nullish(),
        cards: z.object({ home: z.number(), away: z.number() }).nullish(),
        scorers: z
          .array(z.object({ id: z.string(), name: z.string(), team: z.union([z.literal(1), z.literal(2)]), goalShare: z.number(), minutesShare: z.number() }))
          .optional(),
      })
      .nullish(),
    playerNames: z.record(z.string(), z.string()).nullish(),
  })
  .partial();

const when = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: DEFAULT_TIMEZONE });

type EventRow = {
  id: number;
  sport: string;
  starts_at: string;
  status_group: "scheduled" | "live" | "finished" | "postponed" | "cancelled";
  live_clock: string | null;
  home_score: number | null;
  away_score: number | null;
  competition: { name: string } | null;
  home: { name: string; logo_url: string | null } | null;
  away: { name: string; logo_url: string | null } | null;
};

async function MatchContent({ params }: { params: PageProps<"/match/[id]">["params"] }) {
  const { id } = await params;
  if (!/^\d{1,12}$/.test(id)) notFound();
  const supabase = await createClient();

  const { data } = await supabase
    .from("events")
    .select(
      `id, sport, starts_at, status_group, live_clock, home_score, away_score,
       competition:competitions!events_competition_id_sport_fkey(name),
       home:teams!events_home_team_id_sport_fkey(name, logo_url),
       away:teams!events_away_team_id_sport_fkey(name, logo_url)`,
    )
    .eq("id", Number(id))
    .maybeSingle();
  const event = data as unknown as EventRow | null;
  if (!event || !event.home || !event.away || !isSportCode(event.sport)) notFound();
  const sport = event.sport;

  // La RLS ne renvoie la prédiction qu'aux abonnés premium (ou une fois le match terminé)
  const [{ data: prediction }, { data: odds }, user] = await Promise.all([
    supabase
      .from("predictions")
      .select("expected_home, expected_away, inputs, computed_at")
      .eq("event_id", event.id)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("event_odds").select("period, market, line, selection, odd, bookmaker_name").eq("event_id", event.id).limit(3000),
    getSessionUser(),
  ]);

  const card = (
    <EventCard
      event={{
        id: event.id,
        sport,
        competition: event.competition?.name ?? "",
        startsAt: event.starts_at,
        status: event.status_group,
        clock: event.live_clock,
        home: { name: event.home.name, logoUrl: event.home.logo_url },
        away: { name: event.away.name, logoUrl: event.away.logo_url },
        score: event.home_score !== null && event.away_score !== null ? { home: event.home_score, away: event.away_score } : null,
      }}
    />
  );

  if (!prediction) {
    const { data: premium } = user ? await supabase.rpc("is_premium") : { data: false };
    return (
      <div className="space-y-4">
        {card}
        {premium ? <Alert tone="info">L&apos;analyse de ce match n&apos;est pas encore disponible. Revenez un peu plus tard.</Alert> : <PremiumTeaser loggedIn={Boolean(user)} />}
      </div>
    );
  }

  const parsed = inputsSchema.safeParse(prediction.inputs ?? {});
  const inputs = parsed.success ? parsed.data : {};
  const report = buildMatchReport({
    sport,
    teams: { home: event.home.name, away: event.away.name },
    expected: { home: Number(prediction.expected_home), away: Number(prediction.expected_away) },
    strength: inputs.strength ?? null,
    context: { standings: inputs.context?.standings ?? null, h2h: inputs.context?.h2h ?? null },
    options: {
      ...inputs.options,
      corners: inputs.options?.corners ?? null,
      cards: inputs.options?.cards ?? null,
    },
    playerNames: inputs.playerNames ?? undefined,
    odds: (odds ?? [])
      .filter((o) => (MARKETS as readonly string[]).includes(o.market) && (PERIODS as readonly string[]).includes(o.period))
      .map((o) => ({
        period: o.period as Period,
        market: o.market as Market,
        line: o.line === null ? null : Number(o.line),
        selection: o.selection,
        odd: Number(o.odd),
        bookmaker: o.bookmaker_name,
      })),
  });

  return <MatchReportView report={report} competition={event.competition?.name} startsAt={when.format(new Date(event.starts_at))} />;
}

export default function MatchPage(props: PageProps<"/match/[id]">) {
  return (
    <Suspense
      fallback={
        <div className="space-y-3" aria-hidden>
          <div className="h-48 animate-pulse rounded-(--radius-card) bg-surface" />
          <div className="h-24 animate-pulse rounded-(--radius-card) bg-surface" />
          <div className="h-24 animate-pulse rounded-(--radius-card) bg-surface" />
        </div>
      }
    >
      <MatchContent params={props.params} />
    </Suspense>
  );
}
