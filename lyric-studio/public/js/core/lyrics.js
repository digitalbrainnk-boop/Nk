// Paroles : texte collé <-> lignes de mots minutés.
// Une ligne = { id, singer, stanza, words: [{ id, text, start, end, conf? }] }.
// Texte accepté :
//   - une ligne de texte = une ligne à l'écran, une ligne vide = nouveau couplet ;
//   - [Refrain], [Couplet 2]… sont des repères (comme dans les paroles Suno), pas chantés ;
//   - « A: », « B: », « AB: » (ou 1:, 2:, TOUS:) en début de ligne = chanteur pour le mode duo,
//     valable pour les lignes suivantes du même couplet ; « [Refrain - B] » marche aussi.

let counter = 0;
export function uid(prefix = "w") {
  counter = (counter + 1) % 1679616;
  return prefix + Date.now().toString(36).slice(-6) + counter.toString(36) + Math.random().toString(36).slice(2, 6);
}

const SINGER_PREFIX = /^\s*(AB|A\s*\+\s*B|A|B|1|2|3|TOUS|TOUTES|ENSEMBLE|ALL|BOTH|DUO)\s*[:：]\s*/i;
const SINGER_IN_TAG = /(?:^|[\s:\-–—,|])(AB|A\s*\+\s*B|A|B|TOUS|TOUTES|ENSEMBLE|ALL|BOTH|DUO)\s*$/i;
const TAG_LINE = /^\s*[[{][^\]}]*[\]}]\s*$/;
const ONLY_PUNCT = /^[^\p{L}\p{N}]+$/u;

export function singerFromTag(tag) {
  const t = tag.toUpperCase().replace(/\s+/g, "");
  if (t === "A" || t === "1") return 0;
  if (t === "B" || t === "2") return 1;
  return 2;
}

/** Découpe une ligne en mots ; la ponctuation isolée (« — », « ! ») reste collée au mot voisin. */
export function tokenize(line) {
  const out = [];
  for (const tok of String(line).split(/\s+/).filter(Boolean)) {
    if (ONLY_PUNCT.test(tok) && out.length) out[out.length - 1] += ` ${tok}`;
    else if (out.length && ONLY_PUNCT.test(out[out.length - 1])) out[out.length - 1] += ` ${tok}`;
    else out.push(tok);
  }
  return out;
}

export function parseLyrics(text) {
  const lines = [];
  let stanza = 0;
  let singer = 0;
  let pendingBreak = false;
  for (const raw of String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")) {
    let line = raw.trim();
    if (!line) {
      if (lines.length) pendingBreak = true;
      singer = 0;
      continue;
    }
    if (TAG_LINE.test(line)) {
      const m = line.slice(1, -1).trim().match(SINGER_IN_TAG);
      singer = m ? singerFromTag(m[1]) : 0;
      if (lines.length) pendingBreak = true;
      continue;
    }
    const m = line.match(SINGER_PREFIX);
    if (m) {
      singer = singerFromTag(m[1]);
      line = line.slice(m[0].length).trim();
      if (!line) continue;
    }
    const words = tokenize(line).map((t) => ({ id: uid("w"), text: t, start: null, end: null }));
    if (!words.length) continue;
    if (pendingBreak) stanza++;
    pendingBreak = false;
    lines.push({ id: uid("l"), singer, stanza, words });
  }
  return lines;
}

export const lineText = (line) => line.words.map((w) => w.text).join(" ");

const SINGER_LABEL = ["A: ", "B: ", "AB: "];

/** Texte équivalent aux lignes (pour la zone de saisie), avec les marques de chanteur utiles. */
export function serializeLyrics(lines) {
  const out = [];
  let prevStanza = null;
  let current = 0;
  for (const l of lines) {
    if (prevStanza !== null && l.stanza !== prevStanza) {
      out.push("");
      current = 0;
    }
    const singer = l.singer || 0;
    out.push((singer !== current ? SINGER_LABEL[singer] : "") + lineText(l));
    current = singer;
    prevStanza = l.stanza;
  }
  return out.join("\n");
}

/** Nombre de syllabes approximatif (groupes de voyelles), pour répartir le temps. */
export function syllables(word) {
  const s = String(word)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
  if (!s) return 1;
  const groups = s.match(/[aeiouyœæ]+/g);
  if (groups) return Math.max(1, groups.length);
  return Math.max(1, Math.round(s.length / 3));
}

/**
 * Coupe les lignes trop longues en morceaux équilibrés, de préférence après une virgule.
 * Les mots gardent leur timing.
 */
export function splitLongLines(lines, maxChars = 32) {
  const out = [];
  for (const line of lines) {
    const n = line.words.length;
    const total = lineText(line).length;
    if (total <= maxChars || n < 2) {
      out.push(line);
      continue;
    }
    const parts = Math.min(n, Math.ceil(total / maxChars));
    const ideal = total / parts;
    // len(i, j) = longueur du texte des mots i..j-1
    const lens = line.words.map((w) => w.text.length);
    const segLen = (i, j) => lens.slice(i, j).reduce((a, b) => a + b, 0) + (j - i - 1);
    const cost = (i, j) => {
      const L = segLen(i, j);
      let c = (L - ideal) ** 2;
      if (L > maxChars) c += (L - maxChars) * 400;
      if (j < n && /[,;:.!?…]$/.test(line.words[j - 1].text)) c -= ideal * ideal * 0.12;
      return c;
    };
    // best[k][j] = coût minimal pour couper les j premiers mots en k morceaux
    const best = Array.from({ length: parts + 1 }, () => new Array(n + 1).fill(Infinity));
    const from = Array.from({ length: parts + 1 }, () => new Array(n + 1).fill(-1));
    best[0][0] = 0;
    for (let k = 1; k <= parts; k++) {
      for (let j = k; j <= n; j++) {
        for (let i = k - 1; i < j; i++) {
          if (best[k - 1][i] === Infinity) continue;
          const c = best[k - 1][i] + cost(i, j);
          if (c < best[k][j]) {
            best[k][j] = c;
            from[k][j] = i;
          }
        }
      }
    }
    const cuts = [];
    for (let k = parts, j = n; k > 0; k--) {
      const i = from[k][j];
      cuts.unshift([i, j]);
      j = i;
    }
    cuts.forEach(([i, j], idx) => out.push({ ...line, id: idx === 0 ? line.id : uid("l"), words: line.words.slice(i, j) }));
  }
  return out;
}

export function splitLineAt(lines, lineIndex, wordIndex) {
  const line = lines[lineIndex];
  if (!line || wordIndex <= 0 || wordIndex >= line.words.length) return lines;
  const a = { ...line, words: line.words.slice(0, wordIndex) };
  const b = { ...line, id: uid("l"), words: line.words.slice(wordIndex) };
  return [...lines.slice(0, lineIndex), a, b, ...lines.slice(lineIndex + 1)];
}

export function mergeWithNext(lines, lineIndex) {
  const a = lines[lineIndex];
  const b = lines[lineIndex + 1];
  if (!a || !b) return lines;
  return [...lines.slice(0, lineIndex), { ...a, words: [...a.words, ...b.words] }, ...lines.slice(lineIndex + 2)];
}

/**
 * Construit des lignes à partir de mots minutés (transcription de l'IA, paroles Suno).
 * Les mots peuvent porter br = 1 (nouvelle ligne) ou br = 2 (nouveau couplet) ; sinon on coupe
 * aux silences, à la ponctuation forte et quand la ligne devient trop longue.
 */
export function linesFromTranscript(words, { maxChars = 38, gap = 0.7 } = {}) {
  const hasBreaks = words.some((w) => w.br);
  const lines = [];
  let cur = null;
  let stanza = 0;
  for (const w of words) {
    const text = String(w.text || "").trim();
    if (!text) continue;
    const prev = cur?.words.at(-1);
    let br = w.br || 0;
    if (!hasBreaks && prev) {
      const len = lineText(cur).length;
      const silence = w.start - prev.end;
      if (silence > gap * 3) br = 2;
      else if (silence > gap || len + 1 + text.length > maxChars || (/[.!?…]$/.test(prev.text) && len > maxChars * 0.35)) br = 1;
    }
    if (!cur || br) {
      if (cur && br >= 2) stanza++;
      cur = { id: uid("l"), singer: 0, stanza, words: [] };
      lines.push(cur);
    }
    if (ONLY_PUNCT.test(text) && cur.words.length) {
      const last = cur.words.at(-1);
      last.text += ` ${text}`;
      last.end = Math.max(last.end ?? 0, w.end ?? 0);
      continue;
    }
    cur.words.push({ id: uid("w"), text, start: w.start, end: w.end });
  }
  return lines.filter((l) => l.words.length);
}

/** Copie profonde légère des lignes (pour l'historique et les modifications). */
export const cloneLines = (lines) => lines.map((l) => ({ ...l, words: l.words.map((w) => ({ ...w })) }));
