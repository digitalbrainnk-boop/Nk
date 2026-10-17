// GET /api/songs/:id : état public de la chanson · PATCH : retouches (paroles avant création, pochette, dédicace).
import { NextResponse } from "next/server";
import { z } from "zod";
import { finalStepSchema, lyricsStepSchema } from "@/lib/schemas";
import { baseUrl } from "@/lib/server/env";
import { apiError, HttpError, readJson } from "@/lib/server/http";
import { refreshSong, requireSong, toPublicSong } from "@/lib/server/songs";
import { songs } from "@/lib/server/store";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const song = await refreshSong(id, { base: baseUrl(req) });
    if (!song) throw new HttpError(404, "Chanson introuvable.");
    return NextResponse.json({ song: toPublicSong(song) });
  } catch (e) {
    return apiError(e);
  }
}

const patchSchema = z.object({
  coverChoice: z.enum(["suno", "collector", "ai"]).optional(),
  dedication: finalStepSchema.shape.dedication,
  recipientName: finalStepSchema.shape.recipientName,
  title: lyricsStepSchema.shape.title.optional(),
  lyrics: lyricsStepSchema.shape.lyrics.optional(),
});

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const patch = patchSchema.parse(await readJson(req));
    const current = await requireSong(id);
    const generationStarted = current.generation.status === "generating" || current.generation.status === "ready";
    if ((patch.title || patch.lyrics) && generationStarted) {
      throw new HttpError(409, "La musique est déjà composée : les paroles ne peuvent plus changer.");
    }
    const song = await songs.update(id, (s) => {
      s.config = { ...s.config, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
      s.updatedAt = Date.now();
    });
    return NextResponse.json({ song: toPublicSong(song!) });
  } catch (e) {
    return apiError(e);
  }
}
