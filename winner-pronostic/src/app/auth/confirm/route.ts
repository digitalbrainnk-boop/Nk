import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { safeNextPath } from "@/lib/security/safe-redirect";
import { createClient } from "@/lib/supabase/server";

const EMAIL_OTP_TYPES: readonly EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

/**
 * Lien reçu par e-mail (confirmation d'inscription, réinitialisation du mot de
 * passe, changement d'adresse). Deux formats sont acceptés :
 *   - ?token_hash=…&type=… : recommandé (fonctionne même si le lien est ouvert
 *     sur un autre appareil) — voir les modèles d'e-mails dans le README ;
 *   - ?code=… : format PKCE par défaut de Supabase.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const rawType = searchParams.get("type");
  const code = searchParams.get("code");
  const type = EMAIL_OTP_TYPES.find((t) => t === rawType);

  const fallback = type === "recovery" ? "/nouveau-mot-de-passe" : "/compte";
  const next = safeNextPath(searchParams.get("suivant"), fallback);

  const supabase = await createClient();
  let ok = false;

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  redirect(ok ? next : "/connexion?erreur=lien");
}
