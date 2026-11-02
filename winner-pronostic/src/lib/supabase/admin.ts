import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";
import { getServerEnv, requireServerEnv } from "@/lib/env.server";
import type { Database } from "@/types/database";

/**
 * Client Supabase « administrateur » avec la clé secrète : il CONTOURNE la RLS.
 * À n'utiliser que dans du code serveur de confiance (tâches cron, webhooks de
 * paiement, limitation de requêtes…), jamais avec des données non validées.
 */
export function createAdminClient() {
  const env = getPublicEnv();
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, requireServerEnv("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Vrai si la clé secrète est configurée (sinon certaines fonctions passent en mode dégradé). */
export function hasAdminClient(): boolean {
  return Boolean(getServerEnv().SUPABASE_SECRET_KEY);
}
