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
