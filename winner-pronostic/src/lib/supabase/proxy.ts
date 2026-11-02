import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_PATHS, PROTECTED_PATH_PREFIXES } from "@/lib/constants";
import { getPublicEnv } from "@/lib/env";
import type { Database } from "@/types/database";

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Un cookie de session Supabase est-il présent ? (évite tout appel réseau pour les visiteurs anonymes) */
function hasSupabaseSessionCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some(({ name }) => name.startsWith("sb-") && name.includes("-auth-token"));
}

/**
 * Rafraîchit la session Supabase (cookies) avant le rendu, puis protège les
 * pages réservées aux membres. Appelée par src/proxy.ts.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const isProtected = matchesPrefix(pathname, PROTECTED_PATH_PREFIXES);
  const isAuthPage = matchesPrefix(pathname, AUTH_PATHS);

  // Visiteur sans session : rien à rafraîchir.
  if (!hasSupabaseSessionCookie(request)) {
    if (isProtected) return redirectToLogin(request, `${pathname}${search}`);
    return NextResponse.next({ request });
  }

  const env = getPublicEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        // Empêche la mise en cache CDN d'une réponse qui contient des jetons de session.
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // getClaims() vérifie la signature du JWT (et le rafraîchit si besoin).
  // Ne rien exécuter entre la création du client et cet appel.
  const { data } = await supabase.auth.getClaims();
  const isLoggedIn = Boolean(data?.claims?.sub);

  if (!isLoggedIn && isProtected) {
    return withCookies(redirectToLogin(request, `${pathname}${search}`), response);
  }

  if (isLoggedIn && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/compte";
    url.search = "";
    return withCookies(NextResponse.redirect(url), response);
  }

  return response;
}

function redirectToLogin(request: NextRequest, next: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/connexion";
  url.search = "";
  url.searchParams.set("suivant", next);
  return NextResponse.redirect(url);
}

/** Recopie les cookies de session rafraîchis sur une réponse de redirection. */
function withCookies(target: NextResponse, source: NextResponse): NextResponse {
  for (const cookie of source.cookies.getAll()) target.cookies.set(cookie);
  const cacheControl = source.headers.get("cache-control");
  if (cacheControl) target.headers.set("cache-control", cacheControl);
  return target;
}
