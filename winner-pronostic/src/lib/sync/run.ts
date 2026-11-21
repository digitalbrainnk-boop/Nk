import "server-only";
import { getServerEnv, hasServerEnv } from "@/lib/env.server";
import { runNotifications } from "@/lib/notifications/push";
import { publishPicks, runPredictions, runSettlement } from "@/lib/predictions/pipeline";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiSportsError, createApiSportsClient } from "./api-client";
import { type JobContext, type JobResult, setting, syncLive, syncOdds, syncSchedule, syncSeasons, syncStandings } from "./jobs";
import type { Db, ScoreChange } from "./store";

/**
 * Orchestration des tâches planifiées. Chaque étape est journalisée dans
 * sync_runs (durée, requêtes API, éléments écrits, erreur éventuelle).
 */

export const STEPS = ["seasons", "schedule", "standings", "odds", "live", "predictions", "publish", "settle", "notify", "maintenance"] as const;
export type Step = (typeof STEPS)[number];

/** Étapes lancées par la tâche quotidienne et par la tâche fréquente (toutes les 1 à 5 minutes). */
export const DAILY_STEPS: Step[] = ["seasons", "schedule", "standings", "odds", "predictions", "publish", "settle", "maintenance"];
export const FREQUENT_STEPS: Step[] = ["live", "settle", "notify"];

const NEEDS_API = new Set<Step>(["seasons", "schedule", "standings", "odds", "live"]);

export type StepReport = { step: Step; status: "success" | "error" | "skipped"; items: number; apiRequests: number; ms: number; message?: string };

async function maintenance(db: Db): Promise<JobResult> {
  const [{ data: expired }, { data: pruned }] = await Promise.all([db.rpc("expire_subscriptions"), db.rpc("prune_rate_limits", { p_older_than_seconds: 2 * 86_400 })]);
  await db.from("api_cache").delete().lt("expires_at", new Date().toISOString());
  await db.from("sync_runs").delete().lt("started_at", new Date(Date.now() - 30 * 86_400_000).toISOString());
  return { items: (expired ?? 0) + (pruned ?? 0) };
}

export async function runSteps(steps: Step[], options: { budgetMs?: number; force?: boolean } = {}): Promise<StepReport[]> {
  const db = createAdminClient();
  const env = getServerEnv();
  const api = env.API_SPORTS_KEY ? createApiSportsClient({ key: env.API_SPORTS_KEY, baseTemplate: env.API_SPORTS_BASE_URL_TEMPLATE }) : null;
  const started = Date.now();
  const budget = options.budgetMs ?? 250_000;
  const reports: StepReport[] = [];
  let changes: ScoreChange[] = [];
  let apiDown: string | null = null;

  for (const step of steps) {
    const t0 = Date.now();
    if (t0 - started > budget) {
      reports.push({ step, status: "skipped", items: 0, apiRequests: 0, ms: 0, message: "Temps imparti écoulé" });
      continue;
    }
    if (NEEDS_API.has(step) && (!api || apiDown)) {
      reports.push({ step, status: "skipped", items: 0, apiRequests: 0, ms: 0, message: apiDown ?? "API_SPORTS_KEY manquante" });
      continue;
    }
    if (step === "live" && !options.force) {
      // Pas plus d'une mise à jour du direct par intervalle (quota API)
      const seconds = Math.max(20, Number(await setting(db, "live_sync_seconds", 60)));
      const { data: free } = await db.rpc("rate_limit_hit", { p_key: "lock:live", p_limit: 1, p_window_seconds: seconds });
      if (free === false) {
        reports.push({ step, status: "skipped", items: 0, apiRequests: 0, ms: 0, message: "Direct déjà à jour" });
        continue;
      }
    }

    const { data: run } = await db.from("sync_runs").insert({ job: step, status: "running" }).select("id").single();
    const before = api?.requests ?? 0;
    const ctx: JobContext = { db, api: api!, now: new Date() };
    try {
      let result: JobResult;
      switch (step) {
        case "seasons":
          result = await syncSeasons(ctx);
          break;
        case "schedule":
          result = await syncSchedule(ctx);
          break;
        case "standings":
          result = await syncStandings(ctx);
          break;
        case "odds":
          result = await syncOdds(ctx);
          break;
        case "live":
          result = await syncLive(ctx);
          changes = result.changes ?? [];
          break;
        case "predictions":
          result = await runPredictions(ctx);
          break;
        case "publish":
          result = await publishPicks(ctx);
          break;
        case "settle":
          result = await runSettlement(ctx);
          break;
        case "notify":
          result = await runNotifications(ctx, changes);
          break;
        case "maintenance":
          result = await maintenance(db);
          break;
      }
      const apiRequests = (api?.requests ?? 0) - before;
      if (run) await db.from("sync_runs").update({ status: "success", items_upserted: result.items, api_requests: apiRequests, finished_at: new Date().toISOString() }).eq("id", run.id);
      reports.push({ step, status: "success", items: result.items, apiRequests, ms: Date.now() - t0 });
    } catch (err) {
      const apiRequests = (api?.requests ?? 0) - before;
      const message = err instanceof ApiSportsError ? `${err.kind} : ${err.message}` : (err as Error).message;
      console.error(`[synchro] ${step} :`, message);
      if (run) await db.from("sync_runs").update({ status: "error", error: message.slice(0, 1000), api_requests: apiRequests, finished_at: new Date().toISOString() }).eq("id", run.id);
      reports.push({ step, status: "error", items: 0, apiRequests, ms: Date.now() - t0, message });
      // Quota épuisé ou clé refusée : inutile de continuer les appels à l'API
      if (err instanceof ApiSportsError && (err.kind === "quota" || err.kind === "auth")) apiDown = `API indisponible (${err.kind})`;
    }
  }
  return reports;
}

export function syncConfigured() {
  return { api: hasServerEnv("API_SPORTS_KEY"), cron: hasServerEnv("CRON_SECRET"), admin: hasServerEnv("SUPABASE_SECRET_KEY") };
}
