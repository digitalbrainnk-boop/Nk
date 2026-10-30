// Synchronisation mot par mot.
// 1. Avec une référence minutée (transcription de l'IA, paroles horodatées de Suno, ancien
//    timing) : on aligne les paroles sur la référence (alignement de séquences tolérant aux
//    fautes, mots en trop ou manquants), puis on interpole les mots non retrouvés.
// 2. Sans IA : on répartit les lignes sur les passages où la voix est présente.
import { syllables, cloneLines } from "./lyrics.js";

export function normalizeToken(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** Ressemblance entre deux mots normalisés, de 0 (rien à voir) à 1 (identiques). */
export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

const GAP = -0.5;
function matchScore(sim) {
  if (sim >= 0.75) return 2 * sim;
  if (sim >= 0.5) return sim;
  return sim * 1.5 - 1.2;
}

/**
 * Alignement global (Needleman-Wunsch) de deux suites de mots normalisés.
 * Renvoie, pour chaque mot de A, { j, sim } (mot correspondant de B) ou null.
 */
export function alignSequences(A, B) {
  const n = A.length;
  const m = B.length;
  const result = new Array(n).fill(null);
  if (!n || !m) return result;
  // Ressemblances calculées une fois par paire de mots distincts (les refrains se répètent).
  const ua = [...new Set(A)];
  const ub = [...new Set(B)];
  const ia = new Map(ua.map((w, i) => [w, i]));
  const ib = new Map(ub.map((w, i) => [w, i]));
  const simTable = new Float32Array(ua.length * ub.length);
  for (let x = 0; x < ua.length; x++) for (let y = 0; y < ub.length; y++) simTable[x * ub.length + y] = similarity(ua[x], ub[y]);
  const ai = A.map((w) => ia.get(w));
  const bi = B.map((w) => ib.get(w));
  const sim = (i, j) => simTable[ai[i] * ub.length + bi[j]];

  const W = m + 1;
  const score = new Float32Array((n + 1) * W);
  const move = new Uint8Array((n + 1) * W); // 0 diagonale, 1 mot de A sans partenaire, 2 mot de B sans partenaire
  for (let i = 1; i <= n; i++) {
    score[i * W] = i * GAP;
    move[i * W] = 1;
  }
  for (let j = 1; j <= m; j++) {
    score[j] = j * GAP;
    move[j] = 2;
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const d = score[(i - 1) * W + j - 1] + matchScore(sim(i - 1, j - 1));
      const u = score[(i - 1) * W + j] + GAP;
      const l = score[i * W + j - 1] + GAP;
      let best = d;
      let mv = 0;
      if (u > best) (best = u), (mv = 1);
      if (l > best) (best = l), (mv = 2);
      score[i * W + j] = best;
      move[i * W + j] = mv;
    }
  }
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const mv = move[i * W + j];
    if (mv === 0) {
      result[i - 1] = { j: j - 1, sim: sim(i - 1, j - 1) };
      i--;
      j--;
    } else if (mv === 1) i--;
    else j--;
  }
  return result;
}

/** Durée « naturelle » d'un mot chanté, en secondes. */
export const naturalDuration = (text) => Math.min(1.2, 0.18 + 0.12 * syllables(text));

/** Répartit les mots d'une ligne entre start et end, selon leurs syllabes. */
export function distributeWords(words, start, end) {
  const weights = words.map((w) => syllables(w.text) + 0.3);
  const total = weights.reduce((a, b) => a + b, 0);
  let t = start;
  const span = Math.max(0.05, end - start);
  words.forEach((w, k) => {
    const d = (span * weights[k]) / total;
    w.start = round(t);
    w.end = round(t + d * 0.94);
    t += d;
  });
}

const round = (x) => Math.round(x * 1000) / 1000;

/**
 * Remet de l'ordre : départs croissants, durée minimale, pas de chevauchement,
 * durée maximale (évite qu'un mot reste « allumé » pendant tout un pont instrumental).
 */
export function fixTimings(lines, { minDur = 0.06, maxDur = 4 } = {}) {
  const words = lines.flatMap((l) => l.words).filter((w) => Number.isFinite(w.start));
  let last = -Infinity;
  for (const w of words) {
    w.start = Math.max(w.start, last + 0.005, 0);
    if (!Number.isFinite(w.end) || w.end < w.start + minDur) w.end = w.start + minDur;
    last = w.start;
  }
  for (let k = 0; k < words.length; k++) {
    const w = words[k];
    const next = words[k + 1];
    if (next && w.end > next.start) w.end = Math.max(w.start + 0.01, next.start - 0.005);
    if (w.end - w.start > maxDur) w.end = w.start + maxDur;
    w.start = round(w.start);
    w.end = round(w.end);
  }
  return lines;
}

/**
 * Place une suite de mots sans repère entre prevEnd et nextStart.
 * Petits trous : on étale. Grands trous (refrain non reconnu, pont instrumental) : les mots de
 * la ligne précédente suivent le repère précédent, ceux de la ligne suivante précèdent le repère
 * suivant, et les lignes entières se partagent le milieu (sur la voix détectée si on l'a).
 */
function placeRun(run, prevEnd, nextStart, activity) {
  const nat = run.map((r) => naturalDuration(r.w.text));
  const natTotal = nat.reduce((a, b) => a + b, 0);
  const gap = nextStart - prevEnd;
  if (gap <= natTotal * 1.6 + 0.6) {
    let t = prevEnd + Math.min(0.05, gap * 0.02);
    const scale = Math.max(0.02, gap - 0.1) / natTotal;
    run.forEach((r, k) => {
      r.time = { start: t, end: t + nat[k] * scale * 0.95 };
      t += nat[k] * scale;
    });
    return;
  }
  const prevLine = run[0].prevLine;
  const nextLine = run.at(-1).nextLine;
  let a = 0;
  let t = prevEnd + 0.05;
  while (a < run.length && run[a].li === prevLine) {
    run[a].time = { start: t, end: t + nat[a] * 0.95 };
    t += nat[a];
    a++;
  }
  const headEnd = t;
  let b = run.length - 1;
  t = nextStart - 0.05;
  while (b >= a && run[b].li === nextLine) {
    t -= nat[b];
    run[b].time = { start: t, end: t + nat[b] * 0.95 };
    b--;
  }
  const tailStart = t;
  if (b < a) return;
  // Lignes entières au milieu.
  const middle = run.slice(a, b + 1);
  const groups = [];
  for (const r of middle) {
    if (!groups.length || groups.at(-1)[0].li !== r.li) groups.push([]);
    groups.at(-1).push(r);
  }
  const from = headEnd + 0.3;
  const to = Math.max(from + 0.1, tailStart - 0.3);
  const segs = (activity || [])
    .map((s) => ({ start: Math.max(s.start, from), end: Math.min(s.end, to) }))
    .filter((s) => s.end - s.start > 0.15);
  if (segs.length) {
    const sub = syncLinesByActivity(
      groups.map((g) => ({ words: g.map((r) => ({ text: r.w.text, start: null, end: null })) })),
      segs,
    );
    sub.forEach((l, gi) => l.words.forEach((w, k) => (groups[gi][k].time = { start: w.start, end: w.end })));
    return;
  }
  const slot = (to - from) / groups.length;
  groups.forEach((g, gi) => {
    const natLine = g.reduce((s, r) => s + naturalDuration(r.w.text), 0);
    const len = Math.min(slot * 0.9, natLine * 1.3);
    const words = g.map((r) => ({ text: r.w.text }));
    distributeWords(words, from + gi * slot, from + gi * slot + len);
    g.forEach((r, k) => (r.time = { start: words[k].start, end: words[k].end }));
  });
}

/**
 * Cale les paroles sur des mots minutés.
 * @param lines   lignes à caler (non modifiées : on renvoie une copie)
 * @param ref     [{ text, start, end }] dans l'ordre (transcription, Suno, ancien timing…)
 * @returns { lines, matched, total }
 */
export function syncLinesToReference(lines, ref, { duration, activity } = {}) {
  const out = cloneLines(lines);
  const flat = [];
  out.forEach((l, li) => l.words.forEach((w) => flat.push({ li, w, tok: normalizeToken(w.text), time: null })));
  const refs = (ref || []).filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && normalizeToken(r.text));
  const refTok = refs.map((r) => normalizeToken(r.text));
  const pairs = alignSequences(
    flat.map((f) => f.tok),
    refTok,
  );
  const used = new Uint8Array(refs.length);
  let matched = 0;
  pairs.forEach((p, i) => {
    if (!p || !flat[i].tok) return;
    used[p.j] = 1;
    flat[i].time = { start: refs[p.j].start, end: refs[p.j].end };
    flat[i].conf = Math.round(Math.max(0.3, p.sim) * 100) / 100;
    flat[i].j = p.j;
    if (p.sim >= 0.5) matched++;
  });
  // Un mot coupé en deux par la transcription (« aujourd » + « hui ») : on prend les deux morceaux.
  for (const f of flat) {
    if (f.j === undefined) continue;
    let joined = refTok[f.j];
    let best = similarity(f.tok, joined);
    for (let k = f.j + 1; k < refs.length && !used[k] && refs[k].start - refs[k - 1].end < 0.35; k++) {
      joined += refTok[k];
      const s = similarity(f.tok, joined);
      if (s <= best) break;
      best = s;
      used[k] = 1;
      f.time.end = refs[k].end;
      f.conf = Math.max(f.conf, Math.round(s * 100) / 100);
    }
  }
  const end = duration || (refs.length ? refs.at(-1).end + 5 : 0);
  // Mots sans repère : on les place entre leurs voisins.
  for (let i = 0; i < flat.length; ) {
    if (flat[i].time) {
      i++;
      continue;
    }
    let k = i;
    while (k < flat.length && !flat[k].time) k++;
    const run = flat.slice(i, k).map((f) => ({ ...f, prevLine: flat[i - 1]?.li, nextLine: flat[k]?.li }));
    if (i === 0 && k === flat.length) {
      // Rien de reconnu : répartition sur la voix détectée.
      const synced = syncLinesByActivity(out, activity?.length ? activity : [{ start: 0, end: end || 1 }]);
      return { lines: synced, matched: 0, total: flat.length };
    }
    if (i === 0) {
      // Avant le premier repère : juste avant lui.
      let t = flat[k].time.start - 0.05;
      for (let r = run.length - 1; r >= 0; r--) {
        const d = naturalDuration(run[r].w.text);
        t -= d;
        run[r].time = { start: Math.max(0, t), end: Math.max(0.05, t + d * 0.95) };
      }
    } else if (k === flat.length) {
      // Après le dernier repère : juste après lui.
      let t = flat[i - 1].time.end + 0.05;
      for (const r of run) {
        const d = naturalDuration(r.w.text);
        r.time = { start: t, end: t + d * 0.95 };
        t += d;
      }
    } else {
      placeRun(run, flat[i - 1].time.end, flat[k].time.start, activity);
    }
    run.forEach((r, x) => (flat[i + x].time = r.time));
    i = k;
  }
  for (const f of flat) {
    f.w.start = round(f.time.start);
    f.w.end = round(f.time.end);
    if (f.conf !== undefined) f.w.conf = f.conf;
    else f.w.conf = 0;
  }
  fixTimings(out);
  return { lines: out, matched, total: flat.length };
}

/**
 * Sans IA : répartit les lignes sur les passages de voix détectés (segments [{start, end}]).
 * Chaque ligne reçoit un temps proportionnel à ses syllabes, plus une respiration.
 */
export function syncLinesByActivity(lines, segments) {
  const out = cloneLines(lines);
  const segs = (segments || []).filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  if (!segs.length || !out.length) return out;
  const voiced = segs.reduce((s, x) => s + (x.end - x.start), 0);
  const weights = out.map((l) => l.words.reduce((s, w) => s + naturalDuration(w.text), 0) + 0.5);
  const total = weights.reduce((a, b) => a + b, 0);
  const scale = voiced / total;
  // Position dans le « temps chanté » -> temps réel.
  const toReal = (x) => {
    let acc = 0;
    for (const s of segs) {
      const d = s.end - s.start;
      if (x <= acc + d) return { t: s.start + (x - acc), seg: s };
      acc += d;
    }
    return { t: segs.at(-1).end, seg: segs.at(-1) };
  };
  let x = 0;
  out.forEach((l, li) => {
    const lineLen = (weights[li] - 0.5) * scale;
    let a = toReal(x + 0.25 * scale);
    let b = toReal(x + 0.25 * scale + lineLen);
    // Une ligne ne traverse pas un long silence : elle commence après.
    if (a.seg !== b.seg && b.seg.start - a.t > 0.8 && a.seg.end - a.t < lineLen * 0.5) a = { t: b.seg.start, seg: b.seg };
    if (b.t <= a.t) b = { t: a.t + lineLen, seg: a.seg };
    distributeWords(l.words, a.t, b.t);
    l.words.forEach((w) => (w.conf = 0));
    x += weights[li] * scale;
  });
  return fixTimings(out);
}

/** Décale tous les mots minutés de delta secondes (jamais avant 0). */
export function shiftAll(lines, delta) {
  const out = cloneLines(lines);
  for (const l of out)
    for (const w of l.words) {
      if (!Number.isFinite(w.start)) continue;
      w.start = round(Math.max(0, w.start + delta));
      w.end = round(Math.max(w.start + 0.02, w.end + delta));
    }
  return out;
}

/** Garde le timing des mots inchangés après une modification du texte. */
export function retimeAfterEdit(newLines, oldLines, opts) {
  const ref = oldLines.flatMap((l) => l.words).filter((w) => Number.isFinite(w.start));
  if (!ref.length) return { lines: newLines, matched: 0, total: 0 };
  const res = syncLinesToReference(newLines, ref, opts);
  // Les mots retrouvés gardent leur fiabilité d'origine.
  const oldConf = new Map(ref.map((w) => [`${w.start}|${w.end}`, w.conf ?? 1]));
  for (const l of res.lines) for (const w of l.words) if (w.conf >= 0.5) w.conf = oldConf.get(`${w.start}|${w.end}`) ?? w.conf;
  return res;
}
