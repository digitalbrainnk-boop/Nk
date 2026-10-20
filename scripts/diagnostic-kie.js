// Diagnostic de la connexion Kie.ai (ne montre jamais la clé en entier).
// Utilisation dans Termux :  cd ~/Nk && node scripts/diagnostic-kie.js
import { getSettings, setSettings } from "../src/db.js";
import { discoverKie, kieKey, probeKie } from "../src/openai-compat.js";

const key = kieKey();
const s = getSettings();
console.log("\n=== Diagnostic Kie.ai ===");
console.log("Cerveau choisi :", s.brain);
if (!key) {
  console.log("❌ Aucune clé Kie enregistrée. Colle-la dans Réglages → Kie.ai puis Enregistrer.");
  process.exit(0);
}
console.log(`Clé enregistrée : ${key.slice(0, 4)}…${key.slice(-4)} (${key.length} caractères)`);
if (/\s/.test(key)) console.log("⚠️  La clé contient un espace ou un retour à la ligne : recolle-la.");

const show = (t) => String(t).replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "***").slice(0, 250);

async function call(url, init) {
  try {
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" } });
    return { status: res.status, body: show(await res.text()) };
  } catch (e) {
    return { status: "ERREUR", body: show(e.message) };
  }
}

console.log("\n1) Crédit du compte Kie");
const credit = await call("https://api.kie.ai/api/v1/chat/credit", { method: "GET" });
console.log(`   ${credit.status} → ${credit.body}`);

console.log("\n2) Documentation officielle de Kie (lue depuis ton téléphone)");
let docs = [];
try {
  const index = await (await fetch("https://docs.kie.ai/llms.txt", { signal: AbortSignal.timeout(15_000) })).text();
  const lines = index.split("\n").filter((l) => /deep\s*seek|chat models|chat\/completions/i.test(l));
  console.log(`   Index Kie : ${index.split("\n").length} lignes, ${lines.length} sur le chat / DeepSeek`);
  for (const l of lines.slice(0, 8)) console.log(`     | ${l.trim().slice(0, 100)}`);
} catch (e) {
  console.log(`   Index Kie illisible : ${e.message}`);
}
try {
  docs = await discoverKie({
    onPage: (page, md, hits) => {
      console.log(`   Page : ${page.replace("https://docs.kie.ai", "")} (${hits.length} pistes)`);
      // Lignes utiles de la page, pour pouvoir corriger à la main si besoin.
      const deep = /deepseek/i.test(page);
      // Pour DeepSeek on montre les chemins (/…:) et les valeurs possibles (- …) pour pouvoir le brancher.
      const lines = md
        .split("\n")
        .filter((l) =>
          deep
            ? /^\s*\/\S+:\s*$|^\s*-\s+['"]?[\w.\/-]+['"]?\s*$|url:|"model"|operationId/i.test(l)
            : /completions|"model"|operationId/i.test(l),
        );
      for (const l of lines.slice(0, deep ? 25 : 6)) console.log(`     | ${l.trim().slice(0, 90)}`);
    },
  });
  if (!docs.length) console.log("   (rien trouvé dans la documentation)");
  for (const d of docs.slice(0, 8)) console.log(`   • ${d.model}  →  ${d.url.replace("https://api.kie.ai", "")}`);
} catch (e) {
  console.log(`   Impossible de lire docs.kie.ai : ${e.message}`);
}

console.log("\n3) Recherche d'un cerveau qui répond");
const short = (t) => String(t).replace(/\s+/g, " ").slice(0, 70);
try {
  const found = await probeKie({
    onTry: (c, e) => console.log(`   ${e ? "❌" : "✅"} ${c.model} @ ${c.url.replace("https://api.kie.ai", "")}${e ? `  → ${short(show(e.message))}` : ""}`),
  });
  setSettings({ brain: "kie", kie_chat_model: found.model, kie_chat_url: found.url });
  console.log(`\n✅ Trouvé et enregistré : ${found.model}\n   Réponse : « ${short(found.text)} »\n   Relance l'agent avec : agent\n`);
} catch (e) {
  console.log(`\n❌ Aucun ne marche. Dernière erreur : ${short(show(e.message))}`);
  console.log("   Fais une capture de cet écran et envoie-la.\n");
}

console.log("\n4) Transcription des vocaux avec Kie");
try {
  const { discoverKieStt } = await import("../src/stt-kie.js");
  const stt = await discoverKieStt({ force: true });
  console.log(stt ? `   ✅ Modèle trouvé : ${stt.model} (champ « ${stt.audioKey} »)` : "   ❌ Aucun modèle de transcription trouvé dans la documentation Kie");
} catch (e) {
  console.log(`   ❌ ${e.message}`);
}
