import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/sync/cron-auth";
import { DAILY_STEPS, STEPS, type Step, runSteps } from "@/lib/sync/run";

/**
 * Tâche quotidienne (Vercel Cron) : saisons, programme, classements, cotes,
 * pronostics, publication, résultats, maintenance.
 * Paramètre facultatif ?steps=odds,predictions pour ne lancer que certaines étapes.
 */
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const requested = new URL(request.url).searchParams.get("steps");
  const steps = requested ? requested.split(",").filter((s): s is Step => (STEPS as readonly string[]).includes(s)) : DAILY_STEPS;
  const reports = await runSteps(steps, { budgetMs: 270_000 });
  return NextResponse.json({ ok: reports.every((r) => r.status !== "error"), reports });
}
