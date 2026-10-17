"use client";

import { ImagePlus, Loader, X } from "lucide-react";
import { useRef, useState } from "react";
import { uploadFile } from "@/lib/client/upload";

/** Photo facultative pour la pochette personnalisée. */
export function PhotoPicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file?: File) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const up = await uploadFile(file, "photo");
      onChange(up.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <span className="label">Photo pour la pochette (facultatif)</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-line bg-ink/60 hover:border-gold/60"
          aria-label={value ? "Changer la photo" : "Ajouter une photo"}
        >
          {busy ? (
            <Loader className="size-5 animate-spin text-gold" />
          ) : value ? (
            <img src={`/api/uploads/${value}`} alt="Photo choisie" className="size-full object-cover" />
          ) : (
            <ImagePlus className="size-6 text-gold" />
          )}
        </button>
        <p className="text-xs text-muted">Elle sera intégrée à la pochette collector et au fichier audio.</p>
        {value && (
          <button type="button" onClick={() => onChange(null)} className="btn-quiet p-2" aria-label="Retirer la photo">
            <X className="size-4" />
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
