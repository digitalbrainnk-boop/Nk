// GET /api/sante : le site répond, et indique si l'hébergeur transmet l'adresse des visiteurs
// (limites par visiteur actives). Utilisé par le test de « dbmelo-cles » ; ne révèle aucune adresse.
import { NextResponse } from "next/server";
import { clientIp } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return NextResponse.json({ ok: true, adresseVisiteur: clientIp(req) !== "local" }, { headers: { "Cache-Control": "no-store" } });
}
