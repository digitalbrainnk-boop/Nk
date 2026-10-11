// Cohérence des versions distribuables : application installable (manifeste, service worker),
// fichier unique hors ligne et application Android.
// Lancer depuis la racine du dépôt :  node --test dimensionnement/tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../app/moteur.js";

const racine = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = (f) => path.join(racine, "app", f);
const lire = (f) => readFileSync(f, "utf8");

test("manifeste de l'application installable : icônes présentes, affichage autonome", () => {
  const m = JSON.parse(lire(app("manifest.webmanifest")));
  assert.equal(m.display, "standalone");
  assert.equal(m.lang, "fr");
  assert.ok(m.icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable"));
  for (const icone of m.icons) assert.ok(existsSync(app(icone.src)), icone.src);
  assert.match(lire(app("index.html")), /<link rel="manifest" href="manifest.webmanifest">/);
});

test("service worker : tous les fichiers de l'application sont mis en cache pour le hors-connexion", () => {
  const sw = lire(app("sw.js"));
  const liste = [...sw.split("const FICHIERS = [")[1].split("];")[0].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  for (const f of liste) if (f !== "./") assert.ok(existsSync(app(f)), `fichier du cache absent : ${f}`);
  const attendus = ["index.html", "moteur.js", "app.js", "polices.css", "vendor/anthropic-sdk.js",
    ...readdirSync(app("polices")).filter((f) => f.endsWith(".woff2")).map((f) => `polices/${f}`),
    ...readdirSync(app("icones")).map((f) => `icones/${f}`)];
  for (const f of attendus) assert.ok(liste.includes(f), `fichier non mis en cache : ${f}`);
  assert.doesNotMatch(sw, /const VERSION = "dev"/, "lancer outils/construire.py pour versionner le cache");
});

test("polices embarquées : chaque fichier cité par polices.css existe (aucune dépendance à Google Fonts)", () => {
  const css = lire(app("polices.css"));
  const fichiers = [...css.matchAll(/url\((polices\/[^)]+)\)/g)].map((x) => x[1]);
  assert.ok(fichiers.length >= 16);
  for (const f of fichiers) assert.ok(existsSync(app(f)), f);
  assert.doesNotMatch(lire(app("index.html")), /fonts\.googleapis/);
});

test("fichier unique hors ligne : scripts, polices et SDK intégrés, même version que l'application", () => {
  const f = path.join(racine, "dist", "agent-dimensionnement-hors-ligne.html");
  assert.ok(existsSync(f), "lancer python3 dimensionnement/outils/construire.py");
  const page = lire(f);
  assert.doesNotMatch(page, /<script src=/);
  assert.doesNotMatch(page, /<link rel="(stylesheet|manifest)"/);
  assert.match(page, /data:font\/woff2;base64,/);
  assert.match(page, /AnthropicSDK/);
  assert.ok(page.includes(`const VERSION = "${globalThis.Moteur.VERSION}"`), "fichier unique à reconstruire");
});

test("application Android : APK présent, signé (v1 et v2), contenant l'application web", () => {
  const f = path.join(racine, "dist", "agent-dimensionnement.apk");
  assert.ok(existsSync(f), "lancer python3 dimensionnement/outils/construire.py --apk");
  const apk = readFileSync(f);
  assert.equal(apk.subarray(0, 4).toString("binary"), "PK\x03\x04");
  const texte = apk.toString("latin1");
  for (const entree of ["AndroidManifest.xml", "classes.dex", "resources.arsc", "assets/www/index.html", "assets/www/moteur.js",
    "assets/www/app.js", "META-INF/MANIFEST.MF"]) assert.ok(texte.includes(entree), entree);
  assert.ok(texte.includes("APK Sig Block 42"), "bloc de signature v2 absent");
});
