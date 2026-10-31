// Fichier de démarrage de Africa Lyrics chez o2switch (cPanel « Setup Node.js App », Passenger).
// Charge la configuration (.env, à côté de ce fichier), garde un journal, puis démarre
// la version installée dans « actuelle » (avec ses propres dépendances).
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP = __dirname;

// Configuration : les variables saisies dans cPanel gardent la priorité sur le fichier .env.
const envFile = path.join(APP, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
process.env.NODE_ENV = "production";
process.env.DATA_DIR = process.env.DATA_DIR || path.join(APP, "donnees");

// Journal : consulté avec « studio journal » (remis à zéro au-delà de 5 Mo).
const logFile = path.join(APP, "journal.log");
try {
  if (fs.statSync(logFile).size > 5 * 1024 * 1024) fs.renameSync(logFile, path.join(APP, "journal.ancien.log"));
} catch {}
const log = fs.createWriteStream(logFile, { flags: "a" });
for (const stream of [process.stdout, process.stderr]) {
  const write = stream.write.bind(stream);
  stream.write = (chunk, ...rest) => {
    log.write(chunk);
    return write(chunk, ...rest);
  };
}
// Le module SQLite intégré à Node demande Node 22.13 ou plus récent.
const [maj, min] = process.versions.node.split(".").map(Number);
if (maj < 22 || (maj === 22 && min < 13)) {
  console.error(
    `❌ Node ${process.versions.node} est trop ancien : dans cPanel → Setup Node.js App, choisis Node 22 (la plus récente) ou plus.`,
  );
}
const version = (() => {
  try {
    return fs.readFileSync(path.join(APP, "actuelle", "VERSION"), "utf8").trim();
  } catch {
    return "?";
  }
})();
console.log(`\n[${new Date().toISOString()}] Démarrage de Africa Lyrics (${version})`);
// Le module SQLite de Node est signalé « expérimental » : avertissement sans conséquence, on le tait.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (w, ...rest) => {
  const type = typeof rest[0] === "string" ? rest[0] : rest[0]?.type;
  if (type === "ExperimentalWarning" || w?.name === "ExperimentalWarning") return;
  emitWarning(w, ...rest);
};
process.on("uncaughtException", (e) => console.error("Erreur :", e));
process.on("unhandledRejection", (e) => console.error("Erreur :", e));

import(pathToFileURL(path.join(APP, "actuelle", "src", "server.js")).href).catch((e) => {
  console.error("❌ Africa Lyrics n'a pas pu démarrer :", e);
  process.exitCode = 1;
});
