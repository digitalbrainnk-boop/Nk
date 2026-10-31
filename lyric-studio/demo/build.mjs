// Assemble la version de démonstration en une seule page HTML (tout le code et le style dedans).
// Usage : node demo/build.mjs <fichier de sortie>   (depuis le dossier lyric-studio)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2] || path.join(root, "demo", "dist", "africa-lyrics.html");

const demoPlugin = {
  name: "demo",
  setup(b) {
    // L'appel au serveur est remplacé par le serveur de démonstration qui tourne dans la page.
    b.onResolve({ filter: /\/api\.js$/ }, (args) =>
      args.importer.includes(`${path.sep}public${path.sep}js${path.sep}`) ? { path: path.join(root, "demo", "backend.js") } : undefined,
    );
    b.onResolve({ filter: /^\/vendor\/mp4-muxer\// }, () => ({
      path: path.join(root, "node_modules", "mp4-muxer", "build", "mp4-muxer.mjs"),
    }));
  },
};

const result = await build({
  entryPoints: [path.join(root, "demo", "main.js")],
  bundle: true,
  format: "iife",
  minify: true,
  target: "es2022",
  write: false,
  loader: { ".svg": "text" },
  plugins: [demoPlugin],
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const css =
  fs.readFileSync(path.join(root, "public", "css", "style.css"), "utf8") + fs.readFileSync(path.join(root, "demo", "demo.css"), "utf8");
const html = `<title>Africa Lyrics</title>
<meta name="description" content="Démonstration d'Africa Lyrics : vidéos lyriques et karaoké synchronisées mot par mot." />
<style>
${css}
</style>
<div id="app"><div class="loading full"><div class="spinner"></div></div></div>
<div id="toasts" aria-live="polite"></div>
<script>
${js}
</script>
`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`Démonstration : ${out} (${(html.length / 1024).toFixed(0)} Ko)`);
