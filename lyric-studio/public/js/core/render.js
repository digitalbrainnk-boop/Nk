// Dessin d'une image de la vidéo à l'instant t sur un contexte 2D.
// Le même code sert à l'aperçu et à l'export : ce que tu vois est ce que tu obtiens.
// Tout ne dépend que de t (aucun état d'une image à l'autre) : l'export image par image est exact.
import { schedule, visibleAt, wordProgress, countdownAt, titleAlpha, ease, timedLines } from "./timing.js";
import { spectrumAt, waveAt } from "./dsp.js";

const FALLBACK_FONTS = `"Segoe UI", Roboto, Arial, sans-serif`;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const mod1 = (x) => ((x % 1) + 1) % 1;

export function fontString(font, px, weight) {
  const fam = String(font.family || "Montserrat").replace(/"/g, "");
  return `${font.italic ? "italic " : ""}${weight ?? font.weight ?? 700} ${Math.max(1, Math.round(px))}px "${fam}", ${FALLBACK_FONTS}`;
}

export function transformText(text, transform) {
  if (transform === "uppercase") return text.toLocaleUpperCase();
  if (transform === "lowercase") return text.toLocaleLowerCase();
  if (transform === "capitalize") return text.replace(/(^|[\s'’(-])(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase());
  return text;
}

/** Le style demande-t-il l'analyse du son (visualiseur, pulsation) ? */
export const needsAudio = (style) => style.effects?.visualizer !== "none" || style.top?.pulse > 0 || style.effects?.beatZoom > 0;

/**
 * Coupe une ligne en rangées qui tiennent dans maxWidth.
 * widths[i] = largeur du mot i, space = largeur d'une espace. Renvoie [[indices], …].
 */
export function wrapRows(widths, space, maxWidth) {
  const rows = [];
  let row = [];
  let w = 0;
  widths.forEach((ww, i) => {
    const add = row.length ? space + ww : ww;
    if (row.length && w + add > maxWidth) {
      rows.push(row);
      row = [i];
      w = ww;
    } else {
      row.push(i);
      w += add;
    }
  });
  if (row.length) rows.push(row);
  // Rangées équilibrées : on évite un mot tout seul sur la dernière rangée.
  if (rows.length === 2 && rows[1].length === 1 && rows[0].length > 2) {
    const total = widths.reduce((a, b) => a + b, 0) + space * (widths.length - 1);
    let acc = 0;
    let cut = 0;
    for (let i = 0; i < widths.length; i++) {
      acc += widths[i] + (i ? space : 0);
      if (acc >= total / 2) {
        cut = acc - total / 2 > widths[i] / 2 ? i : i + 1;
        break;
      }
    }
    cut = Math.max(1, Math.min(widths.length - 1, cut));
    const a = widths.slice(0, cut).reduce((x, y) => x + y, 0) + space * (cut - 1);
    const b = widths.slice(cut).reduce((x, y) => x + y, 0) + space * (widths.length - cut - 1);
    if (a <= maxWidth && b <= maxWidth) return [widths.slice(0, cut).map((_, i) => i), widths.slice(cut).map((_, i) => i + cut)];
  }
  return rows;
}

export function hexToRgba(hex, a = 1) {
  const m = String(hex || "#000").replace("#", "");
  const full = m.length === 3 ? [...m].map((c) => c + c).join("") : m.padEnd(6, "0");
  const n = parseInt(full.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Nombre pseudo-aléatoire stable (même graine = même valeur, image après image). */
function rand(seed) {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

const easeOutBack = (x) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
};

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (r > 0 && ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  else ctx.rect(x, y, w, h);
}

export class Renderer {
  constructor() {
    this.measures = new Map();
    this.sched = null;
    this.schedKey = "";
  }

  /** À appeler quand les paroles changent (le planning d'affichage est mis en cache). */
  invalidate() {
    this.schedKey = "";
  }

  measure(ctx, font, spacing, text) {
    const key = `${font}|${spacing}|${text}`;
    let w = this.measures.get(key);
    if (w === undefined) {
      if (this.measures.size > 6000) this.measures.clear();
      w = ctx.measureText(text).width;
      this.measures.set(key, w);
    }
    return w;
  }

  schedule(project) {
    const L = project.style.layout;
    const key = `${L.display}|${L.lines}|${L.preRoll}|${L.hold}|${project.lines.length}`;
    if (key !== this.schedKey || !this.sched || this.sched.lines !== project.lines) {
      this.sched = schedule(project.lines, L);
      this.sched.lines = project.lines;
      this.sched.lastEnd = timedLines(project.lines).reduce((m, x) => Math.max(m, x.end), 0);
      this.schedKey = key;
    }
    return this.sched;
  }

  /**
   * @param assets { bg, top, logo: { source, width, height } | null,
   *                 audio: { samples, sampleRate } | null (analyse du son),
   *                 watermark: { text } | null (formule gratuite) }
   */
  draw(ctx, W, H, t, project, assets = {}) {
    const style = project.style;
    const fx = style.effects || {};
    const u = Math.min(W, H) / 1080;
    const audio = assets.audio && needsAudio(style) ? spectrumAt(assets.audio, t, Math.max(8, Math.min(128, fx.vizBars || 48))) : null;
    const bass = audio?.bass || 0;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    this.drawBackground(ctx, W, H, t, style.background, assets.bg, u, bass * (fx.beatZoom || 0));
    if (fx.particles && fx.particles !== "none") this.drawParticles(ctx, W, H, t, fx, u);
    const topBox = style.top?.enabled ? this.topBox(W, H, style.top, assets.top) : null;
    if (fx.visualizer && fx.visualizer !== "none" && assets.audio) this.drawVisualizer(ctx, W, H, t, fx, audio, assets.audio, topBox, u);
    if (topBox) this.drawTop(ctx, t, style.top, assets.top, topBox, u, bass);
    const anchorY = this.anchorY(style.layout, H, topBox);
    const sched = this.schedule(project);
    if (style.intro?.title) {
      const a = titleAlpha(sched, t, style.intro.titleDuration ?? 4);
      if (a > 0) this.drawTitle(ctx, W, H, project, a, u, topBox);
    }
    const L = style.layout;
    const visible = visibleAt(sched, t, L.fadeIn ?? 0.3, { fadeOut: L.fadeOut ?? 0.3, animDuration: L.animDuration ?? 0.45 });
    if (visible.length) this.drawLines(ctx, W, H, t, project, sched, visible, anchorY, u);
    if (style.intro?.countdown && style.mode === "karaoke") {
      const cd = countdownAt(sched, t);
      if (cd) this.drawCountdown(ctx, W, cd, style, anchorY, u, sched);
    }
    if (style.outro?.enabled) this.drawOutro(ctx, W, H, t, project, sched, u, topBox);
    if (fx.progress && project.duration > 0) this.drawProgress(ctx, W, H, t, project.duration, fx, u);
    if (style.logo?.enabled && assets.logo) this.drawLogo(ctx, W, H, style.logo, assets.logo);
    if (assets.watermark) this.drawWatermark(ctx, W, H, assets.watermark.text, u);
    ctx.restore();
  }

  anchorY(layout, H, topBox) {
    const below = topBox ? topBox.y + topBox.h : 0;
    switch (layout.position) {
      case "top":
        return topBox ? below + H * 0.1 : H * 0.18;
      case "center":
        return topBox ? below + (H - below) * 0.45 : H * 0.5;
      case "custom":
        return H * (layout.y ?? 0.75);
      default:
        return H * 0.8;
    }
  }

  // ---------- Fond ----------
  drawBackground(ctx, W, H, t, bg, asset, u, beat) {
    ctx.fillStyle = bg.color || "#000";
    ctx.fillRect(0, 0, W, H);
    if (bg.type === "gradient") {
      const stops = (bg.gradient || []).filter(Boolean);
      if (!stops.length) stops.push(bg.color || "#000");
      let g;
      if (bg.gradientType === "radial") {
        g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2);
      } else {
        const a = (((bg.angle ?? 135) + (bg.animate ? t * 8 : 0)) * Math.PI) / 180;
        const r = Math.abs(W * Math.sin(a)) / 2 + Math.abs(H * Math.cos(a)) / 2;
        g = ctx.createLinearGradient(W / 2 - Math.sin(a) * r, H / 2 + Math.cos(a) * r, W / 2 + Math.sin(a) * r, H / 2 - Math.cos(a) * r);
      }
      stops.forEach((c, i) => g.addColorStop(stops.length > 1 ? i / (stops.length - 1) : 0, c));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    } else if ((bg.type === "image" || bg.type === "video") && asset?.source && asset.width) {
      const blur = Math.max(0, bg.blur || 0) * u;
      let scale = bg.fit === "contain" ? Math.min(W / asset.width, H / asset.height) : Math.max(W / asset.width, H / asset.height);
      if (bg.type === "image" && bg.motion) scale *= 1.06 + 0.05 * Math.sin((2 * Math.PI * t * (bg.motionSpeed || 1)) / 50);
      if (blur > 0 && bg.fit !== "contain") scale *= 1 + (blur * 3) / Math.min(W, H);
      scale *= 1 + beat;
      const w = asset.width * scale;
      const h = asset.height * scale;
      const filters = [];
      if (blur > 0) filters.push(`blur(${blur.toFixed(1)}px)`);
      if ((bg.brightness ?? 1) !== 1) filters.push(`brightness(${bg.brightness})`);
      if ((bg.saturation ?? 1) !== 1) filters.push(`saturate(${bg.saturation})`);
      ctx.save();
      if (filters.length) ctx.filter = filters.join(" ");
      try {
        ctx.drawImage(asset.source, (W - w) / 2, (H - h) / 2, w, h);
      } catch {}
      ctx.restore();
    }
    if (bg.dim > 0 && bg.type !== "color") {
      ctx.fillStyle = `rgba(0,0,0,${Math.min(0.95, bg.dim)})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (bg.tintOpacity > 0) {
      ctx.fillStyle = hexToRgba(bg.tint, Math.min(1, bg.tintOpacity));
      ctx.fillRect(0, 0, W, H);
    }
    if (bg.vignette > 0) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) / 2);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, `rgba(0,0,0,${Math.min(1, bg.vignette)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---------- Particules ----------
  drawParticles(ctx, W, H, t, fx, u) {
    const n = Math.max(0, Math.min(300, Math.round(fx.particleCount ?? 40)));
    const size = fx.particleSize ?? 1;
    const speed = fx.particleSpeed ?? 1;
    const op = fx.particleOpacity ?? 0.7;
    const color = fx.particleColor || "#ffffff";
    ctx.save();
    for (let i = 0; i < n; i++) {
      const r = (k) => rand(i * 9 + k);
      let x, y, s, a;
      switch (fx.particles) {
        case "bokeh": {
          s = (18 + r(3) * 60) * u * size;
          x = (r(1) + 0.03 * Math.sin(t * 0.25 + r(5) * 6)) * W;
          y = mod1(r(2) - t * (0.008 + r(4) * 0.02) * speed) * (H + 2 * s) - s;
          a = op * (0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 0.7 + r(6) * 6)));
          const g = ctx.createRadialGradient(x, y, 0, x, y, s);
          g.addColorStop(0, hexToRgba(color, a));
          g.addColorStop(0.7, hexToRgba(color, a * 0.5));
          g.addColorStop(1, hexToRgba(color, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, s, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case "snow": {
          s = (2 + r(3) * 4) * u * size;
          y = mod1(r(2) + t * (0.04 + r(4) * 0.06) * speed) * (H + 2 * s) - s;
          x = r(1) * W + Math.sin(t * (0.5 + r(5)) + r(6) * 10) * 24 * u;
          ctx.fillStyle = hexToRgba(color, op * (0.5 + r(7) * 0.5));
          ctx.beginPath();
          ctx.arc(x, y, s, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case "stars": {
          s = (1 + r(3) * 2.5) * u * size;
          x = r(1) * W;
          y = r(2) * H;
          a = op * (0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * (1 + r(4) * 3) * speed + r(5) * 10)));
          ctx.fillStyle = hexToRgba(color, a);
          ctx.beginPath();
          ctx.arc(x, y, s, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case "sparkles": {
          s = (5 + r(3) * 12) * u * size;
          x = r(1) * W;
          y = r(2) * H;
          a = op * Math.max(0, Math.sin(t * (1.2 + r(4) * 2) * speed + r(5) * 10)) ** 3;
          if (a < 0.02) break;
          ctx.fillStyle = hexToRgba(color, a);
          ctx.beginPath();
          for (let k = 0; k < 8; k++) {
            const ang = (k * Math.PI) / 4;
            const rr = k % 2 ? s * 0.22 : s;
            ctx.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
          }
          ctx.closePath();
          ctx.fill();
          break;
        }
        case "hearts": {
          s = (8 + r(3) * 18) * u * size;
          y = H + s - mod1(r(2) + t * (0.03 + r(4) * 0.05) * speed) * (H + 2 * s);
          x = r(1) * W + Math.sin(t * (0.6 + r(5)) + r(6) * 10) * 30 * u;
          ctx.fillStyle = hexToRgba(color, op * (0.4 + r(7) * 0.6));
          ctx.beginPath();
          ctx.moveTo(x, y + s * 0.3);
          ctx.bezierCurveTo(x - s, y - s * 0.4, x - s * 0.4, y - s, x, y - s * 0.45);
          ctx.bezierCurveTo(x + s * 0.4, y - s, x + s, y - s * 0.4, x, y + s * 0.3);
          ctx.fill();
          break;
        }
        case "embers": {
          s = (1.5 + r(3) * 3) * u * size;
          y = H + s - mod1(r(2) + t * (0.05 + r(4) * 0.08) * speed) * (H + 2 * s);
          x = r(1) * W + Math.sin(t * (1 + r(5) * 2) + r(6) * 10) * 18 * u;
          a = op * (0.4 + 0.6 * Math.abs(Math.sin(t * (3 + r(7) * 4) + r(8) * 10)));
          ctx.shadowColor = hexToRgba(color, a);
          ctx.shadowBlur = 8 * u;
          ctx.fillStyle = hexToRgba(color, a);
          ctx.beginPath();
          ctx.arc(x, y, s, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
      }
    }
    ctx.restore();
  }

  // ---------- Visualiseur ----------
  drawVisualizer(ctx, W, H, t, fx, audio, track, topBox, u) {
    const kind = fx.visualizer;
    const color = fx.vizColor || "#ffffff";
    const h = (fx.vizHeight ?? 0.18) * H;
    ctx.save();
    ctx.globalAlpha = clamp01(fx.vizOpacity ?? 0.55);
    const paint = (y0, y1) => {
      if (!fx.vizColor2) return color;
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, color);
      g.addColorStop(1, fx.vizColor2);
      return g;
    };
    if (kind === "wave") {
      const pts = waveAt(track, t, 160);
      const y = fx.vizPosition === "top" ? h : fx.vizPosition === "center" ? H / 2 : H - h;
      ctx.strokeStyle = paint(y - h, y + h);
      ctx.lineWidth = Math.max(1, 3 * u);
      ctx.lineJoin = "round";
      ctx.beginPath();
      pts.forEach((v, i) => ctx.lineTo((i / (pts.length - 1)) * W, y + Math.max(-1, Math.min(1, v * 2.5)) * h));
      ctx.stroke();
    } else if (kind === "circle") {
      const bands = audio.bands;
      const cx = topBox ? topBox.x + topBox.w / 2 : W / 2;
      const cy = topBox ? topBox.y + topBox.h / 2 : H / 2;
      const r0 = topBox ? Math.max(topBox.w, topBox.h) / 2 + 12 * u : Math.min(W, H) * 0.18;
      const n = bands.length * 2;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, ((2 * Math.PI * r0) / n) * 0.55);
      ctx.lineCap = "round";
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const v = bands[i < bands.length ? i : n - 1 - i] ** 1.5;
        const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
        const len = 4 * u + v * h * 0.8;
        ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
        ctx.lineTo(cx + Math.cos(ang) * (r0 + len), cy + Math.sin(ang) * (r0 + len));
      }
      ctx.stroke();
    } else {
      let bands = Array.from(audio.bands);
      if (kind === "mirror") bands = [...bands.slice().reverse(), ...bands];
      const n = bands.length;
      const step = W / n;
      const bw = Math.max(1, step * 0.65);
      for (let i = 0; i < n; i++) {
        const v = Math.max(0.02, bands[i] ** 1.5) * h;
        const x = i * step + (step - bw) / 2;
        if (fx.vizPosition === "top") {
          ctx.fillStyle = paint(0, h);
          roundRectPath(ctx, x, 0, bw, v, bw / 2);
        } else if (fx.vizPosition === "center") {
          ctx.fillStyle = paint(H / 2 - h, H / 2 + h);
          roundRectPath(ctx, x, H / 2 - v, bw, v * 2, bw / 2);
        } else {
          ctx.fillStyle = paint(H, H - h);
          roundRectPath(ctx, x, H - v, bw, v, bw / 2);
        }
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // ---------- Média du haut ----------
  topBox(W, H, top, asset) {
    if (!asset?.source || !asset.width) return null;
    const S = Math.min(W, H);
    let h = (top.size ?? 0.38) * S;
    const aspect = asset.width / asset.height;
    let w = top.shape === "circle" ? h : h * aspect;
    if (w > W * 0.9) {
      w = W * 0.9;
      if (top.shape !== "circle") h = w / aspect;
    }
    return { x: (W - w) / 2 + (top.x || 0) * W, y: (top.y ?? 0.08) * H, w, h };
  }

  drawTop(ctx, t, top, asset, box, u, bass) {
    const scale = 1 + (top.pulse || 0) * bass;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const w = box.w * scale;
    const h = box.h * scale;
    const x = cx - w / 2;
    const y = cy - h / 2;
    const path = () => {
      ctx.beginPath();
      if (top.shape === "circle") ctx.arc(cx, cy, Math.min(w, h) / 2, 0, Math.PI * 2);
      else if (top.shape === "rounded") roundRectPath(ctx, x, y, w, h, Math.min(w, h) * (top.radius ?? 0.06));
      else ctx.rect(x, y, w, h);
    };
    if ((top.shadow ?? 0.45) > 0) {
      ctx.save();
      ctx.shadowColor = `rgba(0,0,0,${Math.min(1, top.shadow ?? 0.45)})`;
      ctx.shadowBlur = 30 * u;
      ctx.shadowOffsetY = 8 * u;
      ctx.fillStyle = "#000";
      path();
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    path();
    ctx.clip();
    if (top.spin) {
      ctx.translate(cx, cy);
      ctx.rotate(((t * top.spin) / 60) * Math.PI * 2);
      ctx.translate(-cx, -cy);
    }
    const s = Math.max(w / asset.width, h / asset.height);
    const dw = asset.width * s;
    const dh = asset.height * s;
    try {
      ctx.drawImage(asset.source, cx - dw / 2, cy - dh / 2, dw, dh);
    } catch {}
    ctx.restore();
    if (top.border > 0) {
      ctx.save();
      ctx.strokeStyle = top.borderColor || "#fff";
      ctx.lineWidth = top.border * u;
      path();
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---------- Paroles ----------
  textFor(style, text) {
    return transformText(text, style.font.transform);
  }

  /** Mise en page d'une ligne : rangées et position de chaque mot (relative). */
  layoutLine(ctx, style, line, W, u) {
    const font = style.font;
    const px = (font.size || 64) * u;
    const f = fontString(font, px);
    const spacing = (font.letterSpacing || 0) * u;
    ctx.font = f;
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${spacing}px`;
    const texts = line.words.map((w) => this.textFor(style, w.text));
    const widths = texts.map((tx) => this.measure(ctx, f, spacing, tx));
    const space = this.measure(ctx, f, spacing, " ") + (font.wordSpacing || 0) * u;
    const L = style.layout;
    const maxWidth = W * (1 - 2 * (L.margin ?? 0.07)) * Math.max(0.2, Math.min(1, L.maxWidth ?? 1));
    const rows = wrapRows(widths, space, maxWidth).map((idx) => {
      const width = idx.reduce((s, i) => s + widths[i], 0) + space * (idx.length - 1);
      let x = 0;
      const words = idx.map((i) => {
        const r = { i, x, w: widths[i], text: texts[i] };
        x += widths[i] + space;
        return r;
      });
      return { width, words };
    });
    return { font: f, px, spacing, rows, lineH: px * (font.lineHeight || 1.3), maxWidth };
  }

  lineX(style, line, W, rowWidth) {
    const duo = style.duo?.enabled ? style.duo.singers?.[line.singer || 0] : null;
    const align = duo?.align || style.layout.align || "center";
    const margin = W * (style.layout.margin ?? 0.07);
    const shift = (style.layout.x || 0) * W;
    return (align === "left" ? margin : align === "right" ? W - margin - rowWidth : (W - rowWidth) / 2) + shift;
  }

  drawLines(ctx, W, H, t, project, sched, visible, anchorY, u) {
    const style = project.style;
    if (style.pastLines === "hide") visible = visible.filter((v) => v.state !== "past");
    if (!visible.length) return;
    const layouts = new Map(visible.map((v) => [v, this.layoutLine(ctx, style, v.line, W, u)]));
    const gap = (style.font.size || 64) * u * (style.layout.lineGap ?? 0.25);
    const pos = new Map();
    if (sched.mode === "scroll") {
      const sorted = [...visible].sort((a, b) => a.slot - b.slot);
      const ref = sorted.reduce((best, v) => (Math.abs(v.slot) < Math.abs(best.slot) ? v : best), sorted[0]);
      const hOf = (v) => layouts.get(v).rows.length * layouts.get(v).lineH + gap;
      const ri = sorted.indexOf(ref);
      const refTop = anchorY - hOf(ref) / 2 - ref.slot * hOf(ref);
      pos.set(ref, refTop);
      for (let k = ri + 1, y = refTop + hOf(ref); k < sorted.length; k++) pos.set(sorted[k], y), (y += hOf(sorted[k]));
      for (let k = ri - 1, y = refTop; k >= 0; k--) (y -= hOf(sorted[k])), pos.set(sorted[k], y);
    } else {
      // Hauteur de chaque emplacement = la plus grande ligne qui l'occupe en ce moment.
      const N = sched.N;
      const slotH = new Array(N).fill(0);
      for (const v of visible) slotH[v.slot] = Math.max(slotH[v.slot], layouts.get(v).rows.length * layouts.get(v).lineH);
      const base = layouts.get(visible[0]).lineH;
      for (let k = 0; k < N; k++) if (!slotH[k]) slotH[k] = base;
      const total = slotH.reduce((a, b) => a + b, 0) + gap * (N - 1);
      const tops = [];
      let y = anchorY - total / 2;
      for (let k = 0; k < N; k++) (tops[k] = y), (y += slotH[k] + gap);
      for (const v of visible) {
        const L = layouts.get(v);
        pos.set(v, tops[v.slot] + (slotH[v.slot] - L.rows.length * L.lineH) / 2);
      }
    }
    // Bandeau pleine largeur derrière tout le bloc.
    const box = style.box;
    if (box?.enabled && box.full) {
      const pad = (box.padding ?? 18) * u;
      const top = Math.min(...visible.map((v) => pos.get(v))) - pad;
      const bottom = Math.max(...visible.map((v) => pos.get(v) + layouts.get(v).rows.length * layouts.get(v).lineH)) + pad;
      ctx.save();
      ctx.globalAlpha = Math.max(...visible.map((v) => v.alpha));
      ctx.fillStyle = hexToRgba(box.color, box.opacity ?? 0.45);
      roundRectPath(ctx, 0, top, W, bottom - top, (box.radius || 0) * u);
      ctx.fill();
      ctx.restore();
    }
    for (const v of visible) this.drawLine(ctx, W, t, style, v, layouts.get(v), pos.get(v), u);
  }

  drawLine(ctx, W, t, style, item, L, top, u) {
    const colors = style.colors;
    const duo = style.duo?.enabled ? style.duo.singers?.[item.line.singer || 0] : null;
    const sungColor = duo?.color || colors.sung;
    const hl = style.highlight || "wipe";
    let alpha = item.alpha;
    let textColor = colors.text;
    let forceSung = false;
    if (item.state === "past") {
      if (style.pastLines === "dim") alpha *= 0.45;
      else if (style.pastLines === "sung" && hl !== "none" && hl !== "underline") forceSung = true;
    }
    if (item.state === "future" && style.layout.display !== "scroll") alpha *= style.futureOpacity ?? 0.9;
    if (hl === "none" && duo) textColor = duo.color;
    if (alpha <= 0.003) return;

    const anim = style.layout.animation || "fade";
    const e = item.enter ?? 1;
    const blockH = L.rows.length * L.lineH;
    const rowX = L.rows.map((row) => this.lineX(style, item.line, W, row.width));
    ctx.save();
    ctx.globalAlpha = alpha;
    if (e < 1) {
      if (anim === "slide-up") ctx.translate(0, (1 - e) * 40 * u);
      else if (anim === "slide-down") ctx.translate(0, -(1 - e) * 40 * u);
      else if (anim === "slide-left") ctx.translate((1 - e) * 80 * u, 0);
      else if (anim === "slide-right") ctx.translate(-(1 - e) * 80 * u, 0);
      else if (anim === "drop") ctx.translate(0, -(1 - easeOutBack(e)) * 90 * u);
      else if (anim === "zoom") {
        const s = 0.8 + 0.2 * e;
        ctx.translate(W / 2, top + blockH / 2);
        ctx.scale(s, s);
        ctx.translate(-W / 2, -(top + blockH / 2));
      } else if (anim === "blur" && "filter" in ctx) ctx.filter = `blur(${((1 - e) * 14 * u).toFixed(1)}px)`;
    }

    // Bandeau derrière la ligne.
    const box = style.box;
    if (box?.enabled && !box.full) {
      const pad = (box.padding ?? 18) * u;
      const left = Math.min(...rowX) - pad;
      const right = Math.max(...L.rows.map((r, i) => rowX[i] + r.width)) + pad;
      ctx.save();
      ctx.filter = "none";
      ctx.fillStyle = hexToRgba(box.color, box.opacity ?? 0.45);
      roundRectPath(ctx, left, top - pad * 0.6, right - left, blockH + pad * 1.2, (box.radius ?? 14) * u);
      ctx.fill();
      ctx.restore();
    }

    // Nom du chanteur (duo).
    if (duo && style.duo.showNames && item.state !== "past") {
      ctx.save();
      ctx.font = fontString({ ...style.font, italic: false }, L.px * 0.4, 700);
      ctx.fillStyle = duo.color;
      ctx.textBaseline = "bottom";
      const a = duo.align || "center";
      ctx.textAlign = a === "left" ? "left" : a === "right" ? "right" : "center";
      const x = a === "left" ? rowX[0] : a === "right" ? rowX[0] + L.rows[0].width : rowX[0] + L.rows[0].width / 2;
      ctx.fillText(duo.name || "", x, top - L.px * 0.05);
      ctx.restore();
    }

    ctx.font = L.font;
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${L.spacing}px`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    const ow = (colors.outlineWidth || 0) * u;
    const shadow = colors.shadowBlur > 0 && colors.shadowOpacity > 0;
    const glow = (colors.glow || 0) * u || (hl === "glow" ? 22 * u : 0);
    const glowColor = colors.glowColor || sungColor;
    const lineStarted = t >= item.start;
    const textFill = (colors.textOpacity ?? 1) < 1 ? hexToRgba(textColor, colors.textOpacity) : textColor;
    // Machine à écrire : nombre de lettres déjà visibles.
    const totalChars = item.line.words.reduce((s, w) => s + w.text.length + 1, 0);
    let visibleChars = anim === "typewriter" && e < 1 ? Math.floor(e * totalChars) : Infinity;

    L.rows.forEach((row, r) => {
      const y = top + L.lineH * (r + 0.5);
      const x0 = rowX[r];
      for (const wd of row.words) {
        const word = item.line.words[wd.i];
        let text = wd.text;
        if (visibleChars !== Infinity) {
          if (visibleChars <= 0) continue;
          if (visibleChars < text.length) text = text.slice(0, visibleChars);
          visibleChars -= wd.text.length + 1;
        }
        const x = x0 + wd.x;
        const timed = Number.isFinite(word.start);
        const started = timed && t >= word.start;
        const active = timed && t >= word.start && t < word.end;
        let p = forceSung ? 1 : wordProgress(word, t);
        if (hl === "word" || hl === "bounce" || hl === "scale") p = forceSung || started ? 1 : 0;
        else if (hl === "line") p = forceSung || lineStarted ? 1 : 0;
        else if (hl === "none" || hl === "underline") p = 0;
        ctx.save();
        // Mouvement du mot chanté.
        let dy = 0;
        let s = 1;
        if (!forceSung && timed) {
          if (hl === "word" && started && t < word.start + 0.3) s = 1 + 0.12 * (1 - ease((t - word.start) / 0.3));
          if (hl === "bounce" && active) dy = -0.22 * L.px * Math.sin(Math.PI * wordProgress(word, t));
          if (hl === "scale") s = 1 + 0.14 * clamp01((t - word.start) / 0.1) * clamp01((word.end + 0.12 - t) / 0.12);
        }
        if (s !== 1 || dy) {
          ctx.translate(x + wd.w / 2, y + dy);
          ctx.scale(s, s);
          ctx.translate(-(x + wd.w / 2), -y);
        }
        if (shadow) {
          ctx.shadowColor = hexToRgba(colors.shadow, colors.shadowOpacity);
          ctx.shadowBlur = colors.shadowBlur * u;
          ctx.shadowOffsetX = (colors.shadowX || 0) * u;
          ctx.shadowOffsetY = (colors.shadowY ?? 2) * u;
        }
        if (ow > 0) {
          ctx.strokeStyle = colors.outline;
          ctx.lineWidth = ow * 2;
          ctx.strokeText(text, x, y);
          ctx.shadowColor = "transparent";
        }
        if (p < 1) {
          ctx.fillStyle = textFill;
          ctx.fillText(text, x, y);
        }
        ctx.shadowColor = "transparent";
        if (p > 0) {
          if (p < 1) {
            ctx.beginPath();
            ctx.rect(x - ow - 2, y - L.lineH, wd.w * p + ow + 2, L.lineH * 2);
            ctx.clip();
          }
          if (glow > 0 && (active || hl === "glow" || colors.glow > 0)) {
            ctx.shadowColor = glowColor;
            ctx.shadowBlur = glow;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
          }
          if (colors.sungOutline && ow > 0) {
            ctx.strokeStyle = colors.sungOutline;
            ctx.lineWidth = ow * 2;
            ctx.strokeText(text, x, y);
            ctx.shadowColor = "transparent";
          }
          if (colors.sungGradient && !duo) {
            const g = ctx.createLinearGradient(x, y - L.px / 2, x + wd.w, y + L.px / 2);
            g.addColorStop(0, sungColor);
            g.addColorStop(1, colors.sung2 || sungColor);
            ctx.fillStyle = g;
          } else ctx.fillStyle = sungColor;
          ctx.fillText(text, x, y);
        }
        if (hl === "underline" && timed) {
          const q = forceSung ? 1 : wordProgress(word, t);
          if (q > 0) {
            ctx.shadowColor = "transparent";
            ctx.fillStyle = sungColor;
            ctx.fillRect(x, y + L.px * 0.52, wd.w * q, Math.max(2, L.px * 0.08));
          }
        }
        ctx.restore();
      }
    });
    ctx.restore();
  }

  drawTitle(ctx, W, H, project, alpha, u, topBox) {
    const style = project.style;
    const font = style.font;
    const intro = style.intro || {};
    const title = this.textFor(style, project.title || "");
    const artist = this.textFor(style, project.artist || "");
    const cy = topBox ? topBox.y + topBox.h + (H - topBox.y - topBox.h) * 0.4 : H * 0.48;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const draw = (text, px, y, color, weight) => {
      if (!text) return;
      ctx.font = fontString(font, px, weight);
      if ("letterSpacing" in ctx) ctx.letterSpacing = `${(font.letterSpacing || 0) * u}px`;
      const maxW = W * 0.86;
      const w = ctx.measureText(text).width;
      if (w > maxW) ctx.font = fontString(font, (px * maxW) / w, weight);
      if (style.colors.outlineWidth > 0) {
        ctx.strokeStyle = style.colors.outline;
        ctx.lineWidth = style.colors.outlineWidth * u * 2;
        ctx.strokeText(text, W / 2, y);
      }
      ctx.fillStyle = color;
      ctx.fillText(text, W / 2, y);
    };
    const px = (font.size || 64) * u;
    const tpx = px * (intro.titleSize ?? 1.35);
    draw(title, tpx, cy - (artist ? tpx * 0.42 : 0), intro.titleColor || style.colors.sung);
    draw(artist, px * 0.75, cy + tpx * 0.55, intro.artistColor || style.colors.text, Math.min(font.weight || 700, 600));
    ctx.restore();
  }

  drawCountdown(ctx, W, cd, style, anchorY, u, sched) {
    const px = (style.font.size || 64) * u;
    const n = Math.min(3, Math.ceil(cd.remaining));
    const r = px * 0.13;
    const lineH = px * (style.font.lineHeight || 1.3);
    const N = sched.mode === "scroll" ? 1 : sched.N;
    const y = anchorY - (N * lineH) / 2 - lineH * 0.55;
    const color = style.intro?.countdownColor || style.colors.sung;
    ctx.save();
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.arc(W / 2 + (style.layout.x || 0) * W + (k - 1) * r * 3.2, y, r, 0, Math.PI * 2);
      ctx.fillStyle = k < n ? color : "rgba(255,255,255,0.18)";
      ctx.fill();
      if (style.colors.outlineWidth > 0) {
        ctx.lineWidth = Math.max(1, u * 2);
        ctx.strokeStyle = style.colors.outline;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawOutro(ctx, W, H, t, project, sched, u, topBox) {
    const o = project.style.outro;
    const dur = project.duration || 0;
    if (!dur || !o.text) return;
    const start = Math.max((sched.lastEnd || 0) + 0.8, dur - (o.duration ?? 4));
    if (t < start) return;
    const style = project.style;
    const px = (style.font.size || 64) * u * 1.1;
    const cy = topBox ? topBox.y + topBox.h + (H - topBox.y - topBox.h) * 0.45 : H * 0.5;
    ctx.save();
    ctx.globalAlpha = clamp01((t - start) / 0.8);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const text = this.textFor(style, o.text);
    ctx.font = fontString(style.font, px);
    const w = ctx.measureText(text).width;
    if (w > W * 0.86) ctx.font = fontString(style.font, (px * W * 0.86) / w);
    if (style.colors.outlineWidth > 0) {
      ctx.strokeStyle = style.colors.outline;
      ctx.lineWidth = style.colors.outlineWidth * u * 2;
      ctx.strokeText(text, W / 2, cy);
    }
    ctx.fillStyle = o.color || style.colors.sung;
    ctx.fillText(text, W / 2, cy);
    ctx.restore();
  }

  drawProgress(ctx, W, H, t, duration, fx, u) {
    const h = Math.max(1, (fx.progressHeight ?? 6) * u);
    const y = fx.progressPosition === "top" ? 0 : H - h;
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(0, y, W, h);
    ctx.fillStyle = fx.progressColor || "#ffd23f";
    ctx.fillRect(0, y, W * clamp01(t / duration), h);
    ctx.restore();
  }

  drawLogo(ctx, W, H, logo, asset) {
    if (!asset?.source || !asset.width) return;
    const S = Math.min(W, H);
    const w = (logo.size ?? 0.12) * S * Math.min(2.5, asset.width / asset.height);
    const h = (w * asset.height) / asset.width;
    const m = (logo.margin ?? 0.03) * S;
    const pos = logo.position || "top-right";
    const x = pos.endsWith("left") ? m : pos.endsWith("right") ? W - m - w : (W - w) / 2;
    const y = pos.startsWith("top") ? m : H - m - h;
    ctx.save();
    ctx.globalAlpha = clamp01(logo.opacity ?? 0.85);
    try {
      ctx.drawImage(asset.source, x, y, w, h);
    } catch {}
    ctx.restore();
  }

  /** Filigrane de la formule gratuite. */
  drawWatermark(ctx, W, H, text, u) {
    if (!text) return;
    ctx.save();
    ctx.font = `700 ${Math.round(26 * u)}px ${FALLBACK_FONTS}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    const w = ctx.measureText(text).width;
    const pad = 14 * u;
    const x = W - 24 * u;
    const y = H - 34 * u;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    roundRectPath(ctx, x - w - pad, y - 20 * u, w + pad * 2, 40 * u, 20 * u);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillText(text, x + pad - 14 * u, y);
    ctx.restore();
  }
}
