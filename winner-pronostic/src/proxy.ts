import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Proxy Next.js (anciennement « middleware ») : exécuté avant chaque page pour
 * rafraîchir la session Supabase et protéger les pages réservées aux membres.
 * L'autorisation fine (rôle admin, premium) est revérifiée au plus près des
 * données (src/lib/auth/dal.ts) et par la RLS de la base.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Tout sauf les fichiers statiques, les icônes, le manifeste et le service worker.
    "/((?!_next/static|_next/image|favicon.ico|icons/|sw.js|manifest.webmanifest|robots.txt|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt)$).*)",
  ],
};
