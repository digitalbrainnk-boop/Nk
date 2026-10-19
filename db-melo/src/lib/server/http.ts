// Réponses JSON homogènes pour les routes API.
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { fieldErrors } from "../schemas";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function apiError(err: unknown): NextResponse {
  if (err instanceof HttpError) return NextResponse.json({ error: err.message, ...err.extra }, { status: err.status });
  if (err instanceof ZodError) {
    return NextResponse.json({ error: err.issues[0]?.message ?? "Données invalides.", fields: fieldErrors(err) }, { status: 400 });
  }
  // Le détail reste dans le journal du serveur : le visiteur ne voit pas les rouages internes.
  console.error("[DB.Mélo]", err);
  return NextResponse.json({ error: "Une erreur inattendue s'est produite : réessayez dans un instant." }, { status: 500 });
}

const JSON_MAX_BYTES = 256 * 1024;

/** Lit le corps de la requête sans dépasser `max` octets (un envoi géant ne peut pas saturer la mémoire). */
export async function readText(req: Request, max: number): Promise<string> {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > max) throw new HttpError(413, "Requête trop volumineuse.");
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new HttpError(413, "Requête trop volumineuse.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readJson(req: Request): Promise<unknown> {
  const text = await readText(req, JSON_MAX_BYTES);
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Corps de requête JSON invalide.");
  }
}
