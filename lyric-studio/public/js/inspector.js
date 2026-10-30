// Panneau de style : préréglages, format, texte, couleurs, mise en page, fond, média du haut, duo, intro.
// Chaque réglage est décrit par une ligne du schéma ci-dessous (chemin dans le style, type, bornes).
import { h, toast } from "./ui.js";
import { upload } from "./api.js";
import { FONTS, SYSTEM_FONTS, PRESETS, getPath, setPath, mergeStyle } from "./core/style.js";
import { loadFontPreviews } from "./fonts.js";

const pct = (v) => `${Math.round(v * 100)} %`;
const px = (v) => `${v} px`;
const sec = (v) => `${Number(v).toFixed(1)} s`;

const SECTIONS = [
  {
    title: "Format et mode",
    open: true,
    controls: [
      {
        path: "mode",
        type: "seg",
        label: "Type de vidéo",
        options: [
          ["lyric", "🎤 Lyrique (avec voix)"],
          ["karaoke", "🎶 Karaoké (sans voix)"],
        ],
      },
      {
        path: "guideVocals",
        type: "range",
        label: "Voix guide",
        min: 0,
        max: 0.6,
        step: 0.05,
        fmt: pct,
        show: (s) => s.mode === "karaoke",
        hint: "Garde un peu de la voix d'origine pour aider à chanter.",
      },
      {
        path: "aspect",
        type: "seg",
        label: "Format",
        options: [
          ["16:9", "16:9"],
          ["9:16", "9:16"],
          ["1:1", "1:1"],
          ["4:5", "4:5"],
        ],
        hint: "16:9 YouTube · 9:16 TikTok, Reels, Statut · 1:1 et 4:5 Facebook, Instagram",
      },
    ],
  },
  {
    title: "Texte",
    open: true,
    controls: [
      { path: "font.family", type: "font", label: "Police" },
      {
        path: "font.weight",
        type: "select",
        label: "Épaisseur",
        options: [
          [400, "Normale"],
          [500, "Moyenne"],
          [600, "Semi-grasse"],
          [700, "Grasse"],
          [800, "Très grasse"],
          [900, "Noire"],
        ],
        num: true,
      },
      { path: "font.size", type: "range", label: "Taille", min: 24, max: 180, step: 1, fmt: px },
      { path: "font.uppercase", type: "toggle", label: "TOUT EN MAJUSCULES" },
      { path: "font.letterSpacing", type: "range", label: "Espacement des lettres", min: -4, max: 24, step: 0.5, fmt: px },
      { path: "font.lineHeight", type: "range", label: "Interligne", min: 0.9, max: 2.2, step: 0.05, fmt: (v) => Number(v).toFixed(2) },
    ],
  },
  {
    title: "Couleurs et effet",
    open: true,
    controls: [
      {
        path: "highlight",
        type: "seg",
        label: "Effet de chant",
        options: [
          ["wipe", "Remplissage"],
          ["word", "Mot par mot"],
          ["line", "Ligne"],
          ["none", "Aucun"],
        ],
      },
      { path: "colors.text", type: "color", label: "Texte à chanter" },
      {
        path: "colors.sung",
        type: "color",
        label: "Texte chanté",
        show: (s) => !s.duo?.enabled,
        hint: "En mode duo : couleur de chaque chanteur.",
      },
      {
        path: "pastLines",
        type: "select",
        label: "Lignes déjà chantées",
        options: [
          ["sung", "Restent colorées"],
          ["dim", "S'estompent"],
          ["text", "Reprennent la couleur du texte"],
        ],
      },
      { path: "colors.outline", type: "color", label: "Contour" },
      { path: "colors.outlineWidth", type: "range", label: "Épaisseur du contour", min: 0, max: 16, step: 0.5, fmt: px },
      { path: "colors.shadow", type: "color", label: "Ombre / lueur" },
      { path: "colors.shadowBlur", type: "range", label: "Flou de l'ombre", min: 0, max: 60, step: 1, fmt: px },
      { path: "colors.shadowOpacity", type: "range", label: "Force de l'ombre", min: 0, max: 1, step: 0.05, fmt: pct },
    ],
  },
  {
    title: "Mise en page",
    open: false,
    controls: [
      {
        path: "layout.display",
        type: "select",
        label: "Affichage",
        options: [
          ["single", "Une ligne à la fois"],
          ["alternate", "Alterné (karaoké classique)"],
          ["page", "Par page"],
          ["scroll", "Défilement"],
        ],
      },
      {
        path: "layout.lines",
        type: "range",
        label: "Lignes à l'écran",
        min: 1,
        max: 5,
        step: 1,
        fmt: String,
        show: (s) => s.layout.display !== "single",
      },
      {
        path: "layout.position",
        type: "seg",
        label: "Position",
        options: [
          ["top", "Haut"],
          ["center", "Centre"],
          ["bottom", "Bas"],
          ["custom", "Libre"],
        ],
      },
      {
        path: "layout.y",
        type: "range",
        label: "Hauteur",
        min: 0.05,
        max: 0.95,
        step: 0.01,
        fmt: pct,
        show: (s) => s.layout.position === "custom",
      },
      {
        path: "layout.align",
        type: "seg",
        label: "Alignement",
        options: [
          ["left", "Gauche"],
          ["center", "Centré"],
          ["right", "Droite"],
        ],
        hint: "En duo, chaque chanteur a son alignement.",
      },
      { path: "layout.margin", type: "range", label: "Marges", min: 0, max: 0.25, step: 0.01, fmt: pct },
      {
        path: "layout.animation",
        type: "select",
        label: "Apparition",
        options: [
          ["fade", "Fondu"],
          ["slide", "Glissement"],
          ["zoom", "Zoom"],
          ["none", "Aucune"],
        ],
      },
      { path: "layout.preRoll", type: "range", label: "Affichée avant le chant", min: 0.3, max: 6, step: 0.1, fmt: sec },
      { path: "layout.hold", type: "range", label: "Gardée après le chant", min: 0, max: 5, step: 0.1, fmt: sec },
    ],
  },
  {
    title: "Fond",
    open: false,
    controls: [
      {
        path: "background.type",
        type: "seg",
        label: "Type",
        options: [
          ["color", "Couleur"],
          ["gradient", "Dégradé"],
          ["image", "Image"],
          ["video", "Vidéo"],
        ],
      },
      { path: "background.color", type: "color", label: "Couleur", show: (s) => s.background.type === "color" },
      { path: "background.gradient.0", type: "color", label: "Couleur 1", show: (s) => s.background.type === "gradient" },
      { path: "background.gradient.1", type: "color", label: "Couleur 2", show: (s) => s.background.type === "gradient" },
      {
        path: "background.angle",
        type: "range",
        label: "Angle",
        min: 0,
        max: 360,
        step: 5,
        fmt: (v) => `${v}°`,
        show: (s) => s.background.type === "gradient",
      },
      {
        path: "background.media",
        type: "asset",
        label: "Fichier",
        target: "background",
        show: (s) => s.background.type === "image" || s.background.type === "video",
      },
      {
        path: "background.fit",
        type: "seg",
        label: "Cadrage",
        options: [
          ["cover", "Remplir"],
          ["contain", "Entier"],
        ],
        show: (s) => ["image", "video"].includes(s.background.type),
      },
      {
        path: "background.blur",
        type: "range",
        label: "Flou",
        min: 0,
        max: 60,
        step: 1,
        fmt: px,
        show: (s) => ["image", "video"].includes(s.background.type),
      },
      {
        path: "background.dim",
        type: "range",
        label: "Assombrir",
        min: 0,
        max: 0.9,
        step: 0.05,
        fmt: pct,
        show: (s) => s.background.type !== "color",
      },
      { path: "background.motion", type: "toggle", label: "Zoom lent (image)", show: (s) => s.background.type === "image" },
    ],
  },
  {
    title: "Image / vidéo en haut",
    open: false,
    controls: [
      { path: "top.enabled", type: "toggle", label: "Afficher un média en haut" },
      { path: "top.media", type: "asset", label: "Fichier", target: "top", show: (s) => s.top.enabled },
      { path: "top.size", type: "range", label: "Taille", min: 0.1, max: 0.85, step: 0.01, fmt: pct, show: (s) => s.top.enabled },
      { path: "top.y", type: "range", label: "Position", min: 0, max: 0.6, step: 0.01, fmt: pct, show: (s) => s.top.enabled },
      {
        path: "top.shape",
        type: "seg",
        label: "Forme",
        options: [
          ["rect", "Carré"],
          ["rounded", "Arrondi"],
          ["circle", "Rond"],
        ],
        show: (s) => s.top.enabled,
      },
      { path: "top.border", type: "range", label: "Bordure", min: 0, max: 24, step: 1, fmt: px, show: (s) => s.top.enabled },
      { path: "top.borderColor", type: "color", label: "Couleur de la bordure", show: (s) => s.top.enabled && s.top.border > 0 },
    ],
  },
  {
    title: "Duo",
    open: false,
    controls: [
      {
        path: "duo.enabled",
        type: "toggle",
        label: "Mode duo (plusieurs chanteurs)",
        hint: "Dans les paroles : A:, B: ou AB: en début de ligne, ou clique sur la pastille d'une ligne.",
      },
      ...[0, 1, 2].flatMap((i) => [
        {
          path: `duo.singers.${i}.name`,
          type: "text",
          label: i === 2 ? "Ensemble (AB)" : `Chanteur ${i ? "B" : "A"}`,
          show: (s) => s.duo.enabled,
        },
        { path: `duo.singers.${i}.color`, type: "color", label: "Couleur", show: (s) => s.duo.enabled },
        {
          path: `duo.singers.${i}.align`,
          type: "seg",
          label: "Alignement",
          options: [
            ["left", "Gauche"],
            ["center", "Centre"],
            ["right", "Droite"],
          ],
          show: (s) => s.duo.enabled,
        },
      ]),
    ],
  },
  {
    title: "Introduction",
    open: false,
    controls: [
      { path: "project.title", type: "text", label: "Titre" },
      { path: "project.artist", type: "text", label: "Artiste" },
      { path: "intro.title", type: "toggle", label: "Afficher titre et artiste au début" },
      {
        path: "intro.titleDuration",
        type: "range",
        label: "Durée du titre",
        min: 1,
        max: 12,
        step: 0.5,
        fmt: sec,
        show: (s) => s.intro.title,
      },
      { path: "intro.countdown", type: "toggle", label: "Compte à rebours avant chaque reprise (karaoké)" },
    ],
  },
];

export class Inspector {
  constructor(container, studio) {
    this.studio = studio;
    this.el = h("div", { class: "inspector" });
    this.bindings = [];
    container.append(this.el);
    this.render();
  }

  get style() {
    return this.studio.project.style;
  }

  get(path) {
    return path.startsWith("project.") ? this.studio.project[path.slice(8)] : getPath(this.style, path);
  }

  set(path, value, { live = false } = {}) {
    if (path.startsWith("project.")) this.studio.project[path.slice(8)] = value;
    else setPath(this.style, path, value);
    this.studio.styleChanged(path, { live });
    this.updateVisibility();
  }

  render() {
    this.bindings = [];
    const presets = h(
      "details",
      { class: "section", open: true },
      h("summary", {}, "Préréglages"),
      h(
        "div",
        { class: "presets" },
        PRESETS.map((p) => h("button", { class: "preset", onclick: () => this.applyPreset(p) }, p.name)),
      ),
    );
    const sections = SECTIONS.map((sec) =>
      h(
        "details",
        { class: "section", open: sec.open },
        h("summary", {}, sec.title),
        h(
          "div",
          { class: "controls" },
          sec.controls.map((c) => this.control(c)),
        ),
      ),
    );
    this.el.replaceChildren(presets, ...sections);
    this.updateVisibility();
  }

  applyPreset(preset) {
    const keep = { background: { media: this.style.background.media }, top: { media: this.style.top.media, kind: this.style.top.kind } };
    let next = mergeStyle(this.style, preset.patch);
    next = mergeStyle(next, keep);
    // Un préréglage avec image en haut garde le fond actuel s'il n'y a pas d'image.
    if (next.top.enabled && !next.top.media) next.top.media = this.studio.project.media.cover?.file || null;
    if (!next.top.media) next.top.enabled = false;
    Object.keys(this.style).forEach((k) => delete this.style[k]);
    Object.assign(this.style, next);
    this.studio.styleChanged("preset", {});
    this.refresh();
    toast(`Préréglage « ${preset.name} » appliqué.`, "ok", 2000);
  }

  /** Remet les valeurs affichées à jour (après annuler, préréglage…). */
  refresh() {
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
        const out = h("output", { class: "range-value" });
        const input = h("input", { type: "range", min: def.min, max: def.max, step: def.step, "aria-label": def.label });
        const show = (v) => (out.textContent = (def.fmt || String)(Number(v)));
        sync = () => {
          input.value = val();
          show(val());
        };
        input.addEventListener("input", () => {
          show(input.value);
          this.set(def.path, Number(input.value), { live: true });
        });
        input.addEventListener("change", () => this.set(def.path, Number(input.value)));
        node = h("div", { class: "range-row" }, input, out);
        break;
      }
      case "color": {
        const input = h("input", { type: "color", "aria-label": def.label });
        sync = () => (input.value = val() || "#000000");
        input.addEventListener("input", () => this.set(def.path, input.value, { live: true }));
        input.addEventListener("change", () => this.set(def.path, input.value));
        node = input;
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
        const select = h(
          "select",
          { class: "font-select", "aria-label": "Police" },
          own.length &&
            h(
              "optgroup",
              { label: "Mes polices" },
              own.map((f) => h("option", { value: f }, f)),
            ),
          h(
            "optgroup",
            { label: "Google Fonts" },
            FONTS.map((f) => h("option", { value: f.name, style: { fontFamily: `"${f.name}"` } }, f.name)),
          ),
          h(
            "optgroup",
            { label: "Polices de l'ordinateur" },
            SYSTEM_FONTS.map((f) => h("option", { value: f, style: { fontFamily: f } }, f)),
          ),
        );
        sync = () => (select.value = val());
        select.addEventListener("change", () => this.set(def.path, select.value));
        const fileIn = h("input", {
          type: "file",
          accept: ".ttf,.otf,.woff,.woff2",
          hidden: true,
          onchange: () => this.uploadFont(fileIn),
        });
        node = h(
          "div",
          { class: "row gap" },
          select,
          fileIn,
          h("button", { class: "btn small", title: "Ajouter ma police (TTF, OTF, WOFF)", onclick: () => fileIn.click() }, "+ Police"),
        );
        break;
      }
      case "asset": {
        const name = h("span", { class: "asset-name" });
        const fileIn = h("input", { type: "file", accept: "image/*,video/*", hidden: true, onchange: () => this.uploadAsset(def, fileIn) });
        const media = this.studio.project.media;
        const quick = [];
        if (media.cover)
          quick.push(h("button", { class: "btn small", onclick: () => this.useAsset(def, media.cover.file, "image") }, "Pochette"));
        if (media.source)
          quick.push(h("button", { class: "btn small", onclick: () => this.useAsset(def, media.source.file, "video") }, "Vidéo importée"));
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

  useAsset(def, file, kind) {
    if (def.target === "background") {
      this.style.background.media = file;
      this.style.background.type = kind;
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
