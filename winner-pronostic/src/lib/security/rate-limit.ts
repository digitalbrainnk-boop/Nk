import "server-only";
import { createHash } from "node:crypto";
import { getServerEnv } from "@/lib/env.server";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { MemoryRateLimiter, type RateLimitRule } from "./memory-rate-limiter";

export type { RateLimitRule };

/** Règles utilisées dans l'application (ajuster ici si besoin). */
export const RATE_LIMITS = {
  /** Connexion e-mail/mot de passe, par IP */
  loginByIp: { limit: 20, windowSeconds: 15 * 60 },
  /** Connexion, par compte (e-mail) */
  loginByAccount: { limit: 8, windowSeconds: 15 * 60 },
  /** Création de compte, par IP */
  signupByIp: { limit: 6, windowSeconds: 60 * 60 },
  /** Envoi de SMS (code), par numéro : les SMS coûtent de l'argent */
  smsByPhone: { limit: 3, windowSeconds: 15 * 60 },
  /** Envoi de SMS, par IP */
  smsByIp: { limit: 10, windowSeconds: 60 * 60 },
  /** Vérification du code, par numéro */
  otpVerifyByPhone: { limit: 8, windowSeconds: 15 * 60 },
  /** E-mail de réinitialisation, par IP */
  passwordResetByIp: { limit: 5, windowSeconds: 60 * 60 },
  /** Mise à jour du profil, par utilisateur */
  profileUpdate: { limit: 20, windowSeconds: 60 * 60 },
  /** Génération de coupons, par utilisateur (même premium) */
  couponGenerate: { limit: 30, windowSeconds: 60 * 60 },
} satisfies Record<string, RateLimitRule>;

const memory = new MemoryRateLimiter();

/** Les clés (IP, e-mail, téléphone) sont hachées : aucune donnée personnelle en clair dans la table. */
function hashKey(key: string): string {
  const salt = getServerEnv().RATE_LIMIT_SALT ?? "winner-pronostic";
  return createHash("sha256").update(`${salt}:${key}`).digest("hex");
}

/**
 * Enregistre une tentative et indique si elle est autorisée.
 * Utilise le compteur partagé en base ; en cas d'indisponibilité, bascule sur
 * le compteur en mémoire (jamais de blocage total du service).
 */
export async function rateLimit(scope: keyof typeof RATE_LIMITS, identifier: string): Promise<boolean> {
  const rule = RATE_LIMITS[scope];
  const key = `${scope}:${hashKey(identifier.toLowerCase())}`;

  if (hasAdminClient()) {
    try {
      const { data, error } = await createAdminClient().rpc("rate_limit_hit", {
        p_key: key,
        p_limit: rule.limit,
        p_window_seconds: rule.windowSeconds,
      });
      if (!error && typeof data === "boolean") return data;
      console.error("[rate-limit] échec du compteur en base, bascule mémoire :", error?.message);
    } catch (err) {
      console.error("[rate-limit] erreur inattendue, bascule mémoire :", err);
    }
  }
  return memory.hit(key, rule);
}
