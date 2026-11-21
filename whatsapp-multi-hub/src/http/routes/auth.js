// Connexion des appareils et gestion du jeton d'accès.
import crypto from "node:crypto";
import fs from "node:fs";
import { Router } from "express";
import { AppError } from "../../errors.js";
import { tokenHash } from "../auth.js";

/** Routes publiques (avant le contrôle du jeton). */
export function publicAuthRouter({ config, auth, loginCodes }) {
  const router = Router();
  // Échange d'un code de connexion à usage unique contre le jeton.
  router.post("/exchange", (req, res) => {
    if (auth.isBlocked(req.ip)) {
      return res.status(429).json({ error: { code: "too_many_attempts", message: "Trop de tentatives, réessaie plus tard." } });
    }
    if (!loginCodes.consume(req.body?.code)) {
      auth.recordFailure(req.ip);
      return res.status(401).json({
        error: { code: "invalid_login_code", message: "Lien de connexion expiré ou déjà utilisé. Dans Termux, tape « lignes » pour en obtenir un nouveau." },
      });
    }
    auth.clearFailures(req.ip);
    res.json({ token: config.apiToken });
  });
  return router;
}

/** Routes protégées par le jeton. */
export function authRouter({ config, loginCodes, io, logger }) {
  const router = Router();

  // Nouveau lien de connexion (utilisé par la commande « lignes »).
  router.post("/login-code", (req, res) => {
    const code = loginCodes.issue();
    res.json({ code, path: `/#login=${code}`, expiresInSeconds: Math.round(loginCodes.ttlMs / 1000) });
  });

  // Changer le jeton : tous les AUTRES appareils sont déconnectés.
  router.post("/rotate", (req, res) => {
    if (config.apiTokenSource === "env") {
      throw new AppError(409, "Le jeton est fixé dans le fichier .env (API_TOKEN) : change-le là, puis redémarre.", "token_from_env");
    }
    const token = crypto.randomBytes(24).toString("base64url");
    fs.writeFileSync(config.apiTokenFile, `${token}\n`, { mode: 0o600 });
    config.apiToken = token;
    config.apiTokenSource = "file";
    logger.warn("Jeton d'accès changé : les autres appareils devront se reconnecter.");
    // Coupe les connexions temps réel ouvertes avec l'ANCIEN jeton (pas celles qui
    // se reconnectent déjà avec le nouveau), juste après l'envoi de la réponse.
    const fresh = tokenHash(token);
    setTimeout(() => {
      for (const socket of io.of("/").sockets.values()) {
        if (socket.data.tokenHash !== fresh) socket.disconnect(true);
      }
    }, 200).unref?.();
    res.json({ token });
  });

  return router;
}
