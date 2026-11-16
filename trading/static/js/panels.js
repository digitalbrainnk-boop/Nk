// Rendu des panneaux latéraux : liste des instruments, matrice multi-temporelle,
// risque, figures, niveaux, flux d'alertes / signaux / chandeliers.

import {
  DIR_COLORS, LEVEL_COLORS, PATTERN_COLORS, RISK_COLORS, RISK_LABELS, STATUS_LABELS, TYPE_LABELS, trendColor,
} from './colors.js';
import { ago, escapeHtml, pct, price, time } from './format.js';

const CATEGORY_LABELS = { synthetic: 'Indices synthétiques', forex: 'Forex & métaux' };
const ARROW = { bullish: '▲', bearish: '▼', neutral: '◆' };

export function renderWatchlist(root, instruments, prices, current) {
  const groups = {};
  for (const inst of instruments) (groups[inst.category] ||= []).push(inst);
  root.innerHTML = Object.entries(groups).map(([cat, items]) => `
    <div class="wl-group">${escapeHtml(CATEGORY_LABELS[cat] || cat)}</div>
    ${items.map((i) => {
      const p = prices[i.symbol] || {};
      const ch = p.change;
      return `<button class="wl-row ${i.symbol === current ? 'active' : ''}" data-symbol="${escapeHtml(i.symbol)}">
        <span class="wl-bias" style="background:${DIR_COLORS[p.bias] || '#334155'}" title="Biais multi-UT"></span>
        <span class="wl-name"><b>${escapeHtml(i.symbol)}</b><small>${escapeHtml(i.name)}</small></span>
        <span class="wl-price"><b data-price="${escapeHtml(i.symbol)}">${price(p.price, i.symbol)}</b>
          <small class="${ch > 0 ? 'up' : ch < 0 ? 'down' : ''}">${ch === undefined || ch === null ? '' : pct(ch)}</small></span>
      </button>`;
    }).join('')}`).join('');
}

export function renderMtf(root, mtf, currentTf, timeframes) {
  if (!mtf || !mtf.trends || !Object.keys(mtf.trends).length) {
    root.innerHTML = '<div class="empty">Analyse en cours…</div>';
    return;
  }
  const bias = mtf.bias || { score: 0, dir: 'neutral' };
  const biasLabel = { bullish: 'Haussier', bearish: 'Baissier', neutral: 'Neutre' }[bias.dir];
  root.innerHTML = `
    <div class="bias" style="--c:${DIR_COLORS[bias.dir]}">
      <span>Biais global</span><b>${ARROW[bias.dir]} ${biasLabel}</b>
      <small>${bias.bullish} UT haussières · ${bias.bearish} baissières</small>
    </div>
    <table class="mtf">
      <thead><tr><th>UT</th><th>Tendance</th><th class="bar-col">Force</th><th>RSI</th><th>Structure</th></tr></thead>
      <tbody>${timeframes.map((tf) => {
        const t = mtf.trends[tf];
        if (!t) return `<tr><td>${tf}</td><td colspan="4" class="muted">—</td></tr>`;
        const w = Math.round(Math.abs(t.score) * 50);
        const side = t.score >= 0 ? 'left:50%' : `left:${50 - w}%`;
        return `<tr class="${tf === currentTf ? 'current' : ''}" data-tf="${tf}">
          <td><b>${tf}</b></td>
          <td style="color:${trendColor(t.score)}">${escapeHtml(t.label)}</td>
          <td class="bar-col"><div class="score-bar"><i style="${side};width:${w}%;background:${trendColor(t.score)}"></i></div></td>
          <td class="${t.rsi >= 70 ? 'down' : t.rsi <= 30 ? 'up' : ''}">${t.rsi === null ? '—' : Math.round(t.rsi)}</td>
          <td class="muted">${escapeHtml(t.structure)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
}

export function renderRisk(root, risk, context, symbol) {
  if (!risk) {
    root.innerHTML = `<div class="empty">Choisissez un sens pour évaluer le risque d'une entrée maintenant,
      ou attendez un signal.</div>`;
    return;
  }
  const color = RISK_COLORS[risk.level];
  const angle = Math.round((risk.score / 100) * 180);
  root.innerHTML = `
    ${context ? `<div class="risk-context">${context}</div>` : ''}
    <div class="risk-head">
      <div class="gauge" style="--a:${angle}deg;--c:${color}"><div class="gauge-inner"><b>${Math.round(risk.score)}</b><small>/100</small></div></div>
      <div>
        <div class="risk-level" style="color:${color}">Risque ${RISK_LABELS[risk.level]}</div>
        <div class="risk-verdict">${escapeHtml(risk.verdict)}</div>
        <div class="muted small">Alignement UT supérieures : ${risk.alignment > 0 ? '+' : ''}${Math.round(risk.alignment * 100)} %</div>
      </div>
    </div>
    <ul class="risk-details">${risk.details.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>
    <div class="risk-grid">
      <div><small>Entrée</small><b>${price(risk.entry, symbol)}</b></div>
      <div><small>Stop</small><b class="down">${price(risk.stop, symbol)}</b></div>
      <div><small>Objectif</small><b class="up">${price(risk.target, symbol)}</b></div>
      <div><small>Gain / risque</small><b>${risk.rr ? risk.rr.toFixed(2) : '—'}</b></div>
    </div>`;
}

export function renderPatterns(root, patterns, symbol) {
  if (!patterns || !patterns.length) {
    root.innerHTML = '<div class="empty">Aucune figure chartiste récente.</div>';
    return;
  }
  root.innerHTML = [...patterns].reverse().map((p) => `
    <div class="item pattern-item" data-id="${escapeHtml(p.id)}" data-time="${p.end}">
      <span class="swatch" style="background:${p.status === 'failed' ? '#64748b' : PATTERN_COLORS[p.family]}"></span>
      <div class="item-main">
        <div class="item-title">${escapeHtml(p.name)} <span class="dir" style="color:${DIR_COLORS[p.dir]}">${ARROW[p.dir]}</span></div>
        <div class="item-sub">${STATUS_LABELS[p.status]} · confiance ${Math.round(p.confidence * 100)} %
          ${p.target ? ` · objectif ${price(p.target, symbol)}` : ''}</div>
      </div>
      <span class="status status-${p.status}">${STATUS_LABELS[p.status]}</span>
    </div>`).join('');
}

export function renderLevels(root, levels, htf, symbol) {
  const rows = [...(levels || []).map((l) => ({ ...l, htf: false })), ...(htf || []).map((l) => ({ ...l, htf: true }))]
    .sort((a, b) => b.price - a.price);
  if (!rows.length) { root.innerHTML = '<div class="empty">Pas encore de niveaux.</div>'; return; }
  root.innerHTML = rows.map((l) => `
    <div class="item level-item" data-price="${l.price}">
      <span class="swatch ${l.htf ? 'dashed' : ''}" style="background:${l.htf ? LEVEL_COLORS.htf : LEVEL_COLORS[l.kind]}"></span>
      <div class="item-main">
        <div class="item-title">${price(l.price, symbol)} <small class="muted">${l.kind === 'resistance' ? 'Résistance' : 'Support'}${l.major ? ' majeure' : ''}</small></div>
        <div class="strength"><i style="width:${Math.round(l.strength)}%;background:${l.htf ? LEVEL_COLORS.htf : LEVEL_COLORS[l.kind]}"></i></div>
      </div>
      <span class="tag">${l.htf ? l.timeframe : `${l.touches}×`}</span>
    </div>`).join('');
}

export function renderFeed(root, items, emptyText) {
  if (!items.length) { root.innerHTML = `<div class="empty">${emptyText}</div>`; return; }
  root.innerHTML = items.slice(0, 120).map((s) => `
    <div class="feed-row" data-symbol="${escapeHtml(s.symbol)}" data-tf="${s.tf}" data-time="${s.t}">
      <span class="feed-dir" style="color:${DIR_COLORS[s.dir]}">${ARROW[s.dir]}</span>
      <span class="feed-sym"><b>${escapeHtml(s.symbol)}</b> ${s.tf}</span>
      <span class="feed-title" title="${escapeHtml(s.description)}">${escapeHtml(s.title)}
        <small>${TYPE_LABELS[s.type] || s.type}${s.confluence && s.confluence.length ? ` · +${s.confluence.length}` : ''}</small></span>
      <span class="feed-score s-${s.strength}">${Math.round(s.score)}</span>
      ${s.risk ? `<span class="badge" style="--c:${RISK_COLORS[s.risk.level]}">${RISK_LABELS[s.risk.level]}</span>` : '<span></span>'}
      <span class="feed-time" title="${time(s.created || s.t, true)}">${ago(s.created || s.t)}</span>
    </div>`).join('');
}

export function renderCandleHits(root, hits, symbol) {
  const recent = (hits || []).filter((h) => h.dir !== 'neutral').slice(-60).reverse();
  if (!recent.length) { root.innerHTML = '<div class="empty">Aucune figure de chandelier récente.</div>'; return; }
  const stars = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
  root.innerHTML = recent.map((h) => `
    <div class="feed-row" data-symbol="${escapeHtml(symbol)}" data-time="${h.t}">
      <span class="feed-dir" style="color:${DIR_COLORS[h.dir]}">${ARROW[h.dir]}</span>
      <span class="feed-sym">${time(h.t, true)}</span>
      <span class="feed-title">${escapeHtml(h.name)} <small>${h.candles} bougie${h.candles > 1 ? 's' : ''} ·
        ${{ reversal: 'retournement', continuation: 'continuation', indecision: 'indécision' }[h.kind]}</small></span>
      <span class="stars" title="Fiabilité">${stars(h.reliability)}</span>
      <span></span><span></span>
    </div>`).join('');
}

export function renderProviders(root, providers, socketState) {
  const states = { connected: 'ok', connecting: 'warn', error: 'err', stopped: 'err' };
  const names = { simulator: 'Simulateur', deriv: 'Deriv', mt5: 'MetaTrader 5', tradingview: 'TradingView' };
  const items = (providers || []).map((p) => `<span class="conn conn-${states[p.state] || 'warn'}" title="${escapeHtml(p.message)}">
    <i></i>${names[p.name] || escapeHtml(p.name)}</span>`).join('');
  const ws = socketState === 'open' ? '' : `<span class="conn conn-err"><i></i>Serveur ${socketState === 'connecting' ? 'en connexion…' : 'déconnecté'}</span>`;
  root.innerHTML = ws + items;
}
