// Fichier de démarrage de DB.Mélo chez o2switch (cPanel « Setup Node.js App », Passenger).
// Charge la configuration (.env, à côté de ce fichier), garde un journal, puis démarre la version
// installée dans « actuelle » (paquet autonome Next.js, avec ses propres dépendances).
"use strict";
const fs = require("node:fs");
const path = require("node:path");

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
process.env.NEXT_TELEMETRY_DISABLED = "1";
// Next.js écoute sur HOSTNAME, que le serveur définit souvent comme son propre nom de machine.
process.env.HOSTNAME = "127.0.0.1";
process.env.PORT = process.env.PORT || "3000";

// Journal : consulté avec « dbmelo-journal » (remis à zéro au-delà de 5 Mo).
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
console.log(`\n[${new Date().toISOString()}] Démarrage de DB.Mélo (${fs.readFileSync(path.join(APP, "actuelle", "VERSION"), "utf8").trim()})`);

require(path.join(APP, "actuelle", "server.js"));
