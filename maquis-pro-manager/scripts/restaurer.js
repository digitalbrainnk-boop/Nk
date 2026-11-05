// Restauration d'une sauvegarde. Usage :
//   npm run restaurer                       -> liste les sauvegardes disponibles
//   npm run restaurer -- maquis-20261104-031000.db
//   npm run restaurer -- /chemin/vers/fichier.db
// La base actuelle est conservée dans sauvegardes/avant-restauration-*.db, puis la copie
// choisie est appliquée au prochain démarrage de l'application (redémarrez-la ensuite).
import fs from "node:fs";
import { openDb, closeDb } from "../src/db.js";
import { listBackups, backupPath, scheduleRestore } from "../src/backup.js";

openDb();
try {
  const arg = process.argv[2];
  if (!arg) {
    console.log("Sauvegardes disponibles (la plus récente en premier) :");
    for (const b of listBackups()) console.log(`  ${b.name}  (${Math.round(b.size / 1024)} Ko)`);
    console.log("\nPour restaurer : npm run restaurer -- <nom du fichier>");
  } else {
    const file = fs.existsSync(arg) ? arg : backupPath(arg);
    const check = scheduleRestore(file);
    console.log(`✅ Sauvegarde vérifiée (${check.users} compte(s)). Elle sera appliquée au prochain démarrage : redémarrez l'application.`);
  }
} catch (e) {
  console.error("❌", e.message);
  process.exitCode = 1;
} finally {
  closeDb();
}
