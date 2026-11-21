import "server-only";
import { z } from "zod";

/**
 * Variables d'environnement SECRÈTES : uniquement côté serveur.
 * L'import de « server-only » fait échouer la compilation si ce fichier est
 * importé par erreur dans un composant client.
 * Toutes sont facultatives au démarrage : chaque fonctionnalité vérifie la
 * sienne avec requireServerEnv() et affiche un message clair si elle manque.
 */
const optionalSecret = (min: number) => z.string().min(min).optional();

const serverEnvSchema = z.object({
  /** Clé secrète Supabase (sb_secret_… ou ancienne clé service_role). Contourne la RLS : serveur uniquement. */
  SUPABASE_SECRET_KEY: optionalSecret(20),
  /** Sel utilisé pour anonymiser (hacher) les clés de limitation de requêtes. */
  RATE_LIMIT_SALT: optionalSecret(16),

  /** Clé API-Sports (même clé pour tous les sports). */
  API_SPORTS_KEY: optionalSecret(10),
  /** Tests uniquement : modèle d'URL du fournisseur, ex. « http://localhost:4010/{host} ». */
  API_SPORTS_BASE_URL_TEMPLATE: z.string().includes("{host}").optional(),
  /** Secret partagé avec les tâches planifiées (Vercel Cron, Supabase Cron). */
  CRON_SECRET: optionalSecret(16),

  /** CinetPay : identifiants du compte marchand. */
  CINETPAY_API_KEY: optionalSecret(10),
  CINETPAY_SITE_ID: optionalSecret(3),
  CINETPAY_SECRET_KEY: optionalSecret(10),
  /** Tests uniquement : remplace https://api-checkout.cinetpay.com */
  CINETPAY_API_BASE: z.url().optional(),

  /** Notifications push (clés VAPID). */
  VAPID_PRIVATE_KEY: optionalSecret(20),
  VAPID_SUBJECT: z.string().min(5).optional(),
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

const read = (name: string) => process.env[name] || undefined;

export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv({
    SUPABASE_SECRET_KEY: read("SUPABASE_SECRET_KEY") ?? read("SUPABASE_SERVICE_ROLE_KEY"),
    RATE_LIMIT_SALT: read("RATE_LIMIT_SALT"),
    API_SPORTS_KEY: read("API_SPORTS_KEY") ?? read("API_FOOTBALL_KEY"),
    API_SPORTS_BASE_URL_TEMPLATE: read("API_SPORTS_BASE_URL_TEMPLATE"),
    CRON_SECRET: read("CRON_SECRET"),
    CINETPAY_API_KEY: read("CINETPAY_API_KEY"),
    CINETPAY_SITE_ID: read("CINETPAY_SITE_ID"),
    CINETPAY_SECRET_KEY: read("CINETPAY_SECRET_KEY"),
    CINETPAY_API_BASE: read("CINETPAY_API_BASE"),
    VAPID_PRIVATE_KEY: read("VAPID_PRIVATE_KEY"),
    VAPID_SUBJECT: read("VAPID_SUBJECT"),
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

export function hasServerEnv(key: keyof ServerEnv): boolean {
  const value = getServerEnv()[key];
  return value !== undefined && value !== null && value !== "";
}
