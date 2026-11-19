// Identifiants oubliés. À lancer sur l'appareil qui fait tourner l'application (téléphone Termux,
// ordinateur ou serveur) : seul celui qui a accès à cet appareil peut s'en servir.
//   npm run acces                -> affiche la liste des comptes (identifiants)
//   npm run acces -- patron      -> donne un mot de passe provisoire au compte « patron »
// Le nouveau mot de passe doit être changé à la première connexion ; toutes les sessions de ce
// compte sont déconnectées, et l'opération est inscrite au journal d'audit.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { openDb, closeDb, all, get, run, tx, getSetting, setSetting, getDataDir } from "../src/db.js";
import { hashPassword, ROLE_LABELS } from "../src/auth.js";
import { audit } from "../src/audit.js";
import { now } from "../src/time.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"; // sans 0/O, 1/l/I
const newPassword = () => Array.from(crypto.randomBytes(10), (b) => ALPHABET[b % ALPHABET.length]).join("");

openDb();
try {
  const users = all("SELECT * FROM users ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'cashier' THEN 2 ELSE 3 END, full_name");
  const who = (process.argv[2] || "").trim().toLowerCase();
  if (!users.length) {
    const file = path.join(getDataDir(), "CODE-INSTALLATION.txt");
    const code = process.env.SETUP_CODE || getSetting("setup_code") || (fs.existsSync(file) ? fs.readFileSync(file, "utf8").match(/\d{6,}/)?.[0] : "");
    console.log("Aucun compte n'existe encore : il n'y a pas d'identifiant par défaut.");
    console.log("Ouvrez l'application : l'écran « Bienvenue » vous fait CHOISIR votre identifiant et votre mot de passe.");
    console.log(code ? `Code d'installation à saisir : ${code}` : "Le code d'installation s'affiche au démarrage de l'application.");
  } else if (!who) {
    console.log("Comptes existants (l'identifiant sert à se connecter) :\n");
    for (const u of users) console.log(`  ${u.username.padEnd(16)} ${u.full_name} — ${ROLE_LABELS[u.role]}${u.active ? "" : " (bloqué)"}`);
    console.log("\nPour donner un nouveau mot de passe provisoire à un compte, ajoutez son identifiant.");
    console.log("  Dans Termux :  maquis acces " + users[0].username);
    console.log("  Ailleurs    :  npm run acces -- " + users[0].username);
  } else {
    const u = users.find((x) => x.username.toLowerCase() === who);
    if (!u) {
      console.error(`❌ Aucun compte avec l'identifiant « ${who} ». Tapez la commande sans identifiant pour voir la liste.`);
      process.exitCode = 1;
    } else {
      const pw = newPassword();
      const hash = await hashPassword(pw);
      tx(() => {
        const t = now();
        run("UPDATE users SET password_hash = ?, must_change_password = 1, active = 1, updated_at = ? WHERE id = ?", hash, t, u.id);
        run("UPDATE sessions SET revoked_at = ?, revoked_reason = 'accès réinitialisé sur le serveur' WHERE user_id = ? AND revoked_at IS NULL", t, u.id);
        // Lève aussi le blocage anti-devinette après des essais ratés.
        setSetting("login_reset_at", t);
        audit({ user: null, device: "serveur (ligne de commande)" }, "acces_reinitialise", "user", u.id, `Mot de passe provisoire donné à ${u.full_name} (${u.username}) depuis le serveur`);
      });
      console.log(`\n✅ Compte : ${u.full_name} — ${ROLE_LABELS[u.role]}`);
      console.log(`   Identifiant           : ${u.username}`);
      console.log(`   Mot de passe provisoire : ${pw}`);
      console.log("\nConnectez-vous avec ces informations : l'application vous demandera aussitôt de choisir votre propre mot de passe.");
      if (!u.active) console.log("(Ce compte était bloqué : il a été réactivé.)");
    }
  }
} finally {
  closeDb();
}
