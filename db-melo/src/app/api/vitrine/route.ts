// GET /api/vitrine : les chansons de la vitrine (titre, style, pochette), jouées dès l'arrivée sur le site.
import { listShowcase } from "@/lib/server/showcase";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ songs: await listShowcase() }, { headers: { "Cache-Control": "public, max-age=300" } });
}
