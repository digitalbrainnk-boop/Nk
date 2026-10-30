// Séparation voix / instrumental sur l'ordinateur avec Demucs (gratuit, la meilleure qualité),
// s'il est installé : pip install demucs. Sinon : Suno (Kie.ai) pour les chansons Suno,
// ou le retrait du centre fait par le navigateur.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

// DEMUCS_CMD peut être « demucs » ou « python3 -m demucs » (par défaut : python3 -m demucs).
const CMD = (process.env.DEMUCS_CMD || "python3 -m demucs").split(/\s+/).filter(Boolean);

let check = null;
/** Demucs est-il installé ? (vérifié une fois, sans bloquer le serveur) */
export function hasDemucs() {
  check ??= new Promise((resolve) => {
    const p = spawn(CMD[0], [...CMD.slice(1), "--help"], { stdio: "ignore" });
    const timer = setTimeout(() => (p.kill(), resolve(false)), 60_000);
    p.on("error", () => (clearTimeout(timer), resolve(false)));
    p.on("close", (code) => (clearTimeout(timer), resolve(code === 0)));
  });
  return check;
}

/**
 * Sépare file en voix + instrumental (fichiers WAV dans outDir).
 * @returns { vocals, instrumental } chemins absolus
 */
export function separateWithDemucs(file, outDir, { onProgress, signal, model = process.env.DEMUCS_MODEL || "htdemucs" } = {}) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(outDir, { recursive: true });
    const args = [...CMD.slice(1), "--two-stems=vocals", "-n", model, "-o", outDir, "--filename", "{stem}.{ext}", file];
    const p = spawn(CMD[0], args, { stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const onData = (d) => {
      const s = d.toString();
      tail = (tail + s).slice(-3000);
      // Barre de progression de Demucs : « 45%|████ »
      const all = [...s.matchAll(/(\d{1,3})%\|/g)];
      if (all.length) onProgress?.(Math.min(1, Number(all.at(-1)[1]) / 100));
    };
    p.stdout.on("data", onData);
    p.stderr.on("data", onData);
    const abort = () => p.kill("SIGKILL");
    signal?.addEventListener("abort", abort);
    p.on("error", reject);
    p.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      const dir = path.join(outDir, model);
      const vocals = path.join(dir, "vocals.wav");
      const instrumental = path.join(dir, "no_vocals.wav");
      if (code === 0 && fs.existsSync(vocals) && fs.existsSync(instrumental)) resolve({ vocals, instrumental });
      else reject(new Error(`Demucs a échoué : ${tail.split("\n").filter(Boolean).slice(-2).join(" ")}`));
    });
  });
}
