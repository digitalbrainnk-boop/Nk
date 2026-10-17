// GET /api/gift/:slug/cover : pochette publique (page cadeau, aperçu WhatsApp / réseaux sociaux).
import { loadCover } from "@/lib/server/cover";
import { apiError, HttpError } from "@/lib/server/http";
import { songBySlug } from "@/lib/server/songs";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { slug } = await params;
    const song = await songBySlug(slug);
    if (!song || song.payment.status !== "paid") throw new HttpError(404, "Ce cadeau n'est pas disponible.");
    const img = await loadCover(song);
    return new Response(img.data as BodyInit, { headers: { "Content-Type": img.mime, "Cache-Control": "public, max-age=300" } });
  } catch (e) {
    return apiError(e);
  }
}
