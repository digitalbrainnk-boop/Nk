// Démarrage : serveur web + tâches planifiées (bilans de 03 h 00, reprise après panne, sauvegardes).
import { createApp, setupCode } from "./app.js";
import { startScheduler } from "./reports.js";
import { getDataDir } from "./db.js";
import { TIMEZONE, businessDay } from "./time.js";

const app = createApp();
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, () => {
  console.log(`\n🍺 MAQUIS PRO MANAGER démarré sur le port ${port}`);
  console.log(`   Données : ${getDataDir()} — fuseau ${TIMEZONE} — journée commerciale ${businessDay()}`);
  const code = setupCode();
  if (code) console.log(`\n   👉 Première installation : ouvrez l'application et saisissez le code d'installation ${code}\n`);
});
startScheduler();

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.close(() => process.exit(0)));
