// Démarrage du studio : http://localhost:3500
// En local, pas de mot de passe. Ouvert au réseau (HOST=0.0.0.0, hébergement) : mot de passe obligatoire.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createApp } from "./app.js";
import { DATA_DIR } from "./store.js";
import { hasFfmpeg } from "./ffmpeg.js";
import { hasDemucs } from "./stems.js";

const PORT = Number(process.env.PORT || 3500);
const HOST = process.env.HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1");
const local = ["127.0.0.1", "localhost", "::1"].includes(HOST);

let password = (process.env.STUDIO_PASSWORD || "").trim();
if (!password && !local) {
  const file = path.join(DATA_DIR, "MOT-DE-PASSE.txt");
  password = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : crypto.randomBytes(9).toString("base64url");
  fs.writeFileSync(file, password, { mode: 0o600 });
  console.log(`Mot de passe du studio : ${password}  (changeable avec STUDIO_PASSWORD)`);
}

const app = createApp({ password });
app.listen(PORT, HOST, async () => {
  console.log(`🎤 Lyric Studio : http://${local ? "localhost" : HOST}:${PORT}`);
  console.log(`   ffmpeg : ${hasFfmpeg() ? "oui" : "non (facultatif)"} · Demucs : ${(await hasDemucs()) ? "oui" : "non (facultatif)"}`);
});
