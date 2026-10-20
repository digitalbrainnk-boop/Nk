import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nk-song-"));
process.env.SUNO_POLL_MS = "5";
process.env.KIE_CREDIT_SETTLE_MS = "1";
const db = await import("../src/db.js");
const router = await import("../src/router.js");

const waitFor = async (cond, ms = 8000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  assert.ok(cond());
};

// Faux Kie : cerveau (paroles) + Suno.
const prompts = [];
const sunoBodies = [];
let version = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("/chat/completions")) {
    const body = JSON.parse(init.body);
    prompts.push(body.messages.map((m) => m.content).join("\n"));
    version++;
    const lyrics = `[Chorus]\nJoyeux anniversaire Ibrahim (v${version})`;
    return Response.json({ choices: [{ message: { content: JSON.stringify({ title: "Pour Ibrahim", style: "zouglou, festif", lyrics }) } }] });
  }
  if (u.endsWith("/api/v1/generate")) {
    sunoBodies.push(JSON.parse(init.body));
    return Response.json({ code: 200, data: { taskId: "s1" } });
  }
  if (u.includes("/generate/record-info"))
    return Response.json({ code: 200, data: { status: "SUCCESS", response: { sunoData: [{ audioUrl: "https://cdn.x/song.mp3", title: "Pour Ibrahim" }] } } });
  if (u === "https://cdn.x/song.mp3") return new Response(new Uint8Array([1, 2]), { headers: { "content-type": "audio/mpeg" } });
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
  song_flow: true,
  compose_requires_payment: false,
});
router.registerAdapter({
  channel: "fake3",
  send: async (c, t) => (sent.push(t), `m${sent.length}`),
  sendAudio: async () => "a1",
});
const reply = (o) => ({ messages: [], memory: "- anniversaire Ibrahim", needs_human: false, reason: "", ...o });
const contact = () => db.upsertContact("fake3", "c1");

test("1. assez d'infos : le texte est écrit et envoyé au client pour validation", async () => {
  router.setReplyGenerator(async () => reply({ messages: ["Je t'envoie une proposition de texte 😊"], song_step: "propose_lyrics" }));
  await router.handleIncoming({ channel: "fake3", externalId: "c1", name: "Awa", text: "C'est pour les 30 ans de mon mari Ibrahim, il adore le zouglou", externalMsgId: "1" });
  await waitFor(() => db.activeOrder(contact().id)?.lyrics_status === "proposed" && sent.length >= 2);
  const o = db.activeOrder(contact().id);
  assert.equal(o.lyrics_version, 1);
  assert.equal(o.song_style, "zouglou, festif");
  assert.match(sent.at(-1), /Joyeux anniversaire Ibrahim \(v1\)/);
  assert.match(sent.at(-1), /Dis-moi si ce texte te plaît/);
});

test("2. le client demande un changement : nouvelle version à partir de la précédente", async () => {
  router.setReplyGenerator(async () => reply({ messages: ["D'accord je corrige 👌"], song_step: "revise_lyrics", revision_notes: "ajoute le prénom de leur fille Mariam" }));
  await router.handleIncoming({ channel: "fake3", externalId: "c1", text: "Tu peux ajouter notre fille Mariam ?", externalMsgId: "2" });
  await waitFor(() => db.activeOrder(contact().id)?.lyrics_version === 2);
  assert.match(prompts.at(-1), /Version précédente du texte/);
  assert.match(prompts.at(-1), /Mariam/);
  assert.match(sent.at(-1), /version corrigée/);
});

test("3. le client valide : Suno compose avec le texte validé, chanson prête à écouter", async () => {
  router.setReplyGenerator(async () => reply({ messages: ["Super ! Je lance la composition 🎶"], song_step: "client_validated" }));
  await router.handleIncoming({ channel: "fake3", externalId: "c1", text: "Oui c'est parfait !", externalMsgId: "3" });
  await waitFor(() => db.activeOrder(contact().id)?.lyrics_status === "composed");
  assert.equal(sunoBodies.length, 1);
  assert.match(sunoBodies[0].prompt, /\(v2\)/); // la version validée
  assert.equal(sunoBodies[0].style, "zouglou, festif");
  const song = db.listMessages(contact().id).find((m) => m.kind === "audio");
  assert.equal(song.status, "draft"); // tu l'écoutes avant de l'envoyer
  assert.equal(db.getContact(contact().id).needs_human, 1);
  assert.equal(db.activeOrder(contact().id).stage, "creation");
});

test("4. paiement exigé : validation mise en attente, rien n'est composé", async () => {
  db.setSettings({ compose_requires_payment: true });
  const c = db.upsertContact("fake3", "c2", "Moussa");
  const o = db.saveOrder({ contact_id: c.id, stage: "devis", lyrics: "[Chorus] Moussa", lyrics_status: "proposed", lyrics_version: 1 });
  router.setReplyGenerator(async () => reply({ messages: ["Top, je lance dès réception de l'acompte 🙏"], song_step: "client_validated" }));
  const before = sunoBodies.length;
  await router.handleIncoming({ channel: "fake3", externalId: "c2", text: "Oui ça me va", externalMsgId: "4" });
  await waitFor(() => db.getOrder(o.id).lyrics_status === "validated");
  assert.equal(sunoBodies.length, before);
  assert.match(db.getContact(c.id).needs_human_reason, /paiement/);
});
