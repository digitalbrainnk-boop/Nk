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
  open_hour: 0, // ouvert 24 h/24 pendant les tests
  close_hour: 0,
  min_reply_delay_seconds: 0,
  max_reply_delay_seconds: 0,
  typing_chars_per_second: 1000,
  voice_replies: "always",
  facebook_page_url: "https://www.facebook.com/nkdigital",
});
router.registerAdapter({ channel: "fake5", send: async (c, t) => (sent.push(t), `m${sent.length}`), sendAudio: async () => "a" });
const c = db.upsertContact("fake5", "r1", "Awa");
db.saveOrder({ contact_id: c.id, stage: "livree", song_title: "Pour Ibrahim", lyrics: "..." });

test("après la livraison : quand le client remercie, invitation au commentaire avec le lien (sans « tu as aimé ? »)", async () => {
  answer = { messages: ["Avec plaisir 🙏"], memory: "", needs_human: false, reason: "" };
  await agent.generateReply(db.getContact(c.id));
  assert.match(prompts.at(-1), /réagit normalement ou positivement/);
  assert.match(prompts.at(-1), /commentaire sous l'une de nos publications Facebook/);
  assert.match(prompts.at(-1), /ne propose PAS de nouvelle composition/);
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

const settle = async (cond) => {
  const end = Date.now() + 8000;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  assert.ok(cond());
};

test("demande de rabais : l'agent ne promet rien et te prévient", async () => {
  const owner = [];
  router.registerAdapter({ channel: "whatsapp", send: async () => "w", notifyOwner: async (t) => (owner.push(t), `n${owner.length}`) });
  const d = db.upsertContact("fake5", "r2", "Moussa");
  db.saveOrder({ contact_id: d.id, stage: "devis", price: 15000 });
  answer = { messages: ["Je regarde ce que je peux faire et je reviens vers toi 🙏"], memory: "", needs_human: false, reason: "", discount_request: "veut 10 000 au lieu de 15 000, il est étudiant" };
  await router.handleIncoming({ channel: "fake5", externalId: "r2", text: "Tu peux me faire 10 000 ? je suis étudiant", externalMsgId: "2" });
  await settle(() => owner.length > 0);
  assert.match(owner[0], /Demande de rabais/);
  assert.match(owner[0], /15000/);
  assert.match(db.getContact(d.id).needs_human_reason, /rabais/);
  assert.match(prompts.at(-1), /Rabais : si le client demande une réduction/);
});

test("« je reviendrai pour une autre chanson » : relance prévue puis envoyée le jour venu", async () => {
  const e = db.upsertContact("fake5", "r3", "Awa");
  answer = { messages: ["Avec plaisir, je serai là 😊"], memory: "", needs_human: false, reason: "", remind_in_days: 30, remind_about: "une autre chanson pour l'anniversaire de sa mère" };
  await router.handleIncoming({ channel: "fake5", externalId: "r3", text: "Je prends ces deux chansons, je reviendrai pour une autre", externalMsgId: "3" });
  await settle(() => db.getContact(e.id).remind_at > 0);
  const at = db.getContact(e.id).remind_at;
  assert.ok(at > Date.now() + 28 * 24 * 3600_000);
  assert.equal(await router.runReminders(Date.now()), 0); // pas encore
  answer = { messages: ["Coucou Awa ! L'anniversaire de ta maman approche 😊 On prépare sa chanson ?"], memory: "", needs_human: false, reason: "" };
  const n = sent.length;
  assert.equal(await router.runReminders(at + 60_000), 1);
  assert.match(prompts.at(-1), /anniversaire de sa mère/);
  assert.ok(sent.length > n);
  assert.equal(db.getContact(e.id).remind_at, 0); // une seule fois
});

test("heures d'ouverture : de 5 h à minuit", async () => {
  db.setSettings({ open_hour: 5, close_hour: 0 });
  const at = (h) => new Date(2026, 9, 21, h, 30);
  assert.equal(router.isOpen(at(3)), false);
  assert.equal(router.isOpen(at(5)), true);
  assert.equal(router.isOpen(at(23)), true);
  assert.equal(router.isOpen(at(0)), false);
  db.setSettings({ open_hour: 0, close_hour: 0 });
  assert.equal(router.isOpen(at(3)), true);
});
