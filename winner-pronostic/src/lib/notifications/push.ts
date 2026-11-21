import "server-only";
import { sendNotification } from "web-push";
import { getServerEnv } from "@/lib/env.server";
import type { Db, ScoreChange } from "@/lib/sync/store";

/**
 * Notifications push (Web Push + clés VAPID) : alertes avant le coup d'envoi
 * et à chaque but pour les équipes favorites. Chaque alerte n'est envoyée
 * qu'une fois (journal notification_log).
 */

export type PushPayload = { title: string; body: string; url: string; tag?: string };

export function pushConfigured(): boolean {
  const env = getServerEnv();
  return Boolean(env.VAPID_PRIVATE_KEY && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
}

/** Réserve l'envoi dans le journal ; renvoie les utilisateurs pas encore notifiés. */
async function reserve(db: Db, userIds: string[], eventId: number | null, kind: "kickoff" | "goal" | "result" | "coupon" | "info", dedupeKey: string) {
  if (!userIds.length) return [];
  const { data } = await db
    .from("notification_log")
    .upsert(
      userIds.map((user_id) => ({ user_id, event_id: eventId, kind, dedupe_key: dedupeKey })),
      { onConflict: "user_id,event_id,kind,dedupe_key", ignoreDuplicates: true },
    )
    .select("user_id");
  return (data ?? []).map((r) => r.user_id);
}

export async function sendToUsers(db: Db, userIds: string[], payload: PushPayload): Promise<number> {
  if (!userIds.length || !pushConfigured()) return 0;
  const env = getServerEnv();
  const vapidDetails = {
    subject: env.VAPID_SUBJECT ?? "mailto:contact@winner-pronostic.app",
    publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    privateKey: env.VAPID_PRIVATE_KEY!,
  };
  const { data: subscriptions } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth_key").in("user_id", userIds);
  let sent = 0;
  for (const s of subscriptions ?? []) {
    try {
      await sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } }, JSON.stringify(payload), { vapidDetails, TTL: 3600, urgency: "high" });
      sent += 1;
      await db.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).eq("id", s.id);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      // Abonnement expiré ou révoqué par le navigateur : on le supprime
      if (status === 404 || status === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
    }
  }
  return sent;
}

type EventInfo = { id: number; starts_at: string; home_team_id: number; away_team_id: number; home: { name: string } | null; away: { name: string } | null };

/** Utilisateurs dont une équipe favorite joue, avec leurs préférences. */
async function fans(db: Db, teamIds: number[]) {
  const { data: favorites } = await db.from("favorite_teams").select("user_id, team_id").in("team_id", teamIds);
  const userIds = [...new Set((favorites ?? []).map((f) => f.user_id))];
  if (!userIds.length) return [];
  const { data: profiles } = await db.from("profiles").select("id, notify_kickoff, notify_goals, kickoff_lead_minutes").in("id", userIds);
  return (profiles ?? []).map((p) => ({ ...p, teams: (favorites ?? []).filter((f) => f.user_id === p.id).map((f) => f.team_id) }));
}

export async function runNotifications(ctx: { db: Db; now: Date }, changes: ScoreChange[] = []) {
  if (!pushConfigured()) return { items: 0, details: { skipped: "Clés VAPID absentes" } };
  let sent = 0;

  // 1. Coup d'envoi imminent
  const until = new Date(ctx.now.getTime() + 180 * 60_000).toISOString();
  const { data: soon } = await ctx.db
    .from("events")
    .select("id, starts_at, home_team_id, away_team_id, home:teams!events_home_team_id_sport_fkey(name), away:teams!events_away_team_id_sport_fkey(name)")
    .eq("status_group", "scheduled")
    .gte("starts_at", ctx.now.toISOString())
    .lte("starts_at", until)
    .limit(300);
  for (const e of (soon ?? []) as unknown as EventInfo[]) {
    const minutes = Math.round((Date.parse(e.starts_at) - ctx.now.getTime()) / 60_000);
    const targets = (await fans(ctx.db, [e.home_team_id, e.away_team_id])).filter((p) => p.notify_kickoff && minutes <= p.kickoff_lead_minutes).map((p) => p.id);
    const fresh = await reserve(ctx.db, targets, e.id, "kickoff", "");
    sent += await sendToUsers(ctx.db, fresh, {
      title: `⏰ Coup d'envoi dans ${minutes} min`,
      body: `${e.home?.name ?? "?"} – ${e.away?.name ?? "?"} : consultez l'analyse avant le match.`,
      url: `/match/${e.id}`,
      tag: `kickoff-${e.id}`,
    });
  }

  // 2. Buts marqués (détectés par la synchronisation en direct)
  for (const c of changes) {
    const { data: e } = await ctx.db
      .from("events")
      .select("id, home:teams!events_home_team_id_sport_fkey(name), away:teams!events_away_team_id_sport_fkey(name)")
      .eq("id", c.eventId)
      .maybeSingle();
    const info = e as unknown as Pick<EventInfo, "home" | "away"> | null;
    const targets = (await fans(ctx.db, [c.homeTeamId, c.awayTeamId])).filter((p) => p.notify_goals).map((p) => p.id);
    const key = `${c.after.home}-${c.after.away}`;
    const fresh = await reserve(ctx.db, targets, c.eventId, "goal", key);
    const unit = c.sport === "football" || c.sport === "ice_hockey" || c.sport === "handball" ? "But" : "Score";
    sent += await sendToUsers(ctx.db, fresh, {
      title: `${c.sport === "football" ? "⚽" : "🔔"} ${unit} !`,
      body: `${info?.home?.name ?? "?"} ${c.after.home} – ${c.after.away} ${info?.away?.name ?? "?"}`,
      url: `/match/${c.eventId}`,
      tag: `score-${c.eventId}`,
    });
  }
  return { items: sent };
}
