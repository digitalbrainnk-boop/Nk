import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nk-llm-"));
const db = await import("../src/db.js");
const { generateReply, friendlyError } = await import("../src/agent.js");

let reply; // ce que le faux service renvoie
let lastBody;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    lastBody = JSON.parse(body);
    res.writeHead(reply.status || 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(reply.body));
  });
});

before(async () => {
  await new Promise((r) => server.listen(0, r));
  db.setSettings({
    brain: "openai",
    llm_url: `http://127.0.0.1:${server.address().port}/v1`,
    llm_api_key: "sk-test",
    llm_model: "deepseek-v4-flash",
  });
});
after(() => server.close());

const ok = (content) => ({ body: { choices: [{ message: { role: "assistant", content } }] } });

test("répond via un service compatible OpenAI (JSON entouré de ```)", async () => {
  reply = ok('```json\n{"messages":["Bonsoir 🙏","C\'est 25 000"],"memory":"- anniv","needs_human":false,"reason":""}\n```');
  const c = db.upsertContact("test", "a", "Awa");
  db.addMessage(c.id, { author: "client", text: "Bonsoir c'est combien ?" });
  const r = await generateReply(db.getContact(c.id));
  assert.deepEqual(r.messages, ["Bonsoir 🙏", "C'est 25 000"]);
  assert.equal(lastBody.model, "deepseek-v4-flash");
  assert.equal(lastBody.messages[0].role, "system");
  assert.equal(lastBody.messages.at(-1).role, "user");
});

test("texte hors format : gardé mais signalé à vérifier", async () => {
  reply = ok("Bonsoir ! C'est 25 000.");
  const c = db.upsertContact("test", "a", "Awa");
  const r = await generateReply(db.getContact(c.id));
  assert.deepEqual(r.messages, ["Bonsoir ! C'est 25 000."]);
  assert.equal(r.needs_human, true);
});

test("erreur de crédit traduite clairement", async () => {
  reply = { status: 402, body: { error: { message: "Insufficient balance" } } };
  const c = db.upsertContact("test", "a", "Awa");
  await assert.rejects(generateReply(db.getContact(c.id)), (e) => /Crédit épuisé/.test(friendlyError(e)));
});

test("Suno via Kie : création, suivi puis brouillon audio prêt à envoyer", async () => {
  // Faux Kie : on redirige fetch vers des réponses simulées.
  const realFetch = globalThis.fetch;
  db.setSettings({ kie_api_key: "kie-test" });
  let polls = 0;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), auth: init.headers?.Authorization, body: init.body && JSON.parse(init.body) });
    if (String(url).endsWith("/api/v1/generate")) return Response.json({ code: 200, msg: "success", data: { taskId: "t1" } });
    if (String(url).includes("/generate/record-info")) {
      polls++;
      return Response.json({
        code: 200,
        data: polls < 2
          ? { status: "TEXT_SUCCESS" }
          : { status: "SUCCESS", response: { sunoData: [{ audioUrl: "https://cdn.example/a.mp3", title: "Joyeux anniversaire Awa" }] } },
      });
    }
    if (String(url) === "https://cdn.example/a.mp3") return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } });
    return realFetch(url, init);
  };
  process.env.SUNO_POLL_MS = "5"; // accélère l'attente entre deux vérifications
  try {
    const router = await import("../src/router.js");
    const c = db.upsertContact("test", "song", "Awa");
    await router.createSong(c.id, { title: "Joyeux anniversaire Awa", style: "afro pop", lyrics: "[Chorus]\nJoyeux anniversaire" });
    for (let i = 0; i < 200 && !db.listMessages(c.id).some((m) => m.status === "draft"); i++) await new Promise((r) => setTimeout(r, 5));
    const draft = db.listMessages(c.id).find((m) => m.status === "draft");
    assert.ok(draft, "brouillon audio créé");
    assert.equal(draft.kind, "audio");
    assert.equal(draft.media_url, "https://cdn.example/a.mp3");
    assert.equal(calls[0].auth, "Bearer kie-test");
    assert.equal(calls[0].body.customMode, true);
    assert.equal(calls[0].body.prompt, "[Chorus]\nJoyeux anniversaire");
    await router.approveDraft(draft.id);
    assert.equal(db.getMessage(draft.id).status, "sent");
  } finally {
    globalThis.fetch = realFetch;
  }
});
