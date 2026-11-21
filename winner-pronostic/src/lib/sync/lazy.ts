import "server-only";
import { hasServerEnv } from "@/lib/env.server";
import { runSteps } from "./run";

/**
 * Mise à jour du direct déclenchée par les visites (complément de la tâche
 * planifiée) : un verrou en base garantit au plus une mise à jour par
 * intervalle, quel que soit le nombre de visiteurs.
 */
export async function refreshLiveInBackground() {
  if (!hasServerEnv("API_SPORTS_KEY") || !hasServerEnv("SUPABASE_SECRET_KEY")) return;
  try {
    await runSteps(["live", "settle", "notify"], { budgetMs: 25_000 });
  } catch (err) {
    console.error("[direct] mise à jour impossible :", (err as Error).message);
  }
}
