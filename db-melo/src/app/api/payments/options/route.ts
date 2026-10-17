// GET /api/payments/options?songId=… : moyens de paiement réellement disponibles (sans aucune clé).
import { NextResponse } from "next/server";
import { ACTIVE_PLANS } from "@/lib/constants";
import { config } from "@/lib/server/env";
import { apiError } from "@/lib/server/http";
import { paymentOptions } from "@/lib/server/payments";
import { songs } from "@/lib/server/store";

export async function GET(req: Request) {
  try {
    const songId = new URL(req.url).searchParams.get("songId");
    const song = songId ? await songs.get(songId) : null;
    return NextResponse.json({ options: paymentOptions(song), plans: ACTIVE_PLANS, flowMode: config.flowMode() });
  } catch (e) {
    return apiError(e);
  }
}
