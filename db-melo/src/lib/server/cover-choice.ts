import type { CoverChoice, SongRecord } from "../types";

export function sunoImage(song: SongRecord): string | undefined {
  return song.variants.A.tracks[0]?.imageUrl ?? song.variants.B.tracks[0]?.imageUrl;
}

/** Pochettes proposables pour cette chanson. */
export function coverChoices(song: SongRecord): CoverChoice[] {
  const list: CoverChoice[] = [];
  if (song.aiCover?.status === "ready") list.push("ai");
  if (sunoImage(song)) list.push("suno");
  list.push("collector");
  return list;
}

/** Pochette retenue : choix de l'utilisateur s'il est disponible, sinon la meilleure disponible. */
export function effectiveCoverChoice(song: SongRecord): CoverChoice {
  const available = coverChoices(song);
  const choice = song.config.coverChoice;
  if (choice && available.includes(choice)) return choice;
  if (available.includes("ai")) return "ai";
  if (song.config.photoUploadId) return "collector";
  return available[0];
}
