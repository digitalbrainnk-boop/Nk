// "Cerveau" alternatif : n'importe quel service compatible avec le format
// OpenAI /chat/completions (Kie.ai, DeepSeek, OpenRouter, Groq...).
import { getSettings } from "./db.js";

export class LLMError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function llmConfig() {
  const s = getSettings();
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
    throw new LLMError(typeof apiError === "string" ? apiError : raw.slice(0, 300) || `Erreur ${res.status}`, res.status);
  }
  const text = data?.choices?.[0]?.message?.content ?? data?.data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new LLMError(`Réponse inattendue du service : ${raw.slice(0, 300)}`);
  return text;
}

export async function chatText({ system, turns, json = false }) {
  const cfg = llmConfig();
  if (!cfg.url || !cfg.key || !cfg.model) {
    throw new LLMError("Cerveau non configuré : remplis l'adresse, la clé et le modèle dans Réglages.");
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
