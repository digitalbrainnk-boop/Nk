// Panneau de style : chaque réglage de la vidéo, rangé par section, avec une remise à zéro par section,
// les préréglages et « Mes styles » (styles enregistrés par l'utilisateur, réutilisables dans tous ses projets).
// Chaque réglage est une ligne du schéma ci-dessous (chemin dans le style, type, bornes).
import { h, toast, modal, confirmBox } from "./ui.js";
import { api, upload } from "./api.js";
import {
  FONTS,
  SYSTEM_FONTS,
  PRESETS,
  GRAPHICS,
  BLENDS,
  getPath,
  setPath,
  mergeStyle,
  defaultStyle,
  shareableStyle,
  normalizeStyle,
  newLayer,
} from "./core/style.js";
import { loadFontPreviews } from "./fonts.js";

const pct = (v) => `${Math.round(v * 100)} %`;
const px = (v) => `${v} px`;
const sec = (v) => `${Number(v).toFixed(2)} s`;
const num = (d) => (v) => Number(v).toFixed(d);

// Petits raccourcis pour écrire le schéma.
const R = (path, label, min, max, step, fmt, extra = {}) => ({ path, type: "range", label, min, max, step, fmt, ...extra });
const C = (path, label, extra = {}) => ({ path, type: "color", label, ...extra });
const T = (path, label, extra = {}) => ({ path, type: "toggle", label, ...extra });
const S = (path, label, options, extra = {}) => ({ path, type: "select", label, options, ...extra });
const G = (path, label, options, extra = {}) => ({ path, type: "seg", label, options, ...extra });

const media = (s) => ["image", "video"].includes(s.background.type);
const SECTIONS = [
  {
    title: "Format et mode",
    open: true,
    controls: [
      G("mode", "Type de vidéo", [
        ["lyric", "🎤 Lyrique (avec voix)"],
        ["karaoke", "🎶 Karaoké (sans voix)"],
      ]),
      R("guideVocals", "Voix guide", 0, 0.6, 0.05, pct, {
        show: (s) => s.mode === "karaoke",
        hint: "Garde un peu de la voix d'origine pour aider à chanter.",
      }),
      G(
        "aspect",
        "Format",
        [
          ["16:9", "16:9"],
          ["9:16", "9:16"],
          ["1:1", "1:1"],
          ["4:5", "4:5"],
        ],
        {
          hint: "16:9 YouTube · 9:16 TikTok, Reels, Statut · 1:1 et 4:5 Facebook, Instagram",
        },
      ),
    ],
  },
  {
    title: "Fond (couleur, image ou vidéo)",
    open: true,
    controls: [
      G("background.type", "Type", [
        ["color", "Couleur"],
        ["gradient", "Dégradé"],
        ["image", "Image"],
        ["video", "Vidéo"],
      ]),
      C("background.color", "Couleur", { show: (s) => s.background.type === "color" }),
      C("background.gradient.0", "Couleur 1", { show: (s) => s.background.type === "gradient" }),
      C("background.gradient.1", "Couleur 2", { show: (s) => s.background.type === "gradient" }),
      C("background.gradient.2", "Couleur 3 (facultative)", {
        auto: true,
        autoLabel: "Aucune",
        show: (s) => s.background.type === "gradient",
      }),
      G(
        "background.gradientType",
        "Forme",
        [
          ["linear", "Linéaire"],
          ["radial", "Circulaire"],
        ],
        { show: (s) => s.background.type === "gradient" },
      ),
      R("background.angle", "Angle", 0, 360, 5, (v) => `${v}°`, {
        show: (s) => s.background.type === "gradient" && s.background.gradientType !== "radial",
      }),
      T("background.animate", "Dégradé qui tourne lentement", {
        show: (s) => s.background.type === "gradient" && s.background.gradientType !== "radial",
      }),
      { path: "background.media", type: "asset", label: "Image ou vidéo de fond", target: "background" },
      G(
        "background.fit",
        "Cadrage",
        [
          ["cover", "Remplir"],
          ["contain", "Entier"],
        ],
        { show: media },
      ),
      R("background.blur", "Flou", 0, 80, 1, px, { show: media }),
      R("background.brightness", "Luminosité", 0.2, 2, 0.05, pct, { show: media }),
      R("background.saturation", "Saturation", 0, 2, 0.05, pct, { show: media }),
      T("background.motion", "Zoom lent (image)", { show: (s) => s.background.type === "image" }),
      R("background.motionSpeed", "Vitesse du zoom", 0.2, 5, 0.1, num(1), {
        show: (s) => s.background.type === "image" && s.background.motion,
      }),
      R("background.dim", "Assombrir", 0, 0.95, 0.05, pct, { show: (s) => s.background.type !== "color" }),
      C("background.tint", "Teinte de couleur"),
      R("background.tintOpacity", "Force de la teinte", 0, 1, 0.05, pct),
      R("background.vignette", "Bords assombris (vignette)", 0, 1, 0.05, pct),
    ],
  },
  { title: "Calques et superpositions", open: true, custom: "layers", controls: [] },
  {
    title: "Position des paroles",
    open: true,
    controls: [
      {
        path: "layout.position",
        type: "grid9",
        label: "Placer les paroles",
        hint: "Ou attrape les paroles directement sur l'aperçu et pose-les où tu veux.",
      },
      R("layout.rotate", "Rotation du texte", -180, 180, 1, (v) => `${v}°`),
      {
        path: "layout.rotate",
        type: "buttons",
        label: "",
        buttons: [
          ["⟲ Vertical à gauche", (ins) => ins.placeText(-1, 0, -90)],
          ["Horizontal", (ins) => ins.placeText(0, 1, 0)],
          ["⟳ Vertical à droite", (ins) => ins.placeText(1, 0, 90)],
        ],
      },
      S("layout.display", "Affichage", [
        ["single", "Une ligne à la fois"],
        ["alternate", "Alterné (karaoké classique)"],
        ["page", "Par page"],
        ["scroll", "Défilement"],
      ]),
      R("layout.lines", "Lignes à l'écran", 1, 6, 1, String, { show: (s) => s.layout.display !== "single" }),
      G("layout.position", "Position", [
        ["top", "Haut"],
        ["center", "Centre"],
        ["bottom", "Bas"],
        ["custom", "Libre"],
      ]),
      R("layout.y", "Hauteur", 0.02, 0.98, 0.01, pct, { show: (s) => s.layout.position === "custom" }),
      R("layout.x", "Décalage gauche / droite", -0.5, 0.5, 0.01, pct),
      G(
        "layout.align",
        "Alignement",
        [
          ["left", "Gauche"],
          ["center", "Centré"],
          ["right", "Droite"],
        ],
        { hint: "En duo, chaque chanteur a son alignement." },
      ),
      R("layout.margin", "Marges", 0, 0.3, 0.01, pct),
      R("layout.maxWidth", "Largeur maximale du texte", 0.3, 1, 0.01, pct),
      R("layout.lineGap", "Espace entre les lignes", 0, 2, 0.05, num(2)),
    ],
  },
  {
    title: "Police et écriture",
    open: false,
    controls: [
      { path: "font.family", type: "font", label: "Police" },
      S(
        "font.weight",
        "Épaisseur",
        [
          [300, "Fine"],
          [400, "Normale"],
          [500, "Moyenne"],
          [600, "Semi-grasse"],
          [700, "Grasse"],
          [800, "Très grasse"],
          [900, "Noire"],
        ],
        { num: true },
      ),
      T("font.italic", "Italique"),
      R("font.size", "Taille", 12, 300, 1, px),
      G("font.transform", "Casse", [
        ["none", "Normale"],
        ["uppercase", "MAJUSCULES"],
        ["lowercase", "minuscules"],
        ["capitalize", "Initiales"],
      ]),
      R("font.letterSpacing", "Espace entre les lettres", -6, 30, 0.5, px),
      R("font.wordSpacing", "Espace entre les mots", -10, 60, 1, px),
      R("font.lineHeight", "Interligne", 0.8, 2.4, 0.05, num(2)),
    ],
  },
  {
    title: "Couleurs du texte",
    open: false,
    controls: [
      C("colors.text", "Texte à chanter"),
      R("colors.textOpacity", "Opacité du texte à chanter", 0.1, 1, 0.05, pct),
      C("colors.sung", "Texte chanté", { show: (s) => !s.duo?.enabled, hint: "En mode duo : couleur de chaque chanteur (section Duo)." }),
      T("colors.sungGradient", "Dégradé sur le texte chanté", { show: (s) => !s.duo?.enabled }),
      C("colors.sung2", "2ᵉ couleur du dégradé", { show: (s) => s.colors.sungGradient && !s.duo?.enabled }),
      S("pastLines", "Lignes déjà chantées", [
        ["sung", "Restent colorées"],
        ["dim", "S'estompent"],
        ["text", "Reprennent la couleur du texte"],
        ["hide", "Disparaissent"],
      ]),
      R("futureOpacity", "Opacité des lignes à venir", 0.1, 1, 0.05, pct),
    ],
  },
  {
    title: "Effet de chant",
    open: false,
    controls: [
      S("highlight", "Effet", [
        ["wipe", "Remplissage progressif (karaoké)"],
        ["word", "Mot par mot"],
        ["bounce", "Mot qui saute"],
        ["scale", "Mot qui grossit"],
        ["glow", "Mot qui brille"],
        ["underline", "Soulignement"],
        ["line", "Ligne entière"],
        ["none", "Aucun (texte fixe)"],
      ]),
      R("colors.glow", "Lueur du texte chanté", 0, 60, 1, px),
      C("colors.glowColor", "Couleur de la lueur", { auto: true, show: (s) => s.colors.glow > 0 || s.highlight === "glow" }),
    ],
  },
  {
    title: "Contour et ombre",
    open: false,
    controls: [
      C("colors.outline", "Contour"),
      R("colors.outlineWidth", "Épaisseur du contour", 0, 20, 0.5, px),
      C("colors.sungOutline", "Contour du texte chanté", { auto: true, show: (s) => s.colors.outlineWidth > 0 }),
      C("colors.shadow", "Ombre"),
      R("colors.shadowBlur", "Flou de l'ombre", 0, 80, 1, px),
      R("colors.shadowOpacity", "Force de l'ombre", 0, 1, 0.05, pct),
      R("colors.shadowX", "Décalage horizontal", -30, 30, 1, px),
      R("colors.shadowY", "Décalage vertical", -30, 30, 1, px),
    ],
  },
  {
    title: "Bandeau derrière le texte",
    open: false,
    controls: [
      T("box.enabled", "Afficher un bandeau"),
      T("box.full", "Toute la largeur", { show: (s) => s.box.enabled }),
      C("box.color", "Couleur", { show: (s) => s.box.enabled }),
      R("box.opacity", "Opacité", 0, 1, 0.05, pct, { show: (s) => s.box.enabled }),
      R("box.padding", "Marge intérieure", 0, 80, 1, px, { show: (s) => s.box.enabled }),
      R("box.radius", "Arrondi", 0, 60, 1, px, { show: (s) => s.box.enabled }),
    ],
  },
  {
    title: "Animation et timing",
    open: false,
    controls: [
      S("layout.animation", "Apparition des lignes", [
        ["fade", "Fondu"],
        ["slide-up", "Glisse vers le haut"],
        ["slide-down", "Glisse vers le bas"],
        ["slide-left", "Arrive de la droite"],
        ["slide-right", "Arrive de la gauche"],
        ["zoom", "Zoom"],
        ["drop", "Tombe et rebondit"],
        ["blur", "Sort du flou"],
        ["typewriter", "Machine à écrire"],
        ["none", "Aucune"],
      ]),
      R("layout.animDuration", "Durée de l'animation", 0.05, 2, 0.05, sec),
      R("layout.fadeIn", "Fondu d'apparition", 0, 2, 0.05, sec),
      R("layout.fadeOut", "Fondu de disparition", 0, 2, 0.05, sec),
      R("layout.preRoll", "Affichée avant le chant", 0.2, 8, 0.1, sec),
      R("layout.hold", "Gardée après le chant", 0, 6, 0.1, sec),
    ],
  },
  {
    title: "Effets",
    open: false,
    controls: [
      S("effects.particles", "Particules", [
        ["none", "Aucune"],
        ["bokeh", "Bokeh (bulles de lumière)"],
        ["snow", "Neige"],
        ["stars", "Étoiles"],
        ["sparkles", "Paillettes"],
        ["hearts", "Cœurs"],
        ["embers", "Braises"],
      ]),
      R("effects.particleCount", "Nombre", 1, 200, 1, String, { show: (s) => s.effects.particles !== "none" }),
      C("effects.particleColor", "Couleur", { show: (s) => s.effects.particles !== "none" }),
      R("effects.particleSize", "Taille", 0.2, 4, 0.1, num(1), { show: (s) => s.effects.particles !== "none" }),
      R("effects.particleSpeed", "Vitesse", 0, 5, 0.1, num(1), { show: (s) => s.effects.particles !== "none" }),
      R("effects.particleOpacity", "Opacité", 0.05, 1, 0.05, pct, { show: (s) => s.effects.particles !== "none" }),
      S("effects.visualizer", "Visualiseur de musique", [
        ["none", "Aucun"],
        ["bars", "Barres"],
        ["mirror", "Barres miroir"],
        ["wave", "Onde"],
        ["circle", "Cercle (autour de l'image)"],
      ]),
      C("effects.vizColor", "Couleur", { show: (s) => s.effects.visualizer !== "none" }),
      C("effects.vizColor2", "2ᵉ couleur (dégradé)", { auto: true, autoLabel: "Aucune", show: (s) => s.effects.visualizer !== "none" }),
      R("effects.vizOpacity", "Opacité", 0.05, 1, 0.05, pct, { show: (s) => s.effects.visualizer !== "none" }),
      R("effects.vizHeight", "Hauteur", 0.03, 0.6, 0.01, pct, { show: (s) => s.effects.visualizer !== "none" }),
      R("effects.vizBars", "Nombre de barres", 8, 128, 1, String, {
        show: (s) => ["bars", "mirror", "circle"].includes(s.effects.visualizer),
      }),
      G(
        "effects.vizPosition",
        "Position",
        [
          ["bottom", "Bas"],
          ["center", "Centre"],
          ["top", "Haut"],
        ],
        { show: (s) => ["bars", "mirror", "wave"].includes(s.effects.visualizer) },
      ),
      R("effects.beatZoom", "Le fond pulse avec les basses", 0, 0.12, 0.005, pct, { show: media }),
      T("effects.progress", "Barre de progression"),
      C("effects.progressColor", "Couleur de la barre", { show: (s) => s.effects.progress }),
      R("effects.progressHeight", "Épaisseur de la barre", 1, 30, 1, px, { show: (s) => s.effects.progress }),
      G(
        "effects.progressPosition",
        "Position de la barre",
        [
          ["bottom", "Bas"],
          ["top", "Haut"],
        ],
        { show: (s) => s.effects.progress },
      ),
    ],
  },
  {
    title: "Image / vidéo en haut",
    open: false,
    controls: [
      T("top.enabled", "Afficher un média en haut"),
      { path: "top.media", type: "asset", label: "Fichier", target: "top", show: (s) => s.top.enabled },
      R("top.size", "Taille", 0.1, 0.9, 0.01, pct, { show: (s) => s.top.enabled }),
      R("top.y", "Position verticale", 0, 0.7, 0.01, pct, { show: (s) => s.top.enabled }),
      R("top.x", "Position horizontale", -0.45, 0.45, 0.01, pct, { show: (s) => s.top.enabled }),
      G(
        "top.shape",
        "Forme",
        [
          ["rect", "Carré"],
          ["rounded", "Arrondi"],
          ["circle", "Rond"],
        ],
        { show: (s) => s.top.enabled },
      ),
      R("top.radius", "Arrondi des coins", 0, 0.5, 0.01, pct, { show: (s) => s.top.enabled && s.top.shape === "rounded" }),
      R("top.border", "Bordure", 0, 30, 1, px, { show: (s) => s.top.enabled }),
      C("top.borderColor", "Couleur de la bordure", { show: (s) => s.top.enabled && s.top.border > 0 }),
      R("top.shadow", "Ombre", 0, 1, 0.05, pct, { show: (s) => s.top.enabled }),
      R("top.spin", "Rotation (tours / minute)", -60, 60, 1, String, {
        show: (s) => s.top.enabled,
        hint: "33 = effet vinyle (avec la forme ronde).",
      }),
      R("top.pulse", "Grossit avec les basses", 0, 0.3, 0.01, pct, { show: (s) => s.top.enabled }),
    ],
  },
  {
    title: "Logo",
    open: false,
    controls: [
      T("logo.enabled", "Afficher mon logo", { hint: "Ton logo ou ta marque, dans un coin de la vidéo." }),
      { path: "logo.media", type: "asset", label: "Image du logo", target: "logo", show: (s) => s.logo.enabled },
      G(
        "logo.position",
        "Coin",
        [
          ["top-left", "↖"],
          ["top-right", "↗"],
          ["bottom-left", "↙"],
          ["bottom-right", "↘"],
        ],
        { show: (s) => s.logo.enabled },
      ),
      R("logo.size", "Taille", 0.03, 0.4, 0.01, pct, { show: (s) => s.logo.enabled }),
      R("logo.opacity", "Opacité", 0.1, 1, 0.05, pct, { show: (s) => s.logo.enabled }),
      R("logo.margin", "Marge", 0, 0.15, 0.005, pct, { show: (s) => s.logo.enabled }),
    ],
  },
  {
    title: "Duo",
    open: false,
    controls: [
      T("duo.enabled", "Mode duo (plusieurs chanteurs)", {
        hint: "Dans les paroles : A:, B: ou AB: en début de ligne, ou clique sur la pastille d'une ligne.",
      }),
      T("duo.showNames", "Afficher le nom du chanteur", { show: (s) => s.duo.enabled }),
      ...[0, 1, 2].flatMap((i) => [
        {
          path: `duo.singers.${i}.name`,
          type: "text",
          label: i === 2 ? "Ensemble (AB)" : `Chanteur ${i ? "B" : "A"}`,
          show: (s) => s.duo.enabled,
        },
        C(`duo.singers.${i}.color`, "Couleur", { show: (s) => s.duo.enabled }),
        G(
          `duo.singers.${i}.align`,
          "Alignement",
          [
            ["left", "Gauche"],
            ["center", "Centre"],
            ["right", "Droite"],
          ],
          { show: (s) => s.duo.enabled },
        ),
      ]),
    ],
  },
  {
    title: "Début et fin",
    open: false,
    controls: [
      { path: "project.title", type: "text", label: "Titre" },
      { path: "project.artist", type: "text", label: "Artiste" },
      T("intro.title", "Titre et artiste au début"),
      R("intro.titleDuration", "Durée du titre", 1, 15, 0.5, sec, { show: (s) => s.intro.title }),
      R("intro.titleSize", "Taille du titre", 0.6, 3, 0.05, num(2), { show: (s) => s.intro.title }),
      C("intro.titleColor", "Couleur du titre", { auto: true, show: (s) => s.intro.title }),
      C("intro.artistColor", "Couleur de l'artiste", { auto: true, show: (s) => s.intro.title }),
      T("intro.countdown", "Compte à rebours avant chaque reprise (karaoké)"),
      C("intro.countdownColor", "Couleur du compte à rebours", { auto: true, show: (s) => s.intro.countdown }),
      T("outro.enabled", "Message de fin"),
      { path: "outro.text", type: "text", label: "Texte de fin", show: (s) => s.outro.enabled },
      R("outro.duration", "Durée", 1, 15, 0.5, sec, { show: (s) => s.outro.enabled }),
      C("outro.color", "Couleur", { auto: true, show: (s) => s.outro.enabled }),
    ],
  },
];

export class Inspector {
  constructor(container, studio) {
    this.studio = studio;
    this.el = h("div", { class: "inspector" });
    this.bindings = [];
    this.saved = [];
    container.append(this.el);
    this.render();
    this.loadSaved();
  }

  get style() {
    return this.studio.project.style;
  }

  /** Chemin d'un réglage de calque : « layer:<id>.<réglage> ». */
  layerPath(path) {
    const m = /^layer:([^.]+)\.(.+)$/.exec(path);
    return m ? { layer: this.style.layers.find((l) => l.id === m[1]), key: m[2] } : null;
  }

  get(path) {
    const lp = this.layerPath(path);
    if (lp) return lp.layer ? getPath(lp.layer, lp.key) : undefined;
    return path.startsWith("project.") ? this.studio.project[path.slice(8)] : getPath(this.style, path);
  }

  set(path, value, { live = false } = {}) {
    const lp = this.layerPath(path);
    if (lp) {
      if (!lp.layer) return;
      setPath(lp.layer, lp.key, value);
      this.studio.styleChanged(`layers.${lp.key}`, { live });
      // Ces réglages changent la liste ou les réglages proposés.
      if (!live && ["graphic", "front", "media"].includes(lp.key)) return this.renderLayers();
    } else {
      if (path.startsWith("project.")) this.studio.project[path.slice(8)] = value;
      else setPath(this.style, path, value);
      this.studio.styleChanged(path, { live });
    }
    this.updateVisibility();
  }

  render() {
    this.bindings = [];
    this.savedBox = h("div", { class: "saved-styles" });
    const presets = h(
      "details",
      { class: "section", open: true },
      h("summary", {}, "Styles"),
      h(
        "div",
        { class: "presets" },
        PRESETS.map((p) => h("button", { class: "preset", onclick: () => this.applyPreset(p) }, p.name)),
      ),
      h(
        "div",
        { class: "row gap wrap saved-head" },
        h("strong", {}, "Mes styles"),
        h("button", { class: "btn small", onclick: () => this.saveCurrent() }, "+ Enregistrer ce style"),
      ),
      this.savedBox,
    );
    this.details = {};
    const sections = SECTIONS.map((sec) => {
      const node = h(
        "details",
        { class: `section${sec.custom ? ` section-${sec.custom}` : ""}`, open: sec.open },
        h(
          "summary",
          {},
          h("span", {}, sec.title),
          !sec.custom &&
            h(
              "button",
              {
                class: "icon-btn reset-btn",
                title: "Remettre cette section par défaut",
                onclick: (e) => {
                  e.preventDefault();
                  this.resetSection(sec);
                },
              },
              "↺",
            ),
        ),
        sec.custom === "layers"
          ? (this.layersBox = h("div", { class: "controls layers-box" }))
          : h(
              "div",
              { class: "controls" },
              sec.controls.map((c) => this.control(c)),
            ),
      );
      this.details[sec.title] = node;
      return node;
    });
    this.el.replaceChildren(presets, ...sections);
    this.renderLayers();
    this.renderSaved();
    this.updateVisibility();
  }

  // ---------- Préréglages et styles enregistrés ----------
  /** Applique un style en gardant les fichiers du projet (fond, image du haut, logo). */
  applyStyle(patch, name) {
    const cur = this.style;
    let next = mergeStyle(cur, patch);
    next.background.media = cur.background.media;
    if (["image", "video"].includes(cur.background.type) && cur.background.media && !["image", "video"].includes(patch.background?.type))
      next.background.type = cur.background.type;
    next.top.media = cur.top.media;
    next.top.kind = cur.top.kind;
    if (next.top.enabled && !next.top.media) next.top.media = this.studio.project.media.cover?.file || null;
    if (!next.top.media) next.top.enabled = false;
    next.logo = { ...next.logo, media: cur.logo.media, enabled: cur.logo.enabled && !!cur.logo.media };
    next.customFonts = cur.customFonts;
    // Les calques du projet restent ; un style enregistré ajoute ses éléments décoratifs.
    const extra = (Array.isArray(patch.layers) ? patch.layers : [])
      .filter((l) => l?.kind === "shape" && !cur.layers.some((c) => c.id === l.id))
      .map(({ id, ...l }) => newLayer("shape", l));
    next.layers = [...cur.layers, ...extra];
    next = normalizeStyle(next);
    Object.keys(cur).forEach((k) => delete cur[k]);
    Object.assign(cur, next);
    this.studio.styleChanged("preset", {});
    this.refresh();
    toast(`Style « ${name} » appliqué.`, "ok", 2000);
  }

  applyPreset(preset) {
    this.applyStyle(mergeStyle(defaultStyle(), preset.patch), preset.name);
  }

  async loadSaved() {
    try {
      this.saved = await api("/api/presets");
      this.renderSaved();
    } catch {}
  }

  renderSaved() {
    if (!this.savedBox) return;
    if (!this.saved.length)
      return this.savedBox.replaceChildren(
        h("small", { class: "hint" }, "Enregistre tes réglages pour les réutiliser dans tes autres vidéos."),
      );
    this.savedBox.replaceChildren(
      ...this.saved.map((p) =>
        h(
          "div",
          { class: "saved-item" },
          h("button", { class: "preset", onclick: () => this.applyStyle(p.style, p.name) }, p.name),
          h(
            "button",
            {
              class: "icon-btn",
              title: "Supprimer ce style",
              onclick: async () => {
                if (!(await confirmBox(`Supprimer le style « ${p.name} » ?`, { ok: "Supprimer", danger: true }))) return;
                await api(`/api/presets/${p.id}`, { method: "DELETE" }).catch((e) => toast(e.message, "error"));
                this.loadSaved();
              },
            },
            "🗑",
          ),
        ),
      ),
    );
  }

  saveCurrent() {
    const name = h("input", { type: "text", maxlength: "60", placeholder: "Ex. : Mariage doré" });
    modal({
      title: "Enregistrer ce style",
      body: h(
        "div",
        {},
        h("p", { class: "hint" }, "Police, couleurs, effets, mise en page… (sans les images ni les vidéos du projet)."),
        name,
      ),
      actions: [
        { label: "Annuler", onClick: (c) => c() },
        {
          label: "Enregistrer",
          primary: true,
          onClick: async (close) => {
            if (!name.value.trim()) return toast("Donne un nom à ce style.", "info");
            try {
              await api("/api/presets", { method: "POST", json: { name: name.value.trim(), style: shareableStyle(this.style) } });
              close();
              toast("Style enregistré.", "ok");
              this.loadSaved();
            } catch (e) {
              toast(e.message, "error");
            }
          },
        },
      ],
    });
  }

  resetSection(sec) {
    const def = defaultStyle();
    for (const c of sec.controls) {
      if (c.path.startsWith("project.") || c.type === "asset") continue;
      setPath(this.style, c.path, structuredClone(getPath(def, c.path)));
    }
    this.studio.styleChanged(sec.controls.some((c) => c.path.startsWith("font")) ? "font.reset" : "preset", {});
    this.refresh();
    toast(`« ${sec.title} » remis par défaut.`, "ok", 1800);
  }

  /** Remet les valeurs affichées à jour (après annuler, préréglage…). */
  refresh() {
    this.renderLayers();
    for (const b of this.bindings) b.sync();
    this.updateVisibility();
  }

  updateVisibility() {
    for (const b of this.bindings) if (b.def.show) b.wrap.hidden = !b.def.show(this.style);
  }

  control(def) {
    const label = h("span", { class: "field-label" }, def.label || "");
    let node; // ce qu'on affiche
    let sync; // remet la valeur affichée à jour
    const val = () => this.get(def.path);
    switch (def.type) {
      case "range": {
        const out = h("span", { class: "range-value" });
        const input = h("input", { type: "range", min: def.min, max: def.max, step: def.step, "aria-label": def.label });
        const exact = h("input", {
          type: "number",
          class: "range-num",
          min: def.min,
          max: def.max,
          step: def.step,
          "aria-label": `${def.label} (valeur exacte)`,
        });
        const show = (v) => (out.textContent = (def.fmt || String)(Number(v)));
        sync = () => {
          input.value = val();
          if (document.activeElement !== exact) exact.value = val();
          show(val());
        };
        input.addEventListener("input", () => {
          show(input.value);
          exact.value = input.value;
          this.set(def.path, Number(input.value), { live: true });
        });
        input.addEventListener("change", () => this.set(def.path, Number(input.value)));
        exact.addEventListener("change", () => {
          const v = Number(exact.value);
          if (!Number.isFinite(v)) return sync();
          this.set(def.path, v);
          input.value = v;
          show(v);
        });
        // Un clic sur la valeur permet de taper un nombre précis.
        out.addEventListener("click", () => {
          node.classList.add("typing");
          exact.focus();
          exact.select();
        });
        exact.addEventListener("blur", () => node.classList.remove("typing"));
        node = h("div", { class: "range-row" }, input, out, exact);
        break;
      }
      case "color": {
        const input = h("input", { type: "color", "aria-label": def.label });
        let auto = null;
        sync = () => {
          input.value = val() || "#ffffff";
          if (auto) {
            auto.checked = !val();
            input.disabled = !val();
          }
        };
        input.addEventListener("input", () => this.set(def.path, input.value, { live: true }));
        input.addEventListener("change", () => this.set(def.path, input.value));
        if (def.auto) {
          auto = h("input", { type: "checkbox" });
          auto.addEventListener("change", () => {
            this.set(def.path, auto.checked ? "" : input.value);
            sync();
          });
          node = h("div", { class: "row gap" }, input, h("label", { class: "auto-check" }, auto, def.autoLabel || "Auto"));
        } else node = input;
        break;
      }
      case "toggle": {
        const box = h("input", { type: "checkbox" });
        sync = () => (box.checked = !!val());
        box.addEventListener("change", () => this.set(def.path, box.checked));
        node = h("label", { class: "toggle" }, box, h("span", { class: "toggle-ui" }), h("span", {}, def.label));
        label.textContent = "";
        break;
      }
      case "select": {
        const input = h(
          "select",
          { "aria-label": def.label },
          def.options.map(([v, t]) => h("option", { value: String(v) }, t)),
        );
        sync = () => (input.value = String(val()));
        input.addEventListener("change", () => this.set(def.path, def.num ? Number(input.value) : input.value));
        node = input;
        break;
      }
      case "seg": {
        const buttons = def.options.map(([v, t]) =>
          h("button", { class: "seg-btn", type: "button", onclick: () => (this.set(def.path, v), sync()) }, t),
        );
        sync = () => buttons.forEach((b, i) => b.classList.toggle("on", def.options[i][0] === val()));
        node = h("div", { class: "seg", role: "group", "aria-label": def.label }, buttons);
        break;
      }
      case "text": {
        const input = h("input", { type: "text", maxlength: "200", "aria-label": def.label });
        sync = () => {
          if (document.activeElement !== input) input.value = val() || "";
        };
        input.addEventListener("input", () => this.set(def.path, input.value, { live: true }));
        input.addEventListener("change", () => this.set(def.path, input.value));
        node = input;
        break;
      }
      case "font": {
        loadFontPreviews();
        const own = (this.style.customFonts || []).map((f) => f.family);
        const cats = [...new Set(FONTS.map((f) => f.cat))];
        const select = h(
          "select",
          { class: "font-select", "aria-label": "Police" },
          own.length &&
            h(
              "optgroup",
              { label: "Mes polices" },
              own.map((f) => h("option", { value: f }, f)),
            ),
          cats.map((cat) =>
            h(
              "optgroup",
              { label: cat },
              FONTS.filter((f) => f.cat === cat).map((f) => h("option", { value: f.name, style: { fontFamily: `"${f.name}"` } }, f.name)),
            ),
          ),
          h(
            "optgroup",
            { label: "Polices de l'appareil" },
            SYSTEM_FONTS.map((f) => h("option", { value: f, style: { fontFamily: f } }, f)),
          ),
        );
        const preview = h("div", { class: "font-preview" }, "Paroles · Aa Bb 123");
        sync = () => {
          select.value = val();
          preview.style.fontFamily = `"${val()}"`;
          preview.style.fontWeight = this.style.font.weight;
          preview.style.fontStyle = this.style.font.italic ? "italic" : "normal";
        };
        select.addEventListener("change", () => this.set(def.path, select.value));
        const fileIn = h("input", {
          type: "file",
          accept: ".ttf,.otf,.woff,.woff2",
          hidden: true,
          onchange: () => this.uploadFont(fileIn),
        });
        node = h(
          "div",
          {},
          h(
            "div",
            { class: "row gap" },
            select,
            fileIn,
            h("button", { class: "btn small", title: "Ajouter ma police (TTF, OTF, WOFF)", onclick: () => fileIn.click() }, "+ Police"),
          ),
          preview,
        );
        break;
      }
      case "asset": {
        const name = h("span", { class: "asset-name" });
        const accept = def.target === "logo" ? "image/*" : "image/*,video/*";
        const fileIn = h("input", { type: "file", accept, hidden: true, onchange: () => this.uploadAsset(def, fileIn) });
        const m = this.studio.project.media;
        const quick = [];
        if (m.cover) quick.push(h("button", { class: "btn small", onclick: () => this.useAsset(def, m.cover.file, "image") }, "Pochette"));
        if (m.source && def.target !== "logo")
          quick.push(h("button", { class: "btn small", onclick: () => this.useAsset(def, m.source.file, "video") }, "Vidéo importée"));
        sync = () => (name.textContent = val() ? "✓ fichier choisi" : "aucun fichier");
        node = h(
          "div",
          { class: "row gap wrap" },
          h("button", { class: "btn small primary", onclick: () => fileIn.click() }, "Choisir…"),
          quick,
          name,
          fileIn,
        );
        break;
      }
      case "grid9": {
        const cells = [];
        for (const row of [-1, 0, 1])
          for (const col of [-1, 0, 1])
            cells.push(
              h(
                "button",
                {
                  class: "grid9-btn",
                  type: "button",
                  title: `${["En haut", "Au milieu", "En bas"][row + 1]} · ${["à gauche", "au centre", "à droite"][col + 1]}`,
                  dataset: { row, col },
                  onclick: () => (this.placeText(col, row), sync()),
                },
                ["↖", "↑", "↗", "←", "•", "→", "↙", "↓", "↘"][(row + 1) * 3 + col + 1],
              ),
            );
        sync = () => {
          const { row, col } = this.textCell();
          cells.forEach((c) => c.classList.toggle("on", Number(c.dataset.row) === row && Number(c.dataset.col) === col));
        };
        node = h("div", { class: "grid9", role: "group", "aria-label": def.label }, cells);
        break;
      }
      case "buttons": {
        node = h(
          "div",
          { class: "row gap wrap" },
          def.buttons.map(([t, fn]) => h("button", { class: "btn small", type: "button", onclick: () => fn(this) }, t)),
        );
        sync = () => {};
        break;
      }
      default:
        node = h("span", {}, "?");
        sync = () => {};
    }
    const wrap = h(
      "div",
      { class: `ctl ctl-${def.type}` },
      label.textContent ? label : null,
      node,
      def.hint && h("small", { class: "hint" }, def.hint),
    );
    const binding = { def, wrap, sync };
    this.bindings.push(binding);
    sync();
    return wrap;
  }

  // ---------- Position des paroles ----------
  /** Case de la grille qui correspond à la position actuelle des paroles. */
  textCell() {
    const L = this.style.layout;
    const x = L.x || 0;
    const col = x < -0.05 ? -1 : x > 0.05 ? 1 : 0;
    if (L.position !== "custom") return { col, row: L.position === "top" ? -1 : L.position === "center" ? 0 : 1 };
    const y = L.y ?? 0.75;
    return { col, row: y < 0.34 ? -1 : y > 0.66 ? 1 : 0 };
  }

  /** Pose les paroles dans une des 9 cases (col, row : -1, 0 ou 1). rotate : nouvelle rotation (facultatif). */
  placeText(col, row, rotate) {
    const L = this.style.layout;
    if (rotate !== undefined) L.rotate = rotate;
    const vertical = Math.abs(Math.sin(((L.rotate || 0) * Math.PI) / 180)) > Math.SQRT1_2;
    const m = L.margin ?? 0.07;
    L.position = "custom";
    if (vertical) {
      // Texte vertical : une colonne de texte collée au bord choisi.
      L.x = col * 0.38;
      L.y = 0.5 + row * 0.22;
      L.align = "center";
    } else {
      if (col) {
        // Sur un côté : le texte n'occupe que la moitié de l'image, aligné sur ce bord.
        L.maxWidth = Math.min(L.maxWidth ?? 1, 0.55);
        L.x = Math.round(col * (1 - 2 * m) * (1 - L.maxWidth) * 500) / 1000;
        L.align = col < 0 ? "left" : "right";
      } else {
        L.x = 0;
        L.align = "center";
      }
      L.y = [0.18, 0.5, 0.82][row + 1];
    }
    this.studio.styleChanged("layout.drag", {});
    this.refresh();
  }

  /** Ouvre une section (et l'onglet Style sur téléphone). */
  open(title) {
    const d = this.details?.[title];
    if (!d) return;
    d.open = true;
    this.studio.showTab?.("style");
    requestAnimationFrame(() => d.scrollIntoView({ block: "start", behavior: "smooth" }));
  }

  // ---------- Calques ----------
  /** Le calque choisi sur l'aperçu s'affiche ici avec ses réglages. */
  showLayer(id) {
    if (this.layerSel === id) return;
    this.layerSel = id;
    this.renderLayers();
    if (this.details?.["Calques et superpositions"]) this.details["Calques et superpositions"].open = true;
  }

  layerName(l) {
    if (l.kind === "shape") return GRAPHICS.find((g) => g[0] === l.graphic)?.[1] || "Élément";
    return l.kind === "video" ? "Vidéo" : "Image";
  }

  renderLayers() {
    const box = this.layersBox;
    if (!box) return;
    const s = this.studio;
    const layers = this.style.layers;
    // Les réglages du calque d'avant disparaissent avec lui.
    this.bindings = this.bindings.filter((b) => !b.def.layer);
    if (!layers.some((l) => l.id === this.layerSel)) this.layerSel = null;
    const m = s.project.media;
    const shapes = h(
      "div",
      { class: "graphic-grid", hidden: true },
      GRAPHICS.map(([g, label]) =>
        h(
          "button",
          { class: "graphic-btn", type: "button", onclick: () => s.addLayer(newLayer("shape", s.graphicDefaults(g))) },
          h("span", { class: `graphic-icon g-${g}` }),
          label,
        ),
      ),
    );
    const add = h(
      "div",
      { class: "row gap wrap" },
      h("button", { class: "btn small primary", type: "button", onclick: () => s.pickLayerFile() }, "+ Image / vidéo"),
      h("button", { class: "btn small", type: "button", onclick: () => (shapes.hidden = !shapes.hidden) }, "+ Élément décoratif"),
      m.cover &&
        h(
          "button",
          { class: "btn small", type: "button", onclick: () => s.addLayer(newLayer("image", { media: m.cover.file })) },
          "+ Pochette",
        ),
      m.source &&
        h(
          "button",
          { class: "btn small", type: "button", onclick: () => s.addLayer(newLayer("video", { media: m.source.file })) },
          "+ Vidéo importée",
        ),
    );
    if (!layers.length) {
      box.replaceChildren(
        add,
        shapes,
        h(
          "p",
          { class: "hint" },
          "Pose des images, des vidéos ou des éléments décoratifs par-dessus le fond : sur un côté, en vignette, en cadre… Ensuite, touche-les sur l'aperçu pour les déplacer, les agrandir ou les tourner.",
        ),
        h(
          "div",
          { class: "row gap wrap" },
          h("button", { class: "btn small", type: "button", onclick: () => s.sideBySide("right") }, "🖼 Image à droite, paroles à gauche"),
          h("button", { class: "btn small", type: "button", onclick: () => s.sideBySide("left") }, "Image à gauche, paroles à droite 🖼"),
        ),
      );
      return;
    }
    // Liste : le calque du dessus en premier.
    const list = h(
      "div",
      { class: "layer-list" },
      [...layers].reverse().map((l) => {
        const i = layers.indexOf(l);
        const icon = l.kind === "shape" ? "✦" : l.kind === "video" ? "🎬" : "🖼";
        return h(
          "div",
          { class: `layer-item${l.id === this.layerSel ? " on" : ""}`, onclick: () => s.editor.select({ kind: "layer", id: l.id }) },
          h("span", { class: "layer-icon" }, icon),
          h("span", { class: "layer-name" }, this.layerName(l), l.front ? h("small", { class: "badge" }, "devant") : null),
          h(
            "span",
            { class: "layer-actions", onclick: (e) => e.stopPropagation() },
            h(
              "button",
              { class: "icon-btn", title: "Monter", disabled: i === layers.length - 1, onclick: () => s.moveLayer(l.id, 1) },
              "↑",
            ),
            h("button", { class: "icon-btn", title: "Descendre", disabled: i === 0, onclick: () => s.moveLayer(l.id, -1) }, "↓"),
            h("button", { class: "icon-btn", title: "Dupliquer", onclick: () => s.duplicateLayer(l.id) }, "⧉"),
            h("button", { class: "icon-btn", title: "Supprimer", onclick: () => s.removeLayer(l.id) }, "🗑"),
          ),
        );
      }),
    );
    const sel = layers.find((l) => l.id === this.layerSel);
    box.replaceChildren(
      add,
      shapes,
      list,
      sel
        ? h("div", { class: "layer-settings" }, h("h4", {}, `Réglages : ${this.layerName(sel)}`), this.layerControls(sel))
        : h("p", { class: "hint" }, "Touche un calque dans la liste ou sur l'aperçu pour le régler."),
    );
    this.updateVisibility();
  }

  layerControls(layer) {
    const P = (k) => `layer:${layer.id}.${k}`;
    // Toujours la version actuelle du calque (après annuler, elle est remplacée).
    const cur = () => this.style.layers.find((x) => x.id === layer.id) || layer;
    const l = new Proxy({}, { get: (_, k) => cur()[k] });
    const shape = l.kind === "shape";
    const g = l.graphic;
    const dur = Math.max(1, Math.ceil(this.studio.audio?.duration || 300));
    const defs = [
      shape
        ? S(P("graphic"), "Élément", GRAPHICS)
        : {
            path: P("media"),
            type: "buttons",
            label: "Fichier",
            buttons: [["Changer l'image ou la vidéo…", () => this.studio.pickLayerFile(l.id)]],
          },
      shape &&
        g === "vinyl" && {
          path: P("media"),
          type: "buttons",
          label: "Image au centre du disque",
          buttons: [
            ...(this.studio.project.media.cover ? [["Pochette", () => this.set(P("media"), this.studio.project.media.cover.file)]] : []),
            ["Choisir…", () => this.studio.setLayerImage(layer.id)],
            ...(layer.media ? [["Retirer", () => this.set(P("media"), null)]] : []),
          ],
        },
      shape && C(P("color"), g === "vinyl" ? "Couleur du centre" : "Couleur", { show: () => g !== "vinyl" || !l.media }),
      shape &&
        ["vinyl", "frame", "panel", "leak", "sun"].includes(g) &&
        C(P("color2"), "2ᵉ couleur", { show: () => g !== "vinyl" || !l.media }),
      shape && ["panel", "frame", "leak"].includes(g) && R(P("aspect"), "Largeur / hauteur", 0.05, 8, 0.05, num(2)),
      shape && ["panel", "frame"].includes(g) && R(P("radius"), "Arrondi des coins", 0, 0.5, 0.01, pct),
      T(P("front"), "Devant les paroles"),
      R(P("x"), "Position horizontale", -0.2, 1.2, 0.005, pct),
      R(P("y"), "Position verticale", -0.2, 1.2, 0.005, pct),
      R(P("size"), "Taille", 0.03, 2.5, 0.01, pct),
      R(P("rotate"), "Rotation", -180, 180, 1, (v) => `${v}°`),
      R(P("opacity"), "Opacité", 0.05, 1, 0.05, pct),
      T(P("flip"), "Miroir (retourner)"),
      !shape &&
        G(P("shape"), "Forme", [
          ["rect", "Carré"],
          ["rounded", "Arrondi"],
          ["circle", "Rond"],
        ]),
      !shape && R(P("radius"), "Arrondi des coins", 0, 0.5, 0.01, pct, { show: () => l.shape === "rounded" }),
      !shape && R(P("border"), "Bordure", 0, 30, 1, px),
      !shape && C(P("borderColor"), "Couleur de la bordure", { show: () => l.border > 0 }),
      !shape && R(P("shadow"), "Ombre", 0, 1, 0.05, pct, { show: () => l.blend === "normal" }),
      S(P("blend"), "Fusion avec le dessous", BLENDS, {
        hint: "« Éclaircir » fait disparaître le noir : idéal pour des lumières ou des fumées.",
      }),
      S(P("anim"), "Animation", [
        ["none", "Aucune"],
        ["float", "Flotte doucement"],
        ["zoom", "Zoom lent"],
        ["sway", "Balance"],
        ["spin", "Tourne (vinyle)"],
        ["pulse", "Bat avec les basses"],
      ]),
      R(P("animSpeed"), "Vitesse de l'animation", 0.1, 4, 0.1, num(1), { show: () => l.anim !== "none" }),
      R(P("start"), "Apparaît à", 0, dur, 0.5, sec),
      R(P("end"), "Disparaît à", 0, dur, 0.5, (v) => (Number(v) > 0 ? sec(v) : "fin"), { hint: "0 = jusqu'à la fin de la vidéo." }),
    ].filter(Boolean);
    return h(
      "div",
      { class: "controls" },
      defs.map((d) => this.control({ ...d, layer: true })),
    );
  }

  useAsset(def, file, kind) {
    if (def.target === "background") {
      this.style.background.media = file;
      this.style.background.type = kind;
    } else if (def.target === "logo") {
      this.style.logo.media = file;
      this.style.logo.enabled = true;
    } else {
      this.style.top.media = file;
      this.style.top.kind = kind;
      this.style.top.enabled = true;
    }
    this.studio.styleChanged(`${def.target}.media`, {});
    this.refresh();
  }

  async uploadAsset(def, fileIn) {
    const file = fileIn.files[0];
    fileIn.value = "";
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    toast("Envoi du fichier…", "info", 1500);
    try {
      const a = await upload(`/api/projects/${this.studio.project.id}/assets`, form);
      if (a.kind === "font") return toast("C'est une police : utilise le bouton « + Police ».", "error");
      if (def.target === "logo" && a.kind !== "image") return toast("Le logo doit être une image (PNG conseillé).", "error");
      this.useAsset(def, a.file, a.kind);
    } catch (e) {
      toast(e.message, "error");
    }
  }

  async uploadFont(fileIn) {
    const file = fileIn.files[0];
    fileIn.value = "";
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    try {
      const a = await upload(`/api/projects/${this.studio.project.id}/assets`, form);
      if (a.kind !== "font") return toast("Ce fichier n'est pas une police.", "error");
      const family =
        file.name
          .replace(/\.\w+$/, "")
          .replace(/[^\p{L}\p{N} _-]/gu, "")
          .slice(0, 40) || "Ma police";
      this.style.customFonts = [...(this.style.customFonts || []).filter((f) => f.family !== family), { family, file: a.file }];
      this.style.font.family = family;
      this.studio.styleChanged("font.family", {});
      this.render();
      toast(`Police « ${family} » ajoutée.`, "ok");
    } catch (e) {
      toast(e.message, "error");
    }
  }
}
