// POST /api/generate-lyrics : le parolier IA écrit titre + paroles à partir du formulaire guidé.
import { NextResponse } from "next/server";
import { lyricsRequestSchema } from "@/lib/schemas";
import { apiError, HttpError, readJson } from "@/lib/server/http";
import { generateLyrics } from "@/lib/server/lyrics";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";

export async function POST(req: Request) {
  try {
    const limit = rateLimit(`lyrics:${clientIp(req)}`, 20, 3600_000);
    if (!limit.ok) throw new HttpError(429, "Beaucoup de propositions d'un coup : réessayez dans quelques minutes.");
    const input = lyricsRequestSchema.parse(await readJson(req));
    return NextResponse.json(await generateLyrics(input));
  } catch (e) {
    return apiError(e);
  }
}
