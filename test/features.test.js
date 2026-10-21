import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nk-feat-"));
process.env.KIE_POLL_MS = "5";
process.env.SUNO_POLL_MS = "5";
const db = await import("../src/db.js");
const router = await import("../src/router.js");

const sent = [];
const audios = [];
const realFetch = globalThis.fetch;
let kieCalls = [];

before(() => {
  db.setSettings({
    reply_mode: "auto",
    debounce_seconds: 0,
    open_hour: 0, // ouvert 24 h/24 pendant les tests
    close_hour: 0,
    min_reply_delay_seconds: 0,
    max_reply_delay_seconds: 0,
    typing_chars_per_second: 1000,
    kie_api_key: "kie-test",
  });
  router.registerAdapter({
    channel: "fake",
    send: async (c, text) => (sent.push(text), `t-${sent.length}`),
    sendAudio: async (c, a) => (audios.push(a), `a-${audios.length}`),
  });
  // Faux Kie.ai : voix (jobs) et Suno.
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    kieCalls.push({ url: u, body: init.body && typeof init.body === "string" ? JSON.parse(init.body) : null });
    if (u.endsWith("/api/v1/jobs/createTask")) return Response.json({ code: 200, data: { taskId: "tts1" } });
    if (u.includes("/api/v1/jobs/recordInfo"))
      return Response.json({ code: 200, data: { state: "success", resultJson: JSON.stringify({ resultUrls: ["https://cdn.example/v.mp3"] }) } });
    if (u.endsWith("/api/v1/generate")) return Response.json({ code: 200, data: { taskId: "s1" } });
    if (u.includes("/generate/record-info"))
      return Response.json({ code: 200, data: { status: "SUCCESS", response: { sunoData: [{ audioUrl: "https://cdn.example/s.mp3", title: "Démo" }] } } });
    if (u.startsWith("https://cdn.example/")) return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } });
    return realFetch(url, init);
  };
});
after(() => {
  globalThis.fetch = realFetch;
});

const waitFor = async (cond, ms = 10000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  assert.ok(cond());
};
const reply = (o) => ({ messages: [], memory: "", needs_human: false, reason: "", ...o });

test("l'agent remplit la commande (sans jamais toucher au paiement)", async () => {
  router.setReplyGenerator(async () =>
    reply({ messages: ["C'est 25 000 pour une chanson perso 🙏"], order: { stage: "devis", occasion: "anniversaire", price: 25000, title: null, due_date: "samedi" } }),
  );
  await router.handleIncoming({ channel: "fake", externalId: "o1", name: "Awa", text: "c'est combien ?", externalMsgId: "m1" });
  const c = db.upsertContact("fake", "o1");
  await waitFor(() => db.activeOrder(c.id)?.stage === "devis");
  const o = db.activeOrder(c.id);
  assert.equal(o.price, 25000);
  assert.equal(o.occasion, "anniversaire");
  assert.equal(o.paid, 0);
  // Le propriétaire confirme l'acompte : l'agent ne peut plus faire reculer l'étape.
  db.saveOrder({ id: o.id, stage: "acompte", paid: 12500 });
  router.setReplyGenerator(async () => reply({ messages: ["Top !"], order: { stage: "devis", price: null, occasion: null, title: null, due_date: null } }));
  await router.handleIncoming({ channel: "fake", externalId: "o1", text: "merci", externalMsgId: "m2" });
  await waitFor(() => sent.includes("Top !"));
  assert.equal(db.activeOrder(c.id).stage, "acompte");
});

test("relance d'un client silencieux, une seule fois par période", async () => {
  db.setSettings({ followup_enabled: true, followup_hours: 1, followup_max: 2 });
  const c = db.upsertContact("fake", "f1", "Moussa");
  const old = Date.now() - 3 * 3600_000;
  db.addMessage(c.id, { author: "client", text: "je réfléchis", status: "received", created_at: old - 1000 });
  db.markAnswered(c.id);
  db.addMessage(c.id, { author: "agent", text: "D'accord, prends ton temps", created_at: old });
  db.saveOrder({ contact_id: c.id, stage: "devis", price: 25000 });
  let asked = null;
  router.setReplyGenerator(async (contact, opts) => ((asked = opts), reply({ messages: ["Coucou Moussa, tu as pu réfléchir ? 😊"] })));
  assert.equal(await router.runFollowups(), 1);
  assert.equal(asked.followup, true);
  assert.equal(sent.at(-1), "Coucou Moussa, tu as pu réfléchir ? 😊");
  assert.equal(db.getContact(c.id).followups, 1);
  // Juste après : rien (la dernière activité est trop récente).
  assert.equal(await router.runFollowups(), 0);
});

test("réponse en vocal quand le client envoie un vocal (mode miroir)", async () => {
  db.setSettings({ voice_replies: "mirror", tts_voice: "Brian" });
  kieCalls = [];
  router.setReplyGenerator(async () => reply({ messages: ["Bonsoir !", "Oui je fais ça."] }));
  await router.handleIncoming({ channel: "fake", externalId: "v1", kind: "audio", text: "", externalMsgId: "va" });
  const c = db.upsertContact("fake", "v1");
  await waitFor(() => db.listMessages(c.id).some((m) => m.kind === "voice" && m.status === "sent"));
  const tts = kieCalls.find((k) => k.url.endsWith("/jobs/createTask"));
  assert.equal(tts.body.model, "elevenlabs/text-to-speech-multilingual-v2");
  assert.equal(tts.body.input.text, "Bonsoir ! Oui je fais ça.");
  assert.equal(tts.body.input.voice, "Brian");
  assert.equal(audios.at(-1).voice, true);
  db.setSettings({ voice_replies: "off" });
});

test("démo automatique : brouillon audio à valider, une seule fois", async () => {
  db.setSettings({ auto_demo: true, brain: "kie", reply_mode: "draft" });
  // songBrief passe par le cerveau Kie (chat) : on simule sa réponse.
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/chat/completions")) {
      return Response.json({ choices: [{ message: { content: '{"title":"Pour Awa","style":"afro pop","lyrics":"[Chorus] Awa"}' } }] });
    }
    return prevFetch(url, init);
  };
  try {
    router.setReplyGenerator(async () => reply({ messages: ["Je te prépare un petit extrait 😉"], demo: true }));
    await router.handleIncoming({ channel: "fake", externalId: "d1", name: "Awa", text: "je sais pas trop...", externalMsgId: "d" });
    const c = db.upsertContact("fake", "d1");
    await waitFor(() => db.listMessages(c.id).some((m) => m.kind === "audio" && m.status === "draft"));
    const song = db.listMessages(c.id).find((m) => m.kind === "audio");
    assert.match(song.text, /Démo/);
    assert.ok(db.getContact(c.id).demo_at > 0);
    assert.equal(db.getContact(c.id).needs_human, 1);
  } finally {
    globalThis.fetch = prevFetch;
    db.setSettings({ auto_demo: false, brain: "claude", reply_mode: "auto" });
  }
});

test("chiffres des ventes", () => {
  const st = db.salesStats();
  assert.ok(st.clients >= 4);
  assert.equal(st.paid_total, 12500);
  assert.equal(st.by_stage.acompte, 1);
  assert.equal(st.weeks.length, 8);
});
