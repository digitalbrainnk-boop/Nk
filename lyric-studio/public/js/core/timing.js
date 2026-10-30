// Quelles lignes sont à l'écran à l'instant t, où, et avec quelle opacité.
// Modes d'affichage :
//   single    : une ligne à la fois ;
//   alternate : N emplacements, chaque ligne reprend la place de celle d'il y a N lignes
//               dès qu'elle est finie (karaoké classique : on lit la suivante à l'avance) ;
//   page      : N lignes affichées ensemble, remplacées toutes à la fois ;
//   scroll    : défilement, la ligne chantée au centre, les autres estompées.

export function lineSpan(line) {
  let start = Infinity;
  let end = -Infinity;
  for (const w of line.words) {
    if (Number.isFinite(w.start)) start = Math.min(start, w.start);
    if (Number.isFinite(w.end)) end = Math.max(end, w.end);
  }
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
}

/** Lignes minutées avec leur index d'origine, dans l'ordre. */
export function timedLines(lines) {
  const out = [];
  lines.forEach((line, index) => {
    const span = lineSpan(line);
    if (span) out.push({ index, line, start: span.start, end: span.end });
  });
  return out;
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const ease = (x) => {
  x = clamp01(x);
  return x * x * (3 - 2 * x);
};

/** Avancement d'un mot (0 = pas commencé, 1 = fini). */
export function wordProgress(word, t) {
  if (!Number.isFinite(word.start)) return 0;
  if (t <= word.start) return 0;
  if (t >= word.end) return 1;
  return (t - word.start) / Math.max(0.001, word.end - word.start);
}

/** Groupes de lignes séparés par un long silence (après un pont, on repart du premier emplacement). */
function groupsOf(T, gapHide) {
  const groups = [];
  T.forEach((x, k) => {
    if (!k || x.start - T[k - 1].end > gapHide || (x.stanzaBreak && x.start - T[k - 1].end > gapHide / 2)) groups.push([]);
    groups.at(-1).push(x);
  });
  return groups;
}

/**
 * Calcule pour chaque ligne minutée son intervalle d'affichage [appear, disappear) et sa place.
 * Résultat mis en cache par l'appelant (dépend seulement des lignes et des réglages).
 */
export function schedule(lines, layout = {}) {
  const mode = layout.display || "alternate";
  const N = mode === "single" ? 1 : Math.max(1, Math.min(6, layout.lines || 2));
  const preRoll = layout.preRoll ?? 2.5;
  const hold = layout.hold ?? 1.2;
  const gapHide = Math.max(3, preRoll + hold + 0.5);
  const T = timedLines(lines);
  T.forEach((x, k) => (x.stanzaBreak = k > 0 && x.line.stanza !== T[k - 1].line.stanza));
  const items = [];
  if (mode === "scroll") return { mode, N, items: T, preRoll, hold, gapHide };
  let prevGroupEnd = -Infinity;
  for (const group of groupsOf(T, gapHide)) {
    const groupEnd = group.at(-1).end;
    const firstStart = group[0].start;
    if (mode === "page") {
      const pages = [];
      for (let p = 0; p < group.length; p += N) pages.push(group.slice(p, p + N));
      let prevEnd = prevGroupEnd;
      const appears = pages.map((page) => {
        const a = Math.min(page[0].start, Math.max(page[0].start - preRoll, prevEnd + 0.15));
        prevEnd = Math.max(...page.map((x) => x.end));
        return a;
      });
      // Une page disparaît quand la suivante arrive (ou peu après sa dernière ligne en fin de groupe).
      pages.forEach((page, k) => {
        const lastEnd = Math.max(...page.map((x) => x.end));
        const disappear = k + 1 < pages.length ? Math.max(appears[k + 1], lastEnd + 0.05) : Math.max(groupEnd + hold, lastEnd + 0.05);
        page.forEach((x, slot) => items.push({ ...x, slot, appear: appears[k], disappear }));
      });
    } else {
      const gItems = group.map((x, k) => {
        const slot = k % N;
        const prevInSlot = k >= N ? group[k - N] : null;
        const appear = prevInSlot
          ? Math.min(x.start, Math.max(x.start - preRoll, prevInSlot.end + 0.15))
          : Math.min(x.start, Math.max(firstStart - preRoll, prevGroupEnd + 0.15));
        return { ...x, slot, appear };
      });
      gItems.forEach((x, k) => {
        const nextInSlot = gItems[k + N];
        x.disappear = nextInSlot ? Math.max(nextInSlot.appear, x.end + 0.05) : Math.max(groupEnd + hold, x.end + 0.05);
        items.push(x);
      });
    }
    prevGroupEnd = groupEnd + hold;
  }
  return { mode, N, items, preRoll, hold, gapHide };
}

/**
 * Lignes visibles à l'instant t.
 * Chaque élément : { index, line, start, end, slot (place, peut être fractionnaire en défilement),
 *                    alpha, enter (0→1 à l'apparition), state: "future" | "current" | "past" }.
 */
export function visibleAt(sched, t, fade = 0.3, { fadeOut = fade, animDuration = Math.max(fade * 1.5, 0.2) } = {}) {
  if (sched.mode === "scroll") return scrollAt(sched, t, fade);
  const out = [];
  const fi = Math.max(0.01, fade);
  const fo = Math.max(0.01, fadeOut);
  for (const x of sched.items) {
    if (t < x.appear - 0.001 || t >= x.disappear) continue;
    const alpha = Math.min(1, (t - x.appear) / fi + 0.0001, (x.disappear - t) / fo);
    out.push({
      index: x.index,
      line: x.line,
      start: x.start,
      end: x.end,
      slot: x.slot,
      alpha: clamp01(alpha),
      enter: ease((t - x.appear) / Math.max(0.05, animDuration)),
      state: t < x.start ? "future" : t <= x.end ? "current" : "past",
    });
  }
  return out;
}

function scrollAt(sched, t, fade) {
  const T = sched.items;
  if (!T.length) return [];
  const lead = 0.15;
  const trans = 0.4;
  // Ligne « active » : la dernière commencée (avec une légère avance).
  let k = -1;
  for (let i = 0; i < T.length; i++) if (T[i].start - lead <= t) k = i;
  let focus;
  if (k < 0) focus = 0;
  else {
    const p = ease((t - (T[k].start - lead)) / trans);
    focus = k - 1 + p;
    if (k === 0) focus = Math.max(0, focus);
  }
  // Masqué pendant un long passage sans voix (ou avant le début).
  let alphaAll = 1;
  if (k < 0) alphaAll = clamp01(1 - (T[0].start - sched.preRoll - t) / fade);
  else if (k >= 0) {
    const next = T[k + 1];
    const quietFrom = T[k].end + sched.hold;
    const quietTo = next ? next.start - sched.preRoll : Infinity;
    if (quietTo - quietFrom > 0.5 && t > quietFrom)
      alphaAll = clamp01(Math.max((quietFrom + fade - t) / fade, next ? (t - quietTo) / fade : 0));
  }
  if (alphaAll <= 0) return [];
  const before = 1;
  const after = Math.max(1, sched.N - 1);
  const out = [];
  for (let i = Math.max(0, Math.floor(focus - before - 1)); i <= Math.min(T.length - 1, Math.ceil(focus + after + 1)); i++) {
    const off = i - focus;
    if (off < -before - 0.999 || off > after + 0.999) continue;
    const edge = off < 0 ? clamp01(before + 1 + off) : clamp01(after + 1 - off);
    const x = T[i];
    out.push({
      index: x.index,
      line: x.line,
      start: x.start,
      end: x.end,
      slot: off,
      alpha: alphaAll * edge * (Math.abs(off) < 0.5 ? 1 : 0.55),
      enter: 1,
      state: t < x.start ? "future" : t <= x.end ? "current" : "past",
      focus: Math.abs(off) < 0.5,
    });
  }
  return out;
}

/**
 * Compte à rebours du karaoké (3 points qui s'éteignent) avant une ligne qui suit un long silence.
 * Renvoie { remaining, index } ou null.
 */
export function countdownAt(sched, t, { lead = 3, minGap = 4 } = {}) {
  const T = sched.mode === "scroll" ? sched.items : sched.items.slice().sort((a, b) => a.start - b.start);
  for (let k = 0; k < T.length; k++) {
    const x = T[k];
    if (x.start <= t) continue;
    const prevEnd = k ? T[k - 1].end : 0;
    if (x.start - prevEnd < minGap || x.start - t > lead || t < prevEnd) return null;
    return { remaining: x.start - t, index: x.index, slot: x.slot ?? 0 };
  }
  return null;
}

/** Opacité du titre d'introduction (avant la première ligne). */
export function titleAlpha(sched, t, duration = 4, fade = 0.6) {
  const first = sched.items.reduce((m, x) => Math.min(m, x.appear ?? x.start - sched.preRoll), Infinity);
  const until = Math.min(duration, (Number.isFinite(first) ? first : duration) - 0.2);
  if (until <= 0.3 || t >= until) return 0;
  return clamp01((until - t) / fade);
}
