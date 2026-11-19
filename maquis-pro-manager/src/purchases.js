// Commandes fournisseurs : quantités suggérées d'après les ventes réelles, bon de commande
// à envoyer au fournisseur, puis réception (entrée de stock) avec comparaison commandé / reçu.
import { all, get, run, tx, getSetting } from "./db.js";
import { now, businessDay, addDays, daysBetween } from "./time.js";
import { audit } from "./audit.js";
import { notify } from "./notify.js";
import { createDocument, newDocNumber, documentsFor } from "./documents.js";
import { parseCrateLines, stockOf } from "./stock.js";
import { bad, notFound, str, int, money, num, cratesLabel, pname } from "./util.js";

export const PO_STATUS = { open: "Envoyée, en attente", partial: "Reçue en partie", received: "Reçue", cancelled: "Annulée" };

// Bouteilles déjà commandées et pas encore reçues, par boisson.
function onOrder() {
  const m = new Map();
  for (const r of all(
    `SELECT l.product_id, SUM(MAX(l.qty - l.received_qty, 0)) AS q FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.po_id
     WHERE o.status IN ('open','partial') GROUP BY l.product_id`,
  ))
    m.set(r.product_id, r.q);
  return m;
}

// Quantité conseillée = ventes moyennes par jour × jours de couverture + stock minimum
// − stock actuel − déjà commandé, arrondie au casier complet supérieur.
export function reorderSuggestions({ supplier_id, coverage_days, history_days } = {}) {
  const coverage = int(coverage_days, "Jours de couverture", { required: false, def: 7, min: 1, max: 60 });
  const history = int(history_days, "Jours d'historique", { required: false, def: 14, min: 3, max: 90 });
  const today = businessDay(now());
  const to = addDays(today, -1);
  const installed = getSetting("installed_day") || today;
  let from = addDays(today, -history);
  if (installed > from) from = installed;
  const complete = from <= to ? daysBetween(from, to).length : 0; // journées complètes disponibles
  const days = Math.max(1, complete);
  const sold = new Map(
    all("SELECT product_id, -SUM(qty) AS q FROM stock_movements WHERE kind = 'sale' AND business_day BETWEEN ? AND ? GROUP BY product_id", from, to).map((r) => [r.product_id, r.q]),
  );
  const ordered = onOrder();
  const sid = supplier_id ? int(supplier_id, "Fournisseur", { min: 1 }) : null;
  const rows = all(
    `SELECT p.*, c.name AS category, c.sort FROM products p JOIN categories c ON c.id = p.category_id
     WHERE p.active = 1 ${sid ? "AND (p.supplier_id = ? OR p.supplier_id IS NULL)" : ""} ORDER BY c.sort, p.brand, p.name`,
    ...(sid ? [sid] : []),
  ).map((p) => {
    const stock = stockOf(p.id);
    const avg = (sold.get(p.id) || 0) / days;
    const pending = ordered.get(p.id) || 0;
    const target = Math.ceil(avg * coverage) + p.min_stock;
    const need = Math.max(0, target - stock - pending);
    const upc = p.units_per_crate;
    const crates = upc > 1 ? Math.ceil(need / upc) : 0;
    const extra = upc > 1 ? 0 : need;
    const qty = crates * upc + extra;
    const daysLeft = avg > 0 ? Math.floor(Math.max(0, stock) / avg) : null;
    return {
      product_id: p.id,
      name: pname(p),
      category: p.category,
      supplier_id: p.supplier_id,
      units_per_crate: upc,
      pack_label: p.pack_label,
      stock,
      stock_label: cratesLabel(stock, upc, p.pack_label),
      min_stock: p.min_stock,
      avg_daily: Math.round(avg * 10) / 10,
      days_left: daysLeft,
      on_order: pending,
      suggested_crates: crates,
      suggested_extra: extra,
      suggested_qty: qty,
      unit_cost: p.purchase_price,
      amount: qty * p.purchase_price,
      reason: !avg && !p.min_stock ? "Pas de vente récente ni de stock minimum" : `${avg ? `≈ ${String(Math.round(avg * 10) / 10).replace(".", ",")} vendues/jour` : "aucune vente récente"} · objectif ${num(target)} (${coverage} j + minimum ${num(p.min_stock)})`,
    };
  });
  rows.sort((a, b) => (b.suggested_qty > 0) - (a.suggested_qty > 0) || (a.days_left ?? 9999) - (b.days_left ?? 9999));
  return { coverage_days: coverage, history_days: complete, from, to, rows, total: rows.reduce((s, r) => s + r.amount, 0) };
}

export function createPurchaseOrder(ctx, body) {
  const supplier = get("SELECT * FROM suppliers WHERE id = ?", int(body.supplier_id, "Fournisseur", { min: 1 }));
  if (!supplier) throw bad("Fournisseur inconnu.");
  const lines = parseCrateLines(body.lines, { costField: true });
  const expected = str(body.expected_date, "Date de livraison souhaitée", { max: 10 });
  if (expected && !/^\d{4}-\d{2}-\d{2}$/.test(expected)) throw bad("Date de livraison invalide.");
  const note = str(body.note, "Note", { max: 500 });
  const total = lines.reduce((s, l) => s + l.qty * l.unit_cost, 0);
  return tx(() => {
    const t = ctx.at || now();
    const doc_no = newDocNumber("purchase_order", t);
    const id = Number(
      run(
        "INSERT INTO purchase_orders (doc_no, at, business_day, supplier_id, user_id, expected_date, note, total_estimated, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        doc_no, t, businessDay(t), supplier.id, ctx.user.id, expected, note, total, now(),
      ).lastInsertRowid,
    );
    for (const l of lines)
      run("INSERT INTO purchase_order_lines (po_id, product_id, crates, units_per_crate, extra_units, qty, unit_cost) VALUES (?,?,?,?,?,?,?)", id, l.product_id, l.crates, l.units_per_crate, l.extra_units, l.qty, l.unit_cost);
    const qty = lines.reduce((s, l) => s + l.qty, 0);
    createDocument({
      type: "purchase_order",
      docNo: doc_no,
      refType: "purchase_order",
      refId: id,
      at: t,
      user: ctx.user,
      amount: total,
      payload: {
        fields: [
          ["Fournisseur", supplier.name],
          ["Téléphone du fournisseur", supplier.phone || "—"],
          ["Livraison souhaitée", expected ? expected.split("-").reverse().join("/") : "Dès que possible"],
          ["Note", note || "—"],
        ],
        columns: [
          { label: "Boisson", w: 3 },
          { label: "Casiers", align: "right", w: 1.1 },
          { label: "Btl/casier", align: "right", w: 1.1 },
          { label: "Btl sup.", align: "right", w: 1 },
          { label: "Qté", align: "right", w: 1 },
          { label: "Prix achat", align: "right", w: 1.5 },
          { label: "Montant", align: "right", w: 1.7 },
        ],
        rows: lines.map((l) => [pname(l.product), num(l.crates), num(l.units_per_crate), num(l.extra_units), num(l.qty), money(l.unit_cost), money(l.qty * l.unit_cost)]),
        totals: [["Quantité commandée", `${num(qty)} bouteilles`], ["MONTANT ESTIMÉ", money(total), true]],
        status: { label: "BON DE COMMANDE", tone: "warn" },
        notes: ["Merci de livrer les quantités ci-dessus. Les prix sont ceux connus à la date de la commande ; la facture de livraison fait foi."],
      },
      search: [supplier.name, ...lines.flatMap((l) => [l.product.name, l.product.brand])],
    });
    audit(ctx, "commande_fournisseur", "purchase_order", id, `Commande fournisseur ${doc_no} à ${supplier.name} : ${num(qty)} bouteilles, ${money(total)}`);
    notify({ roles: ["owner"], type: "purchase", title: "Commande fournisseur", body: `${ctx.user.full_name} a commandé ${num(qty)} bouteilles à ${supplier.name} (${money(total)} estimés).`, link: `#/achats/${id}` });
    return { id, doc_no, total, qty };
  });
}

export function listPurchaseOrders({ status } = {}) {
  const st = PO_STATUS[status] ? status : null;
  return all(
    `SELECT o.*, s.name AS supplier, u.full_name AS user_name,
       (SELECT SUM(qty) FROM purchase_order_lines l WHERE l.po_id = o.id) AS qty,
       (SELECT SUM(MIN(received_qty, qty)) FROM purchase_order_lines l WHERE l.po_id = o.id) AS received
     FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id JOIN users u ON u.id = o.user_id
     ${st ? "WHERE o.status = ?" : ""} ORDER BY o.id DESC LIMIT 200`,
    ...(st ? [st] : []),
  ).map((o) => ({ ...o, status_label: PO_STATUS[o.status] }));
}

export function getPurchaseOrder(id) {
  const o = get("SELECT o.*, s.name AS supplier, s.phone AS supplier_phone, u.full_name AS user_name FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id JOIN users u ON u.id = o.user_id WHERE o.id = ?", id);
  if (!o) throw notFound("Commande fournisseur introuvable.");
  o.status_label = PO_STATUS[o.status];
  o.lines = all("SELECT l.*, p.name, p.brand, p.units_per_crate AS product_upc, p.pack_label, p.purchase_price FROM purchase_order_lines l JOIN products p ON p.id = l.product_id WHERE po_id = ? ORDER BY l.id", id).map((l) => ({
    ...l,
    product_name: pname(l),
    remaining: Math.max(0, l.qty - l.received_qty),
  }));
  o.entries = all("SELECT e.id, e.doc_no, e.at, e.total_amount, e.status FROM entries e WHERE e.po_id = ? ORDER BY e.at", id);
  o.documents = documentsFor("purchase_order", id);
  return o;
}

export function cancelPurchaseOrder(ctx, id, body) {
  const reason = str(body.reason, "Motif", { required: true, min: 5, max: 300 });
  const o = getPurchaseOrder(id);
  if (!["open", "partial"].includes(o.status)) throw bad("Cette commande est déjà reçue ou annulée.");
  return tx(() => {
    run("UPDATE purchase_orders SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ?", now(), ctx.user.id, reason, id);
    const doc = createDocument({
      type: "cancellation",
      refType: "purchase_order",
      refId: id,
      at: now(),
      user: ctx.user,
      title: "Annulation d'une commande fournisseur",
      amount: o.total_estimated,
      payload: {
        fields: [["Document annulé", o.doc_no], ["Fournisseur", o.supplier], ["Motif de l'annulation", reason]],
        columns: [{ label: "Boisson", w: 3 }, { label: "Commandé", align: "right" }, { label: "Déjà reçu", align: "right" }, { label: "Annulé", align: "right" }],
        rows: o.lines.map((l) => [l.product_name, num(l.qty), num(l.received_qty), num(l.remaining)]),
        status: { label: "COMMANDE ANNULÉE", tone: "bad" },
        notes: ["Les bouteilles déjà reçues restent en stock ; seul le reste de la commande est annulé."],
      },
      search: [o.doc_no, o.supplier, reason],
      rectifies: o.doc_no,
    });
    audit(ctx, "commande_fournisseur_annulee", "purchase_order", id, `Commande fournisseur ${o.doc_no} annulée : ${reason}`);
    return { doc_no: doc };
  });
}

// ---------- Réception : appelée par l'entrée de marchandises liée à la commande ----------
export function receptionTarget(poId, supplierId) {
  const o = get("SELECT * FROM purchase_orders WHERE id = ?", int(poId, "Commande fournisseur", { min: 1 }));
  if (!o) throw bad("Commande fournisseur inconnue.");
  if (!["open", "partial"].includes(o.status)) throw bad(`La commande ${o.doc_no} est déjà ${o.status === "received" ? "entièrement reçue" : "annulée"}.`);
  if (supplierId && supplierId !== o.supplier_id) throw bad("Le fournisseur de l'entrée ne correspond pas à celui de la commande.");
  return o;
}

function refreshStatus(poId) {
  const o = get("SELECT status FROM purchase_orders WHERE id = ?", poId);
  if (o.status === "cancelled") return o.status;
  const r = get("SELECT SUM(received_qty >= qty) AS done, COUNT(*) AS n, SUM(received_qty) AS rec FROM purchase_order_lines WHERE po_id = ?", poId);
  const status = r.done === r.n ? "received" : r.rec > 0 ? "partial" : "open";
  run("UPDATE purchase_orders SET status = ? WHERE id = ?", status, poId);
  return status;
}

// Enregistre les quantités reçues et rend la comparaison commandé / reçu.
export function applyReception(po, lines) {
  const poLines = all("SELECT * FROM purchase_order_lines WHERE po_id = ? ORDER BY id", po.id);
  const received = new Map();
  for (const l of lines) received.set(l.product_id, (received.get(l.product_id) || 0) + l.qty);
  const rows = [];
  // Une même boisson peut figurer sur plusieurs lignes : on remplit chaque ligne jusqu'à sa quantité,
  // le surplus éventuel va sur la dernière.
  for (const pid of [...new Set(poLines.map((l) => l.product_id))]) {
    const mine = poLines.filter((l) => l.product_id === pid);
    const before = mine.reduce((a, l) => a + Math.max(0, l.qty - l.received_qty), 0);
    const got = received.get(pid) || 0;
    received.delete(pid);
    let left = got;
    mine.forEach((l, i) => {
      const give = i === mine.length - 1 ? left : Math.min(left, Math.max(0, l.qty - l.received_qty));
      if (give > 0) run("UPDATE purchase_order_lines SET received_qty = received_qty + ? WHERE id = ?", give, l.id);
      left -= give;
    });
    if (before || got) rows.push({ product_id: pid, expected: before, received: got, gap: got - before });
  }
  for (const [pid, got] of received) rows.push({ product_id: pid, expected: 0, received: got, gap: got, extra: true });
  const status = refreshStatus(po.id);
  return { rows, status };
}

export function revertReception(poId, lines) {
  for (const l of lines) {
    const pl = get("SELECT * FROM purchase_order_lines WHERE po_id = ? AND product_id = ? AND received_qty > 0 ORDER BY id DESC LIMIT 1", poId, l.product_id);
    if (pl) run("UPDATE purchase_order_lines SET received_qty = MAX(received_qty - ?, 0) WHERE id = ?", l.qty, pl.id);
  }
  refreshStatus(poId);
}
