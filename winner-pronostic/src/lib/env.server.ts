import "server-only";
import { z } from "zod";

/**
 * Variables d'environnement SECRÈTES : uniquement côté serveur.
 * L'import de « server-only » fait échouer la compilation si ce fichier est
 * importé par erreur dans un composant client.
 *
 * Les clés des phases suivantes (API-Football, CinetPay/FedaPay, VAPID…)
 * seront ajoutées ici au fur et à mesure.
 */
const serverEnvSchema = z.object({
  /** Clé secrète Supabase (sb_secret_… ou ancienne clé service_role). Contourne la RLS : serveur uniquement. */
  SUPABASE_SECRET_KEY: z.string().min(20).optional(),
  /** Sel utilisé pour anonymiser (hacher) les clés de limitation de requêtes. */
  RATE_LIMIT_SALT: z.string().min(16).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(raw: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues.map((i) => `  - ${i.path.join(".")} : ${i.message}`).join("\n");
    throw new Error(`Variables serveur invalides :\n${details}`);
  }
  return result.data;
}

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv({
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || undefined,
    RATE_LIMIT_SALT: process.env.RATE_LIMIT_SALT || undefined,
  });
  return cached;
}

/** Renvoie une variable obligatoire pour la fonctionnalité appelante, sinon une erreur explicite. */
export function requireServerEnv<K extends keyof ServerEnv>(key: K): NonNullable<ServerEnv[K]> {
  const value = getServerEnv()[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`La variable d'environnement ${String(key)} est requise (voir .env.example).`);
  }
  return value as NonNullable<ServerEnv[K]>;
}
