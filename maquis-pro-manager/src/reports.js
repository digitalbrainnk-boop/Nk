// Bilans automatiques, calculés uniquement à partir des opérations réellement enregistrées.
// - Chaque jour à 03 h 00 : bilan des sorties de la journée commerciale écoulée.
// - Chaque lundi à 03 h 00 : bilan des ventes de la semaine commerciale écoulée.
// Exécutés par le serveur (jamais par le téléphone). Au redémarrage après une panne, les
// bilans manquants sont produits automatiquement (reprise). Une opération arrivée en retard
// sur une période déjà close produit un bilan rectificatif : l'original est conservé.
import { all, get, run, tx, getSetting, setSetting, allSettings } from "./db.js";
import { now, businessDay, dayBounds, addDays, weekStart, weekBounds, daysBetween, fmtDay, fmtDayShort, fmtDateTime, isoWeekNumber, isDay } from "./time.js";
import { audit } from "./audit.js";
import { notify } from "./notify.js";
import { createDocument } from "./documents.js";
import { EXIT_KINDS, EXIT_LABELS, LOSS_KINDS } from "./stock.js";
import { sessionSummary } from "./cash.js";
import { money, num, pct, variation, cratesLabel, notFound, pname } from "./util.js";
import { backupIfDue } from "./backup.js";

const productInfo = () =>
  new Map(
    all("SELECT p.id, p.name, p.brand, p.units_per_crate, p.pack_label, p.min_stock, p.purchase_price, p.sale_price, p.active, c.name AS category, c.sort FROM products p JOIN categories c ON c.id = p.category_id").map((p) => [p.id, p]),
  );

const crates = (qty, upc) => (upc > 1 ? qty / upc : 0);
const round1 = (x) => Math.round(x * 10) / 10;

// Sorties (toutes natures) par boisson sur un ensemble de journées commerciales.
function exitsByProduct(fromDay, toDay, products) {
  const rows = all(
    `SELECT product_id, kind, -SUM(qty) AS qty, -SUM(qty * unit_cost) AS cost, -SUM(qty * unit_price) AS value
     FROM stock_movements WHERE business_day BETWEEN ? AND ? AND kind IN (${EXIT_KINDS.map(() => "?").join(",")})
     GROUP BY product_id, kind`,
    fromDay, toDay, ...EXIT_KINDS,
  );
  const map = new Map();
  for (const r of rows) {
    const p = products.get(r.product_id);
    if (!map.has(r.product_id))
      map.set(r.product_id, { product_id: r.product_id, name: p.name, brand: p.brand, category: p.category, sort: p.sort, units_per_crate: p.units_per_crate, ...Object.fromEntries(EXIT_KINDS.map((k) => [k, 0])), total: 0, cost: 0, sale_value: 0, loss_cost: 0 });
    const x = map.get(r.product_id);
    x[r.kind] += r.qty;
    x.total += r.qty;
    x.cost += r.cost;
    if (r.kind === "sale") x.sale_value += r.value;
    if (LOSS_KINDS.includes(r.kind)) x.loss_cost += r.cost;
  }
  return [...map.values()]
    .filter((x) => x.total !== 0 || EXIT_KINDS.some((k) => x[k] !== 0))
    .map((x) => ({ ...x, crates: round1(crates(x.total, x.units_per_crate)), label: cratesLabel(x.total, x.units_per_crate) }))
    .sort((a, b) => a.sort - b.sort || a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name));
}

function groupBy(items, keyFn, init) {
  const m = new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (!m.has(k)) m.set(k, init(it));
    const acc = m.get(k);
    acc.total += it.total;
    acc.sold += it.sale;
    acc.sale_value += it.sale_value;
    for (const kd of EXIT_KINDS) acc[kd] += it[kd];
  }
  return [...m.values()];
}

function aggregates(byProduct) {
  const zero = () => Object.fromEntries(EXIT_KINDS.map((k) => [k, 0]));
  const byBrand = groupBy(byProduct, (x) => `${x.category}|${x.brand}`, (x) => ({ category: x.category, sort: x.sort, brand: x.brand, total: 0, sold: 0, sale_value: 0, ...zero() })).sort(
    (a, b) => a.sort - b.sort || b.total - a.total,
  );
  const byCategory = groupBy(byProduct, (x) => x.category, (x) => ({ category: x.category, sort: x.sort, total: 0, sold: 0, sale_value: 0, ...zero() })).sort((a, b) => a.sort - b.sort);
  for (const c of byCategory) c.brands = byBrand.filter((b) => b.category === c.category).map((b) => ({ brand: b.brand, total: b.total, sold: b.sold }));
  const byKind = zero();
  for (const x of byProduct) for (const k of EXIT_KINDS) byKind[k] += x[k];
  const total = byProduct.reduce((s, x) => s + x.total, 0);
  return {
    byBrand,
    byCategory,
    byKind,
    total,
    crates: round1(byProduct.reduce((s, x) => s + crates(x.total, x.units_per_crate), 0)),
    full_crates: byProduct.reduce((s, x) => s + (x.units_per_crate > 1 ? Math.floor(Math.max(0, x.total) / x.units_per_crate) : 0), 0),
  };
}

function salesStats(fromDay, toDay) {
  const s = get(
    `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS amount FROM sales WHERE business_day BETWEEN ? AND ? AND status != 'cancelled'`,
    fromDay, toDay,
  );
  const credit = get(
    `SELECT COALESCE(SUM(s.total - COALESCE((SELECT SUM(amount) FROM payments p WHERE p.sale_id = s.id AND p.kind = 'sale'), 0)), 0) AS v
     FROM sales s WHERE business_day BETWEEN ? AND ? AND status != 'cancelled'`,
    fromDay, toDay,
  ).v;
  const creditCustomers = all(
    `SELECT s.doc_no, s.customer_name, s.total, s.total - COALESCE((SELECT SUM(amount) FROM payments p WHERE p.sale_id = s.id AND p.kind = 'sale'), 0) AS credit
     FROM sales s WHERE business_day BETWEEN ? AND ? AND status != 'cancelled' AND s.total > COALESCE((SELECT SUM(amount) FROM payments p WHERE p.sale_id = s.id AND p.kind = 'sale'), 0)
     ORDER BY s.at LIMIT 200`,
    fromDay, toDay,
  );
  const collected = all(
    "SELECT method, kind, SUM(amount) AS amount FROM payments WHERE business_day BETWEEN ? AND ? GROUP BY method, kind",
    fromDay, toDay,
  );
  const refunds = get("SELECT COALESCE(SUM(amount), 0) AS v FROM cash_movements WHERE kind = 'refund' AND business_day BETWEEN ? AND ?", fromDay, toDay).v;
  const byMethod = {};
  for (const r of collected) byMethod[r.method] = (byMethod[r.method] || 0) + r.amount;
  const collectedTotal = collected.reduce((a, r) => a + r.amount, 0);
  const creditSettled = collected.filter((r) => r.kind === "credit").reduce((a, r) => a + r.amount, 0);
  const cancelled = get("SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS v FROM sales WHERE business_day BETWEEN ? AND ? AND status = 'cancelled'", fromDay, toDay);
  const byWaiter = all(
    `SELECT COALESCE(u.full_name, 'Vente au comptoir') AS waiter, m.waiter_id,
       -SUM(m.qty) AS bottles, -SUM(m.qty * m.unit_price) AS amount, -SUM(m.qty * (m.unit_price - m.unit_cost)) AS margin
     FROM stock_movements m LEFT JOIN users u ON u.id = m.waiter_id
     WHERE m.kind = 'sale' AND m.business_day BETWEEN ? AND ? GROUP BY m.waiter_id ORDER BY amount DESC`,
    fromDay, toDay,
  ).map((w) => ({ ...w, sales: get("SELECT COUNT(*) AS n FROM sales WHERE business_day BETWEEN ? AND ? AND status != 'cancelled' AND waiter_id IS ?", fromDay, toDay, w.waiter_id).n }));
  const cogs = get("SELECT COALESCE(-SUM(qty * unit_cost), 0) AS v FROM stock_movements WHERE kind = 'sale' AND business_day BETWEEN ? AND ?", fromDay, toDay).v;
  const bottles = get("SELECT COALESCE(-SUM(qty), 0) AS v FROM stock_movements WHERE kind = 'sale' AND business_day BETWEEN ? AND ?", fromDay, toDay).v;
  return {
    count: s.count,
    amount: s.amount,
    bottles,
    cogs,
    gross_profit: s.amount - cogs,
    credit_given: credit,
    credit_customers: creditCustomers,
    collected: collectedTotal,
    collected_by_method: Object.entries(byMethod).map(([method, amount]) => ({ method, amount })),
    credit_settled: creditSettled,
    refunds,
    net_collected: collectedTotal - refunds,
    cancelled_count: cancelled.n,
    cancelled_amount: cancelled.v,
    by_waiter: byWaiter,
  };
}

function exitsByWaiter(fromDay, toDay) {
  return all(
    `SELECT COALESCE(u.full_name, 'Sans serveur') AS waiter, m.kind, -SUM(m.qty) AS qty
     FROM stock_movements m LEFT JOIN users u ON u.id = m.waiter_id
     WHERE m.business_day BETWEEN ? AND ? AND m.kind IN (${EXIT_KINDS.map(() => "?").join(",")}) AND m.waiter_id IS NOT NULL
     GROUP BY m.waiter_id, m.kind`,
    fromDay, toDay, ...EXIT_KINDS,
  ).reduce((acc, r) => {
    let w = acc.find((x) => x.waiter === r.waiter);
    if (!w) acc.push((w = { waiter: r.waiter, total: 0, ...Object.fromEntries(EXIT_KINDS.map((k) => [k, 0])) }));
    w[r.kind] += r.qty;
    w.total += r.qty;
    return acc;
  }, []);
}

function cashStats(fromDay, toDay) {
  const sessions = all("SELECT id FROM cash_sessions WHERE business_day BETWEEN ? AND ? ORDER BY opened_at", fromDay, toDay).map((r) => {
    const s = sessionSummary(r.id);
    return {
      id: s.id,
      cashier: s.cashier_name,
      opened_at: s.opened_at,
      closed_at: s.closed_at,
      status: s.status,
      opening: s.opening_float,
      collected: s.totals.collected,
      expenses: s.totals.expenses,
      deposits: s.totals.deposits,
      withdrawals: s.totals.withdrawals,
      refunds: s.totals.refunds,
      theoretical: s.totals.theoretical,
      counted: s.totals.counted,
      variance: s.totals.variance,
    };
  });
  const expenses = all(
    "SELECT x.doc_no, x.category, x.description, x.amount, x.method, u.full_name AS user_name FROM expenses x JOIN users u ON u.id = x.user_id WHERE x.status = 'valid' AND x.business_day BETWEEN ? AND ? ORDER BY x.at",
    fromDay, toDay,
  );
  const mv = (kind) => get("SELECT COALESCE(SUM(amount), 0) AS v FROM cash_movements WHERE kind = ? AND business_day BETWEEN ? AND ?", kind, fromDay, toDay).v;
  const byCat = {};
  for (const e of expenses) byCat[e.category] = (byCat[e.category] || 0) + e.amount;
  return {
    sessions,
    expenses,
    expenses_total: expenses.reduce((s, e) => s + e.amount, 0),
    expenses_by_category: Object.entries(byCat).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    deposits: mv("deposit"),
    withdrawals: mv("withdrawal"),
    refunds: mv("refund"),
    variance_total: sessions.reduce((s, x) => s + (x.variance || 0), 0),
    open_sessions: sessions.filter((s) => s.status === "open").map((s) => s.cashier),
  };
}

function lossDetails(fromDay, toDay) {
  return all(
    `SELECT x.doc_no, x.reason, x.responsible_name, x.observation, u.full_name AS user_name, w.full_name AS waiter_name, p.brand, p.name, l.qty, l.qty * l.unit_cost AS cost
     FROM exits x JOIN exit_lines l ON l.exit_id = x.id JOIN products p ON p.id = l.product_id JOIN users u ON u.id = x.user_id LEFT JOIN users w ON w.id = x.waiter_id
     WHERE x.status = 'valid' AND x.business_day BETWEEN ? AND ? AND x.reason != 'sale' ORDER BY x.at`,
    fromDay, toDay,
  ).map((r) => ({ ...r, reason_label: EXIT_LABELS[r.reason] }));
}

function stockAt(lastDay, products) {
  const rows = all("SELECT product_id, SUM(qty) AS stock FROM stock_movements WHERE business_day <= ? GROUP BY product_id", lastDay);
  const m = new Map(rows.map((r) => [r.product_id, r.stock]));
  return [...products.values()]
    .filter((p) => p.active || m.get(p.id))
    .map((p) => {
      const stock = m.get(p.id) || 0;
      return { product_id: p.id, name: p.name, brand: p.brand, category: p.category, sort: p.sort, stock, label: cratesLabel(stock, p.units_per_crate, p.pack_label), value: stock * p.purchase_price, sale_value: stock * p.sale_price, low: stock <= p.min_stock, min_stock: p.min_stock };
    })
    .sort((a, b) => a.sort - b.sort || a.brand.localeCompare(b.brand));
}

function inventoryGaps(fromDay, toDay) {
  return all(
    `SELECT p.brand, p.name, SUM(m.qty) AS qty, SUM(m.qty * m.unit_cost) AS value FROM stock_movements m JOIN products p ON p.id = m.product_id
     WHERE m.kind = 'inventory' AND m.business_day BETWEEN ? AND ? GROUP BY m.product_id`,
    fromDay, toDay,
  );
}

function responsibles(start, end) {
  return all(
    `SELECT user_name, role, COUNT(*) AS operations FROM audit_log WHERE at >= ? AND at < ? AND user_id IS NOT NULL AND action NOT IN ('connexion') GROUP BY user_id ORDER BY operations DESC`,
    start, end,
  );
}

function ranking(byProduct) {
  const sold = byProduct.filter((x) => x.sale > 0).sort((a, b) => b.sale - a.sale || b.sale_value - a.sale_value);
  const pick = (x) => x && { name: `${pname(x)}`, brand: x.brand, qty: x.sale, amount: x.sale_value };
  return { best: pick(sold[0]), least: pick(sold.length > 1 ? sold[sold.length - 1] : null), top: sold.slice(0, 10).map(pick), flop: sold.slice(-5).reverse().map(pick) };
}

// ---------- Bilan quotidien (sorties) ----------
export function computeDaily(day) {
  const { start, end } = dayBounds(day);
  const products = productInfo();
  const byProduct = exitsByProduct(day, day, products);
  const agg = aggregates(byProduct);
  const sales = salesStats(day, day);
  const cash = cashStats(day, day);
  const losses = lossDetails(day, day);
  const stock = stockAt(day, products);
  const rank = ranking(byProduct);
  const gaps = inventoryGaps(day, day);
  const prev = salesStats(addDays(day, -1), addDays(day, -1));
  const last7 = daysBetween(addDays(day, -7), addDays(day, -1)).map((d) => salesStats(d, d)).filter((s) => s.count > 0);
  const avg7 = last7.length ? Math.round(last7.reduce((s, x) => s + x.amount, 0) / last7.length) : null;
  const avg7Bottles = last7.length ? Math.round(last7.reduce((s, x) => s + x.bottles, 0) / last7.length) : null;
  const lossQty = LOSS_KINDS.reduce((s, k) => s + agg.byKind[k], 0);
  const lossCost = byProduct.reduce((s, x) => s + x.loss_cost, 0);
  const offeredValue = all("SELECT COALESCE(-SUM(qty * unit_price), 0) AS v FROM stock_movements WHERE kind = 'offered' AND business_day = ?", day)[0].v;
  const pendingOrders = get("SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS v FROM orders WHERE business_day = ? AND status = 'pending'", day);
  const unsold = stock.filter((s) => s.stock > 0 && !byProduct.some((x) => x.product_id === s.product_id && x.sale > 0)).map((s) => `${pname(s)}`);

  const obs = [];
  if (!sales.count && !agg.total) obs.push("Aucune vente ni sortie de boisson n'a été enregistrée pendant cette journée commerciale.");
  if (sales.count) {
    const v = variation(sales.amount, prev.amount);
    if (v !== null) obs.push(`Ventes ${v >= 0 ? "en hausse" : "en baisse"} de ${Math.abs(v)} % par rapport à la veille (${money(prev.amount)}).`);
    if (avg7) {
      const v7 = variation(sales.amount, avg7);
      obs.push(`Par rapport à la moyenne des ${last7.length} journée(s) précédente(s) avec ventes (${money(avg7)}) : ${v7 >= 0 ? "+" : ""}${v7} %.`);
    }
    if (rank.best) obs.push(`Boisson la plus vendue : ${rank.best.name} (${num(rank.best.qty)} bouteilles).`);
  }
  if (lossQty > 0) obs.push(`Pertes (cassées, perdues, périmées) : ${num(lossQty)} bouteille(s), soit ${money(lossCost)} au prix d'achat (${pct(lossQty, agg.total)} % des sorties).`);
  if (agg.byKind.offered > 0) obs.push(`Boissons offertes : ${num(agg.byKind.offered)} bouteille(s), soit ${money(offeredValue)} au prix de vente.`);
  if (agg.byKind.staff > 0) obs.push(`Consommation du personnel : ${num(agg.byKind.staff)} bouteille(s).`);
  for (const s of cash.sessions) if (s.variance) obs.push(`Écart de caisse de ${money(s.variance)} sur la caisse de ${s.cashier}.`);
  if (cash.open_sessions.length) obs.push(`Caisse(s) encore ouverte(s) au moment du bilan : ${cash.open_sessions.join(", ")}. Leurs écarts ne sont pas encore connus.`);
  if (sales.credit_given > 0) obs.push(`Ventes à crédit non encaissées : ${money(sales.credit_given)} (${sales.credit_customers.length} client(s)).`);
  if (pendingOrders.n) obs.push(`${pendingOrders.n} commande(s) de serveurs restée(s) en attente, non encaissée(s) (${money(pendingOrders.v)}).`);
  if (sales.cancelled_count) obs.push(`${sales.cancelled_count} vente(s) annulée(s) (${money(sales.cancelled_amount)}).`);
  if (gaps.length) obs.push(`Écarts d'inventaire : ${gaps.map((g) => `${pname(g)} ${g.qty > 0 ? "+" : ""}${g.qty}`).join(", ")}.`);
  const low = stock.filter((s) => s.low && s.min_stock > 0);
  if (low.length) obs.push(`Stock faible à la clôture : ${low.map((s) => `${pname(s)} (${s.stock})`).join(", ")}.`);

  return {
    kind: "daily",
    period: { key: day, label: fmtDay(day), short: fmtDayShort(day), start, end, start_label: fmtDateTime(start), end_label: fmtDateTime(end - 1000) },
    exits: { total_bottles: agg.total, crates_equivalent: agg.crates, full_crates: agg.full_crates, by_kind: agg.byKind, by_product: byProduct, by_brand: agg.byBrand, by_category: agg.byCategory, by_waiter: exitsByWaiter(day, day) },
    sales,
    cash,
    losses,
    analysis: {
      best_seller: rank.best,
      least_seller: rank.least,
      top: rank.top,
      top_brands: [...agg.byBrand].sort((a, b) => b.sold - a.sold).filter((b) => b.sold > 0).slice(0, 5).map((b) => ({ brand: b.brand, qty: b.sold, amount: b.sale_value })),
      top_categories: [...agg.byCategory].sort((a, b) => b.sold - a.sold).filter((c) => c.sold > 0).map((c) => ({ category: c.category, qty: c.sold, amount: c.sale_value })),
      unsold,
      loss_qty: lossQty,
      loss_cost: lossCost,
      offered_qty: agg.byKind.offered,
      offered_value: offeredValue,
      inventory_gaps: gaps,
      comparison: { previous_day: { amount: prev.amount, bottles: prev.bottles, variation: variation(sales.amount, prev.amount) }, average_7d: avg7 === null ? null : { amount: avg7, bottles: avg7Bottles, days: last7.length, variation: variation(sales.amount, avg7) } },
      pending_orders: pendingOrders.n,
      observations: obs,
    },
    stock_end: stock,
    responsibles: responsibles(start, end),
  };
}

// ---------- Bilan hebdomadaire (ventes) ----------
export function computeWeekly(monday) {
  const sunday = addDays(monday, 6);
  const { start, end } = weekBounds(monday);
  const products = productInfo();
  const byProduct = exitsByProduct(monday, sunday, products);
  const agg = aggregates(byProduct);
  const sales = salesStats(monday, sunday);
  const cash = cashStats(monday, sunday);
  const stock = stockAt(sunday, products);
  const rank = ranking(byProduct);
  const prevMonday = addDays(monday, -7);
  const prev = salesStats(prevMonday, addDays(prevMonday, 6));
  const prevCash = cashStats(prevMonday, addDays(prevMonday, 6));
  const prevAgg = aggregates(exitsByProduct(prevMonday, addDays(prevMonday, 6), products));
  const lossCost = byProduct.reduce((s, x) => s + x.loss_cost, 0);
  const soldCrates = round1(byProduct.reduce((s, x) => s + crates(x.sale, x.units_per_crate), 0));
  const purchases = get("SELECT COALESCE(SUM(total_amount), 0) AS v, COUNT(*) AS n FROM entries WHERE status = 'valid' AND business_day BETWEEN ? AND ?", monday, sunday);
  const daily = daysBetween(monday, sunday).map((d) => {
    const s = salesStats(d, d);
    return { day: d, label: fmtDay(d).split(" ").slice(0, 2).join(" "), amount: s.amount, bottles: s.bottles, collected: s.collected };
  });
  const result = sales.gross_profit - cash.expenses_total - lossCost;
  const obs = [];
  if (!sales.count) obs.push("Aucune vente enregistrée pendant cette semaine commerciale.");
  else {
    const v = variation(sales.amount, prev.amount);
    if (v !== null) obs.push(`Chiffre d'affaires ${v >= 0 ? "en hausse" : "en baisse"} de ${Math.abs(v)} % par rapport à la semaine précédente (${money(prev.amount)}).`);
    const best = [...daily].sort((a, b) => b.amount - a.amount)[0];
    if (best?.amount) obs.push(`Meilleure journée : ${best.label} (${money(best.amount)}).`);
    if (rank.best) obs.push(`Boisson la plus vendue : ${rank.best.name} (${num(rank.best.qty)} bouteilles, ${money(rank.best.amount)}).`);
    obs.push(`Bénéfice brut estimé : ${money(sales.gross_profit)} (marge ${pct(sales.gross_profit, sales.amount)} %).`);
  }
  const lossQty = LOSS_KINDS.reduce((s, k) => s + agg.byKind[k], 0);
  if (lossQty) obs.push(`Pertes de la semaine : ${num(lossQty)} bouteille(s), ${money(lossCost)} au prix d'achat.`);
  if (cash.variance_total) obs.push(`Écarts de caisse cumulés : ${money(cash.variance_total)}.`);
  if (sales.credit_given) obs.push(`Ventes à crédit accordées pendant la semaine : ${money(sales.credit_given)}.`);
  const low = stock.filter((s) => s.low && s.min_stock > 0);
  if (low.length) obs.push(`Stock faible à la clôture : ${low.map((s) => `${pname(s)}`).join(", ")}.`);
  const { week } = isoWeekNumber(monday);

  return {
    kind: "weekly",
    period: { key: monday, week, label: `Semaine ${week} — du lundi ${fmtDayShort(monday)} au lundi ${fmtDayShort(addDays(monday, 7))}`, short: `S${week} (${fmtDayShort(monday)})`, start, end, start_label: fmtDateTime(start), end_label: fmtDateTime(end - 1000) },
    summary: {
      revenue: sales.amount,
      collected: sales.collected,
      net_collected: sales.net_collected,
      expenses: cash.expenses_total,
      bottles_sold: sales.bottles,
      crates_sold: soldCrates,
      sales_count: sales.count,
      total_exits: agg.total,
      losses_qty: lossQty,
      losses_cost: lossCost,
      broken: agg.byKind.broken,
      lost: agg.byKind.lost,
      expired: agg.byKind.expired,
      offered: agg.byKind.offered,
      staff: agg.byKind.staff,
      other: agg.byKind.other,
      cogs: sales.cogs,
      gross_profit: sales.gross_profit,
      margin_pct: pct(sales.gross_profit, sales.amount),
      estimated_result: result,
      cash_variance: cash.variance_total,
      credit_given: sales.credit_given,
      credit_settled: sales.credit_settled,
      purchases: purchases.v,
      purchases_count: purchases.n,
      stock_value: stock.reduce((s, x) => s + x.value, 0),
      stock_bottles: stock.reduce((s, x) => s + x.stock, 0),
    },
    comparison: {
      previous: { revenue: prev.amount, collected: prev.collected, bottles_sold: prev.bottles, gross_profit: prev.gross_profit, expenses: prevCash.expenses_total, total_exits: prevAgg.total },
      variation: {
        revenue: variation(sales.amount, prev.amount),
        collected: variation(sales.collected, prev.collected),
        bottles_sold: variation(sales.bottles, prev.bottles),
        gross_profit: variation(sales.gross_profit, prev.gross_profit),
        expenses: variation(cash.expenses_total, prevCash.expenses_total),
      },
    },
    daily,
    exits: { by_kind: agg.byKind, by_product: byProduct, by_brand: agg.byBrand, by_category: agg.byCategory },
    sales,
    cash,
    ranking: rank,
    losses: lossDetails(monday, sunday),
    stock_end: stock,
    observations: obs,
  };
}

// ---------- Génération, versions et notifications ----------
const reportDocNo = (kind, key, version) => `${kind === "daily" ? "BJ" : "BH"}-${key}${version > 1 ? `-R${version - 1}` : ""}`;

export function generateReport(kind, key, trigger) {
  return tx(() => {
    const last = get("SELECT * FROM reports WHERE kind = ? AND period_key = ? ORDER BY version DESC LIMIT 1", kind, key);
    if (trigger === "rectification") {
      // Une seule rectification par signalement, même si deux processus tournent en même temps.
      if (!run("DELETE FROM report_dirty WHERE kind = ? AND period_key = ?", kind, key).changes) return null;
      if (!last) return null;
    } else if (last) return null;
    const version = (last?.version || 0) + 1;
    const data = kind === "daily" ? computeDaily(key) : computeWeekly(key);
    const t = now();
    const docNo = reportDocNo(kind, key, version);
    data.version = version;
    data.rectifies = last?.doc_no || null;
    data.generated_at = t;
    data.generated_label = fmtDateTime(t);
    data.trigger = trigger;
    data.maquis = { name: allSettings().maquis_name };
    const id = Number(
      run(
        "INSERT INTO reports (kind, period_key, period_start, period_end, version, trigger, generated_at, doc_no, data) VALUES (?,?,?,?,?,?,?,?,?)",
        kind, key, data.period.start, data.period.end, version, trigger, t, docNo, JSON.stringify(data),
      ).lastInsertRowid,
    );
    const isDaily = kind === "daily";
    const revenue = isDaily ? data.sales.amount : data.summary.revenue;
    createDocument({
      type: isDaily ? "daily_report" : "weekly_report",
      docNo,
      refType: "report",
      refId: id,
      at: t,
      user: null,
      title: `${isDaily ? "Rapport quotidien" : "Rapport hebdomadaire"} — ${data.period.label}${version > 1 ? " (rectificatif)" : ""}`,
      amount: revenue,
      payload: {
        report_id: id,
        fields: isDaily
          ? [["Journée commerciale", `${data.period.start_label} → ${data.period.end_label}`], ["Bouteilles sorties", num(data.exits.total_bottles)], ["Ventes", money(data.sales.amount)], ["Encaissé", money(data.sales.collected)]]
          : [["Période", `${data.period.start_label} → ${data.period.end_label}`], ["Chiffre d'affaires", money(data.summary.revenue)], ["Bouteilles vendues", num(data.summary.bottles_sold)], ["Bénéfice brut estimé", money(data.summary.gross_profit)]],
      },
      search: [isDaily ? "bilan quotidien" : "bilan hebdomadaire", key],
      rectifies: last?.doc_no || null,
    });
    audit(null, isDaily ? "bilan_quotidien" : "bilan_hebdomadaire", "report", id, `${docNo} généré (${trigger})`);
    const title = isDaily
      ? `Bilan du ${data.period.short}${version > 1 ? " (rectifié)" : ""} disponible`
      : `Bilan de la semaine ${data.period.week}${version > 1 ? " (rectifié)" : ""} disponible`;
    const body = isDaily
      ? `${num(data.exits.total_bottles)} bouteilles sorties, ${money(data.sales.amount)} de ventes, ${money(data.sales.collected)} encaissés.${data.analysis.loss_qty ? ` Pertes : ${data.analysis.loss_qty} bouteille(s).` : ""}`
      : `Chiffre d'affaires ${money(data.summary.revenue)}, ${num(data.summary.bottles_sold)} bouteilles vendues, bénéfice brut estimé ${money(data.summary.gross_profit)}.`;
    notify({ roles: ["owner", "manager"], type: isDaily ? "daily_report" : "weekly_report", title, body, link: `#/rapports/${id}` });
    return { id, kind, key, version, doc_no: docNo };
  });
}

// Produit tous les bilans dus (et les rectificatifs). Appelé chaque minute, au démarrage,
// et par la tâche planifiée du serveur (cron) : rien n'est produit deux fois.
export function runDueReports() {
  const t = now();
  const today = businessDay(t);
  let installed = getSetting("installed_day");
  if (!isDay(installed)) {
    installed = today;
    setSetting("installed_day", installed);
  }
  const out = [];
  const yesterday = addDays(today, -1);
  const from = installed > addDays(today, -92) ? installed : addDays(today, -92);
  for (const day of daysBetween(from, yesterday)) {
    if (get("SELECT 1 FROM reports WHERE kind = 'daily' AND period_key = ?", day)) continue;
    const late = t - dayBounds(day).end > 15 * 60000;
    const r = generateReport("daily", day, late ? "reprise" : "automatique");
    if (r) out.push(r);
  }
  const lastMonday = addDays(weekStart(today), -7);
  for (let monday = weekStart(from); monday <= lastMonday; monday = addDays(monday, 7)) {
    if (get("SELECT 1 FROM reports WHERE kind = 'weekly' AND period_key = ?", monday)) continue;
    const late = t - weekBounds(monday).end > 15 * 60000;
    const r = generateReport("weekly", monday, late ? "reprise" : "automatique");
    if (r) out.push(r);
  }
  for (const d of all("SELECT * FROM report_dirty ORDER BY kind, period_key")) {
    const r = generateReport(d.kind, d.period_key, "rectification");
    if (r) out.push(r);
  }
  setSetting("last_report_check", t);
  return out;
}

let timer = null;
let interval = null;
export function startScheduler({ log = console.log } = {}) {
  const tick = () => {
    try {
      const done = runDueReports();
      for (const r of done) log(`📊 ${r.doc_no} généré.`);
      backupIfDue();
    } catch (e) {
      console.error("Erreur pendant la production des bilans :", e);
    }
  };
  // Déclenchement précis à 03 h 00 (+5 s), plus une vérification chaque minute en filet de sécurité.
  const planNext = () => {
    const t = now();
    const next = dayBounds(businessDay(t)).end + 5000;
    timer = setTimeout(() => {
      tick();
      planNext();
    }, Math.max(1000, Math.min(next - t, 2 ** 31 - 1)));
    timer.unref?.();
  };
  tick();
  planNext();
  interval = setInterval(tick, 60000);
  interval.unref?.();
}
export function stopScheduler() {
  clearTimeout(timer);
  clearInterval(interval);
}

// ---------- Consultation ----------
export function listReports({ kind, limit = 120 } = {}) {
  const rows = all(
    `SELECT id, kind, period_key, period_start, period_end, version, trigger, generated_at, doc_no FROM reports ${kind === "daily" || kind === "weekly" ? "WHERE kind = ?" : ""} ORDER BY period_key DESC, version DESC LIMIT ?`,
    ...(kind === "daily" || kind === "weekly" ? [kind] : []), Math.min(Number(limit) || 120, 1000),
  );
  const latest = new Map();
  for (const r of rows) if (!latest.has(`${r.kind}|${r.period_key}`)) latest.set(`${r.kind}|${r.period_key}`, r.id);
  return rows.map((r) => {
    const d = JSON.parse(get("SELECT data FROM reports WHERE id = ?", r.id).data);
    return {
      ...r,
      current: latest.get(`${r.kind}|${r.period_key}`) === r.id,
      label: d.period.label,
      revenue: r.kind === "daily" ? d.sales.amount : d.summary.revenue,
      bottles: r.kind === "daily" ? d.exits.total_bottles : d.summary.bottles_sold,
    };
  });
}

export function getReport(id) {
  const r = get("SELECT * FROM reports WHERE id = ?", id);
  if (!r) throw notFound("Rapport introuvable.");
  const versions = all("SELECT id, version, generated_at, trigger, doc_no FROM reports WHERE kind = ? AND period_key = ? ORDER BY version", r.kind, r.period_key);
  return { ...r, data: JSON.parse(r.data), versions };
}

export function reportStatus() {
  const t = now();
  const today = businessDay(t);
  return {
    business_day: today,
    current_week: weekStart(today),
    next_daily: dayBounds(today).end,
    next_weekly: weekBounds(weekStart(today)).end,
    last_check: getSetting("last_report_check") || null,
    last_daily: get("SELECT id, period_key, generated_at, doc_no FROM reports WHERE kind = 'daily' ORDER BY period_key DESC, version DESC LIMIT 1") || null,
    last_weekly: get("SELECT id, period_key, generated_at, doc_no FROM reports WHERE kind = 'weekly' ORDER BY period_key DESC, version DESC LIMIT 1") || null,
    pending_rectifications: get("SELECT COUNT(*) AS n FROM report_dirty").n,
  };
}

// ---------- Tableau de bord (données en direct pour une date ou une période) ----------
export function periodOverview(fromDay, toDay) {
  const products = productInfo();
  const byProduct = exitsByProduct(fromDay, toDay, products);
  const agg = aggregates(byProduct);
  const sales = salesStats(fromDay, toDay);
  const cash = cashStats(fromDay, toDay);
  const lossCost = byProduct.reduce((s, x) => s + x.loss_cost, 0);
  const rank = ranking(byProduct);
  return {
    from: fromDay,
    to: toDay,
    label: fromDay === toDay ? fmtDay(fromDay) : `du ${fmtDayShort(fromDay)} au ${fmtDayShort(toDay)}`,
    sales,
    exits: { total: agg.total, by_kind: agg.byKind, by_category: agg.byCategory, by_brand: agg.byBrand },
    losses: { qty: LOSS_KINDS.reduce((s, k) => s + agg.byKind[k], 0), cost: lossCost },
    expenses: cash.expenses_total,
    cash_variance: cash.variance_total,
    estimated_profit: sales.gross_profit - cash.expenses_total - lossCost,
    top: rank.top,
    by_waiter: sales.by_waiter,
  };
}

export function dailySeries(lastDay, days = 14) {
  return daysBetween(addDays(lastDay, -(days - 1)), lastDay).map((d) => {
    const s = salesStats(d, d);
    return { day: d, label: fmtDayShort(d).slice(0, 5), amount: s.amount, bottles: s.bottles, collected: s.collected };
  });
}
