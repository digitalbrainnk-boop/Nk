import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nk-review-"));
const db = await import("../src/db.js");
const agent = await import("../src/agent.js");
const router = await import("../src/router.js");

// Faux cerveau Kie : renvoie la réponse préparée et garde le prompt.
const prompts = [];
let answer = {};
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("/chat/completions")) {
    prompts.push(JSON.parse(init.body).messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n"));
    return Response.json({ choices: [{ message: { content: JSON.stringify(answer) } }] });
  }
  if (u.endsWith("/chat/credit")) return Response.json({ code: 200, data: 100 });
  throw new Error(`appel inattendu ${u}`);
};

const sent = [];
db.setSettings({
  brain: "kie",
  kie_api_key: "k",
  kie_chat_url: "https://api.kie.ai/gpt-5-2/v1/chat/completions",
  kie_chat_model: "gpt-5-2",
  reply_mode: "auto",
  debounce_seconds: 0,
  min_reply_delay_seconds: 0,
  max_reply_delay_seconds: 0,
  typing_chars_per_second: 1000,
  voice_replies: "always",
  facebook_page_url: "https://www.facebook.com/nkdigital",
});
router.registerAdapter({ channel: "fake5", send: async (c, t) => (sent.push(t), `m${sent.length}`), sendAudio: async () => "a" });
const c = db.upsertContact("fake5", "r1", "Awa");
db.saveOrder({ contact_id: c.id, stage: "livree", song_title: "Pour Ibrahim", lyrics: "..." });

test("après la livraison, l'agent sait qu'il doit demander s'il a aimé puis donner le lien de la page", async () => {
  answer = { messages: ["Avec plaisir 🙏 Tu as aimé ?"], memory: "", needs_human: false, reason: "" };
  await agent.generateReply(db.getContact(c.id));
  assert.match(prompts.at(-1), /demande-lui chaleureusement s'il a aimé/);
  assert.match(prompts.at(-1), /https:\/\/www\.facebook\.com\/nkdigital/);
  assert.match(prompts.at(-1), /Pour Ibrahim/);
});

test("le client a aimé : le lien part en texte (cliquable), et l'agent ne le redemandera plus", async () => {
  router.setReplyGenerator(agent.generateReply);
  answer = {
    messages: ["Ça me touche énormément 🥹", "Si ton temps le permet, laisse-nous un petit commentaire sous une de nos publications : https://www.facebook.com/nkdigital"],
    memory: "",
    needs_human: false,
    reason: "",
    asked_review: true,
  };
  await router.handleIncoming({ channel: "fake5", externalId: "r1", text: "Oui on a adoré, merci beaucoup !!", externalMsgId: "1" });
  const end = Date.now() + 8000;
  while (!db.getContact(c.id).review_asked_at && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  assert.ok(db.getContact(c.id).review_asked_at > 0);
  assert.ok(sent.some((t) => t.includes("facebook.com/nkdigital"))); // texte, pas vocal
  await agent.generateReply(db.getContact(c.id));
  assert.match(prompts.at(-1), /ne le redemande pas/);
});
