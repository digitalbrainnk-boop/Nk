"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getPublicEnv } from "@/lib/env";
import { getSessionUser, requireUser } from "@/lib/auth/dal";
import { authErrorMessage } from "@/lib/auth/errors";
import { type FormState, publicValues } from "@/lib/auth/form-state";
import {
  fieldErrorsOf,
  formDataToObject,
  profileUpdateSchema,
  resetRequestSchema,
  signInEmailSchema,
  signInPhoneSchema,
  signUpEmailSchema,
  signUpPhoneSchema,
  updatePasswordSchema,
  verifyOtpSchema,
} from "@/lib/auth/schemas";
import { rateLimit } from "@/lib/security/rate-limit";
import { getClientIp } from "@/lib/security/request";
import { safeNextPath } from "@/lib/security/safe-redirect";
import { createClient } from "@/lib/supabase/server";

/*
 * Server Actions d'authentification. Chaque action :
 *   1. limite le nombre de tentatives (IP, e-mail ou numéro) ;
 *   2. valide les champs avec zod CÔTÉ SERVEUR ;
 *   3. appelle Supabase Auth et traduit les erreurs en français.
 * Les redirections passent par safeNextPath (pas de redirection externe).
 */

const TOO_MANY_ATTEMPTS = "Trop de tentatives. Patientez quelques minutes avant de réessayer.";
const INVALID_FORM = "Corrigez les champs indiqués.";

async function clientIp(): Promise<string> {
  return getClientIp(await headers());
}

function invalid(error: Parameters<typeof fieldErrorsOf>[0], values: Record<string, string>): FormState {
  return { status: "error", message: INVALID_FORM, fieldErrors: fieldErrorsOf(error), values: publicValues(values) };
}

function failure(message: string, values: Record<string, string>): FormState {
  return { status: "error", message, values: publicValues(values) };
}

function confirmUrl(next: string): string {
  return `${getPublicEnv().NEXT_PUBLIC_SITE_URL}/auth/confirm?suivant=${encodeURIComponent(next)}`;
}

function verificationPath(phone: string, next: string): string {
  return `/verification?telephone=${encodeURIComponent(phone)}&suivant=${encodeURIComponent(next)}`;
}

// --- Inscription -------------------------------------------------------------

export async function signUpWithEmail(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = formDataToObject(formData);
  if (!(await rateLimit("signupByIp", await clientIp()))) return failure(TOO_MANY_ATTEMPTS, raw);

  const parsed = signUpEmailSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error, raw);
  const { displayName, email, password, birthDate, country } = parsed.data;
  const next = safeNextPath(raw.suivant, "/compte");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: confirmUrl(next),
      data: { display_name: displayName, birth_date: birthDate, country_code: country, terms_accepted: true },
    },
  });
  if (error) return failure(authErrorMessage(error), raw);

  // Confirmation par e-mail désactivée dans Supabase : l'utilisateur est déjà connecté.
  if (data.session) redirect(next);

  return {
    status: "success",
    message: `Compte créé ! Ouvrez l'e-mail envoyé à ${email} et cliquez sur le lien pour activer votre compte.`,
  };
}

export async function signUpWithPhone(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = formDataToObject(formData);
  const ip = await clientIp();
  if (!(await rateLimit("signupByIp", ip)) || !(await rateLimit("smsByIp", ip))) {
    return failure(TOO_MANY_ATTEMPTS, raw);
  }

  const parsed = signUpPhoneSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error, raw);
  const { displayName, phone, country, birthDate } = parsed.data;
  if (!(await rateLimit("smsByPhone", phone))) return failure(TOO_MANY_ATTEMPTS, raw);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    phone,
    options: {
      shouldCreateUser: true,
      channel: "sms",
      data: { display_name: displayName, birth_date: birthDate, country_code: country, terms_accepted: true },
    },
  });
  if (error) return failure(authErrorMessage(error), raw);

  redirect(verificationPath(phone, safeNextPath(raw.suivant, "/compte")));
}

// --- Connexion ---------------------------------------------------------------

export async function signInWithEmail(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = formDataToObject(formData);
  const parsed = signInEmailSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error, raw);
  const { email, password } = parsed.data;

  if (!(await rateLimit("loginByIp", await clientIp())) || !(await rateLimit("loginByAccount", email))) {
    return failure(TOO_MANY_ATTEMPTS, raw);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return failure(authErrorMessage(error), raw);

  revalidatePath("/", "layout");
  redirect(safeNextPath(raw.suivant, "/compte"));
}

export async function signInWithPhone(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = formDataToObject(formData);
  const parsed = signInPhoneSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error, raw);
  const { phone } = parsed.data;

  if (!(await rateLimit("smsByIp", await clientIp())) || !(await rateLimit("smsByPhone", phone))) {
    return failure(TOO_MANY_ATTEMPTS, raw);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    phone,
    options: { shouldCreateUser: false, channel: "sms" },
  });
  if (error) return failure(authErrorMessage(error), raw);

  redirect(verificationPath(phone, safeNextPath(raw.suivant, "/compte")));
}

// --- Code SMS ----------------------------------------------------------------

export async function verifyPhoneOtp(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = formDataToObject(formData);
  const parsed = verifyOtpSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error, raw);
  const { phone, token } = parsed.data;

  if (!(await rateLimit("otpVerifyByPhone", phone))) return failure(TOO_MANY_ATTEMPTS, raw);

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ phone, token, type: "sms" });
  if (error) return failure(authErrorMessage(error), raw);

  revalidatePath("/", "layout");
  redirect(safeNextPath(raw.suivant, "/compte"));
}

export async function resendPhoneOtp(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = formDataToObject(formData);
  const parsed = verifyOtpSchema.pick({ phone: true }).safeParse(raw);
  if (!parsed.success) return failure("Numéro invalide : recommencez depuis la page de connexion.", raw);
  const { phone } = parsed.data;

  if (!(await rateLimit("smsByIp", await clientIp())) || !(await rateLimit("smsByPhone", phone))) {
    return failure(TOO_MANY_ATTEMPTS, raw);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: false, channel: "sms" } });
  if (error) return failure(authErrorMessage(error), raw);
  return { status: "success", message: "Un nouveau code vient d'être envoyé par SMS." };
}

// --- Mot de passe ------------------------------------------------------------

export async function requestPasswordReset(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = formDataToObject(formData);
  if (!(await rateLimit("passwordResetByIp", await clientIp()))) return failure(TOO_MANY_ATTEMPTS, raw);

  const parsed = resetRequestSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error, raw);

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: confirmUrl("/nouveau-mot-de-passe"),
  });
  if (error && error.status === 429) return failure(authErrorMessage(error), raw);

  // Même réponse que le compte existe ou non (on ne révèle pas les adresses inscrites).
  return {
    status: "success",
    message: "Si un compte existe pour cette adresse, un e-mail contenant un lien de réinitialisation vient d'être envoyé.",
  };
}

export async function updatePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getSessionUser();
  if (!user) redirect("/connexion?suivant=/nouveau-mot-de-passe");

  const raw = formDataToObject(formData);
  const parsed = updatePasswordSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error, raw);

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return failure(authErrorMessage(error), raw);

  redirect("/compte?mot-de-passe=modifie");
}

// --- Compte ------------------------------------------------------------------

export async function updateProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/compte");
  const raw = formDataToObject(formData);
  if (!(await rateLimit("profileUpdate", user.id))) return failure(TOO_MANY_ATTEMPTS, raw);

  const parsed = profileUpdateSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error, raw);

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: parsed.data.displayName, country_code: parsed.data.country })
    .eq("id", user.id);
  if (error) {
    console.error("[profil] mise à jour impossible :", error.message);
    return failure("Impossible d'enregistrer vos informations pour le moment.", raw);
  }

  revalidatePath("/compte");
  return { status: "success", message: "Profil mis à jour." };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}
