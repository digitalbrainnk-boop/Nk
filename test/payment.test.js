import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nk-pay-"));
process.env.SUNO_POLL_MS = "5";
process.env.KIE_CREDIT_SETTLE_MS = "1";
const db = await import("../src/db.js");
const router = await import("../src/router.js");
const agent = await import("../src/agent.js");

let capture = null;
const prompts = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("/chat/completions")) {
    const body = JSON.parse(init.body);
    const user = body.messages.at(-1);
    if (Array.isArray(user.content)) return Response.json({ choices: [{ message: { content: JSON.stringify(capture) } }] }); // lecture de la capture
    prompts.push(body.messages.map((m) => m.content).join("\n"));
    return Response.json({ choices: [{ message: { content: JSON.stringify({ title: "Pour Awa", style: "afro pop, female vocals", style_label: "Afro pop dansant, voix féminine", lyrics: "[Chorus] Awa" }) } }] });
  }
  if (u.endsWith("/api/v1/generate")) return Response.json({ code: 200, data: { taskId: "s1" } });
  if (u.includes("/generate/record-info"))
    return Response.json({ code: 200, data: { status: "SUCCESS", response: { sunoData: [{ audioUrl: "https://cdn.x/a.mp3" }, { audioUrl: "https://cdn.x/a.mp3" }] } } });
  if (u === "https://cdn.x/a.mp3") return new Response(new Uint8Array([1]), { headers: { "content-type": "audio/mpeg" } });
  if (u.endsWith("/chat/credit")) return Response.json({ code: 200, data: 100 });
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
  welcome_enabled: false,
  lyrics_delay_max: 0,
});
db.saveKnowledge({ title: "Moyens de paiement", content: "Orange Money : +22675541016\nMoov Money : +22672830194" });
router.registerAdapter({ channel: "fake10", send: async (c, t) => (sent.push(t), `m${sent.length}`), sendAudio: async () => "a" });
router.registerAdapter({ channel: "whatsapp", send: async () => "w", notifyOwner: async (t, o) => (owner.push({ t, ...o }), `n${owner.length}`) });
const reply = (o) => ({ messages: ["Merci, nous vérifions le paiement 🙏"], memory: "", needs_human: false, reason: "", ...o });
const settle = async (cond) => {
  const end = Date.now() + 8000;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  assert.ok(cond());
};

test("paiement sans capture : tu reçois le numéro du client, le numéro utilisé et le montant", async () => {
  const c = db.upsertContact("fake10", "22670111222@s.whatsapp.net", "Awa", { phone: "22670111222" });
  db.saveOrder({ contact_id: c.id, stage: "devis", price: 1200, lyrics: "x", lyrics_status: "validated" });
  router.setReplyGenerator(async () =>
    reply({ song_step: "payment_claimed", payment_info: { payer_number: "+22670999888", amount: "1 200 F", method: "Orange Money" } }),
  );
  await router.handleIncoming({ channel: "fake10", externalId: "22670111222@s.whatsapp.net", text: "J'ai payé avec le 70999888", externalMsgId: "1" });
  await settle(() => owner.length === 1);
  const t = owner[0].t;
  assert.match(t, /^🤖 \*TON AGENT\*/); // reconnaissable
  assert.match(t, /PAIEMENT ANNONCÉ/);
  assert.match(t, /Client : Awa \(\+22670111222\)/);
  assert.match(t, /Numéro utilisé pour payer : \+22670999888/);
  assert.match(t, /Montant : 1 200 F \(prix annoncé : 1200 FCFA\)/);
  assert.match(t, /Orange Money/);
});

test("paiement avec capture : la capture t'est transférée avec ce qu'on y lit ; un faux bénéficiaire est signalé", async () => {
  const c = db.upsertContact("fake10", "22670333444@s.whatsapp.net", "Ali", { phone: "22670333444" });
  db.saveOrder({ contact_id: c.id, stage: "devis", price: 1200, lyrics: "x", lyrics_status: "validated" });
  const img = path.join(process.env.DATA_DIR, "media", "cap.jpg");
  fs.writeFileSync(img, "jpg");
  capture = {
    is_payment: true,
    payer_number: "70333444",
    recipient_number: "+22677000000",
    amount: "1200 FCFA",
    reference: "PP231022.1234",
    text: "Transfert de 1200 FCFA vers 77000000 réussi",
  };
  router.setReplyGenerator(async () => reply({ song_step: "payment_claimed" }));
  await router.handleIncoming({ channel: "fake10", externalId: "22670333444@s.whatsapp.net", kind: "image", media: { path: img, mime: "image/jpeg" }, text: "", externalMsgId: "2" });
  await settle(() => owner.length === 2);
  const n = owner[1];
  assert.equal(n.imagePath, img);
  assert.match(n.t, /Lu sur la capture/);
  assert.match(n.t, /PP231022\.1234/);
  assert.match(n.t, /capture suspecte/); // 77000000 n'est pas un de tes numéros
});

test("texte : le style choisi est écrit en haut ; voix et style demandés ; Suno jamais mentionné", async () => {
  const c = db.upsertContact("fake10", "s1", "Mariam");
  router.setReplyGenerator(async () => reply({ messages: ["C'est noté"], song_step: "propose_lyrics" }));
  await router.handleIncoming({ channel: "fake10", externalId: "s1", text: "Oui c'est tout", externalMsgId: "3" });
  await settle(() => db.activeOrder(c.id)?.lyrics_status === "proposed");
  assert.match(sent.at(-1), /^🎵 Pour Awa\nStyle : Afro pop dansant, voix féminine\n\n\[Chorus\] Awa/);
  await agent.generateReply(db.getContact(c.id)).catch(() => {});
  const p = prompts.at(-1);
  assert.match(p, /voix masculine, voix féminine ou duo/);
  assert.match(p, /doux \(acoustique\) ou dansant/);
  assert.match(p, /Ne mentionne JAMAIS les outils utilisés \(Suno/);
});

test("après la livraison : « Merci pour votre confiance »", async () => {
  const c = db.upsertContact("fake10", "d1", "Issa");
  db.saveOrder({ contact_id: c.id, stage: "acompte", paid: 1200, lyrics: "[Chorus] Issa", lyrics_status: "validated" });
  db.setSettings({ song_auto_send: true });
  await router.startComposition(c.id);
  await settle(() => sent.at(-1) === "Merci pour votre confiance 🙏");
  assert.ok(sent.some((t) => /Voici votre chanson en 2 versions/.test(t)));
});
