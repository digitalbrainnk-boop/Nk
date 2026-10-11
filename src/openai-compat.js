// "Cerveau" alternatif : n'importe quel service compatible avec le format
// OpenAI /chat/completions (Kie.ai, DeepSeek, OpenRouter, Groq...).
import { getSettings } from "./db.js";

export function kieKey() {
  return (getSettings().kie_api_key || process.env.KIE_API_KEY || "").trim();
}

export class LLMError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Pour Kie.ai, chaque modèle a sa propre adresse : https://api.kie.ai/<modèle>/v1/chat/completions
export const KIE_DEFAULT_MODEL = "deepseek-v4-1-flash";
export const kieChatUrl = (model) => `https://api.kie.ai/${model}/v1/chat/completions`;

export function llmConfig() {
  const s = getSettings();
  if (s.brain === "kie") {
    const model = (s.kie_chat_model || KIE_DEFAULT_MODEL).trim();
    return { url: kieChatUrl(model), key: kieKey(), model };
  }
  let url = (s.llm_url || process.env.LLM_URL || "").trim();
  // On accepte une adresse de base (".../v1") : on complète le chemin.
  if (url && !/\/chat\/completions\/?$/.test(url)) url = url.replace(/\/+$/, "") + "/chat/completions";
  return {
    url,
    key: (s.llm_api_key || process.env.LLM_API_KEY || "").trim(),
    model: (s.llm_model || process.env.LLM_MODEL || "").trim(),
  };
}

// Convertit nos tours (blocs Claude) en messages texte simples.
function toOpenAI(turns) {
  return turns.map((t) => ({
    role: t.role,
    content: t.content
      .map((c) => (c.type === "text" ? c.text : c.type === "image" ? "[photo envoyée par le client]" : ""))
      .filter(Boolean)
      .join("\n"),
  }));
}

async function post(cfg, body) {
  let res;
  try {
    res = await fetch(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new LLMError(`Impossible de joindre ${cfg.url} : ${e.message}`);
  }
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }
  // Certains services renvoient 200 avec un code d'erreur dans le corps.
  const apiError = data?.error?.message || data?.error || (data?.code && data.code !== 200 ? data.msg || data.message : null);
  if (!res.ok || apiError) {
    // Kie.ai renvoie parfois HTTP 200 avec {"code": 401, "msg": "..."}.
    const status = typeof data?.code === "number" && data.code !== 200 ? data.code : res.status;
    throw new LLMError(typeof apiError === "string" ? apiError : raw.slice(0, 300) || `Erreur ${res.status}`, status);
  }
  const text = data?.choices?.[0]?.message?.content ?? data?.data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new LLMError(`Réponse inattendue du service : ${raw.slice(0, 300)}`);
  return text;
}

export async function chatText({ system, turns, json = false }) {
  const cfg = llmConfig();
  if (!cfg.url || !cfg.key || !cfg.model) {
    throw new LLMError(
      getSettings().brain === "kie"
        ? "Clé Kie.ai manquante : colle-la dans Réglages → Kie.ai."
        : "Cerveau non configuré : remplis l'adresse, la clé et le modèle dans Réglages.",
    );
  }
  const body = {
    model: cfg.model,
    messages: [{ role: "system", content: system }, ...toOpenAI(turns)],
    max_tokens: 4000,
  };
  if (!json) return post(cfg, body);
  try {
    return await post(cfg, { ...body, response_format: { type: "json_object" } });
  } catch (e) {
    // Si le service ne connaît pas response_format, on réessaie sans.
    if (e.status === 400 || e.status === 422) return post(cfg, body);
    throw e;
  }
}

/** Demande une réponse JSON et la valide avec un schéma zod. */
export async function chatJSON({ system, turns, schema, shape }) {
  const text = await chatText({
    system: `${system}\n\nRéponds UNIQUEMENT avec un objet JSON valide, sans texte autour, de cette forme :\n${shape}`,
    turns,
    json: true,
  });
  const cleaned = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  let parsed;
  try {
    parsed = JSON.parse(start >= 0 ? cleaned.slice(start, end + 1) : cleaned);
  } catch {
    return { ok: false, text };
  }
  const r = schema.safeParse(parsed);
  return r.success ? { ok: true, data: r.data } : { ok: false, text };
}

/**
 * Kie.ai : le nom exact du modèle dans l'adresse peut varier. On essaie les
 * variantes connues et on renvoie la première qui répond.
 */
export async function probeKie() {
  const candidates = [getSettings().kie_chat_model, KIE_DEFAULT_MODEL, "deepseek-v4.1-flash", "deepseek-v4-flash"]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
  const key = kieKey();
  if (!key) throw new LLMError("Clé Kie.ai manquante : colle-la dans Réglages → Kie.ai.");
  let lastError;
  for (const model of candidates) {
    try {
      const text = await post(
        { url: kieChatUrl(model), key, model },
        { model, messages: [{ role: "user", content: "Dis bonjour en une phrase courte, en français." }], max_tokens: 100 },
      );
      return { model, text };
    } catch (e) {
      lastError = e;
      // Clé refusée ou crédit épuisé : inutile d'essayer d'autres noms.
      if ([401, 402, 403].includes(e.status)) throw e;
    }
  }
  throw lastError;
}
