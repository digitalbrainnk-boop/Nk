// Nouvelles fonctions : bons de commande, additions, encaissement d'une table, commandes fournisseurs,
// fiche de stock, billetage, rentabilité par boisson, point des serveurs.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { start, stop, install, login, time, reports } from "./helpers.js";

// Lundi 9 novembre 2026, 18 h 00 à Ouagadougou.
let clock = Date.UTC(2026, 10, 9, 18, 0);
time.setClock(() => clock);
const at = (iso) => (clock = Date.parse(iso));

let A;
const P = {};
let supplier;
let W1;
let W2;
const stockOf = async (pid) => (await A.manager.ok("GET", "/api/stock")).find((p) => p.id === pid).stock;

before(async () => {
  await start();
  A = await install();
  const cats = await A.manager.ok("GET", "/api/categories");
  const cat = (n) => cats.find((c) => c.name === n).id;
  supplier = await A.manager.ok("POST", "/api/suppliers", { name: "Brakina SA" });
  const mk = (name, brand, c, pp, sp, upc, min) => A.manager.ok("POST", "/api/products", { name, brand, category_id: cat(c), purchase_price: pp, sale_price: sp, units_per_crate: upc, min_stock: min, supplier_id: supplier.id });
  P.brakina = await mk("Brakina 65 cl", "Brakina", "Bières", 450, 700, 12, 24);
  P.castel = await mk("Castel 65 cl", "Castel", "Bières", 500, 750, 12, 12);
  P.coca = await mk("Coca-Cola 30 cl", "Coca-Cola", "Sucreries", 300, 500, 24, 0);
  await A.manager.ok("POST", "/api/entries", { supplier_id: supplier.id, lines: [{ product_id: P.brakina.id, crates: 5 }, { product_id: P.castel.id, crates: 2 }, { product_id: P.coca.id, crates: 1 }] });
  W1 = (await A.waiter.ok("GET", "/api/me")).user.id;
  W2 = (await A.waiter2.ok("GET", "/api/me")).user.id;
  await A.cashier.ok("POST", "/api/cash/open", { opening_float: 5000 });
});
after(stop);

test("bon de commande imprimable créé avec chaque commande", async () => {
  const o = await A.waiter.ok("POST", "/api/orders", { table_label: "Table 7", lines: [{ product_id: P.brakina.id, qty: 4 }] });
  assert.equal(o.documents.length, 1);
  assert.equal(o.documents[0].doc_no, o.order_no);
  const d = await A.waiter.ok("GET", `/api/documents/${o.order_no}`);
  assert.equal(d.type, "order");
  assert.equal(d.payload.status.label, "À ENCAISSER");
  const pdf = await A.waiter.get(`/api/documents/${o.order_no}/pdf`);
  assert.equal(pdf.data.subarray(0, 5).toString(), "%PDF-");
  // Le caissier voit les bons ; l'autre serveur, non.
  assert.equal((await A.cashier.get(`/api/documents/${o.order_no}`)).status, 200);
  assert.equal((await A.waiter2.get(`/api/documents/${o.order_no}`)).status, 403);
});

test("addition d'une table puis encaissement de toute la table en une fois (deux serveurs)", async () => {
  const o2 = await A.waiter2.ok("POST", "/api/orders", { table_label: "Table 7", lines: [{ product_id: P.castel.id, qty: 2 }, { product_id: P.brakina.id, qty: 1 }] });
  const pending = (await A.cashier.ok("GET", "/api/orders?status=pending")).filter((o) => o.table_label === "Table 7");
  assert.equal(pending.length, 2);
  const ids = pending.map((o) => o.id);
  // Un serveur ne peut pas imprimer l'addition de la commande d'un autre.
  assert.equal((await A.waiter.post("/api/orders/bill", { order_ids: ids })).status, 403);
  const bill = await A.cashier.ok("POST", "/api/orders/bill", { order_ids: ids });
  assert.equal(bill.total, 4 * 700 + 2 * 750 + 700);
  const billDoc = await A.cashier.ok("GET", `/api/documents/${bill.doc_no}`);
  assert.match(bill.doc_no, /^ADD-/);
  assert.equal(billDoc.payload.status.label, "À PAYER");
  // Encaissement groupé
  const sale = await A.cashier.ok("POST", "/api/sales", { order_ids: ids, payments: [{ method: "Espèces", amount: bill.total }] });
  assert.equal(sale.total, bill.total);
  assert.equal(sale.status, "paid");
  for (const o of await Promise.all(ids.map((id) => A.cashier.ok("GET", `/api/orders/${id}`)))) assert.equal(o.status, "served");
  assert.equal(await stockOf(P.brakina.id), 60 - 5);
  // Chaque bouteille reste attribuée à son serveur.
  const s1 = await A.waiter.ok("GET", "/api/my-stats");
  const s2 = await A.waiter2.ok("GET", "/api/my-stats");
  assert.equal(s1.bottles, 4);
  assert.equal(s1.amount, 2800);
  assert.equal(s2.bottles, 3);
  assert.equal(s2.amount, 2200);
  // Les deux serveurs voient le reçu de la vente groupée.
  assert.equal((await A.waiter.get(`/api/documents/${sale.doc_no}`)).status, 200);
  assert.equal((await A.waiter2.get(`/api/documents/${sale.doc_no}`)).status, 200);
  const preview = (await A.manager.ok("GET", "/api/reports/preview")).data;
  const byW = Object.fromEntries(preview.sales.by_waiter.map((w) => [w.waiter, w]));
  assert.equal(byW["Ali Traoré"].bottles, 4);
  assert.equal(byW["Fatim Zongo"].bottles, 3);
  assert.equal(byW["Ali Traoré"].sales, 1);
  assert.equal(o2.status, "pending");
});

test("la vente garde le prix annoncé à la commande, même si le prix change entre-temps", async () => {
  const o = await A.waiter.ok("POST", "/api/orders", { lines: [{ product_id: P.coca.id, qty: 2 }] });
  assert.equal(o.total, 1000);
  await A.manager.ok("PATCH", `/api/products/${P.coca.id}`, { sale_price: 600 });
  const sale = await A.cashier.ok("POST", "/api/sales", { order_id: o.id, payments: [{ method: "Espèces", amount: 1000 }] });
  assert.equal(sale.total, 1000);
  assert.equal(sale.status, "paid");
  // Une vente directe prend le nouveau prix.
  const direct = await A.cashier.ok("POST", "/api/sales", { lines: [{ product_id: P.coca.id, qty: 1 }], payments: [{ method: "Espèces", amount: 600 }] });
  assert.equal(direct.total, 600);
});

test("commande fournisseur : quantités suggérées, bon PDF, réception partielle puis complète", async () => {
  // Quelques jours de ventes de Brakina pour l'historique.
  for (const [day, qty] of [["2026-11-10", 12], ["2026-11-11", 12], ["2026-11-12", 12]]) {
    at(`${day}T20:00:00Z`);
    A.cashier = await login("caisse", "Caisse26b", "cashier");
    await A.cashier.post("/api/cash/open", { opening_float: 0 });
    await A.cashier.ok("POST", "/api/sales", { lines: [{ product_id: P.brakina.id, qty }], payments: [{ method: "Espèces", amount: qty * 700 }] });
  }
  at("2026-11-13T10:00:00Z");
  // Plusieurs jours ont passé : déconnexion automatique pour inactivité, on se reconnecte.
  A.manager = await login("gerant", "Gerant2026!b", "manager");
  A.owner = await login("patron", "Patron2026!", "owner");
  A.cashier = await login("caisse", "Caisse26b", "cashier");
  A.waiter = await login("serveur1", "Serveur1b", "waiter");
  const stockNow = await stockOf(P.brakina.id); // 55 - 36 = 19
  assert.equal(stockNow, 19);
  const sug = await A.manager.ok("GET", `/api/purchase-orders/suggestions?supplier_id=${supplier.id}&coverage_days=7`);
  const b = sug.rows.find((r) => r.product_id === P.brakina.id);
  // Historique : du 9 (installation) au 12 = 4 jours, 5 + 36 = 41 vendues -> 10,25 par jour ;
  // objectif ⌈10,25 × 7⌉ + 24 (minimum) = 96 ; besoin 96 - 19 = 77 -> 7 casiers de 12 = 84.
  assert.equal(sug.history_days, 4);
  assert.equal(b.avg_daily, 10.3);
  assert.equal(b.suggested_crates, 7);
  assert.equal(b.suggested_qty, 84);
  assert.equal(b.days_left, 1);
  assert.equal((await A.owner.post("/api/purchase-orders", { supplier_id: supplier.id, lines: [{ product_id: P.brakina.id, crates: 1 }] })).status, 403);
  const po = await A.manager.ok("POST", "/api/purchase-orders", { supplier_id: supplier.id, expected_date: "2026-11-14", lines: [{ product_id: P.brakina.id, crates: 7 }, { product_id: P.castel.id, crates: 2 }] });
  assert.match(po.doc_no, /^BCF-/);
  assert.equal(po.qty, 84 + 24);
  const pdf = await A.manager.get(`/api/documents/${po.doc_no}/pdf`);
  assert.equal(pdf.data.subarray(0, 5).toString(), "%PDF-");
  // Ce qui est commandé n'est plus suggéré une deuxième fois.
  const sug2 = await A.manager.ok("GET", `/api/purchase-orders/suggestions?supplier_id=${supplier.id}`);
  assert.equal(sug2.rows.find((r) => r.product_id === P.brakina.id).suggested_qty, 0);
  assert.equal(sug2.rows.find((r) => r.product_id === P.brakina.id).on_order, 84);
  // Première livraison : 4 casiers de Brakina seulement.
  const e1 = await A.manager.ok("POST", "/api/entries", { po_id: po.id, lines: [{ product_id: P.brakina.id, crates: 4 }] });
  let cur = await A.manager.ok("GET", `/api/purchase-orders/${po.id}`);
  assert.equal(cur.status, "partial");
  assert.equal(cur.lines.find((l) => l.product_id === P.brakina.id).remaining, 36);
  const entryDoc = await A.manager.ok("GET", `/api/documents/${e1.doc_no}`);
  assert.equal(entryDoc.payload.extra_tables[0].rows.length, 2);
  assert.ok(entryDoc.payload.notes[0].includes("Écarts"));
  assert.ok((await A.owner.ok("GET", "/api/notifications")).items.some((n) => n.title.includes("Livraison différente")));
  // Le fournisseur de l'entrée doit être celui de la commande.
  const other = await A.manager.ok("POST", "/api/suppliers", { name: "Autre dépôt" });
  assert.equal((await A.manager.post("/api/entries", { po_id: po.id, supplier_id: other.id, lines: [{ product_id: P.castel.id, crates: 1 }] })).status, 400);
  // Deuxième livraison : le reste.
  await A.manager.ok("POST", "/api/entries", { po_id: po.id, lines: [{ product_id: P.brakina.id, crates: 3 }, { product_id: P.castel.id, crates: 2 }] });
  cur = await A.manager.ok("GET", `/api/purchase-orders/${po.id}`);
  assert.equal(cur.status, "received");
  assert.equal(cur.entries.length, 2);
  assert.equal((await A.manager.post("/api/entries", { po_id: po.id, lines: [{ product_id: P.castel.id, crates: 1 }] })).status, 400);
  // Annuler la première livraison remet la commande « reçue en partie ».
  // Le gérant ne peut pas annuler une entrée : seul le propriétaire le peut.
  assert.equal((await A.manager.post(`/api/entries/${e1.id}/cancel`, { reason: "Livraison saisie en double" })).status, 403);
  await A.owner.ok("POST", `/api/entries/${e1.id}/cancel`, { reason: "Livraison saisie en double" });
  cur = await A.manager.ok("GET", `/api/purchase-orders/${po.id}`);
  assert.equal(cur.status, "partial");
  assert.equal(cur.lines.find((l) => l.product_id === P.brakina.id).received_qty, 36);
  // Annulation du reste de la commande.
  const c = await A.manager.ok("POST", `/api/purchase-orders/${po.id}/cancel`, { reason: "Le fournisseur n'a plus de stock" });
  assert.match(c.doc_no, /^ANN-/);
  assert.equal((await A.manager.ok("GET", `/api/purchase-orders/${po.id}`)).status, "cancelled");
});

test("fiche de stock : stock début + entrées − sorties = stock fin, pour chaque boisson", async () => {
  await A.manager.ok("POST", "/api/exits", { reason: "broken", lines: [{ product_id: P.castel.id, extra_units: 2 }] });
  const st = await A.manager.ok("GET", "/api/stock/statement?from=2026-11-10&to=2026-11-13");
  assert.equal(st.ok, true);
  const b = st.rows.find((r) => r.product_id === P.brakina.id);
  // Avant le 10 : 60 entrés - 5 vendus = 55 ; ventes 36 ; entrées nettes du 13 : 48 + 36 - 48 (annulation) = 36.
  assert.equal(b.opening, 55);
  assert.equal(b.sale, 36);
  assert.equal(b.entries, 36);
  assert.equal(b.closing, 55 + 36 - 36);
  assert.equal(b.closing, await stockOf(P.brakina.id));
  const c = st.rows.find((r) => r.product_id === P.castel.id);
  assert.equal(c.broken, 2);
  assert.equal(st.totals.closing, st.rows.reduce((s, r) => s + r.closing, 0));
  const pdf = await A.owner.get("/api/stock/statement/pdf?from=2026-11-10&to=2026-11-13");
  assert.equal(pdf.data.subarray(0, 5).toString(), "%PDF-");
  const xlsx = await A.owner.get("/api/stock/statement/xlsx?from=2026-11-13");
  assert.equal(xlsx.data.subarray(0, 2).toString(), "PK");
  assert.equal((await A.cashier.get("/api/stock/statement")).status, 403);
});

test("rentabilité par boisson et point des serveurs", async () => {
  const d = await A.owner.ok("GET", "/api/dashboard?from=2026-11-09&to=2026-11-13");
  const pr = d.period.profitability;
  const b = pr.rows.find((r) => r.product_id === P.brakina.id);
  assert.equal(b.qty, 5 + 36);
  assert.equal(b.revenue, 41 * 700);
  assert.equal(b.cost, 41 * 450);
  assert.equal(b.margin, 41 * 250);
  assert.equal(b.unit_margin, 250);
  const c = pr.rows.find((r) => r.product_id === P.castel.id);
  assert.equal(c.losses_cost, 2 * 500);
  assert.equal(c.net, c.margin - 1000);
  assert.equal(pr.totals.margin, pr.rows.reduce((s, r) => s + r.margin, 0));
  const ws = await A.manager.ok("GET", "/api/waiters/summary?from=2026-11-09&to=2026-11-13");
  const ali = ws.waiters.find((w) => w.waiter === "Ali Traoré");
  assert.equal(ali.bottles, 4 + 2);
  assert.equal(ali.orders.served.count, 2);
  assert.equal((await A.waiter.get("/api/waiters/summary")).status, 403);
});

test("fermeture de caisse avec billetage (billets et pièces)", async () => {
  const cur = (await A.cashier.ok("GET", "/api/cash/current")).session;
  // La caisse ouverte le 9 est restée ouverte jusqu'au 12 :
  // fonds 5 000 + table 7 (5 000) + 1 000 + 600 + 3 × 12 × 700 (25 200) = 36 800.
  const cash = cur.methods.find((m) => m.method === "Espèces").theoretical;
  assert.equal(cash, 36800);
  // Le billetage doit correspondre au montant compté.
  const wrong = await A.cashier.post("/api/cash/close", { counted: { Espèces: 36800 }, billetage: { b10000: 3, b5000: 1, b1000: 1 } });
  assert.equal(wrong.status, 400);
  const r = await A.cashier.ok("POST", "/api/cash/close", { counted: { Espèces: 36800 }, billetage: { b10000: 3, b5000: 1, b1000: 1, p500: 1, p200: 1, p100: 1 } });
  assert.equal(r.variance, 0);
  const doc = await A.cashier.ok("GET", `/api/documents/${r.doc_no}`);
  const t = doc.payload.extra_tables[0];
  assert.equal(t.title, "Billetage des espèces");
  assert.deepEqual(t.rows.at(-1), ["TOTAL ESPÈCES", "", "36 800 FCFA"]);
  assert.deepEqual(t.rows[0], ["Billet de 10 000", "3", "30 000 FCFA"]);
  const pdf = await A.cashier.get(`/api/documents/${r.doc_no}/pdf`);
  assert.equal(pdf.data.subarray(0, 5).toString(), "%PDF-");
  const print = await A.cashier.get(`/api/documents/${r.doc_no}/print`);
  assert.match(print.data.toString(), /Billetage des espèces/);
});

test("les bilans contiennent la fiche de stock, la rentabilité et le point des serveurs", async () => {
  at("2026-11-16T03:01:00Z");
  const done = reports.runDueReports();
  const weekly = done.find((r) => r.kind === "weekly");
  assert.ok(weekly);
  A.owner = await login("patron", "Patron2026!", "owner");
  const r = await A.owner.ok("GET", `/api/reports/${weekly.id}`);
  assert.equal(r.data.stock_statement.ok, true);
  assert.ok(r.data.profitability.rows.length >= 2);
  assert.ok(r.data.waiters.some((w) => w.waiter === "Fatim Zongo" && w.bottles === 3));
  const pdf = await A.owner.get(`/api/reports/${weekly.id}/pdf`);
  assert.equal(pdf.data.subarray(0, 5).toString(), "%PDF-");
  const xlsx = await A.owner.get(`/api/reports/${weekly.id}/xlsx`);
  assert.equal(xlsx.data.subarray(0, 2).toString(), "PK");
  const daily = done.find((x) => x.kind === "daily" && x.key === "2026-11-13");
  const dr = await A.owner.ok("GET", `/api/reports/${daily.id}`);
  assert.equal(dr.data.stock_statement.ok, true);
  assert.equal(dr.data.stock_statement.rows.find((x) => x.product_id === P.castel.id).broken, 2);
});

test("deux serveurs ne peuvent pas commander les mêmes dernières bouteilles", async () => {
  A.waiter = await login("serveur1", "Serveur1b", "waiter");
  A.waiter2 = await login("serveur2", "Serveur2b", "waiter2");
  A.manager = await login("gerant", "Gerant2026!b", "manager");
  const free = await stockOf(P.coca.id);
  await A.waiter.ok("POST", "/api/orders", { lines: [{ product_id: P.coca.id, qty: free - 1 }] });
  const r = await A.waiter2.post("/api/orders", { lines: [{ product_id: P.coca.id, qty: 2 }] });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /déjà commandée/);
  await A.waiter2.ok("POST", "/api/orders", { lines: [{ product_id: P.coca.id, qty: 1 }] });
});

test("corrections de la relecture : tables partagées, commandes anciennes, statut des bons, lignes en double", async () => {
  at("2026-11-17T20:00:00Z"); // le lendemain : les commandes en attente du 16 sont « anciennes »
  A.cashier = await login("caisse", "Caisse26b", "cashier");
  A.owner = await login("patron", "Patron2026!", "owner");
  A.manager = await login("gerant", "Gerant2026!b", "manager");
  A.waiter = await login("serveur1", "Serveur1b", "waiter");
  A.waiter2 = await login("serveur2", "Serveur2b", "waiter2");
  await A.cashier.post("/api/cash/open", { opening_float: 0 });
  // Les commandes en attente d'une autre journée ne bloquent plus le stock…
  const coca = await stockOf(P.coca.id);
  await A.waiter2.ok("POST", "/api/orders", { lines: [{ product_id: P.coca.id, qty: coca }] });
  // …et le serveur les voit toujours (Mes commandes ajoute les commandes en attente des jours passés).
  const pendingOld = await A.waiter.ok("GET", "/api/orders?status=pending");
  assert.ok(pendingOld.some((o) => o.business_day === "2026-11-16"));
  // Table partagée par deux serveurs, laissée à crédit.
  const a = await A.waiter.ok("POST", "/api/orders", { table_label: "Table 12", lines: [{ product_id: P.brakina.id, qty: 2 }] }); // 1 400
  const b = await A.waiter2.ok("POST", "/api/orders", { table_label: "Table 12", lines: [{ product_id: P.castel.id, qty: 4 }] }); // 3 000
  const bill = await A.cashier.ok("POST", "/api/orders/bill", { order_ids: [a.id, b.id] });
  assert.equal((await A.waiter2.get(`/api/documents/${bill.doc_no}`)).status, 200); // visible par les deux serveurs
  assert.ok((await A.waiter2.ok("GET", "/api/documents?type=bill")).some((d) => d.doc_no === bill.doc_no));
  const sale = await A.cashier.ok("POST", "/api/sales", { order_ids: [a.id, b.id], customer_name: "Table 12", payments: [{ method: "Espèces", amount: 2200 }] });
  assert.equal(sale.remaining, 2200);
  // Statut actuel affiché sur le bon et l'addition.
  assert.match((await A.waiter.ok("GET", `/api/documents/${a.order_no}`)).payload.status.label, /^ENCAISSÉE — VTE-/);
  assert.match((await A.cashier.ok("GET", `/api/documents/${bill.doc_no}`)).payload.status.label, /^RÉGLÉE/);
  // Chaque serveur est compté (tableau de bord, filtre des ventes, crédits) et le crédit est partagé au prorata.
  const dash = await A.owner.ok("GET", "/api/dashboard");
  const staff = Object.fromEntries(dash.staff.map((u) => [u.full_name, u]));
  assert.equal(staff["Ali Traoré"].sales, 1);
  assert.equal(staff["Ali Traoré"].sales_amount, 1400);
  assert.equal(staff["Fatim Zongo"].sales_amount, 3000);
  assert.ok((await A.manager.ok("GET", `/api/sales?waiter_id=${W2}`)).some((s) => s.id === sale.id));
  assert.match((await A.cashier.ok("GET", "/api/credits")).find((c) => c.id === sale.id).waiter_name, /Ali Traoré/);
  const ws = Object.fromEntries((await A.manager.ok("GET", "/api/waiters/summary")).waiters.map((w) => [w.waiter, w]));
  assert.equal(ws["Ali Traoré"].credit_open, Math.round((2200 * 1400) / 4400)); // 700
  assert.equal(ws["Fatim Zongo"].credit_open, Math.round((2200 * 3000) / 4400)); // 1 500
  // Annuler la vente de la table : les commandes passent « annulées ».
  await A.manager.ok("POST", `/api/sales/${sale.id}/cancel`, { reason: "Erreur : mauvaise table" });
  for (const id of [a.id, b.id]) {
    const o = await A.manager.ok("GET", `/api/orders/${id}`);
    assert.equal(o.status, "cancelled");
    assert.match(o.status_reason, /annulée/);
  }
  assert.equal((await A.waiter.ok("GET", `/api/documents/${a.order_no}`)).payload.status.label, "COMMANDE ANNULÉE");
  // Une boisson désactivée après la commande ne peut plus être encaissée.
  const c = await A.waiter.ok("POST", "/api/orders", { lines: [{ product_id: P.brakina.id, qty: 1 }] });
  await A.manager.ok("PATCH", `/api/products/${P.brakina.id}`, { active: false });
  const refused = await A.cashier.post("/api/sales", { order_id: c.id, payments: [{ method: "Espèces", amount: 700 }] });
  assert.equal(refused.status, 400);
  assert.match(refused.data.error, /plus disponible/);
  await A.manager.ok("PATCH", `/api/products/${P.brakina.id}`, { active: true });
  // Commande fournisseur avec la même boisson sur deux lignes : entièrement reçue en une livraison.
  const po = await A.manager.ok("POST", "/api/purchase-orders", { supplier_id: supplier.id, lines: [{ product_id: P.castel.id, crates: 2 }, { product_id: P.castel.id, crates: 1 }] });
  await A.manager.ok("POST", "/api/entries", { po_id: po.id, lines: [{ product_id: P.castel.id, crates: 3 }] });
  const cur = await A.manager.ok("GET", `/api/purchase-orders/${po.id}`);
  assert.equal(cur.status, "received");
  assert.deepEqual(cur.lines.map((l) => l.received_qty), [24, 12]);
});

test("le gérant tient sa caisse ; le propriétaire voit tout sans rien pouvoir modifier ; le gérant ne voit pas l'espace du propriétaire", async () => {
  at("2026-11-18T19:00:00Z");
  A.owner = await login("patron", "Patron2026!", "owner");
  A.manager = await login("gerant", "Gerant2026!b", "manager");
  A.waiter = await login("serveur1", "Serveur1b", "waiter");
  // Le gérant n'a pas accès au tableau de bord ni à l'administration du propriétaire.
  for (const url of ["/api/dashboard", "/api/audit", "/api/login-events", "/api/backups", "/api/audit/verify"]) assert.equal((await A.manager.get(url)).status, 403, url);
  assert.equal((await A.manager.put("/api/settings", { maquis_name: "Autre" })).status, 403);
  // Son accueil ne montre ni bénéfice, ni marge, ni rentabilité.
  const home = await A.manager.ok("GET", "/api/manager/home");
  assert.doesNotMatch(JSON.stringify(home), /profit|margin|profitability|gross/);
  // Le gérant ouvre SA caisse, encaisse la commande d'un serveur et ferme sa caisse.
  await A.manager.ok("POST", "/api/cash/open", { opening_float: 2000 });
  const o = await A.waiter.ok("POST", "/api/orders", { table_label: "Table 1", lines: [{ product_id: P.castel.id, qty: 2 }] });
  const sale = await A.manager.ok("POST", "/api/sales", { order_id: o.id, payments: [{ method: "Espèces", amount: 1500 }] });
  assert.equal(sale.status, "paid");
  const credit = await A.manager.ok("POST", "/api/sales", { customer_name: "Koné", lines: [{ product_id: P.castel.id, qty: 1 }], payments: [] });
  await A.manager.ok("POST", `/api/sales/${credit.id}/payments`, { amount: 750, method: "Espèces" });
  await A.manager.ok("POST", "/api/cash/movements", { kind: "withdrawal", amount: 1000, method: "Espèces", reason: "Remis au patron" });
  const mine = (await A.manager.ok("GET", "/api/cash/current")).session;
  assert.equal(mine.cashier_name, "Awa Kaboré");
  assert.equal(mine.methods.find((m) => m.method === "Espèces").theoretical, 2000 + 1500 + 750 - 1000);
  const home2 = await A.owner.ok("GET", "/api/manager/home");
  assert.equal(home2.cash.open_sessions.find((s) => s.cashier === "Awa Kaboré").theoretical, 3250);
  // Le propriétaire voit tout… mais ne peut ni encaisser, ni ouvrir ou fermer une caisse, ni annuler.
  assert.equal((await A.owner.post("/api/cash/open", { opening_float: 0 })).status, 403);
  assert.equal((await A.owner.post("/api/sales", { order_id: o.id, payments: [] })).status, 403);
  assert.equal((await A.owner.post(`/api/sales/${credit.id}/payments`, { amount: 1, method: "Espèces" })).status, 403);
  assert.equal((await A.owner.post(`/api/sales/${sale.id}/cancel`, { reason: "Je veux annuler" })).status, 403);
  assert.equal((await A.owner.post("/api/cash/close", { session_id: mine.id, counted: { Espèces: 0 } })).status, 403);
  assert.equal((await A.owner.post("/api/cash/movements", { kind: "withdrawal", amount: 100, reason: "test", session_id: mine.id })).status, 403);
  const sales = await A.owner.ok("GET", "/api/sales?from=2026-11-18&to=2026-11-18");
  assert.ok(sales.some((s) => s.id === sale.id && s.cashier_name === "Awa Kaboré"));
  assert.ok((await A.owner.ok("GET", "/api/audit?q=Vente")).some((a) => a.user_name === "Awa Kaboré"));
  assert.ok((await A.owner.ok("GET", "/api/notifications")).items.some((n) => n.type === "sale"));
  assert.ok(!(await A.manager.ok("GET", "/api/notifications")).items.some((n) => n.type === "sale" && n.link === `#/recus/${sale.doc_no}`)); // pas notifié de sa propre vente
  // Fermeture de sa caisse par le gérant (sans désigner de caisse).
  const close = await A.manager.ok("POST", "/api/cash/close", { counted: { Espèces: 3250 } });
  assert.equal(close.variance, 0);
  assert.equal((await A.owner.ok("GET", `/api/documents/${close.doc_no}`)).payload.fields.find((f) => f[0] === "Caissier")[1], "Awa Kaboré");
});


test("entrées et sorties : le gérant enregistre et voit, seul le propriétaire corrige ou annule ; alerte de commande", async () => {
  at("2026-11-19T19:00:00Z");
  A.owner = await login("patron", "Patron2026!", "owner");
  A.manager = await login("gerant", "Gerant2026!b", "manager");
  A.cashier = await login("caisse", "Caisse26b", "cashier");
  A.waiter = await login("serveur1", "Serveur1b", "waiter");
  const before = await stockOf(P.coca.id);
  // Le gérant saisit 10 casiers de Coca (240) au lieu de 8 (192), puis le signale.
  const e = await A.manager.ok("POST", "/api/entries", { supplier_id: supplier.id, lines: [{ product_id: P.coca.id, crates: 10 }] });
  for (const url of [`/api/entries/${e.id}/cancel`, `/api/entries/${e.id}/correct`]) assert.equal((await A.manager.post(url, { reason: "test", correction_reason: "test" })).status, 403, url);
  await A.manager.ok("POST", `/api/entries/${e.id}/report`, { message: "J'ai saisi 10 casiers, il y en avait 8" });
  assert.ok((await A.owner.ok("GET", "/api/notifications")).items.some((n) => n.title === `Erreur signalée sur l'entrée ${e.doc_no}`));
  assert.equal((await A.owner.ok("GET", `/api/entries/${e.id}`)).reports.length, 1);
  // Entre-temps des Coca ont été vendues : il n'en reste que 100. Annuler les 240 est impossible,
  // mais corriger à 192 (8 casiers) l'est : 100 - 240 + 192 = 52.
  await A.cashier.post("/api/cash/open", { opening_float: 0 });
  await A.cashier.ok("POST", "/api/sales", { lines: [{ product_id: P.coca.id, qty: before + 240 - 100 }], payments: [], customer_name: "Grossiste" });
  assert.equal(await stockOf(P.coca.id), 100);
  assert.equal((await A.owner.post(`/api/entries/${e.id}/cancel`, { reason: "Erreur de quantité" })).status, 409);
  const c = await A.owner.ok("POST", `/api/entries/${e.id}/correct`, { correction_reason: "8 casiers livrés, pas 10", lines: [{ product_id: P.coca.id, crates: 8 }] });
  assert.match(c.cancelled_doc, /^ANN-/);
  assert.match(c.doc_no, /^ENT-/);
  assert.equal(await stockOf(P.coca.id), 52);
  const orig = await A.manager.ok("GET", `/api/entries/${e.id}`);
  assert.equal(orig.status, "cancelled");
  assert.match(orig.cancel_reason, /^Correction : 8 casiers/);
  const repl = await A.manager.ok("GET", `/api/entries/${c.id}`);
  assert.equal(repl.lines[0].qty, 192);
  assert.match(repl.observation, new RegExp(`Correction de ${e.doc_no}`));
  assert.ok((await A.manager.ok("GET", "/api/notifications")).items.some((n) => n.title === "Entrée annulée"));
  // Une correction qui rendrait le stock négatif est refusée et rien ne change.
  // (52 - 192 + 1 < 0)
  const bad = await A.owner.post(`/api/entries/${c.id}/correct`, { correction_reason: "Essai impossible", lines: [{ product_id: P.coca.id, extra_units: 1 }] });
  assert.equal(bad.status, 409);
  assert.equal((await A.manager.ok("GET", `/api/entries/${c.id}`)).status, "valid");
  // Sorties : même règle.
  const x = await A.manager.ok("POST", "/api/exits", { reason: "broken", lines: [{ product_id: P.castel.id, extra_units: 5 }], observation: "Casier tombé" });
  assert.equal((await A.manager.post(`/api/exits/${x.id}/cancel`, { reason: "erreur" })).status, 403);
  const cx = await A.owner.ok("POST", `/api/exits/${x.id}/correct`, { correction_reason: "Seulement 2 cassées", reason: "broken", lines: [{ product_id: P.castel.id, extra_units: 2 }] });
  assert.equal((await A.owner.ok("GET", `/api/exits/${cx.id}`)).lines[0].qty, 2);
  // Le propriétaire ne crée toujours ni entrée ni sortie lui-même.
  assert.equal((await A.owner.post("/api/entries", { lines: [{ product_id: P.coca.id, crates: 1 }] })).status, 403);
  assert.equal((await A.owner.post("/api/exits", { reason: "broken", lines: [{ product_id: P.coca.id, extra_units: 1 }] })).status, 403);
  // Nouvelle commande : le gérant et le caissier sont alertés, pas le propriétaire.
  const o = await A.waiter.ok("POST", "/api/orders", { table_label: "Table 5", lines: [{ product_id: P.castel.id, qty: 1 }] });
  for (const who of [A.manager, A.cashier]) assert.ok((await who.ok("GET", "/api/notifications")).items.some((n) => n.type === "order" && n.title === "Nouvelle commande — Table 5"));
  assert.ok(!(await A.owner.ok("GET", "/api/notifications")).items.some((n) => n.type === "order"));
  assert.equal(o.status, "pending");
});


test("demande d'annulation refusée par le gérant ; changement de prix signalé au propriétaire", async () => {
  at("2026-11-20T19:00:00Z");
  A.owner = await login("patron", "Patron2026!", "owner");
  A.manager = await login("gerant", "Gerant2026!b", "manager");
  A.cashier = await login("caisse", "Caisse26b", "cashier");
  await A.cashier.post("/api/cash/open", { opening_float: 0 });
  const s = await A.cashier.ok("POST", "/api/sales", { lines: [{ product_id: P.castel.id, qty: 1 }], payments: [{ method: "Espèces", amount: 750 }] });
  const req = await A.cashier.ok("POST", `/api/sales/${s.id}/cancel-request`, { reason: "Le client a changé d'avis" });
  const refused = await A.manager.ok("POST", `/api/cancel-requests/${req.id}/refuse`, { note: "La bouteille est déjà ouverte" });
  assert.equal(refused.status, "refused");
  const sale = await A.cashier.ok("GET", `/api/sales/${s.id}`);
  assert.equal(sale.status, "paid"); // rien n'a changé
  assert.equal(sale.cancel_request.status, "refused");
  assert.ok((await A.cashier.ok("GET", "/api/notifications")).items.some((n) => n.title.startsWith("Annulation refusée")));
  assert.equal((await A.manager.post(`/api/cancel-requests/${req.id}/approve`, {})).status, 400); // déjà traitée
  // Le gérant change un prix : le propriétaire est prévenu, l'historique garde l'ancien prix.
  await A.manager.ok("PATCH", `/api/products/${P.castel.id}`, { sale_price: 800 });
  const n = (await A.owner.ok("GET", "/api/notifications")).items.find((x) => x.type === "price");
  assert.match(n.body, /vente 750 FCFA → 800 FCFA/);
  const hist = await A.owner.ok("GET", `/api/products/${P.castel.id}/history`);
  assert.equal(hist.prices[0].sale_price, 800);
  assert.equal(hist.prices[1].sale_price, 750);
});
