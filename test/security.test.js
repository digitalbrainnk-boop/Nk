// Sécurité du tableau de bord, testée sur un vrai serveur lancé à part.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "nk-sec-"));
const PORT = 30000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server.js"], {
  env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), ADMIN_PASSWORD: "Bon-Mot-De-Passe-42", NODE_ENV: "production" },
  stdio: "ignore",
});
after(() => server.kill());
for (let i = 0; i < 100; i++) {
  try {
    await fetch(`${BASE}/health`);
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 100));
  }
}
const login = (password, headers = {}) =>
  fetch(`${BASE}/api/login`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ password }) });

test("en-têtes de sécurité présents, Express non annoncé", async () => {
  const r = await fetch(`${BASE}/`);
  assert.match(r.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.equal(r.headers.get("x-powered-by"), null);
});

test("sans connexion, rien n'est accessible", async () => {
  for (const p of ["/api/settings", "/api/backup", "/api/contacts", "/api/media/1"]) {
    assert.equal((await fetch(`${BASE}${p}`)).status, 401, p);
  }
});

test("connexion : jeton aléatoire différent à chaque fois, cookie sécurisé, déconnexion efficace", async () => {
  const a = await login("Bon-Mot-De-Passe-42");
  const b = await login("Bon-Mot-De-Passe-42");
  const ca = a.headers.get("set-cookie");
  const cb = b.headers.get("set-cookie");
  assert.match(ca, /HttpOnly/);
  assert.match(ca, /Secure/);
  assert.match(ca, /SameSite=Strict/);
  assert.notEqual(ca.split(";")[0], cb.split(";")[0]);
  const cookie = ca.split(";")[0];
  assert.equal((await fetch(`${BASE}/api/settings`, { headers: { cookie } })).status, 200);
  const s = await (await fetch(`${BASE}/api/settings`, { headers: { cookie } })).json();
  assert.equal(s.sessions, undefined);
  await fetch(`${BASE}/api/logout`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" });
  assert.equal((await fetch(`${BASE}/api/settings`, { headers: { cookie } })).status, 401);
});

test("une requête venue d'un autre site est refusée", async () => {
  const r = await login("x", { origin: "https://pirate.example" });
  assert.equal(r.status, 403);
  const r2 = await login("x", { "sec-fetch-site": "cross-site" });
  assert.equal(r2.status, 403);
});

test("faux messages Facebook sans signature : refusés", async () => {
  const body = JSON.stringify({ object: "page", entry: [{ messaging: [{ sender: { id: "1" }, message: { text: "hi" } }] }] });
  const r = await fetch(`${BASE}/webhooks/meta`, { method: "POST", headers: { "content-type": "application/json" }, body });
  assert.equal(r.status, 401);
});

test("deviner le mot de passe : bloqué après 5 essais, et 30 erreurs par heure au total", async () => {
  // Chez l'hébergeur, Apache ajoute la vraie adresse du visiteur à la fin : inventer un
  // X-Forwarded-For ne sert à rien.
  const real = (ip) => ({ "x-forwarded-for": `1.2.3.4, ${ip}` });
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await login(`faux${i}`, real("203.0.113.9"))).status);
  assert.deepEqual(codes.slice(0, 5), [401, 401, 401, 401, 401]);
  assert.equal(codes[6], 429);
  assert.equal((await login("Bon-Mot-De-Passe-42", real("203.0.113.9"))).status, 429); // même le bon attend
  // Un attaquant qui change d'adresse est arrêté par la limite globale.
  let last = 0;
  for (let i = 0; i < 30; i++) last = (await login(`x${i}`, real(`198.51.100.${i}`))).status;
  assert.equal(last, 429);
});

test("un fichier « html » reçu d'un client n'est jamais affiché comme une page", async () => {
  process.env.DATA_DIR = DATA;
  const { saveMedia } = await import("../src/media.js");
  const m = saveMedia(Buffer.from("<script>alert(1)</script>"), "text/html");
  assert.equal(m.mime, "application/octet-stream");
  assert.match(m.path, /\.bin$/);
});
