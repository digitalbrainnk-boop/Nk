// Sécurité : anti-devinette, déconnexion automatique, appareils, mots de passe, en-têtes.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { start, stop, install, login, client, time, base } from "./helpers.js";

let clock = Date.UTC(2026, 10, 10, 12, 0);
time.setClock(() => clock);
let A;
before(async () => {
  await start();
  A = await install();
});
after(stop);

test("installation impossible une deuxième fois", async () => {
  const r = await client().post("/api/setup", { setup_code: "12345678", maquis_name: "Pirate", username: "pirate", full_name: "Pirate", password: "Pirate2026!!" });
  assert.equal(r.status, 403);
});

test("5 mauvais mots de passe : blocage temporaire et alerte au propriétaire", async () => {
  const c = client();
  for (let i = 0; i < 5; i++) assert.equal((await c.post("/api/auth/login", { username: "caisse", password: "faux" })).status, 401);
  const blocked = await c.post("/api/auth/login", { username: "caisse", password: "Caisse26b" });
  assert.equal(blocked.status, 429);
  const n = (await A.owner.ok("GET", "/api/notifications")).items;
  assert.ok(n.some((x) => x.type === "security" && x.title.includes("suspectes")));
  const events = await A.owner.ok("GET", "/api/login-events");
  assert.ok(events.filter((e) => !e.success && e.username === "caisse").length >= 5);
});

test("connexion depuis un nouvel appareil signalée au propriétaire", async () => {
  const c = client();
  await c.ok("POST", "/api/auth/login", { username: "gerant", password: "Gerant2026!b", device_id: "telephone-inconnu" });
  const n = (await A.owner.ok("GET", "/api/notifications")).items;
  assert.ok(n.some((x) => x.title === "Connexion depuis un nouvel appareil" && x.body.includes("Awa Kaboré")));
});

test("déconnexion à distance d'un appareil et compte bloqué", async () => {
  const devices = await A.owner.ok("GET", "/api/devices");
  const s = devices.find((d) => d.full_name === "Ali Traoré");
  await A.owner.ok("DELETE", `/api/devices/${s.id}`);
  assert.equal((await A.waiter.get("/api/orders")).status, 401);
  const users = await A.owner.ok("GET", "/api/users");
  const fatim = users.find((u) => u.username === "serveur2");
  await A.owner.ok("PATCH", `/api/users/${fatim.id}`, { active: false });
  assert.equal((await A.waiter2.get("/api/orders")).status, 401);
  assert.equal((await client().post("/api/auth/login", { username: "serveur2", password: "Serveur2b" })).status, 401);
});

test("déconnexion automatique après inactivité", async () => {
  const { resetLoginLimiter } = await import("../src/auth.js");
  resetLoginLimiter(); // le blocage du test précédent ne doit pas gêner celui-ci
  const c = await login("caisse", "Caisse26b");
  assert.equal((await c.get("/api/cash/current")).status, 200);
  clock += 13 * 3600000; // 12 h d'inactivité autorisées pour un caissier
  assert.equal((await c.get("/api/cash/current")).status, 401);
});

test("mot de passe provisoire : changement obligatoire avant toute opération", async () => {
  await A.owner.ok("POST", "/api/users", { role: "waiter", username: "nouveau", full_name: "Nouveau Serveur", password: "Provisoire1" });
  const c = await login("nouveau", "Provisoire1");
  assert.equal((await c.get("/api/orders")).status, 403);
  assert.equal((await c.post("/api/me/password", { current: "Provisoire1", password: "123456" })).status, 400); // trop facile
  await c.ok("POST", "/api/me/password", { current: "Provisoire1", password: "MonSecret9" });
  assert.equal((await c.get("/api/orders")).status, 200);
});

test("en-têtes de sécurité et mots de passe jamais renvoyés", async () => {
  const res = await fetch(base + "/");
  assert.match(res.headers.get("content-security-policy"), /default-src 'self'/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  const users = await A.owner.ok("GET", "/api/users");
  assert.ok(users.every((u) => u.password_hash === undefined));
  const audit = JSON.stringify(await A.owner.ok("GET", "/api/audit"));
  assert.ok(!audit.includes("scrypt$"));
});
