// Démarrage du serveur : « npm start » ou « node server.js ».
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";
import { createApp } from "./app.js";
import { ROOT_DIR, loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { SessionManager } from "./whatsapp/SessionManager.js";

// .env est lu depuis le dossier du projet, quel que soit le dossier de lancement.
dotenv.config({ path: path.join(ROOT_DIR, ".env"), quiet: true });

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

/** Adresses IPv4 du réseau local (peut échouer sur certains Android : on ignore). */
function lanAddresses() {
  try {
    return Object.values(os.networkInterfaces())
      .flat()
      .filter((i) => i && i.family === "IPv4" && !i.internal)
      .map((i) => i.address);
  } catch {
    return [];
  }
}

/** Ouvre une adresse dans le navigateur par défaut (Windows, Mac, Linux, Termux). */
function openInBrowser(url) {
  const termux = (process.env.PREFIX || "").includes("com.termux");
  let command;
  let args;
  let options = { stdio: "ignore", detached: true };
  if (termux) [command, args] = ["termux-open-url", [url]];
  else if (process.platform === "win32") {
    [command, args] = ["cmd", ["/c", `start "" "${url}"`]];
    options = { ...options, windowsVerbatimArguments: true };
  } else if (process.platform === "darwin") [command, args] = ["open", [url]];
  else [command, args] = ["xdg-open", [url]];
  try {
    const child = spawn(command, args, options);
    child.on("error", () => {});
    child.unref();
  } catch {
    // pas de navigateur disponible : le lien reste affiché dans le terminal
  }
}

// On charge les lignes, mais on ne les reconnecte qu'une fois le port obtenu :
// si l'application tourne déjà, cette 2e copie s'arrête sans couper les lignes de la 1re.
await manager.init({ resume: false });

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    logger.fatal(
      `Le port ${config.port} est déjà utilisé. L'application tourne peut-être déjà : ouvre http://localhost:${config.port} — sinon change PORT dans .env.`,
    );
  } else {
    logger.fatal({ err }, "Le serveur HTTP n'a pas pu démarrer");
  }
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  const { port } = server.address();
  manager.resumeLinked();

  const link = (host) => `http://${host}:${port}/#token=${encodeURIComponent(config.apiToken)}`;
  const lines = [
    "",
    "  ✅ Multi-Lignes est prêt.",
    "",
    "  Ouvre ce lien (connexion automatique, rien à recopier) :",
    `     ${link("localhost")}`,
  ];
  const lan = lanAddresses();
  if (lan.length) {
    lines.push("", "  Depuis un autre appareil du même Wi-Fi :");
    for (const ip of lan) lines.push(`     ${link(ip)}`);
  }
  lines.push(
    "",
    `  Jeton d'accès : ${config.apiToken}`,
    config.apiTokenFile ? `  (enregistré dans ${config.apiTokenFile})` : "  (défini par API_TOKEN dans .env)",
    "  Garde ce lien pour toi : il donne accès à toutes les lignes.",
    "  Laisse cette fenêtre ouverte ; Ctrl + C pour arrêter.",
    "",
  );
  console.log(lines.join("\n"));
  logger.info(`Serveur à l'écoute sur le port ${port}`);

  if (process.env.OPEN_BROWSER === "1") openInBrowser(link("localhost"));
});
