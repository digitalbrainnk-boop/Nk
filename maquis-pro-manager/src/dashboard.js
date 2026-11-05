// Tableau de bord du propriétaire et du gérant : chiffres en direct, uniquement issus des
// opérations enregistrées (aucune donnée inventée).
import { all, get } from "./db.js";
import { now, businessDay, weekStart, isDay, addDays } from "./time.js";
import { periodOverview, dailySeries, reportStatus } from "./reports.js";
import { stockList } from "./stock.js";
import { sessionSummary } from "./cash.js";
import { searchDocuments } from "./documents.js";
import { bad } from "./util.js";

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
       (SELECT COUNT(*) FROM sales s WHERE (s.cashier_id = u.id OR s.waiter_id = u.id) AND s.status != 'cancelled' AND s.business_day BETWEEN ? AND ?) AS sales,
       (SELECT COALESCE(SUM(total), 0) FROM sales s WHERE (s.cashier_id = u.id OR s.waiter_id = u.id) AND s.status != 'cancelled' AND s.business_day BETWEEN ? AND ?) AS sales_amount
     FROM users u WHERE u.active = 1 AND u.role != 'owner' ORDER BY u.role, u.full_name`,
    now() - 86400000, from, to, from, to, from, to,
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
      low: stock.filter((x) => x.low && !x.out).map((x) => ({ id: x.id, name: `${x.brand} — ${x.name}`, stock: x.stock, label: x.label })),
      out: stock.filter((x) => x.out).map((x) => ({ id: x.id, name: `${x.brand} — ${x.name}` })),
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
