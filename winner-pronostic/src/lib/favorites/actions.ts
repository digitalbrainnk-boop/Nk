"use server";

import { z } from "zod";
import { getSessionUser } from "@/lib/auth/dal";
import { rateLimit } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";

const teamIdSchema = z.coerce.number().int().positive().max(1e12);

/** Ajoute ou retire une équipe des favoris (alertes coup d'envoi et buts). */
export async function toggleFavorite(rawTeamId: number): Promise<{ ok: boolean; favorite?: boolean; message?: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Connectez-vous pour suivre une équipe." };
  const parsed = teamIdSchema.safeParse(rawTeamId);
  if (!parsed.success) return { ok: false, message: "Équipe invalide." };
  if (!(await rateLimit("profileUpdate", `fav:${user.id}`))) return { ok: false, message: "Trop d'actions. Patientez un peu." };

  const supabase = await createClient();
  const { data: existing } = await supabase.from("favorite_teams").select("team_id").eq("team_id", parsed.data).maybeSingle();
  if (existing) {
    await supabase.from("favorite_teams").delete().eq("team_id", parsed.data);
    return { ok: true, favorite: false };
  }
  const { count } = await supabase.from("favorite_teams").select("team_id", { count: "exact", head: true });
  if ((count ?? 0) >= 30) return { ok: false, message: "30 équipes favorites maximum." };
  const { error } = await supabase.from("favorite_teams").insert({ team_id: parsed.data });
  if (error) return { ok: false, message: "Impossible d'ajouter cette équipe." };
  return { ok: true, favorite: true };
}
