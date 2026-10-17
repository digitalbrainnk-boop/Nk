"use client";

// Mode 2 « Parolier & Compositeur IA » : formulaire guidé pas à pas, puis
// prévisualisation et édition libre des paroles avant la création musicale.
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Loader, RefreshCw, Wand2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { LIMITS, OCCASIONS, VOICES } from "@/lib/constants";
import { briefSchema, fieldErrors } from "@/lib/schemas";
import type { Emotion, GeneratedLyrics, MusicStyleId, Occasion, SongLanguage, VoiceType } from "@/lib/types";
import { EmotionSlider } from "./EmotionSlider";
import { LyricsStudio } from "./LyricsStudio";

export interface BriefDraft {
  recipientName: string;
  nicknames: string;
  senderName: string;
  occasion: Occasion | null;
  anecdotes: string;
}

interface Props {
  brief: BriefDraft;
  onBrief: (b: BriefDraft) => void;
  emotion: Emotion;
  onEmotion: (e: Emotion) => void;
  voice: VoiceType | null;
  onVoice: (v: VoiceType) => void;
  styles: MusicStyleId[];
  title: string;
  onTitle: (v: string) => void;
  lyrics: string;
  onLyrics: (v: string) => void;
  language: SongLanguage;
  onLanguage: (v: SongLanguage) => void;
  errors?: Record<string, string>;
}

const STEPS = ["Pour qui ?", "L'occasion", "Vos souvenirs", "L'émotion", "Vos paroles"];

export function AiLyricistForm(p: Props) {
  const [step, setStep] = useState(p.lyrics.trim() ? 4 : 0);
  const [dir, setDir] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const b = p.brief;
  const set = (patch: Partial<BriefDraft>) => p.onBrief({ ...b, ...patch });
  const occasion = OCCASIONS.find((o) => o.id === b.occasion);

  const validate = (s: number): boolean => {
    const parsed = briefSchema.safeParse({ ...b, occasion: b.occasion ?? undefined, emotion: p.emotion });
    const all = parsed.success ? {} : fieldErrors(parsed.error);
    const keys = [["recipientName", "nicknames", "senderName"], ["occasion"], ["anecdotes"], [], []][s];
    const errs = Object.fromEntries(Object.entries(all).filter(([k]) => keys.includes(k)));
    if (keys.includes("occasion") && !b.occasion) errs.occasion = "Choisissez une occasion.";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const go = (to: number) => {
    if (to > step && !validate(step)) return;
    setDir(to > step ? 1 : -1);
    setStep(to);
  };

  const generate = async () => {
    const failing = [0, 1, 2].find((s) => !validate(s));
    if (failing !== undefined) {
      setStep(failing);
      return;
    }
    setGenerating(true);
    setNotice(null);
    try {
      const res = await api<GeneratedLyrics & { warning?: string }>("/api/generate-lyrics", {
        body: {
          brief: {
            recipientName: b.recipientName,
            nicknames: b.nicknames || undefined,
            senderName: b.senderName || undefined,
            occasion: b.occasion,
            anecdotes: b.anecdotes,
            emotion: p.emotion,
          },
          voice: p.voice ?? "female",
          styles: p.styles,
          language: p.language,
          previousTitle: p.lyrics.trim() ? p.title : undefined,
        },
      });
      p.onTitle(res.title);
      p.onLyrics(res.lyrics);
      setNotice(res.warning ?? null);
      setDir(1);
      setStep(4);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const addPrompt = (prompt: string) => {
    const line = `${prompt} : `;
    set({ anecdotes: b.anecdotes.trim() ? `${b.anecdotes.trimEnd()}\n${line}` : line });
  };

  return (
    <div>
      <ol className="mb-6 flex items-center gap-1.5" aria-label="Étapes du parolier">
        {STEPS.map((label, i) => (
          <li key={label} className="flex-1">
            <button
              type="button"
              onClick={() => (i < step || (i === 4 && p.lyrics.trim()) ? go(i) : undefined)}
              className="group block w-full text-left"
              aria-current={i === step ? "step" : undefined}
            >
              <span className={`block h-1.5 rounded-full transition ${i <= step ? "bg-gold" : "bg-line"}`} />
              <span className={`mt-1.5 hidden text-xs sm:block ${i === step ? "text-gold-soft" : "text-muted"}`}>{label}</span>
            </button>
          </li>
        ))}
      </ol>

      <AnimatePresence mode="wait" custom={dir}>
        <motion.div
          key={step}
          custom={dir}
          initial={{ opacity: 0, x: dir * 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: dir * -24 }}
          transition={{ duration: 0.22 }}
        >
          {step === 0 && (
            <div className="space-y-4">
              <h3 className="font-display text-xl font-semibold">Pour qui est cette chanson ?</h3>
              <div>
                <label htmlFor="recipient" className="label">
                  Prénom de la personne *
                </label>
                <input id="recipient" className="field" value={b.recipientName} maxLength={60} onChange={(e) => set({ recipientName: e.target.value })} placeholder="Ex. Aïcha" autoComplete="off" />
                {errors.recipientName && <p className="error-text">{errors.recipientName}</p>}
              </div>
              <div>
                <label htmlFor="nicknames" className="label">
                  Surnoms affectueux
                </label>
                <input id="nicknames" className="field" value={b.nicknames} maxLength={120} onChange={(e) => set({ nicknames: e.target.value })} placeholder="Ex. Ma Choco, Bébé d'amour" />
              </div>
              <div>
                <label htmlFor="sender" className="label">
                  De la part de
                </label>
                <input id="sender" className="field" value={b.senderName} maxLength={60} onChange={(e) => set({ senderName: e.target.value })} placeholder="Ex. Ton mari Moussa" />
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <h3 className="mb-4 font-display text-xl font-semibold">Quelle est l&apos;occasion ?</h3>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {OCCASIONS.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => set({ occasion: o.id })}
                    aria-pressed={b.occasion === o.id}
                    className={`rounded-2xl border p-4 text-left transition ${b.occasion === o.id ? "border-gold bg-gold/12" : "border-line bg-studio-2/60 hover:border-gold/40"}`}
                  >
                    <span className="text-2xl">{o.emoji}</span>
                    <span className="mt-1 block font-semibold">{o.label}</span>
                  </button>
                ))}
              </div>
              {errors.occasion && <p className="error-text">{errors.occasion}</p>}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <h3 className="font-display text-xl font-semibold">Racontez-nous vos souvenirs</h3>
              <p className="text-sm text-muted">Anecdotes, phrases fétiches, lieux, moments drôles ou émouvants : plus c&apos;est précis, plus la chanson touche.</p>
              <div className="flex flex-wrap gap-2">
                {(occasion?.prompts ?? []).map((pr) => (
                  <button key={pr} type="button" className="chip hover:border-gold/50" onClick={() => addPrompt(pr)}>
                    + {pr}
                  </button>
                ))}
              </div>
              <textarea
                className="field min-h-48 leading-relaxed"
                value={b.anecdotes}
                maxLength={LIMITS.anecdotesMax}
                onChange={(e) => set({ anecdotes: e.target.value })}
                placeholder="Ex. On s'est rencontrés au maquis de Cocody en 2015. Elle rit toujours quand je chante faux. Son plat préféré : l'attiéké poisson…"
              />
              <div className="flex justify-between text-xs text-muted">
                {errors.anecdotes ? <p className="error-text mt-0">{errors.anecdotes}</p> : <span />}
                <span>
                  {b.anecdotes.length}/{LIMITS.anecdotesMax}
                </span>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <h3 className="font-display text-xl font-semibold">Quelle émotion, et qui chante ?</h3>
              <EmotionSlider value={p.emotion} onChange={p.onEmotion} />
              <div className="flex flex-wrap gap-2">
                {VOICES.map((v) => (
                  <button key={v.id} type="button" onClick={() => p.onVoice(v.id)} className={`chip min-h-11 px-4 ${p.voice === v.id ? "chip-on" : ""}`}>
                    {v.emoji} {v.label}
                  </button>
                ))}
              </div>
              <button type="button" onClick={generate} disabled={generating} className="btn btn-gold w-full sm:w-auto">
                {generating ? <Loader className="size-5 animate-spin" /> : <Wand2 className="size-5" />}
                {generating ? "Le parolier écrit vos couplets…" : "Écrire mes paroles"}
              </button>
              {notice && <p className="text-sm text-danger">{notice}</p>}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-xl font-semibold">Vos paroles, à retoucher librement</h3>
                <button type="button" onClick={generate} disabled={generating} className="btn btn-ghost min-h-10 py-2 text-sm">
                  {generating ? <Loader className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  Autre proposition
                </button>
              </div>
              {notice && <p className="rounded-2xl border border-gold/30 bg-gold/5 p-3 text-sm text-gold-soft">{notice}</p>}
              <LyricsStudio
                title={p.title}
                onTitleChange={p.onTitle}
                lyrics={p.lyrics}
                onLyricsChange={p.onLyrics}
                language={p.language}
                onLanguageChange={p.onLanguage}
                errors={p.errors}
              />
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {step < 3 && (
        <div className="mt-6 flex justify-between">
          <button type="button" onClick={() => go(step - 1)} disabled={step === 0} className="btn btn-quiet">
            <ArrowLeft className="size-4" /> Retour
          </button>
          <button type="button" onClick={() => go(step + 1)} className="btn btn-ghost">
            Continuer <ArrowRight className="size-4" />
          </button>
        </div>
      )}
      {step === 3 && (
        <button type="button" onClick={() => go(2)} className="btn btn-quiet mt-4">
          <ArrowLeft className="size-4" /> Retour
        </button>
      )}
    </div>
  );
}
