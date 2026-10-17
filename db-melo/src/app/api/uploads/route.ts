// POST /api/uploads (multipart : file, kind=reference|photo) : morceau de référence (Style Match) ou photo de pochette.
import { NextResponse } from "next/server";
import { LIMITS } from "@/lib/constants";
import { config } from "@/lib/server/env";
import { apiError, HttpError } from "@/lib/server/http";
import { randomId } from "@/lib/server/ids";
import { uploadToKie } from "@/lib/server/kie";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { files, uploads } from "@/lib/server/store";
import type { UploadRecord } from "@/lib/types";

const ascii = (b: Uint8Array, start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len));

/** Type réel d'après les premiers octets (on ne se fie pas à l'extension). */
function sniff(b: Uint8Array): { mime: string; ext: string } | null {
  if (ascii(b, 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { mime: "audio/mpeg", ext: "mp3" };
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WAVE") return { mime: "audio/wav", ext: "wav" };
  if (b[0] === 0xff && b[1] === 0xd8) return { mime: "image/jpeg", ext: "jpg" };
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG") return { mime: "image/png", ext: "png" };
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}

export async function POST(req: Request) {
  try {
    if (!rateLimit(`upload:${clientIp(req)}`, 20, 3600_000).ok) throw new HttpError(429, "Trop d'envois : réessayez plus tard.");
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    const kind = form?.get("kind") === "photo" ? "photo" : "reference";
    if (!(file instanceof File)) throw new HttpError(400, "Aucun fichier reçu.");
    const max = kind === "photo" ? LIMITS.photoMaxBytes : LIMITS.referenceMaxBytes;
    if (file.size > max) throw new HttpError(413, `Fichier trop lourd (${Math.round(max / 1024 / 1024)} Mo maximum).`);
    const data = new Uint8Array(await file.arrayBuffer());
    const type = sniff(data);
    const ok = kind === "photo" ? type?.mime.startsWith("image/") : type?.mime.startsWith("audio/");
    if (!type || !ok) throw new HttpError(415, kind === "photo" ? "Photo JPG, PNG ou WebP uniquement." : "Fichier MP3 ou WAV uniquement.");

    const id = randomId(16);
    const name = `${id}.${type.ext}`;
    const localPath = (await files.write(name, data)) ? name : undefined;
    let publicUrl: string | undefined;
    if (config.kieKey()) {
      // URL publique temporaire : nécessaire à Suno (upload-cover) et au générateur de pochettes.
      publicUrl = await uploadToKie(data, name, type.mime).catch((e) => {
        console.warn("[DB.Mélo] Envoi Kie :", (e as Error).message);
        return undefined;
      });
    }
    if (!localPath && !publicUrl) throw new HttpError(500, "Impossible d'enregistrer le fichier.");
    const record: UploadRecord = {
      id,
      kind,
      fileName: file.name.slice(0, 200),
      mime: type.mime,
      size: data.length,
      publicUrl,
      localPath,
      createdAt: Date.now(),
    };
    await uploads.put(record);
    return NextResponse.json({ upload: { id, kind, fileName: record.fileName, size: record.size, mime: record.mime } }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
