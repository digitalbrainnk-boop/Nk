// VERSION DE DÉMONSTRATION : un maquis fictif avec une semaine d'activité, pour découvrir
// l'application et la présenter (propriétaire, gérant qui tient la caisse, serveurs).
// Toutes les opérations passent par les vraies fonctions de l'application : stocks, caisses,
// reçus et bilans sont donc cohérents. Les données sont FICTIVES et l'application l'affiche.
//
//   npm run demo                 crée la démo (si besoin) puis démarre l'application de démo
//   npm run demo -- --refaire    recrée la démo à zéro
//   npm run demo -- --creer      crée la démo sans démarrer l'application
//
// Dossier : DATA_DIR (par défaut ./demo-donnees) — jamais le dossier des vraies données.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const args = new Set(process.argv.slice(2));
const DIR = path.resolve(process.env.DATA_DIR || "demo-donnees");
process.env.DATA_DIR = DIR;
process.env.PORT ||= "3200";
const DB_FILE = path.join(DIR, "maquis.db");

// Sécurité : on ne touche jamais à un dossier qui contient de vraies données.
function isDemoDb() {
  const db = new DatabaseSync(DB_FILE, { readOnly: true });
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'demo_mode'").get();
    return row?.value === "true";
  } catch {
    return false;
  } finally {
    db.close();
  }
}
let mustCreate = !fs.existsSync(DB_FILE);
if (!mustCreate) {
  if (!isDemoDb()) {
    console.error(`❌ ${DIR} contient de VRAIES données : la démonstration ne s'installe jamais là. Choisissez un autre dossier (DATA_DIR).`);
    process.exit(1);
  }
  if (args.has("--refaire")) {
    fs.rmSync(DIR, { recursive: true, force: true });
    mustCreate = true;
  }
}

const time = await import("../src/time.js");
const db = await import("../src/db.js");
db.openDb(DIR);

const PASSWORD = "demo1234";
export const DEMO_ACCOUNTS = [
  ["patron", "Issouf Kaboré", "owner"],
  ["gerant", "Mariam Ouédraogo", "manager"],
  ["caissier", "Salif Compaoré", "cashier"],
  ["awa", "Awa Sawadogo", "waiter"],
  ["ali", "Ali Traoré", "waiter"],
  ["fatim", "Fatim Zongo", "waiter"],
];

if (mustCreate) {
  const started = Date.now();
  console.log("Création de la démonstration (une semaine d'activité fictive)…");
  try {
    await build();
  } catch (e) {
    // Démo incomplète : on l'efface pour repartir proprement la prochaine fois.
    db.closeDb();
    fs.rmSync(DIR, { recursive: true, force: true });
    throw e;
  }
  console.log(`✅ Démonstration prête en ${Math.round((Date.now() - started) / 1000)} s.`);
}
time.setClock(() => Date.now());

if (!args.has("--creer")) {
  console.log("\nComptes de démonstration (mot de passe pour tous : demo1234)");
  for (const [u, n, r] of DEMO_ACCOUNTS) console.log(`  ${u.padEnd(9)} ${n} — ${{ owner: "propriétaire", manager: "gérant (tient la caisse)", cashier: "caissier", waiter: "serveur" }[r]}`);
  await import("../src/server.js");
} else db.closeDb();

// ---------------------------------------------------------------------------------------------
async function build() {
  const { createUser } = await import("../src/auth.js");
  const catalog = await import("../src/catalog.js");
  const stock = await import("../src/stock.js");
  const cash = await import("../src/cash.js");
  const sales = await import("../src/sales.js");
  const purchases = await import("../src/purchases.js");
  const reports = await import("../src/reports.js");
  const { all, get, run, setSetting } = db;

  // Hasard reproductible : la même démo à chaque création.
  let seed = 20261119;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const weighted = (items) => {
    const total = items.reduce((s, i) => s + i[1], 0);
    let x = rnd() * total;
    for (const [v, w] of items) if ((x -= w) <= 0) return v;
    return items[items.length - 1][0];
  };

  const realNow = Date.now();
  const today = time.businessDay(realNow);
  const firstDay = time.addDays(today, -7);
  let clock = time.dayBounds(firstDay).start + 7 * 3600000; // 10 h 00 le premier jour
  time.setClock(() => clock);
  const at = (day, hoursAfter3h) => time.dayBounds(day).start + Math.round(hoursAfter3h * 3600000);

  setSetting("demo_mode", true);
  setSetting("installed_day", firstDay);
  setSetting("maquis_name", "Maquis Le Baobab (démo)");
  setSetting("address", "Ouagadougou, secteur 15");
  setSetting("phone", "+226 70 00 00 00");
  setSetting("receipt_footer", "Merci et à bientôt au Baobab ! (reçu de démonstration)");

  // Comptes
  await createUser({ user: null }, { role: "owner", username: "patron", full_name: "Issouf Kaboré", password: PASSWORD });
  const owner = get("SELECT * FROM users WHERE username = 'patron'");
  for (const [u, n, r] of DEMO_ACCOUNTS.slice(1)) await createUser({ user: owner }, { role: r, username: u, full_name: n, password: PASSWORD });
  run("UPDATE users SET must_change_password = 0");
  const U = Object.fromEntries(all("SELECT * FROM users").map((u) => [u.username, u]));
  const ctx = (u) => ({ user: U[u], ip: "démonstration", device: "démonstration" });
  const M = ctx("gerant");

  // Fournisseurs et catalogue (prix courants à Ouagadougou, donnés à titre d'exemple)
  const sup1 = catalog.createSupplier(M, { name: "Dépôt Wend-Kuuni", phone: "+226 70 11 22 33", address: "Ouagadougou, Gounghin" });
  const sup2 = catalog.createSupplier(M, { name: "Grossiste Kanazoé", phone: "+226 76 44 55 66", address: "Ouagadougou, Tampouy" });
  const cats = Object.fromEntries(catalog.listCategories().map((c) => [c.name, c.id]));
  const P = {};
  for (const [key, name, brand, cat, buy, sell, upc, min, sup] of [
    ["brakina", "Brakina 65 cl", "Brakina", "Bières", 450, 700, 12, 36, sup1],
    ["castel", "Castel 65 cl", "Castel", "Bières", 500, 750, 12, 24, sup1],
    ["beaufort", "Beaufort 65 cl", "Beaufort", "Bières", 500, 750, 12, 24, sup1],
    ["flag", "Flag Spéciale 65 cl", "Flag", "Bières", 500, 750, 12, 24, sup1],
    ["guinness", "Guinness 33 cl", "Guinness", "Bières", 650, 1000, 24, 24, sup2],
    ["coca", "Coca-Cola 30 cl", "Coca-Cola", "Sucreries", 300, 500, 24, 24, sup2],
    ["fanta", "Fanta 30 cl", "Fanta", "Sucreries", 300, 500, 24, 24, sup2],
    ["sprite", "Sprite 30 cl", "Sprite", "Sucreries", 300, 500, 24, 12, sup2],
    ["lafi", "Eau Lafi 1,5 L", "Lafi", "Eaux minérales", 250, 500, 12, 12, sup2],
    ["dafani", "Jus Dafani 1 L", "Dafani", "Jus", 650, 1000, 12, 6, sup2],
    ["redbull", "Red Bull 25 cl", "Red Bull", "Boissons énergisantes", 900, 1500, 24, 12, sup2],
  ])
    P[key] = catalog.createProduct(M, { name, brand, category_id: cats[cat], purchase_price: buy, sale_price: sell, units_per_crate: upc, min_stock: min, supplier_id: sup.id });

  // Premier jour, 10 h : livraisons de départ
  stock.createEntry(M, { supplier_id: sup1.id, invoice_no: "WK-0418", paid_amount: 200000, payment_method: "Espèces", lines: [
    { product_id: P.brakina.id, crates: 25 }, { product_id: P.castel.id, crates: 15 }, { product_id: P.beaufort.id, crates: 10 }, { product_id: P.flag.id, crates: 10 },
  ] });
  clock += 20 * 60000;
  stock.createEntry(M, { supplier_id: sup2.id, invoice_no: "KZ-1102", paid_amount: 150000, payment_method: "Orange Money", lines: [
    { product_id: P.guinness.id, crates: 4 }, { product_id: P.coca.id, crates: 6 }, { product_id: P.fanta.id, crates: 4 }, { product_id: P.sprite.id, crates: 3 },
    { product_id: P.lafi.id, crates: 8 }, { product_id: P.dafani.id, crates: 2 }, { product_id: P.redbull.id, crates: 1 },
  ] });

  const drinks = [
    ["brakina", 34], ["castel", 18], ["beaufort", 10], ["flag", 12], ["guinness", 7], ["coca", 9], ["fanta", 6], ["sprite", 3], ["lafi", 8], ["dafani", 3], ["redbull", 3],
  ];
  const waiters = ["awa", "ali", "fatim"];
  const customers = ["Moumouni", "Rasmané", "Boukary", "Adama", "Salam"];
  const reserved = (pid) => get("SELECT COALESCE(SUM(ol.qty), 0) AS q FROM order_lines ol JOIN orders o ON o.id = ol.order_id WHERE o.status = 'pending' AND ol.product_id = ?", pid).q;
  const randomLines = () => {
    const n = weighted([[1, 4], [2, 4], [3, 2]]);
    const lines = new Map();
    for (let i = 0; i < n; i++) {
      const key = weighted(drinks);
      const free = stock.stockOf(P[key].id) - reserved(P[key].id) - (lines.get(P[key].id) || 0);
      const q = Math.min(weighted([[1, 3], [2, 4], [3, 2], [4, 1]]), free);
      if (q > 0) lines.set(P[key].id, (lines.get(P[key].id) || 0) + q);
    }
    return [...lines].map(([product_id, qty]) => ({ product_id, qty }));
  };
  const tryOp = (fn) => {
    try {
      return fn();
    } catch (e) {
      if (e.status && e.status < 500) return null; // ex. plus assez de stock : on passe
      throw e;
    }
  };
  const billetage = (amount) => {
    const out = {};
    let rest = amount;
    for (const d of cash.DENOMINATIONS) {
      if (d.key === "b500") continue;
      const n = Math.floor(rest / d.value);
      if (n) out[d.key] = n;
      rest -= n * d.value;
    }
    return rest === 0 ? out : undefined;
  };

  // Une journée de service : commandes des serveurs encaissées par le gérant (ou le caissier).
  function serviceDay(day, { till = "gerant", orders = 20, until = 23.0, close = true, pendingAtEnd = 0 } = {}) {
    const T = ctx(till);
    clock = at(day, 13.5); // 16 h 30
    if (!cash.openSessionOf(U[till].id)) cash.openSession(T, { opening_float: 10000 });
    clock = at(day, 14.5);
    const credits = [];
    const step = (until - 14.5) / Math.max(orders, 1);
    for (let i = 0; i < orders; i++) {
      clock = at(day, 14.5 + i * step + rnd() * step * 0.8);
      const lines = randomLines();
      if (!lines.length) continue;
      const table = `Table ${1 + Math.floor(rnd() * 12)}`;
      const o = sales.createOrder(ctx(pick(waiters)), { table_label: table, lines });
      if (i >= orders - pendingAtEnd) continue; // laissées en attente
      clock += (2 + Math.floor(rnd() * 6)) * 60000;
      const kind = weighted([["cash", 74], ["om", 14], ["moov", 5], ["credit", 4], ["partial", 3]]);
      const total = o.total;
      let payments = [{ method: "Espèces", amount: total }];
      let customer_name = "";
      if (kind === "om") payments = [{ method: "Orange Money", amount: total }];
      if (kind === "moov") payments = [{ method: "Moov Money", amount: total }];
      if (kind === "credit") (payments = []), (customer_name = pick(customers));
      if (kind === "partial") (payments = [{ method: "Espèces", amount: Math.floor(total / 2 / 100) * 100 || 100 }]), (customer_name = pick(customers));
      const s = sales.createSale(T, { order_ids: [o.id], payments: payments.filter((p) => p.amount > 0 && p.amount <= total), customer_name });
      if (s.status !== "paid") credits.push(s);
    }
    return { credits, till: T };
  }

  function closeDay(day, T, variance = 0) {
    clock = at(day, 23.25); // 02 h 15
    const s = cash.openSessionOf(T.user.id);
    if (!s) return;
    const sum = cash.sessionSummary(s.id);
    const counted = Object.fromEntries(sum.methods.map((m) => [m.method, m.method === "Espèces" ? m.theoretical + variance : m.theoretical]));
    cash.closeSession(T, { counted, billetage: billetage(counted["Espèces"]), note: variance ? "Écart constaté au comptage" : "" });
  }

  const days = time.daysBetween(firstDay, time.addDays(today, -1));
  let openCredits = [];
  days.forEach((day, idx) => {
    const dow = new Date(day + "T12:00:00Z").getUTCDay(); // 5 = vendredi, 6 = samedi
    const busy = dow === 5 || dow === 6 ? 30 : dow === 0 ? 22 : 16;
    const till = idx === 3 ? "caissier" : "gerant"; // un jour, le caissier remplace le gérant
    // Règlement de crédits de la veille
    clock = at(day, 14.0);
    if (openCredits.length) {
      const T = ctx(till);
      clock = at(day, 13.5);
      if (!cash.openSessionOf(U[till].id)) cash.openSession(T, { opening_float: 10000 });
      for (const c of openCredits.slice(0, 2)) {
        clock += 15 * 60000;
        const rem = get("SELECT total - paid AS r FROM sales WHERE id = ?", c.id).r;
        if (rem > 0) sales.addSalePayment(T, c.id, { amount: rem, method: "Espèces" });
      }
    }
    const { credits, till: T } = serviceDay(day, { till, orders: busy });
    openCredits = credits;
    // Sorties hors ventes, dépenses
    clock = at(day, 16.0);
    tryOp(() => cash.createExpense(T, { category: "Glace", description: "Sacs de glace pour les bacs", amount: weighted([[1000, 2], [1500, 2], [2000, 1]]), method: "Espèces" }));
    if (rnd() < 0.5) {
      clock = at(day, 19.0);
      tryOp(() => stock.createExit(M, { reason: "broken", lines: [{ product_id: P.brakina.id, extra_units: 1 + Math.floor(rnd() * 2) }], responsible_name: U[pick(waiters)].full_name, observation: "Bouteille tombée pendant le service" }));
    }
    if (dow === 6) {
      clock = at(day, 20.0);
      tryOp(() => stock.createExit(M, { reason: "offered", lines: [{ product_id: P.castel.id, extra_units: 2 }], observation: "Offert à un client fidèle (anniversaire)" }));
    }
    if (idx === 2) {
      clock = at(day, 21.0);
      tryOp(() => stock.createExit(M, { reason: "staff", lines: [{ product_id: P.lafi.id, extra_units: 2 }], observation: "Eau pour le personnel" }));
    }
    // Un jour : demande d'annulation du caissier, validée par le gérant
    if (till === "caissier") {
      clock = at(day, 18.0);
      const last = get("SELECT id FROM sales WHERE session_id = (SELECT id FROM cash_sessions WHERE cashier_id = ? AND status = 'open') AND status = 'paid' ORDER BY id DESC LIMIT 1", U.caissier.id);
      if (last) {
        const r = sales.requestCancelSale(ctx("caissier"), last.id, { reason: "Erreur de boisson : le client voulait une Castel" });
        clock += 5 * 60000;
        sales.decideCancelRequest(M, r.id, true, {});
      }
    }
    // Mi-semaine : commande au fournisseur d'après les ventes, livrée le lendemain avec un écart
    if (idx === 3) {
      clock = at(day, 8.0);
      const sug = purchases.reorderSuggestions({ supplier_id: sup1.id, coverage_days: 7 });
      let lines = sug.rows.filter((r) => r.suggested_qty > 0 && r.units_per_crate > 1).map((r) => ({ product_id: r.product_id, crates: Math.max(r.suggested_crates, 2), units_per_crate: r.units_per_crate }));
      if (!lines.length) lines = [{ product_id: P.brakina.id, crates: 10, units_per_crate: 12 }, { product_id: P.castel.id, crates: 5, units_per_crate: 12 }];
      if (lines.length) {
        const po = purchases.createPurchaseOrder(M, { supplier_id: sup1.id, expected_date: time.addDays(day, 1), lines, note: "Livraison avant 16 h s'il vous plaît" });
        clock = at(time.addDays(day, 1), 9.0);
        const got = lines.map((l, i) => ({ ...l, crates: i === 0 ? l.crates - 1 : l.crates }));
        const due = got.reduce((a, l) => a + l.crates * l.units_per_crate * catalog.productRow(l.product_id).purchase_price, 0);
        stock.createEntry(M, { po_id: po.id, invoice_no: "WK-0431", paid_amount: Math.round(due / 2 / 100) * 100, payment_method: "Espèces", lines: got });
      }
    }
    // Avant-dernier jour : inventaire avec un petit écart justifié
    if (idx === days.length - 2) {
      clock = at(day, 9.5);
      const inv = stock.createInventory(M, { kind: "weekly" });
      const counts = inv.lines.map((l) => ({ product_id: l.product_id, counted: l.product_id === P.coca.id ? Math.max(0, l.theoretical - 2) : l.theoretical, justification: l.product_id === P.coca.id ? "2 bouteilles introuvables au comptage" : "" }));
      stock.saveInventoryCounts(M, inv.id, { lines: counts });
      clock += 20 * 60000;
      stock.validateInventory(M, inv.id);
    }
    closeDay(day, T, idx === 1 ? -500 : idx === 4 ? 200 : 0);
    clock = at(time.addDays(day, 1), 0.02); // 03 h 01 : bilans automatiques
    reports.runDueReports();
  });

  // Aujourd'hui : la caisse du gérant est ouverte, quelques ventes, deux commandes en attente.
  const start = time.dayBounds(today).start;
  const span = Math.max(30 * 60000, realNow - start - 10 * 60000);
  clock = Math.max(start + 60000, realNow - Math.min(span, 4 * 3600000));
  cash.openSession(M, { opening_float: 10000 });
  for (let i = 0; i < 6; i++) {
    clock += Math.max(60000, Math.floor((realNow - 8 * 60000 - clock) / (8 - i)));
    if (clock > realNow - 5 * 60000) break;
    const lines = randomLines();
    if (!lines.length) continue;
    const o = sales.createOrder(ctx(pick(waiters)), { table_label: `Table ${1 + i}`, lines });
    clock += 60000;
    sales.createSale(M, { order_ids: [o.id], payments: [{ method: "Espèces", amount: o.total }] });
  }
  clock = realNow - 4 * 60000;
  sales.createOrder(ctx("awa"), { table_label: "Table 9", lines: [{ product_id: P.brakina.id, qty: 3 }, { product_id: P.coca.id, qty: 1 }] });
  clock = realNow - 2 * 60000;
  sales.createOrder(ctx("ali"), { table_label: "Table 9", lines: [{ product_id: P.castel.id, qty: 2 }] });
  // Les anciennes notifications sont marquées comme lues (sinon des centaines s'afficheraient).
  run("UPDATE notifications SET read_at = at WHERE at < ?", start);
}
