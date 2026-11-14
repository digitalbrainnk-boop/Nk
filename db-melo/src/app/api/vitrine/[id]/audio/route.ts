// GET /api/vitrine/:id/audio : MP3 de la vitrine, servi par morceaux (en-tête Range), comme l'exige
// le lecteur de l'iPhone, et pour démarrer vite sur une connexion mobile.
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { showcaseAudio } from "@/lib/server/showcase";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const audio = await showcaseAudio((await params).id);
  if (!audio) return new Response("Chanson introuvable.", { status: 404 });
  const headers: Record<string, string> = { "Content-Type": "audio/mpeg", "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=86400" };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  let start = 0;
  let end = audio.size - 1;
  if (range && (range[1] || range[2])) {
    start = range[1] ? Number(range[1]) : Math.max(0, audio.size - Number(range[2]));
    end = range[1] && range[2] ? Math.min(Number(range[2]), audio.size - 1) : audio.size - 1;
    if (start >= audio.size || start > end) {
      return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${audio.size}` } });
    }
    headers["Content-Range"] = `bytes ${start}-${end}/${audio.size}`;
  }
  headers["Content-Length"] = String(end - start + 1);
  const body = Readable.toWeb(createReadStream(audio.file, { start, end })) as ReadableStream;
  return new Response(body, { status: headers["Content-Range"] ? 206 : 200, headers });
}
