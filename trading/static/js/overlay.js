// Primitive Lightweight Charts : dessine directement sur le graphique les supports /
// résistances (zones), les niveaux des unités de temps supérieures, les figures
// chartistes (lignes, remplissages, étiquettes, objectifs) et le ZigZag.

import { LEVEL_COLORS, PATTERN_COLORS, STATUS_LABELS, withAlpha } from './colors.js';

const FONT = '600 11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SMALL = '500 10px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const POINT_LABELS = {
  head_shoulders: { 1: 'ÉG', 3: 'T', 5: 'ÉD' },
  inverse_head_shoulders: { 1: 'ÉG', 3: 'T', 5: 'ÉD' },
  double_top: { 1: '1', 3: '2' },
  double_bottom: { 1: '1', 3: '2' },
  triple_top: { 1: '1', 3: '2', 5: '3' },
  triple_bottom: { 1: '1', 3: '2', 5: '3' },
};

class PaneView {
  constructor(owner, layer) { this.owner = owner; this.layer = layer; }
  zOrder() { return this.layer; }
  renderer() {
    const owner = this.owner;
    const layer = this.layer;
    return {
      draw(target) {
        target.useMediaCoordinateSpace(({ context, mediaSize }) => {
          if (layer === 'bottom') owner.drawBackground(context, mediaSize);
          else owner.drawForeground(context, mediaSize);
        });
      },
    };
  }
}

export class OverlayPrimitive {
  constructor() {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
    this.times = [];
    this.step = 60;
    this.highlight = null;
    this.data = { levels: [], htf: [], patterns: [], zigzag: [] };
    this.options = { levels: true, htf: true, patterns: true, failed: false, zigzag: false };
    this.views = [new PaneView(this, 'bottom'), new PaneView(this, 'top')];
  }

  // --- API primitive ---------------------------------------------------------
  attached({ chart, series, requestUpdate }) {
    this.chart = chart; this.series = series; this.requestUpdate = requestUpdate;
  }
  detached() { this.chart = null; this.series = null; this.requestUpdate = null; }
  updateAllViews() {}
  paneViews() { return this.views; }

  // --- Données ---------------------------------------------------------------
  setTimes(times, step) {
    this.times = times;
    if (step) this.step = step;
  }
  setData(data) { Object.assign(this.data, data); this.refresh(); }
  setOptions(opts) { Object.assign(this.options, opts); this.refresh(); }
  setHighlight(id) { this.highlight = id; this.refresh(); }
  setTheme(dark) { this.tagBg = dark ? '#0b1220' : '#ffffff'; this.refresh(); }
  refresh() { if (this.requestUpdate) this.requestUpdate(); }

  // --- Coordonnées -------------------------------------------------------------
  logicalOf(t) {
    const ts = this.times;
    const n = ts.length;
    if (!n) return null;
    if (t >= ts[n - 1]) return n - 1 + (t - ts[n - 1]) / this.step;
    if (t <= ts[0]) return (t - ts[0]) / this.step;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ts[mid] <= t) lo = mid; else hi = mid;
    }
    if (ts[lo] === t) return lo;
    return lo + (t - ts[lo]) / (ts[hi] - ts[lo]);
  }
  x(t) {
    const logical = this.logicalOf(t);
    if (logical === null || !this.chart) return null;
    return this.chart.timeScale().logicalToCoordinate(logical);
  }
  y(p) { return this.series ? this.series.priceToCoordinate(p) : null; }

  // --- Fond : zones S/R et remplissages des figures ----------------------------------
  drawBackground(ctx, size) {
    if (!this.series) return;
    if (this.options.levels) for (const lv of this.data.levels) this.drawZone(ctx, size, lv);
    if (this.options.patterns) {
      for (const p of this.visiblePatterns()) this.fillPattern(ctx, p);
    }
  }

  drawZone(ctx, size, lv) {
    const y1 = this.y(lv.high), y2 = this.y(lv.low), yc = this.y(lv.price);
    if (y1 === null || y2 === null || yc === null) return;
    const color = LEVEL_COLORS[lv.kind] || LEVEL_COLORS.support;
    ctx.fillStyle = withAlpha(color, lv.major ? 0.13 : 0.07);
    ctx.fillRect(0, Math.min(y1, y2), size.width, Math.max(1, Math.abs(y2 - y1)));
    ctx.strokeStyle = withAlpha(color, lv.major ? 0.85 : 0.5);
    ctx.lineWidth = lv.major ? 1.5 : 1;
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(0, yc); ctx.lineTo(size.width, yc); ctx.stroke();
    if (lv.major) this.tag(ctx, 6, yc, `${lv.kind === 'resistance' ? 'Résistance' : 'Support'} ${lv.touches}×`, color, 0.9);
  }

  fillPattern(ctx, p) {
    const upper = p.lines.find((l) => l.role === 'upper');
    const lower = p.lines.find((l) => l.role === 'lower');
    if (!upper || !lower) return;
    const pts = [
      [this.x(upper.t1), this.y(upper.p1)], [this.x(upper.t2), this.y(upper.p2)],
      [this.x(lower.t2), this.y(lower.p2)], [this.x(lower.t1), this.y(lower.p1)],
    ];
    if (pts.some(([a, b]) => a === null || b === null)) return;
    ctx.fillStyle = withAlpha(this.colorOf(p), p.id === this.highlight ? 0.16 : 0.07);
    ctx.beginPath();
    pts.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)));
    ctx.closePath();
    ctx.fill();
  }

  // --- Premier plan : lignes, pivots, étiquettes ----------------------------------------
  drawForeground(ctx, size) {
    if (!this.series) return;
    if (this.options.htf) for (const lv of this.data.htf) this.drawHtf(ctx, size, lv);
    if (this.options.zigzag) this.drawZigzag(ctx);
    if (this.options.patterns) for (const p of this.visiblePatterns()) this.drawPattern(ctx, size, p);
  }

  drawHtf(ctx, size, lv) {
    const y = this.y(lv.price);
    if (y === null) return;
    ctx.strokeStyle = this.tagBg === '#ffffff' ? 'rgba(71, 85, 105, 0.8)' : withAlpha(LEVEL_COLORS.htf, 0.7);
    ctx.lineWidth = 1.2;
    ctx.setLineDash([8, 5]);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size.width, y); ctx.stroke();
    ctx.setLineDash([]);
    const text = `${lv.timeframe} ${lv.kind === 'resistance' ? 'résistance' : 'support'}`;
    ctx.font = SMALL;
    const w = ctx.measureText(text).width;
    this.tag(ctx, size.width - w - 14, y, text, this.tagBg === '#ffffff' ? '#475569' : LEVEL_COLORS.htf, 0.9);
  }

  drawZigzag(ctx) {
    const pts = this.data.zigzag;
    if (pts.length < 2) return;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    let started = false;
    for (const p of pts) {
      const x = this.x(p.t), y = this.y(p.p);
      if (x === null || y === null) continue;
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  drawPattern(ctx, size, p) {
    const color = this.colorOf(p);
    const hl = p.id === this.highlight;
    const alpha = p.status === 'failed' ? 0.45 : (p.status === 'forming' ? 0.85 : 1);

    // Ligne brisée reliant les pivots.
    ctx.setLineDash([]);
    ctx.strokeStyle = withAlpha(color, alpha * 0.55);
    ctx.lineWidth = hl ? 2 : 1.2;
    ctx.beginPath();
    let started = false;
    for (const pt of p.points) {
      const x = this.x(pt.t), y = this.y(pt.p);
      if (x === null || y === null) continue;
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Lignes structurantes.
    for (const ln of p.lines) {
      const x1 = this.x(ln.t1), y1 = this.y(ln.p1), x2 = this.x(ln.t2), y2 = this.y(ln.p2);
      if ([x1, y1, x2, y2].some((v) => v === null)) continue;
      ctx.strokeStyle = withAlpha(color, alpha);
      ctx.lineWidth = (ln.role === 'target' ? 1.5 : 2) + (hl ? 1 : 0);
      ctx.setLineDash(ln.role === 'neckline' ? [7, 4] : ln.role === 'target' ? [2, 3] : []);
      if (ln.role === 'pole') ctx.strokeStyle = withAlpha(color, alpha * 0.6);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      if (ln.extend && x2 > x1) {
        // Projection de la figure en cours de formation.
        const dx = (x2 - x1) * 0.35, dy = (y2 - y1) * 0.35;
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = withAlpha(color, alpha * 0.45);
        ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 + dx, y2 + dy); ctx.stroke();
      }
      if (ln.role === 'target') {
        ctx.setLineDash([]);
        this.tag(ctx, x2 + 4, y2, 'Objectif', color, 0.85);
      }
    }
    ctx.setLineDash([]);

    // Pivots et repères (ÉG / T / ÉD, 1 / 2 / 3).
    const labels = POINT_LABELS[p.key] || {};
    p.points.forEach((pt, i) => {
      const x = this.x(pt.t), y = this.y(pt.p);
      if (x === null || y === null) return;
      ctx.fillStyle = withAlpha(color, alpha);
      ctx.beginPath(); ctx.arc(x, y, hl ? 3.5 : 2.5, 0, Math.PI * 2); ctx.fill();
      if (labels[i]) {
        ctx.font = FONT;
        ctx.textAlign = 'center';
        ctx.fillStyle = withAlpha(color, alpha);
        ctx.fillText(labels[i], x, pt.k === 'H' ? y - 8 : y + 16);
        ctx.textAlign = 'left';
      }
    });

    // Point de cassure.
    if (p.breakout_time && p.breakout_level !== null) {
      const x = this.x(p.breakout_time), y = this.y(p.breakout_level);
      if (x !== null && y !== null) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y);
        ctx.closePath(); ctx.fill();
      }
    }

    // Étiquette au-dessus (ou au-dessous) de la figure.
    const top = p.dir === 'bearish' || p.points.every((pt) => pt.k !== 'L');
    const anchor = p.points.reduce((best, pt) => {
      if (!best) return pt;
      return (top ? pt.p > best.p : pt.p < best.p) ? pt : best;
    }, null);
    if (anchor) {
      const x = this.x(anchor.t), y = this.y(anchor.p);
      if (x !== null && y !== null) {
        const text = `${p.name} · ${STATUS_LABELS[p.status] || p.status}`;
        this.pill(ctx, size, x, top ? y - 26 : y + 12, text, color, alpha);
      }
    }
  }

  // --- Utilitaires de dessin ----------------------------------------------------------
  colorOf(p) {
    if (p.status === 'failed') return '#64748b';
    return PATTERN_COLORS[p.family] || '#94a3b8';
  }

  visiblePatterns() {
    return this.data.patterns.filter((p) => this.options.failed || p.status !== 'failed');
  }

  tag(ctx, x, y, text, color, alpha) {
    ctx.font = SMALL;
    const w = ctx.measureText(text).width + 8;
    ctx.fillStyle = withAlpha(this.tagBg || '#0b1220', 0.8);
    ctx.fillRect(x, y - 8, w, 15);
    ctx.fillStyle = withAlpha(color, alpha);
    ctx.fillText(text, x + 4, y + 3);
  }

  pill(ctx, size, x, y, text, color, alpha) {
    ctx.font = FONT;
    const w = ctx.measureText(text).width + 12;
    const h = 17;
    const left = Math.min(Math.max(4, x - w / 2), size.width - w - 4);
    ctx.fillStyle = withAlpha(color, 0.9 * alpha);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(left, y, w, h, 8); else ctx.rect(left, y, w, h);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, left + 6, y + 12);
  }
}
