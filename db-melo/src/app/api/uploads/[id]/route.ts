// GET /api/uploads/:id : aperçu d'une photo déposée (les morceaux de référence ne sont jamais rediffusés).
import { NextResponse } from "next/server";
import { apiError, HttpError } from "@/lib/server/http";
import { files, uploads } from "@/lib/server/store";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const up = await uploads.get(id);
    if (!up || up.kind !== "photo") throw new HttpError(404, "Photo introuvable.");
    const data = up.localPath ? await files.read(up.localPath) : null;
    if (data) return new Response(data as BodyInit, { headers: { "Content-Type": up.mime, "Cache-Control": "private, max-age=3600" } });
    if (up.publicUrl) return NextResponse.redirect(up.publicUrl);
    throw new HttpError(404, "Photo introuvable.");
  } catch (e) {
    return apiError(e);
  }
}
