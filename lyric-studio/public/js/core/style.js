// Apparence d'une vidéo : valeurs par défaut, préréglages, polices et résolutions.
// Partagé par le navigateur (aperçu, export) et le serveur (création de projet).
// Les tailles sont en pixels « pour un petit côté de 1080 px » : elles suivent la résolution.

export const FONTS = [
  { name: "Montserrat", weights: [400, 600, 700, 800, 900] },
  { name: "Poppins", weights: [400, 600, 700, 800, 900] },
  { name: "Bebas Neue", weights: [400] },
  { name: "Anton", weights: [400] },
  { name: "Oswald", weights: [400, 500, 600, 700] },
  { name: "Archivo Black", weights: [400] },
  { name: "Inter", weights: [400, 600, 700, 800, 900] },
  { name: "Roboto", weights: [400, 500, 700, 900] },
  { name: "Open Sans", weights: [400, 600, 700, 800] },
  { name: "Lato", weights: [400, 700, 900] },
  { name: "Raleway", weights: [400, 600, 700, 800, 900] },
  { name: "Nunito", weights: [400, 600, 700, 800, 900] },
  { name: "Kanit", weights: [400, 600, 700, 800, 900] },
  { name: "Fredoka", weights: [400, 500, 600, 700] },
  { name: "Baloo 2", weights: [400, 600, 700, 800] },
  { name: "Righteous", weights: [400] },
  { name: "Russo One", weights: [400] },
  { name: "Bangers", weights: [400] },
  { name: "Teko", weights: [400, 500, 600, 700] },
  { name: "Orbitron", weights: [400, 600, 700, 800, 900] },
  { name: "Permanent Marker", weights: [400] },
  { name: "Pacifico", weights: [400] },
  { name: "Lobster", weights: [400] },
  { name: "Dancing Script", weights: [400, 500, 600, 700] },
  { name: "Great Vibes", weights: [400] },
  { name: "Satisfy", weights: [400] },
  { name: "Caveat", weights: [400, 600, 700] },
  { name: "Playfair Display", weights: [400, 600, 700, 800, 900] },
  { name: "Abril Fatface", weights: [400] },
  { name: "Cinzel", weights: [400, 600, 700, 800, 900] },
  { name: "Comfortaa", weights: [400, 600, 700] },
  { name: "Monoton", weights: [400] },
  { name: "Press Start 2P", weights: [400] },
];
export const SYSTEM_FONTS = ["Arial", "Helvetica", "Verdana", "Trebuchet MS", "Georgia", "Times New Roman", "Impact", "Courier New"];

export const RESOLUTIONS = { "720p": 720, "1080p": 1080, "4K": 2160 };
export const ASPECTS = { "16:9": [16, 9], "9:16": [9, 16], "1:1": [1, 1], "4:5": [4, 5] };

/** Taille en pixels d'une vidéo (dimensions paires, petit côté = résolution). */
export function frameSize(aspect = "16:9", resolution = "1080p") {
  const short = RESOLUTIONS[resolution] || 1080;
  const [a, b] = ASPECTS[aspect] || ASPECTS["16:9"];
  const even = (n) => Math.round(n / 2) * 2;
  return a >= b ? { width: even((short * a) / b), height: short } : { width: short, height: even((short * b) / a) };
}

export function defaultStyle() {
  return {
    mode: "lyric", // lyric = voix gardée ; karaoke = voix retirée
    guideVocals: 0, // karaoké : volume de la voix d'origine gardée en fond (0 à 1)
    aspect: "16:9",
    font: { family: "Montserrat", weight: 800, size: 64, uppercase: false, letterSpacing: 0, lineHeight: 1.3 },
    colors: {
      text: "#ffffff",
      sung: "#ffd23f",
      outline: "#000000",
      outlineWidth: 5,
      shadow: "#000000",
      shadowBlur: 12,
      shadowOpacity: 0.6,
    },
    highlight: "wipe", // wipe = remplissage progressif ; word = mot par mot ; line = ligne entière ; none
    pastLines: "sung", // sung = restent colorées ; dim = s'estompent ; text = couleur normale
    layout: {
      display: "alternate", // alternate (karaoké), page, scroll (défilement), single
      lines: 2,
      position: "bottom", // top, center, bottom, custom
      y: 0.78,
      align: "center",
      margin: 0.07,
      preRoll: 2.5,
      hold: 1.2,
      animation: "fade", // fade, slide, zoom, none
    },
    background: {
      type: "gradient", // color, gradient, image, video
      color: "#101018",
      gradient: ["#1d1b4b", "#7a1f5c"],
      angle: 135,
      media: null,
      fit: "cover",
      blur: 0,
      dim: 0.35,
      motion: true, // léger zoom lent sur une image
    },
    top: {
      enabled: false,
      media: null,
      kind: "image",
      size: 0.38,
      y: 0.08,
      shape: "rounded", // rect, rounded, circle
      border: 0,
      borderColor: "#ffffff",
    },
    duo: {
      enabled: false,
      singers: [
        { name: "Chanteur 1", color: "#4fc3f7", align: "left" },
        { name: "Chanteur 2", color: "#ff6fae", align: "right" },
        { name: "Ensemble", color: "#ffd23f", align: "center" },
      ],
    },
    intro: { title: true, titleDuration: 4, countdown: true },
    customFonts: [],
  };
}

export const PRESETS = [
  {
    id: "karaoke",
    name: "Karaoké classique",
    patch: {
      mode: "karaoke",
      highlight: "wipe",
      pastLines: "sung",
      font: { family: "Montserrat", weight: 800, uppercase: false },
      colors: { text: "#ffffff", sung: "#2fb6ff", outline: "#000000", outlineWidth: 6 },
      layout: { display: "alternate", lines: 2, position: "bottom", align: "center", animation: "fade" },
      background: { type: "color", color: "#000000" },
    },
  },
  {
    id: "neon",
    name: "Néon",
    patch: {
      highlight: "wipe",
      font: { family: "Righteous", weight: 400, uppercase: true, letterSpacing: 2 },
      colors: {
        text: "#e8e8ff",
        sung: "#ff3df2",
        outline: "#14002b",
        outlineWidth: 3,
        shadow: "#ff3df2",
        shadowBlur: 28,
        shadowOpacity: 0.9,
      },
      layout: { display: "single", lines: 1, position: "center", align: "center", animation: "zoom" },
      background: { type: "gradient", gradient: ["#09001f", "#2b0057"], angle: 160 },
    },
  },
  {
    id: "minimal",
    name: "Minimal",
    patch: {
      highlight: "word",
      pastLines: "dim",
      font: { family: "Inter", weight: 700, uppercase: false, letterSpacing: 0 },
      colors: { text: "#9aa0a6", sung: "#ffffff", outlineWidth: 0, shadowBlur: 0 },
      layout: { display: "scroll", lines: 4, position: "center", align: "left", animation: "slide" },
      background: { type: "color", color: "#111111" },
    },
  },
  {
    id: "story",
    name: "Story 9:16",
    patch: {
      aspect: "9:16",
      highlight: "word",
      font: { family: "Poppins", weight: 800, uppercase: true, size: 70 },
      colors: { text: "#ffffff", sung: "#ffe600", outline: "#000000", outlineWidth: 6 },
      layout: { display: "single", lines: 1, position: "center", align: "center", animation: "zoom" },
      top: { enabled: true, size: 0.5, y: 0.1, shape: "rounded" },
    },
  },
  {
    id: "romance",
    name: "Romance",
    patch: {
      highlight: "wipe",
      font: { family: "Dancing Script", weight: 700, uppercase: false, size: 78 },
      colors: { text: "#fff5f8", sung: "#ff8fb1", outline: "#3b0a1e", outlineWidth: 3, shadowBlur: 18 },
      layout: { display: "alternate", lines: 2, position: "center", align: "center", animation: "fade" },
      background: { type: "gradient", gradient: ["#3b0a1e", "#c2416b"], angle: 120 },
    },
  },
  {
    id: "cover",
    name: "Pochette",
    patch: {
      highlight: "wipe",
      font: { family: "Bebas Neue", weight: 400, uppercase: true, size: 84, letterSpacing: 1 },
      colors: { text: "#ffffff", sung: "#ffd23f", outline: "#000000", outlineWidth: 4 },
      layout: { display: "alternate", lines: 2, position: "bottom", align: "center", animation: "slide" },
      background: { blur: 28, dim: 0.5 },
      top: { enabled: true, size: 0.42, y: 0.08, shape: "rounded" },
    },
  },
];

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

/** Fusion profonde : les tableaux et valeurs simples remplacent, les objets se fusionnent. */
export function mergeStyle(base, patch) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(patch || {})) out[k] = isObj(v) && isObj(base?.[k]) ? mergeStyle(base[k], v) : v;
  return out;
}

/** Complète un style ancien ou partiel avec les valeurs par défaut. */
export function normalizeStyle(style) {
  return mergeStyle(defaultStyle(), style || {});
}

export function getPath(obj, p) {
  return p.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath(obj, p, value) {
  const keys = p.split(".");
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)] = value;
}
