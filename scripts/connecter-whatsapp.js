// Connexion WhatsApp par code, directement dans Termux (sans passer par la page).
// Utilisation :  arrête d'abord l'agent (CTRL + c), puis :
//   cd ~/Nk && npm run whatsapp
import path from "node:path";
import fs from "node:fs";
import readline from "node:readline/promises";
import pino from "pino";
import { Browsers, DisconnectReason, fetchLatestBaileysVersion, makeWASocket, useMultiFileAuthState } from "baileys";
import { DATA_DIR, setSettings } from "../src/db.js";

const AUTH_DIR = path.join(DATA_DIR, "wa-auth");
const port = Number(process.env.PORT || 3000);

// L'agent ne doit pas tourner en même temps (deux connexions se gêneraient).
const running = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
if (running) {
  console.log("\n⚠️  L'agent est en marche. Arrête-le d'abord (CTRL + c dans sa fenêtre), puis relance : npm run whatsapp\n");
  process.exit(1);
}

function readCreds() {
  try {
    return JSON.parse(fs.readFileSync(path.join(AUTH_DIR, "creds.json"), "utf8"));
  } catch {
    return null;
  }
}
if (readCreds()?.registered) {
  // Un numéro est déjà connecté : on propose de le remplacer (ex. passer sur WhatsApp Business).
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = (await rl.question("\n✅ Un WhatsApp est déjà connecté à l'agent. Le remplacer par un autre numéro (ex. ton WhatsApp Business) ? (o/n) : ")).trim().toLowerCase();
  rl.close();
  if (!ans.startsWith("o")) {
    console.log("\nRien n'a changé. Lance simplement : agent\n");
    process.exit(0);
  }
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  console.log("Ancienne connexion effacée. Pense à supprimer l'ancien appareil dans WhatsApp → Appareils connectés.");
}

let phone = (process.argv[2] || "").replace(/\D/g, "");
if (!phone) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  phone = (await rl.question("\nLe numéro à connecter (ton WhatsApp Business si c'est lui qui doit répondre), AVEC l'indicatif du pays, sans + ni espaces\n(ex. Burkina : 226XXXXXXXX, Côte d'Ivoire : 225XXXXXXXXXX) : ")).replace(/\D/g, "");
  rl.close();
}
phone = phone.replace(/^0+/, "");
if (phone.length < 10 || phone.length > 15) {
  console.log("\n❌ Numéro incomplet : il faut l'indicatif du pays au début (ex. 226 pour le Burkina, 225 pour la Côte d'Ivoire).\n");
  process.exit(1);
}

fs.rmSync(AUTH_DIR, { recursive: true, force: true }); // repart d'une session propre
setSettings({ wa_browser: "chrome", whatsapp_enabled: true });
const logger = pino({ level: "silent" });
const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
let asked = false;
let done = false;

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const sock = makeWASocket({ version, auth: state, logger, browser: Browsers.macOS("Chrome"), markOnlineOnConnect: false });
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", async (u) => {
    if (u.qr && !asked && !state.creds.registered) {
      asked = true;
      try {
        const code = (await sock.requestPairingCode(phone)).match(/.{1,4}/g).join("-");
        console.log("\n==============================");
        console.log(`   CODE WHATSAPP :  ${code}`);
        console.log("==============================");
        console.log("Sur ton téléphone, dans l'application de CE numéro (WhatsApp Business si c'est ton numéro pro) :");
        console.log("  ⋮ (ou Réglages) → Appareils connectés → Connecter un appareil");
        console.log("  → en bas : « Associer avec le numéro de téléphone à la place »");
        console.log("  → tape le code ci-dessus. (Tu peux aussi toucher la notification WhatsApp.)");
        console.log("Le code expire vite : s'il ne marche pas, relance npm run whatsapp.\n");
      } catch (e) {
        console.log(`\n❌ WhatsApp a refusé de donner un code : ${e.message}\n   Vérifie le numéro et ta connexion internet, puis réessaie.\n`);
        process.exit(1);
      }
    }
    if (u.connection === "open") {
      done = true;
      console.log("\n✅ WhatsApp est connecté à ton agent ! Patiente 5 secondes…");
      setTimeout(() => {
        console.log("Tu peux maintenant lancer l'agent : tape  agent\n");
        process.exit(0);
      }, 5000);
    }
    if (u.connection === "close" && !done) {
      const code = u.lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.restartRequired || (asked && code !== DisconnectReason.loggedOut)) {
        connect(); // normal juste après la saisie du code
      } else {
        const msg = u.lastDisconnect?.error?.message || code;
        const net = /ENOTFOUND|ECONN|ETIMEDOUT|network/i.test(String(msg));
        const hint =
          code === 405 || code === 403
            ? " WhatsApp refuse pour le moment : trop d'essais d'affilée, ou déjà 4 appareils connectés. Supprime un ancien appareil dans « Appareils connectés » et attends 15 à 30 minutes."
            : net
              ? " Vérifie ta connexion internet (données ou Wi-Fi)."
              : "";
        console.log(`\n❌ Connexion fermée (${msg}).${hint} Réessaie : npm run whatsapp\n`);
        process.exit(1);
      }
    }
  });
}

console.log("\nConnexion à WhatsApp…");
await connect();
setTimeout(() => {
  if (!done) {
    console.log("\n⌛ Délai dépassé (5 min). Relance : npm run whatsapp\n");
    process.exit(1);
  }
}, 5 * 60_000);
