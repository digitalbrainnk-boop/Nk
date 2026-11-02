import { z } from "zod";

/**
 * Variables d'environnement PUBLIQUES (préfixe NEXT_PUBLIC_), intégrées au
 * code envoyé au navigateur. Elles ne doivent contenir AUCUN secret : la clé
 * « publishable » (ex-« anon ») de Supabase est faite pour être publique, la
 * sécurité reposant sur la Row Level Security.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({ error: "doit être l'URL de votre projet Supabase (https://xxxx.supabase.co)" }),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string({ error: "clé publique Supabase manquante" })
    .min(20, { error: "clé publique Supabase invalide" }),
  NEXT_PUBLIC_SITE_URL: z
    .url({ error: "doit être l'adresse publique du site (ex. https://winner-pronostic.vercel.app)" })
    .default("http://localhost:3000")
    .transform((url) => url.replace(/\/+$/, "")),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

/** Valide un ensemble de variables publiques (fonction pure, testable). */
export function parsePublicEnv(raw: Record<string, string | undefined>): PublicEnv {
  const result = publicEnvSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")} : ${issue.message}`)
      .join("\n");
    throw new Error(
      `Configuration invalide. Vérifiez votre fichier .env.local (voir .env.example) :\n${details}`,
    );
  }
  return result.data;
}

let cachedPublicEnv: PublicEnv | undefined;

/**
 * Lit les variables publiques. Les noms sont écrits en toutes lettres pour que
 * Next.js puisse les remplacer à la compilation dans le code client.
 */
export function getPublicEnv(): PublicEnv {
  cachedPublicEnv ??= parsePublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    // Ancien nom accepté pour les projets Supabase qui affichent encore « anon key ».
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || undefined,
  });
  return cachedPublicEnv;
}
