// GET /api/songs/:id/audio?variant=A&take=0&quality=preview|hd&format=mp3|wav&download=1
//   preview : début du morceau, disponible avant paiement
//   hd      : morceau complet, étiqueté (titre, artiste, pochette), après paiement
import { audioFilename, audioResponse, fullAudio, previewAudio, taggedAudio, wavAudio } from "@/lib/server/audio";
import { apiError, HttpError } from "@/lib/server/http";
import { requireSong } from "@/lib/server/songs";
import type { VariantId } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const q = new URL(req.url).searchParams;
    const variant = (q.get("variant") === "B" ? "B" : "A") as VariantId;
    const take = Math.max(0, Math.min(1, Number(q.get("take")) || 0));
    const quality = q.get("quality") === "hd" ? "hd" : "preview";
    const download = q.get("download") === "1";
    const song = await requireSong(id);

    if (quality === "preview") return audioResponse(await previewAudio(song, variant, take));

    if (song.payment.status !== "paid") throw new HttpError(402, "Débloquez la chanson pour l'écouter en entier.");
    const prestige = song.payment.plan === "prestige";
    if (take > 0 && !prestige) throw new HttpError(403, "Les prises supplémentaires sont incluses dans l'offre Prestige.");
    if (q.get("format") === "wav") {
      if (!prestige && !song.demo) throw new HttpError(403, "Le WAV est inclus dans l'offre Prestige.");
      const wav = song.demo ? await fullAudio(song, variant, take) : await wavAudio(song, variant);
      return audioResponse(wav, { filename: audioFilename(song, variant, "wav"), download });
    }
    const audio = download ? await taggedAudio(song, variant, take) : await fullAudio(song, variant, take);
    return audioResponse(audio, { filename: audioFilename(song, variant, audio.ext), download });
  } catch (e) {
    return apiError(e);
  }
}
