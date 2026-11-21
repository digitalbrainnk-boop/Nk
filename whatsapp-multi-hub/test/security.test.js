// Sécurité et fiabilité : liens de connexion, changement de jeton, en-têtes,
// notifications et relance automatique.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { io as connectClient } from "socket.io-client";
import { createApp } from "../src/app.js";
import { loadConfig, ROOT_DIR } from "../src/config.js";
import { PushService } from "../src/push.js";
import { SessionManager } from "../src/whatsapp/SessionManager.js";
import { rawMessage, silentLogger, tempConfig } from "./helpers.js";

const config = tempConfig();
config.apiTokenSource = "file";
const pushed = [];
const push = new PushService({
  dataDir: config.dataDir,
  contact: "mailto:test@example.com",
  logger: silentLogger,
  send: async (sub, payload) => {
    if (sub.endpoint.includes("expired")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
    pushed.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
  },
});
const manager = new SessionManager({ config, logger: silentLogger });
const { server, io, loginCodes } = createApp({ config, manager, logger: silentLogger, push });
let base;

const call = async (method, url, { token = config.apiToken, body } = {}) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
};

before(async () => {
  await manager.init();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  manager.shutdown();
  io.close();
  server.close();
});

test("par défaut, le serveur n'écoute que l'appareil lui-même", () => {
  const cfg = loadConfig({}, { dataDir: config.dataDir, apiToken: "x".repeat(20) });
  assert.equal(cfg.host, "127.0.0.1");
});

test("en-têtes de protection sur l'application", async () => {
  const res = await fetch(`${base}/`);
  const csp = res.headers.get("content-security-policy");
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  const health = await call("GET", "/api/health", { token: null });
  assert.deepEqual(health.body, { ok: true }, "aucune information interne exposée");
});

test("lien de connexion : utilisable une seule fois", async () => {
  const code = loginCodes.issue();
  const first = await call("POST", "/api/auth/exchange", { token: null, body: { code } });
  assert.equal(first.status, 200);
  assert.equal(first.body.token, config.apiToken);
  const again = await call("POST", "/api/auth/exchange", { token: null, body: { code } });
  assert.equal(again.status, 401);
  assert.match(again.body.error.message, /lignes/);
  const forged = await call("POST", "/api/auth/exchange", { token: null, body: { code: "inventé" } });
  assert.equal(forged.status, 401);
});

test("un nouveau lien ne peut être demandé qu'avec le jeton", async () => {
  assert.equal((await call("POST", "/api/auth/login-code", { token: null })).status, 401);
  const res = await call("POST", "/api/auth/login-code");
  assert.equal(res.status, 200);
  assert.match(res.body.path, /^\/#login=/);
  assert.equal((await call("POST", "/api/auth/exchange", { token: null, body: { code: res.body.code } })).status, 200);
});

test("changer le jeton déconnecte les autres appareils et invalide l'ancien", async () => {
  const old = config.apiToken;
  const socket = connectClient(base, { auth: { token: old }, transports: ["websocket"], reconnection: false });
  await new Promise((resolve) => socket.on("connect", resolve));
  const disconnected = new Promise((resolve) => socket.on("disconnect", resolve));

  const res = await call("POST", "/api/auth/rotate");
  assert.equal(res.status, 200);
  const fresh = res.body.token;
  assert.notEqual(fresh, old);
  await disconnected;
  assert.equal((await call("GET", "/api/sessions", { token: old })).status, 401);
  assert.equal((await call("GET", "/api/sessions", { token: fresh })).status, 200);
  assert.equal(fs.readFileSync(config.apiTokenFile, "utf8").trim(), fresh, "nouveau jeton enregistré");
  socket.close();
});

test("jeton fixé dans .env : changement refusé avec une explication", async () => {
  config.apiTokenSource = "env";
  const res = await call("POST", "/api/auth/rotate");
  assert.equal(res.status, 409);
  assert.match(res.body.error.message, /\.env/);
  config.apiTokenSource = "file";
});

test("notifications : abonnement, aperçu masqué, abonnements expirés oubliés", async () => {
  const bad = await call("POST", "/api/push/subscribe", { body: { subscription: { endpoint: "http://exemple.com/x", keys: { p256dh: "a", auth: "b" } } } });
  assert.equal(bad.status, 400, "seules les adresses https sont acceptées");
  const sub = (endpoint, preview) => call("POST", "/api/push/subscribe", { body: { subscription: { endpoint, keys: { p256dh: "a", auth: "b" } }, preview } });
  assert.equal((await sub("https://push.example.com/visible", true)).status, 201);
  assert.equal((await sub("https://push.example.com/discret", false)).status, 201);
  assert.equal((await sub("https://push.example.com/expired", true)).status, 201);

  const session = await manager.create({ label: "Ligne Pro", start: false });
  await session.handleMessages([rawMessage({ id: "N1", text: "Bonjour, c'est urgent", pushName: "Karim" })], "notify");
  await new Promise((r) => setTimeout(r, 100));
  const visible = pushed.find((p) => p.endpoint.endsWith("visible"))?.payload;
  const discret = pushed.find((p) => p.endpoint.endsWith("discret"))?.payload;
  assert.equal(visible.title, "Karim · Ligne Pro");
  assert.equal(visible.body, "Bonjour, c'est urgent");
  assert.equal(visible.sessionId, session.id);
  assert.equal(discret.body, "Nouveau message", "contenu masqué sur l'appareil qui l'a demandé");
  assert.ok(!JSON.stringify(discret).includes("urgent"));
  assert.ok(!push.data.subscriptions.some((s) => s.endpoint.includes("expired")), "abonnement expiré retiré");

  // Historique et messages envoyés par la ligne : pas de notification.
  const count = pushed.length;
  await session.handleMessages([rawMessage({ id: "N2", text: "ancien", jid: "33699999999@s.whatsapp.net" })], "history");
  await session.handleMessages([rawMessage({ id: "N3", text: "réponse", fromMe: true, jid: "33699999999@s.whatsapp.net" })], "notify");
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(pushed.length, count);
  const stored = JSON.parse(fs.readFileSync(path.join(config.dataDir, "push.json"), "utf8"));
  assert.ok(stored.privateKey, "clés de notification conservées");
  assert.equal((fs.statSync(path.join(config.dataDir, "push.json")).mode & 0o077), 0, "fichier lisible par toi seul");
});

test("relance automatique : redémarre après un plantage, pas après un arrêt normal", () => {
  const app = fs.mkdtempSync(path.join(config.dataDir, "app-"));
  fs.mkdirSync(path.join(app, "scripts"));
  fs.copyFileSync(path.join(ROOT_DIR, "scripts", "termux-run.sh"), path.join(app, "scripts", "termux-run.sh"));
  // Faux serveur : plante 2 fois, puis s'arrête normalement.
  fs.writeFileSync(path.join(app, "server.js"), `
    const fs = require("fs"); const f = __dirname + "/runs";
    const n = (fs.existsSync(f) ? Number(fs.readFileSync(f, "utf8")) : 0) + 1;
    fs.writeFileSync(f, String(n)); process.exit(n < 3 ? 1 : 0);`);
  const run = spawnSync("sh", [path.join(app, "scripts", "termux-run.sh")], { env: { ...process.env, RESTART_DELAY: "0" }, encoding: "utf8", timeout: 20000 });
  assert.equal(run.status, 0);
  assert.equal(fs.readFileSync(path.join(app, "runs"), "utf8"), "3");
  assert.match(run.stdout, /redémarrage/);

  // Déjà lancé ailleurs (code 3) : pas de boucle.
  fs.writeFileSync(path.join(app, "server.js"), `process.exit(3);`);
  const busy = spawnSync("sh", [path.join(app, "scripts", "termux-run.sh")], { env: { ...process.env, RESTART_DELAY: "0" }, encoding: "utf8", timeout: 5000 });
  assert.equal(busy.status, 3);
});
