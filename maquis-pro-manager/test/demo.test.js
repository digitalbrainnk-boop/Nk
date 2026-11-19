// La version de démonstration : cohérente, et jamais installée sur de vraies données.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const run = (dir, ...args) =>
  spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "scripts/demo.js", "--creer", ...args], { env: { ...process.env, DATA_DIR: dir, NODE_ENV: "test" }, encoding: "utf8" });

test("la démonstration crée une semaine d'activité cohérente", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maquis-demo-"));
  try {
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr);
    const db = new DatabaseSync(path.join(dir, "maquis.db"), { readOnly: true });
    const n = (sql) => db.prepare(sql).get().n;
    assert.equal(n("SELECT COUNT(*) AS n FROM users"), 6);
    assert.ok(n("SELECT COUNT(*) AS n FROM sales WHERE status != 'cancelled'") > 100);
    assert.ok(n("SELECT COUNT(*) AS n FROM reports WHERE kind = 'daily'") >= 7);
    assert.equal(n("SELECT COUNT(*) AS n FROM orders WHERE status = 'pending'"), 2);
    assert.equal(n("SELECT COUNT(*) AS n FROM cash_sessions WHERE status = 'open'"), 1);
    assert.equal(n("SELECT COUNT(*) AS n FROM purchase_orders"), 1);
    assert.equal(n("SELECT COUNT(*) AS n FROM cancel_requests WHERE status = 'approved'"), 1);
    assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'demo_mode'").get().value, "true");
    // Aucun stock négatif, et chaque bouteille est justifiée par le grand livre.
    assert.equal(n("SELECT COUNT(*) AS n FROM (SELECT product_id, SUM(qty) AS s FROM stock_movements GROUP BY product_id HAVING s < 0)"), 0);
    db.close();
    // Une deuxième exécution ne recrée rien (la démo existe déjà).
    assert.equal(run(dir).status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("la démonstration refuse un dossier qui contient de vraies données", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maquis-vrai-"));
  try {
    const db = new DatabaseSync(path.join(dir, "maquis.db"));
    db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE users (id INTEGER PRIMARY KEY); INSERT INTO users VALUES (1);");
    db.close();
    const r = run(dir, "--refaire");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /VRAIES données/);
    assert.ok(fs.existsSync(path.join(dir, "maquis.db"))); // rien n'a été effacé
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
