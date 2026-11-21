import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { FavoriteButton } from "@/components/match/favorite-button";
import { Absences, FormStrip, HeadToHead, Incidents, Lineups, MainOdds, Section, SplitCompare, StandingsTable } from "@/components/match/match-sections";
import { MatchReportView } from "@/components/report/match-report";
import { PremiumTeaser } from "@/components/report/premium-teaser";
import { EventCard } from "@/components/sport/event-card";
import { Alert } from "@/components/ui/alert";
import { AutoRefresh } from "@/components/ui/auto-refresh";
import { getSessionUser } from "@/lib/auth/dal";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { getFavoriteTeamIds, getFootballExtras, getMainOdds, getMatch, getMatchStats } from "@/lib/data/match";
import { MARKETS, PERIODS, type Market, type Period } from "@/lib/predictions/markets";
import { buildMatchReport } from "@/lib/predictions/report";
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

async function MatchContent({ params }: { params: PageProps<"/match/[id]">["params"] }) {
  const { id } = await params;
  if (!/^\d{1,12}$/.test(id)) notFound();
  const match = await getMatch(Number(id));
  if (!match) notFound();

  const supabase = await createClient();
  // La RLS ne renvoie la prédiction qu'aux abonnés premium (ou une fois le match terminé)
  const [{ data: prediction }, { data: odds }, user, stats, mainOdds, extras, favorites] = await Promise.all([
    supabase
      .from("predictions")
      .select("expected_home, expected_away, inputs, computed_at")
      .eq("event_id", match.id)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("event_odds").select("period, market, line, selection, odd, bookmaker_name").eq("event_id", match.id).limit(3000),
    getSessionUser(),
    getMatchStats(match),
    getMainOdds(match.id),
    getFootballExtras(match),
    getFavoriteTeamIds(),
  ]);
  const sport = match.sport;

  const card = (
    <EventCard
      event={{
        id: match.id,
        sport,
        competition: match.competition.name,
        startsAt: match.startsAt,
        status: match.status,
        clock: match.clock,
        home: { name: match.home.name, logoUrl: match.home.logo },
        away: { name: match.away.name, logoUrl: match.away.logo },
        score: match.homeScore !== null && match.awayScore !== null ? { home: match.homeScore, away: match.awayScore } : null,
      }}
    />
  );

  let premiumBlock: React.ReactNode;
  if (!prediction) {
    const { data: premium } = user ? await supabase.rpc("is_premium") : { data: false };
    premiumBlock = premium ? (
      <Alert tone="info">L&apos;analyse complète de ce match n&apos;est pas encore calculée. Revenez un peu plus tard.</Alert>
    ) : (
      <PremiumTeaser loggedIn={Boolean(user)} />
    );
  } else {
    const parsed = inputsSchema.safeParse(prediction.inputs ?? {});
    const inputs = parsed.success ? parsed.data : {};
    const report = buildMatchReport({
      sport,
      teams: { home: match.home.name, away: match.away.name },
      expected: { home: Number(prediction.expected_home), away: Number(prediction.expected_away) },
      strength: inputs.strength ?? null,
      context: { standings: inputs.context?.standings ?? null, h2h: inputs.context?.h2h ?? null },
      options: { ...inputs.options, corners: inputs.options?.corners ?? null, cards: inputs.options?.cards ?? null },
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
    premiumBlock = <MatchReportView report={report} competition={match.competition.name} startsAt={when.format(new Date(match.startsAt))} />;
  }

  return (
    <div className="space-y-6">
      {card}
      <div className="flex flex-wrap gap-2">
        <FavoriteButton teamId={match.home.id} name={match.home.name} initial={favorites?.has(match.home.id) ?? false} loggedIn={Boolean(user)} />
        <FavoriteButton teamId={match.away.id} name={match.away.name} initial={favorites?.has(match.away.id) ?? false} loggedIn={Boolean(user)} />
      </div>
      {match.status === "live" ? <AutoRefresh seconds={30} /> : null}

      {stats.incidents.length ? (
        <Section title="Faits de match">
          <Incidents incidents={stats.incidents} />
        </Section>
      ) : null}

      <Section title="Cotes" note="Meilleures cotes relevées chez les bookmakers suivis.">
        <MainOdds match={match} odds={mainOdds} />
      </Section>

      <Section title="Forme (5 derniers matchs)">
        <div className="grid gap-2 sm:grid-cols-2">
          <FormStrip team={match.home.name} form={stats.homeForm} />
          <FormStrip team={match.away.name} form={stats.awayForm} />
        </div>
      </Section>

      <Section title="Domicile / extérieur">
        <SplitCompare match={match} home={stats.homeSplit} away={stats.awaySplit} />
      </Section>

      <Section title="Confrontations directes">
        <HeadToHead games={stats.h2h} home={match.home.name} />
      </Section>

      <Section title="Classement">
        <StandingsTable rows={stats.standings} highlight={[match.home.id, match.away.id]} />
      </Section>

      {extras ? (
        <>
          <Section title="Blessés et suspendus">
            <Absences match={match} injuries={extras.injuries} />
          </Section>
          <Section title="Compositions" note="Publiées environ une heure avant le coup d'envoi.">
            <Lineups match={match} lineups={extras.lineups} />
          </Section>
        </>
      ) : null}

      <div className="border-t border-line pt-6">{premiumBlock}</div>
    </div>
  );
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
