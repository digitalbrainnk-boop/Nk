// GET /api/vitrine/:id/cover : pochette d'une chanson de la vitrine (image à côté du MP3, ou étiquette ID3).
import { showcaseCover } from "@/lib/server/showcase";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const cover = await showcaseCover((await params).id);
  if (!cover) return new Response("Pas de pochette.", { status: 404 });
  return new Response(cover.data as BodyInit, { headers: { "Content-Type": cover.mime, "Cache-Control": "public, max-age=86400" } });
}
