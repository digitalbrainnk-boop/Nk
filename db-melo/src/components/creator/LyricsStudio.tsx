"use client";

// Mode 1 « Studio Paroles » : éditeur avec balises cliquables et détection des rimes.
// Le textarea (transparent) est superposé à un calque qui colore balises et rimes ;
// l'affichage simple désactive le calque si besoin.
import { Eye, EyeOff, LayoutTemplate, Sparkles } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { LANGUAGES, LIMITS, SECTION_TAGS } from "@/lib/constants";
import { analyzeLyrics, type LineAnalysis } from "@/lib/lyrics/rhymes";
import type { SongLanguage } from "@/lib/types";

export const RHYME_COLORS = ["#E5A93C", "#9B8CFF", "#4FD1C5", "#FF6B8B", "#8BD450", "#5AA9FF", "#FF9F43", "#E879F9"];

const STARTER = "[Couplet 1]\n\n\n[Refrain]\n\n\n[Couplet 2]\n\n\n[Refrain]\n\n\n[Pont]\n\n\n[Refrain]\n\n\n[Outro]\n";

interface Props {
  title: string;
  onTitleChange: (v: string) => void;
  lyrics: string;
  onLyricsChange: (v: string) => void;
  language: SongLanguage;
  onLanguageChange: (v: SongLanguage) => void;
  errors?: Record<string, string>;
  hint?: React.ReactNode;
}

function Line({ line }: { line: LineAnalysis }) {
  if (line.kind === "blank") return <div>{"​"}</div>;
  if (line.kind === "tag") {
    return (
      <div>
        <span className="rounded-md bg-gold/12 text-gold-soft">{line.text}</span>
      </div>
    );
  }
  const m = line.text.match(/^(.*?)([\p{L}'’-]+)([^\p{L}]*)$/u);
  const color = line.color !== null ? RHYME_COLORS[line.color % RHYME_COLORS.length] : undefined;
  return (
    <div className="relative">
      {m ? (
        <>
          {m[1]}
          <span style={color ? { color, textDecoration: "underline", textDecorationThickness: 2, textUnderlineOffset: 5 } : undefined}>{m[2]}</span>
          {m[3]}
        </>
      ) : (
        line.text
      )}
      <span className="absolute top-0 -right-[74px] flex w-16 items-center justify-end gap-1.5 text-xs leading-[1.75rem] select-none">
        {line.letter && (
          <span
            className="inline-flex size-5 items-center justify-center rounded-md text-[11px] font-bold"
            style={{ background: color ? `${color}26` : "#2A2A3C", color: color ?? "#A09EB0" }}
          >
            {line.letter}
          </span>
        )}
        <span className="w-6 text-right text-muted/70 tabular-nums">{line.syllables || ""}</span>
      </span>
    </div>
  );
}

export function LyricsStudio({ title, onTitleChange, lyrics, onLyricsChange, language, onLanguageChange, errors = {}, hint }: Props) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [plain, setPlain] = useState(false);
  const analysis = useMemo(() => analyzeLyrics(lyrics), [lyrics]);

  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 320)}px`;
  }, [lyrics, plain]);

  const stats = useMemo(() => {
    const sung = analysis.filter((l) => l.kind === "lyric");
    const rhymed = sung.filter((l) => l.color !== null).length;
    const avg = sung.length ? Math.round(sung.reduce((n, l) => n + l.syllables, 0) / sung.length) : 0;
    return { lines: sung.length, rhymed, avg, sections: analysis.filter((l) => l.kind === "tag").length };
  }, [analysis]);

  const insertTag = (label: string, numbered?: boolean) => {
    const el = ta.current;
    const count = (lyrics.match(new RegExp(`^\\[${label}`, "gmi")) ?? []).length;
    const tag = numbered ? `${label} ${count + 1}` : label;
    const start = el?.selectionStart ?? lyrics.length;
    const end = el?.selectionEnd ?? start;
    const before = lyrics.slice(0, start);
    const after = lyrics.slice(end);
    const sep = !before.trim() ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const insert = `${sep}[${tag}]\n`;
    onLyricsChange(before + insert + after);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = before.length + insert.length;
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
        <div>
          <label htmlFor="song-title" className="label">
            Titre de la chanson
          </label>
          <input
            id="song-title"
            className="field"
            value={title}
            maxLength={LIMITS.titleMax}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Ex. « Maman Awa, ma reine »"
            aria-invalid={!!errors.title}
          />
          {errors.title && <p className="error-text">{errors.title}</p>}
        </div>
        <div>
          <label htmlFor="song-language" className="label">
            Langue
          </label>
          <select id="song-language" className="field" value={language} onChange={(e) => onLanguageChange(e.target.value as SongLanguage)}>
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-end justify-between gap-2">
          <span className="label mb-0">Paroles</span>
          <div className="flex items-center gap-1">
            {!lyrics.trim() && (
              <button type="button" className="btn-quiet inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs" onClick={() => onLyricsChange(STARTER)}>
                <LayoutTemplate className="size-3.5" /> Structure type
              </button>
            )}
            <button
              type="button"
              className="btn-quiet inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs"
              onClick={() => setPlain((p) => !p)}
              aria-pressed={plain}
            >
              {plain ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
              {plain ? "Afficher les rimes" : "Affichage simple"}
            </button>
          </div>
        </div>

        <div className="no-scrollbar -mx-1 mb-2 flex gap-2 overflow-x-auto px-1 pb-1" role="toolbar" aria-label="Balises musicales">
          {SECTION_TAGS.map((t) => (
            <button key={t.label} type="button" onClick={() => insertTag(t.label, t.numbered)} className="chip shrink-0 hover:border-gold/60 hover:text-gold-soft">
              [{t.label}]
            </button>
          ))}
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-line bg-ink/60 focus-within:border-gold/60 focus-within:ring-2 focus-within:ring-gold/15">
          {!plain && (
            <div aria-hidden="true" className="lyrics-layer pointer-events-none absolute inset-0 text-cream">
              {analysis.map((line, i) => (
                <Line key={i} line={line} />
              ))}
            </div>
          )}
          <textarea
            ref={ta}
            value={lyrics}
            onChange={(e) => onLyricsChange(e.target.value)}
            maxLength={LIMITS.lyricsMax}
            spellCheck
            autoCapitalize="sentences"
            aria-label="Paroles de la chanson"
            aria-invalid={!!errors.lyrics}
            placeholder={"[Couplet 1]\nÉcrivez vos vers ici, un par ligne…\n\n[Refrain]\nLe refrain que tout le monde chantera"}
            className={`lyrics-layer relative block w-full caret-gold placeholder:text-muted/50 ${plain ? "text-cream" : "text-transparent"}`}
          />
        </div>
        {errors.lyrics && <p className="error-text">{errors.lyrics}</p>}

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span>{stats.sections} sections</span>
          <span>{stats.lines} vers</span>
          <span>
            <Sparkles className="mr-1 inline size-3 text-gold" />
            {stats.rhymed} vers rimés
          </span>
          <span>~{stats.avg} syllabes / vers</span>
          <span className="ml-auto tabular-nums">
            {lyrics.length} / {LIMITS.lyricsMax}
          </span>
        </div>
        {hint && <div className="mt-3 text-xs text-muted">{hint}</div>}
      </div>
    </div>
  );
}
