"use client";

// Formulaire principal : 4 onglets (Paroles · Voix · Style · Finaliser), validation zod par étape,
// brouillon sauvegardé sur l'appareil, puis enregistrement et lancement de la création.
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Loader, Music2, PenLine, RotateCcw, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { rememberSong } from "@/lib/client/local-songs";
import { EMOTIONS, INSTRUMENTS, STYLES, VOICES, label } from "@/lib/constants";
import { briefSchema, fieldErrors, finalStepSchema, lyricsStepSchema, styleStepSchema, voiceStepSchema } from "@/lib/schemas";
import type { CreationMode, Emotion, InstrumentId, MusicStyleId, PublicSong, ReferenceAudio, SongConfig, SongLanguage, VoiceType } from "@/lib/types";
import { AiLyricistForm, type BriefDraft } from "./AiLyricistForm";
import { EmotionSlider } from "./EmotionSlider";
import { LyricsStudio } from "./LyricsStudio";
import { PhotoPicker } from "./PhotoPicker";
import { StyleSelector } from "./StyleSelector";
import { VoiceSelector } from "./VoiceSelector";

interface Draft {
  mode: CreationMode | null;
  title: string;
  lyrics: string;
  language: SongLanguage;
  brief: BriefDraft;
  voice: VoiceType | null;
  emotion: Emotion;
  styles: MusicStyleId[];
  customInspiration: string;
  instruments: InstrumentId[];
  referenceAudio: ReferenceAudio | null;
  recipientName: string;
  dedication: string;
  photoUploadId: string | null;
  acceptTerms: boolean;
}

const EMPTY: Draft = {
  mode: null,
  title: "",
  lyrics: "",
  language: "fr",
  brief: { recipientName: "", nicknames: "", senderName: "", occasion: null, anecdotes: "" },
  voice: null,
  emotion: "joyful",
  styles: [],
  customInspiration: "",
  instruments: [],
  referenceAudio: null,
  recipientName: "",
  dedication: "",
  photoUploadId: null,
  acceptTerms: false,
};

const TABS = [
  { id: "lyrics", label: "Paroles", icon: PenLine },
  { id: "voice", label: "Voix", icon: Sparkles },
  { id: "style", label: "Style", icon: Music2 },
  { id: "final", label: "Finaliser", icon: Check },
] as const;

const DRAFT_KEY = "dbmelo:draft";

function validateStep(step: number, d: Draft): Record<string, string> {
  const check = (r: { success: boolean; error?: import("zod").ZodError }) => (r.success ? {} : fieldErrors(r.error!));
  if (step === 0) {
    if (!d.mode) return { mode: "Choisissez comment écrire vos paroles." };
    const errs = check(lyricsStepSchema.safeParse(d));
    if (d.mode === "ai") {
      const brief = check(briefSchema.safeParse({ ...d.brief, occasion: d.brief.occasion ?? undefined, emotion: d.emotion }));
      if (Object.keys(brief).length) return { ...errs, brief: "Complétez le formulaire guidé du parolier." };
      if (errs.lyrics || errs.title) return { ...errs, brief: "Générez vos paroles, puis relisez-les avant de continuer." };
    }
    return errs;
  }
  if (step === 1) return d.voice ? check(voiceStepSchema.safeParse(d)) : { voice: "Choisissez une voix." };
  if (step === 2) return check(styleStepSchema.safeParse(d));
  const errs = check(finalStepSchema.safeParse(d));
  if (!d.acceptTerms) errs.acceptTerms = "Veuillez accepter les conditions pour continuer.";
  return errs;
}

function toConfig(d: Draft): SongConfig {
  return {
    mode: d.mode!,
    title: d.title.trim(),
    lyrics: d.lyrics.trim(),
    language: d.language,
    voice: d.voice!,
    emotion: d.emotion,
    styles: d.styles,
    customInspiration: d.customInspiration.trim() || undefined,
    instruments: d.instruments,
    referenceAudio: d.referenceAudio,
    recipientName: d.recipientName.trim() || d.brief.recipientName.trim() || undefined,
    dedication: d.dedication.trim() || undefined,
    photoUploadId: d.photoUploadId,
    brief:
      d.mode === "ai" && d.brief.occasion
        ? {
            recipientName: d.brief.recipientName.trim(),
            nicknames: d.brief.nicknames.trim() || undefined,
            senderName: d.brief.senderName.trim() || undefined,
            occasion: d.brief.occasion,
            anecdotes: d.brief.anecdotes.trim(),
            emotion: d.emotion,
          }
        : undefined,
  };
}

export function SongCreator() {
  const router = useRouter();
  const [d, setD] = useState<Draft>(EMPTY);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [restored, setRestored] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const loaded = useRef(false);
  const top = useRef<HTMLDivElement>(null);

  // Brouillon : restauré au chargement, sauvegardé à chaque modification.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const saved = { ...EMPTY, ...(JSON.parse(raw) as Partial<Draft>) };
        if (saved.mode || saved.lyrics) {
          setD(saved);
          setRestored(true);
        }
      }
    } catch {
      /* brouillon illisible ou stockage bloqué */
    }
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
      } catch {
        /* navigation privée */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [d]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setD((prev) => ({ ...prev, [key]: value }));
    if (errors[key as string]) setErrors(({ [key as string]: _, ...rest }) => rest);
  };

  const reset = () => {
    setD(EMPTY);
    setStep(0);
    setErrors({});
    setRestored(false);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* rien */
    }
  };

  const goTo = (target: number) => {
    // On peut revenir librement ; pour avancer, chaque étape précédente doit être valide.
    for (let s = 0; s < target; s++) {
      const errs = validateStep(s, d);
      if (Object.keys(errs).length) {
        setStep(s);
        setErrors(errs);
        top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
    setErrors({});
    setStep(target);
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const submit = async () => {
    const errs = validateStep(3, d);
    if (Object.keys(errs).length) return setErrors(errs);
    for (let s = 0; s < 3; s++) if (Object.keys(validateStep(s, d)).length) return goTo(s + 1);
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { song } = await api<{ song: PublicSong }>("/api/songs", { body: { config: toConfig(d) } });
      rememberSong({ id: song.id, title: song.config.title, recipient: song.config.recipientName, createdAt: song.createdAt });
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* rien */
      }
      router.push(`/chanson/${song.id}?start=1`);
    } catch (e) {
      setSubmitError((e as Error).message);
      setSubmitting(false);
    }
  };

  const summary = useMemo(
    () => [
      { label: "Paroles", value: d.mode === "ai" ? "Parolier IA" : "Studio Paroles", detail: d.title || "Sans titre", step: 0 },
      { label: "Voix", value: label(VOICES, d.voice ?? undefined), detail: label(EMOTIONS, d.emotion), step: 1 },
      {
        label: "Style",
        value: d.styles.map((s) => label(STYLES, s)).join(" · ") || "—",
        detail: [d.instruments.map((i) => label(INSTRUMENTS, i)).join(", "), d.referenceAudio ? `Référence : ${d.referenceAudio.fileName}` : ""]
          .filter(Boolean)
          .join(" — "),
        step: 2,
      },
    ],
    [d],
  );

  return (
    <div ref={top} className="scroll-mt-20">
      {restored && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-gold/30 bg-gold/5 px-4 py-2.5 text-sm">
          <span className="text-gold-soft">Brouillon restauré : reprenez là où vous en étiez.</span>
          <button type="button" onClick={reset} className="btn-quiet inline-flex items-center gap-1 text-xs">
            <RotateCcw className="size-3.5" /> Recommencer
          </button>
        </div>
      )}

      <div role="tablist" aria-label="Étapes de création" className="card mb-6 grid grid-cols-4 gap-1 p-1.5">
        {TABS.map((t, i) => {
          const Icon = t.icon;
          const active = i === step;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={active}
              aria-controls={`panel-${t.id}`}
              onClick={() => goTo(i)}
              className={`relative flex flex-col items-center gap-1 rounded-2xl px-1 py-2.5 text-xs font-semibold transition sm:flex-row sm:justify-center sm:gap-2 sm:text-sm ${active ? "text-ink" : "text-muted hover:text-cream"}`}
            >
              {active && <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-2xl bg-linear-to-b from-gold-soft to-gold" transition={{ type: "spring", bounce: 0.2, duration: 0.45 }} />}
              <Icon className="relative size-4" />
              <span className="relative">
                <span className="hidden sm:inline">{i + 1}. </span>
                {t.label}
              </span>
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.section
          key={step}
          id={`panel-${TABS[step].id}`}
          role="tabpanel"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.25 }}
          className="card p-5 sm:p-7"
        >
          {step === 0 && (
            <div className="space-y-6">
              <div>
                <h2 className="font-display text-2xl font-bold">Comment voulez-vous écrire ?</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Mode de création">
                  {(
                    [
                      { id: "studio", title: "Studio Paroles", text: "J'écris mes paroles. L'éditeur m'aide avec les rimes et la structure.", icon: PenLine },
                      { id: "ai", title: "Parolier & Compositeur IA", text: "Je raconte mes souvenirs, l'IA écrit une chanson sur mesure.", icon: Sparkles },
                    ] as const
                  ).map((m) => {
                    const Icon = m.icon;
                    const on = d.mode === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => set("mode", m.id)}
                        className={`rounded-3xl border p-5 text-left transition ${on ? "border-gold bg-gold/10 shadow-[0_0_0_1px_rgb(229_169_60/0.4)]" : "border-line bg-studio-2/60 hover:border-gold/40"}`}
                      >
                        <span className={`flex size-11 items-center justify-center rounded-2xl ${on ? "bg-gold text-ink" : "bg-ink/60 text-gold"}`}>
                          <Icon className="size-5" />
                        </span>
                        <span className="mt-3 block font-display text-lg font-semibold">{m.title}</span>
                        <span className="mt-1 block text-sm text-muted">{m.text}</span>
                      </button>
                    );
                  })}
                </div>
                {errors.mode && <p className="error-text">{errors.mode}</p>}
              </div>

              {d.mode === "studio" && (
                <LyricsStudio
                  title={d.title}
                  onTitleChange={(v) => set("title", v)}
                  lyrics={d.lyrics}
                  onLyricsChange={(v) => set("lyrics", v)}
                  language={d.language}
                  onLanguageChange={(v) => set("language", v)}
                  errors={errors}
                  hint="Astuce : un vers par ligne, des balises pour la structure. Les mots de fin colorés riment entre eux."
                />
              )}
              {d.mode === "ai" && (
                <>
                  {errors.brief && <p className="rounded-2xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{errors.brief}</p>}
                  <AiLyricistForm
                    brief={d.brief}
                    onBrief={(b) => set("brief", b)}
                    emotion={d.emotion}
                    onEmotion={(e) => set("emotion", e)}
                    voice={d.voice}
                    onVoice={(v) => set("voice", v)}
                    styles={d.styles}
                    title={d.title}
                    onTitle={(v) => set("title", v)}
                    lyrics={d.lyrics}
                    onLyrics={(v) => set("lyrics", v)}
                    language={d.language}
                    onLanguage={(v) => set("language", v)}
                    errors={errors}
                  />
                </>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <h2 className="font-display text-2xl font-bold">Qui chante ?</h2>
              <VoiceSelector value={d.voice} onChange={(v) => set("voice", v)} error={errors.voice} />
              <EmotionSlider value={d.emotion} onChange={(e) => set("emotion", e)} />
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <h2 className="font-display text-2xl font-bold">L&apos;univers musical</h2>
              <StyleSelector
                styles={d.styles}
                onStyles={(v) => set("styles", v)}
                inspiration={d.customInspiration}
                onInspiration={(v) => set("customInspiration", v)}
                instruments={d.instruments}
                onInstruments={(v) => set("instruments", v)}
                reference={d.referenceAudio}
                onReference={(v) => set("referenceAudio", v)}
                errors={errors}
              />
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <h2 className="font-display text-2xl font-bold">Dernière touche</h2>
              <ul className="divide-y divide-line rounded-2xl border border-line">
                {summary.map((s) => (
                  <li key={s.label} className="flex items-center gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted uppercase">{s.label}</p>
                      <p className="truncate font-semibold">{s.value}</p>
                      {s.detail && <p className="truncate text-sm text-muted">{s.detail}</p>}
                    </div>
                    <button type="button" className="btn-quiet text-sm font-semibold text-gold" onClick={() => goTo(s.step)}>
                      Modifier
                    </button>
                  </li>
                ))}
              </ul>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="final-recipient" className="label">
                    Prénom du destinataire (page cadeau)
                  </label>
                  <input
                    id="final-recipient"
                    className="field"
                    maxLength={60}
                    value={d.recipientName || d.brief.recipientName}
                    onChange={(e) => set("recipientName", e.target.value)}
                    placeholder="Ex. Aïcha"
                  />
                </div>
                <PhotoPicker value={d.photoUploadId} onChange={(id) => set("photoUploadId", id)} />
              </div>
              <div>
                <label htmlFor="dedication" className="label">
                  Mot doux affiché sur la page cadeau
                </label>
                <textarea
                  id="dedication"
                  className="field min-h-28"
                  maxLength={500}
                  value={d.dedication}
                  onChange={(e) => set("dedication", e.target.value)}
                  placeholder="Ex. Joyeux anniversaire mon cœur, cette chanson raconte notre histoire…"
                />
                {errors.dedication && <p className="error-text">{errors.dedication}</p>}
              </div>
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-0.5 size-5 accent-[#E5A93C]" checked={d.acceptTerms} onChange={(e) => set("acceptTerms", e.target.checked)} />
                <span>
                  J&apos;accepte que mes paroles soient mises en musique par l&apos;IA, et je confirme ne pas utiliser de contenu dont je n&apos;ai pas les droits.
                </span>
              </label>
              {errors.acceptTerms && <p className="error-text">{errors.acceptTerms}</p>}
              {submitError && <p className="rounded-2xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{submitError}</p>}
            </div>
          )}
        </motion.section>
      </AnimatePresence>

      <div className="safe-bottom sticky bottom-0 z-30 -mx-4 mt-6 flex items-center justify-between gap-3 border-t border-line/60 bg-ink/85 px-4 pt-3 backdrop-blur-xl sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <button type="button" onClick={() => goTo(step - 1)} disabled={step === 0} className="btn btn-quiet">
          <ArrowLeft className="size-4" /> Retour
        </button>
        {step < 3 ? (
          <button type="button" onClick={() => goTo(step + 1)} className="btn btn-gold flex-1 sm:flex-none">
            Continuer <ArrowRight className="size-4" />
          </button>
        ) : (
          <button type="button" onClick={submit} disabled={submitting} className="btn btn-gold flex-1 sm:flex-none">
            {submitting ? <Loader className="size-5 animate-spin" /> : <Sparkles className="size-5" />}
            Créer ma chanson
          </button>
        )}
      </div>
    </div>
  );
}
