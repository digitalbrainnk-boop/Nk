// Commandes des serveurs, ventes encaissées par le caissier, paiements partiels et crédits.
// Une vente diminue le stock une seule fois (mouvement « vendue ») : elle n'est jamais
// comptée en plus comme une sortie indépendante.
import { all, get, run, tx, nextNumber } from "./db.js";
import { now, businessDay, localParts } from "./time.js";
import { audit } from "./audit.js";
import { notify, signal } from "./notify.js";
import { createDocument, newDocNumber, documentsFor } from "./documents.js";
import { productRow } from "./catalog.js";
import { addMovement, checkStock, reverseMovements, snapshotStock, stockAlerts, touchDay, periodWhere } from "./stock.js";
import { requireOpenSession, checkMethod, openSessionOf, CASH } from "./cash.js";
import { bad, forbidden, notFound, str, int, arr, money, num } from "./util.js";

export const SALE_STATUS = { paid: "Payée", partial: "Paiement partiel", credit: "À crédit", cancelled: "Annulée" };
export const ORDER_STATUS = { pending: "En attente", served: "Servie / encaissée", cancelled: "Annulée", rejected: "Refusée" };

function parseQtyLines(lines) {
  const merged = new Map();
  for (const [i, l] of arr(lines, "Boissons", { min: 1, max: 100 }).entries()) {
    const pid = int(l.product_id, `Ligne ${i + 1} : boisson`, { min: 1 });
    const qty = int(l.qty, `Ligne ${i + 1} : quantité`, { min: 1, max: 10000 });
    merged.set(pid, (merged.get(pid) || 0) + qty);
  }
  return [...merged].map(([pid, qty]) => {
    const p = productRow(pid);
    if (!p) throw bad("Boisson inconnue.");
    if (!p.active) throw bad(`${p.brand} ${p.name} n'est plus disponible.`);
    return { product: p, product_id: pid, qty, unit_price: p.sale_price, unit_cost: p.purchase_price };
  });
}

// ---------- Commandes (serveurs) ----------
export function createOrder(ctx, body) {
  const lines = parseQtyLines(body.lines);
  const total = lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
  const table_label = str(body.table_label, "Table", { max: 40 });
  const customer_name = str(body.customer_name, "Client", { max: 80 });
  const note = str(body.note, "Note", { max: 300 });
  return tx(() => {
    checkStock(lines, ctx);
    const t = ctx.at || now();
    const order_no = nextNumber("CMD", localParts(t).y);
    const id = Number(
      run("INSERT INTO orders (order_no, at, business_day, waiter_id, table_label, customer_name, note, total, created_at) VALUES (?,?,?,?,?,?,?,?,?)", order_no, t, businessDay(t), ctx.user.id, table_label, customer_name, note, total, now())
        .lastInsertRowid,
    );
    for (const l of lines) run("INSERT INTO order_lines (order_id, product_id, qty, unit_price) VALUES (?,?,?,?)", id, l.product_id, l.qty, l.unit_price);
    audit(ctx, "commande_creee", "order", id, `Commande ${order_no} (${table_label || "sans table"}) : ${money(total)}`);
    signal(["cashier", "manager", "owner"], "orders", { id, order_no });
    return getOrder(id);
  });
}

export function getOrder(id) {
  const o = get("SELECT o.*, w.full_name AS waiter_name, h.full_name AS handled_by_name, s.doc_no AS sale_doc FROM orders o JOIN users w ON w.id = o.waiter_id LEFT JOIN users h ON h.id = o.handled_by LEFT JOIN sales s ON s.id = o.sale_id WHERE o.id = ?", id);
  if (!o) throw notFound("Commande introuvable.");
  o.lines = all("SELECT l.*, p.name, p.brand, p.photo FROM order_lines l JOIN products p ON p.id = l.product_id WHERE order_id = ?", id);
  o.status_label = ORDER_STATUS[o.status];
  return o;
}

export function listOrders(ctx, { status, day, limit = 100 } = {}) {
  const where = [];
  const p = [];
  if (ctx.user.role === "waiter") {
    where.push("o.waiter_id = ?");
    p.push(ctx.user.id);
  }
  if (status && ORDER_STATUS[status]) {
    where.push("o.status = ?");
    p.push(status);
  }
  if (day) {
    where.push("o.business_day = ?");
    p.push(String(day));
  }
  const ids = all(`SELECT o.id FROM orders o ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY o.at DESC LIMIT ?`, ...p, Math.min(Number(limit) || 100, 500));
  return ids.map((r) => getOrder(r.id));
}

export function cancelOrder(ctx, id, body) {
  const o = getOrder(id);
  if (o.status !== "pending") throw bad("Seule une commande en attente peut être annulée.");
  const isOwnWaiter = ctx.user.role === "waiter" && o.waiter_id === ctx.user.id;
  if (ctx.user.role === "waiter" && !isOwnWaiter) throw forbidden();
  const reason = str(body.reason, "Motif", { required: !isOwnWaiter, max: 200 });
  const status = isOwnWaiter ? "cancelled" : "rejected";
  return tx(() => {
    run("UPDATE orders SET status = ?, handled_by = ?, handled_at = ?, status_reason = ? WHERE id = ?", status, ctx.user.id, now(), reason, id);
    audit(ctx, isOwnWaiter ? "commande_annulee" : "commande_refusee", "order", id, `Commande ${o.order_no} ${isOwnWaiter ? "annulée" : "refusée"}${reason ? ` : ${reason}` : ""}`);
    if (!isOwnWaiter) notify({ userIds: [o.waiter_id], type: "exceptional", title: `Commande ${o.order_no} refusée`, body: `${ctx.user.full_name} : ${reason}`, link: "#/commandes" });
    signal(["cashier", "manager", "owner", "waiter"], "orders", { id });
    return getOrder(id);
  });
}

// ---------- Ventes (caissier) ----------
function parsePayments(payments, total) {
  const list = (Array.isArray(payments) ? payments : [])
    .filter((p) => p && Number(p.amount) > 0)
    .map((p, i) => ({ method: checkMethod(p.method), amount: int(p.amount, `Paiement ${i + 1}`, { min: 1, max: 1_000_000_000 }) }));
  const paid = list.reduce((s, p) => s + p.amount, 0);
  if (paid > total) throw bad(`Le montant encaissé (${money(paid)}) dépasse le total de la vente (${money(total)}). Rendez la monnaie et saisissez le montant exact.`);
  return { list, paid };
}

export function createSale(ctx, body) {
  const session = requireOpenSession(ctx);
  let order = null;
  let lines;
  let waiterId = null;
  if (body.order_id) {
    order = getOrder(int(body.order_id, "Commande", { min: 1 }));
    if (order.status !== "pending") throw bad(`La commande ${order.order_no} est déjà ${ORDER_STATUS[order.status].toLowerCase()}.`);
    lines = parseQtyLines(order.lines.map((l) => ({ product_id: l.product_id, qty: l.qty })));
    waiterId = order.waiter_id;
  } else {
    lines = parseQtyLines(body.lines);
    if (body.waiter_id) {
      waiterId = int(body.waiter_id, "Serveur", { min: 1 });
      if (!get("SELECT 1 FROM users WHERE id = ? AND role = 'waiter'", waiterId)) throw bad("Serveur inconnu.");
    }
  }
  const total = lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
  const { list: payments, paid } = parsePayments(body.payments, total);
  const customer_name = str(body.customer_name ?? order?.customer_name, "Nom du client", { max: 80, required: paid < total });
  const customer_phone = str(body.customer_phone, "Téléphone du client", { max: 30 });
  const note = str(body.note, "Note", { max: 300 });
  const status = paid >= total ? "paid" : paid > 0 ? "partial" : "credit";
  const at = ctx.at || now();
  const day = businessDay(at);

  return tx(() => {
    checkStock(lines, ctx);
    const before = snapshotStock(lines.map((l) => l.product_id));
    const doc_no = newDocNumber("sale", at);
    const id = Number(
      run(
        `INSERT INTO sales (doc_no, at, business_day, cashier_id, waiter_id, order_id, session_id, customer_name, customer_phone, total, paid, status, note, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        doc_no, at, day, ctx.user.id, waiterId, order?.id ?? null, session.id, customer_name, customer_phone, total, paid, status, note, now(),
      ).lastInsertRowid,
    );
    for (const l of lines) {
      run("INSERT INTO sale_lines (sale_id, product_id, qty, unit_price, unit_cost, line_total) VALUES (?,?,?,?,?,?)", id, l.product_id, l.qty, l.unit_price, l.unit_cost, l.qty * l.unit_price);
      addMovement({ at, business_day: day, product_id: l.product_id, qty: -l.qty, kind: "sale", unit_cost: l.unit_cost, unit_price: l.unit_price, ref_type: "sale", ref_id: id, user_id: ctx.user.id, waiter_id: waiterId });
    }
    for (const p of payments) run("INSERT INTO payments (doc_no, at, business_day, sale_id, session_id, amount, method, kind, user_id) VALUES (?,?,?,?,?,?,?,?,?)", doc_no, at, day, id, session.id, p.amount, p.method, "sale", ctx.user.id);
    if (order) run("UPDATE orders SET status = 'served', sale_id = ?, handled_by = ?, handled_at = ? WHERE id = ?", id, ctx.user.id, now(), order.id);
    const waiter = waiterId ? get("SELECT full_name FROM users WHERE id = ?", waiterId).full_name : "";
    const bottles = lines.reduce((s, l) => s + l.qty, 0);
    createDocument({
      type: "sale",
      docNo: doc_no,
      refType: "sale",
      refId: id,
      at,
      user: ctx.user,
      amount: total,
      payload: {
        fields: [
          ["Caissier", ctx.user.full_name],
          ["Serveur", waiter || "Vente au comptoir"],
          ["Commande", order ? `${order.order_no}${order.table_label ? ` — ${order.table_label}` : ""}` : "—"],
          ["Client", customer_name || "—"],
          ...(customer_phone ? [["Téléphone du client", customer_phone]] : []),
        ],
        columns: [
          { label: "Boisson", w: 3.4 },
          { label: "Qté", align: "right", w: 0.8 },
          { label: "Prix unit.", align: "right", w: 1.5 },
          { label: "Montant", align: "right", w: 1.7 },
        ],
        rows: lines.map((l) => [`${l.product.brand} — ${l.product.name}`, num(l.qty), money(l.unit_price), money(l.qty * l.unit_price)]),
        totals: [
          ["Nombre de bouteilles", num(bottles)],
          ["TOTAL", money(total), true],
          ...payments.map((p) => [`Payé — ${p.method}`, money(p.amount)]),
          ["Reste à payer", money(total - paid), total - paid > 0],
        ],
        status: { label: { paid: "PAYÉ", partial: "PAIEMENT PARTIEL", credit: "À CRÉDIT" }[status], tone: status === "paid" ? "ok" : status === "partial" ? "warn" : "bad" },
        notes: note ? [note] : [],
      },
      search: [customer_name, waiter, ...lines.flatMap((l) => [l.product.name, l.product.brand])],
    });
    audit(ctx, "vente", "sale", id, `Vente ${doc_no} : ${bottles} bouteille(s), ${money(total)} (${SALE_STATUS[status]})`, {
      lines: lines.map((l) => ({ product_id: l.product_id, qty: l.qty, unit_price: l.unit_price })),
      payments,
      order_id: order?.id ?? null,
      waiter_id: waiterId,
    });
    touchDay(day, "vente tardive");
    notify({
      roles: ["owner", "manager"],
      type: "sale",
      title: `Nouvelle vente : ${money(total)}`,
      body: `${lines.map((l) => `${l.qty} ${l.product.brand}`).join(", ")}${waiter ? ` — serveur ${waiter}` : ""} — ${SALE_STATUS[status].toLowerCase()}.`,
      link: `#/recus/${doc_no}`,
    });
    stockAlerts(before);
    signal(["cashier", "manager", "owner", "waiter"], "orders", { id: order?.id });
    signal(["owner", "manager", "cashier", "waiter"], "stock");
    return { id, doc_no, total, paid, status, remaining: total - paid };
  });
}

export function getSale(ctx, id) {
  const s = get(
    `SELECT s.*, c.full_name AS cashier_name, w.full_name AS waiter_name, o.order_no, o.table_label
     FROM sales s JOIN users c ON c.id = s.cashier_id LEFT JOIN users w ON w.id = s.waiter_id LEFT JOIN orders o ON o.id = s.order_id WHERE s.id = ?`,
    id,
  );
  if (!s) throw notFound("Vente introuvable.");
  if (ctx.user.role === "waiter" && s.waiter_id !== ctx.user.id) throw forbidden();
  s.lines = all("SELECT l.*, p.name, p.brand FROM sale_lines l JOIN products p ON p.id = l.product_id WHERE sale_id = ?", id);
  s.payments = all("SELECT p.*, u.full_name AS user_name FROM payments p JOIN users u ON u.id = p.user_id WHERE sale_id = ? ORDER BY p.at", id);
  s.refunds = all("SELECT * FROM cash_movements WHERE ref_type = 'sale' AND ref_id = ?", id);
  s.documents = documentsFor("sale", id);
  s.status_label = SALE_STATUS[s.status];
  s.remaining = s.status === "cancelled" ? 0 : s.total - s.paid;
  if (ctx.user.role === "waiter" || ctx.user.role === "cashier") for (const l of s.lines) delete l.unit_cost;
  return s;
}

export function listSales(ctx, { from, to, status, waiter_id, limit = 200 } = {}) {
  const extra = [];
  const ps = [];
  if (ctx.user.role === "waiter") {
    extra.push("s.waiter_id = ?");
    ps.push(ctx.user.id);
  } else if (ctx.user.role === "cashier") {
    extra.push("s.cashier_id = ?");
    ps.push(ctx.user.id);
  }
  if (status && SALE_STATUS[status]) {
    extra.push("s.status = ?");
    ps.push(status);
  }
  if (waiter_id) {
    extra.push("s.waiter_id = ?");
    ps.push(Number(waiter_id));
  }
  const { where, p } = periodWhere("s.at", from, to, extra);
  return all(
    `SELECT s.id, s.doc_no, s.at, s.business_day, s.total, s.paid, s.status, s.customer_name, s.waiter_id, c.full_name AS cashier_name, w.full_name AS waiter_name,
       (SELECT SUM(qty) FROM sale_lines l WHERE l.sale_id = s.id) AS bottles
     FROM sales s JOIN users c ON c.id = s.cashier_id LEFT JOIN users w ON w.id = s.waiter_id ${where} ORDER BY s.at DESC LIMIT ?`,
    ...ps, ...p, Math.min(Number(limit) || 200, 1000),
  ).map((s) => ({ ...s, status_label: SALE_STATUS[s.status] }));
}

export function listCredits() {
  return all(
    `SELECT s.id, s.doc_no, s.at, s.total, s.paid, s.total - s.paid AS remaining, s.customer_name, s.customer_phone, s.status, w.full_name AS waiter_name
     FROM sales s LEFT JOIN users w ON w.id = s.waiter_id WHERE s.status IN ('partial','credit') ORDER BY s.at`,
  );
}

// Règlement (total ou partiel) d'une vente à crédit : encaissé dans la caisse ouverte du caissier.
export function addSalePayment(ctx, saleId, body) {
  const session = requireOpenSession(ctx);
  const s = get("SELECT * FROM sales WHERE id = ?", saleId);
  if (!s) throw notFound("Vente introuvable.");
  if (!["partial", "credit"].includes(s.status)) throw bad("Cette vente n'a pas de reste à payer.");
  const remaining = s.total - s.paid;
  const amount = int(body.amount, "Montant", { min: 1 });
  if (amount > remaining) throw bad(`Le montant dépasse le reste à payer (${money(remaining)}).`);
  const method = checkMethod(body.method || CASH);
  return tx(() => {
    const t = ctx.at || now();
    const doc_no = newDocNumber("payment", t);
    run("INSERT INTO payments (doc_no, at, business_day, sale_id, session_id, amount, method, kind, user_id) VALUES (?,?,?,?,?,?,?,?,?)", doc_no, t, businessDay(t), s.id, session.id, amount, method, "credit", ctx.user.id);
    const paid = s.paid + amount;
    const status = paid >= s.total ? "paid" : "partial";
    run("UPDATE sales SET paid = ?, status = ? WHERE id = ?", paid, status, s.id);
    createDocument({
      type: "payment",
      docNo: doc_no,
      refType: "sale",
      refId: s.id,
      at: t,
      user: ctx.user,
      amount,
      payload: {
        fields: [["Vente concernée", s.doc_no], ["Client", s.customer_name || "—"], ["Mode de paiement", method]],
        totals: [["Total de la vente", money(s.total)], ["Déjà payé avant", money(s.paid)], ["Montant reçu", money(amount), true], ["Reste à payer", money(s.total - paid), true]],
        status: status === "paid" ? { label: "CRÉDIT SOLDÉ", tone: "ok" } : { label: "PAIEMENT PARTIEL", tone: "warn" },
      },
      search: [s.doc_no, s.customer_name, method],
    });
    audit(ctx, "paiement_credit", "sale", s.id, `Paiement ${doc_no} sur ${s.doc_no} : ${money(amount)} (${method}), reste ${money(s.total - paid)}`);
    touchDay(businessDay(t), "paiement tardif");
    signal(["owner", "manager"], "cash");
    return { doc_no, paid, remaining: s.total - paid, status };
  });
}

// Annulation traçable : stock remis, argent remboursé depuis une caisse ouverte, document rectificatif.
export function cancelSale(ctx, saleId, body) {
  const reason = str(body.reason, "Motif de l'annulation", { required: true, min: 5, max: 300 });
  const s = get("SELECT * FROM sales WHERE id = ?", saleId);
  if (!s) throw notFound("Vente introuvable.");
  if (s.status === "cancelled") throw bad("Cette vente est déjà annulée.");
  const own = openSessionOf(ctx.user.id);
  if (ctx.user.role === "cashier" && !(own && own.id === s.session_id)) throw forbidden("Un caissier ne peut annuler que les ventes de sa caisse en cours. Demandez au gérant.");
  const payments = all("SELECT * FROM payments WHERE sale_id = ?", s.id);
  // Caisse qui rembourse : celle de la vente si elle est encore ouverte, sinon celle du caissier qui annule.
  let refundSession = null;
  if (payments.length) {
    const origin = get("SELECT * FROM cash_sessions WHERE id = ? AND status = 'open'", s.session_id);
    refundSession = origin || own;
    if (!refundSession)
      throw bad("Cette vente a été encaissée dans une caisse déjà fermée : le remboursement doit passer par une caisse ouverte. Demandez au caissier d'annuler la vente depuis sa caisse.");
  }
  return tx(() => {
    const t = now();
    run("UPDATE sales SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ?", t, ctx.user.id, reason, s.id);
    reverseMovements("sale", s.id, ctx, `Annulation ${s.doc_no}`);
    const byMethod = {};
    for (const p of payments) byMethod[p.method] = (byMethod[p.method] || 0) + p.amount;
    const refundDocs = [];
    for (const [method, amount] of Object.entries(byMethod)) {
      const doc_no = newDocNumber("refund", t);
      const mid = Number(
        run(
          "INSERT INTO cash_movements (doc_no, at, business_day, session_id, kind, amount, method, reason, ref_type, ref_id, user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
          doc_no, t, businessDay(t), refundSession.id, "refund", amount, method, `Annulation ${s.doc_no} : ${reason}`, "sale", s.id, ctx.user.id,
        ).lastInsertRowid,
      );
      createDocument({
        type: "refund",
        docNo: doc_no,
        refType: "cash_movement",
        refId: mid,
        at: t,
        user: ctx.user,
        amount,
        payload: { fields: [["Vente annulée", s.doc_no], ["Client", s.customer_name || "—"], ["Mode", method], ["Motif", reason]], totals: [["Montant remboursé", money(amount), true]], status: { label: "REMBOURSÉ", tone: "warn" } },
        search: [s.doc_no, reason, s.customer_name],
      });
      refundDocs.push(doc_no);
    }
    const lines = all("SELECT l.*, p.name, p.brand FROM sale_lines l JOIN products p ON p.id = l.product_id WHERE sale_id = ?", s.id);
    const doc = createDocument({
      type: "cancellation",
      refType: "sale",
      refId: s.id,
      at: t,
      user: ctx.user,
      title: "Annulation d'une vente",
      amount: s.total,
      payload: {
        fields: [["Document annulé", s.doc_no], ["Motif de l'annulation", reason], ["Remboursement", refundDocs.length ? refundDocs.join(", ") : "Aucun (rien n'avait été encaissé)"]],
        columns: [{ label: "Boisson", w: 3 }, { label: "Qté remise en stock", align: "right", w: 1.5 }, { label: "Montant", align: "right", w: 1.5 }],
        rows: lines.map((l) => [`${l.brand} — ${l.name}`, num(l.qty), money(l.line_total)]),
        totals: [["Montant de la vente annulée", money(s.total), true], ["Montant remboursé", money(s.paid)]],
        status: { label: "ANNULÉ", tone: "bad" },
        notes: ["Le reçu de vente d'origine reste conservé tel quel. Ce rectificatif annule ses effets."],
      },
      search: [s.doc_no, reason, s.customer_name],
      rectifies: s.doc_no,
    });
    audit(ctx, "vente_annulee", "sale", s.id, `Vente ${s.doc_no} annulée (${money(s.total)}) : ${reason}`, { remboursements: refundDocs, rectificatif: doc });
    touchDay(s.business_day, "annulation de vente");
    notify({ roles: ["owner", "manager"], exceptUserId: ctx.user.id, type: "exceptional", severity: "warn", title: "Vente annulée", body: `${ctx.user.full_name} a annulé la vente ${s.doc_no} (${money(s.total)}). Motif : ${reason}`, link: `#/recus/${doc}` });
    signal(["owner", "manager", "cashier", "waiter"], "stock");
    return { doc_no: doc, refunds: refundDocs };
  });
}
