// POST /api/songs : enregistre la configuration d'une chanson (avant création musicale).
import { NextResponse } from "next/server";
import { songConfigSchema } from "@/lib/schemas";
import { apiError, HttpError, readJson } from "@/lib/server/http";
import { globalBudget, visitorLimit } from "@/lib/server/rate-limit";
import { createSong, toPublicSong } from "@/lib/server/songs";
import { uploads } from "@/lib/server/store";
import type { SongConfig } from "@/lib/types";

export async function POST(req: Request) {
  try {
    if (!visitorLimit(req, "songs", 30, 3600_000).ok) throw new HttpError(429, "Trop de créations : réessayez plus tard.");
    if (!globalBudget("songs", 600)) throw new HttpError(503, "Beaucoup de créations en ce moment : réessayez dans quelques minutes.");
    const body = (await readJson(req)) as { config?: unknown };
    const config = songConfigSchema.parse(body.config) as SongConfig;
    for (const id of [config.referenceAudio?.uploadId, config.photoUploadId]) {
      if (id && !(await uploads.get(id))) throw new HttpError(400, "Fichier envoyé introuvable : déposez-le à nouveau.");
    }
    const song = await createSong(config);
    return NextResponse.json({ song: toPublicSong(song) }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
