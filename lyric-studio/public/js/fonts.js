// Chargement des polices : Google Fonts (liste du studio), polices de l'ordinateur, polices envoyées.
import { FONTS, SYSTEM_FONTS } from "./core/style.js";
import { mediaUrl } from "./api.js";

const links = new Map(); // famille -> promesse de chargement de la feuille de style
const custom = new Set();

function googleCss(font) {
  const fam = font.name.replace(/ /g, "+");
  const w = font.weights.length > 1 ? `:wght@${font.weights.join(";")}` : "";
  return `https://fonts.googleapis.com/css2?family=${fam}${w}&display=block`;
}

function loadStylesheet(href) {
  return new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = () => resolve(true);
    link.onerror = () => resolve(false);
    document.head.append(link);
  });
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);

/** S'assure que la police est prête avant de dessiner (sinon le texte s'affiche avec une autre police). */
export async function ensureFont(style, project) {
  const family = style.font.family;
  const weight = style.font.weight || 400;
  if (SYSTEM_FONTS.includes(family)) return true;
  const own = (style.customFonts || []).find((f) => f.family === family);
  if (own && !custom.has(family)) {
    try {
      const face = new FontFace(family, `url(${mediaUrl(project, own.file)})`);
      document.fonts.add(await face.load());
      custom.add(family);
    } catch {
      return false;
    }
  }
  const g = FONTS.find((f) => f.name === family);
  if (g && !links.has(family)) links.set(family, loadStylesheet(googleCss(g)));
  if (g) await withTimeout(links.get(family), 6000);
  try {
    await withTimeout(document.fonts.load(`${weight} 48px "${family}"`, "Aa"), 6000);
    return document.fonts.check(`${weight} 48px "${family}"`, "Aa");
  } catch {
    return false;
  }
}

/** Aperçu de toutes les polices dans la liste (chargées en une fois, légères). */
let previewLoaded = false;
export function loadFontPreviews() {
  if (previewLoaded) return;
  previewLoaded = true;
  const fams = FONTS.map((f) => `family=${f.name.replace(/ /g, "+")}`).join("&");
  loadStylesheet(`https://fonts.googleapis.com/css2?${fams}&display=swap&text=${encodeURIComponent("AaBbCc Paroles")}`);
}
