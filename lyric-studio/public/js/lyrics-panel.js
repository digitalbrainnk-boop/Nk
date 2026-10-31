// Panneau des paroles : texte brut (coller, corriger) et liste des lignes (mots cliquables,
// découpe, fusion, chanteur, suppression), avec le mot chanté surligné pendant la lecture.
import { h, fmtTime, toast, promptBox } from "./ui.js";
import { parseLyrics, serializeLyrics, splitLongLines, splitLineAt, mergeWithNext, tokenize, uid, cloneLines } from "./core/lyrics.js";
import { retimeAfterEdit, shiftAll, distributeWords } from "./core/align.js";
import { lineSpan } from "./core/timing.js";

const SINGER_SHORT = ["A", "B", "AB"];

export class LyricsPanel {
  constructor(container, studio) {
    this.studio = studio;
    this.tab = studio.project.lines.length ? "lines" : "text";
    this.spans = [];
    this.rows = [];
    this.lastActive = -1;
    this.el = h("div", { class: "lyrics-panel" });
    container.append(this.el);
    this.render();
  }

  get p() {
    return this.studio.project;
  }

  render() {
    const tabs = h(
      "div",
      { class: "tabs", role: "tablist" },
      h("button", { class: `tab${this.tab === "lines" ? " on" : ""}`, role: "tab", onclick: () => this.show("lines") }, "Lignes"),
      h("button", { class: `tab${this.tab === "text" ? " on" : ""}`, role: "tab", onclick: () => this.show("text") }, "Texte"),
    );
    this.el.replaceChildren(tabs, this.tab === "text" ? this.textView() : this.linesView());
  }

  show(tab) {
    this.tab = tab;
    this.render();
  }

  /** Les lignes ont changé ailleurs (frise, annuler…) : on redessine la liste. */
  refresh() {
    if (this.tab === "lines") this.render();
  }

  // ---------- Texte ----------
  textView() {
    const text = this.p.lyricsText?.trim() ? this.p.lyricsText : serializeLyrics(this.p.lines);
    const area = h("textarea", {
      class: "lyrics-text",
      spellcheck: "false",
      placeholder:
        "Colle les paroles ici : une ligne par ligne à l'écran, une ligne vide entre les couplets.\n\n[Refrain] et [Couplet] sont ignorés.\nMode duo : A: ou B: ou AB: en début de ligne.",
      value: text,
    });
    const apply = () => {
      const next = parseLyrics(area.value);
      const hadTiming = this.p.lines.some((l) => l.words.some((w) => Number.isFinite(w.start)));
      let lines = next;
      if (hadTiming) lines = retimeAfterEdit(next, this.p.lines, { duration: this.studio.audio.duration }).lines;
      this.p.lyricsText = area.value;
      this.studio.setLines(lines, "Paroles modifiées", { keepText: true });
      toast(
        hadTiming
          ? "Paroles mises à jour : le timing des mots inchangés est gardé."
          : `${lines.length} lignes prêtes. Lance la synchronisation.`,
        "ok",
      );
      this.show("lines");
    };
    return h(
      "div",
      { class: "text-view" },
      area,
      h(
        "div",
        { class: "row gap" },
        h("button", { class: "btn primary", onclick: apply }, "Appliquer le texte"),
        h("small", { class: "hint" }, "Le timing des mots déjà calés est gardé."),
      ),
    );
  }

  // ---------- Lignes ----------
  linesView() {
    const p = this.p;
    const unsure = p.lines.reduce((n, l) => n + l.words.filter((w) => !Number.isFinite(w.start) || (w.conf ?? 1) < 0.5).length, 0);
    const maxInput = h("input", {
      type: "number",
      min: "10",
      max: "80",
      value: String(this.studio.prefs.maxChars || 32),
      class: "num",
      title: "Caractères maximum par ligne",
    });
    const shiftInput = h("input", {
      type: "number",
      step: "50",
      value: "0",
      class: "num",
      title: "Décalage en millisecondes (négatif = plus tôt)",
    });
    const tools = h(
      "div",
      { class: "lines-tools" },
      h(
        "div",
        { class: "row gap wrap" },
        h(
          "button",
          {
            class: "btn small",
            title: "Coupe les lignes plus longues que le nombre de caractères choisi",
            onclick: () => {
              const max = Math.max(10, Number(maxInput.value) || 32);
              this.studio.prefs.maxChars = max;
              const out = splitLongLines(cloneLines(p.lines), max);
              const added = out.length - p.lines.length;
              this.studio.setLines(out, "Lignes découpées");
              toast(added ? `${added} ligne(s) ajoutée(s).` : "Aucune ligne trop longue.", "ok");
            },
          },
          "✂ Découper > ",
        ),
        maxInput,
        h("span", { class: "sep" }),
        h(
          "button",
          {
            class: "btn small",
            title: "Avance ou retarde toutes les paroles",
            onclick: () => {
              const ms = Number(shiftInput.value) || 0;
              if (!ms) return;
              this.studio.setLines(shiftAll(p.lines, ms / 1000), `Paroles décalées de ${ms} ms`);
            },
          },
          "⇄ Décaler (ms)",
        ),
        shiftInput,
      ),
      unsure > 0 &&
        h(
          "div",
          { class: "row gap unsure-bar" },
          h("span", {}, `⚠ ${unsure} mot(s) à vérifier (cadre orange)`),
          h("button", { class: "btn small", onclick: () => this.nextUnsure() }, "Suivant →"),
          h(
            "button",
            { class: "btn small ghost", title: "Marquer tout le timing comme vérifié", onclick: () => this.markAllChecked() },
            "Tout valider",
          ),
        ),
    );
    const list = h("div", { class: "lines-list" });
    this.spans = [];
    this.rows = [];
    if (!p.lines.length)
      list.append(
        h("p", { class: "empty" }, "Pas encore de paroles. Colle-les dans l'onglet Texte, ou lance la synchronisation : l'IA les écrira."),
      );
    const duo = p.style.duo?.enabled;
    let prevStanza = null;
    p.lines.forEach((line, li) => {
      if (prevStanza !== null && line.stanza !== prevStanza) list.append(h("div", { class: "stanza-gap" }));
      prevStanza = line.stanza;
      const span = lineSpan(line);
      const words = line.words.map((w, wi) => {
        const el = h(
          "span",
          {
            class: "word",
            dataset: { li, wi },
            title: Number.isFinite(w.start) ? `${fmtTime(w.start, 2)} → ${fmtTime(w.end, 2)}` : "Pas encore calé",
            onclick: () => this.studio.select(li, wi, { seek: true }),
            ondblclick: () => this.editWord(li, wi, el),
          },
          w.text,
        );
        this.spans.push({ el, w, li, wi, state: "" });
        return el;
      });
      const singerColor = duo ? p.style.duo.singers[line.singer || 0]?.color : null;
      const row = h(
        "div",
        { class: "line-row", dataset: { li } },
        h(
          "button",
          { class: "line-time", title: "Écouter depuis cette ligne", onclick: () => this.studio.playFrom(li) },
          span ? fmtTime(span.start) : "–:––",
        ),
        duo &&
          h(
            "button",
            {
              class: "singer-chip",
              style: { background: singerColor },
              title: "Chanteur (cliquer pour changer)",
              onclick: () => {
                line.singer = ((line.singer || 0) + 1) % 3;
                this.studio.linesEdited("Chanteur changé");
              },
            },
            SINGER_SHORT[line.singer || 0],
          ),
        h("div", { class: "line-words" }, words),
        h(
          "div",
          { class: "line-actions" },
          h("button", { class: "icon-btn", title: "Couper la ligne avant le mot sélectionné", onclick: () => this.split(li) }, "✂"),
          h("button", { class: "icon-btn", title: "Fusionner avec la ligne suivante", onclick: () => this.merge(li) }, "⤓"),
          h("button", { class: "icon-btn", title: "Supprimer la ligne", onclick: () => this.removeLine(li) }, "🗑"),
        ),
      );
      this.rows.push(row);
      list.append(row);
    });
    list.append(h("button", { class: "btn small ghost add-line", onclick: () => this.addLine() }, "+ Ajouter une ligne à la fin"));
    this.list = list;
    this.lastActive = -1;
    this.update(this.studio.audio.time, true);
    return h("div", { class: "lines-view" }, tools, list);
  }

  /** Surlignage pendant la lecture (appelé ~15 fois par seconde). */
  update(t, force = false) {
    const sel = this.studio.selected;
    let active = -1;
    for (const s of this.spans) {
      const w = s.w;
      const timed = Number.isFinite(w.start);
      let state = !timed ? "untimed" : t >= w.end ? "sung" : t >= w.start ? "active" : "";
      if (timed && (w.conf ?? 1) < 0.5) state += " unsure";
      if (s.li === sel.line && s.wi === sel.word) state += " selected";
      if (state !== s.state || force) {
        s.el.className = `word ${state}`;
        s.state = state;
      }
      if (timed && t >= w.start && t < w.end + 0.3) active = s.li;
    }
    if (active !== this.lastActive) {
      this.rows[this.lastActive]?.classList.remove("active");
      this.rows[active]?.classList.add("active");
      if (active >= 0 && this.studio.audio.playing) this.rows[active]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      this.lastActive = active;
    }
    this.rows.forEach((r, i) => r.classList.toggle("selected", i === sel.line));
  }

  editWord(li, wi, el) {
    const line = this.p.lines[li];
    const word = line.words[wi];
    const input = h("input", { class: "word-edit", value: word.text, size: Math.max(3, word.text.length + 1) });
    el.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const commit = (save) => {
      if (done) return;
      done = true;
      if (!save) return this.render();
      const parts = tokenize(input.value.trim());
      if (!parts.length) line.words.splice(wi, 1);
      else {
        const pieces = parts.map((text) => ({ id: uid("w"), text, start: word.start, end: word.end, conf: word.conf }));
        if (parts.length > 1 && Number.isFinite(word.start)) distributeWords(pieces, word.start, word.end);
        pieces[0].id = word.id;
        line.words.splice(wi, 1, ...pieces);
      }
      if (!line.words.length) this.p.lines.splice(li, 1);
      this.studio.linesEdited("Mot modifié");
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") commit(true);
      if (e.key === "Escape") commit(false);
    });
    input.addEventListener("blur", () => commit(true));
  }

  split(li) {
    const sel = this.studio.selected;
    if (sel.line !== li || sel.word <= 0) return toast("Clique d'abord sur le mot qui doit commencer la nouvelle ligne.", "info");
    this.studio.setLines(splitLineAt(this.p.lines, li, sel.word), "Ligne coupée");
  }

  merge(li) {
    if (li >= this.p.lines.length - 1) return;
    this.studio.setLines(mergeWithNext(this.p.lines, li), "Lignes fusionnées");
  }

  removeLine(li) {
    const lines = this.p.lines.slice();
    lines.splice(li, 1);
    this.studio.setLines(lines, "Ligne supprimée");
  }

  async addLine() {
    const text = await promptBox("Nouvelle ligne", { placeholder: "Texte de la ligne", ok: "Ajouter" });
    if (!text?.trim()) return;
    const last = this.p.lines.at(-1);
    const words = tokenize(text.trim()).map((t) => ({ id: uid("w"), text: t, start: null, end: null }));
    const lastEnd = last ? lineSpan(last)?.end : null;
    if (Number.isFinite(lastEnd)) distributeWords(words, lastEnd + 0.3, lastEnd + 0.3 + words.length * 0.4);
    this.studio.setLines([...this.p.lines, { id: uid("l"), singer: 0, stanza: last?.stanza ?? 0, words }], "Ligne ajoutée");
  }

  nextUnsure() {
    const sel = this.studio.selected;
    const all = this.spans.filter((s) => !Number.isFinite(s.w.start) || (s.w.conf ?? 1) < 0.5);
    if (!all.length) return;
    const next = all.find((s) => s.li > sel.line || (s.li === sel.line && s.wi > sel.word)) || all[0];
    this.studio.select(next.li, next.wi, { seek: true });
    next.el.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  markAllChecked() {
    for (const l of this.p.lines) for (const w of l.words) if (Number.isFinite(w.start)) w.conf = 1;
    this.studio.linesEdited("Timing validé");
  }
}
