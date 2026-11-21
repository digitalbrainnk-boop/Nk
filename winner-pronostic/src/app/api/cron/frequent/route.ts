import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/sync/cron-auth";
import { FREQUENT_STEPS, runSteps } from "@/lib/sync/run";

/** Tâche fréquente (toutes les 1 à 5 minutes, via Supabase Cron) : direct, résultats, notifications. */
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const reports = await runSteps(FREQUENT_STEPS, { budgetMs: 50_000 });
  return NextResponse.json({ ok: reports.every((r) => r.status !== "error"), reports });
}
