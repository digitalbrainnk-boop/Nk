// Traitement du son en JavaScript pur (navigateur et tests) : forme d'onde, détection de la voix,
// voix retirée « au centre » (karaoké sans séparation par IA), WAV pour l'envoi à l'IA.

/** Moyenne des canaux. */
export function downmix(channels) {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i];
  const k = 1 / channels.length;
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}

/** Pics (valeur absolue maximale) par tranche : perSec valeurs par seconde. */
export function computePeaks(channels, sampleRate, perSec = 100) {
  const n = channels[0].length;
  const step = sampleRate / perSec;
  const count = Math.ceil(n / step);
  const peaks = new Float32Array(count);
  for (const ch of channels) {
    for (let b = 0; b < count; b++) {
      const from = Math.floor(b * step);
      const to = Math.min(n, Math.floor((b + 1) * step));
      let m = peaks[b];
      for (let i = from; i < to; i++) {
        const v = ch[i] < 0 ? -ch[i] : ch[i];
        if (v > m) m = v;
      }
      peaks[b] = m;
    }
  }
  return peaks;
}

/** Filtre biquad (formules RBJ). type : lowpass | highpass. Renvoie un nouveau tableau. */
export function biquad(input, sampleRate, type, freq, q = Math.SQRT1_2) {
  const w0 = (2 * Math.PI * Math.min(freq, sampleRate * 0.45)) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  let b0, b1, b2;
  if (type === "lowpass") {
    b0 = (1 - cos) / 2;
    b1 = 1 - cos;
    b2 = (1 - cos) / 2;
  } else {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = (1 + cos) / 2;
  }
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  const out = new Float32Array(input.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  const B0 = b0 / a0,
    B1 = b1 / a0,
    B2 = b2 / a0,
    A1 = a1 / a0,
    A2 = a2 / a0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = B0 * x + B1 * x1 + B2 * x2 - A1 * y1 - A2 * y2;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
}

/** Rééchantillonnage (filtre anti-repliement + interpolation linéaire). */
export function resample(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  let src = input;
  if (toRate < fromRate) src = biquad(biquad(input, fromRate, "lowpass", toRate * 0.45), fromRate, "lowpass", toRate * 0.45);
  const ratio = fromRate / toRate;
  const n = Math.floor(src.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const f = x - i0;
    out[i] = src[i0] * (1 - f) + (src[i0 + 1] ?? src[i0]) * f;
  }
  return out;
}

/** WAV 16 bits (mono ou multicanal entrelacé). */
export function encodeWav(channels, sampleRate) {
  const chs = Array.isArray(channels) ? channels : [channels];
  const n = chs[0].length;
  const nch = chs.length;
  const buf = new ArrayBuffer(44 + n * nch * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + n * nch * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nch, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * nch * 2, true);
  v.setUint16(32, nch * 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * nch * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nch; c++) {
      const s = Math.max(-1, Math.min(1, chs[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return buf;
}

/** Son mono 16 kHz pour la transcription (léger : ~2 Mo par minute). */
export function speechWav(channels, sampleRate) {
  const mono = resample(downmix(channels), sampleRate, 16000);
  let peak = 0;
  for (let i = 0; i < mono.length; i++) peak = Math.max(peak, Math.abs(mono[i]));
  if (peak > 0 && peak < 0.7) for (let i = 0; i < mono.length; i++) mono[i] *= 0.9 / peak;
  return encodeWav(mono, 16000);
}

/**
 * Passages où la voix est probablement présente : énergie dans la bande de la voix,
 * seuil adaptatif entre le niveau de fond et le niveau fort du morceau.
 * Avec une piste « voix seule » (séparée), le résultat est très fiable ; sur le mixage, approximatif.
 */
export function detectActivity(channels, sampleRate, { frame = 0.02, minOn = 0.25, minOff = 0.3, ratio = 0.35 } = {}) {
  let x = downmix(channels);
  // Bande de la voix (~250 Hz à 3,5 kHz) : on écarte basses et cymbales.
  x = biquad(biquad(x, sampleRate, "highpass", 250), sampleRate, "lowpass", 3500);
  const hop = Math.max(1, Math.round(frame * sampleRate));
  const frames = Math.floor(x.length / hop);
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) s += x[i] * x[i];
    env[f] = Math.sqrt(s / hop);
  }
  // Lissage sur ~100 ms.
  const sm = new Float32Array(frames);
  const R = 2;
  for (let f = 0; f < frames; f++) {
    let s = 0,
      c = 0;
    for (let k = Math.max(0, f - R); k <= Math.min(frames - 1, f + R); k++) (s += env[k]), c++;
    sm[f] = s / c;
  }
  const sorted = Array.from(sm).sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] || 0;
  const floor = pct(0.15);
  const loud = pct(0.9);
  if (loud <= 1e-6) return [];
  const thr = floor + ratio * (loud - floor);
  const segs = [];
  let on = -1;
  for (let f = 0; f <= frames; f++) {
    const active = f < frames && sm[f] > thr;
    if (active && on < 0) on = f;
    if (!active && on >= 0) {
      segs.push({ start: on * frame, end: f * frame });
      on = -1;
    }
  }
  // Fusion des petits trous, suppression des éclats trop courts.
  const merged = [];
  for (const s of segs) {
    const last = merged.at(-1);
    if (last && s.start - last.end < minOff) last.end = s.end;
    else merged.push({ ...s });
  }
  return merged
    .filter((s) => s.end - s.start >= minOn)
    .map((s) => ({ start: Math.round(s.start * 1000) / 1000, end: Math.round(s.end * 1000) / 1000 }));
}

/**
 * Karaoké sans IA : on retire ce qui est au centre du stéréo (la voix en général) en gardant
 * les basses (sinon la grosse caisse et la basse disparaissent aussi).
 * Renvoie [gauche, droite].
 */
export function centerCancel(left, right, sampleRate, { bassHz = 160 } = {}) {
  const n = left.length;
  const side = new Float32Array(n);
  const mid = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    side[i] = (left[i] - right[i]) * 0.5;
    mid[i] = (left[i] + right[i]) * 0.5;
  }
  const bass = biquad(biquad(mid, sampleRate, "lowpass", bassHz), sampleRate, "lowpass", bassHz);
  const high = biquad(side, sampleRate, "highpass", bassHz);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = bass[i] + high[i] * 1.4;
    R[i] = bass[i] - high[i] * 1.4;
  }
  return [L, R];
}

/** Niveau maximal (0 à 1) de plusieurs canaux. */
export function peakOf(channels) {
  let peak = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) if (ch[i] > peak || -ch[i] > peak) peak = Math.abs(ch[i]);
  return peak;
}

/** Mélange de pistes (mêmes fréquence et nombre de canaux) avec un volume chacune. */
export function mix(tracks, length) {
  const nch = Math.max(...tracks.map((t) => t.channels.length));
  const n = length ?? Math.max(...tracks.map((t) => t.channels[0].length));
  const out = Array.from({ length: nch }, () => new Float32Array(n));
  for (const { channels, gain } of tracks) {
    if (!gain) continue;
    for (let c = 0; c < nch; c++) {
      const src = channels[Math.min(c, channels.length - 1)];
      const m = Math.min(n, src.length);
      const dst = out[c];
      for (let i = 0; i < m; i++) dst[i] += src[i] * gain;
    }
  }
  // Limiteur simple pour éviter la saturation.
  let peak = 0;
  for (const ch of out) for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(ch[i]));
  if (peak > 0.99) for (const ch of out) for (let i = 0; i < n; i++) ch[i] *= 0.99 / peak;
  return out;
}
