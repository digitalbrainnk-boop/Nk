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
