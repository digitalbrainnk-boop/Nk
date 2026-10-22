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

// Trois formats d'échange existent selon l'adresse :
//   …/chat/completions (OpenAI), …/messages (Anthropic), …/responses (OpenAI Responses).
export function wireFormat(url) {
  if (/\/messages\/?$/.test(url)) return "messages";
  if (/\/responses\/?$/.test(url)) return "responses";
  return "chat";
}

// Les appelants construisent toujours un corps « chat » ; on le traduit si besoin.
function toWire(format, body) {
  if (format === "chat") return body;
  const system = body.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = [];
  for (const m of body.messages.filter((x) => x.role !== "system")) {
    const prev = rest[rest.length - 1];
    if (prev && prev.role === m.role) prev.content += "\n" + m.content;
    else rest.push({ role: m.role, content: m.content });
  }
  if (!rest.length || rest[0].role !== "user") rest.unshift({ role: "user", content: "(début de la conversation)" });
  if (format === "messages") return { model: body.model, max_tokens: body.max_tokens || 4000, system, messages: rest };
  return { model: body.model, instructions: system, input: rest, max_output_tokens: body.max_tokens || 4000 };
}

function fromWire(format, data) {
  const d = data?.data && !data.choices && !data.content && !data.output ? data.data : data;
  if (format === "messages") {
    const parts = Array.isArray(d?.content) ? d.content : [];
    return parts.length ? parts.filter((p) => p.type === "text" || typeof p.text === "string").map((p) => p.text).join("") : undefined;
  }
  if (format === "responses") {
    if (typeof d?.output_text === "string") return d.output_text;
    const parts = (d?.output || []).flatMap((o) => o.content || []);
    return parts.length ? parts.map((c) => c.text || "").join("") : undefined;
  }
  let text = d?.choices?.[0]?.message?.content;
  // Certains modèles renvoient le texte en plusieurs morceaux.
  if (Array.isArray(text)) text = text.map((p) => (typeof p === "string" ? p : p?.text || "")).join("");
  return text;
}

async function post(cfg, body, { timeoutMs } = {}) {
  const format = wireFormat(cfg.url);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` };
  if (format === "messages") {
    headers["x-api-key"] = cfg.key;
    headers["anthropic-version"] = "2023-06-01";
  }
  let res;
  try {
    res = await fetch(cfg.url, {
      method: "POST",
      headers,
      body: JSON.stringify(toWire(format, body)),
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
  const text = fromWire(format, data);
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
  let text = "";
  try {
    if (wireFormat(cfg.url) === "chat") text = await post(cfg, { ...body, response_format: { type: "json_object" } });
  } catch (e) {
    // Si le service n'accepte pas le mode JSON, on réessaie sans (sauf problème de clé).
    if (isKeyError(e)) throw e;
    console.error("Mode JSON refusé, nouvel essai sans :", e.message);
  }
  if (!text.trim()) text = await post(cfg, body);
  if (!text.trim()) throw new LLMError("Le modèle a renvoyé une réponse vide.");
  return text;
}

/**
 * Lit une image (ex : capture de paiement) et renvoie un objet JSON. Seulement pour les
 * services au format « chat/completions » qui acceptent les images ; sinon null.
 */
export async function visionJSON({ prompt, imagePath, mime }) {
  const cfg = llmConfig();
  if (!cfg.url || !cfg.key || !cfg.model || wireFormat(cfg.url) !== "chat") return null;
  const fs = await import("node:fs");
  const data = fs.readFileSync(imagePath).toString("base64");
  const text = await post(
    cfg,
    {
      model: cfg.model,
      max_tokens: 1500,
      messages: [
        { role: "system", content: "Tu lis des captures d'écran de paiement mobile. Réponds UNIQUEMENT avec un objet JSON." },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${(mime || "image/jpeg").split(";")[0]};base64,${data}` } },
          ],
        },
      ],
    },
    { timeoutMs: 60_000 },
  );
  const m = String(text || "").match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

/** Demande une réponse JSON et la valide avec un schéma zod. */
export async function chatJSON({ system, turns, schema, shape, salvage }) {
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
  if (r.success) return { ok: true, data: r.data };
  // Format presque bon : on récupère ce qui est utilisable plutôt que tout perdre.
  const rescued = salvage?.(parsed);
  if (rescued) return { ok: true, data: rescued };
  console.error("Réponse IA hors format :", text.slice(0, 300));
  return { ok: false, text };
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
  const saved = s.kie_chat_url && s.kie_chat_model ? { url: s.kie_chat_url, model: s.kie_chat_model } : null;
  // Ce qui a déjà marché passe en premier, sauf si on cherche encore DeepSeek.
  const wantDeepseek = (s.kie_prefer || "deepseek") === "deepseek";
  if (saved && (!wantDeepseek || /deepseek/i.test(saved.model))) add(saved.url, saved.model);
  // DeepSeek : le nom dans l'adresse, le nom envoyé et le format peuvent différer selon Kie.
  const slugs = ["deepseek-v4-1-flash", "deepseek-v4.1-flash", "deepseek-v4-flash", "deepseek"];
  const names = ["deepseek-v4-1-flash", "deepseek-v4.1-flash", "deepseek-v4-flash", "deepseek-flash", "deepseek-chat", "deepseek/deepseek-v4.1-flash"];
  for (const slug of slugs.slice(0, 3)) for (const name of names.slice(0, 3)) {
    add(`https://api.kie.ai/${slug}/v1/messages`, name);
    add(`https://api.kie.ai/${slug}/v1/responses`, name);
  }
  for (const name of names.slice(0, 3)) add("https://api.kie.ai/v1/messages", name);
  for (const slug of slugs) for (const name of names) add(kieChatUrl(slug), name);
  for (const name of names) add("https://api.kie.ai/v1/chat/completions", name);
  // Ce qui marchait (ex. GPT-5.2), puis les replis connus.
  if (saved) add(saved.url, saved.model);
  add(kieChatUrl("gpt-5-2"), "gpt-5-2");
  for (const g of ["gemini-2.5-flash", "gemini-3-flash"]) add(kieChatUrl(g), g);
  return list;
}

/**
 * Lit la documentation officielle de Kie (depuis l'appareil de l'utilisateur)
 * pour trouver l'adresse et le nom exacts des modèles de chat, DeepSeek d'abord.
 * docs.kie.ai/llms.txt liste les pages ; chaque page .md montre un exemple
 * avec l'adresse « https://api.kie.ai/…/chat/completions » et "model": "…".
 */
export async function discoverKie({ fetchText = defaultFetchText, onPage } = {}) {
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
  const deepseek = pagesFor((l) => /deep\s*seek/i.test(l));
  const otherChat = pagesFor((l) => /chat/i.test(l) && !/deep\s*seek/i.test(l));
  const pages = [...deepseek.slice(0, 4), ...otherChat.slice(0, 3)];
  const found = [];
  for (const page of pages) {
    let md;
    try {
      md = await fetchText(page);
    } catch {
      continue;
    }
    const hits = parseChatDoc(md);
    onPage?.(page, md, hits);
    for (const h of hits) if (!found.some((c) => c.url === h.url && c.model === h.model)) found.push({ ...h, doc: page });
  }
  return found;
}

/**
 * Extrait d'une page de documentation Kie les adresses de chat et les noms de
 * modèles, qu'ils soient écrits en exemple (curl, JSON) ou en spécification
 * OpenAPI (servers: url + paths: /…/chat/completions, model: enum/default/example).
 */
export function parseChatDoc(md) {
  const urls = new Set(
    [...md.matchAll(/https:\/\/api\.kie\.ai\/[^\s"'`)<>\\]*(?:completions|\/messages|\/responses)/g)].map((m) => m[0]),
  );
  const server = md.match(/servers:\s*\n\s*-\s*url:\s*['"]?(https?:\/\/[^\s'"]+)/)?.[1]?.replace(/\/+$/, "") || "https://api.kie.ai";
  for (const m of md.matchAll(/^\s*['"]?(\/[A-Za-z0-9._\/{}-]*(?:completions|messages|responses))['"]?\s*:\s*$/gm)) urls.add(server + m[1]);
  const models = new Set();
  for (const m of md.matchAll(/"model"\s*:\s*"([^"]+)"/g)) models.add(m[1]);
  for (const m of md.matchAll(/^\s*model:\s*['"]?([A-Za-z0-9][\w.\/-]*)['"]?\s*$/gm)) models.add(m[1]);
  // Bloc « model: » d'une spécification : enum / default / example dans les lignes suivantes.
  for (const m of md.matchAll(/^(\s*)model:\s*\n((?:\1\s+.*\n?){1,25})/gm)) {
    for (const v of m[2].matchAll(/(?:default|example|const):\s*['"]?([A-Za-z0-9][\w.\/-]*)['"]?/g)) models.add(v[1]);
    for (const v of m[2].matchAll(/^\s*-\s*['"]?([A-Za-z0-9][\w.\/-]*)['"]?\s*$/gm)) models.add(v[1]);
  }
  const plausible = [...models].filter((v) => v.length >= 3 && /[a-z]/i.test(v) && !["string", "object", "true", "false"].includes(v));
  const hits = [];
  for (const url of urls) {
    const slug = url.match(/api\.kie\.ai\/([^/]+)\/v1\//)?.[1];
    const names = [...plausible];
    if (slug && !names.includes(slug)) names.push(slug);
    for (const model of names) hits.push({ url, model });
  }
  return hits;
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
