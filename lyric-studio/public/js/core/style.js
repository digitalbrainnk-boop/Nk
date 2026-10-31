// Apparence d'une vidéo : valeurs par défaut, préréglages, polices et résolutions.
// Partagé par le navigateur (aperçu, export) et le serveur (création de projet).
// Les tailles sont en pixels « pour un petit côté de 1080 px » : elles suivent la résolution.

const W = (...w) => w;
export const FONTS = [
  // Modernes
  { name: "Montserrat", weights: W(400, 500, 600, 700, 800, 900), cat: "Modernes" },
  { name: "Poppins", weights: W(400, 500, 600, 700, 800, 900), cat: "Modernes" },
  { name: "Inter", weights: W(400, 500, 600, 700, 800, 900), cat: "Modernes" },
  { name: "Roboto", weights: W(400, 500, 700, 900), cat: "Modernes" },
  { name: "Open Sans", weights: W(400, 600, 700, 800), cat: "Modernes" },
  { name: "Lato", weights: W(400, 700, 900), cat: "Modernes" },
  { name: "Raleway", weights: W(400, 500, 600, 700, 800, 900), cat: "Modernes" },
  { name: "Nunito", weights: W(400, 600, 700, 800, 900), cat: "Modernes" },
  { name: "Rubik", weights: W(400, 500, 600, 700, 800, 900), cat: "Modernes" },
  { name: "Work Sans", weights: W(400, 500, 600, 700, 800, 900), cat: "Modernes" },
  { name: "Kanit", weights: W(400, 500, 600, 700, 800, 900), cat: "Modernes" },
  { name: "Quicksand", weights: W(400, 500, 600, 700), cat: "Modernes" },
  { name: "Josefin Sans", weights: W(400, 600, 700), cat: "Modernes" },
  { name: "Space Grotesk", weights: W(400, 500, 600, 700), cat: "Modernes" },
  { name: "Exo 2", weights: W(400, 600, 700, 800, 900), cat: "Modernes" },
  { name: "Comfortaa", weights: W(400, 600, 700), cat: "Modernes" },
  // Impact
  { name: "Bebas Neue", weights: W(400), cat: "Impact" },
  { name: "Anton", weights: W(400), cat: "Impact" },
  { name: "Oswald", weights: W(400, 500, 600, 700), cat: "Impact" },
  { name: "Archivo Black", weights: W(400), cat: "Impact" },
  { name: "Barlow Condensed", weights: W(400, 600, 700, 800, 900), cat: "Impact" },
  { name: "Teko", weights: W(400, 500, 600, 700), cat: "Impact" },
  { name: "Staatliches", weights: W(400), cat: "Impact" },
  { name: "Russo One", weights: W(400), cat: "Impact" },
  { name: "Alfa Slab One", weights: W(400), cat: "Impact" },
  { name: "Bowlby One SC", weights: W(400), cat: "Impact" },
  { name: "Black Ops One", weights: W(400), cat: "Impact" },
  // Fun et rétro
  { name: "Righteous", weights: W(400), cat: "Fun et rétro" },
  { name: "Bangers", weights: W(400), cat: "Fun et rétro" },
  { name: "Luckiest Guy", weights: W(400), cat: "Fun et rétro" },
  { name: "Titan One", weights: W(400), cat: "Fun et rétro" },
  { name: "Lilita One", weights: W(400), cat: "Fun et rétro" },
  { name: "Bungee", weights: W(400), cat: "Fun et rétro" },
  { name: "Fredoka", weights: W(400, 500, 600, 700), cat: "Fun et rétro" },
  { name: "Baloo 2", weights: W(400, 500, 600, 700, 800), cat: "Fun et rétro" },
  { name: "Audiowide", weights: W(400), cat: "Fun et rétro" },
  { name: "Orbitron", weights: W(400, 500, 600, 700, 800, 900), cat: "Fun et rétro" },
  { name: "Monoton", weights: W(400), cat: "Fun et rétro" },
  { name: "Press Start 2P", weights: W(400), cat: "Fun et rétro" },
  { name: "VT323", weights: W(400), cat: "Fun et rétro" },
  // Manuscrites
  { name: "Dancing Script", weights: W(400, 500, 600, 700), cat: "Manuscrites" },
  { name: "Pacifico", weights: W(400), cat: "Manuscrites" },
  { name: "Lobster", weights: W(400), cat: "Manuscrites" },
  { name: "Great Vibes", weights: W(400), cat: "Manuscrites" },
  { name: "Satisfy", weights: W(400), cat: "Manuscrites" },
  { name: "Caveat", weights: W(400, 500, 600, 700), cat: "Manuscrites" },
  { name: "Kaushan Script", weights: W(400), cat: "Manuscrites" },
  { name: "Sacramento", weights: W(400), cat: "Manuscrites" },
  { name: "Allura", weights: W(400), cat: "Manuscrites" },
  { name: "Parisienne", weights: W(400), cat: "Manuscrites" },
  { name: "Yellowtail", weights: W(400), cat: "Manuscrites" },
  { name: "Cookie", weights: W(400), cat: "Manuscrites" },
  { name: "Courgette", weights: W(400), cat: "Manuscrites" },
  { name: "Permanent Marker", weights: W(400), cat: "Manuscrites" },
  { name: "Rock Salt", weights: W(400), cat: "Manuscrites" },
  { name: "Shadows Into Light", weights: W(400), cat: "Manuscrites" },
  { name: "Indie Flower", weights: W(400), cat: "Manuscrites" },
  { name: "Amatic SC", weights: W(400, 700), cat: "Manuscrites" },
  // Élégantes
  { name: "Playfair Display", weights: W(400, 500, 600, 700, 800, 900), cat: "Élégantes" },
  { name: "Cinzel", weights: W(400, 500, 600, 700, 800, 900), cat: "Élégantes" },
  { name: "Cormorant Garamond", weights: W(400, 500, 600, 700), cat: "Élégantes" },
  { name: "Lora", weights: W(400, 500, 600, 700), cat: "Élégantes" },
  { name: "Merriweather", weights: W(400, 700, 900), cat: "Élégantes" },
  { name: "Abril Fatface", weights: W(400), cat: "Élégantes" },
  { name: "DM Serif Display", weights: W(400), cat: "Élégantes" },
  { name: "Prata", weights: W(400), cat: "Élégantes" },
  // Arabe
  { name: "Cairo", weights: W(400, 500, 600, 700, 800, 900), cat: "Arabe" },
  { name: "Tajawal", weights: W(400, 500, 700, 800, 900), cat: "Arabe" },
];
export const SYSTEM_FONTS = ["Arial", "Helvetica", "Verdana", "Trebuchet MS", "Georgia", "Times New Roman", "Impact", "Courier New"];

export const RESOLUTIONS = { "720p": 720, "1080p": 1080, "4K": 2160 };
export const RESOLUTION_ORDER = ["720p", "1080p", "4K"];
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
    font: {
      family: "Montserrat",
      weight: 800,
      italic: false,
      size: 64,
      transform: "none", // none, uppercase, lowercase, capitalize
      letterSpacing: 0,
      wordSpacing: 0,
      lineHeight: 1.3,
    },
    colors: {
      text: "#ffffff",
      textOpacity: 1,
      sung: "#ffd23f",
      sungGradient: false, // dégradé sur le texte chanté (sung -> sung2)
      sung2: "#ff4d8d",
      outline: "#000000",
      outlineWidth: 5,
      sungOutline: "", // contour du texte chanté (vide = même contour)
      shadow: "#000000",
      shadowBlur: 12,
      shadowOpacity: 0.6,
      shadowX: 0,
      shadowY: 2,
      glow: 0, // lueur autour du texte chanté (0 = aucune)
      glowColor: "", // vide = couleur du chanté
    },
    box: { enabled: false, color: "#000000", opacity: 0.45, padding: 18, radius: 14, full: false },
    highlight: "wipe", // wipe, word, line, bounce, scale, glow, underline, none
    pastLines: "sung", // sung, dim, text, hide
    futureOpacity: 0.9,
    layout: {
      display: "alternate", // single, alternate, page, scroll
      lines: 2,
      position: "bottom", // top, center, bottom, custom
      y: 0.78,
      x: 0, // décalage horizontal (-0,5 à 0,5)
      align: "center",
      margin: 0.07,
      maxWidth: 1,
      lineGap: 0.25,
      preRoll: 2.5,
      hold: 1.2,
      fadeIn: 0.3,
      fadeOut: 0.3,
      animation: "fade", // fade, slide-up, slide-down, slide-left, slide-right, zoom, drop, blur, typewriter, none
      animDuration: 0.45,
    },
    background: {
      type: "gradient", // color, gradient, image, video
      color: "#101018",
      gradient: ["#1d1b4b", "#7a1f5c", ""],
      gradientType: "linear", // linear, radial
      angle: 135,
      animate: false, // le dégradé tourne lentement
      media: null,
      fit: "cover",
      blur: 0,
      dim: 0.35,
      brightness: 1,
      saturation: 1,
      motion: true, // léger zoom lent sur une image
      motionSpeed: 1,
      vignette: 0.25,
      tint: "#000000",
      tintOpacity: 0,
    },
    effects: {
      particles: "none", // none, bokeh, snow, stars, sparkles, hearts, embers
      particleCount: 40,
      particleColor: "#ffffff",
      particleSize: 1,
      particleSpeed: 1,
      particleOpacity: 0.7,
      visualizer: "none", // none, bars, mirror, wave, circle
      vizColor: "#ffffff",
      vizColor2: "",
      vizOpacity: 0.55,
      vizHeight: 0.18,
      vizPosition: "bottom", // bottom, center, top
      vizBars: 48,
      beatZoom: 0, // l'image pulse avec les basses (0 à 0,1)
      progress: false,
      progressColor: "#ffd23f",
      progressHeight: 6,
      progressPosition: "bottom",
    },
    top: {
      enabled: false,
      media: null,
      kind: "image",
      size: 0.38,
      x: 0,
      y: 0.08,
      shape: "rounded", // rect, rounded, circle
      radius: 0.06,
      border: 0,
      borderColor: "#ffffff",
      shadow: 0.45,
      spin: 0, // tours par minute (effet vinyle)
      pulse: 0, // grossit avec les basses (0 à 0,2)
    },
    logo: { enabled: false, media: null, position: "top-right", size: 0.12, opacity: 0.85, margin: 0.03 },
    duo: {
      enabled: false,
      showNames: false,
      singers: [
        { name: "Chanteur 1", color: "#4fc3f7", align: "left" },
        { name: "Chanteur 2", color: "#ff6fae", align: "right" },
        { name: "Ensemble", color: "#ffd23f", align: "center" },
      ],
    },
    intro: {
      title: true,
      titleDuration: 4,
      titleSize: 1.35,
      titleColor: "",
      artistColor: "",
      countdown: true,
      countdownColor: "",
    },
    outro: { enabled: false, text: "Merci d'avoir regardé ❤", duration: 4, color: "" },
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
      font: { family: "Montserrat", weight: 800, transform: "none", italic: false },
      colors: { text: "#ffffff", sung: "#2fb6ff", outline: "#000000", outlineWidth: 6, glow: 0 },
      layout: { display: "alternate", lines: 2, position: "bottom", align: "center", animation: "fade" },
      background: { type: "color", color: "#000000" },
      effects: { particles: "none", visualizer: "none" },
    },
  },
  {
    id: "neon",
    name: "Néon",
    patch: {
      highlight: "glow",
      font: { family: "Righteous", weight: 400, transform: "uppercase", letterSpacing: 2 },
      colors: {
        text: "#e8e8ff",
        sung: "#ff3df2",
        outline: "#14002b",
        outlineWidth: 3,
        shadow: "#ff3df2",
        shadowBlur: 28,
        shadowOpacity: 0.9,
        glow: 24,
      },
      layout: { display: "single", lines: 1, position: "center", align: "center", animation: "zoom" },
      background: { type: "gradient", gradient: ["#09001f", "#2b0057", ""], angle: 160, vignette: 0.5 },
      effects: { particles: "sparkles", particleColor: "#ff9cf7", visualizer: "mirror", vizColor: "#ff3df2", vizOpacity: 0.35 },
    },
  },
  {
    id: "minimal",
    name: "Minimal",
    patch: {
      highlight: "word",
      pastLines: "dim",
      font: { family: "Inter", weight: 700, transform: "none", letterSpacing: 0 },
      colors: { text: "#9aa0a6", sung: "#ffffff", outlineWidth: 0, shadowBlur: 0, glow: 0 },
      layout: { display: "scroll", lines: 4, position: "center", align: "left", animation: "slide-up" },
      background: { type: "color", color: "#111111", vignette: 0 },
      effects: { particles: "none", visualizer: "none" },
    },
  },
  {
    id: "story",
    name: "Story 9:16",
    patch: {
      aspect: "9:16",
      highlight: "bounce",
      font: { family: "Poppins", weight: 800, transform: "uppercase", size: 70 },
      colors: { text: "#ffffff", sung: "#ffe600", outline: "#000000", outlineWidth: 6 },
      layout: { display: "single", lines: 1, position: "center", align: "center", animation: "zoom" },
      top: { enabled: true, size: 0.5, y: 0.1, shape: "rounded" },
      effects: { visualizer: "bars", vizColor: "#ffe600", vizOpacity: 0.4, progress: true, progressColor: "#ffe600" },
    },
  },
  {
    id: "romance",
    name: "Romance",
    patch: {
      highlight: "wipe",
      font: { family: "Dancing Script", weight: 700, transform: "none", size: 78 },
      colors: { text: "#fff5f8", sung: "#ff8fb1", outline: "#3b0a1e", outlineWidth: 3, shadowBlur: 18 },
      layout: { display: "alternate", lines: 2, position: "center", align: "center", animation: "fade" },
      background: { type: "gradient", gradient: ["#3b0a1e", "#c2416b", ""], angle: 120 },
      effects: { particles: "hearts", particleColor: "#ffb3c9", particleCount: 24, particleOpacity: 0.5 },
    },
  },
  {
    id: "cover",
    name: "Pochette",
    patch: {
      highlight: "wipe",
      font: { family: "Bebas Neue", weight: 400, transform: "uppercase", size: 84, letterSpacing: 1 },
      colors: { text: "#ffffff", sung: "#ffd23f", outline: "#000000", outlineWidth: 4 },
      layout: { display: "alternate", lines: 2, position: "bottom", align: "center", animation: "slide-up" },
      background: { blur: 28, dim: 0.5 },
      top: { enabled: true, size: 0.42, y: 0.08, shape: "rounded", pulse: 0.04 },
    },
  },
  {
    id: "gospel",
    name: "Gospel lumineux",
    patch: {
      highlight: "wipe",
      font: { family: "Playfair Display", weight: 800, transform: "none", italic: true, size: 70 },
      colors: {
        text: "#fffaf0",
        sung: "#ffcf5c",
        sungGradient: true,
        sung2: "#ffffff",
        outline: "#2b1b00",
        outlineWidth: 3,
        glow: 14,
        glowColor: "#ffcf5c",
      },
      layout: { display: "alternate", lines: 2, position: "center", align: "center", animation: "blur" },
      background: { type: "gradient", gradientType: "radial", gradient: ["#5c3b00", "#120a00", ""], vignette: 0.4 },
      effects: { particles: "bokeh", particleColor: "#ffd98a", particleCount: 30, particleOpacity: 0.35 },
    },
  },
  {
    id: "afro",
    name: "Afro vibes",
    patch: {
      highlight: "scale",
      font: { family: "Luckiest Guy", weight: 400, transform: "uppercase", size: 72, letterSpacing: 1, wordSpacing: 10 },
      colors: { text: "#ffffff", sung: "#00e0a4", outline: "#000000", outlineWidth: 6, shadowY: 6 },
      box: { enabled: false },
      layout: { display: "single", lines: 1, position: "bottom", align: "center", animation: "drop" },
      background: { type: "gradient", gradient: ["#ff7a00", "#d4006a", "#3a0ca3"], angle: 45, animate: true, vignette: 0.3 },
      effects: { visualizer: "bars", vizColor: "#ffffff", vizOpacity: 0.35, vizPosition: "bottom", beatZoom: 0.02 },
    },
  },
  {
    id: "bandeau",
    name: "Bandeau TV",
    patch: {
      highlight: "word",
      font: { family: "Roboto", weight: 700, transform: "none", size: 58 },
      colors: { text: "#ffffff", sung: "#ffd23f", outlineWidth: 0, shadowBlur: 0, glow: 0 },
      box: { enabled: true, color: "#000000", opacity: 0.6, padding: 20, radius: 0, full: true },
      layout: { display: "alternate", lines: 2, position: "bottom", align: "center", animation: "slide-left" },
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

/** Complète un style ancien ou partiel avec les valeurs par défaut (et convertit les anciens réglages). */
export function normalizeStyle(style) {
  const s = mergeStyle(defaultStyle(), style || {});
  if (s.font.uppercase === true && s.font.transform === "none") s.font.transform = "uppercase";
  delete s.font.uppercase;
  if (s.layout.animation === "slide") s.layout.animation = "slide-up";
  if (!Array.isArray(s.background.gradient)) s.background.gradient = defaultStyle().background.gradient;
  while (s.background.gradient.length < 3) s.background.gradient.push("");
  return s;
}

/** Style à enregistrer comme « mon style » : sans les fichiers propres au projet. */
export function shareableStyle(style) {
  const s = JSON.parse(JSON.stringify(style));
  s.background.media = null;
  if (s.background.type === "image" || s.background.type === "video") s.background.type = "gradient";
  s.top.media = null;
  s.top.enabled = false;
  s.logo.media = null;
  s.logo.enabled = false;
  s.customFonts = [];
  delete s.mode;
  delete s.guideVocals;
  return s;
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

/** Formules (modifiables par l'administrateur). */
export const DEFAULT_PLANS = {
  free: {
    name: "Gratuit",
    price: "0",
    period: "",
    maxProjects: 3,
    maxMinutes: 6,
    aiMinutes: 10,
    exportsPerMonth: 5,
    maxResolution: "720p",
    watermark: true,
    stems: false,
    suno: false,
    storageMb: 300,
    features: "Synchronisation automatique · Export 720p · Filigrane",
  },
  pro: {
    name: "Pro",
    price: "5 000 FCFA",
    period: "mois",
    maxProjects: 50,
    maxMinutes: 10,
    aiMinutes: 120,
    exportsPerMonth: 100,
    maxResolution: "1080p",
    watermark: false,
    stems: true,
    suno: false,
    storageMb: 5000,
    features: "Sans filigrane · Full HD 1080p · 2 h d'IA par mois · Tous les styles",
  },
  studio: {
    name: "Studio",
    price: "15 000 FCFA",
    period: "mois",
    maxProjects: 500,
    maxMinutes: 20,
    aiMinutes: 600,
    exportsPerMonth: 1000,
    maxResolution: "4K",
    watermark: false,
    stems: true,
    suno: true,
    storageMb: 20000,
    features: "Tout Pro · 4K · 10 h d'IA par mois · Gros volumes",
  },
};
