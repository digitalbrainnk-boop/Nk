// Notifications Android (Termux:API) : contenu, regroupement, retrait, repli sur
// Chrome, et réponse depuis la notification (chemin complet, avec texte piégé).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { decodeReply } from "../scripts/notification-action.js";
import { createApp } from "../src/app.js";
import { TermuxNotifier, termuxReplySubstitution } from "../src/notify/termux.js";
import { PushService } from "../src/push.js";
import { SessionManager } from "../src/whatsapp/SessionManager.js";
import { rawMessage, silentLogger, tempConfig } from "./helpers.js";

const config = tempConfig();
// Faux Termux : les commandes existent, leurs appels sont enregistrés.
const prefix = path.join(config.dataDir, "com.termux", "usr");
fs.mkdirSync(path.join(prefix, "bin"), { recursive: true });
for (const name of ["termux-notification", "termux-notification-remove", "termux-notification-list", "termux-open-url"]) {
  fs.writeFileSync(path.join(prefix, "bin", name), "#!/bin/sh\n");
}
const calls = [];
let termuxAnswers = { code: 0, timedOut: false };
const notifier = new TermuxNotifier({
  dataDir: config.dataDir,
  prefix,
  getPort: () => server.address().port,
  logger: silentLogger,
  run: async (command, args) => {
    calls.push({ command: path.basename(command), args });
    return { ...termuxAnswers, stdout: "", stderr: "" };
  },
});
const pushed = [];
const push = new PushService({ dataDir: config.dataDir, contact: "mailto:t@example.com", logger: silentLogger, send: async (s, p) => pushed.push(JSON.parse(p)) });
push.subscribe({ endpoint: "https://push.example.com/x", keys: { p256dh: "a", auth: "b" } });
const manager = new SessionManager({ config, logger: silentLogger });
const { server, io } = createApp({ config, manager, logger: silentLogger, push, notifier });
const sentTexts = [];
let session;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (call, name) => call.args[call.args.indexOf(name) + 1];
const notifications = () => calls.filter((c) => c.command === "termux-notification");

before(async () => {
  await manager.init();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  session = await manager.create({ label: "Ligne 1 — Accueil", start: false });
  session.sock = {
    onWhatsApp: async (jid) => [{ jid, exists: true }],
    sendMessage: async (jid, content) => {
      sentTexts.push(content.text);
      return { key: { remoteJid: jid, id: `S${sentTexts.length}`, fromMe: true }, message: { conversation: content.text }, messageTimestamp: Math.floor(Date.now() / 1000), status: 1 };
    },
  };
  session.setState({ status: "open" });
  // Le script d'action lit le jeton dans data/api-token.txt, comme dans Termux.
  fs.writeFileSync(path.join(config.dataDir, "api-token.txt"), `${config.apiToken}\n`);
});
after(() => {
  manager.shutdown();
  io.close();
  server.close();
});

const CHAT = "33611111111@s.whatsapp.net";

test("nouveau message : vraie notification Android avec Répondre et Marquer comme lu", async () => {
  await session.handleMessages([rawMessage({ jid: CHAT, id: "A1", text: "Bonjour, c'est ouvert ?", pushName: "Karim" })], "notify");
  await wait(100);
  const [n] = notifications();
  assert.ok(n, "termux-notification appelée");
  assert.equal(arg(n, "--title"), "Karim · Ligne 1 — Accueil");
  assert.equal(arg(n, "--content"), "Bonjour, c'est ouvert ?");
  assert.equal(arg(n, "--priority"), "high");
  assert.equal(arg(n, "--button1"), "Répondre");
  assert.match(arg(n, "--button1-action"), /\$REPLY/);
  assert.equal(arg(n, "--button2"), "Marquer comme lu");
  assert.match(arg(n, "--action"), /termux-open-url' 'http:\/\/localhost:\d+\/#open=ligne-1\|33611111111%40s\.whatsapp\.net'/);
  assert.ok(n.args.includes("--sound"));
  assert.ok(!n.args.includes("--alert-once"));
  assert.equal(pushed.length, 0, "pas de double notification Chrome");
});

test("messages suivants : regroupés dans la même notification, sans resonner", async () => {
  await session.handleMessages([rawMessage({ jid: CHAT, id: "A2", text: "Je passe à 10h", pushName: "Karim" })], "notify");
  await wait(100);
  const n = notifications().at(-1);
  assert.equal(arg(n, "--id"), arg(notifications()[0], "--id"), "même notification mise à jour");
  assert.equal(arg(n, "--title"), "Karim (2) · Ligne 1 — Accueil");
  assert.equal(arg(n, "--content"), "Bonjour, c'est ouvert ?\nJe passe à 10h");
  assert.ok(n.args.includes("--alert-once"));
});

test("discussion lue dans l'app ou réponse envoyée : la notification disparaît", async () => {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/sessions/ligne-1/chats/${encodeURIComponent(CHAT)}/read`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiToken}`, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(res.status, 200);
  await wait(50);
  const removal = calls.findLast((c) => c.command === "termux-notification-remove");
  assert.equal(removal.args[0], arg(notifications()[0], "--id"));

  await session.handleMessages([rawMessage({ jid: CHAT, id: "A3", text: "Merci !", pushName: "Karim" })], "notify");
  await wait(50);
  assert.equal(arg(notifications().at(-1), "--title"), "Karim · Ligne 1 — Accueil", "compteur remis à zéro");
  const before = calls.length;
  await session.handleMessages([rawMessage({ jid: CHAT, id: "A4", text: "Réponse depuis le téléphone", fromMe: true })], "notify");
  await wait(50);
  assert.equal(calls.slice(before).filter((c) => c.command === "termux-notification-remove").length, 1);
});

test("aperçu désactivé : ni nom ni texte dans la notification", async () => {
  notifier.updateSettings({ preview: false });
  await session.handleMessages([rawMessage({ jid: "33622222222@s.whatsapp.net", id: "B1", text: "Code secret 1234", pushName: "Banque" })], "notify");
  await wait(50);
  const n = notifications().at(-1);
  assert.equal(arg(n, "--title"), "Multi-Lignes · Ligne 1 — Accueil");
  assert.equal(arg(n, "--content"), "Nouveau message");
  assert.ok(!JSON.stringify(n.args).includes("1234"));
  notifier.updateSettings({ preview: true });
});

test("Termux:API absente ou bloquée : repli automatique sur les notifications Chrome", async () => {
  termuxAnswers = { code: -1, timedOut: true };
  await session.handleMessages([rawMessage({ jid: "33633333333@s.whatsapp.net", id: "C1", text: "Allô ?", pushName: "Awa" })], "notify");
  await wait(100);
  assert.equal(notifier.working, false);
  assert.equal(pushed.at(-1)?.body, "Allô ?");
  const status = await (await fetch(`http://127.0.0.1:${server.address().port}/api/notifications`, { headers: { Authorization: `Bearer ${config.apiToken}` } })).json();
  assert.equal(status.working, false);
  assert.match(status.lastError, /ne répond pas/);
  termuxAnswers = { code: 0, timedOut: false };
  notifier.lastCheck = 0;
});

test("décodage de la réponse : inverse exact de Termux:API", () => {
  for (const text of ['simple', 'avec "guillemets"', 'antislash \\" piégé', "prix $100 et `whoami`", "ligne 1\nligne 2"]) {
    const produced = termuxReplySubstitution("$REPLY", text);
    assert.equal(decodeReply(`${produced}\n`), text);
  }
});

test("répondre depuis la notification : le texte part tel quel, rien n'est exécuté", async () => {
  const canary = path.join(config.dataDir, "canari");
  const nasty = `Prix : $100 "ok" \\ \`touch ${canary}\` $(touch ${canary}) 'fin' é😊`;
  const action = termuxReplySubstitution(notifier.replyAction("ligne-1", CHAT), nasty);
  // Exactement ce que fait Termux : « sh -c action » (dash).
  const result = await new Promise((resolve) => {
    const child = spawn("sh", ["-c", action], {
      env: { ...process.env, DATA_DIR: config.dataDir, PORT: String(server.address().port), API_TOKEN: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => resolve({ code, err }));
  });
  assert.equal(result.code, 0, result.err);
  assert.equal(sentTexts.at(-1), nasty);
  assert.equal(fs.existsSync(canary), false, "aucune commande exécutée");
});
