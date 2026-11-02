"use server";

import { z } from "zod";
import { getSessionUser } from "@/lib/auth/dal";
import { selectionLabel, betNotation } from "@/lib/predictions/markets";
import { rateLimit } from "@/lib/security/rate-limit";
import { SPORT_CODES, getSport } from "@/lib/sports/catalog";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { loadCandidates } from "./candidates";
import { MAX_TARGET_ODDS, MIN_TARGET_ODDS, generateCoupon } from "./generator";
import type { GenerateCouponState, TicketLeg } from "./types";

/*
 * Génération d'un « code de X » : l'utilisateur choisit la cote visée, le
 * niveau de risque, la période et les sports ; le serveur sélectionne les
 * meilleures sélections du modèle, enregistre le coupon et renvoie le ticket.
 */

const generateSchema = z.object({
  targetOdds: z.coerce
    .number({ error: "Cote invalide" })
    .min(MIN_TARGET_ODDS, { error: `Cote minimale : ${MIN_TARGET_ODDS}` })
    .max(MAX_TARGET_ODDS, { error: `Cote maximale : ${MAX_TARGET_ODDS}` }),
  risk: z.enum(["prudent", "equilibre", "audacieux"], { error: "Choisissez un niveau de risque" }),
  period: z.enum(["jour", "weekend", "long_terme"], { error: "Choisissez une période" }),
  sports: z.array(z.enum(SPORT_CODES)).max(SPORT_CODES.length).default([]),
  exclude: z
    .string()
    .max(4000)
    .default("")
    .transform((v) => v.split(",").filter((k) => /^[\w:.\-/]{3,80}$/.test(k)).slice(0, 60)),
});

async function freeCouponsPerDay(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase.from("app_settings").select("value").eq("key", "free_coupons_per_day").maybeSingle();
  const value = Number(data?.value);
  return Number.isInteger(value) && value >= 0 ? value : 1;
}

export async function generateCouponAction(_prev: GenerateCouponState, formData: FormData): Promise<GenerateCouponState> {
  const user = await getSessionUser();
  if (!user) return { status: "login_required", message: "Connectez-vous (gratuit, 18 ans et plus) pour générer un code." };

  const parsed = generateSchema.safeParse({
    targetOdds: String(formData.get("targetOdds") ?? "").replace(",", "."),
    risk: formData.get("risk"),
    period: formData.get("period"),
    sports: formData.getAll("sports"),
    exclude: formData.get("exclude") ?? "",
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Paramètres invalides." };
  }
  const { targetOdds, risk, period, sports, exclude } = parsed.data;

  if (!(await rateLimit("couponGenerate", user.id))) {
    return { status: "error", message: "Trop de demandes. Patientez quelques minutes." };
  }
  if (!hasAdminClient()) {
    return { status: "error", message: "Le générateur n'est pas encore configuré sur ce serveur." };
  }

  // Quota de l'offre gratuite
  const supabase = await createClient();
  const { data: premium } = await supabase.rpc("is_premium");
  const admin = createAdminClient();
  if (premium !== true) {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const { count } = await admin
      .from("coupons")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("source", "generated")
      .gte("created_at", startOfDay.toISOString());
    const quota = await freeCouponsPerDay();
    if ((count ?? 0) >= quota) {
      return {
        status: "quota",
        message: `L'offre gratuite donne droit à ${quota} code${quota > 1 ? "s" : ""} par jour. Passez Premium pour des codes illimités.`,
      };
    }
  }

  let candidates;
  try {
    candidates = await loadCandidates(period);
  } catch {
    return { status: "error", message: "Les matchs ne peuvent pas être chargés pour le moment. Réessayez." };
  }
  if (candidates.length === 0) {
    return {
      status: "empty",
      message: "Aucun match analysé pour cette période pour l'instant. Les matchs et pronostics arrivent avec la synchronisation des données.",
    };
  }

  const result = generateCoupon(candidates, { targetOdds, risk, sports, excludeKeys: exclude });
  if (result.status === "insufficient") {
    return { status: "empty", message: `${result.reason} Essayez une cote plus basse, un autre niveau de risque ou une période plus longue.` };
  }

  // Enregistrement du coupon (historique de l'utilisateur et suivi des résultats)
  const { data: coupon, error } = await admin
    .from("coupons")
    .insert({
      user_id: user.id,
      source: "generated",
      target_odds: targetOdds,
      risk_level: risk,
      period,
      sports: [...new Set(result.legs.map((l) => l.sport))],
      total_odds: Math.round(result.totalOdds * 1000) / 1000,
      estimated_probability: Math.max(0.00001, Math.round(result.probability * 100000) / 100000),
    })
    .select("id")
    .single();
  if (error || !coupon) {
    console.error("[coupons] enregistrement impossible :", error?.message);
    return { status: "error", message: "Le coupon n'a pas pu être enregistré. Réessayez." };
  }
  await admin.from("coupon_selections").insert(
    result.legs.map((l) => ({
      coupon_id: coupon.id,
      event_id: l.eventId,
      market: l.market,
      line: l.line,
      selection: l.selection,
      odd: l.odd,
      probability: Math.round(l.probability * 10000) / 10000,
    })),
  );

  const legs: TicketLeg[] = result.legs.map((l) => ({
    key: l.key,
    sport: l.sport,
    competition: l.competition ?? "",
    startsAt: l.startsAt,
    home: l.home,
    away: l.away,
    label: selectionLabel(l.market, l.line, l.selection, { home: l.home, away: l.away }, getSport(l.sport).scoreUnit),
    notation: betNotation(l.market, l.line, l.selection),
    odd: l.odd,
    probability: l.probability,
    confidence: l.confidence,
  }));

  return {
    status: "ok",
    couponId: coupon.id,
    legs,
    totalOdds: result.totalOdds,
    probability: result.probability,
    oneIn: result.oneIn,
    params: { targetOdds, risk, period, sports },
  };
}
