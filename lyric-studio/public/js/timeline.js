// Frise de synchronisation : forme d'onde, lignes et mots déplaçables à la souris (ou au doigt).
//   - glisser un mot : le déplacer ; glisser son bord : changer son début ou sa fin ;
//   - glisser une ligne (bande du milieu) : déplacer toute la ligne ;
//   - cliquer sur la forme d'onde : aller à cet endroit ; Ctrl + molette : zoom ; molette : défiler.
import { h } from "./ui.js";
import { lineSpan } from "./core/timing.js";

const ROWS = { ruler: [0, 18], wave: [18, 92], lines: [95, 117], words: [120, 156], mini: [160, 170] };
const HEIGHT = 172;
const EDGE = 6;

export class Timeline {
  constructor(container, studio) {
    this.studio = studio;
    this.canvas = h("canvas", { class: "tl-canvas", tabindex: "0", "aria-label": "Frise de synchronisation" });
    container.append(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this.pps = 90; // pixels par seconde
    this.scroll = 0; // seconde au bord gauche
    this.time = 0;
    this.wave = "original";
    this.drag = null;
    this.needs = true;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.canvas.addEventListener("pointerdown", (e) => this.down(e));
    this.canvas.addEventListener("pointermove", (e) => this.move(e));
    this.canvas.addEventListener("pointerup", (e) => this.up(e));
    this.canvas.addEventListener("pointercancel", (e) => this.up(e, true));
    this.canvas.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    this.canvas.addEventListener("dblclick", (e) => this.dblclick(e));
    this.resize();
  }

  get duration() {
    return this.studio.audio.duration || 1;
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = this.canvas.clientWidth || 600;
    this.canvas.style.height = `${HEIGHT}px`;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(HEIGHT * dpr);
    this.dpr = dpr;
    this.clampScroll();
    this.invalidate();
  }

  invalidate() {
    this.needs = true;
  }

  get visibleSec() {
    return this.w / this.pps;
  }

  clampScroll() {
    this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, this.duration - this.visibleSec * 0.5)));
  }

  zoom(factor, atX = this.w / 2) {
    const t = this.scroll + atX / this.pps;
    this.pps = Math.max(this.w / Math.max(1, this.duration), Math.min(800, this.pps * factor));
    this.scroll = t - atX / this.pps;
    this.clampScroll();
    this.invalidate();
  }

  fit() {
    this.pps = this.w / Math.max(1, this.duration);
    this.scroll = 0;
    this.invalidate();
  }

  /** Centre la vue sur un instant (sans changer le zoom). */
  reveal(t) {
    if (t < this.scroll || t > this.scroll + this.visibleSec * 0.9) {
      this.scroll = t - this.visibleSec * 0.25;
      this.clampScroll();
      this.invalidate();
    }
  }

  setTime(t, playing) {
    if (Math.abs(t - this.time) > 1e-4) this.invalidate();
    this.time = t;
    if (playing && !this.drag) {
      const v = this.visibleSec;
      if (t > this.scroll + v * 0.85 || t < this.scroll) {
        this.scroll = t - v * 0.15;
        this.clampScroll();
      }
    }
    if (this.needs) this.draw();
  }

  x(t) {
    return (t - this.scroll) * this.pps;
  }

  t(x) {
    return this.scroll + x / this.pps;
  }

  flatWords() {
    const out = [];
    this.studio.project.lines.forEach((l, li) => l.words.forEach((w, wi) => out.push({ li, wi, w })));
    return out;
  }

  // ---------- Dessin ----------
  draw() {
    this.needs = false;
    const { ctx, w } = this;
    const css = getComputedStyle(this.canvas);
    const accent = css.getPropertyValue("--accent").trim() || "#ff4d8d";
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = "#121219";
    ctx.fillRect(0, 0, w, HEIGHT);
    ctx.font = "11px system-ui, sans-serif";
    ctx.textBaseline = "middle";

    // Graduation
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
    const step = steps.find((s) => s * this.pps >= 70) || 120;
    ctx.fillStyle = "#1b1b25";
    ctx.fillRect(0, ROWS.ruler[0], w, ROWS.ruler[1]);
    ctx.strokeStyle = "#3a3a4a";
    ctx.fillStyle = "#9a9ab0";
    ctx.beginPath();
    for (let s = Math.floor(this.scroll / step) * step; s < this.scroll + this.visibleSec; s += step) {
      const x = Math.round(this.x(s)) + 0.5;
      ctx.moveTo(x, 10);
      ctx.lineTo(x, ROWS.ruler[1]);
      const m = Math.floor(s / 60);
      const sec = s - m * 60;
      ctx.fillText(`${m}:${(step < 1 ? sec.toFixed(step < 0.25 ? 1 : 2) : String(Math.round(sec))).padStart(2, "0")}`, x + 3, 7);
    }
    ctx.stroke();

    // Forme d'onde
    const peaks = this.studio.audio.peaks[this.wave] || this.studio.audio.peaks.original;
    const [wy0, wy1] = ROWS.wave;
    const mid = (wy0 + wy1) / 2;
    const half = (wy1 - wy0) / 2 - 2;
    if (peaks) {
      ctx.fillStyle = this.wave === "vocals" ? "#5fd0ff" : "#6d6d8f";
      for (let x = 0; x < w; x++) {
        const a = Math.floor(this.t(x) * 100);
        const b = Math.max(a + 1, Math.floor(this.t(x + 1) * 100));
        let m = 0;
        for (let i = Math.max(0, a); i < Math.min(peaks.length, b); i++) if (peaks[i] > m) m = peaks[i];
        const hh = Math.max(0.5, Math.sqrt(m) * half);
        ctx.fillRect(x, mid - hh, 1, hh * 2);
      }
    }

    // Lignes et mots
    const proj = this.studio.project;
    const sel = this.studio.selected;
    const singers = proj.style.duo?.enabled ? proj.style.duo.singers : null;
    const [ly0, ly1] = ROWS.lines;
    const [wy, wy2] = ROWS.words;
    proj.lines.forEach((line, li) => {
      const span = lineSpan(line);
      if (!span) return;
      const x0 = this.x(span.start);
      const x1 = this.x(span.end);
      if (x1 < -2 || x0 > w + 2) return;
      const color = singers ? singers[line.singer || 0]?.color || "#888" : "#7c6cff";
      ctx.fillStyle = li === sel.line ? color : `${color}99`;
      ctx.fillRect(x0, ly0, Math.max(2, x1 - x0), ly1 - ly0);
      if (x1 - x0 > 30) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, ly0, x1 - x0, ly1 - ly0);
        ctx.clip();
        ctx.fillStyle = "#fff";
        ctx.fillText(line.words.map((x) => x.text).join(" "), Math.max(x0, 0) + 4, (ly0 + ly1) / 2);
        ctx.restore();
      }
      line.words.forEach((word, wi) => {
        if (!Number.isFinite(word.start)) return;
        const a = this.x(word.start);
        const b = this.x(word.end);
        if (b < -2 || a > w + 2) return;
        const selected = li === sel.line && wi === sel.word;
        const active = this.time >= word.start && this.time < word.end;
        ctx.fillStyle = selected ? accent : active ? "#ffd23f" : wi % 2 ? "#3b3b55" : "#45456a";
        ctx.fillRect(a, wy, Math.max(1.5, b - a - 1), wy2 - wy);
        if ((word.conf ?? 1) < 0.5) {
          ctx.strokeStyle = "#ff9f1a";
          ctx.lineWidth = 2;
          ctx.strokeRect(a + 1, wy + 1, Math.max(1, b - a - 3), wy2 - wy - 2);
        }
        if (b - a > 18) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(a, wy, b - a - 2, wy2 - wy);
          ctx.clip();
          ctx.fillStyle = selected || active ? "#111" : "#e8e8f0";
          ctx.fillText(word.text, a + 3, (wy + wy2) / 2);
          ctx.restore();
        }
      });
    });

    // Vue d'ensemble (barre du bas)
    const [my0, my1] = ROWS.mini;
    ctx.fillStyle = "#1b1b25";
    ctx.fillRect(0, my0, w, my1 - my0);
    const scale = w / this.duration;
    ctx.fillStyle = "#4a4a66";
    for (const line of proj.lines) {
      const s = lineSpan(line);
      if (s) ctx.fillRect(s.start * scale, my0 + 3, Math.max(1, (s.end - s.start) * scale), my1 - my0 - 6);
    }
    ctx.strokeStyle = "#c8c8e0";
    ctx.lineWidth = 1;
    ctx.strokeRect(this.scroll * scale + 0.5, my0 + 0.5, Math.max(4, this.visibleSec * scale) - 1, my1 - my0 - 1);
    ctx.fillStyle = accent;
    ctx.fillRect(this.time * scale - 1, my0, 2, my1 - my0);

    // Tête de lecture
    const px = this.x(this.time);
    if (px >= 0 && px <= w) {
      ctx.fillStyle = accent;
      ctx.fillRect(Math.round(px) - 1, 0, 2, ROWS.words[1]);
      ctx.beginPath();
      ctx.moveTo(px - 6, 0);
      ctx.lineTo(px + 6, 0);
      ctx.lineTo(px, 8);
      ctx.fill();
    }
  }

  // ---------- Souris / doigt ----------
  hit(x, y) {
    if (y >= ROWS.mini[0]) return { zone: "mini" };
    if (y >= ROWS.words[0] && y <= ROWS.words[1]) {
      const t = this.t(x);
      const tol = EDGE / this.pps;
      for (const f of this.flatWords()) {
        const { w } = f;
        if (!Number.isFinite(w.start) || t < w.start - tol || t > w.end + tol) continue;
        const a = this.x(w.start);
        const b = this.x(w.end);
        const part = b - a > EDGE * 3 && Math.abs(x - a) <= EDGE ? "start" : b - a > EDGE * 3 && Math.abs(x - b) <= EDGE ? "end" : "body";
        if (part !== "body" || (t >= w.start && t <= w.end)) return { zone: "word", ...f, part };
      }
      return { zone: "empty" };
    }
    if (y >= ROWS.lines[0] && y <= ROWS.lines[1]) {
      const t = this.t(x);
      const li = this.studio.project.lines.findIndex((l) => {
        const s = lineSpan(l);
        return s && t >= s.start && t <= s.end;
      });
      return li >= 0 ? { zone: "line", li } : { zone: "empty" };
    }
    return { zone: "wave" };
  }

  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  down(e) {
    const { x, y } = this.pos(e);
    const hit = this.hit(x, y);
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.focus({ preventScroll: true });
    const touch = e.pointerType === "touch";
    this.drag = { hit, x0: x, t0: this.t(x), scroll0: this.scroll, moved: false, touch };
    if (hit.zone === "word") {
      const { w } = hit;
      this.drag.orig = { start: w.start, end: w.end };
      const all = this.flatWords().filter((f) => Number.isFinite(f.w.start));
      const k = all.findIndex((f) => f.w === w);
      this.drag.prevEnd = k > 0 ? all[k - 1].w.end : 0;
      this.drag.nextStart = k < all.length - 1 ? all[k + 1].w.start : this.duration;
      this.studio.select(hit.li, hit.wi, { seek: false });
    } else if (hit.zone === "line") {
      const line = this.studio.project.lines[hit.li];
      const span = lineSpan(line);
      const before = this.studio.project.lines.slice(0, hit.li).map(lineSpan).filter(Boolean).at(-1);
      const after = this.studio.project.lines
        .slice(hit.li + 1)
        .map(lineSpan)
        .find(Boolean);
      this.drag.orig = line.words.map((w) => ({ start: w.start, end: w.end }));
      this.drag.min = (before?.end ?? 0) - span.start;
      this.drag.max = (after?.start ?? this.duration) - span.end;
      this.studio.select(hit.li, -1, { seek: false });
    } else if (hit.zone === "mini") {
      this.scrollToMini(x);
    } else if (hit.zone === "wave" && !touch) {
      this.studio.seek(this.t(x));
    }
  }

  scrollToMini(x) {
    this.scroll = (x / this.w) * this.duration - this.visibleSec / 2;
    this.clampScroll();
    this.invalidate();
    this.draw();
  }

  move(e) {
    const { x, y } = this.pos(e);
    if (!this.drag) {
      const hit = this.hit(x, y);
      this.canvas.style.cursor =
        hit.zone === "word"
          ? hit.part === "body"
            ? "grab"
            : "ew-resize"
          : hit.zone === "line"
            ? "grab"
            : hit.zone === "wave"
              ? "text"
              : "default";
      return;
    }
    const d = this.drag;
    if (Math.abs(x - d.x0) > 3) d.moved = true;
    if (!d.moved) return;
    const dt = (x - d.x0) / this.pps;
    const round = (v) => Math.round(v * 1000) / 1000;
    if (d.hit.zone === "word") {
      const w = d.hit.w;
      const o = d.orig;
      if (d.hit.part === "start") w.start = round(Math.max(d.prevEnd, Math.min(o.end - 0.03, o.start + dt)));
      else if (d.hit.part === "end") w.end = round(Math.min(d.nextStart, Math.max(o.start + 0.03, o.end + dt)));
      else {
        const len = o.end - o.start;
        const s = Math.max(d.prevEnd, Math.min(d.nextStart - len, o.start + dt));
        w.start = round(s);
        w.end = round(s + len);
      }
      w.conf = 1;
      this.studio.timingChanged(false);
    } else if (d.hit.zone === "line") {
      const shift = Math.max(d.min, Math.min(d.max, dt));
      this.studio.project.lines[d.hit.li].words.forEach((w, i) => {
        if (!Number.isFinite(d.orig[i].start)) return;
        w.start = round(d.orig[i].start + shift);
        w.end = round(d.orig[i].end + shift);
        w.conf = Math.max(w.conf ?? 0, 0.5);
      });
      this.studio.timingChanged(false);
    } else if (d.hit.zone === "mini") {
      this.scrollToMini(x);
    } else if (d.hit.zone === "wave" || d.hit.zone === "empty") {
      if (d.touch || d.hit.zone === "empty") {
        this.scroll = d.scroll0 - (x - d.x0) / this.pps;
        this.clampScroll();
      } else this.studio.seek(Math.max(0, this.t(x)));
    }
    this.invalidate();
    this.draw();
  }

  up(e, cancelled = false) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const { x } = this.pos(e);
    if (d.moved && (d.hit.zone === "word" || d.hit.zone === "line")) {
      if (cancelled) {
        if (d.hit.zone === "word") Object.assign(d.hit.w, d.orig);
        else this.studio.project.lines[d.hit.li].words.forEach((w, i) => Object.assign(w, d.orig[i]));
        this.studio.timingChanged(false);
      } else this.studio.timingChanged(true);
    } else if (!d.moved) {
      if (d.hit.zone === "word") this.studio.select(d.hit.li, d.hit.wi, { seek: true });
      else if (d.hit.zone === "line") this.studio.select(d.hit.li, -1, { seek: true });
      else if (d.hit.zone === "wave" && d.touch) this.studio.seek(this.t(x));
    }
    this.invalidate();
  }

  dblclick(e) {
    const { x, y } = this.pos(e);
    const hit = this.hit(x, y);
    if (hit.zone === "word") {
      this.studio.seek(hit.w.start);
      this.studio.audio.play();
    }
  }

  wheel(e) {
    e.preventDefault();
    const { x } = this.pos(e);
    if (e.ctrlKey || e.metaKey) this.zoom(Math.exp(-e.deltaY * 0.0025), x);
    else {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      this.scroll += d / this.pps;
      this.clampScroll();
      this.invalidate();
    }
    this.draw();
  }

  destroy() {
    this.ro.disconnect();
    this.canvas.remove();
  }
}
