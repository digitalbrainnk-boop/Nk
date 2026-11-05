// Stock : grand livre des mouvements, entrées de marchandises, sorties (hors ventes),
// inventaires physiques, consignes et paiements fournisseurs.
// STOCK FINAL = STOCK INITIAL + ENTRÉES - SORTIES (calculé, jamais saisi à la main).
import { all, get, run, tx } from "./db.js";
import { now, businessDay, isDay, dayBounds, weekStart, fmtDateTime } from "./time.js";
import { audit } from "./audit.js";
import { notify, signal } from "./notify.js";
import { createDocument, newDocNumber, documentsFor } from "./documents.js";
import { productRow } from "./catalog.js";
import { bad, notFound, conflict, str, int, oneOf, arr, money, num, cratesLabel } from "./util.js";

export const EXIT_KINDS = ["sale", "offered", "staff", "broken", "lost", "expired", "other"];
export const EXIT_LABELS = {
  sale: "Vendue",
  offered: "Offerte",
  staff: "Consommée par le personnel",
  broken: "Cassée",
  lost: "Perdue",
  expired: "Périmée",
  other: "Autre sortie exceptionnelle",
};
export const LOSS_KINDS = ["broken", "lost", "expired"];

export const stockOf = (productId) => get("SELECT COALESCE(SUM(qty), 0) AS s FROM stock_movements WHERE product_id = ?", productId).s;

// Une opération arrivée en retard (hors connexion, annulation) sur une journée déjà clôturée
// rend son bilan obsolète : un bilan rectificatif sera produit (l'original est conservé).
export function touchDay(day, reason) {
  if (!isDay(day) || day >= businessDay(now())) return;
  const t = now();
  if (get("SELECT 1 FROM reports WHERE kind = 'daily' AND period_key = ?", day))
    run("INSERT INTO report_dirty (kind, period_key, since, reason) VALUES ('daily', ?, ?, ?) ON CONFLICT DO NOTHING", day, t, reason);
  const monday = weekStart(day);
  if (get("SELECT 1 FROM reports WHERE kind = 'weekly' AND period_key = ?", monday))
    run("INSERT INTO report_dirty (kind, period_key, since, reason) VALUES ('weekly', ?, ?, ?) ON CONFLICT DO NOTHING", monday, t, reason);
}

export function addMovement(m) {
  run(
    `INSERT INTO stock_movements (at, business_day, product_id, qty, kind, unit_cost, unit_price, ref_type, ref_id, user_id, waiter_id, reversal_of, note, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    m.at, m.business_day || businessDay(m.at), m.product_id, m.qty, m.kind, m.unit_cost || 0, m.unit_price || 0, m.ref_type || "", m.ref_id ?? null, m.user_id ?? null, m.waiter_id ?? null, m.reversal_of ?? null, m.note || "", now(),
  );
}

// Annule les mouvements d'une opération (même nature, signe opposé, même journée commerciale).
export function reverseMovements(refType, refId, ctx, note) {
  const at = now();
  for (const m of all("SELECT * FROM stock_movements WHERE ref_type = ? AND ref_id = ? AND reversal_of IS NULL", refType, refId)) {
    addMovement({ ...m, at, qty: -m.qty, reversal_of: m.id, user_id: ctx.user.id, note });
  }
}

// Vérifie le stock avant une sortie. Hors connexion, la sortie a déjà eu lieu physiquement :
// on l'accepte et on prévient le gérant.
export function checkStock(lines, ctx) {
  const need = new Map();
  for (const l of lines) need.set(l.product_id, (need.get(l.product_id) || 0) + l.qty);
  const problems = [];
  for (const [pid, qty] of need) {
    const p = productRow(pid);
    const s = stockOf(pid);
    if (s < qty) problems.push({ product: `${p.brand} ${p.name}`.trim(), available: s, requested: qty });
  }
  if (problems.length && !ctx.offline) {
    throw conflict(`Stock insuffisant : ${problems.map((x) => `${x.product} (${x.available} disponible${x.available > 1 ? "s" : ""}, ${x.requested} demandé${x.requested > 1 ? "s" : ""})`).join(", ")}.`);
  }
  if (problems.length) {
    notify({
      roles: ["owner", "manager"],
      type: "sync",
      severity: "warn",
      title: "Stock négatif après synchronisation",
      body: `Une opération enregistrée hors connexion par ${ctx.user.full_name} dépasse le stock informatique : ${problems.map((x) => x.product).join(", ")}. Un inventaire est conseillé.`,
      link: "#/stock",
    });
  }
}

// Alertes « stock faible » et « rupture » quand le seuil vient d'être franchi.
export function stockAlerts(before) {
  for (const [pid, prev] of before) {
    const p = productRow(pid);
    const s = stockOf(pid);
    const name = `${p.brand} — ${p.name}`;
    if (s <= 0 && prev > 0) {
      notify({ roles: ["owner", "manager"], type: "out_of_stock", severity: "danger", title: `Rupture de stock : ${name}`, body: `Il ne reste plus de ${name}.`, link: `#/stock/${pid}` });
    } else if (s <= p.min_stock && prev > p.min_stock && s > 0) {
      notify({
        roles: ["owner", "manager"],
        type: "low_stock",
        severity: "warn",
        title: `Stock faible : ${name}`,
        body: `Reste ${cratesLabel(s, p.units_per_crate, p.pack_label)} (minimum ${p.min_stock}).`,
        link: `#/stock/${pid}`,
      });
    }
  }
}
export const snapshotStock = (productIds) => new Map([...new Set(productIds)].map((id) => [id, stockOf(id)]));

// Lignes « casiers + bouteilles » -> quantité totale en bouteilles.
function parseCrateLines(lines, { costField = false, label = "Ligne" } = {}) {
  return arr(lines, "Boissons", { min: 1, max: 100 }).map((l, i) => {
    const p = productRow(int(l.product_id, `${label} ${i + 1} : boisson`, { min: 1 }));
    if (!p) throw bad(`${label} ${i + 1} : boisson inconnue.`);
    if (!p.active) throw bad(`${p.brand} ${p.name} est désactivée.`);
    const upc = int(l.units_per_crate, `${label} ${i + 1} : bouteilles par casier`, { required: false, def: p.units_per_crate, min: 1, max: 500 });
    const crates = int(l.crates, `${label} ${i + 1} : casiers`, { required: false, def: 0, min: 0, max: 100000 });
    const extra = int(l.extra_units, `${label} ${i + 1} : bouteilles`, { required: false, def: 0, min: 0, max: 1000000 });
    const qty = crates * upc + extra;
    if (qty <= 0) throw bad(`${label} ${i + 1} (${p.brand} ${p.name}) : quantité nulle.`);
    const unit_cost = costField ? int(l.unit_cost, `${label} ${i + 1} : prix d'achat`, { required: false, def: p.purchase_price, min: 0, max: 10_000_000 }) : p.purchase_price;
    return { product: p, product_id: p.id, units_per_crate: upc, crates, extra_units: extra, qty, unit_cost, unit_price: p.sale_price };
  });
}

// ---------- Entrées de marchandises ----------
export function createEntry(ctx, body) {
  const supplier_id = body.supplier_id ? int(body.supplier_id, "Fournisseur", { min: 1 }) : null;
  const supplier = supplier_id ? get("SELECT * FROM suppliers WHERE id = ?", supplier_id) : null;
  if (supplier_id && !supplier) throw bad("Fournisseur inconnu.");
  const lines = parseCrateLines(body.lines, { costField: true });
  const total = lines.reduce((s, l) => s + l.qty * l.unit_cost, 0);
  const paid = int(body.paid_amount, "Montant payé", { required: false, def: 0, min: 0 });
  if (paid > total) throw bad(`Le montant payé (${money(paid)}) dépasse le montant total (${money(total)}).`);
  const method = paid > 0 ? str(body.payment_method, "Mode de paiement", { required: true, max: 40 }) : "";
  const invoice_no = str(body.invoice_no, "Numéro de facture", { max: 60 });
  const observation = str(body.observation, "Observation", { max: 500 });
  const at = ctx.at || now();
  const day = businessDay(at);

  return tx(() => {
    const doc_no = newDocNumber("entry", at);
    const id = Number(
      run(
        `INSERT INTO entries (doc_no, at, business_day, supplier_id, invoice_no, total_amount, paid_amount, payment_method, user_id, observation, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        doc_no, at, day, supplier_id, invoice_no, total, paid, method, ctx.user.id, observation, now(),
      ).lastInsertRowid,
    );
    for (const l of lines) {
      run(
        "INSERT INTO entry_lines (entry_id, product_id, crates, units_per_crate, extra_units, qty, unit_cost, line_total) VALUES (?,?,?,?,?,?,?,?)",
        id, l.product_id, l.crates, l.units_per_crate, l.extra_units, l.qty, l.unit_cost, l.qty * l.unit_cost,
      );
      addMovement({ at, business_day: day, product_id: l.product_id, qty: l.qty, kind: "entry", unit_cost: l.unit_cost, unit_price: l.unit_price, ref_type: "entry", ref_id: id, user_id: ctx.user.id });
    }
    const totalQty = lines.reduce((s, l) => s + l.qty, 0);
    createDocument({
      type: "entry",
      docNo: doc_no,
      refType: "entry",
      refId: id,
      at,
      user: ctx.user,
      amount: total,
      payload: {
        fields: [
          ["Fournisseur", supplier?.name || "Non précisé"],
          ["N° de facture", invoice_no || "—"],
          ["Enregistré par", ctx.user.full_name],
          ["Observation", observation || "—"],
        ],
        columns: [
          { label: "Boisson", w: 3 },
          { label: "Casiers", align: "right", w: 1.2 },
          { label: "Btl/casier", align: "right", w: 1.2 },
          { label: "Btl sup.", align: "right", w: 1 },
          { label: "Qté", align: "right", w: 1 },
          { label: "Prix achat", align: "right", w: 1.6 },
          { label: "Montant", align: "right", w: 1.8 },
        ],
        rows: lines.map((l) => [`${l.product.brand} — ${l.product.name}`, num(l.crates), num(l.units_per_crate), num(l.extra_units), num(l.qty), money(l.unit_cost), money(l.qty * l.unit_cost)]),
        totals: [
          ["Quantité totale reçue", `${num(totalQty)} bouteilles`],
          ["Montant total", money(total), true],
          ["Montant payé", money(paid) + (method ? ` (${method})` : "")],
          ["Reste à payer", money(total - paid), true],
        ],
        status: paid >= total ? { label: "PAYÉ", tone: "ok" } : paid > 0 ? { label: "PAIEMENT PARTIEL", tone: "warn" } : { label: "NON PAYÉ", tone: "bad" },
      },
      search: [supplier?.name || "", invoice_no, ...lines.flatMap((l) => [l.product.name, l.product.brand])],
    });
    audit(ctx, "entree_enregistree", "entry", id, `Entrée ${doc_no} : ${totalQty} bouteilles, ${money(total)}`, { lines: lines.map((l) => ({ product_id: l.product_id, qty: l.qty, unit_cost: l.unit_cost })), paid });
    touchDay(day, "entrée tardive");
    notify({
      roles: ["owner", "manager"],
      exceptUserId: ctx.user.id,
      type: "entry",
      title: "Nouvelle entrée de marchandises",
      body: `${ctx.user.full_name} a enregistré ${num(totalQty)} bouteilles (${money(total)})${supplier ? ` de ${supplier.name}` : ""}.`,
      link: `#/recus/${doc_no}`,
    });
    signal(["owner", "manager", "cashier", "waiter"], "stock");
    return { id, doc_no, total, paid, qty: totalQty };
  });
}

export function listEntries({ from, to, limit = 200 } = {}) {
  const { where, p } = periodWhere("e.at", from, to);
  return all(
    `SELECT e.*, s.name AS supplier, u.full_name AS user_name,
       (SELECT SUM(qty) FROM entry_lines l WHERE l.entry_id = e.id) AS qty
     FROM entries e LEFT JOIN suppliers s ON s.id = e.supplier_id JOIN users u ON u.id = e.user_id ${where} ORDER BY e.at DESC LIMIT ?`,
    ...p, limit,
  );
}

export function getEntry(id) {
  const e = get("SELECT e.*, s.name AS supplier, u.full_name AS user_name FROM entries e LEFT JOIN suppliers s ON s.id = e.supplier_id JOIN users u ON u.id = e.user_id WHERE e.id = ?", id);
  if (!e) throw notFound("Entrée introuvable.");
  e.lines = all("SELECT l.*, p.name, p.brand FROM entry_lines l JOIN products p ON p.id = l.product_id WHERE entry_id = ?", id);
  e.documents = documentsFor("entry", id);
  return e;
}

function rectification(ctx, { type, original, title, reason, rows, columns, totals, fields = [] }) {
  return createDocument({
    type: "cancellation",
    refType: type,
    refId: original.id,
    at: now(),
    user: ctx.user,
    title,
    payload: { fields: [["Document annulé", original.doc_no], ["Motif de l'annulation", reason], ...fields], columns, rows, totals, status: { label: "ANNULÉ", tone: "bad" }, notes: ["Le document d'origine reste conservé tel quel. Ce rectificatif annule ses effets."] },
    search: [original.doc_no, reason],
    rectifies: original.doc_no,
  });
}

export function cancelEntry(ctx, id, body) {
  const reason = str(body.reason, "Motif de l'annulation", { required: true, min: 5, max: 300 });
  const e = getEntry(id);
  if (e.status !== "valid") throw bad("Cette entrée est déjà annulée.");
  return tx(() => {
    for (const l of e.lines) {
      if (stockOf(l.product_id) < l.qty) throw conflict(`Impossible d'annuler : une partie de ${l.brand} ${l.name} est déjà sortie du stock. Faites plutôt une sortie ou un inventaire.`);
    }
    const t = now();
    run("UPDATE entries SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ?", t, ctx.user.id, reason, id);
    reverseMovements("entry", id, ctx, `Annulation ${e.doc_no}`);
    const doc = rectification(ctx, {
      type: "entry",
      original: e,
      title: "Annulation d'une entrée de boissons",
      reason,
      columns: [{ label: "Boisson", w: 3 }, { label: "Qté retirée du stock", align: "right", w: 1.5 }, { label: "Montant", align: "right", w: 1.5 }],
      rows: e.lines.map((l) => [`${l.brand} — ${l.name}`, num(l.qty), money(l.line_total)]),
      totals: [["Montant annulé", money(e.total_amount), true]],
    });
    audit(ctx, "entree_annulee", "entry", id, `Entrée ${e.doc_no} annulée : ${reason}`, { rectificatif: doc });
    touchDay(e.business_day, "annulation d'entrée");
    notify({ roles: ["owner"], type: "exceptional", severity: "warn", title: "Entrée annulée", body: `${ctx.user.full_name} a annulé l'entrée ${e.doc_no} (${money(e.total_amount)}). Motif : ${reason}`, link: `#/recus/${doc}` });
    signal(["owner", "manager", "cashier", "waiter"], "stock");
    return { doc_no: doc };
  });
}

// ---------- Sorties hors ventes ----------
export function createExit(ctx, body) {
  const reason = oneOf(body.reason, "Motif de la sortie", ["offered", "staff", "broken", "lost", "expired", "other"]);
  const lines = parseCrateLines(body.lines);
  const observation = str(body.observation, "Observation", { max: 500, required: reason === "other" || reason === "lost" });
  const responsible_name = str(body.responsible_name, "Nom du responsable", { max: 80 });
  const waiter_id = body.waiter_id ? int(body.waiter_id, "Serveur", { min: 1 }) : null;
  const waiter = waiter_id ? get("SELECT * FROM users WHERE id = ? AND role = 'waiter'", waiter_id) : null;
  if (waiter_id && !waiter) throw bad("Serveur inconnu.");
  const at = ctx.at || now();
  const day = businessDay(at);

  return tx(() => {
    checkStock(lines, ctx);
    const before = snapshotStock(lines.map((l) => l.product_id));
    const doc_no = newDocNumber("exit", at);
    const id = Number(
      run(
        "INSERT INTO exits (doc_no, at, business_day, reason, responsible_name, waiter_id, user_id, observation, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        doc_no, at, day, reason, responsible_name, waiter_id, ctx.user.id, observation, now(),
      ).lastInsertRowid,
    );
    for (const l of lines) {
      run(
        "INSERT INTO exit_lines (exit_id, product_id, crates, units_per_crate, extra_units, qty, unit_cost, unit_price) VALUES (?,?,?,?,?,?,?,?)",
        id, l.product_id, l.crates, l.units_per_crate, l.extra_units, l.qty, l.unit_cost, l.unit_price,
      );
      addMovement({ at, business_day: day, product_id: l.product_id, qty: -l.qty, kind: reason, unit_cost: l.unit_cost, unit_price: l.unit_price, ref_type: "exit", ref_id: id, user_id: ctx.user.id, waiter_id, note: observation });
    }
    const totalQty = lines.reduce((s, l) => s + l.qty, 0);
    const value = lines.reduce((s, l) => s + l.qty * l.unit_cost, 0);
    createDocument({
      type: "exit",
      docNo: doc_no,
      refType: "exit",
      refId: id,
      at,
      user: ctx.user,
      amount: value,
      payload: {
        fields: [
          ["Motif de la sortie", EXIT_LABELS[reason]],
          ["Responsable", responsible_name || ctx.user.full_name],
          ["Serveur concerné", waiter?.full_name || "—"],
          ["Observation", observation || "—"],
        ],
        columns: [
          { label: "Boisson", w: 3 },
          { label: "Casiers", align: "right", w: 1 },
          { label: "Bouteilles", align: "right", w: 1.2 },
          { label: "Qté totale", align: "right", w: 1.2 },
          { label: "Valeur (achat)", align: "right", w: 1.8 },
        ],
        rows: lines.map((l) => [`${l.product.brand} — ${l.product.name}`, num(l.crates), num(l.extra_units), num(l.qty), money(l.qty * l.unit_cost)]),
        totals: [
          ["Quantité totale sortie", `${num(totalQty)} bouteilles`, true],
          ["Valeur au prix d'achat", money(value)],
          ["Valeur au prix de vente", money(lines.reduce((s, l) => s + l.qty * l.unit_price, 0))],
        ],
        status: { label: EXIT_LABELS[reason].toUpperCase(), tone: ["broken", "lost", "expired"].includes(reason) ? "bad" : "warn" },
      },
      search: [EXIT_LABELS[reason], responsible_name, waiter?.full_name || "", ...lines.flatMap((l) => [l.product.name, l.product.brand])],
    });
    audit(ctx, "sortie_enregistree", "exit", id, `Sortie ${doc_no} (${EXIT_LABELS[reason]}) : ${totalQty} bouteilles`, { lines: lines.map((l) => ({ product_id: l.product_id, qty: l.qty })) });
    touchDay(day, "sortie tardive");
    notify({
      roles: ["owner", "manager"],
      exceptUserId: ctx.user.id,
      type: "exit",
      severity: LOSS_KINDS.includes(reason) ? "warn" : "info",
      title: `Nouvelle sortie : ${EXIT_LABELS[reason].toLowerCase()}`,
      body: `${ctx.user.full_name} : ${lines.map((l) => `${l.qty} ${l.product.brand} ${l.product.name}`).join(", ")}${observation ? ` — ${observation}` : ""}.`,
      link: `#/recus/${doc_no}`,
    });
    stockAlerts(before);
    signal(["owner", "manager", "cashier", "waiter"], "stock");
    return { id, doc_no, qty: totalQty };
  });
}

export function listExits({ from, to, limit = 200 } = {}) {
  const { where, p } = periodWhere("x.at", from, to);
  return all(
    `SELECT x.*, u.full_name AS user_name, w.full_name AS waiter_name,
       (SELECT SUM(qty) FROM exit_lines l WHERE l.exit_id = x.id) AS qty
     FROM exits x JOIN users u ON u.id = x.user_id LEFT JOIN users w ON w.id = x.waiter_id ${where} ORDER BY x.at DESC LIMIT ?`,
    ...p, limit,
  ).map((x) => ({ ...x, reason_label: EXIT_LABELS[x.reason] }));
}

export function getExit(id) {
  const x = get("SELECT x.*, u.full_name AS user_name, w.full_name AS waiter_name FROM exits x JOIN users u ON u.id = x.user_id LEFT JOIN users w ON w.id = x.waiter_id WHERE x.id = ?", id);
  if (!x) throw notFound("Sortie introuvable.");
  x.reason_label = EXIT_LABELS[x.reason];
  x.lines = all("SELECT l.*, p.name, p.brand FROM exit_lines l JOIN products p ON p.id = l.product_id WHERE exit_id = ?", id);
  x.documents = documentsFor("exit", id);
  return x;
}

export function cancelExit(ctx, id, body) {
  const reason = str(body.reason, "Motif de l'annulation", { required: true, min: 5, max: 300 });
  const x = getExit(id);
  if (x.status !== "valid") throw bad("Cette sortie est déjà annulée.");
  return tx(() => {
    run("UPDATE exits SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ?", now(), ctx.user.id, reason, id);
    reverseMovements("exit", id, ctx, `Annulation ${x.doc_no}`);
    const doc = rectification(ctx, {
      type: "exit",
      original: x,
      title: "Annulation d'une sortie de boissons",
      reason,
      fields: [["Motif d'origine", x.reason_label]],
      columns: [{ label: "Boisson", w: 3 }, { label: "Qté remise en stock", align: "right", w: 1.5 }],
      rows: x.lines.map((l) => [`${l.brand} — ${l.name}`, num(l.qty)]),
      totals: [["Bouteilles remises en stock", num(x.lines.reduce((s, l) => s + l.qty, 0)), true]],
    });
    audit(ctx, "sortie_annulee", "exit", id, `Sortie ${x.doc_no} annulée : ${reason}`, { rectificatif: doc });
    touchDay(x.business_day, "annulation de sortie");
    notify({ roles: ["owner"], type: "exceptional", severity: "warn", title: "Sortie annulée", body: `${ctx.user.full_name} a annulé la sortie ${x.doc_no} (${x.reason_label}). Motif : ${reason}`, link: `#/recus/${doc}` });
    signal(["owner", "manager", "cashier", "waiter"], "stock");
    return { doc_no: doc };
  });
}

// ---------- État du stock ----------
export function periodWhere(col, from, to, extra = []) {
  const where = [...extra];
  const p = [];
  if (isDay(from)) {
    where.push(`${col} >= ?`);
    p.push(dayBounds(from).start);
  }
  if (isDay(to)) {
    where.push(`${col} < ?`);
    p.push(dayBounds(to).end);
  }
  return { where: where.length ? "WHERE " + where.join(" AND ") : "", p };
}

export function stockList({ includeInactive = false } = {}) {
  return all(
    `SELECT p.id, p.name, p.brand, p.reference, p.photo, p.units_per_crate, p.pack_label, p.min_stock, p.purchase_price, p.sale_price, p.active, c.name AS category, c.sort AS category_sort,
       COALESCE(SUM(m.qty), 0) AS stock,
       COALESCE(SUM(CASE WHEN m.kind = 'initial' THEN m.qty END), 0) AS initial,
       COALESCE(SUM(CASE WHEN m.kind = 'entry' THEN m.qty END), 0) AS entries,
       COALESCE(-SUM(CASE WHEN m.kind = 'sale' THEN m.qty END), 0) AS sold,
       COALESCE(-SUM(CASE WHEN m.kind IN ('offered','staff','broken','lost','expired','other') THEN m.qty END), 0) AS other_exits,
       COALESCE(SUM(CASE WHEN m.kind = 'inventory' THEN m.qty END), 0) AS inventory_adjust
     FROM products p JOIN categories c ON c.id = p.category_id LEFT JOIN stock_movements m ON m.product_id = p.id
     ${includeInactive ? "" : "WHERE p.active = 1"}
     GROUP BY p.id ORDER BY c.sort, p.brand, p.name`,
  ).map((r) => ({ ...r, value: r.stock * r.purchase_price, sale_value: r.stock * r.sale_price, low: r.stock <= r.min_stock, out: r.stock <= 0, label: cratesLabel(r.stock, r.units_per_crate, r.pack_label) }));
}

export function movementJournal({ from, to, kind, product_id, user_id, limit = 300 } = {}) {
  const extra = [];
  const ps = [];
  if (kind === "exits") extra.push("m.kind IN ('sale','offered','staff','broken','lost','expired','other')");
  else if (kind && /^[a-z]+$/.test(kind)) {
    extra.push("m.kind = ?");
    ps.push(kind);
  }
  if (product_id) {
    extra.push("m.product_id = ?");
    ps.push(Number(product_id));
  }
  if (user_id) {
    extra.push("(m.user_id = ? OR m.waiter_id = ?)");
    ps.push(Number(user_id), Number(user_id));
  }
  const { where, p } = periodWhere("m.at", from, to, extra);
  return all(
    `SELECT m.*, p.name, p.brand, p.units_per_crate, u.full_name AS user_name, w.full_name AS waiter_name,
       COALESCE(e.doc_no, x.doc_no, s.doc_no, i.doc_no) AS doc_no
     FROM stock_movements m JOIN products p ON p.id = m.product_id
     LEFT JOIN users u ON u.id = m.user_id LEFT JOIN users w ON w.id = m.waiter_id
     LEFT JOIN entries e ON m.ref_type = 'entry' AND e.id = m.ref_id
     LEFT JOIN exits x ON m.ref_type = 'exit' AND x.id = m.ref_id
     LEFT JOIN sales s ON m.ref_type = 'sale' AND s.id = m.ref_id
     LEFT JOIN inventories i ON m.ref_type = 'inventory' AND i.id = m.ref_id
     ${where} ORDER BY m.at DESC, m.id DESC LIMIT ?`,
    ...ps, ...p, Math.min(Number(limit) || 300, 2000),
  ).map((m) => ({ ...m, kind_label: m.kind === "entry" ? "Entrée" : m.kind === "initial" ? "Stock initial" : m.kind === "inventory" ? "Ajustement d'inventaire" : EXIT_LABELS[m.kind], reversal: !!m.reversal_of }));
}

// ---------- Inventaires physiques ----------
export function createInventory(ctx, body) {
  const kind = oneOf(body.kind || "daily", "Type d'inventaire", ["daily", "weekly", "monthly"]);
  if (get("SELECT 1 FROM inventories WHERE status = 'draft'")) throw conflict("Un inventaire est déjà en cours : terminez-le ou abandonnez-le d'abord.");
  return tx(() => {
    const t = now();
    const id = Number(run("INSERT INTO inventories (kind, started_at, business_day, user_id, note) VALUES (?,?,?,?,?)", kind, t, businessDay(t), ctx.user.id, str(body.note, "Note", { max: 300 })).lastInsertRowid);
    for (const p of all("SELECT id FROM products WHERE active = 1")) run("INSERT INTO inventory_lines (inventory_id, product_id) VALUES (?, ?)", id, p.id);
    audit(ctx, "inventaire_ouvert", "inventory", id, `Inventaire ${kind} commencé`);
    return getInventory(id);
  });
}

export function getInventory(id) {
  const inv = get("SELECT i.*, u.full_name AS user_name, v.full_name AS validated_by_name FROM inventories i JOIN users u ON u.id = i.user_id LEFT JOIN users v ON v.id = i.validated_by WHERE i.id = ?", id);
  if (!inv) throw notFound("Inventaire introuvable.");
  inv.lines = all(
    `SELECT l.*, p.name, p.brand, p.units_per_crate, p.pack_label, p.purchase_price, c.name AS category,
       COALESCE((SELECT SUM(qty) FROM stock_movements m WHERE m.product_id = p.id), 0) AS current_stock
     FROM inventory_lines l JOIN products p ON p.id = l.product_id JOIN categories c ON c.id = p.category_id
     WHERE inventory_id = ? ORDER BY c.sort, p.brand, p.name`,
    id,
  ).map((l) => (inv.status === "draft" ? { ...l, theoretical: l.current_stock, difference: l.counted === null ? null : l.counted - l.current_stock } : l));
  return inv;
}

export const listInventories = () =>
  all("SELECT i.*, u.full_name AS user_name, (SELECT COUNT(*) FROM inventory_lines l WHERE l.inventory_id = i.id AND l.difference != 0) AS gaps FROM inventories i JOIN users u ON u.id = i.user_id ORDER BY i.id DESC LIMIT 100");

export function saveInventoryCounts(ctx, id, body) {
  const inv = get("SELECT * FROM inventories WHERE id = ?", id);
  if (!inv) throw notFound("Inventaire introuvable.");
  if (inv.status !== "draft") throw bad("Cet inventaire est clôturé.");
  tx(() => {
    for (const l of arr(body.lines, "Comptage", { min: 1, max: 2000 })) {
      const pid = int(l.product_id, "Boisson", { min: 1 });
      const counted = l.counted === null || l.counted === "" || l.counted === undefined ? null : int(l.counted, "Quantité comptée", { min: 0, max: 10_000_000 });
      run("UPDATE inventory_lines SET counted = ?, justification = ? WHERE inventory_id = ? AND product_id = ?", counted, str(l.justification, "Justification", { max: 300 }), id, pid);
    }
  });
  return getInventory(id);
}

export function validateInventory(ctx, id) {
  const inv = getInventory(id);
  if (inv.status !== "draft") throw bad("Cet inventaire est déjà clôturé.");
  const counted = inv.lines.filter((l) => l.counted !== null);
  if (!counted.length) throw bad("Aucune quantité comptée.");
  const missing = counted.filter((l) => l.difference !== 0 && !l.justification.trim());
  if (missing.length) throw bad(`Justifiez chaque écart avant de valider : ${missing.map((l) => `${l.brand} ${l.name}`).join(", ")}.`, { products: missing.map((l) => l.product_id) });
  return tx(() => {
    const t = now();
    const day = businessDay(t);
    const doc_no = newDocNumber("inventory", t);
    for (const l of counted) {
      run("UPDATE inventory_lines SET theoretical = ?, difference = ? WHERE id = ?", l.current_stock, l.difference, l.id);
      if (l.difference !== 0)
        addMovement({ at: t, business_day: day, product_id: l.product_id, qty: l.difference, kind: "inventory", unit_cost: l.purchase_price, ref_type: "inventory", ref_id: id, user_id: ctx.user.id, note: l.justification });
    }
    run("UPDATE inventories SET status = 'validated', validated_at = ?, validated_by = ?, doc_no = ? WHERE id = ?", t, ctx.user.id, doc_no, id);
    const gaps = counted.filter((l) => l.difference !== 0);
    const gapValue = gaps.reduce((s, l) => s + l.difference * l.purchase_price, 0);
    createDocument({
      type: "inventory",
      docNo: doc_no,
      refType: "inventory",
      refId: id,
      at: t,
      user: ctx.user,
      amount: gapValue,
      payload: {
        fields: [
          ["Type", { daily: "Inventaire quotidien", weekly: "Inventaire hebdomadaire", monthly: "Inventaire mensuel" }[inv.kind]],
          ["Commencé le", fmtDateTime(inv.started_at)],
          ["Validé par", ctx.user.full_name],
          ["Boissons comptées", String(counted.length)],
          ["Écarts constatés", String(gaps.length)],
        ],
        columns: [
          { label: "Boisson", w: 3 },
          { label: "Stock informatique", align: "right", w: 1.4 },
          { label: "Compté", align: "right", w: 1 },
          { label: "Écart", align: "right", w: 1 },
          { label: "Justification", w: 2.6 },
        ],
        rows: counted.map((l) => [`${l.brand} — ${l.name}`, num(l.current_stock), num(l.counted), (l.difference > 0 ? "+" : "") + num(l.difference), l.justification || ""]),
        totals: [["Valeur des écarts (prix d'achat)", money(gapValue), true]],
        status: gaps.length ? { label: "ÉCARTS JUSTIFIÉS", tone: "warn" } : { label: "CONFORME", tone: "ok" },
      },
      search: counted.flatMap((l) => [l.name, l.brand]),
    });
    audit(ctx, "inventaire_valide", "inventory", id, `Inventaire ${doc_no} validé : ${gaps.length} écart(s), ${money(gapValue)}`);
    if (gaps.length)
      notify({
        roles: ["owner", "manager"],
        exceptUserId: ctx.user.id,
        type: "exceptional",
        severity: "warn",
        title: "Écarts d'inventaire",
        body: `${gaps.length} écart(s) entre le stock informatique et le stock compté (${money(gapValue)}) : ${gaps.slice(0, 5).map((l) => `${l.brand} ${l.name} ${l.difference > 0 ? "+" : ""}${l.difference}`).join(", ")}.`,
        link: `#/recus/${doc_no}`,
      });
    signal(["owner", "manager", "cashier", "waiter"], "stock");
    return { doc_no, gaps: gaps.length, gap_value: gapValue };
  });
}

export function abandonInventory(ctx, id) {
  const inv = get("SELECT * FROM inventories WHERE id = ?", id);
  if (!inv || inv.status !== "draft") throw bad("Inventaire introuvable ou déjà clôturé.");
  tx(() => {
    run("UPDATE inventories SET status = 'abandoned', validated_at = ?, validated_by = ? WHERE id = ?", now(), ctx.user.id, id);
    audit(ctx, "inventaire_abandonne", "inventory", id, "Inventaire abandonné (aucun ajustement de stock)");
  });
}

// ---------- Paiements fournisseurs ----------
export function createSupplierPayment(ctx, supplierId, body) {
  const s = get("SELECT * FROM suppliers WHERE id = ?", supplierId);
  if (!s) throw notFound("Fournisseur introuvable.");
  const amount = int(body.amount, "Montant", { min: 1 });
  const method = str(body.method, "Mode de paiement", { required: true, max: 40 });
  const note = str(body.note, "Note", { max: 300 });
  const debt =
    get("SELECT COALESCE(SUM(total_amount - paid_amount), 0) AS d FROM entries WHERE supplier_id = ? AND status = 'valid'", supplierId).d -
    get("SELECT COALESCE(SUM(amount), 0) AS p FROM supplier_payments WHERE supplier_id = ?", supplierId).p;
  if (amount > debt) throw bad(`Le montant dépasse la dette envers ce fournisseur (${money(debt)}).`);
  return tx(() => {
    const t = ctx.at || now();
    const doc_no = newDocNumber("supplier_payment", t);
    const id = Number(run("INSERT INTO supplier_payments (doc_no, at, supplier_id, amount, method, note, user_id) VALUES (?,?,?,?,?,?,?)", doc_no, t, supplierId, amount, method, note, ctx.user.id).lastInsertRowid);
    createDocument({
      type: "supplier_payment",
      docNo: doc_no,
      refType: "supplier_payment",
      refId: id,
      at: t,
      user: ctx.user,
      amount,
      payload: {
        fields: [["Fournisseur", s.name], ["Téléphone", s.phone || "—"], ["Mode de paiement", method], ["Note", note || "—"]],
        totals: [["Montant payé", money(amount), true], ["Dette avant paiement", money(debt)], ["Reste dû", money(debt - amount), true]],
        status: debt - amount <= 0 ? { label: "DETTE SOLDÉE", tone: "ok" } : { label: "PAIEMENT PARTIEL", tone: "warn" },
      },
      search: [s.name, method],
    });
    audit(ctx, "paiement_fournisseur", "supplier", supplierId, `Paiement ${doc_no} à ${s.name} : ${money(amount)}`);
    return { doc_no, remaining: debt - amount };
  });
}

// ---------- Consignes ----------
export const CONSIGN_LABELS = {
  supplier: { paid: "Consigne versée au fournisseur", recovered: "Consigne récupérée (vides rendus)" },
  customer: { paid: "Consigne versée par un client", refunded: "Consigne remboursée au client" },
};

export function createConsignment(ctx, body) {
  const party = oneOf(body.party, "Concerné", ["supplier", "customer"]);
  const kind = oneOf(body.kind, "Opération", Object.keys(CONSIGN_LABELS[party]));
  const supplier = party === "supplier" ? get("SELECT * FROM suppliers WHERE id = ?", int(body.supplier_id, "Fournisseur", { min: 1 })) : null;
  if (party === "supplier" && !supplier) throw bad("Fournisseur inconnu.");
  const customer_name = party === "customer" ? str(body.customer_name, "Nom du client", { required: true, max: 80 }) : "";
  const crates = int(body.crates, "Casiers", { required: false, def: 0, min: 0, max: 100000 });
  const bottles = int(body.bottles, "Bouteilles", { required: false, def: 0, min: 0, max: 1000000 });
  const amount = int(body.amount, "Montant", { required: false, def: 0, min: 0 });
  if (!crates && !bottles && !amount) throw bad("Indiquez des casiers, des bouteilles ou un montant.");
  const note = str(body.note, "Note", { max: 300 });
  return tx(() => {
    const t = ctx.at || now();
    const doc_no = newDocNumber("consignment", t);
    const id = Number(
      run("INSERT INTO consignments (doc_no, at, party, supplier_id, customer_name, kind, crates, bottles, amount, note, user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)", doc_no, t, party, supplier?.id ?? null, customer_name, kind, crates, bottles, amount, note, ctx.user.id).lastInsertRowid,
    );
    createDocument({
      type: "consignment",
      docNo: doc_no,
      refType: "consignment",
      refId: id,
      at: t,
      user: ctx.user,
      amount,
      title: `Reçu — ${CONSIGN_LABELS[party][kind]}`,
      payload: {
        fields: [[party === "supplier" ? "Fournisseur" : "Client", supplier?.name || customer_name], ["Opération", CONSIGN_LABELS[party][kind]], ["Note", note || "—"]],
        totals: [["Casiers", num(crates)], ["Bouteilles", num(bottles)], ["Montant", money(amount), true]],
      },
      search: [supplier?.name || customer_name, CONSIGN_LABELS[party][kind]],
    });
    audit(ctx, "consigne", "consignment", id, `${CONSIGN_LABELS[party][kind]} : ${crates} casiers, ${bottles} bouteilles, ${money(amount)}`);
    return { id, doc_no };
  });
}

export function consignmentSummary() {
  const suppliers = all(
    `SELECT s.id, s.name,
       SUM(CASE WHEN c.kind = 'paid' THEN c.crates ELSE -c.crates END) AS crates,
       SUM(CASE WHEN c.kind = 'paid' THEN c.bottles ELSE -c.bottles END) AS bottles,
       SUM(CASE WHEN c.kind = 'paid' THEN c.amount ELSE -c.amount END) AS amount
     FROM consignments c JOIN suppliers s ON s.id = c.supplier_id WHERE c.party = 'supplier' GROUP BY s.id ORDER BY s.name`,
  );
  const customers = all(
    `SELECT customer_name,
       SUM(CASE WHEN kind = 'paid' THEN crates ELSE -crates END) AS crates,
       SUM(CASE WHEN kind = 'paid' THEN bottles ELSE -bottles END) AS bottles,
       SUM(CASE WHEN kind = 'paid' THEN amount ELSE -amount END) AS amount
     FROM consignments WHERE party = 'customer' GROUP BY customer_name COLLATE NOCASE HAVING amount != 0 OR bottles != 0 OR crates != 0 ORDER BY customer_name`,
  );
  const history = all("SELECT c.*, s.name AS supplier, u.full_name AS user_name FROM consignments c LEFT JOIN suppliers s ON s.id = c.supplier_id JOIN users u ON u.id = c.user_id ORDER BY c.at DESC LIMIT 200").map((c) => ({
    ...c,
    label: CONSIGN_LABELS[c.party][c.kind],
  }));
  return { suppliers, customers, history };
}
