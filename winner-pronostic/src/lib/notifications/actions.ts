"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/dal";
import { type FormState, publicValues } from "@/lib/auth/form-state";
import { formDataToObject } from "@/lib/auth/schemas";
import { rateLimit } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";

const subscriptionSchema = z.object({
  endpoint: z.url().startsWith("https://").max(1000),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{40,200}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{10,100}$/),
  }),
});

/** Enregistre l'abonnement push de cet appareil. */
export async function savePushSubscription(raw: unknown, userAgent: string): Promise<{ ok: boolean; message?: string }> {
  const user = await requireUser("/compte");
  if (!(await rateLimit("profileUpdate", `push:${user.id}`))) return { ok: false, message: "Trop de tentatives." };
  const parsed = subscriptionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Abonnement invalide." };
  const supabase = await createClient();
  await supabase.from("push_subscriptions").delete().eq("endpoint", parsed.data.endpoint);
  const { error } = await supabase.from("push_subscriptions").insert({
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth_key: parsed.data.keys.auth,
    user_agent: userAgent.slice(0, 200),
  });
  return error ? { ok: false, message: "Impossible d'activer les notifications sur cet appareil." } : { ok: true };
}

export async function removePushSubscription(endpoint: string): Promise<{ ok: boolean }> {
  await requireUser("/compte");
  if (typeof endpoint !== "string" || endpoint.length > 1000) return { ok: false };
  const supabase = await createClient();
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  return { ok: true };
}

const prefsSchema = z.object({
  notifyKickoff: z.literal("on").optional(),
  notifyGoals: z.literal("on").optional(),
  lead: z.coerce.number().int().min(5).max(180),
});

export async function updateNotificationPrefs(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/compte");
  const raw = formDataToObject(formData);
  const parsed = prefsSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: "Réglages invalides.", values: publicValues(raw) };
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ notify_kickoff: parsed.data.notifyKickoff === "on", notify_goals: parsed.data.notifyGoals === "on", kickoff_lead_minutes: parsed.data.lead })
    .eq("id", user.id);
  if (error) return { status: "error", message: "Enregistrement impossible." };
  revalidatePath("/compte");
  return { status: "success", message: "Préférences enregistrées." };
}

export async function removeFavorite(teamId: number): Promise<void> {
  await requireUser("/compte");
  if (!Number.isInteger(teamId) || teamId <= 0) return;
  const supabase = await createClient();
  await supabase.from("favorite_teams").delete().eq("team_id", teamId);
  revalidatePath("/compte");
}
