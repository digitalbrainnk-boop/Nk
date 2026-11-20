// Copie le client Socket.io dans public/vendor : la PWA (et l'app Capacitor,
// qui embarque public/) l'a ainsi en local, sans dépendre du serveur pour le charger.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "node_modules", "socket.io", "client-dist", "socket.io.min.js");
const dest = path.join(root, "public", "vendor", "socket.io.min.js");

if (!fs.existsSync(src)) {
  console.warn("[copy-vendor] socket.io client introuvable, étape ignorée.");
  process.exit(0);
}
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log("[copy-vendor] public/vendor/socket.io.min.js à jour");
