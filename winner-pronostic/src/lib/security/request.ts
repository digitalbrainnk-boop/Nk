/**
 * Adresse IP du client, utilisée uniquement pour la limitation de requêtes.
 * Sur Vercel, l'en-tête x-forwarded-for est réécrit par la plateforme et fiable ;
 * derrière un autre hébergeur, vérifiez que votre proxy fait de même.
 */
export function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 64);
  return "unknown";
}
