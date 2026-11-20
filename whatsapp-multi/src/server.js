// Point d'entrée : npm start
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { SessionManager } from "./whatsapp/SessionManager.js";

const config = loadConfig();
const logger = createLogger(config.logLevel);

process.on("unhandledRejection", (err) => {
  logger.error({ err }, "Promesse rejetée non gérée");
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Exception non gérée : arrêt (relance automatique conseillée via pm2/systemd)");
  try {
    shutdown(1);
  } catch {
    process.exit(1);
  }
});

const manager = new SessionManager({ config, logger });
const { server, io } = createApp({ config, manager, logger });

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  logger.info("Arrêt en cours : fermeture des lignes (les appareils restent reliés)…");
  try {
    manager.shutdown();
  } catch (err) {
    logger.error({ err }, "Erreur pendant l'arrêt des lignes");
  }
  io.close();
  server.close(() => process.exit(code));
  setTimeout(() => process.exit(code), 3000).unref();
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

await manager.init();

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") logger.fatal(`Le port ${config.port} est déjà utilisé : change PORT dans .env`);
  else logger.fatal({ err }, "Le serveur HTTP n'a pas pu démarrer");
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  const { port } = server.address();
  logger.info(`Serveur prêt : http://localhost:${port}`);
  if (config.apiTokenSource === "generated") {
    logger.warn(`Jeton d'accès généré (à coller dans l'application) : ${config.apiToken}`);
    logger.warn(`Il est enregistré dans ${config.apiTokenFile} — tu peux aussi fixer API_TOKEN dans .env`);
  } else if (config.apiTokenSource === "file") {
    logger.info(`Jeton d'accès : voir ${config.apiTokenFile}`);
  }
});
