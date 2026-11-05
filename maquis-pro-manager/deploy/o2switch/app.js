// Fichier de démarrage pour o2switch (cPanel « Setup Node.js App », Phusion Passenger).
// Charge la configuration (.env à côté de ce fichier), puis démarre MAQUIS PRO MANAGER.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP = __dirname;
const envFile = path.join(APP, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
process.env.NODE_ENV = process.env.NODE_ENV || "production";
process.env.DATA_DIR = process.env.DATA_DIR || path.join(APP, "..", "maquis-donnees");

const [maj, min] = process.versions.node.split(".").map(Number);
if (maj < 22 || (maj === 22 && min < 16)) {
  console.error(`❌ Node ${process.versions.node} est trop ancien : choisissez Node 22.16 ou plus récent dans cPanel → Setup Node.js App.`);
}
process.on("uncaughtException", (e) => console.error("Erreur :", e));
process.on("unhandledRejection", (e) => console.error("Erreur :", e));
import(pathToFileURL(path.join(APP, "src", "server.js")).href).catch((e) => {
  console.error("❌ MAQUIS PRO MANAGER n'a pas pu démarrer :", e);
  process.exitCode = 1;
});
