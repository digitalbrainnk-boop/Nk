// /api/generate-music — moteur musical Suno via Kie.ai.
//   POST { songId } ou { config } : lance la composition (2 versions : 2 prises d'une composition, ou A rythmée + B acoustique)
//   GET  ?songId=…               : suivi (polling) jusqu'aux URL audio finales
import { NextResponse } from "next/server";
import { z } from "zod";
import { songConfigSchema } from "@/lib/schemas";
import { baseUrl, config as env } from "@/lib/server/env";
import { apiError, HttpError, readJson } from "@/lib/server/http";
import { globalBudget, visitorLimit } from "@/lib/server/rate-limit";
import { createSong, refreshSong, requireSong, startGeneration, toPublicSong } from "@/lib/server/songs";
import type { SongConfig } from "@/lib/types";

const bodySchema = z.union([z.object({ songId: z.string().min(6).max(64) }), z.object({ config: z.unknown() })]);

export async function POST(req: Request) {
  try {
    const body = bodySchema.parse(await readJson(req));
    let id: string;
    if ("songId" in body) {
      id = (await requireSong(body.songId)).id;
    } else {
      if (!visitorLimit(req, "songs", 30, 3600_000).ok) throw new HttpError(429, "Trop de créations : réessayez plus tard.");
      if (!globalBudget("songs", 600)) throw new HttpError(503, "Beaucoup de créations en ce moment : réessayez dans quelques minutes.");
      id = (await createSong(songConfigSchema.parse(body.config) as SongConfig)).id;
    }
    const existing = await requireSong(id);
    const fresh = existing.generation.status === "idle" || existing.generation.status === "failed";
    // Une chanson payée peut être relancée (nombre limité par chanson) sans limite par adresse IP.
    if (fresh && !existing.demo && existing.payment.status !== "paid") {
      const limit = visitorLimit(req, "generate", env.generationsPerHour(), 3600_000);
      if (!limit.ok) {
        throw new HttpError(429, `Limite de créations atteinte : réessayez dans ${Math.ceil(limit.retryAfterSec / 60)} min.`);
      }
      // Compositions non payées (pré-écoute) : plafond commun, quel que soit le nombre de visiteurs.
      if (!globalBudget("generate", 30)) throw new HttpError(503, "Le studio est très demandé : réessayez dans quelques minutes.");
    }
    const song = await startGeneration(id, baseUrl(req));
    return NextResponse.json({ song: toPublicSong(song) }, { status: fresh ? 202 : 200 });
  } catch (e) {
    return apiError(e);
  }
}

export async function GET(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get("songId") ?? "";
    const song = await refreshSong(id, { base: baseUrl(req) });
    if (!song) throw new HttpError(404, "Chanson introuvable.");
    return NextResponse.json({ song: toPublicSong(song) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return apiError(e);
  }
}
