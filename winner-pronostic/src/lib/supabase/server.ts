import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicEnv } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * Client Supabase côté serveur (Server Components, Server Actions, Route
 * Handlers), qui agit AU NOM de l'utilisateur connecté : la RLS s'applique.
 * Toujours créer un nouveau client par requête.
 */
export async function createClient() {
  // cookies() en premier : pendant le pré-rendu, il marque l'appel comme dynamique
  // avant toute lecture de configuration.
  const cookieStore = await cookies();
  const env = getPublicEnv();

  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Appelé depuis un Server Component : écrire un cookie y est impossible.
          // Sans conséquence, car src/proxy.ts rafraîchit la session à chaque requête.
        }
      },
    },
  });
}
