// Tableau de bord du propriétaire et du gérant : chiffres en direct, uniquement issus des
// opérations enregistrées (aucune donnée inventée).
import { all, get } from "./db.js";
import { now, businessDay, weekStart, isDay, addDays } from "./time.js";
import { periodOverview, dailySeries, reportStatus } from "./reports.js";
import { stockList } from "./stock.js";
import { sessionSummary } from "./cash.js";
import { searchDocuments } from "./documents.js";
import { bad, pname } from "./util.js";

export function dashboard(ctx, { from, to } = {}) {
  const today = businessDay(now());
  from = isDay(from) ? from : today;
  to = isDay(to) ? to : from;
  if (to < from) [from, to] = [to, from];
  if (to > today) to = today;
  if (from > to) throw bad("Période invalide.");
  if (Math.abs(Date.parse(to) - Date.parse(from)) > 400 * 86400000) throw bad("Période trop longue (400 jours maximum).");

  const period = periodOverview(from, to);
  const monday = weekStart(today);
  const week = periodOverview(monday, today);
  const todayView = from === today && to === today ? period : periodOverview(today, today);
  const stock = stockList();
  const openSessions = all("SELECT id FROM cash_sessions WHERE status = 'open'").map((r) => {
    const s = sessionSummary(r.id);
    return { id: s.id, cashier: s.cashier_name, opened_at: s.opened_at, theoretical: s.totals.theoretical, collected: s.totals.collected, expenses: s.totals.expenses, methods: s.methods.filter((m) => m.theoretical) };
  });
  const staff = all(
    `SELECT u.id, u.full_name, u.role,
       (SELECT MAX(last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen,
       (SELECT COUNT(*) FROM audit_log a WHERE a.user_id = u.id AND a.at >= ? AND a.action != 'connexion') AS operations,
       (SELECT COUNT(*) FROM orders o WHERE o.waiter_id = u.id AND o.business_day BETWEEN ? AND ?) AS orders,
       CASE WHEN u.role = 'waiter' THEN
         (SELECT COUNT(DISTINCT m.ref_id) FROM stock_movements m JOIN sales s ON s.id = m.ref_id AND s.status != 'cancelled'
          WHERE m.kind = 'sale' AND m.ref_type = 'sale' AND m.reversal_of IS NULL AND m.waiter_id = u.id AND m.business_day BETWEEN ? AND ?)
       ELSE (SELECT COUNT(*) FROM sales s WHERE s.cashier_id = u.id AND s.status != 'cancelled' AND s.business_day BETWEEN ? AND ?) END AS sales,
       CASE WHEN u.role = 'waiter' THEN
         (SELECT COALESCE(-SUM(m.qty * m.unit_price), 0) FROM stock_movements m WHERE m.kind = 'sale' AND m.ref_type = 'sale' AND m.waiter_id = u.id AND m.business_day BETWEEN ? AND ?)
       ELSE (SELECT COALESCE(SUM(total), 0) FROM sales s WHERE s.cashier_id = u.id AND s.status != 'cancelled' AND s.business_day BETWEEN ? AND ?) END AS sales_amount
     FROM users u WHERE u.active = 1 AND u.role != 'owner' ORDER BY u.role, u.full_name`,
    now() - 86400000, from, to, from, to, from, to, from, to, from, to,
  );
  const pending = get("SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS v FROM orders WHERE status = 'pending'");
  const credits = get("SELECT COUNT(*) AS n, COALESCE(SUM(total - paid), 0) AS v FROM sales WHERE status IN ('partial','credit')");
  return {
    today,
    period,
    today_summary: { amount: todayView.sales.amount, bottles: todayView.sales.bottles, collected: todayView.sales.collected, exits: todayView.exits.total },
    week: { from: monday, amount: week.sales.amount, bottles: week.sales.bottles, collected: week.sales.collected, gross_profit: week.sales.gross_profit, expenses: week.expenses },
    stock: {
      bottles: stock.reduce((s, x) => s + x.stock, 0),
      value: stock.reduce((s, x) => s + x.value, 0),
      sale_value: stock.reduce((s, x) => s + x.sale_value, 0),
      low: stock.filter((x) => x.low && !x.out).map((x) => ({ id: x.id, name: `${pname(x)}`, stock: x.stock, label: x.label })),
      out: stock.filter((x) => x.out).map((x) => ({ id: x.id, name: `${pname(x)}` })),
    },
    cash: { open_sessions: openSessions, balance: openSessions.reduce((s, x) => s + x.theoretical, 0) },
    pending_orders: { count: pending.n, amount: pending.v },
    credits: { count: credits.n, amount: credits.v },
    series: dailySeries(to, 14),
    staff,
    latest_documents: searchDocuments(ctx.user, { limit: 8 }),
    reports: reportStatus(),
  };
}

// Accueil du gérant : ce qu'il a à faire et à surveiller aujourd'hui. Pas de bénéfice, de marge ni de
// rentabilité : ces chiffres restent sur le tableau de bord du propriétaire.
export function managerHome(ctx) {
  const today = businessDay(now());
  const sales = get("SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS amount FROM sales WHERE business_day = ? AND status != 'cancelled'", today);
  const bottles = get("SELECT COALESCE(-SUM(qty), 0) AS v FROM stock_movements WHERE kind = 'sale' AND business_day = ?", today).v;
  const collected = get("SELECT COALESCE(SUM(amount), 0) AS v FROM payments WHERE business_day = ?", today).v;
  const credit = get("SELECT COUNT(*) AS n, COALESCE(SUM(total - paid), 0) AS v FROM sales WHERE status IN ('partial','credit')");
  const pending = all(
    "SELECT o.id, o.order_no, o.table_label, o.total, o.at, u.full_name AS waiter FROM orders o JOIN users u ON u.id = o.waiter_id WHERE o.status = 'pending' ORDER BY o.at",
  );
  const exitsToday = all(
    "SELECT kind, -SUM(qty) AS qty FROM stock_movements WHERE business_day = ? AND kind IN ('offered','staff','broken','lost','expired','other') GROUP BY kind HAVING qty != 0",
    today,
  );
  const entriesToday = get("SELECT COUNT(*) AS n, COALESCE(SUM((SELECT SUM(qty) FROM entry_lines l WHERE l.entry_id = e.id)), 0) AS qty FROM entries e WHERE e.business_day = ? AND e.status = 'valid'", today);
  const expenses = get("SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS v FROM expenses WHERE business_day = ? AND status = 'valid'", today);
  const stock = stockList();
  const openSessions = all("SELECT id FROM cash_sessions WHERE status = 'open'").map((r) => {
    const s = sessionSummary(r.id);
    return { id: s.id, cashier: s.cashier_name, cashier_id: s.cashier_id, opened_at: s.opened_at, theoretical: s.totals.theoretical, collected: s.totals.collected, sales: s.sales.count };
  });
  return {
    today,
    me: ctx.user.id,
    sales: { count: sales.n, amount: sales.amount, bottles, collected },
    credits: { count: credit.n, amount: credit.v },
    pending_orders: { count: pending.length, amount: pending.reduce((a, o) => a + o.total, 0), items: pending.slice(0, 20) },
    cash: { open_sessions: openSessions, mine: openSessions.find((s) => s.cashier_id === ctx.user.id) || null },
    entries: { count: entriesToday.n, qty: entriesToday.qty },
    exits: exitsToday,
    expenses: { count: expenses.n, amount: expenses.v },
    stock: {
      low: stock.filter((x) => x.low && !x.out).map((x) => ({ id: x.id, name: `${x.brand} — ${x.name}`, label: x.label })),
      out: stock.filter((x) => x.out).map((x) => ({ id: x.id, name: `${x.brand} — ${x.name}` })),
    },
    approvals: all(
      `SELECT r.id, r.sale_id, r.reason, r.at, s.doc_no, s.total, s.paid, u.full_name AS requested_by_name FROM cancel_requests r
       JOIN sales s ON s.id = r.sale_id JOIN users u ON u.id = r.requested_by WHERE r.status = 'pending' ORDER BY r.at`,
    ),
    purchase_orders: get("SELECT COUNT(*) AS n FROM purchase_orders WHERE status IN ('open','partial')").n,
    inventory_draft: get("SELECT id FROM inventories WHERE status = 'draft'")?.id || null,
    latest_documents: searchDocuments(ctx.user, { limit: 10, from: today }),
  };
}
