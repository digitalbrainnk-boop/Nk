import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nk-test-"));
const db = await import("../src/db.js");
const router = await import("../src/router.js");
const { pickExamples } = await import("../src/agent.js");

const sent = [];
before(() => {
  db.setSettings({ reply_mode: "auto", debounce_seconds: 0, min_reply_delay_seconds: 0, max_reply_delay_seconds: 0, typing_chars_per_second: 1000 });
  router.registerAdapter({ channel: "fake", send: async (c, text) => (sent.push(text), `id-${sent.length}`) });
});

const waitFor = async (cond) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(cond());
};

test("regroupe les messages du client et répond en plusieurs bulles", async () => {
  const calls = [];
  router.setReplyGenerator(async (contact) => {
    calls.push(db.unansweredClientMessages(contact.id).map((m) => m.text));
    return { messages: ["Bonsoir 🙏", "C'est 25 000"], memory: "- veut une chanson", needs_human: false, reason: "" };
  });
  await router.handleIncoming({ channel: "fake", externalId: "u1", name: "Awa", text: "Bonsoir", externalMsgId: "a" });
  await router.handleIncoming({ channel: "fake", externalId: "u1", name: "Awa", text: "c'est combien ?", externalMsgId: "b" });
  await router.handleIncoming({ channel: "fake", externalId: "u1", name: "Awa", text: "c'est combien ?", externalMsgId: "b" }); // doublon
  await waitFor(() => sent.length === 2);
  assert.deepEqual(calls, [["Bonsoir", "c'est combien ?"]]);
  const c = db.upsertContact("fake", "u1");
  assert.equal(c.memory, "- veut une chanson");
  assert.deepEqual(db.listMessages(c.id).map((m) => m.author), ["client", "client", "agent", "agent"]);
});

test("quand le propriétaire répond lui-même : pause + apprentissage, et l'écho de l'agent est ignoré", async () => {
  router.setReplyGenerator(async () => ({ messages: [], memory: "", needs_human: false, reason: "" }));
  const c = db.upsertContact("fake", "u1");
  // Écho d'un message envoyé par l'agent : ne doit pas compter comme prise de main.
  router.handleOwnerMessage({ channel: "fake", externalId: "u1", text: "C'est 25 000", externalMsgId: "id-2" });
  assert.equal(db.getContact(c.id).paused_until, 0);

  await router.handleIncoming({ channel: "fake", externalId: "u1", text: "Vous livrez en combien de temps ?", externalMsgId: "c", noReply: false });
  router.handleOwnerMessage({ channel: "fake", externalId: "u1", text: "3 jours max ma sœur", externalMsgId: "own-1" });
  assert.ok(db.getContact(c.id).paused_until > Date.now());
  const ex = pickExamples("livrez combien temps");
  assert.equal(ex[0].owner_reply, "3 jours max ma sœur");
});

test("mode brouillon : la réponse attend ma validation, une correction devient un exemple", async () => {
  db.setSettings({ reply_mode: "draft" });
  router.setReplyGenerator(async () => ({ messages: ["Oui on fait les mariages"], memory: "", needs_human: true, reason: "prix mariage inconnu" }));
  await router.handleIncoming({ channel: "fake", externalId: "u2", name: "Moussa", text: "Vous faites les chansons de mariage ?", externalMsgId: "d" });
  const c = db.upsertContact("fake", "u2");
  await waitFor(() => db.listMessages(c.id).some((m) => m.status === "draft"));
  const before = sent.length;
  assert.equal(db.getContact(c.id).needs_human, 1);
  const draft = db.listMessages(c.id).find((m) => m.status === "draft");
  await router.approveDraft(draft.id, "Oui bien sûr ! Pour un mariage c'est 50 000");
  assert.equal(sent.length, before + 1);
  assert.equal(sent.at(-1), "Oui bien sûr ! Pour un mariage c'est 50 000");
  assert.ok(db.allExamples().some((e) => e.source === "correction"));
});
