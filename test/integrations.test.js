import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nk-int-"));
const db = await import("../src/db.js");
const { emitHook } = await import("../src/integrations.js");
const { generateReply } = await import("../src/agent.js");

// Fausse « application » (Make, Zapier...) + faux cerveau compatible OpenAI.
const received = [];
let chatCalls = 0;
let lastSystem = "";
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url === "/hook") {
      received.push({ headers: req.headers, body });
      res.end("ok");
    } else if (req.url === "/dispo") {
      received.push({ action: JSON.parse(body) });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ samedi: "libre à partir de 14h" }));
    } else if (req.url === "/v1/chat/completions") {
      chatCalls++;
      lastSystem = JSON.parse(body).messages[0].content;
      const content =
        chatCalls === 1
          ? '{"messages":[],"memory":"","needs_human":false,"reason":"","actions":[{"name":"Disponibilités","input":"samedi"}]}'
          : '{"messages":["Samedi je suis libre à partir de 14h 👌"],"memory":"- veut samedi","needs_human":false,"reason":""}';
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    } else res.writeHead(404).end();
  });
});
let base;
before(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const waitFor = async (cond) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(cond());
};

test("webhook : seuls les événements choisis sont envoyés, avec signature", async () => {
  db.setSettings({
    webhooks: [{ id: "h1", name: "Make", url: `${base}/hook`, events: ["order.paid"], secret: "s3cret", enabled: true }],
  });
  emitHook("message.received", { x: 1 }); // non abonné
  emitHook("order.paid", { amount: 25000 });
  await waitFor(() => received.length === 1);
  const { headers, body } = received[0];
  assert.equal(headers["x-agent-event"], "order.paid");
  assert.equal(JSON.parse(body).data.amount, 25000);
  const expected = "sha256=" + crypto.createHmac("sha256", "s3cret").update(body).digest("hex");
  assert.equal(headers["x-agent-signature"], expected);
});

test("action : l'agent l'appelle, reçoit le résultat, puis répond", async () => {
  received.length = 0;
  db.setSettings({
    brain: "openai",
    llm_url: `${base}/v1`,
    llm_api_key: "k",
    llm_model: "m",
    agent_actions: [
      {
        id: "a1",
        name: "Disponibilités",
        description: "Vérifie si je suis libre à une date",
        url: `${base}/dispo`,
        method: "POST",
        headers: { "X-Api-Key": "secret-jamais-montre" },
        enabled: true,
      },
    ],
  });
  const c = db.upsertContact("test", "i1", "Awa");
  db.addMessage(c.id, { author: "client", text: "Tu es dispo samedi ?" });
  const notes = [];
  const r = await generateReply(db.getContact(c.id), { onAction: (x) => notes.push(x) });
  assert.deepEqual(r.messages, ["Samedi je suis libre à partir de 14h 👌"]);
  assert.equal(chatCalls, 2);
  assert.equal(received[0].action.input, "samedi");
  assert.equal(received[0].action.contact.name, "Awa");
  assert.equal(notes[0].ok, true);
  // L'agent voit le nom et la description de l'action, jamais la clé.
  assert.match(lastSystem, /Disponibilités : Vérifie si je suis libre/);
  assert.doesNotMatch(lastSystem, /secret-jamais-montre/);
});

test("une clé non-Claude collée dans la case Claude part vers Kie", () => {
  db.setSettings({ brain: "claude", anthropic_api_key: "", kie_api_key: "" });
  assert.equal(db.getSettings().brain, "claude");
  db.setSettings({ kie_api_key: "abc" });
  assert.equal(db.getSettings().brain, "kie"); // pas de clé Claude : Kie utilisé automatiquement
});

test("une clé Kie déjà enregistrée par erreur dans la case Claude est utilisée comme clé Kie", () => {
  db.setSettings({ brain: "claude", anthropic_api_key: "0dd23e8da5c4", kie_api_key: "" });
  const s = db.getSettings();
  assert.equal(s.brain, "kie");
  assert.equal(s.kie_api_key, "0dd23e8da5c4");
  assert.equal(s.anthropic_api_key, "");
});

test("une clé Kie donnée à l'installation comme clé Claude (.env) est utilisée comme clé Kie", () => {
  db.setSettings({ brain: "kie", anthropic_api_key: "", kie_api_key: "" });
  process.env.ANTHROPIC_API_KEY = "0dd2envkey";
  try {
    const s = db.getSettings();
    assert.equal(s.brain, "kie");
    assert.equal(s.kie_api_key, "0dd2envkey");
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});
