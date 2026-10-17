// Webhook Kie.ai : l'adresse est signée par nos soins ; on relit ensuite l'état officiel chez Kie.
import { NextResponse } from "next/server";
import { baseUrl } from "@/lib/server/env";
import { apiError, HttpError } from "@/lib/server/http";
import { refreshSong, verifyCallbackToken } from "@/lib/server/songs";

export async function POST(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const [song, variant, kind, token] = ["song", "variant", "kind", "token"].map((k) => q.get(k) ?? "");
    if (!song || !verifyCallbackToken(song, variant, kind, token)) throw new HttpError(401, "Rappel non autorisé.");
    await refreshSong(song, { force: true, base: baseUrl(req) });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
