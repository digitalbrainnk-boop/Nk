// Outils de test : base de données temporaire, serveur réel sur un port libre, comptes connectés.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "maquis-test-"));
process.env.DATA_DIR = DATA_DIR;
process.env.NODE_ENV = "test";
process.env.SETUP_CODE = "12345678";

const { createApp } = await import("../src/app.js");
export const time = await import("../src/time.js");
export const db = await import("../src/db.js");
export const reports = await import("../src/reports.js");

let server;
export let base = "";
export async function start() {
  const app = createApp();
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://127.0.0.1:${server.address().port}`;
}
export function stop() {
  server?.close();
  db.closeDb();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
}

// Client HTTP avec son propre cookie de session (un par compte).
export function client(name = "") {
  let cookie = "";
  const c = async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { "Content-Type": "application/json", "X-Requested-With": "MaquisPro", ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const type = res.headers.get("content-type") || "";
    const data = type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  };
  c.label = name;
  c.get = (u, h) => c("GET", u, undefined, h);
  c.post = (u, b, h) => c("POST", u, b ?? {}, h);
  c.put = (u, b, h) => c("PUT", u, b ?? {}, h);
  c.patch = (u, b, h) => c("PATCH", u, b ?? {}, h);
  c.del = (u, h) => c("DELETE", u, undefined, h);
  c.ok = async (method, url, body, headers) => {
    const r = await c(method, url, body, headers);
    if (r.status >= 400) throw new Error(`${c.label} ${method} ${url} -> ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  };
  return c;
}

export async function login(username, password, name) {
  const c = client(name || username);
  await c.ok("POST", "/api/auth/login", { username, password, device_id: `test-${username}` });
  return c;
}

// Installe le maquis et crée les quatre comptes.
export async function install() {
  const owner = client("propriétaire");
  await owner.ok("POST", "/api/setup", { setup_code: "12345678", maquis_name: "Maquis Le Baobab", username: "patron", full_name: "Moussa Ouédraogo", password: "Patron2026!", device_id: "test-patron" });
  await owner.ok("POST", "/api/users", { role: "manager", username: "gerant", full_name: "Awa Kaboré", password: "Gerant2026!" });
  await owner.ok("POST", "/api/users", { role: "cashier", username: "caisse", full_name: "Issa Sawadogo", password: "Caisse26" });
  await owner.ok("POST", "/api/users", { role: "waiter", username: "serveur1", full_name: "Ali Traoré", password: "Serveur1" });
  await owner.ok("POST", "/api/users", { role: "waiter", username: "serveur2", full_name: "Fatim Zongo", password: "Serveur2" });
  const accounts = { owner };
  for (const [key, u, pw, newPw] of [
    ["manager", "gerant", "Gerant2026!", "Gerant2026!b"],
    ["cashier", "caisse", "Caisse26", "Caisse26b"],
    ["waiter", "serveur1", "Serveur1", "Serveur1b"],
    ["waiter2", "serveur2", "Serveur2", "Serveur2b"],
  ]) {
    const c = await login(u, pw, key);
    await c.ok("POST", "/api/me/password", { current: pw, password: newPw });
    accounts[key] = c;
  }
  return accounts;
}
