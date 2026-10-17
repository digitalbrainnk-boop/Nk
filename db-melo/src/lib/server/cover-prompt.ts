import { EMOTIONS, OCCASIONS, STYLES } from "../constants";
import type { SongRecord } from "../types";

/** Consigne pour la pochette IA (offre Prestige). */
export function coverPrompt(song: SongRecord): string {
  const c = song.config;
  const style = c.styles.map((id) => STYLES.find((s) => s.id === id)?.label).filter(Boolean).join(", ");
  const mood = EMOTIONS.find((e) => e.id === c.emotion)?.suno ?? "";
  const occasion = OCCASIONS.find((o) => o.id === c.brief?.occasion)?.label ?? "";
  const title = c.title.replace(/["“”]/g, "");
  const base = c.photoUploadId
    ? "Transform this photo into a luxurious collector album cover, keep the person recognizable and flattering"
    : "Luxurious collector album cover artwork";
  return [
    base,
    `for a personalized song titled "${title}"`,
    occasion && `occasion: ${occasion}`,
    style && `music style: ${style}`,
    mood && `mood: ${mood}`,
    "deep black studio background, metallic gold and warm amber neon accents, cinematic lighting, elegant typography",
    `the title "${title}" written in refined gold letters, small "DB.Mélo" signature`,
    "square format, high detail, no watermark",
  ]
    .filter(Boolean)
    .join(", ");
}
