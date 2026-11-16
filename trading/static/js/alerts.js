// Alertes : sons générés par Web Audio (aucun fichier audio), notifications visuelles
// (toasts), notifications du système et compteur dans le titre de l'onglet.

import { DIR_COLORS, RISK_COLORS, RISK_LABELS, TYPE_LABELS } from './colors.js';
import { escapeHtml, price } from './format.js';

// Profils sonores : [fréquence Hz, durée s, forme d'onde] joués à la suite.
const PROFILES = {
  bullish: [[660, 0.12, 'sine'], [880, 0.12, 'sine'], [1100, 0.18, 'sine']],        // montée
  bearish: [[1100, 0.12, 'sine'], [880, 0.12, 'sine'], [587, 0.2, 'sine']],         // descente
  breakout: [[1000, 0.08, 'square'], [0, 0.05], [1000, 0.08, 'square'], [0, 0.05], [1400, 0.16, 'square']],
  pattern: [[523, 0.11, 'triangle'], [659, 0.11, 'triangle'], [784, 0.11, 'triangle'], [1047, 0.25, 'triangle']],
};

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.volume = 0.6;
    this.muted = false;
  }

  get unlocked() { return Boolean(this.ctx) && this.ctx.state === 'running'; }

  /** Doit être appelé depuis un geste utilisateur (politique d'autoplay des navigateurs). */
  async unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    return this.unlocked;
  }

  play(profile, repeat = 1) {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    const notes = PROFILES[profile] || PROFILES.bullish;
    let t = this.ctx.currentTime + 0.02;
    for (let r = 0; r < repeat; r++) {
      for (const [freq, dur, wave] of notes) {
        if (freq > 0) this.tone(freq, t, dur, wave);
        t += dur;
      }
      t += 0.25;
    }
  }

  tone(freq, start, dur, wave = 'sine') {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, start);
    const peak = Math.max(0.0001, this.volume * (wave === 'square' ? 0.18 : 0.35));
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }
}

export class AlertCenter {
  constructor(toastRoot, onOpen) {
    this.root = toastRoot;
    this.onOpen = onOpen;
    this.sound = new SoundEngine();
    this.unread = 0;
    this.desktop = false;
    this.baseTitle = document.title;
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { this.unread = 0; document.title = this.baseTitle; }
    });
  }

  trigger(alert) {
    // Sonnerie répétée pour les signaux très forts (score ≥ 85).
    this.sound.play(alert.sound, alert.score >= 85 ? 2 : 1);
    this.toast(alert);
    if (document.hidden) {
      this.unread += 1;
      document.title = `(${this.unread}) 🔔 ${this.baseTitle}`;
      if (this.desktop && 'Notification' in window && Notification.permission === 'granted') {
        const n = new Notification(`${alert.symbol} ${alert.tf} — ${alert.title}`, {
          body: `${TYPE_LABELS[alert.type] || alert.type} · score ${Math.round(alert.score)}`
            + (alert.risk ? ` · risque ${RISK_LABELS[alert.risk.level]}` : ''),
          tag: alert.id,
        });
        n.onclick = () => { window.focus(); this.onOpen(alert); n.close(); };
      }
    }
  }

  toast(alert) {
    const el = document.createElement('div');
    el.className = `toast toast-${alert.dir}`;
    el.style.setProperty('--accent', DIR_COLORS[alert.dir] || DIR_COLORS.neutral);
    const risk = alert.risk
      ? `<span class="badge" style="--c:${RISK_COLORS[alert.risk.level]}">Risque ${RISK_LABELS[alert.risk.level]}</span>` : '';
    const confluence = alert.confluence && alert.confluence.length
      ? `<div class="toast-sub">+ ${alert.confluence.map(escapeHtml).join(' · ')}</div>` : '';
    el.innerHTML = `
      <div class="toast-head">
        <span class="toast-sym">${escapeHtml(alert.symbol)} · ${alert.tf}</span>
        <span class="toast-type">${TYPE_LABELS[alert.type] || alert.type}</span>
        <button class="toast-close" aria-label="Fermer">×</button>
      </div>
      <div class="toast-title">${alert.dir === 'bullish' ? '▲' : alert.dir === 'bearish' ? '▼' : '◆'} ${escapeHtml(alert.title)}</div>
      <div class="toast-sub">${escapeHtml(alert.description)}</div>
      ${confluence}
      <div class="toast-foot">
        <span>Prix ${price(alert.price, alert.symbol)}</span>
        <span class="score">Score ${Math.round(alert.score)}</span>
        ${risk}
      </div>`;
    el.addEventListener('click', (ev) => {
      if (ev.target.closest('.toast-close')) { el.remove(); return; }
      this.onOpen(alert);
      el.remove();
    });
    this.root.prepend(el);
    while (this.root.children.length > 3) this.root.lastElementChild.remove();
    setTimeout(() => el.classList.add('leaving'), 10000);
    setTimeout(() => el.remove(), 10600);
  }

  async enableDesktop() {
    if (!('Notification' in window)) return false;
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    this.desktop = perm === 'granted';
    return this.desktop;
  }
}
