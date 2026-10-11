// Diagnostic de la connexion Kie.ai (ne montre jamais la clé en entier).
// Utilisation dans Termux :  cd ~/Nk && node scripts/diagnostic-kie.js
import { getSettings, setSettings } from "../src/db.js";
import { kieCandidates, kieKey } from "../src/openai-compat.js";

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

console.log("\n2) Cerveau (chat DeepSeek)");
let found = null;
for (const c of kieCandidates()) {
  const r = await call(c.url, {
    method: "POST",
    body: JSON.stringify({ model: c.model, messages: [{ role: "user", content: "Dis bonjour." }], max_tokens: 50 }),
  });
  const ok = r.status === 200 && /"choices"/.test(r.body);
  console.log(`   ${ok ? "✅" : "❌"} ${c.url}  (modèle ${c.model})\n      ${r.status} → ${r.body}`);
  if (ok) {
    found = c;
    break;
  }
}
if (found) {
  setSettings({ brain: "kie", kie_chat_model: found.model, kie_chat_url: found.url });
  console.log(`\n✅ Connexion trouvée et enregistrée. Relance l'agent avec : agent`);
} else {
  console.log("\n❌ Aucune adresse n'a marché. Fais une capture de cet écran et envoie-la.");
}
