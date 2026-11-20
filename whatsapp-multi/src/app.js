// Assemble Express (API REST + fichiers de la PWA) et Socket.io sur un même serveur HTTP.
import http from "node:http";
import path from "node:path";
import express from "express";
import { Server as SocketServer } from "socket.io";
import { createAuth } from "./http/auth.js";
import { sessionsRouter } from "./http/routes/sessions.js";
import { attachRealtime } from "./realtime/socket.js";

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

export function createApp({ config, manager, logger }) {
  const auth = createAuth({ token: config.apiToken, logger });
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", config.trustProxy);

  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "no-referrer");
    next();
  });

  // --- API -------------------------------------------------------------------
  const api = express.Router();
  api.use(corsMiddleware(config.corsOrigins));
  api.use(express.json({ limit: "64kb" }));
  api.get("/health", (req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()), sessions: manager.sessions.size }));
  api.use(auth.http);
  api.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  api.use("/sessions", sessionsRouter(manager));
  api.use((req, res) => res.status(404).json({ error: { code: "not_found", message: "Route inconnue." } }));
  api.use(errorHandler(logger));
  app.use("/api", api);

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

  const server = http.createServer(app);
  const io = new SocketServer(server, {
    cors: { origin: config.corsOrigins.includes("*") ? true : config.corsOrigins },
    maxHttpBufferSize: 1e5,
  });
  attachRealtime(io, manager, { auth, logger });

  return { app, server, io };
}
