import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nk-watch-"));
process.env.SUNO_POLL_MS = "5";
process.env.KIE_CREDIT_SETTLE_MS = "1";
const db = await import("../src/db.js");
const router = await import("../src/router.js");
const { runWatchdog, dailyReport } = await import("../src/watchdog.js");

const MIN = 60_000;
const waitFor = async (cond, ms = 8000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  assert.ok(cond());
};

// Faux Kie : paroles + Suno (qui peut être en panne).
let sunoDown = false;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("/chat/completions"))
    return Response.json({ choices: [{ message: { content: JSON.stringify({ title: "Pour Fatou", style: "afro pop", lyrics: "[Chorus]\nFatou" }) } }] });
  if (u.endsWith("/api/v1/generate"))
    return sunoDown ? Response.json({ code: 402, msg: "crédit insuffisant" }) : Response.json({ code: 200, data: { taskId: "s1" } });
  if (u.includes("/generate/record-info"))
    return Response.json({ code: 200, data: { status: "SUCCESS", response: { sunoData: [{ audioUrl: "https://cdn.x/f.mp3", title: "Pour Fatou" }, { audioUrl: "https://cdn.x/f.mp3", title: "Pour Fatou" }] } } });
  if (u === "https://cdn.x/f.mp3") return new Response(new Uint8Array([1]), { headers: { "content-type": "audio/mpeg" } });
  if (u.endsWith("/chat/credit")) return Response.json({ code: 200, data: 100 });
  throw new Error(`appel inattendu ${u}`);
};

const sent = [];
const audios = [];
const owner = [];
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
  lyrics_delay_max: 0,
  daily_report_enabled: false,
});
router.registerAdapter({
  channel: "fake4",
  send: async (c, t) => (sent.push({ to: c.external_id, t }), `m${sent.length}`),
  sendAudio: async (c) => (audios.push(c.external_id), `a${audios.length}`),
});
router.registerAdapter({ channel: "whatsapp", send: async () => "w", notifyOwner: async (t) => (owner.push(t), `n${owner.length}`) });
const reply = (o) => ({ messages: ["ok"], memory: "", needs_human: false, reason: "", ...o });
const idle = (id) => waitFor(() => !router.isBusy(id));

test("1. message resté sans réponse (erreur) : l'agent réessaie, puis te prévient", async () => {
  let fail = true;
  router.setReplyGenerator(async () => {
    if (fail) throw new Error("service indisponible");
    return reply({ messages: ["Bonjour Awa 😊"] });
  });
  await router.handleIncoming({ channel: "fake4", externalId: "a1", name: "Awa", text: "Bonsoir", externalMsgId: "1", createdAt: Date.now() - 10 * MIN });
  const c = db.upsertContact("fake4", "a1");
  await idle(c.id);
  for (let i = 0; i < 3; i++) {
    await runWatchdog();
    await idle(c.id);
  }
  assert.ok(owner.some((t) => /Problème détecté/.test(t) && /Awa/.test(t)));
  fail = false;
  await runWatchdog();
  await waitFor(() => sent.some((x) => x.t === "Bonjour Awa 😊"));
  await idle(c.id);
  await runWatchdog();
  assert.ok(owner.some((t) => /✅ Réglé/.test(t)));
});

test("2. paiement vérifié mais Suno en panne : la composition est relancée puis livrée", async () => {
  const c = db.upsertContact("fake4", "b1", "Fatou");
  db.saveOrder({ contact_id: c.id, stage: "acompte", price: 10000, paid: 10000, lyrics: "[Chorus] Fatou", lyrics_status: "validated" });
  sunoDown = true;
  await runWatchdog();
  assert.equal(db.activeOrder(c.id).lyrics_status, "validated"); // pas bloqué en « composing »
  sunoDown = false;
  await runWatchdog();
  await waitFor(() => audios.includes("b1"));
  assert.equal(db.listOrders({ contactId: c.id })[0].stage, "livree");
});

test("3. texte promis mais jamais écrit : l'agent l'écrit et te le signale", async () => {
  const c = db.upsertContact("fake4", "d1", "Ali");
  db.saveOrder({ contact_id: c.id, stage: "nouveau", occasion: "mariage" });
  db.addMessage(c.id, { author: "agent", text: "C'est noté 👌 Tu reçois ton texte d'ici 10 minutes", created_at: Date.now() - 20 * MIN });
  await runWatchdog();
  const o = db.activeOrder(c.id);
  assert.equal(o.lyrics_status, "proposed");
  assert.ok(sent.some((x) => x.to === "d1" && /Dis-moi si ce texte te plaît/.test(x.t)));
  assert.ok(owner.some((t) => /Corrigé automatiquement/.test(t) && /Ali/.test(t)));
});

test("4. chanson + vidéo lyrics : demande pour toi, l'agent ne lance rien", async () => {
  router.setReplyGenerator(async () =>
    reply({ messages: ["Pour la vidéo, c'est Nk qui s'en occupe personnellement 🙏"], special_request: "chanson + vidéo lyrics", song_step: "propose_lyrics" }),
  );
  await router.handleIncoming({ channel: "fake4", externalId: "e1", name: "Mariam", text: "Je veux une chanson avec une vidéo lyrics", externalMsgId: "4" });
  const c = db.upsertContact("fake4", "e1");
  await waitFor(() => db.activeOrder(c.id)?.special === "chanson + vidéo lyrics");
  await idle(c.id);
  assert.equal(db.activeOrder(c.id).lyrics_status, ""); // aucun texte lancé
  assert.ok(owner.some((t) => /Demande spéciale/.test(t) && /vidéo lyrics/.test(t)));
  assert.equal(db.getContact(c.id).needs_human, 1);
});

test("5. bilan du jour : chansons livrées et demandes spéciales", async () => {
  const r = dailyReport();
  assert.match(r.text, /Chansons composées et envoyées : 1/);
  assert.match(r.text, /Fatou/);
  assert.match(r.text, /À faire par toi/);
  assert.match(r.text, /Mariam/);
  db.setSettings({ daily_report_enabled: true, daily_report_hour: 0 });
  const before = owner.length;
  await runWatchdog();
  await runWatchdog();
  assert.equal(owner.filter((t) => /Bilan du/.test(t)).length, 1); // une seule fois par jour
  assert.ok(owner.length > before);
});

// ---------- Corrections après relecture ----------
let generations = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).endsWith("/api/v1/generate")) generations++;
  return realFetch(url, init);
};

test("6. envoi raté (WhatsApp coupé) : rien n'est recomposé, les 2 versions repartent telles quelles", async () => {
  let down = true;
  router.registerAdapter({
    channel: "fake6",
    send: async (c, t) => {
      if (down) throw new Error("WhatsApp n'est pas connecté");
      sent.push({ to: c.external_id, t });
      return `m${sent.length}`;
    },
    sendAudio: async (c) => {
      if (down) throw new Error("WhatsApp n'est pas connecté");
      audios.push(c.external_id);
      return "ok";
    },
  });
  db.setSettings({ song_auto_send: true });
  const c = db.upsertContact("fake6", "f1", "Issa");
  db.saveOrder({ contact_id: c.id, stage: "acompte", price: 5000, paid: 5000, lyrics: "[Chorus] Issa", lyrics_status: "validated" });
  const before = generations;
  await router.startComposition(c.id);
  await waitFor(() => db.listMessages(c.id).filter((m) => m.status === "pending").length === 3); // annonce + 2 versions
  assert.equal(db.activeOrder(c.id).lyrics_status, "composed");
  db.db.prepare("UPDATE messages SET created_at = ? WHERE contact_id = ?").run(Date.now() - 15 * MIN, c.id);
  for (let i = 0; i < 3; i++) await runWatchdog();
  assert.equal(generations, before + 1); // une seule création (2 versions), jamais refaite
  assert.ok(owner.some((t) => /n'ont pas pu partir/.test(t)));
  down = false;
  await router.flushOutbox();
  assert.equal(audios.filter((x) => x === "f1").length, 2);
  assert.ok(sent.some((x) => x.to === "f1" && /2 versions/.test(x.t)));
  assert.equal(generations, before + 1);
  await runWatchdog();
  assert.ok(owner.some((t) => /✅ Réglé/.test(t) && /Issa/.test(t)));
});

test("7. paiement confirmé sans prix noté, AVANT la validation du texte : la chanson part quand il valide", async () => {
  db.setSettings({ compose_requires_payment: true });
  const c = db.upsertContact("fake4", "g1", "Rasmané");
  db.saveOrder({ contact_id: c.id, stage: "devis", lyrics: "[Chorus] Rasmané", lyrics_status: "proposed", lyrics_version: 1 });
  await router.confirmPayment(c.id, { by: "test" });
  assert.equal(db.activeOrder(c.id).lyrics_status, "proposed"); // pas encore validé : rien n'est composé
  const before = generations;
  router.setReplyGenerator(async () => reply({ messages: ["Top !"], song_step: "client_validated" }));
  await router.handleIncoming({ channel: "fake4", externalId: "g1", text: "Oui c'est parfait", externalMsgId: "g1-1" });
  await waitFor(() => generations > before);
});

test("8. la file des textes ne l'envoie qu'une fois ; un envoi raté repart tel quel (sans réécrire le texte)", async () => {
  let fail = true;
  router.registerAdapter({
    channel: "fake7",
    send: async (c, t) => {
      if (fail) throw new Error("coupure");
      sent.push({ to: c.external_id, t });
      return "x";
    },
  });
  const c = db.upsertContact("fake7", "h1", "Bintou");
  const o = db.saveOrder({ contact_id: c.id, stage: "nouveau" });
  db.saveOrder({ id: o.id, lyrics_status: "writing", lyrics_due_at: Date.now() - 1000, lyrics_notes: "{}" });
  await Promise.all([router.runLyricsQueue(), router.runLyricsQueue()]);
  assert.equal(db.getOrder(o.id).lyrics_version, 1);
  assert.equal(db.getOrder(o.id).lyrics_status, "proposed");
  assert.equal(db.listMessages(c.id).filter((m) => m.status === "pending").length, 1);
  fail = false;
  await router.flushOutbox();
  assert.equal(db.getOrder(o.id).lyrics_version, 1); // même texte, l'IA n'a pas été repayée
  assert.equal(sent.filter((x) => x.to === "h1").length, 1);
});

test("9. ton ✅ dans la discussion d'un client qui n'a pas annoncé de paiement ne confirme rien", async () => {
  db.setSettings({ payment_confirm_emoji: "✅" });
  const c = db.upsertContact("whatsapp", "226700@s.whatsapp.net", "Koffi");
  db.saveOrder({ contact_id: c.id, stage: "devis", lyrics: "[Chorus] Koffi", lyrics_status: "validated" });
  const r = await router.handleOwnerReaction({ channel: "whatsapp", chatJid: "226700@s.whatsapp.net", targetId: "x", emoji: "✅", ownerChat: false });
  assert.equal(r, null);
  assert.equal(db.activeOrder(c.id).payment_confirmed_at, 0);
});
