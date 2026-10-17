// « Mes chansons » : liste mémorisée sur cet appareil (pas de compte nécessaire).
export interface LocalSong {
  id: string;
  title: string;
  recipient?: string;
  createdAt: number;
}

const KEY = "dbmelo:songs";

export function listLocalSongs(): LocalSong[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LocalSong[]) : [];
  } catch {
    return [];
  }
}

export function rememberSong(song: LocalSong) {
  try {
    const list = listLocalSongs().filter((s) => s.id !== song.id);
    localStorage.setItem(KEY, JSON.stringify([song, ...list].slice(0, 50)));
  } catch {
    /* stockage indisponible (navigation privée) : sans conséquence */
  }
}

export function forgetSong(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(listLocalSongs().filter((s) => s.id !== id)));
  } catch {
    /* idem */
  }
}
