// Balises de structure : conversion vers Suno, découpage en vers et calage karaoké.
import type { AlignedWord, InstrumentId, VoiceType } from "../types";
import { countSyllables } from "./rhymes";

export const TAG_LINE = /^\s*\[([^\]]+)\]\s*$/;

const strip = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();

const BASES: [RegExp, string][] = [
  [/^(couplet|verse|strophe)$/, "Verse"],
  [/^(pre-?refrain|pre-?chorus)$/, "Pre-Chorus"],
  [/^(refrain|chorus|choeur)$/, "Chorus"],
  [/^(pont|bridge)$/, "Bridge"],
  [/^(solo instrumental|solo|instrumental|instrumental solo)$/, "Instrumental Solo"],
  [/^(intro|introduction)$/, "Intro"],
  [/^(outro|final|fin|coda)$/, "Outro"],
  [/^(interlude|break)$/, "Interlude"],
  [/^(parle|spoken|parlé)$/, "Spoken Word"],
];

const PARTS: [RegExp, string][] = [
  [/^(lui|homme|h|male|voix masculine)$/, "Male Vocal"],
  [/^(elle|femme|f|female|voix feminine)$/, "Female Vocal"],
  [/^(ensemble|duo|tous|les deux|duet)$/, "Duet"],
  [/^(enfant|child)$/, "Child Vocal"],
];

const SOLO_BY_INSTRUMENT: Partial<Record<InstrumentId, string>> = {
  saxophone: "Saxophone Solo",
  acoustic_guitar: "Acoustic Guitar Solo",
  kora: "Kora Solo",
  balafon_percussion: "Balafon Solo",
  intimate_piano: "Piano Solo",
  brass: "Trumpet Solo",
};

export interface ParsedTag {
  base: string | null;
  number?: string;
  part?: string | null;
  raw: string;
}

/** « Couplet 2 - Lui » → { base: "Verse", number: "2", part: "Male Vocal" } */
export function parseTag(content: string): ParsedTag {
  const [head, ...rest] = content.split(/\s*[-:–|]\s*/);
  const m = strip(head).match(/^(.*?)(?:\s+(\d+))?$/);
  const baseKey = m?.[1] ?? strip(head);
  const base = BASES.find(([re]) => re.test(baseKey))?.[1] ?? null;
  const partKey = rest.length ? strip(rest.join(" ")) : "";
  const part = partKey ? PARTS.find(([re]) => re.test(partKey))?.[1] ?? null : undefined;
  return { base, number: m?.[2], part, raw: content.trim() };
}

/**
 * Convertit les balises françaises en balises Suno :
 * [Couplet 1] → [Verse 1], [Refrain] → [Chorus], [Solo Instrumental] → [Saxophone Solo]…
 * En duo, attribue automatiquement les couplets (homme / femme) si l'utilisateur ne l'a pas fait.
 */
export function toSunoLyrics(lyrics: string, opts: { voice: VoiceType; instruments: InstrumentId[] }): string {
  const lines = lyrics.replace(/\r\n?/g, "\n").split("\n");
  const hasParts = lines.some((l) => {
    const t = l.match(TAG_LINE);
    return t && parseTag(t[1]).part;
  });
  const solo = opts.instruments.map((i) => SOLO_BY_INSTRUMENT[i]).find(Boolean) ?? "Instrumental Solo";
  let verseCount = 0;

  const out = lines.map((line) => {
    const t = line.match(TAG_LINE);
    if (!t) return line.trimEnd();
    const tag = parseTag(t[1]);
    if (!tag.base) return `[${tag.raw}]`;
    let name = tag.base === "Instrumental Solo" ? solo : tag.base;
    if (tag.base === "Verse") verseCount += 1;
    if (tag.number) name += ` ${tag.number}`;
    let part = tag.part ?? null;
    if (!part && !hasParts && opts.voice === "duo") {
      if (tag.base === "Verse") part = (tag.number ? Number(tag.number) : verseCount) % 2 === 1 ? "Male Vocal" : "Female Vocal";
      else if (tag.base === "Chorus" || tag.base === "Bridge" || tag.base === "Outro") part = "Duet";
    }
    return part ? `[${name}: ${part}]` : `[${name}]`;
  });

  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface SungLine {
  text: string;
  section: string | null;
}

/** Vers chantés (sans balises ni lignes vides), avec leur section. */
export function sungLines(lyrics: string): SungLine[] {
  let section: string | null = null;
  const out: SungLine[] = [];
  for (const raw of lyrics.split("\n")) {
    const t = raw.match(TAG_LINE);
    if (t) {
      section = t[1].trim();
      continue;
    }
    if (raw.trim()) out.push({ text: raw.trim(), section });
  }
  return out;
}

export interface TimedLine {
  text: string;
  section: string | null;
  startS: number;
  endS: number;
  words?: AlignedWord[];
}

/**
 * Sans horodatage Suno : on répartit les vers sur la durée selon leur nombre de syllabes,
 * en laissant une intro et des respirations entre sections.
 */
export function estimateTimings(lyrics: string, duration: number): TimedLine[] {
  const lines = sungLines(lyrics);
  if (!lines.length || !duration) return [];
  const intro = Math.min(12, duration * 0.08);
  const end = duration * 0.94;
  const weights: number[] = [];
  let prev: string | null | undefined;
  for (const l of lines) {
    const gap = prev !== undefined && l.section !== prev ? (/solo|instrumental/i.test(l.section ?? "") ? 16 : 5) : 0;
    weights.push(gap + Math.max(4, countSyllables(l.text)));
    prev = l.section;
  }
  const total = weights.reduce((a, b) => a + b, 0);
  const unit = (end - intro) / total;
  let t = intro;
  return lines.map((l, i) => {
    const w = weights[i];
    const sing = Math.max(4, countSyllables(l.text)) * unit;
    const startS = t + (w * unit - sing);
    t += w * unit;
    return { ...l, startS, endS: t };
  });
}

/** Regroupe les mots horodatés renvoyés par Suno en vers (les retours à la ligne sont dans les mots). */
export function alignedToLines(words: AlignedWord[]): TimedLine[] {
  const lines: TimedLine[] = [];
  let current: AlignedWord[] = [];
  let section: string | null = null;
  const push = () => {
    if (current.length) {
      lines.push({
        text: current.map((w) => w.word).join(" "),
        section,
        startS: current[0].startS,
        endS: current[current.length - 1].endS,
        words: current,
      });
    }
    current = [];
  };
  for (const w of words) {
    const parts = w.word.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) push();
      const tag = part.match(/\[([^\]]+)\]/);
      if (tag) section = tag[1];
      const text = part.replace(/\[[^\]]*\]/g, "").trim();
      if (text) current.push({ word: text, startS: w.startS, endS: w.endS });
    });
  }
  push();
  return lines;
}
