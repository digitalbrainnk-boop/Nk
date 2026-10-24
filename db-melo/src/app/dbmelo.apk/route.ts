// GET /dbmelo.apk : l'application Android, signée par le serveur (voir lib/server/android-app.ts).
import { androidApk } from "@/lib/server/android-app";

export const dynamic = "force-dynamic";

async function respond(body: boolean) {
  let apk: Buffer | null;
  try {
    apk = await androidApk();
  } catch (e) {
    console.error("Application Android :", e);
    return new Response("Application Android momentanément indisponible.", { status: 503 });
  }
  if (!apk) return new Response("Application Android pas encore disponible.", { status: 404 });
  return new Response(body ? new Uint8Array(apk) : null, {
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Disposition": 'attachment; filename="DBMelo.apk"',
      "Content-Length": String(apk.length),
      "Cache-Control": "no-cache",
    },
  });
}

export const GET = () => respond(true);
export const HEAD = () => respond(false);
