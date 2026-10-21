import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nk-guards-"));
process.env.KIE_POLL_MS = "5";
process.env.KIE_CREDIT_SETTLE_MS = "1";
const db = await import("../src/db.js");
const router = await import("../src/router.js");
const { textToSpeech } = await import("../src/tts.js");

let lyricsCalls = 0;
let ttsTasks = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("/chat/completions")) {
    lyricsCalls++;
    return Response.json({ choices: [{ message: { content: JSON.stringify({ title: "T", style: "afro pop", lyrics: `[Chorus] v${lyricsCalls}` }) } }] });
  }
  if (u.endsWith("/jobs/createTask")) return (ttsTasks++, Response.json({ code: 200, data: { taskId: `t${ttsTasks}` } }));
  if (u.includes("/jobs/recordInfo")) return Response.json({ code: 200, data: { state: "success", resultJson: JSON.stringify({ resultUrls: ["https://cdn.x/v.mp3"] }) } });
  if (u === "https://cdn.x/v.mp3") return new Response(new Uint8Array([9]), { headers: { "content-type": "audio/mpeg" } });
  if (u.endsWith("/chat/credit")) return Response.json({ code: 200, data: 1000 });
  if (u.endsWith("/api/v1/generate")) throw new Error("Suno ne doit pas être appelé");
  throw new Error(`appel inattendu ${u}`);
};

const sent = [];
const owner = [];
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
  lyrics_delay_max: 0,
});
router.registerAdapter({ channel: "fake8", send: async (c, t) => (sent.push({ to: c.external_id, t }), `m${sent.length}`) });
router.registerAdapter({ channel: "whatsapp", send: async () => "w", notifyOwner: async (t) => (owner.push(t), `n${owner.length}`) });
const reply = (o) => ({ messages: ["ok"], memory: "", needs_human: false, reason: "", ...o });
const settle = async (cond) => {
  const end = Date.now() + 8000;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  assert.ok(cond());
};
let n = 0;
const say = async (id, text) => {
  await router.handleIncoming({ channel: "fake8", externalId: id, text, externalMsgId: `g${++n}` });
  const c = db.upsertContact("fake8", id);
  await settle(() => !router.isBusy(c.id));
  return c;
};

test("un seul texte : l'agent ne renvoie pas un 2e texte si le client n'a pas demandé de correction", async () => {
  router.setReplyGenerator(async () => reply({ song_step: "propose_lyrics" }));
  const c = await say("a", "C'est tout");
  assert.equal(db.activeOrder(c.id).lyrics_version, 1);
  await say("a", "Merci !");
  assert.equal(db.activeOrder(c.id).lyrics_version, 1);
  assert.equal(sent.filter((x) => x.to === "a" && /Dis-moi si ce texte/.test(x.t)).length, 1);
});

test("corrections : le texte corrigé est renvoyé, puis au-delà de la limite c'est toi qui prends la main", async () => {
  db.setSettings({ max_lyrics_versions: 3 });
  router.setReplyGenerator(async () => reply({ song_step: "revise_lyrics", revision_notes: "change le refrain" }));
  const c = db.upsertContact("fake8", "a");
  await say("a", "Change le refrain");
  await say("a", "Encore une fois");
  assert.equal(db.activeOrder(c.id).lyrics_version, 3);
  const calls = lyricsCalls;
  await say("a", "Et encore");
  assert.equal(lyricsCalls, calls); // pas de nouveau texte payé
  assert.equal(db.activeOrder(c.id).lyrics_version, 3);
  assert.ok(owner.some((t) => /encore des corrections/.test(t)));
});

test("protection contre les rafales : au-delà de N réponses par heure, l'agent se tait et te prévient", async () => {
  db.setSettings({ max_replies_per_hour: 2 });
  router.setReplyGenerator(async () => reply({ messages: ["Salut"] }));
  for (let i = 0; i < 4; i++) await say("b", `spam ${i}`);
  const c = db.upsertContact("fake8", "b");
  assert.equal(sent.filter((x) => x.to === "b").length, 2);
  assert.match(db.getContact(c.id).needs_human_reason, /pause avec lui/);
  assert.ok(owner.some((t) => /pause avec lui/.test(t)));
  db.setSettings({ max_replies_per_hour: 30 });
});

test("plafond de crédits du jour : pas de composition, pas de vocal", async () => {
  db.logCredits({ kind: "song", credits: 60 });
  db.setSettings({ daily_credit_limit: 50 });
  const c = db.upsertContact("fake8", "d");
  db.saveOrder({ contact_id: c.id, stage: "acompte", paid: 1, lyrics: "x", lyrics_status: "validated" });
  await assert.rejects(router.startComposition(c.id), /Plafond de crédits/);
  assert.equal(db.activeOrder(c.id).lyrics_status, "validated");
  db.setSettings({ daily_credit_limit: 0 });
});

test("vocaux : la même phrase avec la même voix n'est payée qu'une fois", async () => {
  const before = ttsTasks;
  const a = await textToSpeech("Paiement bien reçu, merci 🙏");
  const b = await textToSpeech("Paiement bien reçu, merci 🙏");
  assert.equal(ttsTasks, before + 1);
  assert.equal(a.path, b.path);
  await textToSpeech("Autre phrase");
  assert.equal(ttsTasks, before + 2);
});

test("profil d'écriture : si Kie a un souci passager, l'agent réessaie avec moins d'échanges", async () => {
  const { buildStyleProfile } = await import("../src/agent.js");
  db.addExamples([{ client_text: "Bonjour", owner_reply: "Salut 😊 ça va ?" }], "import");
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/chat/completions")) {
      calls++;
      if (calls === 1) return Response.json({ code: 500, msg: "Server exception, please try again later" });
      return Response.json({ choices: [{ message: { content: JSON.stringify({ style_profile: "Chaleureux, tutoie", business_facts: [] }) } }] });
    }
    return real(url, init);
  };
  try {
    const r = await buildStyleProfile("Nk");
    assert.equal(r.style_profile, "Chaleureux, tutoie");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = real;
  }
});
