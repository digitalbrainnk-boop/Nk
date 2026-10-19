// Limiteur en mémoire (par instance). Protège le crédit Kie contre les abus simples ;
// derrière plusieurs instances serverless, préférer un limiteur partagé (Upstash Ratelimit…).
import { config } from "./env";

const hits = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return { ok: false, retryAfterSec: Math.ceil((windowMs - (now - recent[0])) / 1000) };
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return { ok: true, retryAfterSec: 0 };
}

/**
 * Plafond commun à tous les visiteurs : même un abus réparti sur de nombreuses adresses
 * ne peut pas dépasser ce volume (protège le crédit Kie et les quotas des passerelles).
 */
export function globalBudget(name: string, limit: number, windowMs = 3600_000): boolean {
  return rateLimit(`global:${name}`, limit, windowMs).ok;
}

/**
 * Limite par visiteur. Si l'hébergeur ne transmet pas l'adresse des visiteurs, tous seraient comptés
 * comme un seul : on ne limite alors pas par visiteur (les plafonds globaux protègent).
 */
export function visitorLimit(req: Request, name: string, limit: number, windowMs = 3600_000): { ok: boolean; retryAfterSec: number } {
  const ip = clientIp(req);
  return ip === "local" ? { ok: true, retryAfterSec: 0 } : rateLimit(`${name}:${ip}`, limit, windowMs);
}

/** Adresses internes (serveur lui-même, réseau privé) : ce sont des intermédiaires, jamais un visiteur. */
const INTERNAL = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|::1$|::$|f[cd][0-9a-f]{2}:|fe80:)/i;

/**
 * Adresse du visiteur. Chaque proxy ajoute en fin de X-Forwarded-For l'adresse qu'il voit ; le début
 * de la liste vient du navigateur et peut être inventé. On lit donc depuis la fin : les adresses
 * internes sont écartées, puis on saute les proxys publics de confiance (TRUSTED_PROXY_HOPS, 1 par défaut).
 * Sans adresse publique (Next.js renseigne alors 127.0.0.1 derrière Apache) : « local », adresse inconnue.
 */
export function clientIp(req: Request): string {
  const header = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "";
  const chain = header
    .split(",")
    .map((s) => s.trim().replace(/^::ffff:/i, ""))
    .filter((s) => s && !INTERNAL.test(s));
  return chain.length ? chain[Math.max(0, chain.length - config.trustedProxyHops())] : "local";
}
