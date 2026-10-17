"use client";

import { ChevronRight, Music, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { forgetSong, listLocalSongs, type LocalSong } from "@/lib/client/local-songs";

export function MySongs() {
  const [songs, setSongs] = useState<LocalSong[] | null>(null);
  useEffect(() => setSongs(listLocalSongs()), []);

  if (!songs) return null;
  if (!songs.length) {
    return (
      <div className="card p-8 text-center">
        <p className="text-muted">Aucune chanson créée sur cet appareil pour le moment.</p>
        <Link href="/studio" className="btn btn-gold mt-5">
          Créer ma première chanson
        </Link>
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      {songs.map((s) => (
        <li key={s.id} className="card flex items-center gap-3 p-3 pr-2">
          <Link href={`/chanson/${s.id}`} className="flex min-w-0 flex-1 items-center gap-3">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gold/15 text-gold">
              <Music className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-semibold">{s.title}</span>
              <span className="block text-sm text-muted">
                {s.recipient ? `Pour ${s.recipient} · ` : ""}
                {new Date(s.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
              </span>
            </span>
            <ChevronRight className="ml-auto size-5 text-muted" />
          </Link>
          <button
            type="button"
            onClick={() => {
              forgetSong(s.id);
              setSongs(listLocalSongs());
            }}
            className="btn-quiet p-2"
            aria-label={`Retirer « ${s.title} » de la liste`}
          >
            <Trash2 className="size-4" />
          </button>
        </li>
      ))}
    </ul>
  );
}
