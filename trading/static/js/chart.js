// Graphique principal : bougies, volume (ticks), moyennes mobiles, marqueurs de
// chandeliers japonais, niveaux sur l'axe des prix et calque des figures.

import { DIR_COLORS, EMA_COLORS, LEVEL_COLORS } from './colors.js';
import { OverlayPrimitive } from './overlay.js';

const LWC = window.LightweightCharts;

const SHORT = {
  doji: 'Doji', long_legged_doji: 'Doji LJ', dragonfly_doji: 'Libellule', gravestone_doji: 'P. tombale',
  hammer: 'Marteau', hanging_man: 'Pendu', inverted_hammer: 'M. inversé', shooting_star: 'É. filante',
  marubozu: 'Marubozu', spinning_top: 'Toupie', belt_hold: 'Ceinture', engulfing: 'Avalement',
  harami: 'Harami', harami_cross: 'Harami ✚', piercing: 'Pénétrante', dark_cloud_cover: 'Nuage noir',
  tweezer: 'Pinces', kicker: 'Kicker', counterattack: 'Contre-att.', homing_pigeon: 'Pigeon',
  matching_low: 'Creux id.', morning_star: { bullish: 'É. matin', bearish: 'É. soir' },
  doji_star: { bullish: 'É. doji matin', bearish: 'É. doji soir' }, abandoned_baby: 'Bébé aband.',
  three_soldiers_crows: { bullish: '3 soldats', bearish: '3 corbeaux' }, three_inside: '3 intér.',
  three_outside: '3 extér.', tri_star: 'Tri-étoile', stick_sandwich: 'Sandwich', advance_block: 'Blocage',
  three_line_strike: '3 Line Strike', three_methods: '3 méthodes',
};

export function shortName(hit) {
  const s = SHORT[hit.key];
  if (!s) return hit.name.split(' (')[0];
  return typeof s === 'string' ? s : (s[hit.dir] || hit.name);
}

function themeOptions(dark) {
  return dark ? {
    layout: { background: { type: 'solid', color: '#0b1220' }, textColor: '#cbd5e1' },
    grid: { vertLines: { color: 'rgba(148,163,184,0.06)' }, horzLines: { color: 'rgba(148,163,184,0.06)' } },
    rightPriceScale: { borderColor: 'rgba(148,163,184,0.18)' },
    timeScale: { borderColor: 'rgba(148,163,184,0.18)' },
  } : {
    layout: { background: { type: 'solid', color: '#ffffff' }, textColor: '#334155' },
    grid: { vertLines: { color: 'rgba(15,23,42,0.05)' }, horzLines: { color: 'rgba(15,23,42,0.05)' } },
    rightPriceScale: { borderColor: 'rgba(15,23,42,0.15)' },
    timeScale: { borderColor: 'rgba(15,23,42,0.15)' },
  };
}

export class ChartView {
  constructor(container, legend, dark = true) {
    this.legend = legend;
    this.symbol = null;
    this.tf = null;
    this.digits = 2;
    this.bars = [];
    this.hovering = false;
    this.priceLines = [];
    this.analysis = null;
    this.options = { candles: true, minReliability: 2, neutral: false, ema: true };

    // Heures affichées dans le fuseau local de l'utilisateur (les données sont en UTC).
    const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
    const DAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
    const pad = (v) => String(v).padStart(2, '0');
    const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const dm = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
    this.chart = LWC.createChart(container, {
      autoSize: true,
      crosshair: { mode: LWC.CrosshairMode.Normal },
      timeScale: {
        timeVisible: true, secondsVisible: false, rightOffset: 12, barSpacing: 7,
        tickMarkFormatter: (t, type) => {
          const d = new Date(t * 1000);
          if (type === 0) return String(d.getFullYear());
          if (type === 1) return MONTHS[d.getMonth()];
          if (type === 2) return dm(d);
          return hm(d);
        },
      },
      localization: {
        locale: 'fr-FR',
        timeFormatter: (t) => { const d = new Date(t * 1000); return `${DAYS[d.getDay()]} ${dm(d)} ${hm(d)}`; },
      },
    });
    // Appliqué après coup : applyOptions fusionne en profondeur (un « ...spread » écraserait timeScale).
    this.chart.applyOptions(themeOptions(dark));
    this.candles = this.chart.addSeries(LWC.CandlestickSeries, {
      upColor: '#26a69a', downColor: '#ef5350', wickUpColor: '#26a69a', wickDownColor: '#ef5350',
      borderVisible: false,
    });
    this.volume = this.chart.addSeries(LWC.HistogramSeries, {
      priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false,
    });
    this.chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.86, bottom: 0 } });
    this.emas = {};
    for (const key of ['ema20', 'ema50', 'ema200']) {
      this.emas[key] = this.chart.addSeries(LWC.LineSeries, {
        color: EMA_COLORS[key], lineWidth: key === 'ema200' ? 2 : 1, priceLineVisible: false,
        lastValueVisible: false, crosshairMarkerVisible: false,
      });
    }
    this.markers = LWC.createSeriesMarkers(this.candles, []);
    this.overlay = new OverlayPrimitive();
    this.overlay.setTheme(dark);
    this.candles.attachPrimitive(this.overlay);

    this.chart.subscribeCrosshairMove((param) => {
      const bar = param && param.time ? param.seriesData.get(this.candles) : null;
      this.hovering = Boolean(bar);
      this.renderLegend(bar || this.bars[this.bars.length - 1]);
    });
  }

  setTheme(dark) {
    this.chart.applyOptions(themeOptions(dark));
    this.overlay.setTheme(dark);
  }

  setInstrument(symbol, tf, digits, tfSeconds) {
    this.symbol = symbol;
    this.tf = tf;
    this.digits = digits;
    this.step = tfSeconds;
    const minMove = Number((10 ** -digits).toFixed(digits));
    this.candles.applyOptions({ priceFormat: { type: 'price', precision: digits, minMove } });
    for (const s of Object.values(this.emas)) s.applyOptions({ priceFormat: { type: 'price', precision: digits, minMove } });
  }

  setCandles(candles) {
    this.bars = candles.map((c) => ({ time: c.t, open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v }));
    this.candles.setData(this.bars);
    this.volume.setData(this.bars.map((b) => this.volumeBar(b)));
    // Certaines sources (ex. historique Deriv) n'ont pas de volume : on masque l'histogramme.
    const sample = this.bars.slice(0, Math.max(1, Math.floor(this.bars.length * 0.9)));
    this.volume.applyOptions({ visible: sample.some((b) => b.volume > 0) });
    this.overlay.setTimes(this.bars.map((b) => b.time), this.step);
    const n = this.bars.length;
    this.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 160), to: n + 8 });
    this.renderLegend(this.bars[n - 1]);
  }

  volumeBar(b) {
    return { time: b.time, value: b.volume || 0,
      color: b.close >= b.open ? 'rgba(38,166,154,0.35)' : 'rgba(239,83,80,0.35)' };
  }

  updateCandle(c) {
    const bar = { time: c.t, open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v };
    const last = this.bars[this.bars.length - 1];
    if (last && bar.time < last.time) return;
    if (last && bar.time === last.time) this.bars[this.bars.length - 1] = bar;
    else {
      this.bars.push(bar);
      this.overlay.setTimes(this.bars.map((b) => b.time), this.step);
    }
    this.candles.update(bar);
    this.volume.update(this.volumeBar(bar));
    if (!this.hovering) this.renderLegend(bar);
  }

  setOptions(opts) {
    Object.assign(this.options, opts);
    for (const s of Object.values(this.emas)) s.applyOptions({ visible: this.options.ema });
    this.overlay.setOptions(opts);
    if (this.analysis) this.renderMarkers(this.analysis.candle_patterns || []);
  }

  setAnalysis(a) {
    this.analysis = a;
    if (!a) {
      this.overlay.setData({ levels: [], htf: [], patterns: [], zigzag: [] });
      this.markers.setMarkers([]);
      return;
    }
    for (const [key, series] of Object.entries(this.emas)) {
      series.setData((a.ema[key] || []).map(([t, v]) => ({ time: t, value: v })));
    }
    this.renderMarkers(a.candle_patterns || []);
    this.overlay.setData({ levels: a.levels, htf: a.htf_levels, patterns: a.chart_patterns, zigzag: a.zigzag });
    this.renderPriceLines(a);
  }

  renderMarkers(hits) {
    if (!this.options.candles) { this.markers.setMarkers([]); return; }
    // Flèches sur les 150 dernières bougies ; nom affiché seulement pour les figures
    // fortes ou les 25 dernières bougies (lisibilité).
    const n = this.bars.length;
    const minTime = n > 150 ? this.bars[n - 150].time : 0;
    const textTime = n > 25 ? this.bars[n - 25].time : 0;
    const byBar = new Map();
    for (const h of hits) {
      if (h.t < minTime) continue;
      if (h.dir === 'neutral' ? !this.options.neutral : h.reliability < this.options.minReliability) continue;
      const key = `${h.t}:${h.dir}`;
      const prev = byBar.get(key);
      if (!prev || h.reliability > prev.reliability || (h.reliability === prev.reliability && h.candles > prev.candles)) {
        byBar.set(key, h);
      }
    }
    const markers = [...byBar.values()].sort((a, b) => a.t - b.t).map((h) => ({
      time: h.t,
      position: h.dir === 'bullish' ? 'belowBar' : (h.dir === 'bearish' ? 'aboveBar' : 'inBar'),
      shape: h.dir === 'bullish' ? 'arrowUp' : (h.dir === 'bearish' ? 'arrowDown' : 'circle'),
      color: DIR_COLORS[h.dir],
      text: h.reliability >= 3 || h.t >= textTime ? shortName(h) : '',
      size: h.reliability >= 3 ? 1.4 : 1,
    }));
    this.markers.setMarkers(markers);
  }

  renderPriceLines(a) {
    for (const line of this.priceLines) this.candles.removePriceLine(line);
    this.priceLines = [];
    for (const lv of a.levels || []) {
      if (!lv.major) continue;
      this.priceLines.push(this.candles.createPriceLine({
        price: lv.price, color: LEVEL_COLORS[lv.kind], lineVisible: false, axisLabelVisible: true,
        title: lv.kind === 'resistance' ? 'R' : 'S',
      }));
    }
    for (const lv of a.htf_levels || []) {
      this.priceLines.push(this.candles.createPriceLine({
        price: lv.price, color: '#64748b', lineVisible: false, axisLabelVisible: true, title: '',
      }));
    }
  }

  focusTime(t) {
    const idx = this.overlay.logicalOf(t);
    if (idx === null) return;
    const range = this.chart.timeScale().getVisibleLogicalRange();
    const width = range ? range.to - range.from : 160;
    this.chart.timeScale().setVisibleLogicalRange({ from: idx - width * 0.6, to: idx + width * 0.4 });
  }

  renderLegend(bar) {
    if (!this.legend || !bar) return;
    const d = this.digits;
    const ch = bar.open ? ((bar.close - bar.open) / bar.open) * 100 : 0;
    const cls = bar.close >= bar.open ? 'up' : 'down';
    const ema = (key) => {
      const s = this.analysis && this.analysis.ema[key];
      return s && s.length ? s[s.length - 1][1].toFixed(d) : '—';
    };
    this.legend.innerHTML = `
      <span class="lg-sym">${this.symbol || ''}</span><span class="lg-tf">${this.tf || ''}</span>
      <span>O <b class="${cls}">${bar.open.toFixed(d)}</b></span>
      <span>H <b class="${cls}">${bar.high.toFixed(d)}</b></span>
      <span>L <b class="${cls}">${bar.low.toFixed(d)}</b></span>
      <span>C <b class="${cls}">${bar.close.toFixed(d)}</b></span>
      <span class="${cls}">${ch >= 0 ? '+' : ''}${ch.toFixed(2)} %</span>
      ${this.options.ema ? `<span class="lg-ema"><i style="background:${EMA_COLORS.ema20}"></i>EMA20 ${ema('ema20')}</span>
      <span class="lg-ema"><i style="background:${EMA_COLORS.ema50}"></i>EMA50 ${ema('ema50')}</span>
      <span class="lg-ema"><i style="background:${EMA_COLORS.ema200}"></i>EMA200 ${ema('ema200')}</span>` : ''}`;
  }
}
