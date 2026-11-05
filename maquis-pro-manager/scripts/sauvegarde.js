// Sauvegarde immédiate de la base (copie cohérente, vérifiée) dans DATA_DIR/sauvegardes.
import { openDb, closeDb } from "../src/db.js";
import { backupNow } from "../src/backup.js";

openDb();
try {
  const b = backupNow("manuelle (ligne de commande)");
  console.log(`✅ Sauvegarde créée : ${b.name} (${Math.round(b.size / 1024)} Ko)`);
} finally {
  closeDb();
}
