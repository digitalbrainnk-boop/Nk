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
  console.error("[DB.Mélo]", err);
  const message = err instanceof Error ? err.message : "Erreur inattendue.";
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Corps de requête JSON invalide.");
  }
}
