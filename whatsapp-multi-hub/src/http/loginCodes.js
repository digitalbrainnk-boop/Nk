// Liens de connexion à usage unique (…/#login=CODE).
// Le vrai jeton n'apparaît jamais dans une adresse ni dans l'historique du
// navigateur : le code est échangé une seule fois, puis il ne vaut plus rien.
import crypto from "node:crypto";

export function createLoginCodes({ ttlMs = 10 * 60 * 1000 } = {}) {
  const codes = new Map(); // code -> expiration

  function purge() {
    const now = Date.now();
    for (const [code, exp] of codes) if (exp <= now) codes.delete(code);
  }

  return {
    ttlMs,
    issue() {
      purge();
      if (codes.size > 50) codes.clear(); // garde-fou
      const code = crypto.randomBytes(18).toString("base64url");
      codes.set(code, Date.now() + ttlMs);
      return code;
    },
    /** Vrai une seule fois par code valide. */
    consume(code) {
      if (typeof code !== "string" || code.length > 64) return false;
      const exp = codes.get(code);
      codes.delete(code);
      return Boolean(exp && exp > Date.now());
    },
  };
}
