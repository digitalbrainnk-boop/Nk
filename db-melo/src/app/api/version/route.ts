// GET /api/version : version du site installée (change à chaque « dbmelo-maj ») et version de
// l'application Android du paquet. Les pages ouvertes s'en servent pour se mettre à jour d'elles-mêmes.
import fs from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

async function read(file: Promise<string>): Promise<string | null> {
  try {
    return (await file).trim();
  } catch {
    return null;
  }
}

export async function GET() {
  const [version, buildId, android] = await Promise.all([
    read(fs.readFile(/*turbopackIgnore: true*/ path.join(process.cwd(), "VERSION"), "utf8")),
    read(fs.readFile(/*turbopackIgnore: true*/ path.join(process.cwd(), ".next", "BUILD_ID"), "utf8")),
    read(fs.readFile(/*turbopackIgnore: true*/ path.join(process.cwd(), "android", "version"), "utf8")),
  ]);
  return Response.json(
    { site: version?.split(" ")[0] || buildId || "dev", android: Number(android) || null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
