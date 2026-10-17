// Détection de rimes en français : approximation phonétique de la fin des vers.
// Ce n'est pas un phonétiseur complet, mais il reconnaît les rimes courantes
// d'une chanson (amour/toujours, cœur/bonheur, belle/éternelle, soleil/merveille…).

const V = "aàâäeéèêëiîïoôöuùûüyœæ";
const VOWEL_RE = new RegExp(`[${V}]`);
const TAG_LINE = /^\s*\[[^\]]*\]\s*$/;

const EXCEPTIONS: Record<string, string> = {
  mer: "è|r", fer: "è|r", hier: "è|r", hiver: "è|r", enfer: "è|r", cher: "è|r", fier: "è|r", amer: "è|r",
  ver: "è|r", vers: "è|r", univers: "è|r", envers: "è|r", travers: "è|r", divers: "è|r", super: "è|r",
  est: "è", et: "é", pays: "i", fils: "i|s", plus: "u", tous: "ou", femme: "a|m", femmes: "a|m",
  ville: "i|l", villes: "i|l", mille: "i|l", tranquille: "i|l", chef: "è|f", neuf: "eu|f", œuf: "eu|f",
  dix: "i|s", six: "i|s", sens: "an|s", gens: "an", temps: "an", printemps: "an", christ: "i|st",
  jésus: "u", album: "o|m", amen: "è|n", hymne: "i|mn", automne: "o|n", sept: "è|t", net: "è|t",
};

// Fins de mots → son. Le premier motif qui correspond l'emporte (les plus précis d'abord).
const TABLE: [RegExp, string][] = [
  [/(eilles?|eils?)$/, "èy"],
  [/(ouilles?|ouils?)$/, "ouy"],
  [/(euilles?|euils?|œils?|ueils?|ueilles?)$/, "euy"],
  [/(ailles?|ails?)$/, "ay"],
  [/illes?$/, "iy"],
  [/erts?$/, "è|r"],
  [/(eaux|eau|aux|auds?|ault|auts?|au|ôts?|ots?|os|o|ô)$/, "o"],
  [/(oies?|oient|oix|oigts?|oids|ois|oit|oi)$/, "wa"],
  [/(aient|aies?|ais|ait|ai|ès|êts?|ets?|è|ê|ey)$/, "è"],
  [/(ées?|és|é|ers|er|ez|ed)$/, "é"],
  [/[vt]ients?$/, "in"],
  [/(iens?|éens?)$/, "in"],
  [/(aims?|ains?|aints?|eints?|eins?|ints?|ins?|ims?|yms?|uns?|unts?|ums?)$/, "in"],
  [/(amps?|ants?|ands?|angs?|ans?|ents?|ends?|emps|ems?|ens?|aon|aen)$/, "an"],
  [/(onds?|onts?|ons?|oms?|ombs?|ongs?)$/, "on"],
  [/(oux|ous|oûts?|outs?|oups?|ou|oues?|ouds?)$/, "ou"],
  [/(œufs|eux|eut|eues?|eu|œux|œu|oeux?|œuds?|oeuds?)$/, "eu"],
  [/(ies?|is|its?|ix|ids?|i|î|îts?|ys?)$/, "i"],
  [/((?<![qg])ues?|us|uts?|u|ûs?|ûts?)$/, "u"],
  [/(as|ats?|a|à|ât|âts?)$/, "a"],
];

function normVowel(raw: string, closed: boolean): string {
  // Semi-voyelles : ciel, lumière, nuage → on garde la voyelle pleine.
  let v = raw.replace(/^[iu](?=[aàâeéèêëoôœ])/, "").replace(/^o(?=[èë])/, "");
  if (/^(eau|au|ô|o|ö)$/.test(v)) return "o";
  if (/^(ou|oû|où)$/.test(v)) return "ou";
  if (/^(oi|oî)$/.test(v)) return "wa";
  if (/^(eu|œu|œ|eû|ue|oeu)$/.test(v)) return "eu";
  if (/^(ai|ei|è|ê|ë|aî)$/.test(v)) return "è";
  if (v === "é") return "é";
  if (v === "e") return closed ? "è" : "e";
  if (/^[aàâä]$/.test(v)) return "a";
  if (/^[iîïy]$/.test(v)) return "i";
  if (/^[uûùü]$/.test(v)) return "u";
  return v.replace(/[àâä]/g, "a").replace(/[êëè]/g, "è").replace(/[îï]/g, "i").replace(/[ôö]/g, "o").replace(/[ûùü]/g, "u");
}

function nasal(vowel: string): string {
  if (vowel === "a" || vowel === "è" || vowel === "e") return "an";
  if (vowel === "o") return "on";
  if (vowel === "wa") return "win";
  return "in";
}

function normCons(c: string, muteE: boolean, afterNasal = false): string {
  let s = c;
  if (muteE && s === "s" && !afterNasal) return "z"; // rose, chose (mais danse, pense)
  s = s.replace(/(.)\1/g, "$1").replace(/ph/g, "f").replace(/th/g, "t").replace(/ch/g, "sh").replace(/gn/g, "ny");
  s = s.replace(/qu$/, "k").replace(/gu$/, "g").replace(/ck|q/g, "k");
  if (muteE) s = s.replace(/c$/, "s").replace(/g$/, "j");
  return s;
}

function generic(word: string): string {
  let s = word.replace(/es$/, "e");
  const muteE = s.length > 2 && s.endsWith("e") && !VOWEL_RE.test(s[s.length - 2]);
  if (muteE) s = s.slice(0, -1);
  else s = s.replace(/[sx]$/, "");
  const m = s.match(new RegExp(`([${V}]+)([^${V}]*)$`));
  if (!m) return s.slice(-3);
  let cons = m[2];
  if (!muteE) {
    // En fin de mot, seules certaines consonnes se prononcent (c, r, f, l… « CaReFuL »).
    cons = cons.replace(/[tdspxzg]+$/, "");
  }
  const isNasal = /^[nm][^nm]/.test(cons) || (!muteE && /^[nm]$/.test(cons));
  const vowel = normVowel(m[1], muteE || cons.length > 0);
  if (isNasal) {
    const rest = normCons(cons.slice(1), muteE, true);
    return rest ? `${nasal(vowel)}|${rest}` : nasal(vowel);
  }
  const consKey = normCons(cons, muteE);
  return consKey ? `${vowel}|${consKey}` : vowel;
}

/** Dernier mot chantable d'un vers (sans ponctuation, balises ni « (bis) »). */
export function lastWord(line: string): string | null {
  const cleaned = line
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .toLowerCase()
    .normalize("NFC");
  const tokens = cleaned.split(/[\s\-–—]+/).map((t) => t.replace(new RegExp(`[^${V}a-zçÿ'’]`, "g"), ""));
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i].replace(/^[a-zç]*['’]/, "");
    if (t && VOWEL_RE.test(t)) return t;
  }
  return null;
}

/** Clé de rime d'un mot : deux mots qui riment ont la même clé. */
export function rhymeKey(word: string): string | null {
  const w = word.toLowerCase().normalize("NFC").replace(/[^a-zàâäçéèêëîïôöùûüÿœæ]/g, "");
  if (!w || !VOWEL_RE.test(w)) return null;
  if (EXCEPTIONS[w]) return EXCEPTIONS[w];
  for (const [re, key] of TABLE) if (re.test(w)) return key;
  return generic(w);
}

export function rhymes(a: string, b: string): boolean {
  const ka = rhymeKey(a);
  return !!ka && ka === rhymeKey(b);
}

/** Nombre approximatif de syllabes chantées (le « e » muet compte devant une consonne). */
export function countSyllables(line: string): number {
  const words = line
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .toLowerCase()
    .match(new RegExp(`[a-zç${V}'’]+`, "g"));
  if (!words) return 0;
  let n = 0;
  const groupsOf = (s: string) => s.match(new RegExp(`[${V}]+`, "g"))?.length ?? 0;
  words.forEach((w, i) => {
    // Élision : « l'amour » = 2, « qu'il » = 1, « jusqu'à » = 2.
    const apos = w.search(/['’]/);
    const prefix = apos >= 0 ? groupsOf(w.slice(0, apos).replace(/[qg]u/g, "q")) : 0;
    // Un « y » entre deux voyelles sépare deux syllabes : jo-yeux, pa-yer.
    const word = (apos >= 0 ? w.slice(apos + 1) : w).replace(new RegExp(`([${V}])y(?=[${V}])`, "g"), "$1i·");
    let groups = prefix + groupsOf(word);
    const next = words[i + 1];
    const elided = !next || VOWEL_RE.test(next[0]) || next[0] === "h";
    if (groups > 1 && new RegExp(`[^${V}]es?$`).test(word) && elided) groups -= 1;
    n += groups;
  });
  return n;
}

export interface LineAnalysis {
  text: string;
  kind: "tag" | "blank" | "lyric";
  key: string | null;
  /** Lettre du schéma de rimes dans la strophe (A, B, C…). */
  letter: string | null;
  /** Index de couleur si la rime est partagée par au moins deux vers de la strophe. */
  color: number | null;
  syllables: number;
}

/** Analyse vers par vers : schéma de rimes (remis à zéro à chaque strophe) et syllabes. */
export function analyzeLyrics(lyrics: string): LineAnalysis[] {
  const lines = lyrics.split("\n");
  const out: LineAnalysis[] = lines.map((text) => {
    if (!text.trim()) return { text, kind: "blank", key: null, letter: null, color: null, syllables: 0 };
    if (TAG_LINE.test(text)) return { text, kind: "tag", key: null, letter: null, color: null, syllables: 0 };
    const word = lastWord(text);
    return { text, kind: "lyric", key: word ? rhymeKey(word) : null, letter: null, color: null, syllables: countSyllables(text) };
  });

  let stanza: LineAnalysis[] = [];
  const flush = () => {
    const counts = new Map<string, number>();
    for (const l of stanza) if (l.key) counts.set(l.key, (counts.get(l.key) ?? 0) + 1);
    const letters = new Map<string, number>();
    for (const l of stanza) {
      if (!l.key) continue;
      if (!letters.has(l.key)) letters.set(l.key, letters.size);
      const idx = letters.get(l.key)!;
      l.letter = String.fromCharCode(65 + (idx % 26));
      l.color = (counts.get(l.key) ?? 0) >= 2 ? idx : null;
    }
    stanza = [];
  };
  for (const l of out) {
    if (l.kind === "lyric") stanza.push(l);
    else flush();
  }
  flush();
  return out;
}
