import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nk-extra-"));
process.env.KIE_CREDIT_SETTLE_MS = "1";
process.env.KIE_POLL_MS = "1";
const db = await import("../src/db.js");
const router = await import("../src/router.js");

const waitFor = async (cond, ms = 5000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  assert.ok(cond());
};

test("numéros ignorés : avec ou sans indicatif, et @pseudo Telegram", () => {
  const wa = { external_id: "22670123456@s.whatsapp.net", meta: {} };
  const lid = { external_id: "1234567890123@lid", meta: { phone: "22670123456" } };
  const tg = { external_id: "998877", name: "Moussa", meta: { username: "monpote" } };
  assert.equal(db.isIgnored(wa, ["70123456"]), true); // sans indicatif
  assert.equal(db.isIgnored(wa, ["+226 70 12 34 56"]), true);
  assert.equal(db.isIgnored(lid, ["22670123456"]), true); // WhatsApp LID : on regarde le vrai numéro
  assert.equal(db.isIgnored(tg, ["@monpote"]), true);
  assert.equal(db.isIgnored(wa, ["22566554433"]), false);
  assert.equal(db.contactKey(lid), "22670123456");
});

test("l'agent ne répond jamais à un numéro ignoré (mais garde le message)", async () => {
  const sent = [];
  db.setSettings({ reply_mode: "auto", debounce_seconds: 0, open_hour: 0, close_hour: 0, min_reply_delay_seconds: 0, max_reply_delay_seconds: 0, ignored_contacts: ["22670000001"] });
  router.registerAdapter({ channel: "fake2", send: async (c, t) => (sent.push(t), "x") });
  let called = 0;
  router.setReplyGenerator(async () => (called++, { messages: ["Bonjour"], memory: "", needs_human: false, reason: "" }));
  await router.handleIncoming({ channel: "fake2", externalId: "22670000001@s.whatsapp.net", text: "Salut", externalMsgId: "i1" });
  await new Promise((r) => setTimeout(r, 300));
  const c = db.upsertContact("fake2", "22670000001@s.whatsapp.net");
  assert.equal(called, 0);
  assert.equal(sent.length, 0);
  assert.equal(db.listMessages(c.id).length, 1);
  // Retiré de la liste : il répond de nouveau.
  db.setSettings({ ignored_contacts: [] });
  await router.handleIncoming({ channel: "fake2", externalId: "22670000001@s.whatsapp.net", text: "Tu es là ?", externalMsgId: "i2" });
  await waitFor(() => sent.length === 1);
});

test("crédits Kie : la différence de solde est notée pour la conversation", async () => {
  db.setSettings({ brain: "kie", kie_api_key: "k" });
  let balance = 100;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/api/v1/chat/credit")) return Response.json({ code: 200, msg: "success", data: balance });
    return realFetch(url);
  };
  try {
    const { withCredits } = await import("../src/credits.js");
    const c = db.upsertContact("test", "cr", "Awa");
    const r = await withCredits({ contactId: c.id, kind: "reply" }, async () => {
      balance -= 0.8; // la réponse coûte 0,8 crédit
      return "ok";
    });
    assert.equal(r, "ok");
    await waitFor(() => db.getContact(c.id).credits_used > 0);
    assert.equal(db.getContact(c.id).credits_used, 0.8);
    const st = db.creditStats();
    assert.equal(st.month, 0.8);
    assert.equal(st.per_reply, 0.8);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("vocal transcrit avec Kie : modèle trouvé dans la doc, fichier envoyé, texte lu", async () => {
  db.setSettings({ kie_api_key: "k", kie_stt: null, transcription_api_key: "" });
  const audio = path.join(process.env.DATA_DIR, "v.ogg");
  fs.writeFileSync(audio, Buffer.from([1, 2, 3]));
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push(u);
    if (u === "https://docs.kie.ai/llms.txt")
      return new Response("- Audio Models > ElevenLabs [Speech to Text](https://docs.kie.ai/market/elevenlabs/speech-to-text.md): transcription\n");
    if (u.endsWith("speech-to-text.md"))
      return new Response('{"model": "elevenlabs/speech-to-text", "input": {"audio_url": "https://..."}}');
    if (u.includes("file-stream-upload")) return Response.json({ success: true, data: { downloadUrl: "https://files.kie/v.ogg" } });
    if (u.endsWith("/jobs/createTask")) {
      const b = JSON.parse(init.body);
      assert.equal(b.model, "elevenlabs/speech-to-text");
      assert.equal(b.input.audio_url, "https://files.kie/v.ogg");
      return Response.json({ code: 200, data: { taskId: "t" } });
    }
    if (u.includes("/jobs/recordInfo"))
      return Response.json({ code: 200, data: { state: "success", resultJson: JSON.stringify({ resultObject: { text: "Bonjour, je veux une chanson" } }) } });
    if (u.endsWith("/chat/credit")) return Response.json({ code: 200, data: 50 });
    return realFetch(url, init);
  };
  try {
    const { transcribe } = await import("../src/media.js");
    assert.equal(await transcribe(audio, "audio/ogg"), "Bonjour, je veux une chanson");
    assert.equal(db.getSettings().kie_stt.model, "elevenlabs/speech-to-text"); // mémorisé
  } finally {
    globalThis.fetch = realFetch;
  }
});
