// Vérifie de bout en bout (REST + Socket.io) qu'aucun message d'une ligne
// n'arrive chez un client qui regarde une autre ligne.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { io as connectClient } from "socket.io-client";
import { createApp } from "../src/app.js";
import { SessionManager } from "../src/whatsapp/SessionManager.js";
import { rawMessage, silentLogger, tempConfig } from "./helpers.js";

const config = tempConfig();
const manager = new SessionManager({ config, logger: silentLogger });
const { server, io } = createApp({ config, manager, logger: silentLogger });
let base;
const clients = [];

const auth = { Authorization: `Bearer ${config.apiToken}`, "Content-Type": "application/json" };
const call = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, { method, headers: auth, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};

function client(token = config.apiToken) {
  const socket = connectClient(base, { auth: { token }, transports: ["websocket"], reconnection: false });
  clients.push(socket);
  return socket;
}
const connected = (socket) =>
  new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
const select = (socket, sessionId) => socket.emitWithAck("session:select", { sessionId });
const collect = (socket, event) => {
  const list = [];
  socket.on(event, (payload) => list.push(payload));
  return list;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  await manager.init();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await manager.create({ label: "Ligne 1", start: false });
  await manager.create({ label: "Ligne 2", start: false });
});

after(() => {
  for (const c of clients) c.close();
  manager.shutdown();
  io.close();
  server.close();
});

test("l'API refuse les requêtes sans jeton valide", async () => {
  const res = await fetch(`${base}/api/sessions`);
  assert.equal(res.status, 401);
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  await assert.rejects(connected(client("mauvais-jeton")), /unauthorized/);
});

test("chaque ligne a son propre dossier", async () => {
  const { body } = await call("GET", "/api/sessions");
  assert.deepEqual(body.sessions.map((s) => s.id), ["ligne-1", "ligne-2"]);
  for (const id of ["ligne-1", "ligne-2"]) {
    assert.ok(fs.existsSync(path.join(config.sessionsDir, id, "meta.json")));
  }
});

test("un message de la ligne 1 n'est envoyé qu'aux clients de la ligne 1", async () => {
  const a = client();
  const b = client();
  await Promise.all([connected(a), connected(b)]);
  assert.equal((await select(a, "ligne-1")).ok, true);
  assert.equal((await select(b, "ligne-2")).ok, true);
  const gotA = collect(a, "message:new");
  const gotB = collect(b, "message:new");
  const statusB = collect(b, "session:update");

  await manager.get("ligne-1").handleMessages([rawMessage({ id: "M1", text: "Bonjour ligne 1" })], "notify");
  await manager.get("ligne-2").handleMessages([rawMessage({ id: "M2", text: "Bonjour ligne 2", jid: "33622222222@s.whatsapp.net" })], "notify");
  await wait(600);

  assert.deepEqual(gotA.map((e) => [e.sessionId, e.message.text]), [["ligne-1", "Bonjour ligne 1"]]);
  assert.deepEqual(gotB.map((e) => [e.sessionId, e.message.text]), [["ligne-2", "Bonjour ligne 2"]]);
  // B voit le compteur de non-lus de la ligne 1 (état), jamais son contenu.
  const l1 = statusB.filter((s) => s.id === "ligne-1").at(-1);
  assert.equal(l1.unread, 1);
  assert.equal(JSON.stringify(statusB).includes("Bonjour ligne 1"), false);

  // Changer de ligne fait quitter l'ancienne salle.
  await select(a, "ligne-2");
  await manager.get("ligne-1").handleMessages([rawMessage({ id: "M3", text: "encore ligne 1" })], "notify");
  await wait(200);
  assert.equal(gotA.length, 1);
});

test("l'API REST ne renvoie que les discussions de la ligne demandée", async () => {
  const one = await call("GET", "/api/sessions/ligne-1/chats");
  const two = await call("GET", "/api/sessions/ligne-2/chats");
  assert.deepEqual(one.body.chats.map((c) => c.id), ["33611111111@s.whatsapp.net"]);
  assert.deepEqual(two.body.chats.map((c) => c.id), ["33622222222@s.whatsapp.net"]);
  const msgs = await call("GET", "/api/sessions/ligne-2/chats/33611111111%40s.whatsapp.net/messages");
  assert.deepEqual(msgs.body.messages, []);
  const read = await call("POST", "/api/sessions/ligne-1/chats/33611111111%40s.whatsapp.net/read", {});
  assert.equal(read.body.chat.unread, 0);
});

test("erreurs claires : ligne inconnue, ligne non connectée, numéro invalide", async () => {
  assert.equal((await call("GET", "/api/sessions/inconnue")).status, 404);
  const send = await call("POST", "/api/sessions/ligne-1/messages", { to: "33611111111", text: "hello" });
  assert.equal(send.status, 409);
  assert.equal(send.body.error.code, "session_not_connected");
  const bad = await call("POST", "/api/sessions", { label: "X", phoneNumber: "0612" });
  assert.equal(bad.status, 400);
  const traversal = await call("POST", "/api/sessions", { id: "../etc", start: false });
  assert.equal(traversal.status, 400);
});

test("supprimer une ligne efface son dossier sans toucher l'autre", async () => {
  const res = await call("DELETE", "/api/sessions/ligne-2");
  assert.equal(res.status, 204);
  assert.equal(fs.existsSync(path.join(config.sessionsDir, "ligne-2")), false);
  assert.equal(fs.existsSync(path.join(config.sessionsDir, "ligne-1", "meta.json")), true);
});
