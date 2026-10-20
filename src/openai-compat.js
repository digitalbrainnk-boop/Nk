// "Cerveau" alternatif : n'importe quel service compatible avec le format
// OpenAI /chat/completions (Kie.ai, DeepSeek, OpenRouter, Groq...).
import { getSettings, setSettings } from "./db.js";

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
    return { url: (s.kie_chat_url || "").trim() || kieChatUrl(model), key: kieKey(), model };
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

async function post(cfg, body, { timeoutMs } = {}) {
  let res;
  try {
    res = await fetch(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify(body),
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
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

// Erreur qui veut dire « mauvais nom de modèle ou d'adresse » (et pas « mauvaise clé »).
const isModelError = (e) =>
  e instanceof LLMError && (e.status === 404 || /model|not supported|not found|unsupported|no such/i.test(e.message)) && !isKeyError(e);
const isKeyError = (e) =>
  e instanceof LLMError && (e.status === 401 || e.status === 402 || /api key|apikey|token|unauthori|credit|balance|insufficient/i.test(e.message));

export async function chatText(opts) {
  try {
    return await chatTextOnce(opts);
  } catch (e) {
    // Kie.ai : si le nom du modèle n'est plus accepté, on retrouve le bon et on réessaie une fois.
    if (getSettings().brain !== "kie" || !isModelError(e)) throw e;
    const found = await probeKie();
    setSettings({ kie_chat_url: found.url, kie_chat_model: found.model });
    return chatTextOnce(opts);
  }
}

async function chatTextOnce({ system, turns, json = false }) {
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
export function kieCandidates() {
  const s = getSettings();
  const list = [];
  const add = (url, model) => {
    if (!list.some((c) => c.url === url && c.model === model)) list.push({ url, model });
  };
  // 1. Ce qui a déjà marché.
  if (s.kie_chat_url && s.kie_chat_model) add(s.kie_chat_url, s.kie_chat_model);
  // 2. DeepSeek : le nom dans l'adresse et le nom envoyé peuvent différer selon Kie.
  const slugs = ["deepseek-v4-1-flash", "deepseek-v4.1-flash", "deepseek-v4-flash", "deepseek"];
  const names = ["deepseek-v4.1-flash", "deepseek-v4-1-flash", "deepseek-v4-flash", "deepseek-flash", "deepseek-chat", "deepseek/deepseek-v4.1-flash"];
  for (const slug of slugs) for (const name of names) add(kieChatUrl(slug), name);
  for (const name of names) {
    add("https://api.kie.ai/v1/chat/completions", name);
    add("https://api.kie.ai/api/v1/chat/completions", name);
  }
  // 3. Repli : Gemini, aussi disponible avec la même clé Kie.
  for (const g of ["gemini-2.5-flash", "gemini-3-flash", "gemini-2.5-pro"]) add(kieChatUrl(g), g);
  return list;
}

/**
 * Lit la documentation officielle de Kie (depuis l'appareil de l'utilisateur)
 * pour trouver l'adresse et le nom exacts des modèles de chat, DeepSeek d'abord.
 * docs.kie.ai/llms.txt liste les pages ; chaque page .md montre un exemple
 * avec l'adresse « https://api.kie.ai/…/chat/completions » et "model": "…".
 */
export async function discoverKie({ fetchText = defaultFetchText } = {}) {
  const index = await fetchText("https://docs.kie.ai/llms.txt");
  const pageRe = /\((https:\/\/docs\.kie\.ai\/[^)\s]+?\.md)\)/g;
  const pagesFor = (test) => {
    const out = [];
    for (const line of index.split("\n")) {
      if (!test(line) || line.includes("/cn/")) continue;
      for (const m of line.matchAll(pageRe)) if (!out.includes(m[1])) out.push(m[1]);
    }
    return out;
  };
  const deepseek = pagesFor((l) => /deepseek/i.test(l));
  const otherChat = pagesFor((l) => /chat/i.test(l) && !/deepseek/i.test(l));
  const pages = [...deepseek.slice(0, 4), ...otherChat.slice(0, 3)];
  const found = [];
  for (const page of pages) {
    let md;
    try {
      md = await fetchText(page);
    } catch {
      continue;
    }
    const urls = [...new Set([...md.matchAll(/https:\/\/api\.kie\.ai\/[^\s"'`)<>\\]*chat\/completions/g)].map((m) => m[0]))];
    if (!urls.length) continue;
    const models = new Set();
    for (const m of md.matchAll(/"model"\s*:\s*"([^"]+)"/g)) models.add(m[1]);
    for (const m of md.matchAll(/^\s*model:\s*([A-Za-z0-9][\w.\/-]*)\s*$/gm)) models.add(m[1]);
    for (const url of urls) {
      const slug = url.match(/api\.kie\.ai\/([^/]+)\/v1\//)?.[1];
      const names = models.size ? [...models] : [];
      if (slug && !names.includes(slug)) names.push(slug);
      for (const model of names) if (!found.some((c) => c.url === url && c.model === model)) found.push({ url, model, doc: page });
    }
  }
  return found;
}

async function defaultFetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${url} : ${res.status}`);
  return res.text();
}

export async function probeKie({ onTry, discover = true } = {}) {
  const key = kieKey();
  if (!key) throw new LLMError("Clé Kie.ai manquante : colle-la dans Réglages → Kie.ai.");
  let firstError;
  let tries = 0;
  // D'abord ce que dit la documentation officielle, puis nos variantes connues.
  const fromDocs = discover ? await discoverKie().catch(() => []) : [];
  const seen = new Set();
  const all = [...fromDocs, ...kieCandidates()].filter((c) => {
    const k = `${c.url}|${c.model}`;
    return seen.has(k) ? false : seen.add(k);
  });
  for (const c of all) {
    try {
      const text = await post(
        { ...c, key },
        { model: c.model, messages: [{ role: "user", content: "Dis bonjour en une phrase courte, en français." }], max_tokens: 100 },
        { timeoutMs: 20_000 },
      );
      onTry?.(c, null);
      return { ...c, text };
    } catch (e) {
      onTry?.(c, e);
      tries++;
      firstError ??= e;
      // Clé refusée ou crédit épuisé : inutile d'essayer d'autres adresses.
      if (isKeyError(e)) throw e;
      // Pas d'internet : inutile d'insister.
      if (tries === 1 && !e.status && /Impossible de joindre/.test(e.message)) throw e;
    }
  }
  throw new LLMError(
    `Aucun modèle de chat Kie n'a répondu (${tries} essais${fromDocs.length ? `, dont ${fromDocs.length} trouvés dans la documentation` : ", documentation Kie illisible"}). Première réponse de Kie : ${firstError?.message}`,
    firstError?.status,
  );
}
