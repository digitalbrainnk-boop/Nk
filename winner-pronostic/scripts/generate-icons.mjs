#!/usr/bin/env node
/**
 * Génère les icônes PNG de la PWA à partir de public/icon-source.svg
 * (rendu avec Chromium via Playwright) : npm run icons
 * Prérequis ponctuel : npx playwright install chromium (ou un Playwright global).
 */
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)("playwright"));
} catch {
  console.error("Playwright introuvable : installez-le avec « npm i -D playwright && npx playwright install chromium ».");
  process.exit(1);
}

const ROOT = path.resolve(import.meta.dirname, "..");
const svg = readFileSync(path.join(ROOT, "public/icon-source.svg"), "utf8");
const outDir = path.join(ROOT, "public/icons");
mkdirSync(outDir, { recursive: true });

const targets = [
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "icon-maskable-512.png", size: 512 },
  { file: "apple-touch-icon.png", size: 180 },
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const { file, size } of targets) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0;background:#0a0f1a">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`,
    );
    await page.screenshot({ path: path.join(outDir, file), omitBackground: false });
    console.log(`✓ public/icons/${file}`);
  }
} finally {
  await browser.close();
}
