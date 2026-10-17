"use client";

import { Loader, PenLine } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { LIMITS } from "@/lib/constants";
import type { PublicSong } from "@/lib/types";

/** Récapitulatif des paroles, modifiables tant que la musique n'est pas composée. */
export function LyricsCard({ song, editable, onSaved }: { song: PublicSong; editable: boolean; onSaved: (s: PublicSong) => void }) {
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(song.config.title);
  const [lyrics, setLyrics] = useState(song.config.lyrics);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const { song: s } = await api<{ song: PublicSong }>(`/api/songs/${song.id}`, { method: "PATCH", body: { title, lyrics } });
      onSaved(s);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card space-y-3 p-5 sm:p-6" aria-labelledby="lyrics-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="lyrics-title" className="font-display text-xl font-bold">
          Vos paroles
        </h2>
        {editable && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="btn btn-ghost min-h-10 py-2 text-sm">
            <PenLine className="size-4" /> Modifier
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-3">
          <input className="field" value={title} maxLength={LIMITS.titleMax} onChange={(e) => setTitle(e.target.value)} aria-label="Titre" />
          <textarea className="field min-h-72 leading-relaxed" value={lyrics} maxLength={LIMITS.lyricsMax} onChange={(e) => setLyrics(e.target.value)} aria-label="Paroles" />
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={busy} className="btn btn-gold">
              {busy && <Loader className="size-4 animate-spin" />} Enregistrer
            </button>
            <button type="button" onClick={() => setEditing(false)} className="btn btn-quiet">
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className={`text-sm leading-relaxed whitespace-pre-wrap text-cream/85 ${open ? "" : "line-clamp-6"}`}>{song.config.lyrics}</p>
          <button type="button" onClick={() => setOpen((o) => !o)} className="text-sm font-semibold text-gold">
            {open ? "Réduire" : "Afficher toutes les paroles"}
          </button>
        </>
      )}
    </section>
  );
}
