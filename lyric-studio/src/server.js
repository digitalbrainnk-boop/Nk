// Démarrage : http://localhost:3500
// Le premier compte créé devient administrateur (ou celui de ADMIN_EMAIL).
import { createApp } from "./app.js";
import { hasFfmpeg } from "./ffmpeg.js";
import { hasDemucs } from "./stems.js";

const PORT = Number(process.env.PORT || 3500);
const HOST = process.env.HOST || "0.0.0.0";

const app = createApp();
app.listen(PORT, HOST, async () => {
  console.log(`🎤 Africa Lyrics : http://localhost:${PORT}`);
  console.log(`   ffmpeg : ${hasFfmpeg() ? "oui" : "non (facultatif)"} · Demucs : ${(await hasDemucs()) ? "oui" : "non (facultatif)"}`);
});
