// Point d'entrée de l'interface : état, connexion temps réel et interactions.

import { AlertCenter } from './alerts.js';
import { ChartView } from './chart.js';
import { DIR_COLORS, EMA_COLORS, FAMILY_LABELS, LEVEL_COLORS, PATTERN_COLORS, RISK_COLORS } from './colors.js';
import { pct, price, setDigits } from './format.js';
import {
  renderCandleHits, renderFeed, renderLevels, renderMtf, renderPatterns, renderProviders, renderRisk, renderWatchlist,
} from './panels.js';
import { MarketSocket } from './ws.js';

const $ = (sel) => document.querySelector(sel);
const TF_SECONDS = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400 };

// ---------------------------------------------------------------- préférences locales
const PREFS_KEY = 'nk-trader-prefs';
function loadPrefs() {
  const defaults = { symbol: null, tf: 'M5', theme: 'dark', volume: 0.6, muted: false, desktop: false,
    min_reliability: 2, overlay: {} };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return defaults; }
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs)); } catch { /* stockage indisponible */ }
}

const state = {
  prefs: loadPrefs(),
  instruments: [],
  timeframes: Object.keys(TF_SECONDS),
  prices: {},
  providers: [],
  socket: 'connecting',
  symbol: null,
  tf: null,
  analysis: null,
  mtf: null,
  alerts: [],
  signals: [],
  rules: null,
  risk: null,
  riskContext: '',
};

// ---------------------------------------------------------------- composants
document.documentElement.dataset.theme = state.prefs.theme;
const chart = new ChartView($('#chart'), $('#legend'), state.prefs.theme === 'dark');
const alerts = new AlertCenter($('#toasts'), (a) => openChart(a.symbol, a.tf, a.t));
alerts.sound.volume = state.prefs.volume;
alerts.sound.muted = state.prefs.muted;
alerts.desktop = state.prefs.desktop && 'Notification' in window && Notification.permission === 'granted';
const socket = new MarketSocket(onMessage, (s) => { state.socket = s; renderProviders($('#providers'), state.providers, s); });

// Options d'affichage du graphique (cases à cocher).
for (const input of document.querySelectorAll('#toolbar input[data-opt]')) {
  const key = input.dataset.opt;
  if (key in state.prefs.overlay) input.checked = state.prefs.overlay[key];
  input.addEventListener('change', () => {
    state.prefs.overlay[key] = input.checked;
    savePrefs();
    applyOverlayOptions();
  });
}
function applyOverlayOptions() {
  const opts = { minReliability: Number(state.prefs.min_reliability) };
  for (const input of document.querySelectorAll('#toolbar input[data-opt]')) opts[input.dataset.opt] = input.checked;
  chart.setOptions(opts);
}
applyOverlayOptions();

// ---------------------------------------------------------------- messages serveur
function onMessage(msg) {
  switch (msg.type) {
    case 'hello': {
      state.instruments = msg.instruments;
      state.timeframes = msg.timeframes;
      state.providers = msg.providers;
      state.rules = msg.rules;
      state.alerts = msg.alerts || [];
      state.signals = msg.signals || [];
      state.prices = msg.prices || {};
      setDigits(Object.fromEntries(msg.instruments.map((i) => [i.symbol, i.digits])));
      buildTimeframes();
      buildSymbolSelect();
      renderProviders($('#providers'), state.providers, state.socket);
      renderAllFeeds();
      const known = state.instruments.some((i) => i.symbol === state.prefs.symbol);
      openChart(known ? state.prefs.symbol : state.instruments[0]?.symbol,
        state.timeframes.includes(state.prefs.tf) ? state.prefs.tf : state.timeframes[1] || state.timeframes[0]);
      break;
    }
    case 'snapshot':
      if (msg.symbol !== state.symbol || msg.tf !== state.tf) return;
      chart.setInstrument(msg.symbol, msg.tf, msg.instrument.digits, TF_SECONDS[msg.tf]);
      chart.setCandles(msg.candles);
      applyAnalysis(msg.analysis);
      $('#chart-loading').classList.toggle('hidden', msg.candles.length > 0);
      if (state.pendingFocus) { chart.focusTime(state.pendingFocus); state.pendingFocus = null; }
      break;
    case 'candle':
      if (msg.symbol === state.symbol && msg.tf === state.tf) chart.updateCandle(msg.candle);
      break;
    case 'analysis':
      if (msg.symbol === state.symbol && msg.tf === state.tf) applyAnalysis(msg.analysis);
      break;
    case 'mtf':
      if (msg.symbol === state.symbol) { state.mtf = msg; renderMtf($('#mtf'), msg, state.tf, state.timeframes); }
      break;
    case 'ticker':
      Object.assign(state.prices, msg.prices);
      updatePrices();
      break;
    case 'signals':
      state.signals = [...msg.signals, ...state.signals].slice(0, 300);
      renderFeed($('#feed-signals'), state.signals, 'Aucun signal pour le moment.');
      break;
    case 'alert':
      state.alerts = [msg.alert, ...state.alerts].slice(0, 200);
      alerts.trigger(msg.alert);
      renderFeed($('#feed-alerts'), state.alerts, 'Aucune alerte pour le moment.');
      $('#alert-count').textContent = state.alerts.length || '';
      break;
    case 'status':
      state.providers = msg.providers;
      renderProviders($('#providers'), state.providers, state.socket);
      break;
    case 'ready':
      if (msg.symbol === state.symbol) socket.subscribe(state.symbol, state.tf);
      break;
    case 'alert_rules':
      state.rules = msg.rules;
      break;
    case 'error':
      console.warn(msg.message);
      break;
    default:
      break;
  }
}

function applyAnalysis(analysis) {
  state.analysis = analysis;
  chart.setAnalysis(analysis);
  renderPatterns($('#patterns'), analysis?.chart_patterns || [], state.symbol);
  renderLevels($('#levels'), analysis?.levels || [], analysis?.htf_levels || [], state.symbol);
  renderCandleHits($('#feed-candles'), analysis?.candle_patterns || [], state.symbol);
  // Risque : celui du dernier signal de ce graphique, sinon on garde l'évaluation manuelle.
  const top = (analysis?.signals || []).find((s) => s.risk);
  if (top) {
    state.risk = top.risk;
    state.riskContext = `Dernier signal : <b style="color:${DIR_COLORS[top.dir]}">${top.title}</b>`;
  }
  renderRisk($('#risk'), state.risk, state.riskContext, state.symbol);
}

// ---------------------------------------------------------------- navigation
function openChart(symbol, tf, focusTime = null) {
  if (!symbol) return;
  const changed = symbol !== state.symbol || tf !== state.tf;
  state.symbol = symbol;
  state.tf = tf || state.tf;
  state.prefs.symbol = symbol;
  state.prefs.tf = state.tf;
  savePrefs();
  const inst = state.instruments.find((i) => i.symbol === symbol);
  $('#cur-symbol').textContent = symbol;
  $('#cur-name').textContent = inst ? inst.name : '';
  $('#symbol-select').value = symbol;
  for (const b of document.querySelectorAll('#tf-group button')) b.classList.toggle('active', b.dataset.tf === state.tf);
  renderWatchlist($('#watchlist'), state.instruments, state.prices, symbol);
  updatePrices();
  if (changed) {
    state.risk = null;
    state.riskContext = '';
    state.mtf = null;
    renderMtf($('#mtf'), null, state.tf, state.timeframes);
    renderRisk($('#risk'), null, '', symbol);
    $('#chart-loading').classList.remove('hidden');
    state.pendingFocus = focusTime;
    socket.subscribe(symbol, state.tf);
  } else if (focusTime) {
    chart.focusTime(focusTime);
  }
}

function buildTimeframes() {
  $('#tf-group').innerHTML = state.timeframes.map((tf) => `<button data-tf="${tf}" role="tab">${tf}</button>`).join('');
}

function buildSymbolSelect() {
  $('#symbol-select').innerHTML = state.instruments
    .map((i) => `<option value="${i.symbol}">${i.symbol} — ${i.name}</option>`).join('');
}

function updatePrices() {
  for (const el of document.querySelectorAll('[data-price]')) {
    const p = state.prices[el.dataset.price];
    if (p) el.textContent = price(p.price, el.dataset.price);
  }
  const p = state.prices[state.symbol];
  if (p) {
    const prev = $('#cur-price').textContent;
    const text = price(p.price, state.symbol);
    const el = $('#cur-price');
    if (prev !== text && prev !== '—') {
      el.classList.remove('tick-up', 'tick-down');
      void el.offsetWidth;
      el.classList.add(parseFloat(text) >= parseFloat(prev) ? 'tick-up' : 'tick-down');
    }
    el.textContent = text;
    const ch = $('#cur-change');
    ch.textContent = p.change === null || p.change === undefined ? '' : `${pct(p.change)} (jour)`;
    ch.className = p.change > 0 ? 'up' : p.change < 0 ? 'down' : '';
  }
  // Rafraîchit les variations et biais de la liste sans la reconstruire à chaque tick.
  for (const row of document.querySelectorAll('.wl-row')) {
    const q = state.prices[row.dataset.symbol];
    if (!q) continue;
    const small = row.querySelector('.wl-price small');
    if (small && q.change !== null && q.change !== undefined) {
      small.textContent = pct(q.change);
      small.className = q.change > 0 ? 'up' : q.change < 0 ? 'down' : '';
    }
    const dot = row.querySelector('.wl-bias');
    if (dot) dot.style.background = DIR_COLORS[q.bias] || '#334155';
  }
}

function renderAllFeeds() {
  renderFeed($('#feed-alerts'), state.alerts, 'Aucune alerte pour le moment. Elles apparaîtront ici avec un son.');
  renderFeed($('#feed-signals'), state.signals, 'Aucun signal pour le moment.');
  $('#alert-count').textContent = state.alerts.length || '';
}

// ---------------------------------------------------------------- évènements UI
$('#tf-group').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-tf]');
  if (b) openChart(state.symbol, b.dataset.tf);
});
$('#watchlist').addEventListener('click', (ev) => {
  const row = ev.target.closest('[data-symbol]');
  if (row) openChart(row.dataset.symbol, state.tf);
});
$('#symbol-select').addEventListener('change', (ev) => openChart(ev.target.value, state.tf));
$('#mtf').addEventListener('click', (ev) => {
  const row = ev.target.closest('tr[data-tf]');
  if (row) openChart(state.symbol, row.dataset.tf);
});
for (const id of ['#feed-alerts', '#feed-signals', '#feed-candles']) {
  $(id).addEventListener('click', (ev) => {
    const row = ev.target.closest('.feed-row');
    if (row) openChart(row.dataset.symbol, row.dataset.tf || state.tf, Number(row.dataset.time));
  });
}
$('#patterns').addEventListener('mouseover', (ev) => {
  const item = ev.target.closest('[data-id]');
  chart.overlay.setHighlight(item ? item.dataset.id : null);
});
$('#patterns').addEventListener('mouseleave', () => chart.overlay.setHighlight(null));
$('#patterns').addEventListener('click', (ev) => {
  const item = ev.target.closest('[data-id]');
  if (item) chart.focusTime(Number(item.dataset.time));
});
document.querySelector('.tabs').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-tab]');
  if (!b) return;
  for (const t of document.querySelectorAll('.tabs button')) t.classList.toggle('active', t === b);
  for (const body of document.querySelectorAll('.feed-body')) body.classList.toggle('hidden', body.id !== `feed-${b.dataset.tab}`);
});

async function checkRisk(direction) {
  try {
    const res = await fetch(`/api/risk/${encodeURIComponent(state.symbol)}/${state.tf}/${direction}`);
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    state.risk = await res.json();
    state.riskContext = `Évaluation d'un${direction === 'bullish' ? ' <b class="up">achat' : 'e <b class="down">vente'}</b> au prix actuel (${state.tf})`;
    renderRisk($('#risk'), state.risk, state.riskContext, state.symbol);
  } catch (err) {
    $('#risk').innerHTML = `<div class="empty">Évaluation impossible : ${err.message}</div>`;
  }
}
$('#risk-buy').addEventListener('click', () => checkRisk('bullish'));
$('#risk-sell').addEventListener('click', () => checkRisk('bearish'));

// Son : un clic est obligatoire pour autoriser l'audio dans le navigateur.
function renderSoundButton() {
  const btn = $('#sound-btn');
  const on = alerts.sound.unlocked && !alerts.sound.muted;
  btn.textContent = on ? '🔔 Son activé' : (alerts.sound.unlocked ? '🔇 Son coupé' : '🔇 Activer le son');
  btn.classList.toggle('off', !on);
}
$('#sound-btn').addEventListener('click', async () => {
  if (!alerts.sound.unlocked) {
    await alerts.sound.unlock();
    alerts.sound.muted = false;
    alerts.sound.play('pattern');
  } else {
    alerts.sound.muted = !alerts.sound.muted;
  }
  state.prefs.muted = alerts.sound.muted;
  savePrefs();
  renderSoundButton();
});
renderSoundButton();

$('#theme-btn').addEventListener('click', () => {
  state.prefs.theme = state.prefs.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = state.prefs.theme;
  chart.setTheme(state.prefs.theme === 'dark');
  savePrefs();
});

// ---------------------------------------------------------------- réglages
const form = $('#settings-form');
$('#settings-btn').addEventListener('click', () => {
  const r = state.rules || {};
  form.enabled.checked = r.enabled ?? true;
  form.min_score.value = r.min_score ?? 70;
  $('#min-score-out').textContent = form.min_score.value;
  for (const c of form.querySelectorAll('input[name=type]')) c.checked = (r.types || []).includes(c.value);
  $('#tfs-box').innerHTML = state.timeframes.map((tf) =>
    `<label><input type="checkbox" name="tf" value="${tf}" ${(r.timeframes || []).includes(tf) ? 'checked' : ''}> ${tf}</label>`).join('');
  form.max_risk.value = r.max_risk || 'eleve';
  form.cooldown_seconds.value = r.cooldown_seconds ?? 300;
  form.volume.value = alerts.sound.volume;
  form.desktop.checked = alerts.desktop;
  form.min_reliability.value = String(state.prefs.min_reliability);
  $('#settings-dialog').showModal();
});
form.min_score.addEventListener('input', () => { $('#min-score-out').textContent = form.min_score.value; });
form.volume.addEventListener('input', () => { alerts.sound.volume = Number(form.volume.value); });
for (const b of form.querySelectorAll('[data-test]')) {
  b.addEventListener('click', async () => {
    await alerts.sound.unlock();
    alerts.sound.muted = false;
    renderSoundButton();
    alerts.sound.play(b.dataset.test);
  });
}
$('#settings-dialog').addEventListener('close', async () => {
  if ($('#settings-dialog').returnValue !== 'save') {
    alerts.sound.volume = state.prefs.volume;
    return;
  }
  const rules = {
    enabled: form.enabled.checked,
    min_score: Number(form.min_score.value),
    types: [...form.querySelectorAll('input[name=type]:checked')].map((c) => c.value),
    timeframes: [...form.querySelectorAll('input[name=tf]:checked')].map((c) => c.value),
    max_risk: form.max_risk.value,
    cooldown_seconds: Number(form.cooldown_seconds.value),
  };
  state.prefs.volume = Number(form.volume.value);
  state.prefs.min_reliability = Number(form.min_reliability.value);
  if (form.desktop.checked && !alerts.desktop) await alerts.enableDesktop();
  if (!form.desktop.checked) alerts.desktop = false;
  state.prefs.desktop = alerts.desktop;
  savePrefs();
  applyOverlayOptions();
  try {
    const res = await fetch('/api/settings/alerts', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rules),
    });
    if (res.ok) state.rules = await res.json();
  } catch (err) { console.error(err); }
});

// ---------------------------------------------------------------- légende
$('#legend-btn').addEventListener('click', () => {
  const sw = (color, label, dashed = false) =>
    `<div class="lg-item"><span class="swatch ${dashed ? 'dashed' : ''}" style="background:${color}"></span>${label}</div>`;
  $('#legend-content').innerHTML = `
    <h3>Figures chartistes</h3>
    ${Object.entries(FAMILY_LABELS).map(([k, label]) => sw(PATTERN_COLORS[k], label)).join('')}
    <div class="lg-note">Trait plein : bornes · tirets : ligne de cou · pointillés : objectif · ◆ : point de cassure.
      Une figure « en formation » est prolongée en pointillés ; elle devient « confirmée » à la clôture d'une bougie au-delà de sa ligne de cassure.</div>
    <h3>Niveaux</h3>
    ${sw(LEVEL_COLORS.support, 'Support (zone)')}${sw(LEVEL_COLORS.resistance, 'Résistance (zone)')}
    ${sw(LEVEL_COLORS.htf, 'Niveau d\'une unité de temps supérieure (H1 / H4 / D1)', true)}
    <h3>Chandeliers japonais</h3>
    ${sw(DIR_COLORS.bullish, '▲ sous la bougie : figure haussière')}${sw(DIR_COLORS.bearish, '▼ au-dessus : figure baissière')}
    ${sw(DIR_COLORS.neutral, '● dans la bougie : indécision (doji, toupie)')}
    <h3>Moyennes mobiles</h3>
    ${sw(EMA_COLORS.ema20, 'EMA 20')}${sw(EMA_COLORS.ema50, 'EMA 50')}${sw(EMA_COLORS.ema200, 'EMA 200')}
    <h3>Risque multi-temporel</h3>
    ${sw(RISK_COLORS.faible, 'Faible : dans le sens des UT supérieures')}${sw(RISK_COLORS.modere, 'Modéré')}
    ${sw(RISK_COLORS.eleve, 'Élevé : contre-tendance, obstacle proche ou volatilité extrême')}`;
  $('#legend-dialog').showModal();
});

socket.connect();
