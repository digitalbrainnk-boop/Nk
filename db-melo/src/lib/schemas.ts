// Validation partagée navigateur / serveur (zod).
import { z } from "zod";
import { COUNTRY_CODES, CURRENCIES, LIMITS, OPERATORS } from "./constants";
import type { Currency, MobileOperator } from "./types";

const voice = z.enum(["male", "female", "duo", "child"]);
const emotion = z.enum(["joyful", "nostalgic", "romantic", "epic"]);
const occasion = z.enum([
  "birthday",
  "wedding",
  "tribute",
  "love",
  "mothers_day",
  "fathers_day",
  "lullaby",
  "graduation",
  "friendship",
  "faith",
  "other",
]);
const style = z.enum([
  "afropop",
  "coupe_decale",
  "zouk",
  "rnb",
  "ballad",
  "amapiano",
  "gospel",
  "afrobeats",
  "rumba",
  "mbalax",
  "kompa",
  "chanson",
  "reggae",
  "hiphop",
]);
const instrument = z.enum([
  "saxophone",
  "acoustic_guitar",
  "balafon_percussion",
  "intimate_piano",
  "kora",
  "strings",
  "talking_drum",
  "brass",
]);
const language = z.enum(["fr", "en", "fr_en", "wolof_fr", "dioula_fr", "lingala_fr"]);
const id = z.string().regex(/^[A-Za-z0-9_-]{6,64}$/);

export const briefSchema = z.object({
  recipientName: z.string().trim().min(1, "Indiquez le prénom de la personne.").max(60),
  nicknames: z.string().trim().max(120).optional(),
  senderName: z.string().trim().max(60).optional(),
  occasion,
  anecdotes: z
    .string()
    .trim()
    .min(LIMITS.anecdotesMin, `Racontez au moins une anecdote (${LIMITS.anecdotesMin} caractères minimum).`)
    .max(LIMITS.anecdotesMax),
  emotion,
});

export const referenceSchema = z
  .object({
    uploadId: id,
    fileName: z.string().max(200),
    analysis: z
      .object({
        bpm: z.number().min(40).max(220).nullable(),
        energy: z.enum(["low", "medium", "high"]),
        durationSec: z.number().min(0).max(3600),
      })
      .optional(),
    useAsCover: z.boolean(),
    rightsConfirmed: z.boolean(),
  })
  .refine((r) => !r.useAsCover || r.rightsConfirmed, {
    message: "Confirmez détenir les droits du morceau pour l'utiliser comme base.",
    path: ["rightsConfirmed"],
  });

// Étapes du formulaire : chacune est validée avant de passer à la suivante.
export const lyricsStepSchema = z.object({
  title: z.string().trim().min(2, "Donnez un titre à la chanson.").max(LIMITS.titleMax),
  lyrics: z
    .string()
    .trim()
    .min(LIMITS.lyricsMin, "Les paroles sont trop courtes : écrivez au moins quelques lignes.")
    .max(LIMITS.lyricsMax, `Les paroles dépassent ${LIMITS.lyricsMax} caractères.`),
  language,
});

export const voiceStepSchema = z.object({ voice, emotion });

export const styleStepSchema = z.object({
  styles: z.array(style).min(1, "Choisissez au moins un style.").max(LIMITS.stylesMax, `${LIMITS.stylesMax} styles maximum.`),
  customInspiration: z.string().trim().max(LIMITS.inspirationMax).optional(),
  instruments: z.array(instrument).max(LIMITS.instrumentsMax, `${LIMITS.instrumentsMax} instruments maximum.`),
  referenceAudio: referenceSchema.nullable().optional(),
});

export const finalStepSchema = z.object({
  recipientName: z.string().trim().max(60).optional(),
  dedication: z.string().trim().max(LIMITS.dedicationMax).optional(),
  photoUploadId: id.nullable().optional(),
});

export const songConfigSchema = z
  .object({
    mode: z.enum(["studio", "ai"]),
    brief: briefSchema.optional(),
    coverChoice: z.enum(["suno", "collector", "ai"]).optional(),
  })
  .extend(lyricsStepSchema.shape)
  .extend(voiceStepSchema.shape)
  .extend(styleStepSchema.shape)
  .extend(finalStepSchema.shape)
  .refine((c) => c.mode !== "ai" || !!c.brief, { message: "Le formulaire guidé est incomplet.", path: ["brief"] });

export const lyricsRequestSchema = z.object({
  brief: briefSchema,
  voice,
  styles: z.array(style).max(LIMITS.stylesMax).default([]),
  language: language.default("fr"),
  previousTitle: z.string().max(LIMITS.titleMax).optional(),
});

export const checkoutSchema = z.object({
  songId: id,
  plan: z.enum(["essentiel", "prestige"]).default("essentiel"),
  method: z.enum(["mobile_money", "card"]),
  /** Pays du client : détermine la passerelle et la monnaie du Mobile Money. */
  country: z.enum(COUNTRY_CODES as [string, ...string[]], { message: "Choisissez votre pays." }),
  /** Devise du paiement par carte (pour le Mobile Money, c'est la monnaie du pays). */
  currency: z.enum(Object.keys(CURRENCIES) as [Currency, ...Currency[]]).optional(),
  operator: z.enum(Object.keys(OPERATORS) as [MobileOperator, ...MobileOperator[]]).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\d{7,12}$/, "Numéro invalide : chiffres uniquement, sans l'indicatif.")
    .optional(),
  email: z.string().trim().email("Adresse e-mail invalide.").optional(),
  customerName: z.string().trim().max(80).optional(),
});

/** Renvoie le premier message d'erreur par champ (pour l'affichage sous les champs). */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
