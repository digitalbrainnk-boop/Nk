import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";

/**
 * Couche d'accès aux données d'authentification (« Data Access Layer »).
 * Toute vérification d'identité côté serveur passe par ici. Ces fonctions
 * lisent les cookies : dans une page, appelez-les dans un composant placé
 * sous un <Suspense> (exigence de Cache Components).
 */

export type SessionUser = { id: string; email: string | null; phone: string | null };

export type CurrentProfile = Pick<
  Tables<"profiles">,
  "id" | "display_name" | "email" | "phone" | "birth_date" | "country_code" | "role" | "created_at"
> & { isPremium: boolean; isAdmin: boolean };

/** Utilisateur connecté (JWT vérifié), ou null. Dédoublonné par requête. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  return {
    id: claims.sub,
    email: typeof claims.email === "string" && claims.email ? claims.email : null,
    phone: typeof claims.phone === "string" && claims.phone ? claims.phone : null,
  };
});

/** Profil complet de l'utilisateur connecté (avec statut premium), ou null. */
export const getCurrentProfile = cache(async (): Promise<CurrentProfile | null> => {
  const user = await getSessionUser();
  if (!user) return null;

  const supabase = await createClient();
  const [{ data: profile }, { data: premium }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, email, phone, birth_date, country_code, role, created_at")
      .eq("id", user.id)
      .maybeSingle(),
    supabase.rpc("is_premium"),
  ]);
  if (!profile) return null;
  return { ...profile, isPremium: premium === true, isAdmin: profile.role === "admin" };
});

/** Exige une connexion, sinon redirige vers la page de connexion. */
export async function requireUser(nextPath = "/compte"): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(`/connexion?suivant=${encodeURIComponent(nextPath)}`);
  return user;
}

/** Exige le rôle administrateur. Un non-admin reçoit une page 404 (on ne révèle pas l'existence de l'espace). */
export async function requireAdmin(): Promise<CurrentProfile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion?suivant=/admin");
  if (!profile.isAdmin) notFound();
  return profile;
}
