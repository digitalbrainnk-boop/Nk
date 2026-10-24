// GET /.well-known/assetlinks.json : lien de confiance entre dbmelo.com et l'application Android,
// qui s'ouvre alors en plein écran, sans barre d'adresse.
import { assetLinks } from "@/lib/server/android-app";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await assetLinks(), { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch (e) {
    console.error("assetlinks.json :", e);
    return Response.json([], { status: 503 });
  }
}
