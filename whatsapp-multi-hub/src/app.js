// Assemble Express (API REST + fichiers de la PWA) et Socket.io sur un même serveur HTTP.
import http from "node:http";
import path from "node:path";
import express from "express";
import { Server as SocketServer } from "socket.io";
import { createAuth } from "./http/auth.js";
import { createLoginCodes } from "./http/loginCodes.js";
import { createMediaLinks } from "./http/mediaLinks.js";
import { authRouter, publicAuthRouter } from "./http/routes/auth.js";
import { notificationsRouter } from "./http/routes/notifications.js";
import { pushRouter } from "./http/routes/push.js";
import { sessionsRouter } from "./http/routes/sessions.js";
import { TermuxNotifier } from "./notify/termux.js";
import { PushService } from "./push.js";
import { attachRealtime } from "./realtime/socket.js";

/**
 * En-têtes de protection. La politique de contenu (CSP) n'autorise que les
 * scripts de l'application elle-même : un texte malveillant reçu sur WhatsApp
 * ne peut rien exécuter, et la page ne peut pas être intégrée par un autre site.
 */
function securityHeaders(req, res, next) {
  const host = req.get("host") || "";
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()",
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      `connect-src 'self' ws://${host} wss://${host}`,
      "font-src 'self'",
      "worker-src 'self'",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  });
  next();
}

function corsMiddleware(origins) {
  const allowAll = origins.includes("*");
  return (req, res, next) => {
    const origin = req.get("origin");
    if (origin && (allowAll || origins.includes(origin))) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
      res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
      res.set("Access-Control-Max-Age", "600");
    }
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  };
}

function errorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.type === "entity.parse.failed") {
      return res.status(400).json({ error: { code: "invalid_json", message: "Corps JSON invalide." } });
    }
    if (err.type === "entity.too.large") {
      return res.status(413).json({ error: { code: "payload_too_large", message: "Requête trop volumineuse." } });
    }
    const status = err.expose && err.status ? err.status : 500;
    if (status >= 500) logger.error({ err, method: req.method, path: req.path }, "Erreur serveur");
    res.status(status).json({
      error: {
        code: status >= 500 && !err.expose ? "internal_error" : err.code || "error",
        message: status >= 500 && !err.expose ? "Erreur interne du serveur." : err.message,
      },
    });
  };
}

export function createApp({ config, manager, logger, push: pushService, notifier: termuxNotifier }) {
  // Le jeton est relu à chaque requête : il peut être changé depuis l'application.
  const auth = createAuth({ getToken: () => config.apiToken, logger });
  const links = createMediaLinks(() => config.apiToken);
  const loginCodes = createLoginCodes();
  const push = pushService ?? new PushService({ dataDir: config.dataDir, contact: config.pushContact, logger });
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", config.trustProxy);
  app.use(securityHeaders);
  const server = http.createServer(app);
  // Notifications Android natives (Termux:API), avant les notifications Chrome.
  const notifier =
    termuxNotifier ?? new TermuxNotifier({ dataDir: config.dataDir, getPort: () => server.address()?.port ?? config.port, logger });
  const io = new SocketServer(server, {
    cors: { origin: config.corsOrigins.includes("*") ? true : config.corsOrigins },
    maxHttpBufferSize: 1e5,
  });

  // --- API -------------------------------------------------------------------
  const api = express.Router();
  api.use(corsMiddleware(config.corsOrigins));
  api.use(express.json({ limit: "64kb" }));
  api.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  api.get("/health", (req, res) => res.json({ ok: true }));
  api.use("/auth", publicAuthRouter({ config, auth, loginCodes }));
  api.use(auth.http);
  api.use("/auth", authRouter({ config, loginCodes, io, logger }));
  api.use("/push", pushRouter(push));
  api.use("/notifications", notificationsRouter({ notifier, push }));
  api.use("/sessions", sessionsRouter(manager, { links, config, notifier }));
  api.use((req, res) => res.status(404).json({ error: { code: "not_found", message: "Route inconnue." } }));
  api.use(errorHandler(logger));
  app.use("/api", api);

  // --- Médias (adresses signées, voir http/mediaLinks.js) ----------------------
  // Seuls les images, vidéos et sons s'affichent dans la page ; tout le reste est
  // téléchargé (un document HTML ou SVG reçu ne peut donc rien exécuter ici).
  const INLINE = /^(image\/(jpeg|png|webp|gif)|video\/|audio\/)/;
  app.get("/media/:sessionId/:chatId/:messageId", async (req, res) => {
    const { sessionId, chatId, messageId } = req.params;
    if (!links.verify(sessionId, chatId, messageId, req.query.exp, req.query.sig)) {
      return res.status(403).json({ error: { code: "invalid_link", message: "Lien expiré ou invalide : recharge la conversation." } });
    }
    const session = manager.find(sessionId);
    if (!session) return res.status(404).json({ error: { code: "session_not_found", message: "Ligne introuvable." } });
    try {
      const { file, message } = await session.ensureMedia(chatId, messageId);
      const mime = String(message.media?.mimetype || "").split(";")[0].trim().toLowerCase();
      res.set("Cache-Control", "private, max-age=86400");
      res.set("Content-Security-Policy", "sandbox; default-src 'none'; media-src 'self'; img-src 'self'");
      if (INLINE.test(mime)) {
        res.type(mime);
      } else {
        // attachment() déduit le type du nom de fichier : on impose ensuite un type neutre.
        res.attachment(message.media?.fileName || path.basename(file));
        res.type("application/octet-stream");
      }
      res.sendFile(file);
    } catch (err) {
      const status = err.expose ? err.status : 500;
      if (status >= 500) logger.error({ err }, "Média : erreur");
      res.status(status).json({ error: { code: err.code || "error", message: err.expose ? err.message : "Erreur interne du serveur." } });
    }
  });

  // --- PWA (fichiers statiques) ---------------------------------------------
  app.use(
    express.static(config.publicDir, {
      setHeaders(res, filePath) {
        const name = path.basename(filePath);
        if (name === "sw.js" || name === "index.html") res.set("Cache-Control", "no-cache");
        if (name === "manifest.json") res.type("application/manifest+json");
      },
    }),
  );

  attachRealtime(io, manager, { auth, logger, links });

  // Nouveau message reçu : notification Android (Termux), sinon notification Chrome.
  manager.on("message:new", ({ sessionId, chat, message, notify }) => {
    const session = manager.find(sessionId);
    if (!session) return;
    // Tu as répondu (depuis l'app ou le téléphone de la ligne) : la notification disparaît.
    if (message.fromMe) return void notifier.remove(sessionId, chat.id).catch(() => {});
    if (!notify) return;
    deliverNotification(session, chat, message).catch((err) => logger.warn({ err }, "Notification impossible"));
  });

  async function deliverNotification(session, chat, message) {
    if (notifier.active) {
      // Photo reçue : affichée dans la notification si elle arrive à temps.
      let imagePath;
      if (message.type === "image" && message.media && notifier.settings.preview) {
        imagePath = await Promise.race([
          session.ensureMedia(chat.id, message.id).then((r) => r.file),
          new Promise((resolve) => setTimeout(resolve, 6000).unref?.()),
        ]).catch(() => undefined);
      }
      if (await notifier.notifyMessage({ session, chat, message, imagePath })) return;
    }
    await push.notifyMessage({ session, chat, message });
  }

  return { app, server, io, loginCodes, push, notifier };
}
