"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/dal";
import { getServerEnv } from "@/lib/env.server";
import { reconcilePayment } from "@/lib/payments/reconcile";

import { rateLimit } from "@/lib/security/rate-limit";
import { ACTIVE_SPORTS, SPORT_CODES } from "@/lib/sports/catalog";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createApiSportsClient } from "@/lib/sync/api-client";
import { STEPS, type Step, type StepReport, runSteps } from "@/lib/sync/run";
import type { Json } from "@/types/database";

/*
 * Actions de l'espace administrateur. Chacune revérifie le rôle admin côté
 * serveur, limite le nombre d'actions et laisse une trace dans le journal.
 */

export type AdminResult = { ok: boolean; message: string };

async function guard() {
  const admin = await requireAdmin();
  if (!(await rateLimit("admin", admin.id))) throw new Error("Trop d'actions d'administration. Patientez un peu.");
  return admin;
}

async function audit(adminId: string, action: string, targetTable: string, targetId: string, details: Record<string, unknown> = {}) {
  await createAdminClient().from("admin_audit_log").insert({ admin_id: adminId, action, target_table: targetTable, target_id: targetId, details: details as Json });
}

const ok = (message: string): AdminResult => ({ ok: true, message });
const fail = (message: string): AdminResult => ({ ok: false, message });

// --- Sports et compétitions -----------------------------------------------------

export async function toggleSport(code: string, enabled: boolean): Promise<void> {
  const admin = await guard();
  if (!(SPORT_CODES as readonly string[]).includes(code)) return;
  // Client utilisateur : la RLS (politique « gestion par l'admin ») s'applique aussi
  const supabase = await createClient();
  await supabase.from("sports").update({ is_enabled: enabled }).eq("code", code);
  await audit(admin.id, enabled ? "enable_sport" : "disable_sport", "sports", code);
  revalidatePath("/admin/competitions");
}

const competitionSchema = z.object({
  id: z.coerce.number().int().positive(),
  enabled: z.enum(["true", "false"]).optional(),
  featured: z.enum(["true", "false"]).optional(),
  order: z.coerce.number().int().min(0).max(32000).optional(),
});

export async function updateCompetition(formData: FormData): Promise<void> {
  const admin = await guard();
  const parsed = competitionSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const { id, enabled, featured, order } = parsed.data;
  const changes: { is_enabled?: boolean; is_featured?: boolean; display_order?: number } = {};
  if (enabled) changes.is_enabled = enabled === "true";
  if (featured) changes.is_featured = featured === "true";
  if (order !== undefined) changes.display_order = order;
  const supabase = await createClient();
  await supabase.from("competitions").update(changes).eq("id", id);
  await audit(admin.id, "update_competition", "competitions", String(id), changes);
  revalidatePath("/admin/competitions");
}

// --- Coupons du jour et codes de chargement -----------------------------------------

const featuredSchema = z.object({
  title: z.string().trim().min(3).max(80),
  premium: z.literal("on").optional(),
  picks: z.array(z.uuid()).min(1).max(15),
});

export async function createFeaturedCoupon(_prev: AdminResult | null, formData: FormData): Promise<AdminResult> {
  const admin = await guard();
  const parsed = featuredSchema.safeParse({ title: formData.get("title"), premium: formData.get("premium") ?? undefined, picks: formData.getAll("picks") });
  if (!parsed.success) return fail("Choisissez au moins une sélection et un titre (3 à 80 caractères).");
  const db = createAdminClient();
  const { data: picks } = await db
    .from("prediction_picks")
    .select("id, event_id, sport, period, market, line, selection, probability, best_odd, event:events!inner(status_group)")
    .in("id", parsed.data.picks);
  const valid = (picks ?? []).filter((p) => p.best_odd !== null && (p.event as unknown as { status_group: string }).status_group === "scheduled");
  if (valid.length !== parsed.data.picks.length) return fail("Chaque sélection doit avoir une cote et un match pas encore commencé.");
  if (new Set(valid.map((p) => p.event_id)).size !== valid.length) return fail("Une seule sélection par match dans un coupon.");

  const totalOdds = valid.reduce((acc, p) => acc * Number(p.best_odd), 1);
  const probability = valid.reduce((acc, p) => acc * Number(p.probability), 1);
  const { data: coupon, error } = await db
    .from("coupons")
    .insert({
      source: "editorial",
      title: parsed.data.title,
      total_odds: Math.round(totalOdds * 1000) / 1000,
      estimated_probability: Math.max(0.00001, Math.round(probability * 100000) / 100000),
      sports: [...new Set(valid.map((p) => p.sport))],
      is_featured: true,
      is_premium: parsed.data.premium === "on",
      featured_by: admin.id,
    })
    .select("id")
    .single();
  if (error || !coupon) return fail("Création du coupon impossible.");
  await db.from("coupon_selections").insert(
    valid.map((p) => ({
      coupon_id: coupon.id,
      event_id: p.event_id,
      pick_id: p.id,
      period: p.period,
      market: p.market,
      line: p.line,
      selection: p.selection,
      odd: Number(p.best_odd),
      probability: Number(p.probability),
    })),
  );
  await audit(admin.id, "create_featured_coupon", "coupons", coupon.id, { picks: valid.length, totalOdds });
  revalidatePath("/admin/coupons");
  revalidatePath("/coupons");
  return ok(`Coupon créé (cote ${totalOdds.toFixed(2)}). Ajoutez maintenant son code de chargement.`);
}

const bookingSchema = z.object({
  couponId: z.uuid(),
  bookmaker: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{2,30}$/),
  country: z.string().trim().toUpperCase().regex(/^([A-Z]{2})?$/),
  code: z.string().trim().regex(/^[A-Za-z0-9_-]{3,32}$/),
});

export async function addBookingCode(_prev: AdminResult | null, formData: FormData): Promise<AdminResult> {
  const admin = await guard();
  const parsed = bookingSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return fail("Code invalide : 3 à 32 lettres ou chiffres, sans espace.");
  const { couponId, bookmaker, country, code } = parsed.data;
  const supabase = await createClient();
  // Premier match du coupon : le code n'est plus utile après
  const { data: legs } = await supabase.from("coupon_selections").select("event:events(starts_at)").eq("coupon_id", couponId);
  const starts = (legs ?? []).map((l) => (l.event as unknown as { starts_at: string } | null)?.starts_at).filter(Boolean) as string[];
  await supabase.from("coupon_booking_codes").delete().eq("coupon_id", couponId).eq("bookmaker", bookmaker);
  const { error } = await supabase.from("coupon_booking_codes").insert({
    coupon_id: couponId,
    bookmaker,
    country_code: country || null,
    code,
    created_by: admin.id,
    expires_at: starts.length ? starts.sort()[0] : null,
  });
  if (error) return fail(`Enregistrement impossible : ${error.message}`);
  await audit(admin.id, "add_booking_code", "coupon_booking_codes", couponId, { bookmaker, country });
  revalidatePath("/admin/coupons");
  revalidatePath("/coupons");
  return ok("Code de chargement publié.");
}

export async function unfeatureCoupon(couponId: string): Promise<void> {
  const admin = await guard();
  if (!z.uuid().safeParse(couponId).success) return;
  await createAdminClient().from("coupons").update({ is_featured: false }).eq("id", couponId);
  await audit(admin.id, "unfeature_coupon", "coupons", couponId);
  revalidatePath("/admin/coupons");
  revalidatePath("/coupons");
}

// --- Utilisateurs et paiements ----------------------------------------------------

export async function grantPremium(_prev: AdminResult | null, formData: FormData): Promise<AdminResult> {
  const admin = await guard();
  const parsed = z.object({ userId: z.uuid(), plan: z.string().regex(/^[a-z_]{2,30}$/) }).safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return fail("Paramètres invalides.");
  const { error } = await createAdminClient().rpc("grant_subscription", { p_user_id: parsed.data.userId, p_plan_code: parsed.data.plan, p_admin_id: admin.id });
  if (error) return fail(`Impossible : ${error.message}`);
  revalidatePath("/admin/utilisateurs");
  return ok("Abonnement offert.");
}

export async function recheckPayment(transactionId: string): Promise<void> {
  const admin = await guard();
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(transactionId)) return;
  await reconcilePayment(transactionId, { source: "admin" });
  await audit(admin.id, "recheck_payment", "payments", transactionId);
  revalidatePath("/admin/paiements");
}

// --- Synchronisation ----------------------------------------------------------------

export async function runSync(_prev: { reports: StepReport[] } | null, formData: FormData): Promise<{ reports: StepReport[] }> {
  const admin = await guard();
  const steps = formData.getAll("steps").filter((s): s is Step => (STEPS as readonly string[]).includes(String(s)));
  if (!steps.length) return { reports: [] };
  const reports = await runSteps(steps, { budgetMs: 240_000, force: true });
  await audit(admin.id, "run_sync", "sync_runs", steps.join(","), { reports: reports.map((r) => `${r.step}:${r.status}`) });
  revalidatePath("/admin/synchro");
  return { reports };
}

export type ApiStatus = { sport: string; ok: boolean; message: string };

/** Teste la clé API-Sports sur chaque sport (route /status : offre et requêtes utilisées). */
export async function testApi(): Promise<ApiStatus[]> {
  await guard();
  const env = getServerEnv();
  if (!env.API_SPORTS_KEY) return [{ sport: "—", ok: false, message: "API_SPORTS_KEY n'est pas configurée." }];
  const api = createApiSportsClient({ key: env.API_SPORTS_KEY, baseTemplate: env.API_SPORTS_BASE_URL_TEMPLATE });
  const results: ApiStatus[] = [];
  for (const s of ACTIVE_SPORTS) {
    try {
      const res = await api.get(s.code, "/status");
      const info = (res.response[0] ?? {}) as { subscription?: { plan?: string; active?: boolean }; requests?: { current?: number; limit_day?: number } };
      results.push({
        sport: s.name,
        ok: info.subscription?.active !== false,
        message: `Offre ${info.subscription?.plan ?? "?"} · ${info.requests?.current ?? "?"}/${info.requests?.limit_day ?? "?"} requêtes aujourd'hui`,
      });
    } catch (err) {
      results.push({ sport: s.name, ok: false, message: (err as Error).message });
    }
  }
  return results;
}

// --- Réglages -------------------------------------------------------------------------

const SETTINGS: Record<string, z.ZodType> = {
  free_picks_per_day: z.coerce.number().int().min(0).max(50),
  free_coupons_per_day: z.coerce.number().int().min(0).max(50),
  max_published_picks_per_day: z.coerce.number().int().min(1).max(200),
  live_sync_seconds: z.coerce.number().int().min(20).max(3600),
  sync_days_ahead: z.coerce.number().int().min(1).max(7),
  ads_enabled: z.enum(["true", "false"]).transform((v) => v === "true"),
  odds_bookmakers: z
    .string()
    .transform((v) => v.split(",").map((b) => b.trim()).filter(Boolean))
    .pipe(z.array(z.string().regex(/^[\w .-]{2,30}$/)).min(1).max(6)),
};

export async function updateSettings(_prev: AdminResult | null, formData: FormData): Promise<AdminResult> {
  const admin = await guard();
  const supabase = await createClient();
  const changed: string[] = [];
  for (const [key, schema] of Object.entries(SETTINGS)) {
    const raw = formData.get(key);
    if (raw === null) continue;
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return fail(`Valeur invalide pour « ${key} ».`);
    const { error } = await supabase.from("app_settings").update({ value: parsed.data as Json, updated_by: admin.id }).eq("key", key);
    if (error) return fail(`Enregistrement impossible (${key}).`);
    changed.push(key);
  }
  for (const code of formData.getAll("plan_code").map(String)) {
    const price = Number(formData.get(`price_${code}`));
    const active = formData.get(`active_${code}`) === "on";
    if (!/^[a-z_]{2,30}$/.test(code) || !Number.isInteger(price) || price < 100 || price > 1_000_000 || price % 5 !== 0) {
      return fail(`Prix invalide pour l'offre ${code} (multiple de 5, au moins 100 F).`);
    }
    await supabase.from("plans").update({ price_xof: price, is_active: active }).eq("code", code);
    changed.push(`plan:${code}`);
  }
  await audit(admin.id, "update_settings", "app_settings", changed.join(","));
  revalidatePath("/admin/reglages");
  return ok("Réglages enregistrés.");
}

