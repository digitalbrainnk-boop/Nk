// Dessin d'une image de la vidéo à l'instant t sur un contexte 2D.
// Le même code sert à l'aperçu et à l'export : ce que tu vois est ce que tu obtiens.
import { schedule, visibleAt, wordProgress, countdownAt, titleAlpha, ease } from "./timing.js";

const FALLBACK_FONTS = `"Segoe UI", Roboto, Arial, sans-serif`;

export function fontString(font, px, weight) {
  const fam = String(font.family || "Montserrat").replace(/"/g, "");
  return `${weight ?? font.weight ?? 700} ${Math.max(1, Math.round(px))}px "${fam}", ${FALLBACK_FONTS}`;
}

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

function hexToRgba(hex, a = 1) {
  const m = String(hex || "#000").replace("#", "");
  const full = m.length === 3 ? [...m].map((c) => c + c).join("") : m.padEnd(6, "0");
  const n = parseInt(full.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
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
      this.schedKey = key;
    }
    return this.sched;
  }

  /**
   * @param assets { bg: { source, width, height } | null, top: { source, width, height } | null }
   */
  draw(ctx, W, H, t, project, assets = {}) {
    const style = project.style;
    const u = Math.min(W, H) / 1080;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawBackground(ctx, W, H, t, style.background, assets.bg, u);
    const topBox = style.top?.enabled ? this.drawTop(ctx, W, H, style.top, assets.top, u) : null;
    const anchorY = this.anchorY(style.layout, H, topBox);
    const sched = this.schedule(project);
    if (style.intro?.title) {
      const a = titleAlpha(sched, t, style.intro.titleDuration ?? 4);
      if (a > 0) this.drawTitle(ctx, W, H, project, a, u, topBox);
    }
    const visible = visibleAt(sched, t, 0.3);
    if (visible.length) this.drawLines(ctx, W, H, t, project, sched, visible, anchorY, u);
    if (style.intro?.countdown && style.mode === "karaoke") {
      const cd = countdownAt(sched, t);
      if (cd) this.drawCountdown(ctx, W, cd, style, anchorY, u, sched);
    }
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

  drawBackground(ctx, W, H, t, bg, asset, u) {
    ctx.fillStyle = bg.color || "#000";
    ctx.fillRect(0, 0, W, H);
    if (bg.type === "gradient") {
      const a = ((bg.angle ?? 135) * Math.PI) / 180;
      const r = Math.abs(W * Math.sin(a)) / 2 + Math.abs(H * Math.cos(a)) / 2;
      const cx = W / 2;
      const cy = H / 2;
      const g = ctx.createLinearGradient(cx - Math.sin(a) * r, cy + Math.cos(a) * r, cx + Math.sin(a) * r, cy - Math.cos(a) * r);
      const stops = bg.gradient?.length ? bg.gradient : ["#000", "#333"];
      stops.forEach((c, i) => g.addColorStop(stops.length > 1 ? i / (stops.length - 1) : 0, c));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    } else if ((bg.type === "image" || bg.type === "video") && asset?.source && asset.width) {
      const blur = Math.max(0, bg.blur || 0) * u;
      let scale = bg.fit === "contain" ? Math.min(W / asset.width, H / asset.height) : Math.max(W / asset.width, H / asset.height);
      if (bg.type === "image" && bg.motion) scale *= 1.06 + 0.05 * Math.sin((2 * Math.PI * t) / 50);
      if (blur > 0 && bg.fit !== "contain") scale *= 1 + (blur * 3) / Math.min(W, H);
      const w = asset.width * scale;
      const h = asset.height * scale;
      ctx.save();
      if (blur > 0) ctx.filter = `blur(${blur.toFixed(1)}px)`;
      try {
        ctx.drawImage(asset.source, (W - w) / 2, (H - h) / 2, w, h);
      } catch {}
      ctx.restore();
    }
    if (bg.dim > 0 && bg.type !== "color") {
      ctx.fillStyle = `rgba(0,0,0,${Math.min(0.95, bg.dim)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  drawTop(ctx, W, H, top, asset, u) {
    if (!asset?.source || !asset.width) return null;
    const S = Math.min(W, H);
    let h = (top.size ?? 0.38) * S;
    const aspect = asset.width / asset.height;
    let w = top.shape === "circle" ? h : h * aspect;
    if (w > W * 0.9) {
      w = W * 0.9;
      if (top.shape !== "circle") h = w / aspect;
    }
    const x = (W - w) / 2;
    const y = (top.y ?? 0.08) * H;
    const path = () => {
      ctx.beginPath();
      if (top.shape === "circle") ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
      else if (top.shape === "rounded" && ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(w, h) * 0.06);
      else ctx.rect(x, y, w, h);
    };
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 30 * u;
    ctx.shadowOffsetY = 8 * u;
    ctx.fillStyle = "#000";
    path();
    ctx.fill();
    ctx.restore();
    ctx.save();
    path();
    ctx.clip();
    // Remplissage de la forme (recadrage au centre).
    const scale = Math.max(w / asset.width, h / asset.height);
    const dw = asset.width * scale;
    const dh = asset.height * scale;
    try {
      ctx.drawImage(asset.source, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
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
    return { x, y, w, h };
  }

  textFor(style, text) {
    return style.font.uppercase ? text.toLocaleUpperCase() : text;
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
    const space = this.measure(ctx, f, spacing, " ");
    const maxWidth = W * (1 - 2 * (style.layout.margin ?? 0.07));
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

  drawLines(ctx, W, H, t, project, sched, visible, anchorY, u) {
    const style = project.style;
    const layouts = new Map(visible.map((v) => [v, this.layoutLine(ctx, style, v.line, W, u)]));
    const gap = (style.font.size || 64) * u * 0.25;
    const pos = new Map();
    if (sched.mode === "scroll") {
      const sorted = [...visible].sort((a, b) => a.slot - b.slot);
      let ref = sorted.reduce((best, v) => (Math.abs(v.slot) < Math.abs(best.slot) ? v : best), sorted[0]);
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
    for (const v of visible) this.drawLine(ctx, W, t, style, v, layouts.get(v), pos.get(v), u);
  }

  drawLine(ctx, W, t, style, item, L, top, u) {
    const colors = style.colors;
    const duo = style.duo?.enabled ? style.duo.singers?.[item.line.singer || 0] : null;
    const align = duo?.align || style.layout.align || "center";
    const margin = W * (style.layout.margin ?? 0.07);
    const sungColor = duo?.color || colors.sung;
    const hl = style.highlight || "wipe";
    let alpha = item.alpha;
    let textColor = colors.text;
    let forceSung = false;
    if (item.state === "past") {
      if (style.pastLines === "dim") alpha *= 0.45;
      else if (style.pastLines === "sung" && hl !== "none") forceSung = true;
    }
    if (item.state === "future" && style.layout.display !== "scroll") alpha *= 0.92;
    if (hl === "none" && duo) textColor = duo.color;
    if (alpha <= 0.003) return;

    const anim = style.layout.animation || "fade";
    const enter = item.enter ?? 1;
    const blockH = L.rows.length * L.lineH;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (anim === "slide" && enter < 1) ctx.translate(0, (1 - enter) * 40 * u);
    if (anim === "zoom" && enter < 1) {
      const s = 0.82 + 0.18 * ease(enter);
      ctx.translate(W / 2, top + blockH / 2);
      ctx.scale(s, s);
      ctx.translate(-W / 2, -(top + blockH / 2));
    }
    ctx.font = L.font;
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${L.spacing}px`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    const ow = (colors.outlineWidth || 0) * u;
    const shadow = colors.shadowBlur > 0 && colors.shadowOpacity > 0;
    const lineStarted = t >= item.start;

    L.rows.forEach((row, r) => {
      const y = top + L.lineH * (r + 0.5);
      const x0 = align === "left" ? margin : align === "right" ? W - margin - row.width : (W - row.width) / 2;
      for (const wd of row.words) {
        const word = item.line.words[wd.i];
        const x = x0 + wd.x;
        let p = forceSung ? 1 : wordProgress(word, t);
        if (hl === "word") p = forceSung || (Number.isFinite(word.start) && t >= word.start) ? 1 : 0;
        else if (hl === "line") p = forceSung || lineStarted ? 1 : 0;
        else if (hl === "none") p = 0;
        ctx.save();
        if (hl === "word" && Number.isFinite(word.start) && t >= word.start && t < word.start + 0.3 && !forceSung) {
          const s = 1 + 0.12 * (1 - ease((t - word.start) / 0.3));
          ctx.translate(x + wd.w / 2, y);
          ctx.scale(s, s);
          ctx.translate(-(x + wd.w / 2), -y);
        }
        if (shadow) {
          ctx.shadowColor = hexToRgba(colors.shadow, colors.shadowOpacity);
          ctx.shadowBlur = colors.shadowBlur * u;
          ctx.shadowOffsetY = colors.shadowBlur * u * 0.15;
        }
        if (ow > 0) {
          ctx.strokeStyle = colors.outline;
          ctx.lineWidth = ow * 2;
          ctx.strokeText(wd.text, x, y);
          ctx.shadowColor = "transparent";
        }
        if (p < 1) {
          ctx.fillStyle = textColor;
          ctx.fillText(wd.text, x, y);
        }
        ctx.shadowColor = "transparent";
        if (p > 0) {
          ctx.fillStyle = sungColor;
          if (p < 1) {
            ctx.beginPath();
            ctx.rect(x - ow - 2, y - L.lineH, wd.w * p + ow + 2, L.lineH * 2);
            ctx.clip();
          }
          ctx.fillText(wd.text, x, y);
        }
        ctx.restore();
      }
    });
    ctx.restore();
  }

  drawTitle(ctx, W, H, project, alpha, u, topBox) {
    const style = project.style;
    const font = style.font;
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
      let size = px;
      const maxW = W * 0.86;
      const w = ctx.measureText(text).width;
      if (w > maxW) {
        size = (px * maxW) / w;
        ctx.font = fontString(font, size, weight);
      }
      if (style.colors.outlineWidth > 0) {
        ctx.strokeStyle = style.colors.outline;
        ctx.lineWidth = style.colors.outlineWidth * u * 2;
        ctx.strokeText(text, W / 2, y);
      }
      ctx.fillStyle = color;
      ctx.fillText(text, W / 2, y);
    };
    const px = (font.size || 64) * u;
    draw(title, px * 1.35, cy - (artist ? px * 0.55 : 0), style.colors.sung);
    draw(artist, px * 0.75, cy + px * 0.75, style.colors.text, Math.min(font.weight || 700, 600));
    ctx.restore();
  }

  drawCountdown(ctx, W, cd, style, anchorY, u, sched) {
    const px = (style.font.size || 64) * u;
    const n = Math.min(3, Math.ceil(cd.remaining));
    const r = px * 0.13;
    const lineH = px * (style.font.lineHeight || 1.3);
    const N = sched.mode === "scroll" ? 1 : sched.N;
    const y = anchorY - (N * lineH) / 2 - lineH * 0.55;
    ctx.save();
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.arc(W / 2 + (k - 1) * r * 3.2, y, r, 0, Math.PI * 2);
      ctx.fillStyle = k < n ? style.colors.sung : "rgba(255,255,255,0.18)";
      ctx.fill();
      if (style.colors.outlineWidth > 0) {
        ctx.lineWidth = Math.max(1, u * 2);
        ctx.strokeStyle = style.colors.outline;
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
