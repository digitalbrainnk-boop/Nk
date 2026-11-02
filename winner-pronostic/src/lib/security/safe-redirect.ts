/**
 * Protection contre les redirections ouvertes : n'accepte qu'un chemin interne
 * (« /compte », « /match/12?onglet=stats »), jamais une URL externe
 * (« https://… », « //evil.com », « /\\evil.com », « javascript:… »).
 */
export function safeNextPath(raw: unknown, fallback = "/"): string {
  if (typeof raw !== "string") return fallback;
  const value = raw.trim();
  if (value.length === 0 || value.length > 300) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  // Caractères de contrôle (dont retours à la ligne) et antislashs interdits
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;

  try {
    const base = "http://winner.invalid";
    const url = new URL(value, base);
    if (url.origin !== base) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
