// Production des bilans dus, indépendamment du site web. À lancer par une tâche planifiée
// du serveur (cron), par exemple toutes les 10 minutes : si le site était endormi ou arrêté
// à 03 h 00, les bilans manquants sont produits ici (reprise automatique), jamais en double.
//   */10 * * * * cd /chemin/maquis-pro-manager && npm run rapports >> rapports.log 2>&1
import { openDb, closeDb } from "../src/db.js";
import { runDueReports } from "../src/reports.js";
import { backupIfDue } from "../src/backup.js";
import { fmtDateTime, now } from "../src/time.js";

openDb();
try {
  const done = runDueReports();
  for (const r of done) console.log(`[${fmtDateTime(now())}] ${r.doc_no} généré (${r.kind === "daily" ? "quotidien" : "hebdomadaire"}, version ${r.version}).`);
  const b = backupIfDue();
  if (b) console.log(`[${fmtDateTime(now())}] Sauvegarde ${b.name} créée.`);
} catch (e) {
  console.error(`[${fmtDateTime(now())}] Erreur :`, e);
  process.exitCode = 1;
} finally {
  // Laisse partir les notifications push éventuelles avant de fermer.
  setTimeout(() => closeDb(), 3000);
}
