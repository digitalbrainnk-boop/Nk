import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nk-kie-"));
const db = await import("../src/db.js");
const { chatText, probeKie } = await import("../src/openai-compat.js");

// Faux Kie : n'accepte qu'une seule combinaison adresse + nom de modèle.
function fakeKie({ okUrl, okModel, keyOk = true }) {
  const tried = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    tried.push(`${url} | ${body.model}`);
    if (!keyOk) return Response.json({ code: 401, msg: "You do not have access permissions" });
    if (String(url) === okUrl && body.model === okModel)
      return Response.json({ choices: [{ message: { role: "assistant", content: "Bonjour !" } }] });
    return Response.json({ code: 422, msg: "The model is not supported" });
  };
  return tried;
}

test("le test trouve la bonne combinaison adresse + modèle", async () => {
  db.setSettings({ brain: "kie", kie_api_key: "k", kie_chat_url: "", kie_chat_model: "deepseek-v4-1-flash" });
  fakeKie({ okUrl: "https://api.kie.ai/deepseek-v4-flash/v1/chat/completions", okModel: "deepseek-v4-flash" });
  const r = await probeKie();
  assert.equal(r.model, "deepseek-v4-flash");
  assert.equal(r.text, "Bonjour !");
});

test("en conversation : « model not supported » -> recherche automatique puis nouvel essai", async () => {
  db.setSettings({ brain: "kie", kie_api_key: "k", kie_chat_url: "", kie_chat_model: "deepseek-v4-1-flash" });
  fakeKie({ okUrl: "https://api.kie.ai/gemini-2.5-flash/v1/chat/completions", okModel: "gemini-2.5-flash" });
  const text = await chatText({ system: "s", turns: [{ role: "user", content: [{ type: "text", text: "Salut" }] }] });
  assert.equal(text, "Bonjour !");
  assert.equal(db.getSettings().kie_chat_model, "gemini-2.5-flash"); // mémorisé pour la suite
});

test("clé refusée : on s'arrête tout de suite (pas 39 essais)", async () => {
  db.setSettings({ brain: "kie", kie_api_key: "bad", kie_chat_url: "", kie_chat_model: "" });
  const tried = fakeKie({ keyOk: false });
  await assert.rejects(probeKie(), /access permissions/);
  assert.equal(tried.length, 1);
});

test("la documentation officielle de Kie est lue pour trouver l'adresse exacte", async () => {
  db.setSettings({ brain: "kie", kie_api_key: "k", kie_chat_url: "", kie_chat_model: "" });
  const okUrl = "https://api.kie.ai/api/v1/chat/deepseek-v4-1-flash/chat/completions";
  const tried = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u === "https://docs.kie.ai/llms.txt")
      return new Response(
        "# Kie\n- Chat Models > DeepSeek [DeepSeek V4.1 Flash](https://docs.kie.ai/market/deepseek/deepseek-v4-1-flash.md): chat\n- Image Models [Flux](https://docs.kie.ai/market/flux/flux.md): images\n",
      );
    if (u === "https://docs.kie.ai/market/deepseek/deepseek-v4-1-flash.md")
      return new Response(`curl ${okUrl} \\\n -d '{"model": "deepseek-v4.1-flash-chat", "messages": []}'`);
    const body = JSON.parse(init.body);
    tried.push(`${u} | ${body.model}`);
    if (u === okUrl && body.model === "deepseek-v4.1-flash-chat")
      return Response.json({ choices: [{ message: { content: "Salut !" } }] });
    return Response.json({ code: 404, msg: "Invalid model name" });
  };
  const r = await probeKie();
  assert.equal(r.url, okUrl);
  assert.equal(r.model, "deepseek-v4.1-flash-chat");
  assert.equal(tried.length, 1); // trouvé du premier coup grâce à la documentation
});

test("lit aussi une page au format OpenAPI (adresse et chemin séparés, model en enum)", async () => {
  const { parseChatDoc } = await import("../src/openai-compat.js");
  const md = `openapi: 3.0.0
servers:
  - url: https://api.kie.ai
paths:
  /deepseek/v1/chat/completions:
    post:
      requestBody:
        content:
          application/json:
            schema:
              properties:
                model:
                  type: string
                  enum:
                    - deepseek-v4.1-flash-x
                messages:
                  type: array
`;
  const hits = parseChatDoc(md);
  assert.ok(hits.some((h) => h.url === "https://api.kie.ai/deepseek/v1/chat/completions" && h.model === "deepseek-v4.1-flash-x"));
});

test("GPT via Kie : mode JSON refusé -> nouvel essai sans, et réponse presque conforme récupérée", async () => {
  db.setSettings({
    brain: "kie",
    kie_api_key: "k",
    kie_chat_url: "https://api.kie.ai/gpt-5-2/v1/chat/completions",
    kie_chat_model: "gpt-5-2",
  });
  const bodies = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    if (body.response_format) return Response.json({ code: 500, msg: "This feature is currently not supported" });
    // Prix en texte et étape inconnue : le schéma strict refuserait.
    const content = '```json\n{"messages":"Bonsoir 🙏 c\'est 25 000","memory":"- anniv","needs_human":false,"order":{"stage":"devis envoyé","price":"25 000 FCFA"}}\n```';
    return Response.json({ choices: [{ message: { content } }] });
  };
  const { generateReply } = await import("../src/agent.js");
  const c = db.upsertContact("test", "gpt", "Awa");
  db.addMessage(c.id, { author: "client", text: "C'est combien ?" });
  const r = await generateReply(db.getContact(c.id));
  assert.deepEqual(r.messages, ["Bonsoir 🙏 c'est 25 000"]);
  assert.equal(r.order.price, 25000);
  assert.equal(r.order.stage, null);
  assert.equal(bodies.length, 2);
  assert.ok(!bodies[1].response_format);
});

test("DeepSeek au format « messages » : préféré à GPT déjà enregistré, réponse lue correctement", async () => {
  db.setSettings({
    brain: "kie",
    kie_api_key: "k",
    kie_chat_url: "https://api.kie.ai/gpt-5-2/v1/chat/completions",
    kie_chat_model: "gpt-5-2",
  });
  const okUrl = "https://api.kie.ai/deepseek-v4-1-flash/v1/messages";
  const seen = [];
  globalThis.fetch = async (url, init) => {
    if (!init?.body) throw new Error("pas de doc ici");
    const body = JSON.parse(init.body);
    seen.push({ url: String(url), body, headers: init.headers });
    if (String(url) === okUrl && body.model === "deepseek-v4-1-flash" && body.system !== undefined && !body.messages.some((m) => m.role === "system"))
      return Response.json({ type: "message", content: [{ type: "text", text: "Salut, ici DeepSeek" }] });
    return Response.json({ code: 422, msg: "The model is not supported" });
  };
  const r = await probeKie();
  assert.equal(r.url, okUrl);
  assert.equal(r.text, "Salut, ici DeepSeek");
  assert.ok(!seen.some((x) => x.body.model === "gpt-5-2")); // DeepSeek trouvé avant de revenir à GPT
  assert.equal(seen.at(-1).headers["x-api-key"], "k");
});
