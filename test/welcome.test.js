import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nk-welcome-"));
const db = await import("../src/db.js");
const router = await import("../src/router.js");
const agent = await import("../src/agent.js");

const sent = [];
const prompts = [];
let answer = {};
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("/chat/completions")) {
    prompts.push(JSON.parse(init.body).messages.map((m) => m.content).join("\n"));
    return Response.json({ choices: [{ message: { content: JSON.stringify(answer) } }] });
  }
  if (u.endsWith("/chat/credit")) return Response.json({ code: 200, data: 100 });
  throw new Error(`appel inattendu ${u}`);
};
db.setSettings({
  brain: "kie",
  kie_api_key: "k",
  kie_chat_url: "https://api.kie.ai/gpt-5-2/v1/chat/completions",
  kie_chat_model: "gpt-5-2",
  reply_mode: "auto",
  debounce_seconds: 0,
  open_hour: 0,
  close_hour: 0,
  min_reply_delay_seconds: 0,
  max_reply_delay_seconds: 0,
  typing_chars_per_second: 1000,
});
router.registerAdapter({ channel: "fake9", send: async (c, t) => (sent.push({ to: c.external_id, t }), `m${sent.length}`) });
router.setReplyGenerator(agent.generateReply);
const settle = async (cond) => {
  const end = Date.now() + 8000;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  assert.ok(cond());
};
const base = { memory: "", needs_human: false, reason: "" };

test("nouveau client : bonjour, puis le message de bienvenue exact, puis la question", async () => {
  answer = { ...base, messages: ["Bonjour 👋", "*Souhaitez-vous avoir une chanson personnalisée ?*"] };
  await router.handleIncoming({ channel: "fake9", externalId: "w1", text: "Bonjour", externalMsgId: "1" });
  await settle(() => sent.filter((x) => x.to === "w1").length === 3);
  const texts = sent.filter((x) => x.to === "w1").map((x) => x.t);
  assert.equal(texts[0], "Bonjour 👋");
  assert.equal(texts[1], db.getSettings().welcome_message); // mot pour mot, emojis compris
  assert.match(texts[1], /BIENVENUE CHEZ DIGITAL BRAIN/);
  assert.equal(texts[2], "*Souhaitez-vous avoir une chanson personnalisée ?*");
  assert.match(prompts.at(-1), /PREMIER CONTACT/);
});

test("le client dit oui : la liste officielle des tarifs part telle quelle, puis la question de l'option", async () => {
  answer = { ...base, messages: ["Voici nos tarifs :", "Quelle option choisissez-vous ?"], send_prices: true };
  await router.handleIncoming({ channel: "fake9", externalId: "w1", text: "Oui", externalMsgId: "2" });
  await settle(() => sent.filter((x) => x.to === "w1").length === 6);
  const texts = sent.filter((x) => x.to === "w1").map((x) => x.t).slice(3);
  assert.equal(texts[0], "Voici nos tarifs :");
  assert.match(texts[1], /Chanson personnalisée unique : 1 200 F/);
  assert.match(texts[1], /🎼/); // emojis des tarifs gardés
  assert.doesNotMatch(texts[1], /À savoir/); // les consignes internes ne partent pas
  assert.equal(texts[2], "Quelle option choisissez-vous ?");
  assert.doesNotMatch(prompts.at(-1), /PREMIER CONTACT/); // la bienvenue n'est envoyée qu'une fois
});

test("le déroulement (option, occasion, infos du mariage, pas de numéro) est connu de l'agent", () => {
  const titles = db.listKnowledge().map((k) => k.title);
  assert.ok(titles.includes("Déroulement d'une commande"));
  assert.match(prompts.at(-1), /noms des mariés, la date du mariage et le lieu du mariage/);
  assert.match(prompts.at(-1), /pas de numéro de téléphone|PAS de numéro de téléphone/);
});
