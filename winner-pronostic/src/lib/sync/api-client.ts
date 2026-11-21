import { type SportCode, getSport } from "@/lib/sports/catalog";

/**
 * Client HTTP d'API-Sports (une seule clé pour tous les sports).
 * Chaque appel est compté : le quota journalier est limité selon l'offre.
 */

export class ApiSportsError extends Error {
  constructor(
    message: string,
    readonly kind: "config" | "http" | "quota" | "auth" | "api",
  ) {
    super(message);
    this.name = "ApiSportsError";
  }
}

export type ApiSportsResponse<T = unknown> = {
  response: T[];
  results: number;
  paging: { current: number; total: number };
  remaining: number | null;
};

export type ApiSportsClient = {
  get<T = unknown>(sport: SportCode, path: string, params?: Record<string, string | number | undefined>): Promise<ApiSportsResponse<T>>;
  /** Nombre de requêtes envoyées par ce client. */
  readonly requests: number;
};

type ClientOptions = {
  key: string;
  /** Modèle d'URL, « https://{host} » par défaut (remplaçable pour les tests). */
  baseTemplate?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Les erreurs d'API-Sports arrivent souvent avec un statut 200 et un champ « errors » non vide. */
function readErrors(errors: unknown): string | null {
  if (!errors) return null;
  if (Array.isArray(errors)) return errors.length ? errors.map(String).join(", ") : null;
  if (typeof errors === "object") {
    const values = Object.entries(errors as Record<string, unknown>).map(([k, v]) => `${k}: ${String(v)}`);
    return values.length ? values.join(", ") : null;
  }
  return String(errors);
}

export function createApiSportsClient(options: ClientOptions): ApiSportsClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const template = options.baseTemplate ?? "https://{host}";
  let requests = 0;

  async function get<T>(sport: SportCode, path: string, params: Record<string, string | number | undefined> = {}) {
    const host = getSport(sport).apiHost;
    if (!host) throw new ApiSportsError(`Aucun fournisseur de données pour ${sport}`, "config");
    const url = new URL(`${template.replace("{host}", host)}${path}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));

    for (let attempt = 0; attempt < 3; attempt++) {
      requests += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
      let res: Response;
      try {
        res = await fetchImpl(url, { headers: { "x-apisports-key": options.key, accept: "application/json" }, signal: controller.signal, cache: "no-store" });
      } catch (err) {
        clearTimeout(timer);
        if (attempt < 2) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw new ApiSportsError(`Réseau indisponible pour ${host}${path} : ${(err as Error).message}`, "http");
      }
      clearTimeout(timer);

      if (res.status === 429 || res.status >= 500) {
        if (attempt < 2) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new ApiSportsError(`${host}${path} : HTTP ${res.status}`, res.status === 429 ? "quota" : "http");
      }
      if (res.status === 401 || res.status === 403) throw new ApiSportsError(`Clé API-Sports refusée (HTTP ${res.status})`, "auth");
      if (!res.ok) throw new ApiSportsError(`${host}${path} : HTTP ${res.status}`, "http");

      const body = (await res.json()) as { response?: T[]; results?: number; paging?: { current?: number; total?: number }; errors?: unknown };
      const error = readErrors(body.errors);
      if (error) {
        const lower = error.toLowerCase();
        const kind = lower.includes("limit") || lower.includes("requests") ? "quota" : lower.includes("token") || lower.includes("key") ? "auth" : "api";
        throw new ApiSportsError(`API-Sports (${sport}) : ${error}`, kind);
      }
      const remainingHeader = res.headers.get("x-ratelimit-requests-remaining");
      return {
        // La plupart des routes renvoient un tableau ; /status renvoie un objet
        response: Array.isArray(body.response) ? body.response : body.response ? [body.response as T] : [],
        results: body.results ?? 0,
        paging: { current: body.paging?.current ?? 1, total: body.paging?.total ?? 1 },
        remaining: remainingHeader === null ? null : Number(remainingHeader),
      };
    }
    throw new ApiSportsError("Échec inattendu", "http");
  }

  return {
    get,
    get requests() {
      return requests;
    },
  };
}
