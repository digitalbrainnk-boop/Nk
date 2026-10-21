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
const audios = [];
const ownerNotes = [];
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
  song_flow: true,
  compose_requires_payment: false,
  song_auto_send: false,
  lyrics_delay_min: 0,
  lyrics_delay_max: 0,
  payment_confirm_emoji: "👍",
});
router.registerAdapter({
  channel: "fake3",
  send: async (c, t) => (sent.push(t), `m${sent.length}`),
  sendAudio: async (c, a) => (audios.push({ to: c.external_id, ...a }), `a${audios.length}`),
});
// Ton WhatsApp : l'agent t'y laisse ses messages (paiements, questions).
router.registerAdapter({
  channel: "whatsapp",
  send: async () => "w0",
  notifyOwner: async (text, opts) => (ownerNotes.push({ text, ...opts }), `note${ownerNotes.length}`),
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

test("3. le client valide : Suno compose le texte validé en 2 versions (rythmée + acoustique)", async () => {
  router.setReplyGenerator(async () => reply({ messages: ["Super ! Je lance la composition 🎶"], song_step: "client_validated" }));
  await router.handleIncoming({ channel: "fake3", externalId: "c1", text: "Oui c'est parfait !", externalMsgId: "3" });
  await waitFor(() => db.activeOrder(contact().id)?.lyrics_status === "composed");
  assert.equal(sunoBodies.length, 2); // une version rythmée + une version acoustique
  assert.match(sunoBodies[0].prompt, /\(v2\)/); // la version validée
  assert.match(sunoBodies[1].prompt, /\(v2\)/);
  assert.match(sunoBodies[0].style, /^zouglou, festif, upbeat/);
  assert.match(sunoBodies[1].style, /acoustic/);
  const songs = db.listMessages(contact().id).filter((m) => m.kind === "audio" && m.status === "draft");
  assert.equal(songs.length, 2); // envoi automatique désactivé : tu les écoutes avant
  assert.match(songs[0].text, /version rythmée/);
  assert.match(songs[1].text, /version acoustique/);
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
});

let payNote = "";
test("5. le client dit avoir payé : rien n'est composé, tu es prévenu sur WhatsApp avec la capture", async () => {
  const c = db.upsertContact("fake3", "c2");
  router.setReplyGenerator(async () => reply({ messages: ["Merci ! Je vérifie et je t'envoie ta chanson 🙏"], song_step: "payment_claimed" }));
  const before = sunoBodies.length;
  const notesBefore = ownerNotes.length;
  const img = path.join(process.env.DATA_DIR, "capture.jpg");
  fs.writeFileSync(img, "jpg");
  await router.handleIncoming({ channel: "fake3", externalId: "c2", kind: "image", media: { path: img, mime: "image/jpeg" }, text: "[capture]", externalMsgId: "5" });
  await waitFor(() => ownerNotes.length > notesBefore);
  payNote = `note${ownerNotes.length}`;
  const o = db.activeOrder(c.id);
  assert.equal(o.lyrics_status, "payment_claimed");
  assert.equal(o.paid, 0); // l'agent ne marque jamais un paiement
  assert.match(ownerNotes.at(-1).text, /dit avoir payé/);
  assert.match(ownerNotes.at(-1).text, /👍/);
  assert.equal(ownerNotes.at(-1).imagePath, img); // la capture t'est transférée
  assert.equal(sunoBodies.length, before);
  assert.equal(db.getContact(c.id).needs_human, 1);
});

test("6. réaction d'un autre emoji, ou sur un autre message : rien ne se passe", async () => {
  const c = db.upsertContact("fake3", "c2");
  assert.equal(await router.handleOwnerReaction({ channel: "whatsapp", chatJid: "x", targetId: payNote, emoji: "❤️", ownerChat: true }), null);
  assert.equal(await router.handleOwnerReaction({ channel: "whatsapp", chatJid: "x", targetId: "inconnu", emoji: "👍", ownerChat: true }), null);
  assert.equal(db.activeOrder(c.id).lyrics_status, "payment_claimed");
});

test("7. TA réaction 👍 sur le message de l'agent : composition puis livraison au client", async () => {
  const c = db.upsertContact("fake3", "c2");
  db.setSettings({ song_auto_send: true });
  const before = sunoBodies.length;
  const done = await router.handleOwnerReaction({ channel: "whatsapp", chatJid: "moi", targetId: payNote, emoji: "👍🏽", ownerChat: true });
  assert.ok(done);
  assert.equal(sunoBodies.length, before + 2);
  assert.match(sunoBodies.at(-1).prompt, /Moussa/);
  await waitFor(() => audios.filter((a) => a.to === "c2").length === 2); // les 2 versions
  assert.ok(sent.some((t) => /Paiement bien reçu/.test(t)));
  const o = db.activeOrder(c.id) || db.listOrders({ contactId: c.id })[0];
  assert.equal(o.stage, "livree");
  assert.ok(o.paid >= 0);
});

test("8. texte envoyé avec un délai « humain » (12 min max)", async () => {
  db.setSettings({ lyrics_delay_min: 5, lyrics_delay_max: 5 });
  const c = db.upsertContact("fake3", "c3", "Ali");
  router.setReplyGenerator(async () => reply({ messages: ["C'est noté, je t'envoie le texte d'ici 10 minutes 👌"], song_step: "propose_lyrics" }));
  await router.handleIncoming({ channel: "fake3", externalId: "c3", text: "Oui c'est tout", externalMsgId: "8" });
  await waitFor(() => db.activeOrder(c.id)?.lyrics_status === "writing");
  const o = db.activeOrder(c.id);
  assert.ok(o.lyrics_due_at > Date.now() + 4 * 60_000 && o.lyrics_due_at <= Date.now() + 5 * 60_000);
  assert.equal(await router.runLyricsQueue(Date.now()), 0); // pas encore l'heure
  assert.equal(await router.runLyricsQueue(Date.now() + 6 * 60_000), 1);
  assert.equal(db.activeOrder(c.id).lyrics_status, "proposed");
  assert.match(sent.at(-1), /Dis-moi si ce texte te plaît/);
});
