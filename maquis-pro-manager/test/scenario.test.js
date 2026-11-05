// Scénario complet d'une semaine dans un maquis : les 18 tests obligatoires du cahier des charges.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { start, stop, install, login, client, time, db, reports, DATA_DIR } from "./helpers.js";

// Lundi 2 novembre 2026, 18 h 00 à Ouagadougou (UTC+0).
const T0 = Date.UTC(2026, 10, 2, 18, 0);
let clock = T0;
const at = (iso) => (clock = Date.parse(iso));
time.setClock(() => clock);

let A; // comptes
const P = {}; // produits
let supplier;
let saleDoc;

before(async () => {
  await start();
  A = await install();
});
after(stop);

// Après un saut de plusieurs jours, la déconnexion automatique pour inactivité a joué : on se reconnecte.
async function relogAll() {
  A.owner = await login("patron", "Patron2026!", "owner");
  A.manager = await login("gerant", "Gerant2026!b", "manager");
  A.cashier = await login("caisse", "Caisse26b", "cashier");
  A.waiter = await login("serveur1", "Serveur1b", "waiter");
}

const stockOf = async (pid) => (await A.manager.ok("GET", "/api/stock")).find((p) => p.id === pid).stock;

test("préparation : fournisseur et catalogue de boissons", async () => {
  const cats = await A.manager.ok("GET", "/api/categories");
  const cat = (n) => cats.find((c) => c.name === n).id;
  supplier = await A.manager.ok("POST", "/api/suppliers", { name: "Brakina SA", phone: "+226 25 00 00 00", address: "Ouagadougou" });
  const mk = (name, brand, category, purchase_price, sale_price, units_per_crate, min_stock) =>
    A.manager.ok("POST", "/api/products", { name, brand, category_id: cat(category), purchase_price, sale_price, units_per_crate, min_stock, supplier_id: supplier.id });
  P.brakina = await mk("Brakina 65 cl", "Brakina", "Bières", 450, 700, 12, 24);
  P.castel = await mk("Castel 65 cl", "Castel", "Bières", 500, 750, 12, 12);
  P.coca = await mk("Coca-Cola 30 cl", "Coca-Cola", "Sucreries", 300, 500, 24, 24);
  P.lafi = await mk("Eau Lafi 1,5 L", "Lafi", "Eaux minérales", 250, 500, 12, 6);
  assert.equal(P.brakina.stock, 0);
  assert.match(P.brakina.reference, /^P\d{4}$/);
});

test("1. une entrée de 10 casiers de 12 (120 bouteilles) augmente le stock de 120", async () => {
  const r = await A.manager.ok("POST", "/api/entries", {
    supplier_id: supplier.id,
    invoice_no: "FAC-001",
    lines: [
      { product_id: P.brakina.id, crates: 10 },
      { product_id: P.castel.id, crates: 5 },
      { product_id: P.coca.id, crates: 8, units_per_crate: 24 },
      { product_id: P.lafi.id, crates: 2, extra_units: 6 },
    ],
    paid_amount: 50000,
    payment_method: "Espèces",
  });
  assert.equal(r.qty, 120 + 60 + 192 + 30);
  assert.equal(r.total, 120 * 450 + 60 * 500 + 192 * 300 + 30 * 250);
  assert.equal(await stockOf(P.brakina.id), 120);
  assert.equal(await stockOf(P.castel.id), 60);
  assert.equal(await stockOf(P.coca.id), 192);
  const entry = await A.manager.ok("GET", `/api/entries/${r.id}`);
  assert.equal(entry.lines.find((l) => l.product_id === P.brakina.id).qty, 120);
  assert.equal(entry.total_amount - entry.paid_amount, r.total - 50000);
  const sup = await A.manager.ok("GET", `/api/suppliers/${supplier.id}`);
  assert.equal(sup.debt, r.total - 50000);
});

test("7. reçu d'entrée généré, numéroté et téléchargeable en PDF", async () => {
  const docs = await A.owner.ok("GET", "/api/documents?type=entry");
  assert.equal(docs.length, 1);
  assert.match(docs[0].doc_no, /^ENT-2026-\d{6}$/);
  const d = await A.owner.ok("GET", `/api/documents/${docs[0].doc_no}`);
  assert.equal(d.payload.maquis.name, "Maquis Le Baobab");
  assert.ok(d.payload.rows.some((r) => r[0].includes("Brakina") && r[4] === "120"));
  const pdf = await A.owner.get(`/api/documents/${docs[0].doc_no}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.equal(pdf.data.subarray(0, 5).toString(), "%PDF-");
});

test("10. permissions des quatre comptes vérifiées côté serveur", async () => {
  const anon = client("anonyme");
  assert.equal((await anon.get("/api/stock")).status, 401);
  assert.equal((await A.waiter.get("/api/stock")).status, 403);
  assert.equal((await A.waiter.post("/api/sales", { lines: [{ product_id: P.brakina.id, qty: 1 }] })).status, 403);
  assert.equal((await A.cashier.post("/api/products", { name: "X", brand: "X", category_id: 1, purchase_price: 1, sale_price: 2 })).status, 403);
  assert.equal((await A.cashier.patch(`/api/products/${P.brakina.id}`, { purchase_price: 1 })).status, 403);
  assert.equal((await A.cashier.post("/api/entries", { lines: [{ product_id: P.brakina.id, crates: 1 }] })).status, 403);
  assert.equal((await A.manager.post("/api/sales", { lines: [{ product_id: P.brakina.id, qty: 1 }] })).status, 403);
  assert.equal((await A.waiter.get("/api/dashboard")).status, 403);
  assert.equal((await A.cashier.get("/api/reports")).status, 403);
  assert.equal((await A.manager.get("/api/audit")).status, 403);
  // Les serveurs et caissiers ne voient pas les prix d'achat.
  const seen = await A.waiter.ok("GET", "/api/products");
  assert.equal(seen[0].purchase_price, undefined);
  assert.equal(seen[0].sale_price > 0, true);
  // Une écriture sans l'en-tête de l'application est refusée (protection CSRF).
  assert.equal((await A.manager.post("/api/exits", {}, { "X-Requested-With": "" })).status, 403);
  // Le gérant ne peut pas créer de compte propriétaire ou gérant.
  assert.equal((await A.manager.post("/api/users", { role: "manager", username: "autre", full_name: "Autre", password: "Autre2026!!" })).status, 403);
});

test("11. le propriétaire consulte tout mais ne peut modifier aucune opération", async () => {
  for (const [url, body] of [
    ["/api/entries", { lines: [{ product_id: P.brakina.id, crates: 1 }] }],
    ["/api/exits", { reason: "broken", lines: [{ product_id: P.brakina.id, extra_units: 1 }] }],
    ["/api/sales", { lines: [{ product_id: P.brakina.id, qty: 1 }] }],
    ["/api/orders", { lines: [{ product_id: P.brakina.id, qty: 1 }] }],
    ["/api/expenses", { category: "Glace", description: "test", amount: 100 }],
    ["/api/cash/movements", { kind: "withdrawal", amount: 100, reason: "test" }],
    ["/api/entries/1/cancel", { reason: "falsification" }],
  ]) {
    assert.equal((await A.owner.post(url, body)).status, 403, url);
  }
  assert.equal((await A.owner.patch(`/api/products/${P.brakina.id}`, { sale_price: 1 })).status, 403);
  assert.ok((await A.owner.ok("GET", "/api/stock")).length >= 4);
  assert.ok((await A.owner.ok("GET", "/api/dashboard")).stock.bottles > 0);
  // Même directement dans la base, une opération validée ne peut être ni modifiée ni effacée.
  assert.throws(() => db.run("UPDATE stock_movements SET qty = 999 WHERE id = 1"), /interdite/);
  assert.throws(() => db.run("DELETE FROM documents"), /interdite/);
  assert.throws(() => db.run("UPDATE entries SET total_amount = 1"), /non modifiables/);
  assert.throws(() => db.run("DELETE FROM audit_log"), /interdite/);
});

test("2 et 4. vendre 10 bouteilles diminue le stock et la vente est rattachée au serveur", async () => {
  at("2026-11-02T19:00:00Z");
  assert.equal((await A.cashier.post("/api/sales", { lines: [{ product_id: P.brakina.id, qty: 1 }] })).status, 400); // caisse fermée
  await A.cashier.ok("POST", "/api/cash/open", { opening_float: 10000 });
  const order = await A.waiter.ok("POST", "/api/orders", { table_label: "Table 4", lines: [{ product_id: P.brakina.id, qty: 10 }] });
  assert.equal(order.status, "pending");
  assert.equal(order.total, 7000);
  assert.equal(await stockOf(P.brakina.id), 120); // la commande seule ne sort rien du stock
  const pending = await A.cashier.ok("GET", "/api/orders?status=pending");
  assert.equal(pending.length, 1);
  const sale = await A.cashier.ok("POST", "/api/sales", { order_id: order.id, payments: [{ method: "Espèces", amount: 7000 }] });
  saleDoc = sale.doc_no;
  assert.equal(sale.status, "paid");
  assert.equal(await stockOf(P.brakina.id), 110);
  // Pas de double comptage : la vente est une seule sortie « vendue ».
  const mv = await A.manager.ok("GET", `/api/movements?product_id=${P.brakina.id}&kind=exits`);
  assert.equal(mv.length, 1);
  assert.equal(mv[0].kind, "sale");
  assert.equal(mv[0].waiter_name, "Ali Traoré");
  // Une commande déjà encaissée ne peut pas l'être une deuxième fois.
  assert.equal((await A.cashier.post("/api/sales", { order_id: order.id, payments: [] })).status, 400);
  const mine = await A.waiter.ok("GET", "/api/my-stats");
  assert.equal(mine.bottles, 10);
  assert.equal(mine.amount, 7000);
  // Le stock ne peut pas devenir négatif par une vente normale.
  const tooMuch = await A.cashier.post("/api/sales", { lines: [{ product_id: P.brakina.id, qty: 500 }], payments: [{ method: "Espèces", amount: 350000 }] });
  assert.equal(tooMuch.status, 409);
  assert.match(tooMuch.data.error, /Stock insuffisant/);
});

test("3. trois bouteilles cassées sont comptées à part", async () => {
  at("2026-11-02T20:00:00Z");
  const r = await A.manager.ok("POST", "/api/exits", { reason: "broken", lines: [{ product_id: P.brakina.id, extra_units: 3 }], responsible_name: "Ali Traoré", waiter_id: (await A.waiter.ok("GET", "/api/me")).user.id, observation: "Casier tombé" });
  assert.match(r.doc_no, /^SOR-/);
  assert.equal(await stockOf(P.brakina.id), 107);
  const preview = (await A.manager.ok("GET", "/api/reports/preview")).data;
  const b = preview.exits.by_product.find((x) => x.product_id === P.brakina.id);
  assert.equal(b.sale, 10);
  assert.equal(b.broken, 3);
  assert.equal(b.total, 13);
  assert.equal(preview.exits.by_kind.broken, 3);
  assert.equal(preview.sales.bottles, 10);
});

test("6. ventes à crédit et paiements partiels", async () => {
  at("2026-11-02T21:00:00Z");
  const waiter2 = (await A.waiter2.ok("GET", "/api/me")).user.id;
  // Crédit sans nom de client : refusé.
  assert.equal((await A.cashier.post("/api/sales", { lines: [{ product_id: P.castel.id, qty: 4 }], payments: [{ method: "Espèces", amount: 1000 }] })).status, 400);
  const partial = await A.cashier.ok("POST", "/api/sales", { waiter_id: waiter2, customer_name: "Kouka", lines: [{ product_id: P.castel.id, qty: 4 }], payments: [{ method: "Espèces", amount: 1000 }] });
  assert.equal(partial.status, "partial");
  assert.equal(partial.remaining, 2000);
  const credit = await A.cashier.ok("POST", "/api/sales", { customer_name: "Bila", lines: [{ product_id: P.coca.id, qty: 2 }], payments: [] });
  assert.equal(credit.status, "credit");
  assert.equal(await stockOf(P.castel.id), 56); // le crédit diminue le stock
  const credits = await A.cashier.ok("GET", "/api/credits");
  assert.equal(credits.length, 2);
  // Un paiement ne peut pas dépasser le reste dû.
  assert.equal((await A.cashier.post(`/api/sales/${partial.id}/payments`, { amount: 5000, method: "Espèces" })).status, 400);
  const pay = await A.cashier.ok("POST", `/api/sales/${partial.id}/payments`, { amount: 2000, method: "Orange Money" });
  assert.equal(pay.status, "paid");
  assert.match(pay.doc_no, /^PAI-/);
  assert.equal((await A.cashier.ok("GET", "/api/credits")).length, 1);
});

test("5 et 15. encaissements et calculs de caisse (solde théorique, physique, écart)", async () => {
  at("2026-11-02T22:00:00Z");
  await A.cashier.ok("POST", "/api/expenses", { category: "Glace", description: "Deux sacs de glace", amount: 1500, method: "Espèces" });
  await A.cashier.ok("POST", "/api/cash/movements", { kind: "withdrawal", amount: 5000, method: "Espèces", reason: "Remis au gérant" });
  await A.cashier.ok("POST", "/api/cash/movements", { kind: "deposit", amount: 2000, method: "Espèces", reason: "Monnaie apportée" });
  // Un retrait supérieur au solde est refusé.
  assert.equal((await A.cashier.post("/api/cash/movements", { kind: "withdrawal", amount: 900000, method: "Espèces", reason: "Trop" })).status, 400);
  const cur = (await A.cashier.ok("GET", "/api/cash/current")).session;
  const cashRow = cur.methods.find((m) => m.method === "Espèces");
  const om = cur.methods.find((m) => m.method === "Orange Money");
  // 10 000 + 7 000 + 1 000 + 2 000 - 1 500 - 5 000 = 13 500
  assert.equal(cashRow.theoretical, 13500);
  assert.equal(om.theoretical, 2000);
  assert.equal(cur.totals.collected, 10000); // 7 000 + 1 000 + 2 000 (le crédit de Bila n'est pas encaissé)
  assert.equal(cur.totals.theoretical, 15500);
  assert.equal(cur.sales.credit_given, 2000 + 1000);
  // Fermeture avec 500 FCFA manquants en espèces.
  assert.equal((await A.cashier.post("/api/cash/close", { counted: { Espèces: 13000 } })).status, 400); // Orange Money non compté
  const close = await A.cashier.ok("POST", "/api/cash/close", { counted: { Espèces: 13000, "Orange Money": 2000 }, note: "Fin de service" });
  assert.equal(close.theoretical, 15500);
  assert.equal(close.counted, 15000);
  assert.equal(close.variance, -500);
  assert.match(close.doc_no, /^CLO-/);
  const notifs = (await A.owner.ok("GET", "/api/notifications")).items;
  assert.ok(notifs.some((n) => n.type === "cash_variance" && n.body.includes("-500")));
  const pdf = await A.owner.get(`/api/documents/${close.doc_no}/pdf`);
  assert.equal(pdf.data.subarray(0, 5).toString(), "%PDF-");
});

test("8 et 9. reçus de sortie et de vente téléchargeables, imprimables, recherchables", async () => {
  const exitsDocs = await A.manager.ok("GET", "/api/documents?type=exit");
  assert.equal(exitsDocs.length, 1);
  for (const no of [exitsDocs[0].doc_no, saleDoc]) {
    const pdf = await A.manager.get(`/api/documents/${no}/pdf`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.data.subarray(0, 5).toString(), "%PDF-");
    assert.ok(pdf.data.length > 1500);
    const html = await A.manager.get(`/api/documents/${no}/print`);
    assert.equal(html.status, 200);
    assert.match(html.data.toString(), new RegExp(no));
  }
  // Recherche par boisson, par numéro, par responsable et par type.
  assert.ok((await A.manager.ok("GET", "/api/documents?q=brakina")).length >= 3);
  assert.equal((await A.manager.ok("GET", `/api/documents?q=${saleDoc}`))[0].doc_no, saleDoc);
  assert.ok((await A.manager.ok("GET", "/api/documents?q=sawadogo")).length >= 3);
  // Le serveur ne voit que les reçus de ses propres ventes.
  const waiterDocs = await A.waiter.ok("GET", "/api/documents");
  assert.deepEqual(waiterDocs.map((d) => d.doc_no), [saleDoc]);
  assert.equal((await A.waiter.get(`/api/documents/${exitsDocs[0].doc_no}`)).status, 403);
});

test("annulation traçable d'une vente : stock remis, remboursement et document rectificatif", async () => {
  at("2026-11-02T23:00:00Z");
  await A.cashier.ok("POST", "/api/cash/open", { opening_float: 5000 });
  const s = await A.cashier.ok("POST", "/api/sales", { lines: [{ product_id: P.lafi.id, qty: 2 }], payments: [{ method: "Espèces", amount: 1000 }] });
  assert.equal(await stockOf(P.lafi.id), 28);
  assert.equal((await A.cashier.post(`/api/sales/${s.id}/cancel`, { reason: "" })).status, 400); // motif obligatoire
  const c = await A.cashier.ok("POST", `/api/sales/${s.id}/cancel`, { reason: "Erreur de saisie, client parti" });
  assert.match(c.doc_no, /^ANN-/);
  assert.equal(c.refunds.length, 1);
  assert.equal(await stockOf(P.lafi.id), 30);
  const original = await A.owner.ok("GET", `/api/documents/${s.doc_no}`);
  assert.equal(original.payload.status.label, "PAYÉ"); // le reçu d'origine n'est jamais modifié
  assert.ok(original.related.some((r) => r.doc_no === c.doc_no));
  const cur = (await A.cashier.ok("GET", "/api/cash/current")).session;
  assert.equal(cur.methods.find((m) => m.method === "Espèces").theoretical, 5000);
  const audit = await A.owner.ok("GET", "/api/audit?q=annul");
  assert.ok(audit.some((a) => a.action === "vente_annulee"));
});

test("12 et 14. bilan quotidien automatique à 03 h 00 avec les quantités par marque", async () => {
  at("2026-11-03T02:59:00Z");
  assert.equal(reports.runDueReports().length, 0); // la journée n'est pas finie
  at("2026-11-03T03:00:20Z");
  const done = reports.runDueReports();
  assert.equal(done.length, 1);
  assert.equal(done[0].key, "2026-11-02");
  assert.equal(reports.runDueReports().length, 0); // jamais deux fois
  const list = await A.owner.ok("GET", "/api/reports?kind=daily");
  const r = await A.owner.ok("GET", `/api/reports/${list[0].id}`);
  assert.equal(r.trigger, "automatique");
  const d = r.data;
  assert.equal(d.period.key, "2026-11-02");
  assert.equal(d.exits.total_bottles, 10 + 3 + 4 + 2); // la vente annulée ne compte plus
  assert.equal(d.exits.by_kind.sale, 16);
  assert.equal(d.exits.by_kind.broken, 3);
  const brakina = d.exits.by_brand.find((b) => b.brand === "Brakina");
  assert.equal(brakina.total, 13);
  assert.equal(brakina.sold, 10);
  assert.equal(d.exits.by_brand.find((b) => b.brand === "Castel").total, 4);
  assert.equal(d.exits.by_brand.find((b) => b.brand === "Coca-Cola").total, 2);
  assert.equal(d.exits.by_category.find((c) => c.category === "Bières").total, 17);
  assert.equal(d.sales.amount, 7000 + 3000 + 1000);
  assert.equal(d.sales.collected, 7000 + 1000 + 2000 + 1000);
  assert.equal(d.sales.refunds, 1000);
  assert.equal(d.sales.credit_given, 3000);
  assert.equal(d.analysis.best_seller.brand, "Brakina");
  assert.equal(d.sales.by_waiter.find((w) => w.waiter === "Ali Traoré").bottles, 10);
  assert.equal(d.cash.variance_total, -500);
  assert.ok(d.analysis.observations.some((o) => o.includes("Pertes")));
  // Notification au propriétaire et au gérant, PDF téléchargeable.
  for (const who of [A.owner, A.manager]) {
    const n = (await who.ok("GET", "/api/notifications")).items;
    assert.ok(n.some((x) => x.type === "daily_report"));
  }
  const pdf = await A.owner.get(`/api/reports/${r.id}/pdf`);
  assert.equal(pdf.data.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.data.length > 4000);
  const viaDoc = await A.owner.get(`/api/documents/${r.doc_no}/pdf`);
  assert.equal(viaDoc.status, 200);
});

test("16 et 17. hors connexion : synchronisation sans doublon, bilan rectificatif si la journée est close", async () => {
  at("2026-11-03T10:00:00Z");
  await A.waiter.ok("POST", "/api/auth/logout");
  A.waiter = await login("serveur1", "Serveur1b", "waiter");
  // Une vente faite hors connexion la veille à 01 h 30 (journée commerciale du 2 novembre).
  const occurred = Date.parse("2026-11-03T01:30:00Z");
  const headers = { "Idempotency-Key": "op-hors-ligne-0001", "X-Offline": "1", "X-Occurred-At": String(occurred) };
  const before = await stockOf(P.coca.id);
  const s1 = await A.cashier.ok("POST", "/api/sales", { lines: [{ product_id: P.coca.id, qty: 3 }], payments: [{ method: "Espèces", amount: 1500 }] }, headers);
  const s2 = await A.cashier.ok("POST", "/api/sales", { lines: [{ product_id: P.coca.id, qty: 3 }], payments: [{ method: "Espèces", amount: 1500 }] }, headers);
  assert.equal(s2.replayed, true);
  assert.equal(s1.doc_no, s2.doc_no);
  assert.equal(await stockOf(P.coca.id), before - 3);
  const sale = await A.cashier.ok("GET", `/api/sales/${s1.id}`);
  assert.equal(sale.business_day, "2026-11-02");
  // Commande d'un serveur renvoyée trois fois : une seule commande.
  const oh = { "Idempotency-Key": "op-commande-0002", "X-Offline": "1", "X-Occurred-At": String(Date.now()) };
  for (let i = 0; i < 3; i++) await A.waiter.ok("POST", "/api/orders", { lines: [{ product_id: P.lafi.id, qty: 1 }] }, oh);
  assert.equal((await A.waiter.ok("GET", "/api/orders?status=pending")).length, 1);
  // Le bilan du 2 novembre est rectifié (version 2) et l'original reste disponible.
  const done = reports.runDueReports();
  assert.ok(done.some((r) => r.kind === "daily" && r.key === "2026-11-02" && r.version === 2));
  const versions = (await A.owner.ok("GET", "/api/reports?kind=daily")).filter((r) => r.period_key === "2026-11-02");
  assert.equal(versions.length, 2);
  const v2 = await A.owner.ok("GET", `/api/reports/${versions.find((v) => v.version === 2).id}`);
  assert.equal(v2.data.exits.by_brand.find((b) => b.brand === "Coca-Cola").total, 5);
  assert.equal(v2.data.rectifies, "BJ-2026-11-02");
  const v1 = await A.owner.ok("GET", `/api/reports/${versions.find((v) => v.version === 1).id}`);
  assert.equal(v1.data.exits.by_brand.find((b) => b.brand === "Coca-Cola").total, 2);
});

test("13. bilan hebdomadaire du lundi 03 h 00, PDF et Excel", async () => {
  // Quelques ventes le jeudi (après plus de 12 h d'inactivité, la session s'est fermée toute seule).
  at("2026-11-05T20:00:00Z");
  assert.equal((await A.cashier.get("/api/cash/current")).status, 401);
  await relogAll();
  await A.cashier.ok("POST", "/api/sales", { lines: [{ product_id: P.castel.id, qty: 6 }, { product_id: P.lafi.id, qty: 2 }], payments: [{ method: "Moov Money", amount: 5500 }] });
  await A.manager.ok("POST", "/api/exits", { reason: "offered", lines: [{ product_id: P.coca.id, extra_units: 2 }], observation: "Offert au client fidèle" });
  // Le serveur était éteint dimanche soir : il redémarre lundi 9 à 08 h 00.
  at("2026-11-09T08:00:00Z");
  const done = reports.runDueReports();
  await relogAll();
  const weekly = done.find((r) => r.kind === "weekly");
  assert.ok(weekly, "le bilan hebdomadaire est produit à la reprise");
  assert.equal(weekly.key, "2026-11-02");
  assert.equal(done.filter((r) => r.kind === "daily").length, 6); // du 3 au 8 novembre
  const r = await A.owner.ok("GET", `/api/reports/${weekly.id}`);
  assert.equal(r.trigger, "reprise");
  const s = r.data.summary;
  assert.equal(s.revenue, 7000 + 3000 + 1000 + 1500 + 5500);
  assert.equal(s.bottles_sold, 10 + 4 + 2 + 3 + 8);
  assert.equal(s.expenses, 1500);
  assert.equal(s.broken, 3);
  assert.equal(s.offered, 2);
  assert.equal(s.cash_variance, -500);
  assert.equal(s.gross_profit, s.revenue - s.cogs);
  assert.equal(s.cogs, 10 * 450 + 4 * 500 + 5 * 300 + 6 * 500 + 2 * 250);
  assert.ok(r.data.sales.by_waiter.length >= 2);
  assert.equal(r.data.daily.length, 7);
  assert.equal(r.data.stock_end.find((x) => x.product_id === P.brakina.id).stock, 107);
  const pdf = await A.manager.get(`/api/reports/${weekly.id}/pdf`);
  assert.equal(pdf.data.subarray(0, 5).toString(), "%PDF-");
  const xlsx = await A.manager.get(`/api/reports/${weekly.id}/xlsx`);
  assert.equal(xlsx.status, 200);
  assert.equal(xlsx.data.subarray(0, 2).toString(), "PK");
  assert.ok((await A.owner.ok("GET", "/api/notifications")).items.some((n) => n.type === "weekly_report"));
});

test("inventaire physique : écart signalé, justifié et ajusté", async () => {
  const inv = await A.manager.ok("POST", "/api/inventories", { kind: "weekly" });
  const line = inv.lines.find((l) => l.product_id === P.brakina.id);
  assert.equal(line.theoretical, 107);
  await A.manager.ok("PUT", `/api/inventories/${inv.id}`, { lines: [{ product_id: P.brakina.id, counted: 105 }] });
  assert.equal((await A.manager.post(`/api/inventories/${inv.id}/validate`)).status, 400); // écart non justifié
  await A.manager.ok("PUT", `/api/inventories/${inv.id}`, { lines: [{ product_id: P.brakina.id, counted: 105, justification: "Deux bouteilles introuvables" }] });
  const v = await A.manager.ok("POST", `/api/inventories/${inv.id}/validate`);
  assert.equal(v.gaps, 1);
  assert.equal(await stockOf(P.brakina.id), 105);
  assert.ok((await A.owner.ok("GET", "/api/notifications")).items.some((n) => n.title === "Écarts d'inventaire"));
});

test("journal d'audit : chaîne d'empreintes intacte et connexions enregistrées", async () => {
  const v = await A.owner.ok("GET", "/api/audit/verify");
  assert.equal(v.ok, true);
  assert.ok(v.count > 20);
  const logins = await A.owner.ok("GET", "/api/login-events");
  assert.ok(logins.length >= 5);
  const devices = await A.owner.ok("GET", "/api/devices");
  assert.ok(devices.length >= 4);
});

test("18. sauvegarde puis restauration", async () => {
  const b = await A.owner.ok("POST", "/api/backups");
  assert.match(b.name, /^maquis-\d{8}-\d{6}\.db$/);
  const list = await A.owner.ok("GET", "/api/backups");
  assert.ok(list.backups.some((x) => x.name === b.name));
  const dl = await A.owner.get(`/api/backups/${b.name}`);
  assert.equal(dl.status, 200);
  assert.equal(dl.data.subarray(0, 15).toString(), "SQLite format 3");
  // Après la sauvegarde, un nouveau produit est créé… puis on restaure.
  await A.manager.ok("POST", "/api/products", { name: "Sprite 30 cl", brand: "Sprite", category_id: 2, purchase_price: 300, sale_price: 500 });
  assert.equal((await A.manager.ok("GET", "/api/products")).length, 5);
  const { scheduleRestore, backupPath } = await import("../src/backup.js");
  scheduleRestore(backupPath(b.name));
  db.closeDb();
  db.openDb(DATA_DIR);
  const products = db.all("SELECT name FROM products");
  assert.equal(products.length, 4);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM reports").n > 0, true);
  assert.equal(db.all("SELECT * FROM stock_movements").reduce((s, m) => (m.product_id === P.brakina.id ? s + m.qty : s), 0), 105);
});
