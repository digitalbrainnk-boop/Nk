import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { DisconnectReason } from "baileys";
import { MessageStore } from "../src/whatsapp/MessageStore.js";
import { normalizePhone, resolveRecipient } from "../src/whatsapp/jid.js";
import { parseMessage } from "../src/whatsapp/messageParser.js";
import { STATUS, WhatsAppSession, explainClose } from "../src/whatsapp/WhatsAppSession.js";
import { rawMessage, silentLogger, tempConfig } from "./helpers.js";

test("normalizePhone accepte l'indicatif et refuse les numéros locaux", () => {
  assert.equal(normalizePhone("+33 6 12 34 56 78"), "33612345678");
  assert.equal(normalizePhone("0022670123456"), "22670123456");
  assert.throws(() => normalizePhone("0612345678"), /indicatif/);
  assert.throws(() => normalizePhone("123"), /invalide/);
  assert.deepEqual(resolveRecipient("33612345678"), { jid: "33612345678@s.whatsapp.net", fromPhone: true });
  assert.throws(() => resolveRecipient("abc@example.com"), /invalide/);
});

test("parseMessage simplifie les types courants et ignore les messages techniques", () => {
  const m = parseMessage(rawMessage({ id: "X1", text: "Salut" }));
  assert.equal(m.type, "text");
  assert.equal(m.text, "Salut");
  assert.equal(m.status, "received");
  const img = parseMessage({ key: { id: "X2", remoteJid: "1@s.whatsapp.net" }, message: { imageMessage: { caption: "photo" } } });
  assert.deepEqual([img.type, img.text], ["image", "photo"]);
  assert.equal(parseMessage({ key: { id: "X3" }, message: { reactionMessage: { text: "👍" } } }), null);
});

test("MessageStore : tri, doublons, limite, statuts qui n'avancent que vers l'avant", () => {
  const cfg = tempConfig();
  const file = path.join(cfg.dataDir, "store.json");
  const store = new MessageStore({ file, maxMessagesPerChat: 3, saveDelayMs: 5 });
  const chatId = "33600000000@s.whatsapp.net";
  const base = { chatId, fromMe: false, type: "text", status: "received" };
  store.upsertMessage({ ...base, id: "b", text: "2", timestamp: 2000 }, { countUnread: true });
  store.upsertMessage({ ...base, id: "a", text: "1", timestamp: 1000 }, { countUnread: true });
  assert.equal(store.upsertMessage({ ...base, id: "a", text: "1", timestamp: 1000 }).isNew, false);
  store.upsertMessage({ ...base, id: "c", text: "3", timestamp: 3000, fromMe: true, status: "sent" });
  store.upsertMessage({ ...base, id: "d", text: "4", timestamp: 4000 });
  assert.deepEqual(store.getMessages(chatId).messages.map((m) => m.id), ["b", "c", "d"]);
  assert.equal(store.getChat(chatId).unread, 2);
  assert.ok(store.updateStatus(chatId, "c", "read"));
  assert.equal(store.updateStatus(chatId, "c", "delivered"), null);
  assert.equal(store.findMessage(chatId, "c").status, "read");
  store.flushSync();
  const reloaded = new MessageStore({ file });
  assert.equal(reloaded.getMessages(chatId).messages.length, 3);
});

test("MessageStore : un autre numéro relié à la ligne efface l'ancien historique", () => {
  const cfg = tempConfig();
  const store = new MessageStore({ file: path.join(cfg.dataDir, "s.json") });
  store.setOwner("33611111111@s.whatsapp.net");
  store.upsertMessage({ id: "1", chatId: "x@s.whatsapp.net", fromMe: false, type: "text", text: "a", timestamp: 1 });
  store.setOwner("33611111111@s.whatsapp.net");
  assert.equal(store.listChats().length, 1);
  store.setOwner("33622222222@s.whatsapp.net");
  assert.equal(store.listChats().length, 0);
});

function makeSession(cfg) {
  const dir = path.join(cfg.sessionsDir, "ligne-test");
  fs.mkdirSync(dir, { recursive: true });
  return new WhatsAppSession({
    id: "ligne-test",
    dir,
    meta: { label: "Test", color: "#000", createdAt: 1 },
    config: cfg,
    logger: silentLogger,
    getWaVersion: async () => undefined,
  });
}

test("Session : identifiants @lid ramenés au numéro, accusés et suppressions", async () => {
  const session = makeSession(tempConfig());
  const events = [];
  session.on("message", (e) => events.push(["message", e]));
  session.on("message-update", (e) => events.push(["update", e]));

  await session.handleMessages([rawMessage({ jid: "999@lid", alt: "33633333333@s.whatsapp.net", id: "L1", text: "via lid" })], "notify");
  await session.handleMessages([rawMessage({ jid: "999@lid", id: "L2", text: "sans alt" })], "notify");
  const chats = session.store.listChats();
  assert.equal(chats.length, 1, "les deux messages sont dans la même discussion");
  assert.equal(chats[0].id, "33633333333@s.whatsapp.net");
  assert.equal(chats[0].name, "Alice");

  await session.handleMessages([rawMessage({ jid: "33633333333@s.whatsapp.net", id: "O1", text: "réponse", fromMe: true })], "notify");
  await session.onMessagesUpdate([{ key: { remoteJid: "33633333333@s.whatsapp.net", id: "O1", fromMe: true }, update: { status: 3 } }]);
  assert.equal(session.store.findMessage("33633333333@s.whatsapp.net", "O1").status, "delivered");
  await session.onMessagesUpdate([{ key: { remoteJid: "33633333333@s.whatsapp.net", id: "L1" }, update: { messageStubType: 1, message: null } }]);
  assert.equal(session.store.findMessage("33633333333@s.whatsapp.net", "L1").deleted, true);
  assert.equal(events.filter(([t]) => t === "message").length, 3);
  assert.equal(events.filter(([t]) => t === "update").length, 2);
  await session.destroy();
});

test("Session : politique de reconnexion selon le code de fermeture", async () => {
  const cfg = tempConfig({ reconnect: { baseDelayMs: 50, maxDelayMs: 100, maxAttempts: 0 } });
  const session = makeSession(cfg);

  // Ligne reliée + coupure réseau -> reconnexion programmée.
  session.linked = true;
  session.manualStop = false;
  session.onClose({ output: { statusCode: DisconnectReason.connectionLost }, message: "Connection Lost" });
  assert.equal(session.state.status, STATUS.RECONNECTING);
  assert.ok(session.state.nextRetryAt > Date.now());
  session.halt();

  // Ouverte ailleurs (440) -> arrêt, pas de boucle.
  session.manualStop = false;
  session.onClose({ output: { statusCode: DisconnectReason.connectionReplaced } });
  assert.equal(session.state.status, STATUS.ERROR);
  assert.equal(session.reconnectTimer, null);

  // Délié depuis le téléphone -> auth effacée.
  fs.mkdirSync(session.authDir, { recursive: true });
  fs.writeFileSync(path.join(session.authDir, "creds.json"), "{}");
  session.manualStop = false;
  session.onClose({ output: { statusCode: DisconnectReason.loggedOut } });
  assert.equal(session.state.status, STATUS.LOGGED_OUT);
  assert.equal(session.linked, false);
  assert.equal(fs.existsSync(session.authDir), false);

  // QR affiché mais jamais scanné -> on s'arrête (pas d'insistance).
  session.manualStop = false;
  session.awaitingUser = true;
  session.onClose({ output: { statusCode: DisconnectReason.timedOut }, message: "QR refs attempts ended" });
  assert.equal(session.state.status, STATUS.IDLE);
  assert.match(session.state.lastError, /pas été validé à temps/);
  await session.destroy();
});

test("explainClose traduit les erreurs réseau", () => {
  assert.match(explainClose(408, "WebSocket Error (getaddrinfo ENOTFOUND web.whatsapp.com)"), /ENOTFOUND/);
  assert.match(explainClose(440), /ouverte ailleurs/);
});
