// Médias, réponses, réactions et suppression, avec un faux socket WhatsApp.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../src/app.js";
import { hasFfmpeg } from "../src/whatsapp/media.js";
import { SessionManager } from "../src/whatsapp/SessionManager.js";
import { rawMessage, silentLogger, tempConfig } from "./helpers.js";

const config = tempConfig();
const manager = new SessionManager({ config, logger: silentLogger });
const { server, io } = createApp({ config, manager, logger: silentLogger });
let base;
const sent = [];

/** Faux socket : enregistre ce qui est envoyé et renvoie un message au format Baileys. */
function fakeSocket() {
  let n = 0;
  const typeOf = (content) => ["image", "video", "audio", "document"].find((k) => content[k]);
  return {
    user: { id: "33600000001:3@s.whatsapp.net" },
    onWhatsApp: async (jid) => [{ jid, exists: true }],
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
      const key = { remoteJid: jid, id: `SENT${++n}`, fromMe: true };
      const kind = typeOf(content);
      let message;
      if (content.text) message = { extendedTextMessage: { text: content.text, contextInfo: options?.quoted ? { stanzaId: options.quoted.key.id, participant: options.quoted.key.participant || options.quoted.key.remoteJid, quotedMessage: options.quoted.message } : undefined } };
      else if (kind) message = { [`${kind}Message`]: { mimetype: content.mimetype, caption: content.caption, fileName: content.fileName, ptt: content.ptt, url: "https://mmg.whatsapp.net/x", directPath: "/x", mediaKey: Buffer.alloc(32, 1), fileLength: 3 } };
      else if (content.react) message = { reactionMessage: { key: content.react.key, text: content.react.text } };
      else message = { protocolMessage: { type: 0, key: content.delete } };
      return { key, message, messageTimestamp: Math.floor(Date.now() / 1000), status: 1 };
    },
  };
}

const auth = { Authorization: `Bearer ${config.apiToken}` };
async function upload(sessionId, fields, file) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append("file", new Blob([file.data], { type: file.type }), file.name);
  const res = await fetch(`${base}/api/sessions/${sessionId}/messages/media`, { method: "POST", headers: auth, body: form });
  return { status: res.status, body: await res.json() };
}
const json = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, { method, headers: { ...auth, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};

before(async () => {
  await manager.init();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const label of ["Ligne A", "Ligne B"]) {
    const s = await manager.create({ label, start: false });
    s.sock = fakeSocket();
    s.me = { id: "33600000001@s.whatsapp.net", phone: "33600000001" };
    s.setState({ status: "open" });
  }
});
after(() => {
  manager.shutdown();
  io.close();
  server.close();
});

const CHAT = "33611111111@s.whatsapp.net";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("envoyer une photo : copie locale, lien signé, accès refusé si le lien est modifié", async () => {
  const res = await upload("ligne-1", { to: "33611111111", caption: "Voici la photo" }, { data: PNG, type: "image/png", name: "photo é.png" });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const { message } = res.body;
  assert.equal(message.type, "image");
  assert.equal(message.text, "Voici la photo");
  assert.ok(sent.at(-1).content.image.url, "fichier transmis à Baileys");
  assert.match(message.media.url, /^\/media\/ligne-1\//);

  const file = await fetch(base + message.media.url);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);

  const forged = message.media.url.replace("/media/ligne-1/", "/media/ligne-2/");
  assert.equal((await fetch(base + forged)).status, 403, "le lien d'une ligne n'ouvre pas une autre ligne");
  assert.equal((await fetch(base + message.media.url.replace(/sig=[^&]+/, "sig=abc"))).status, 403);
  // Les fichiers temporaires d'envoi sont supprimés.
  assert.deepEqual(fs.readdirSync(manager.get("ligne-1").uploadDir), []);
});

test("un document HTML est servi en téléchargement, jamais affiché dans la page", async () => {
  const res = await upload("ligne-1", { to: CHAT }, { data: Buffer.from("<script>alert(1)</script>"), type: "text/html", name: "page.html" });
  assert.equal(res.status, 201);
  assert.equal(res.body.message.type, "document");
  const file = await fetch(base + res.body.message.media.url);
  assert.equal(file.headers.get("content-type"), "application/octet-stream");
  assert.match(file.headers.get("content-disposition"), /attachment/);
});

test("note vocale : convertie en OGG/Opus quand ffmpeg est présent", { skip: !hasFfmpeg() && "ffmpeg absent" }, async () => {
  const wav = path.join(config.dataDir, "son.wav");
  execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", wav], { stdio: "ignore" });
  const res = await upload("ligne-1", { to: CHAT, voice: "1" }, { data: fs.readFileSync(wav), type: "audio/webm", name: "vocal.webm" });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.message.type, "voice");
  const last = sent.at(-1).content;
  assert.equal(last.ptt, true);
  assert.equal(last.mimetype, "audio/ogg; codecs=opus");
});

test("répondre, réagir et supprimer pour tout le monde", async () => {
  const session = manager.get("ligne-1");
  await session.handleMessages([rawMessage({ jid: CHAT, id: "IN1", text: "Vous livrez demain ?" })], "notify");

  const reply = await json("POST", "/api/sessions/ligne-1/messages", { to: CHAT, text: "Oui, avant midi.", replyTo: "IN1" });
  assert.equal(reply.status, 201);
  assert.equal(sent.at(-1).options.quoted.key.id, "IN1");
  assert.equal(reply.body.message.quoted.id, "IN1");

  const react = await json("POST", `/api/sessions/ligne-1/chats/${encodeURIComponent(CHAT)}/messages/IN1/react`, { emoji: "👍" });
  assert.equal(react.status, 200);
  assert.deepEqual(react.body.message.reactions, { me: "👍" });

  // Réaction reçue du client sur notre réponse.
  await session.handleMessages([{ key: { remoteJid: CHAT, id: "R1", fromMe: false }, message: { reactionMessage: { key: { id: reply.body.message.id }, text: "❤️" } } }], "notify");
  assert.deepEqual(session.store.findMessage(CHAT, reply.body.message.id).reactions, { [CHAT]: "❤️" });

  const del = await json("DELETE", `/api/sessions/ligne-1/chats/${encodeURIComponent(CHAT)}/messages/${reply.body.message.id}`);
  assert.equal(del.status, 200);
  assert.equal(del.body.message.deleted, true);
  const notMine = await json("DELETE", `/api/sessions/ligne-1/chats/${encodeURIComponent(CHAT)}/messages/IN1`);
  assert.equal(notMine.status, 403);
});

test("les fichiers d'une ligne restent dans son dossier", async () => {
  const a = fs.readdirSync(manager.get("ligne-1").mediaDir);
  assert.ok(a.length >= 2);
  assert.equal(fs.existsSync(manager.get("ligne-2").mediaDir), false);
});

test("média sans référence : erreur claire", async () => {
  const session = manager.get("ligne-2");
  session.store.upsertMessage({ id: "OLD", chatId: CHAT, fromMe: false, type: "image", text: "", timestamp: 1, media: { mimetype: "image/jpeg" } });
  await assert.rejects(session.ensureMedia(CHAT, "OLD"), /plus disponible/);
});
