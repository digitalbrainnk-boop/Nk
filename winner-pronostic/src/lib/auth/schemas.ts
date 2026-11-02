import { z } from "zod";
import { MIN_AGE } from "@/lib/constants";
import { computeAge, parseIsoDate } from "@/lib/validation/age";
import { DEFAULT_PHONE_COUNTRY, SUPPORTED_COUNTRY_CODES, normalizePhone } from "@/lib/validation/phone";

/**
 * Schémas de validation des formulaires d'authentification.
 * Ils s'exécutent CÔTÉ SERVEUR (Server Actions) : ne jamais faire confiance au
 * navigateur, même si les champs HTML ont aussi leurs propres contrôles.
 */

export const emailSchema = z
  .string({ error: "Adresse e-mail requise" })
  .trim()
  .toLowerCase()
  .max(254, { error: "Adresse e-mail trop longue" })
  .pipe(z.email({ error: "Adresse e-mail invalide" }));

/** 8 à 72 caractères (limite de bcrypt), au moins une lettre et un chiffre. */
export const passwordSchema = z
  .string({ error: "Mot de passe requis" })
  .min(8, { error: "8 caractères minimum" })
  .max(72, { error: "72 caractères maximum" })
  .refine((v) => /\p{L}/u.test(v) && /\d/.test(v), { error: "Utilisez au moins une lettre et un chiffre" });

export const displayNameSchema = z
  .string({ error: "Nom requis" })
  .trim()
  .min(2, { error: "2 caractères minimum" })
  .max(50, { error: "50 caractères maximum" })
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} '’.\-_]*$/u, { error: "Lettres, chiffres, espaces et - . _ ' uniquement" });

export const countrySchema = z
  .string()
  .trim()
  .toUpperCase()
  .default(DEFAULT_PHONE_COUNTRY)
  .pipe(z.enum(SUPPORTED_COUNTRY_CODES, { error: "Pays non pris en charge" }));

export const birthDateSchema = z
  .string({ error: "Date de naissance requise" })
  .trim()
  .refine((v) => parseIsoDate(v) !== null, { error: "Date de naissance invalide" })
  .refine((v) => (computeAge(v) ?? -1) >= 0, { error: "Date de naissance dans le futur" })
  .refine((v) => (computeAge(v) ?? 0) <= 120, { error: "Date de naissance invalide" })
  .refine((v) => (computeAge(v) ?? 0) >= MIN_AGE, {
    error: `Vous devez avoir au moins ${MIN_AGE} ans pour utiliser Winner Pronostic`,
  });

/** Case à cocher HTML : « on » quand cochée, absente sinon. */
const termsSchema = z.literal("on", {
  error: `Vous devez confirmer avoir ${MIN_AGE} ans ou plus et accepter les conditions`,
});

export const otpSchema = z
  .string({ error: "Code requis" })
  .trim()
  .regex(/^\d{6}$/, { error: "Le code contient 6 chiffres" });

/** Ajoute le numéro normalisé (E.164) ou une erreur sur le champ « phone ». */
function withNormalizedPhone<T extends { phone: string; country: string }>(data: T, ctx: z.RefinementCtx) {
  const e164 = normalizePhone(data.phone, data.country);
  if (!e164) {
    ctx.addIssue({ code: "custom", path: ["phone"], message: "Numéro de téléphone invalide pour ce pays" });
    return z.NEVER;
  }
  return { ...data, phone: e164 };
}

const rawPhoneSchema = z.string({ error: "Numéro requis" }).trim().min(1, { error: "Numéro requis" }).max(25);

export const signUpEmailSchema = z.object({
  displayName: displayNameSchema,
  email: emailSchema,
  password: passwordSchema,
  birthDate: birthDateSchema,
  country: countrySchema,
  terms: termsSchema,
});

export const signUpPhoneSchema = z
  .object({
    displayName: displayNameSchema,
    phone: rawPhoneSchema,
    country: countrySchema,
    birthDate: birthDateSchema,
    terms: termsSchema,
  })
  .transform(withNormalizedPhone);

export const signInEmailSchema = z.object({
  email: emailSchema,
  password: z.string({ error: "Mot de passe requis" }).min(1, { error: "Mot de passe requis" }).max(72),
});

export const signInPhoneSchema = z
  .object({ phone: rawPhoneSchema, country: countrySchema })
  .transform(withNormalizedPhone);

export const verifyOtpSchema = z.object({
  phone: z.string().regex(/^\+\d{8,15}$/, { error: "Numéro invalide, recommencez" }),
  token: otpSchema,
});

export const resetRequestSchema = z.object({ email: emailSchema });

export const updatePasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((d) => d.password === d.confirm, { path: ["confirm"], error: "Les mots de passe ne correspondent pas" });

export const profileUpdateSchema = z.object({
  displayName: displayNameSchema,
  country: countrySchema,
});

/** Convertit un FormData en objet simple (seules les valeurs texte sont gardées). */
export function formDataToObject(formData: FormData): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$ACTION")) result[key] = value;
  }
  return result;
}

/** Erreurs par champ (premier message de chaque champ). */
export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    out[field] ??= issue.message;
  }
  return out;
}
