"use client";

// Style Match : dépôt d'un MP3/WAV de référence. Le tempo et l'énergie sont mesurés dans le
// navigateur et guident l'arrangement ; le mode « base » (cover) exige d'en détenir les droits.
import { AudioWaveform, Loader, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { analyzeReference } from "@/lib/client/audio-analysis";
import { uploadFile } from "@/lib/client/upload";
import { LIMITS } from "@/lib/constants";
import type { ReferenceAudio } from "@/lib/types";

const ENERGY = { low: "énergie douce", medium: "énergie modérée", high: "énergie élevée" } as const;

export function ReferenceDropzone({
  value,
  onChange,
  error,
}: {
  value: ReferenceAudio | null | undefined;
  onChange: (v: ReferenceAudio | null) => void;
  error?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);

  const handle = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    if (!/\.(mp3|wav)$/i.test(file.name) && !/^audio\/(mpeg|mp3|wav|x-wav|wave)$/.test(file.type)) {
      setProblem("Déposez un fichier MP3 ou WAV.");
      return;
    }
    if (file.size > LIMITS.referenceMaxBytes) {
      setProblem("Fichier trop lourd (20 Mo maximum).");
      return;
    }
    try {
      setBusy("Analyse du groove et envoi…");
      const [analysis, uploaded] = await Promise.all([analyzeReference(file).catch(() => undefined), uploadFile(file, "reference", setProgress)]);
      onChange({ uploadId: uploaded.id, fileName: file.name, analysis, useAsCover: false, rightsConfirmed: false });
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(null);
      setProgress(0);
    }
  };

  if (value) {
    const a = value.analysis;
    return (
      <div className="card space-y-3 p-4">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-gold/15 text-gold">
            <AudioWaveform className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{value.fileName}</p>
            <p className="text-sm text-muted">
              {a?.bpm ? `≈ ${a.bpm} BPM · ` : ""}
              {a ? ENERGY[a.energy] : "Analyse indisponible"}
            </p>
          </div>
          <button type="button" onClick={() => onChange(null)} className="btn-quiet p-2" aria-label="Retirer le morceau de référence">
            <Trash2 className="size-5" />
          </button>
        </div>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-[#E5A93C]"
            checked={value.useAsCover}
            onChange={(e) => onChange({ ...value, useAsCover: e.target.checked, rightsConfirmed: e.target.checked && value.rightsConfirmed })}
          />
          <span>
            Utiliser ce morceau comme base (même structure et même groove)
            <span className="block text-xs text-muted">Sinon, seuls le tempo et l&apos;énergie guident l&apos;arrangement.</span>
          </span>
        </label>
        {value.useAsCover && (
          <label className="flex items-start gap-3 rounded-2xl border border-gold/30 bg-gold/5 p-3 text-sm">
            <input
              type="checkbox"
              className="mt-1 size-4 accent-[#E5A93C]"
              checked={value.rightsConfirmed}
              onChange={(e) => onChange({ ...value, rightsConfirmed: e.target.checked })}
            />
            <span>Je confirme détenir les droits de ce morceau (composition personnelle ou licence).</span>
          </label>
        )}
        {error && <p className="error-text">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void handle(e.dataTransfer.files[0]);
        }}
        disabled={!!busy}
        className={`flex w-full flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed p-6 text-center transition ${drag ? "border-gold bg-gold/10" : "border-line hover:border-gold/50"}`}
      >
        {busy ? <Loader className="size-6 animate-spin text-gold" /> : <Upload className="size-6 text-gold" />}
        <span className="font-semibold">{busy ?? "Déposer un morceau de référence (MP3 / WAV)"}</span>
        <span className="text-sm text-muted">{busy ? `${Math.round(progress * 100)} %` : "Pour reprendre son groove et son tempo — facultatif"}</span>
      </button>
      <input ref={input} type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" className="hidden" onChange={(e) => void handle(e.target.files?.[0])} />
      {problem && <p className="error-text">{problem}</p>}
    </div>
  );
}
