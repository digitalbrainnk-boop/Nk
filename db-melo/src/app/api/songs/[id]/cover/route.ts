// GET /api/songs/:id/cover?choice=suno|collector|ai&download=1 : pochette (même origine, utilisable dans un canvas).
import { contentDisposition } from "@/lib/server/audio";
import { loadCover } from "@/lib/server/cover";
import { apiError } from "@/lib/server/http";
import { requireSong } from "@/lib/server/songs";
import type { CoverChoice } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const q = new URL(req.url).searchParams;
    const song = await requireSong(id);
    const choice = q.get("choice") as CoverChoice | null;
    const img = await loadCover(song, choice && ["suno", "collector", "ai"].includes(choice) ? choice : undefined);
    const headers: Record<string, string> = { "Content-Type": img.mime, "Cache-Control": "private, max-age=60" };
    if (q.get("download") === "1") {
      headers["Content-Disposition"] = contentDisposition(`Pochette - ${song.config.title}.${img.mime === "image/png" ? "png" : "jpg"}`);
    }
    return new Response(img.data as BodyInit, { headers });
  } catch (e) {
    return apiError(e);
  }
}
