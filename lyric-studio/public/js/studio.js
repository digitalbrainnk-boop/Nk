// Le studio : aperçu, transport, paroles, frise, style, synchronisation, son et export d'un projet.
import { h, toast, modal, fmtTime, fmtSize, debounce, progressBar, field, confirmBox } from "./ui.js";
import { api, upload, waitJob, mediaUrl } from "./api.js";
import { Assets } from "./assets.js";
import { Renderer, needsAudio } from "./core/render.js";
import { normalizeStyle, frameSize, RESOLUTIONS, RESOLUTION_ORDER } from "./core/style.js";
import { analysisTrack } from "./core/dsp.js";
import { AudioEngine, channelsOf } from "./audio.js";
import { upgradePrompt } from "./session.js";
import { serializeLyrics } from "./core/lyrics.js";
import { fixTimings, distributeWords, naturalDuration } from "./core/align.js";
import { lineSpan } from "./core/timing.js";
import { History } from "./history.js";
import { ensureFont } from "./fonts.js";
import { Timeline } from "./timeline.js";
import { LyricsPanel } from "./lyrics-panel.js";
import { Inspector } from "./inspector.js";
import { openSyncDialog } from "./sync.js";
import { exportPlan, renderVideo, audioWav } from "./exporter.js";

const PREFS_KEY = "lyric-studio-prefs";
function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}
function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

export class Studio {
  constructor(root, project, session) {
    this.root = root;
    project.style = normalizeStyle(project.style);
    project.lines ||= [];
    this.project = project;
    this.session = session;
    this.caps = session.caps;
    this.prefs = loadPrefs();
    this.selected = { line: -1, word: -1 };
    this.audio = new AudioEngine();
    this.renderer = new Renderer();
    this.assets = new Assets(() => (this.needsRender = true));
    this.history = new History(project);
    this.needsRender = true;
    this.tap = null;
    this.saveState = "saved";
    this.save = debounce(() => this.saveNow(), 700);
    this.commitStyle = debounce(() => this.commit(), 700);
    this.applyPlayback = debounce(() => this.audio.setPlayback(this.project.style).then(() => this.monoCheck()), 250);
    this.onKey = (e) => this.key(e);
    this.onKeyUp = (e) => this.keyUp(e);
    // Onglet caché ou fermé : on enregistre tout de suite.
    this.onHide = () => document.visibilityState === "hidden" && this.saveState === "dirty" && this.save.flush();
    this.onBeforeUnload = (e) => {
      if (this.saveState !== "saved") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
  }

  // ---------- Construction ----------
  async mount() {
    const p = this.project;
    this.titleInput = h("input", {
      class: "title-input",
      value: p.title,
      "aria-label": "Titre de la chanson",
      oninput: () => {
        p.title = this.titleInput.value;
        this.needsRender = true;
        this.markDirty();
        this.commitStyle();
      },
    });
    this.saveLabel = h("span", { class: "save-state" }, "Enregistré");
    this.undoBtn = h("button", { class: "icon-btn", title: "Annuler (Ctrl+Z)", onclick: () => this.undo() }, "↶");
    this.redoBtn = h("button", { class: "icon-btn", title: "Rétablir (Ctrl+Maj+Z)", onclick: () => this.redo() }, "↷");
    const topbar = h(
      "header",
      { class: "topbar" },
      h("a", { class: "btn ghost", href: "#/" }, "← Projets"),
      this.titleInput,
      h(
        "div",
        { class: "topbar-actions" },
        this.saveLabel,
        this.undoBtn,
        this.redoBtn,
        h(
          "button",
          { class: "btn", title: "Son : voix séparée, instrumental", onclick: () => this.soundDialog() },
          "🎚",
          h("span", { class: "long" }, " Son"),
        ),
        h(
          "button",
          { class: "btn accent2", title: "Synchroniser les paroles", onclick: () => openSyncDialog(this) },
          "✨",
          h("span", { class: "long" }, " Synchroniser"),
        ),
        h("button", { class: "btn primary", title: "Exporter en MP4", onclick: () => this.exportDialog() }, "⬇ Exporter"),
      ),
    );
    this.canvas = h("canvas", { class: "preview", "aria-label": "Aperçu de la vidéo" });
    this.previewWrap = h("div", { class: "preview-wrap", onclick: () => this.audio.toggle() }, this.canvas);
    this.playBtn = h("button", { class: "play-btn", title: "Lecture / pause (Espace)", onclick: () => this.audio.toggle() }, "▶");
    this.timeLabel = h("span", { class: "time" }, "0:00.0");
    this.tapBar = h("div", { class: "tap-bar", hidden: true });
    const transport = h(
      "div",
      { class: "transport" },
      h("button", { class: "icon-btn", title: "Début", onclick: () => this.seek(0) }, "⏮"),
      h("button", { class: "icon-btn", title: "-5 s", onclick: () => this.seek(this.audio.time - 5) }, "−5"),
      this.playBtn,
      h("button", { class: "icon-btn", title: "+5 s", onclick: () => this.seek(this.audio.time + 5) }, "+5"),
      this.timeLabel,
      h("span", { class: "spacer" }),
      h(
        "button",
        {
          class: "btn small",
          title: "Synchroniser à la main en tapant en rythme",
          onclick: () => this.startTap(this.prefs.tapMode || "line"),
        },
        "👆",
        h("span", { class: "long" }, " Synchro à la main"),
      ),
    );
    this.leftPanel = h("aside", { class: "panel left", "data-tab": "lyrics" });
    this.rightPanel = h("aside", { class: "panel right", "data-tab": "style" });
    const stage = h("section", { class: "stage", "data-tab": "preview" }, this.previewWrap, this.tapBar, transport);
    this.tlContainer = h("div", { class: "tl-container" });
    this.waveBtn = h("button", { class: "btn small", onclick: () => this.toggleWave() }, "Onde : mixage");
    const tlTools = h(
      "div",
      { class: "tl-toolbar" },
      h("button", { class: "icon-btn", title: "Dézoomer", onclick: () => this.timeline.zoom(1 / 1.5) }, "−"),
      h("button", { class: "icon-btn", title: "Zoomer", onclick: () => this.timeline.zoom(1.5) }, "+"),
      h("button", { class: "btn small", onclick: () => this.timeline.fit() }, "Tout voir"),
      this.waveBtn,
      h(
        "small",
        { class: "hint grow" },
        "Glisse un mot ou ses bords · glisse une ligne (bande violette) · Ctrl+molette : zoom · [ et ] : début/fin du mot à la position de lecture",
      ),
    );
    const tl = h("div", { class: "timeline-wrap" }, tlTools, this.tlContainer);
    const tabs = h(
      "nav",
      { class: "mobile-tabs" },
      [
        ["lyrics", "Paroles"],
        ["preview", "Aperçu"],
        ["style", "Style"],
      ].map(([id, label]) => h("button", { class: id === "preview" ? "on" : "", onclick: (e) => this.mobileTab(id, e.target) }, label)),
    );
    this.el = h(
      "div",
      { class: "studio", "data-mobile": "preview" },
      topbar,
      h("div", { class: "studio-main" }, this.leftPanel, stage, this.rightPanel),
      tl,
      tabs,
    );
    this.root.replaceChildren(this.el);
    this.ctx = this.canvas.getContext("2d", { alpha: false });
    this.ro = new ResizeObserver(() => this.layoutPreview());
    this.ro.observe(this.previewWrap);

    this.loading = h("div", { class: "loading" }, h("div", { class: "spinner" }), h("p", {}, "Chargement du son…"));
    this.previewWrap.append(this.loading);
    try {
      await this.audio.load(p);
    } catch (e) {
      if (!e.decode) throw e;
      this.loading.querySelector("p").textContent = "Conversion du son…";
      const media = await api(`/api/projects/${p.id}/convert-audio`, { method: "POST" });
      Object.assign(p.media, media);
      await this.audio.load(p);
    }
    this.loading.remove();
    if (!p.duration || Math.abs(p.duration - this.audio.duration) > 0.5) {
      p.duration = Math.round(this.audio.duration * 100) / 100;
      this.markDirty();
    }
    this.lyrics = new LyricsPanel(this.leftPanel, this);
    this.inspector = new Inspector(this.rightPanel, this);
    this.timeline = new Timeline(this.tlContainer, this);
    this.timeline.fit();
    if (this.timeline.pps < 40) this.timeline.pps = 40;
    this.assets.update(p);
    // Formule gratuite : le filigrane apparaît déjà dans l'aperçu (et dans l'export).
    this.assets.extra.watermark = this.caps.watermark ? { text: this.caps.watermark } : null;
    this.ensureAnalysis();
    await ensureFont(p.style, p);
    await this.audio.setPlayback(p.style);
    this.monoCheck();
    this.audio.addEventListener("play", () => (this.playBtn.textContent = "❚❚"));
    this.audio.addEventListener("pause", () => (this.playBtn.textContent = "▶"));
    this.audio.addEventListener("ended", () => (this.playBtn.textContent = "▶"));
    document.addEventListener("keydown", this.onKey);
    document.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("beforeunload", this.onBeforeUnload);
    document.addEventListener("visibilitychange", this.onHide);
    this.updateUndo();
    this.layoutPreview();
    this.loop();
    if (p.sunoWarning) toast(`Suno : ${p.sunoWarning}`, "error", 7000);
    if (!p.sync?.method && (p.lines.length || this.caps.transcription.length || p.transcript)) setTimeout(() => openSyncDialog(this), 300);
  }

  monoCheck() {
    if (this.project.style.mode === "karaoke" && this.audio.monoWarning && !this.project.media.instrumental && !this.warnedMono) {
      this.warnedMono = true;
      toast("Ce son est en mono : la voix ne peut pas être retirée sans séparation (menu Son).", "error", 7000);
    }
  }

  unmount() {
    cancelAnimationFrame(this.raf);
    document.removeEventListener("keydown", this.onKey);
    document.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("beforeunload", this.onBeforeUnload);
    document.removeEventListener("visibilitychange", this.onHide);
    this.ro?.disconnect();
    this.timeline?.destroy();
    if (this.saveState !== "saved") this.save.flush();
    this.saveThumb();
    this.audio.destroy();
    this.assets.destroy();
  }

  mobileTab(id, btn) {
    this.el.dataset.mobile = id;
    btn.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === btn));
    this.layoutPreview();
  }

  // ---------- Aperçu ----------
  layoutPreview() {
    if (!this.canvas) return;
    const box = this.previewWrap.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const { width: W, height: H } = frameSize(this.project.style.aspect, "1080p");
    const scale = Math.min(box.width / W, box.height / H);
    const cw = Math.max(50, Math.floor(W * scale));
    const ch = Math.max(50, Math.floor(H * scale));
    this.canvas.style.width = `${cw}px`;
    this.canvas.style.height = `${ch}px`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // Au plus 1920 px de large pour garder un aperçu fluide.
    const k = Math.min(dpr, 1920 / cw);
    this.canvas.width = Math.round(cw * k);
    this.canvas.height = Math.round(ch * k);
    this.needsRender = true;
  }

  loop() {
    let lastPanel = 0;
    let lastT = -1;
    const frame = (now) => {
      this.raf = requestAnimationFrame(frame);
      const t = this.audio.time;
      const playing = this.audio.playing;
      this.assets.sync(t, playing);
      if (playing || this.needsRender || t !== lastT) {
        this.renderer.draw(this.ctx, this.canvas.width, this.canvas.height, t, this.project, this.assets.current());
        this.needsRender = false;
        lastT = t;
      }
      this.timeline.setTime(t, playing);
      if (now - lastPanel > 66) {
        lastPanel = now;
        this.lyrics.update(t);
        this.timeLabel.textContent = `${fmtTime(t)} / ${fmtTime(this.audio.duration, 0)}`;
      }
    };
    this.raf = requestAnimationFrame(frame);
  }

  seek(t) {
    this.audio.seek(t);
    this.needsRender = true;
    this.timeline.reveal(this.audio.time);
  }

  playFrom(li) {
    const span = lineSpan(this.project.lines[li]);
    this.select(li, -1, { seek: false });
    if (span) {
      this.seek(Math.max(0, span.start - 0.8));
      this.audio.play();
    }
  }

  select(li, wi, { seek = false } = {}) {
    this.selected = { line: li, word: wi };
    const w = this.project.lines[li]?.words[wi];
    const span = wi < 0 ? lineSpan(this.project.lines[li] || { words: [] }) : null;
    if (seek && !this.audio.playing) {
      if (w && Number.isFinite(w.start)) this.seek(w.start);
      else if (span) this.seek(span.start);
    }
    this.timeline.invalidate();
    this.lyrics.update(this.audio.time, true);
  }

  // ---------- Modifications ----------
  markDirty() {
    this.saveState = "dirty";
    this.saveLabel.textContent = "Modifications…";
    this.saveLabel.className = "save-state dirty";
    this.save();
  }

  async saveNow() {
    this.saveState = "saving";
    try {
      const { updatedAt } = await api(`/api/projects/${this.project.id}`, { method: "PUT", json: this.project });
      this.project.updatedAt = updatedAt;
      if (this.saveState === "saving") {
        this.saveState = "saved";
        this.saveLabel.textContent = "Enregistré ✓";
        this.saveLabel.className = "save-state";
      }
      if (!this.thumbAt || Date.now() - this.thumbAt > 60_000) this.saveThumb();
    } catch (e) {
      this.saveState = "dirty";
      this.saveLabel.textContent = "Non enregistré !";
      this.saveLabel.className = "save-state error";
      toast(`Enregistrement impossible : ${e.message}`, "error");
    }
  }

  /** Petite image du projet pour la liste. */
  saveThumb() {
    const lines = this.project.lines;
    if (!this.audio.duration) return;
    this.thumbAt = Date.now();
    const first = lines.map(lineSpan).find(Boolean);
    const t = first ? first.start + 0.4 : Math.min(5, this.audio.duration / 3);
    const { width, height } = frameSize(this.project.style.aspect, "720p");
    const k = 360 / Math.max(width, height);
    const c = document.createElement("canvas");
    c.width = Math.round(width * k);
    c.height = Math.round(height * k);
    new Renderer().draw(c.getContext("2d"), c.width, c.height, t, this.project, this.assets.current());
    c.toBlob(
      (blob) =>
        blob &&
        api(`/api/projects/${this.project.id}/thumb`, { method: "PUT", body: blob, headers: { "content-type": "image/jpeg" } }).catch(
          () => {},
        ),
      "image/jpeg",
      0.8,
    );
  }

  commit() {
    if (this.history.commit(this.project)) this.updateUndo();
  }

  updateUndo() {
    this.undoBtn.disabled = !this.history.canUndo();
    this.redoBtn.disabled = !this.history.canRedo();
  }

  /** Remplace toutes les lignes. */
  setLines(lines, label, { keepText = false } = {}) {
    this.project.lines = lines;
    this.linesEdited(label, { keepText });
  }

  /** Les lignes ont été modifiées (contenu, découpe, chanteur…). */
  linesEdited(label, { keepText = false } = {}) {
    if (!keepText) this.project.lyricsText = serializeLyrics(this.project.lines);
    this.renderer.invalidate();
    this.needsRender = true;
    this.timeline?.invalidate();
    this.lyrics?.refresh();
    this.commit();
    this.markDirty();
  }

  /** Seul le timing a bougé (frise, synchro à la main). commit = fin du geste. */
  timingChanged(commit) {
    this.renderer.invalidate();
    this.needsRender = true;
    this.timeline.invalidate();
    if (commit) {
      this.lyrics.refresh();
      this.commit();
      this.markDirty();
    } else this.lyrics.update(this.audio.time, true);
  }

  /** Le visualiseur et les effets qui suivent les basses ont besoin du son analysé (calculé une fois). */
  ensureAnalysis() {
    if (this.assets.extra.audio || !this.audio.buffers.original || !needsAudio(this.project.style)) return;
    const o = this.audio.buffers.original;
    this.assets.extra.audio = analysisTrack(channelsOf(o), o.sampleRate);
    this.needsRender = true;
  }

  styleChanged(path, { live = false } = {}) {
    const p = this.project;
    this.needsRender = true;
    if (path.startsWith("effects") || path.startsWith("top") || path === "preset") this.ensureAnalysis();
    if (path.startsWith("layout") || path === "preset") this.renderer.invalidate();
    if (path.startsWith("font") || path === "preset")
      ensureFont(p.style, p).then(() => ((this.needsRender = true), this.renderer.measures.clear()));
    if (path === "mode" || path === "guideVocals" || path === "preset") this.applyPlayback();
    if (path.startsWith("background") || path.startsWith("top") || path.startsWith("logo") || path === "preset") this.assets.update(p);
    if (path === "aspect" || path === "preset") this.layoutPreview();
    if (path.startsWith("duo") || path === "preset") {
      this.timeline.invalidate();
      if (!live) this.lyrics.refresh();
    }
    if (path === "project.title") this.titleInput.value = p.title;
    this.markDirty();
    if (live) this.commitStyle();
    else this.commitStyle.flush();
  }

  undo() {
    if (!this.history.undo(this.project)) return;
    this.afterHistory();
  }

  redo() {
    if (!this.history.redo(this.project)) return;
    this.afterHistory();
  }

  afterHistory() {
    this.project.style = normalizeStyle(this.project.style);
    this.titleInput.value = this.project.title;
    this.renderer.invalidate();
    this.renderer.measures.clear();
    this.needsRender = true;
    this.timeline.invalidate();
    this.lyrics.refresh();
    this.inspector.refresh();
    this.assets.update(this.project);
    this.applyPlayback();
    this.layoutPreview();
    ensureFont(this.project.style, this.project).then(() => (this.needsRender = true));
    this.updateUndo();
    this.markDirty();
  }

  toggleWave() {
    const tl = this.timeline;
    if (tl.wave === "original") {
      if (!this.project.media.vocals) return toast("Pas encore de voix séparée : menu Son ou Synchroniser.", "info");
      this.audio.stem("vocals").then(() => {
        tl.wave = "vocals";
        this.waveBtn.textContent = "Onde : voix seule";
        tl.invalidate();
      });
    } else {
      tl.wave = "original";
      this.waveBtn.textContent = "Onde : mixage";
      tl.invalidate();
    }
  }

  stemsChanged() {
    this.audio.playbackKey = null;
    for (const k of Object.keys(this.audio.buffers)) if (k !== "original") delete this.audio.buffers[k];
    delete this.audio.peaks.vocals;
    this.timeline.wave = "original";
    this.waveBtn.textContent = "Onde : mixage";
    this.applyPlayback();
  }

  // ---------- Clavier ----------
  key(e) {
    const tag = e.target?.tagName;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(tag) || e.target?.isContentEditable) return;
    if (document.querySelector(".overlay")) return;
    const mod = e.ctrlKey || e.metaKey;
    if (this.tap) {
      if (e.key === "Escape") return this.stopTap();
      if ((e.key === " " || e.key === "Enter" || e.key === "j") && !e.repeat) {
        e.preventDefault();
        return this.tapDown();
      }
      if (e.key === " " || e.key === "Enter") return e.preventDefault();
    }
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      return e.shiftKey ? this.redo() : this.undo();
    }
    if (mod && e.key.toLowerCase() === "y") return e.preventDefault(), this.redo();
    if (mod && e.key.toLowerCase() === "s") return e.preventDefault(), this.save.flush();
    const sel = this.selectedWord();
    switch (e.key) {
      case " ":
        e.preventDefault();
        return this.audio.toggle();
      case "ArrowLeft":
      case "ArrowRight": {
        e.preventDefault();
        const d = (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 0.1 : 0.01);
        if (sel && Number.isFinite(sel.start)) return this.nudge(sel, d);
        return this.seek(this.audio.time + d * 100);
      }
      case "[":
        if (sel) return this.setEdge(sel, "start");
        break;
      case "]":
        if (sel) return this.setEdge(sel, "end");
        break;
      case "Tab":
        e.preventDefault();
        return this.stepWord(e.shiftKey ? -1 : 1);
      case "Home":
        return this.seek(0);
    }
  }

  keyUp(e) {
    if (this.tap && (e.key === " " || e.key === "Enter" || e.key === "j")) {
      e.preventDefault();
      this.tapUp();
    }
  }

  selectedWord() {
    return this.project.lines[this.selected.line]?.words[this.selected.word] || null;
  }

  flat() {
    return this.project.lines.flatMap((l, li) => l.words.map((w, wi) => ({ w, li, wi })));
  }

  nudge(w, d) {
    const all = this.flat().filter((f) => Number.isFinite(f.w.start));
    const k = all.findIndex((f) => f.w === w);
    const min = k > 0 ? all[k - 1].w.end : 0;
    const max = k < all.length - 1 ? all[k + 1].w.start : this.audio.duration;
    const len = w.end - w.start;
    const s = Math.max(min, Math.min(max - len, w.start + d));
    w.start = Math.round(s * 1000) / 1000;
    w.end = Math.round((s + len) * 1000) / 1000;
    w.conf = 1;
    this.timingChanged(false);
    this.commitStyle();
    this.markDirty();
  }

  setEdge(w, edge) {
    const t = Math.round(this.audio.time * 1000) / 1000;
    if (edge === "start") {
      w.start = t;
      if (!Number.isFinite(w.end) || w.end <= t) w.end = t + 0.3;
    } else {
      if (!Number.isFinite(w.start) || t <= w.start) return toast("La fin doit être après le début du mot.", "info");
      w.end = t;
    }
    w.conf = 1;
    fixTimings(this.project.lines);
    this.timingChanged(true);
  }

  stepWord(dir) {
    const all = this.flat();
    if (!all.length) return;
    const k = all.findIndex((f) => f.li === this.selected.line && f.wi === this.selected.word);
    const next = all[Math.max(0, Math.min(all.length - 1, k < 0 ? 0 : k + dir))];
    this.select(next.li, next.wi, { seek: true });
  }

  // ---------- Synchro à la main (on tape en rythme) ----------
  startTap(mode = "line") {
    if (!this.project.lines.length) return toast("Ajoute d'abord les paroles (onglet Texte).", "info");
    this.prefs.tapMode = mode;
    savePrefs(this.prefs);
    const lines = this.project.lines;
    const startLine = Math.max(0, this.selected.line);
    const flat = this.flat();
    const startWord =
      mode === "word"
        ? Math.max(
            0,
            flat.findIndex((f) => f.li === startLine && f.wi === Math.max(0, this.selected.word)),
          )
        : 0;
    this.tap = { mode, idx: mode === "word" ? startWord : startLine, starts: [], down: false, before: JSON.stringify(lines) };
    const prevSpan = lineSpan(lines[startLine - 1] || { words: [] });
    this.seek(prevSpan ? prevSpan.end - 1 : Math.max(0, (lineSpan(lines[startLine]) ?? { start: 0 }).start - 4));
    this.renderTapBar();
    this.tapBar.hidden = false;
    this.audio.play();
  }

  renderTapBar() {
    const t = this.tap;
    const lines = this.project.lines;
    let current;
    if (t.mode === "word") {
      const f = this.flat()[t.idx];
      current = f ? `${lines[f.li].words.map((w, i) => (i === f.wi ? `[${w.text}]` : w.text)).join(" ")}` : "Terminé !";
    } else current = lines[t.idx] ? lines[t.idx].words.map((w) => w.text).join(" ") : "Terminé !";
    const btn = h(
      "button",
      {
        class: "tap-btn",
        onpointerdown: (e) => (e.preventDefault(), this.tapDown()),
        onpointerup: (e) => (e.preventDefault(), this.tapUp()),
      },
      "TAP",
    );
    this.tapBar.replaceChildren(
      h(
        "div",
        { class: "tap-info" },
        h("small", {}, t.mode === "word" ? "Prochain mot (garde appuyé pendant le mot)" : "Prochaine ligne : tape quand elle commence"),
        h("strong", {}, current),
      ),
      btn,
      h("button", { class: "btn small", onclick: () => this.stopTap() }, "Terminer (Échap)"),
    );
  }

  tapDown() {
    const t = this.tap;
    if (!t || t.down) return;
    t.down = true;
    const now = Math.round(this.audio.time * 1000) / 1000;
    const lines = this.project.lines;
    if (t.mode === "word") {
      const flat = this.flat();
      const f = flat[t.idx];
      if (!f) return this.stopTap();
      const prev = flat[t.idx - 1]?.w;
      if (prev && Number.isFinite(prev.start) && (!Number.isFinite(prev.end) || prev.end > now))
        prev.end = Math.max(prev.start + 0.05, now - 0.02);
      f.w.start = now;
      f.w.end = now + 0.25;
      f.w.conf = 1;
      t.current = f.w;
    } else {
      if (t.idx >= lines.length) return this.stopTap();
      this.finishTapLine(t.idx - 1, now);
      t.starts[t.idx] = now;
      const words = lines[t.idx].words;
      const nat = words.reduce((s, w) => s + naturalDuration(w.text), 0);
      distributeWords(words, now, now + nat);
      words.forEach((w) => (w.conf = 1));
      t.idx++;
    }
    this.timingChanged(false);
    this.renderTapBar();
  }

  /** Ligne tapée précédente : elle dure jusqu'à la suivante (au plus un peu plus que sa durée naturelle). */
  finishTapLine(li, nextStart) {
    const t = this.tap;
    const line = this.project.lines[li];
    if (!line || !Number.isFinite(t.starts[li])) return;
    const nat = line.words.reduce((s, w) => s + naturalDuration(w.text), 0);
    const end = Math.min(nextStart - 0.08, t.starts[li] + Math.max(nat * 1.8, 1.2));
    distributeWords(line.words, t.starts[li], Math.max(t.starts[li] + 0.2, end));
  }

  tapUp() {
    const t = this.tap;
    if (!t || !t.down) return;
    t.down = false;
    if (t.mode === "word" && t.current) {
      const now = Math.round(this.audio.time * 1000) / 1000;
      t.current.end = Math.max(t.current.start + 0.06, now);
      t.current = null;
      t.idx++;
      this.timingChanged(false);
      this.renderTapBar();
      if (t.idx >= this.flat().length) this.stopTap();
    }
  }

  stopTap() {
    const t = this.tap;
    if (!t) return;
    this.tap = null;
    this.tapBar.hidden = true;
    this.audio.pause();
    fixTimings(this.project.lines);
    this.timingChanged(true);
    toast("Synchro à la main enregistrée. Ajuste les détails dans la frise.", "ok");
  }

  // ---------- Son : voix séparée ----------
  soundDialog() {
    const p = this.project;
    const m = p.media;
    const status = (x) =>
      x ? `✓ ${x.method === "demucs" ? "Demucs" : x.method === "suno" ? "Suno" : x.method === "upload" ? "envoyé" : x.method}` : "—";
    const vocalsIn = h("input", { type: "file", accept: "audio/*,.flac,.wav,.mp3" });
    const instIn = h("input", { type: "file", accept: "audio/*,.flac,.wav,.mp3" });
    const actions = [];
    if (this.caps.demucs)
      actions.push(h("button", { class: "btn primary", onclick: () => (dlg.close(), this.separate("demucs")) }, "Séparer avec Demucs"));
    if (p.suno?.taskId && this.caps.kie)
      actions.push(h("button", { class: "btn", onclick: () => (dlg.close(), this.separate("suno")) }, "Séparer avec Suno (Kie.ai)"));
    const body = h(
      "div",
      { class: "sound-dialog" },
      h("p", {}, h("strong", {}, "Fichier : "), m.audio?.original || m.audio?.file, ` · ${fmtTime(this.audio.duration, 0)}`),
      h(
        "table",
        { class: "kv" },
        h("tr", {}, h("th", {}, "Voix seule"), h("td", {}, status(m.vocals))),
        h("tr", {}, h("th", {}, "Instrumental"), h("td", {}, status(m.instrumental))),
      ),
      h(
        "p",
        { class: "hint" },
        "La voix séparée rend la synchronisation plus précise et le karaoké propre. Sans elle, le karaoké retire ce qui est au centre du stéréo (souvent la voix, parfois un peu plus).",
      ),
      actions.length
        ? h("div", { class: "row gap wrap" }, actions)
        : h("p", { class: "hint" }, "Pour séparer la voix sur cet ordinateur : pip install demucs, puis relance le studio."),
      h("h3", {}, "Ou envoie tes propres pistes"),
      h("div", { class: "grid2" }, field("Voix seule", vocalsIn), field("Instrumental", instIn)),
      h(
        "div",
        { class: "row gap wrap" },
        h(
          "button",
          {
            class: "btn",
            onclick: async () => {
              if (!vocalsIn.files[0] && !instIn.files[0]) return toast("Choisis au moins un fichier.", "info");
              const form = new FormData();
              if (vocalsIn.files[0]) form.append("vocals", vocalsIn.files[0]);
              if (instIn.files[0]) form.append("instrumental", instIn.files[0]);
              try {
                const media = await upload(`/api/projects/${p.id}/stems/upload`, form);
                Object.assign(p.media, media);
                this.stemsChanged();
                dlg.close();
                toast("Pistes ajoutées.", "ok");
              } catch (e) {
                toast(e.message, "error");
              }
            },
          },
          "Envoyer",
        ),
        (m.vocals || m.instrumental) &&
          h(
            "button",
            {
              class: "btn danger",
              onclick: async () => {
                const media = await api(`/api/projects/${p.id}/stems`, { method: "DELETE" });
                delete p.media.vocals;
                delete p.media.instrumental;
                Object.assign(p.media, media);
                this.stemsChanged();
                dlg.close();
              },
            },
            "Retirer la voix séparée",
          ),
      ),
    );
    const dlg = modal({ title: "Son", body, wide: true });
  }

  async separate(method) {
    const bar = progressBar();
    const controller = new AbortController();
    const dlg = modal({
      title: "Séparation de la voix",
      body: bar.el,
      closable: false,
      actions: [{ label: "Arrêter", onClick: () => controller.abort() }],
    });
    try {
      const { job } = await api(`/api/projects/${this.project.id}/stems`, { method: "POST", json: { method } });
      const media = await waitJob(job, (j) => bar.set(j.progress, j.message || "…"), { signal: controller.signal });
      Object.assign(this.project.media, media);
      this.stemsChanged();
      toast("Voix séparée ✓", "ok");
    } catch (e) {
      if (e.upgrade) upgradePrompt(e.message);
      else if (e.name !== "AbortError") toast(e.message, "error", 7000);
    } finally {
      dlg.close();
    }
  }

  // ---------- Export ----------
  async exportDialog() {
    const p = this.project;
    if (this.tap) this.stopTap();
    this.audio.pause();
    const prefs = this.prefs;
    let resolution = prefs.resolution || "1080p";
    const fpsSel = h(
      "select",
      {},
      [24, 25, 30, 60].map((f) => h("option", { value: String(f) }, `${f} images/s`)),
    );
    fpsSel.value = String(prefs.fps || 30);
    const spans = p.lines.map(lineSpan).filter(Boolean);
    const whole = h("input", { type: "radio", name: "range", checked: true });
    const part = h("input", { type: "radio", name: "range" });
    const startIn = h("input", { type: "text", class: "num wide", value: fmtTime(spans[0] ? Math.max(0, spans[0].start - 3) : 0) });
    const endIn = h("input", {
      type: "text",
      class: "num wide",
      value: fmtTime(Math.min(this.audio.duration, (spans[0]?.start ?? 0) + 60)),
    });
    const keep = h("input", { type: "checkbox", checked: prefs.keepCopy !== false });
    const planBox = h("div", { class: "plan" }, "…");
    const maxRes = RESOLUTION_ORDER.indexOf(this.caps.maxResolution || "4K");
    if (RESOLUTION_ORDER.indexOf(resolution) > maxRes) resolution = RESOLUTION_ORDER[maxRes];
    const resButtons = Object.keys(RESOLUTIONS).map((r) => {
      const { width, height } = frameSize(p.style.aspect, r);
      const locked = RESOLUTION_ORDER.indexOf(r) > maxRes;
      return h(
        "button",
        {
          class: `seg-btn${r === resolution ? " on" : ""}${locked ? " locked" : ""}`,
          title: locked ? "Réservé aux formules supérieures" : "",
          onclick: () => {
            if (locked) return upgradePrompt(`La qualité ${r} est réservée aux formules supérieures.`);
            resolution = r;
            resButtons.forEach((b) => b.classList.toggle("on", b.dataset.r === r));
            updatePlan();
          },
          dataset: { r },
        },
        h("strong", {}, locked ? `🔒 ${r}` : r),
        h("small", {}, ` ${width}×${height}`),
      );
    });
    const sound =
      p.style.mode === "karaoke"
        ? `Karaoké : ${p.media.instrumental ? "instrumental séparé" : "voix retirée au centre"}${p.style.guideVocals ? ` + voix guide ${Math.round(p.style.guideVocals * 100)} %` : ""}`
        : "Vidéo lyrique : son d'origine avec la voix";
    const updatePlan = async () => {
      const plan = await exportPlan(p.style, resolution, Number(fpsSel.value), this.caps, this.audio.sampleRate);
      const how =
        plan.kind === "realtime"
          ? "Enregistrement en temps réel"
          : `MP4 ${plan.video.mux === "avc" ? "H.264" : plan.video.mux.toUpperCase()}${plan.audio ? " + son AAC" : ""}, calculé dans ton navigateur${plan.server.audio || plan.server.transcode ? ", terminé par le serveur (ffmpeg)" : ""}`;
      planBox.replaceChildren(h("span", {}, `⚙ ${how}`));
      if (plan.warning) planBox.append(h("p", { class: "hint warn" }, plan.warning));
    };
    updatePlan();
    fpsSel.addEventListener("change", updatePlan);
    const exportsList = h("div", { class: "exports-list" });
    const renderExports = () => {
      exportsList.replaceChildren(
        ...(p.exports || []).map((x) =>
          h(
            "div",
            { class: "export-item" },
            h("a", { href: `${mediaUrl(p, x.file)}?dl=1`, download: "" }, `⬇ ${x.label || "Vidéo"}`),
            h("small", {}, `${new Date(x.at).toLocaleString("fr-FR")} · ${fmtSize(x.size)}`),
            h(
              "button",
              {
                class: "icon-btn",
                title: "Supprimer",
                onclick: async () => {
                  if (!(await confirmBox("Supprimer cet export ?", { ok: "Supprimer", danger: true }))) return;
                  p.exports = await api(`/api/projects/${p.id}/exports/${encodeURIComponent(x.file)}`, { method: "DELETE" });
                  renderExports();
                },
              },
              "🗑",
            ),
          ),
        ),
      );
    };
    renderExports();
    const parseTime = (s) => {
      const m = String(s)
        .trim()
        .match(/^(?:(\d+):)?(\d+(?:[.,]\d+)?)$/);
      return m ? Number(m[1] || 0) * 60 + Number(m[2].replace(",", ".")) : NaN;
    };
    modal({
      title: "Exporter la vidéo",
      wide: true,
      body: h(
        "div",
        { class: "export-dialog" },
        h("div", { class: "ctl" }, h("span", { class: "field-label" }, "Qualité"), h("div", { class: "seg big" }, resButtons)),
        h("div", { class: "grid2" }, field("Fluidité", fpsSel), field("Son", h("div", { class: "readonly" }, sound))),
        h(
          "div",
          { class: "ctl" },
          h("span", { class: "field-label" }, "Durée"),
          h("label", { class: "row gap" }, whole, "Chanson entière"),
          h(
            "label",
            { class: "row gap wrap" },
            part,
            "Extrait de ",
            startIn,
            " à ",
            endIn,
            h("small", { class: "hint" }, "(pour TikTok, Reels, Statut…)"),
          ),
        ),
        h(
          "label",
          { class: "toggle" },
          keep,
          h("span", { class: "toggle-ui" }),
          h("span", {}, "Garder une copie dans le projet (re-téléchargeable plus tard)"),
        ),
        planBox,
        p.exports?.length ? h("div", {}, h("h3", {}, "Exports précédents"), exportsList) : null,
      ),
      actions: [
        { label: "Fermer", onClick: (c) => c() },
        {
          label: "⬇ Exporter",
          primary: true,
          onClick: (close) => {
            let start = 0;
            let end = this.audio.duration;
            if (part.checked) {
              start = parseTime(startIn.value);
              end = parseTime(endIn.value);
              if (!(start >= 0 && end > start + 1 && end <= this.audio.duration + 0.5))
                return toast("Extrait invalide (format 1:23.5).", "error");
              end = Math.min(end, this.audio.duration);
            }
            Object.assign(prefs, { resolution, fps: Number(fpsSel.value), keepCopy: keep.checked });
            savePrefs(prefs);
            close();
            this.runExport({ resolution, fps: Number(fpsSel.value), start, end, keepCopy: keep.checked });
          },
        },
      ],
    });
  }

  async runExport({ resolution, fps, start, end, keepCopy }) {
    const p = this.project;
    const bar = progressBar();
    const info = h("p", { class: "hint" }, "Préparation…");
    const controller = new AbortController();
    const dlg = modal({
      title: `Export ${resolution}`,
      body: h("div", {}, bar.el, info),
      closable: false,
      actions: [{ label: "Annuler", onClick: () => controller.abort() }],
    });
    const name = `${(p.title || "video").replace(/[\\/:*?"<>|]+/g, "").trim() || "video"} - ${resolution}${p.style.mode === "karaoke" ? " - karaoke" : ""}.mp4`;
    try {
      // La formule autorise-t-elle cet export ? (qualité, nombre d'exports du mois)
      const allowed = await api(`/api/projects/${p.id}/export-start`, { method: "POST", json: { resolution, duration: end - start } });
      this.assets.extra.watermark = allowed.watermark ? { text: allowed.watermark } : null;
      await ensureFont(p.style, p);
      await this.assets.ready();
      this.ensureAnalysis();
      info.textContent = "Préparation du son…";
      const channels = await this.audio.exportChannels(p.style);
      const sampleRate = this.audio.sampleRate;
      const plan = await exportPlan(p.style, resolution, fps, this.caps, sampleRate);
      info.textContent =
        plan.kind === "realtime" ? "Enregistrement en temps réel : garde cet onglet au premier plan." : "Rendu des images…";
      const renderer = new Renderer();
      const result = await renderVideo({
        project: p,
        renderer,
        assets: this.assets,
        channels,
        sampleRate,
        resolution,
        fps,
        start,
        end,
        plan,
        signal: controller.signal,
        onProgress: (x, d) => {
          bar.set(x * (plan.server.audio || plan.server.transcode ? 0.85 : 0.97), `${Math.round(x * 100)} %`);
          if (d?.left !== undefined) info.textContent = `Rendu en cours… encore ~${fmtTime(d.left, 0)}`;
        },
      });
      let url;
      let blob = result.blob;
      const server = result.needsServer.audio || result.needsServer.transcode;
      if (server) {
        info.textContent = "Envoi au serveur pour terminer (ffmpeg)…";
        const form = new FormData();
        form.append("video", blob, result.mime?.includes("webm") ? "video.webm" : "video.mp4");
        if (result.needsServer.audio) form.append("audio", audioWav(channels, sampleRate, start, end), "audio.wav");
        if (result.needsServer.transcode) form.append("transcode", "1");
        form.append("duration", String(end - start));
        form.append(
          "label",
          `${resolution}${p.style.mode === "karaoke" ? " karaoké" : ""}${start > 0 || end < this.audio.duration - 0.5 ? " (extrait)" : ""}`,
        );
        const r = await upload(`/api/projects/${p.id}/exports`, form, (x) => bar.set(0.85 + x * 0.05, "Envoi…"), {
          signal: controller.signal,
        });
        const done = r.job ? await waitJob(r.job, (j) => bar.set(0.9 + j.progress * 0.1, j.message), { signal: controller.signal }) : r;
        url = `${done.url}?dl=1`;
        blob = null;
      } else {
        url = URL.createObjectURL(blob);
        if (keepCopy) {
          info.textContent = "Copie dans le projet…";
          const form = new FormData();
          form.append("video", blob, "video.mp4");
          form.append(
            "label",
            `${resolution}${p.style.mode === "karaoke" ? " karaoké" : ""}${start > 0 || end < this.audio.duration - 0.5 ? " (extrait)" : ""}`,
          );
          await upload(`/api/projects/${p.id}/exports`, form, (x) => bar.set(0.97 + x * 0.03, "Copie…"), {
            signal: controller.signal,
          }).catch((e) => toast(`Copie non gardée : ${e.message}`, "error"));
        }
      }
      const fresh = await api(`/api/projects/${p.id}`).catch(() => null);
      if (fresh) p.exports = fresh.exports;
      bar.set(1, "Terminé ✓");
      dlg.close();
      const size = blob ? ` (${fmtSize(blob.size)})` : "";
      const a = h("a", { class: "btn primary big", href: url, download: name }, `⬇ Télécharger la vidéo${size}`);
      modal({
        title: "Vidéo prête 🎉",
        body: h(
          "div",
          { class: "done" },
          h("p", {}, name),
          a,
          result.realtime && !server && h("p", { class: "hint" }, "Format WebM (installe ffmpeg pour un vrai MP4)."),
        ),
        actions: [{ label: "Fermer", onClick: (c) => c() }],
      });
      a.click();
    } catch (e) {
      dlg.close();
      if (e.name === "AbortError") return toast("Export annulé.", "info");
      if (e.upgrade) return upgradePrompt(e.message);
      console.error(e);
      modal({
        title: "L'export a échoué",
        body: h("p", {}, e.message || String(e)),
        actions: [{ label: "OK", primary: true, onClick: (c) => c() }],
      });
    }
  }
}
