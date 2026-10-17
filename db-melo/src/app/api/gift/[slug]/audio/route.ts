// GET /api/gift/:slug/audio?variant=A&download=1 : la chanson offerte, pour le destinataire.
import { audioFilename, audioResponse, fullAudio, taggedAudio } from "@/lib/server/audio";
import { apiError, HttpError } from "@/lib/server/http";
import { songBySlug } from "@/lib/server/songs";
import type { VariantId } from "@/lib/types";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, { params }: Ctx) {
  try {
    const { slug } = await params;
    const q = new URL(req.url).searchParams;
    const song = await songBySlug(slug);
    if (!song || song.payment.status !== "paid") throw new HttpError(404, "Ce cadeau n'est pas disponible.");
    const variant = (q.get("variant") === "B" ? "B" : "A") as VariantId;
    const download = q.get("download") === "1";
    const audio = download ? await taggedAudio(song, variant, 0) : await fullAudio(song, variant, 0);
    return audioResponse(audio, { filename: audioFilename(song, variant, audio.ext), download });
  } catch (e) {
    return apiError(e);
  }
}
