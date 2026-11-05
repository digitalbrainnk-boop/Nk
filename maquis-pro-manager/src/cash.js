// Caisse : ouverture, ajouts, retraits, remboursements, dépenses, clôture avec comptage.
// SOLDE THÉORIQUE = FONDS INITIAL + ENCAISSEMENTS + AJOUTS - DÉPENSES - RETRAITS - REMBOURSEMENTS
// (calculé pour chaque mode de paiement : espèces dans le tiroir, Orange Money, Moov Money…).
import { all, get, run, tx, getSetting } from "./db.js";
import { now, businessDay, fmtDateTime } from "./time.js";
import { audit } from "./audit.js";
import { notify, signal } from "./notify.js";
import { createDocument, newDocNumber, documentsFor } from "./documents.js";
import { periodWhere, touchDay } from "./stock.js";
import { bad, forbidden, notFound, conflict, str, int, oneOf, money, num } from "./util.js";

export const CASH = "Espèces";
export const MOVEMENT_LABELS = { deposit: "Ajout d'argent", withdrawal: "Retrait", refund: "Remboursement" };
const MOVEMENT_DOC = { deposit: "deposit", withdrawal: "withdrawal", refund: "refund" };

export function paymentMethods() {
  const m = getSetting("payment_methods") || [];
  return m.includes(CASH) ? m : [CASH, ...m];
}
export function checkMethod(method) {
  const m = str(method, "Mode de paiement", { required: true, max: 40 });
  if (!paymentMethods().includes(m)) throw bad(`Mode de paiement non configuré : ${m}.`);
  return m;
}

export const openSessionOf = (userId) => get("SELECT * FROM cash_sessions WHERE cashier_id = ? AND status = 'open'", userId);

export function requireOpenSession(ctx) {
  const s = openSessionOf(ctx.user.id);
  if (!s) throw bad("Votre caisse est fermée : ouvrez d'abord votre caisse.");
  return s;
}

export function openSession(ctx, body) {
  if (openSessionOf(ctx.user.id)) throw conflict("Votre caisse est déjà ouverte.");
  const opening = int(body.opening_float, "Fonds de caisse initial", { required: false, def: 0, min: 0, max: 100_000_000 });
  return tx(() => {
    const t = ctx.at || now();
    const id = Number(run("INSERT INTO cash_sessions (cashier_id, opened_at, business_day, opening_float) VALUES (?,?,?,?)", ctx.user.id, t, businessDay(t), opening).lastInsertRowid);
    audit(ctx, "caisse_ouverte", "cash_session", id, `Caisse ouverte avec un fonds de ${money(opening)}`);
    signal(["owner", "manager"], "cash");
    return sessionSummary(id);
  });
}

export function sessionSummary(id) {
  const s = get("SELECT cs.*, u.full_name AS cashier_name FROM cash_sessions cs JOIN users u ON u.id = cs.cashier_id WHERE cs.id = ?", id);
  if (!s) throw notFound("Session de caisse introuvable.");
  const methods = new Set(paymentMethods());
  const sum = (sql, ...p) => {
    const out = {};
    for (const r of all(sql, ...p)) {
      out[r.method] = r.total;
      methods.add(r.method);
    }
    return out;
  };
  const sales = sum("SELECT method, SUM(amount) AS total FROM payments WHERE session_id = ? AND kind = 'sale' GROUP BY method", id);
  const credits = sum("SELECT method, SUM(amount) AS total FROM payments WHERE session_id = ? AND kind = 'credit' GROUP BY method", id);
  const deposits = sum("SELECT method, SUM(amount) AS total FROM cash_movements WHERE session_id = ? AND kind = 'deposit' GROUP BY method", id);
  const withdrawals = sum("SELECT method, SUM(amount) AS total FROM cash_movements WHERE session_id = ? AND kind = 'withdrawal' GROUP BY method", id);
  const refunds = sum("SELECT method, SUM(amount) AS total FROM cash_movements WHERE session_id = ? AND kind = 'refund' GROUP BY method", id);
  const expenses = sum("SELECT method, SUM(amount) AS total FROM expenses WHERE session_id = ? AND status = 'valid' GROUP BY method", id);
  const details = JSON.parse(s.details || "{}");
  const rows = [...methods].map((m) => {
    const r = {
      method: m,
      opening: m === CASH ? s.opening_float : 0,
      sales: sales[m] || 0,
      credits: credits[m] || 0,
      deposits: deposits[m] || 0,
      expenses: expenses[m] || 0,
      withdrawals: withdrawals[m] || 0,
      refunds: refunds[m] || 0,
    };
    r.collected = r.sales + r.credits;
    r.theoretical = r.opening + r.collected + r.deposits - r.expenses - r.withdrawals - r.refunds;
    if (details.counted && details.counted[m] !== undefined) {
      r.counted = details.counted[m];
      r.variance = r.counted - r.theoretical;
    }
    return r;
  });
  const total = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  const saleStats = get(
    `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS amount,
       COALESCE(SUM(total - COALESCE((SELECT SUM(amount) FROM payments p WHERE p.sale_id = s.id AND p.kind = 'sale'), 0)), 0) AS credit_given
     FROM sales s WHERE session_id = ? AND status != 'cancelled'`,
    id,
  );
  const cancelled = get("SELECT COUNT(*) AS n FROM sales WHERE session_id = ? AND status = 'cancelled'", id).n;
  return {
    ...s,
    details,
    methods: rows,
    totals: {
      opening: s.opening_float,
      collected: total("collected"),
      sales_collected: total("sales"),
      credit_collected: total("credits"),
      deposits: total("deposits"),
      expenses: total("expenses"),
      withdrawals: total("withdrawals"),
      refunds: total("refunds"),
      theoretical: total("theoretical"),
      counted: s.status === "closed" ? s.counted : null,
      variance: s.status === "closed" ? s.variance : null,
    },
    sales: { count: saleStats.count, amount: saleStats.amount, credit_given: saleStats.credit_given, cancelled },
  };
}

function sessionForWrite(ctx, sessionId) {
  if (ctx.user.role === "cashier") return requireOpenSession(ctx);
  // Le gérant peut enregistrer un ajout ou un retrait dans une caisse ouverte qu'il désigne.
  const s = get("SELECT * FROM cash_sessions WHERE id = ? AND status = 'open'", int(sessionId, "Caisse", { min: 1 }));
  if (!s) throw bad("Cette caisse n'est pas ouverte.");
  return s;
}

export function addCashMovement(ctx, body) {
  const kind = oneOf(body.kind, "Type d'opération", ["deposit", "withdrawal", "refund"]);
  const amount = int(body.amount, "Montant", { min: 1, max: 100_000_000 });
  const method = checkMethod(body.method || CASH);
  const reason = str(body.reason, "Motif", { required: true, min: 3, max: 300 });
  const session = sessionForWrite(ctx, body.session_id);
  return tx(() => {
    if (kind !== "deposit") {
      const avail = sessionSummary(session.id).methods.find((m) => m.method === method)?.theoretical || 0;
      if (amount > avail && !ctx.offline) throw bad(`Montant supérieur au solde théorique ${method} de la caisse (${money(avail)}).`);
    }
    const t = ctx.at || now();
    const type = MOVEMENT_DOC[kind];
    const doc_no = newDocNumber(type, t);
    const id = Number(
      run("INSERT INTO cash_movements (doc_no, at, business_day, session_id, kind, amount, method, reason, user_id) VALUES (?,?,?,?,?,?,?,?,?)", doc_no, t, businessDay(t), session.id, kind, amount, method, reason, ctx.user.id).lastInsertRowid,
    );
    const cashier = get("SELECT full_name FROM users WHERE id = ?", session.cashier_id).full_name;
    createDocument({
      type,
      docNo: doc_no,
      refType: "cash_movement",
      refId: id,
      at: t,
      user: ctx.user,
      amount,
      payload: {
        fields: [["Opération", MOVEMENT_LABELS[kind]], ["Caisse de", cashier], ["Mode", method], ["Motif", reason]],
        totals: [["Montant", money(amount), true]],
        status: { label: MOVEMENT_LABELS[kind].toUpperCase(), tone: kind === "deposit" ? "ok" : "warn" },
      },
      search: [MOVEMENT_LABELS[kind], reason, cashier, method],
    });
    audit(ctx, `caisse_${kind}`, "cash_movement", id, `${MOVEMENT_LABELS[kind]} ${doc_no} : ${money(amount)} (${method}) — ${reason}`);
    touchDay(businessDay(t), "mouvement de caisse tardif");
    if (kind !== "deposit")
      notify({ roles: ["owner", "manager"], exceptUserId: ctx.user.id, type: "exceptional", title: `${MOVEMENT_LABELS[kind]} de caisse`, body: `${ctx.user.full_name} : ${money(amount)} (${method}). Motif : ${reason}`, link: `#/recus/${doc_no}` });
    signal(["owner", "manager"], "cash");
    return { id, doc_no };
  });
}

// ---------- Dépenses ----------
export function createExpense(ctx, body) {
  const categories = getSetting("expense_categories") || [];
  const category = str(body.category, "Catégorie de dépense", { required: true, max: 60 });
  if (categories.length && !categories.includes(category)) throw bad("Catégorie de dépense non configurée.");
  const description = str(body.description, "Description", { required: true, min: 3, max: 300 });
  const amount = int(body.amount, "Montant", { min: 1, max: 100_000_000 });
  const method = checkMethod(body.method || CASH);
  let session = null;
  if (ctx.user.role === "cashier") session = requireOpenSession(ctx);
  else if (body.session_id) session = sessionForWrite(ctx, body.session_id);
  return tx(() => {
    if (session && !ctx.offline) {
      const avail = sessionSummary(session.id).methods.find((m) => m.method === method)?.theoretical || 0;
      if (amount > avail) throw bad(`Montant supérieur au solde ${method} de la caisse (${money(avail)}).`);
    }
    const t = ctx.at || now();
    const day = businessDay(t);
    const doc_no = newDocNumber("expense", t);
    const id = Number(
      run(
        "INSERT INTO expenses (doc_no, at, business_day, category, description, amount, method, session_id, user_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        doc_no, t, day, category, description, amount, method, session?.id ?? null, ctx.user.id, now(),
      ).lastInsertRowid,
    );
    createDocument({
      type: "expense",
      docNo: doc_no,
      refType: "expense",
      refId: id,
      at: t,
      user: ctx.user,
      amount,
      payload: {
        fields: [["Catégorie", category], ["Description", description], ["Mode de paiement", method], ["Payée depuis", session ? `Caisse de ${get("SELECT full_name FROM users WHERE id = ?", session.cashier_id).full_name}` : "Hors caisse"]],
        totals: [["Montant de la dépense", money(amount), true]],
        status: { label: "DÉPENSE PAYÉE", tone: "warn" },
      },
      search: [category, description, method],
    });
    audit(ctx, "depense", "expense", id, `Dépense ${doc_no} : ${money(amount)} — ${category} (${description})`);
    touchDay(day, "dépense tardive");
    notify({ roles: ["owner", "manager"], exceptUserId: ctx.user.id, type: "expense", title: "Nouvelle dépense", body: `${ctx.user.full_name} : ${money(amount)} — ${category} (${description}).`, link: `#/recus/${doc_no}` });
    signal(["owner", "manager"], "cash");
    return { id, doc_no };
  });
}

export function cancelExpense(ctx, id, body) {
  const reason = str(body.reason, "Motif de l'annulation", { required: true, min: 5, max: 300 });
  const e = get("SELECT * FROM expenses WHERE id = ?", id);
  if (!e) throw notFound("Dépense introuvable.");
  if (e.status !== "valid") throw bad("Cette dépense est déjà annulée.");
  if (e.session_id && get("SELECT status FROM cash_sessions WHERE id = ?", e.session_id).status !== "open")
    throw bad("La caisse de cette dépense est fermée : enregistrez plutôt un ajout d'argent dans une caisse ouverte, avec le motif.");
  return tx(() => {
    run("UPDATE expenses SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ?", now(), ctx.user.id, reason, id);
    const doc = createDocument({
      type: "cancellation",
      refType: "expense",
      refId: id,
      at: now(),
      user: ctx.user,
      title: "Annulation d'une dépense",
      amount: e.amount,
      payload: { fields: [["Document annulé", e.doc_no], ["Dépense", `${e.category} — ${e.description}`], ["Motif de l'annulation", reason]], totals: [["Montant annulé", money(e.amount), true]], status: { label: "ANNULÉ", tone: "bad" } },
      search: [e.doc_no, reason],
      rectifies: e.doc_no,
    });
    audit(ctx, "depense_annulee", "expense", id, `Dépense ${e.doc_no} annulée : ${reason}`);
    touchDay(e.business_day, "annulation de dépense");
    notify({ roles: ["owner"], type: "exceptional", severity: "warn", title: "Dépense annulée", body: `${ctx.user.full_name} a annulé la dépense ${e.doc_no} (${money(e.amount)}). Motif : ${reason}`, link: `#/recus/${doc}` });
    return { doc_no: doc };
  });
}

export function listExpenses(ctx, { from, to } = {}) {
  const extra = ctx.user.role === "cashier" ? [`x.user_id = ${Number(ctx.user.id)}`] : [];
  const { where, p } = periodWhere("x.at", from, to, extra);
  return all(`SELECT x.*, u.full_name AS user_name FROM expenses x JOIN users u ON u.id = x.user_id ${where} ORDER BY x.at DESC LIMIT 300`, ...p);
}

// ---------- Clôture ----------
export function closeSession(ctx, body) {
  let session;
  if (ctx.user.role === "cashier") session = requireOpenSession(ctx);
  else {
    session = get("SELECT * FROM cash_sessions WHERE id = ? AND status = 'open'", int(body.session_id, "Caisse", { min: 1 }));
    if (!session) throw bad("Cette caisse n'est pas ouverte.");
  }
  const summary = sessionSummary(session.id);
  const counted = {};
  for (const m of summary.methods) {
    const v = body.counted?.[m.method];
    if (v === undefined || v === null || v === "") {
      if (m.theoretical !== 0) throw bad(`Indiquez le montant compté pour ${m.method} (théorique : ${money(m.theoretical)}).`);
      counted[m.method] = 0;
    } else counted[m.method] = int(v, `Montant compté (${m.method})`, { min: 0, max: 1_000_000_000 });
  }
  const note = str(body.note, "Observation", { max: 500 });
  const pending = get("SELECT COUNT(*) AS n FROM orders WHERE status = 'pending'").n;
  return tx(() => {
    const t = now();
    const totalCounted = Object.values(counted).reduce((a, b) => a + b, 0);
    const variance = totalCounted - summary.totals.theoretical;
    const doc_no = newDocNumber("cash_close", t);
    run(
      "UPDATE cash_sessions SET status = 'closed', closed_at = ?, closed_by = ?, theoretical = ?, counted = ?, variance = ?, details = ?, closing_note = ?, doc_no = ? WHERE id = ?",
      t, ctx.user.id, summary.totals.theoretical, totalCounted, variance, JSON.stringify({ counted }), note, doc_no, session.id,
    );
    const rows = summary.methods.filter((m) => m.theoretical || counted[m.method] || m.collected || m.expenses || m.withdrawals || m.deposits || m.refunds);
    createDocument({
      type: "cash_close",
      docNo: doc_no,
      refType: "cash_session",
      refId: session.id,
      at: t,
      user: ctx.user,
      amount: totalCounted,
      payload: {
        fields: [
          ["Caissier", summary.cashier_name],
          ["Ouverture", fmtDateTime(summary.opened_at)],
          ["Fermeture", fmtDateTime(t)],
          ["Fonds initial", money(summary.opening_float)],
          ["Ventes de la session", `${num(summary.sales.count)} vente(s) — ${money(summary.sales.amount)}`],
          ["Ventes à crédit (non encaissées)", money(summary.sales.credit_given)],
          ["Commandes encore en attente", String(pending)],
          ["Observation", note || "—"],
        ],
        columns: [
          { label: "Mode", w: 1.8 },
          { label: "Encaissé", align: "right", w: 1.5 },
          { label: "Ajouts", align: "right", w: 1.2 },
          { label: "Dépenses", align: "right", w: 1.3 },
          { label: "Retraits", align: "right", w: 1.2 },
          { label: "Rembours.", align: "right", w: 1.2 },
          { label: "Théorique", align: "right", w: 1.5 },
          { label: "Compté", align: "right", w: 1.5 },
          { label: "Écart", align: "right", w: 1.3 },
        ],
        rows: rows.map((m) => [m.method, num(m.collected), num(m.deposits), num(m.expenses), num(m.withdrawals), num(m.refunds), num(m.theoretical), num(counted[m.method]), num(counted[m.method] - m.theoretical)]),
        totals: [
          ["Solde théorique", money(summary.totals.theoretical)],
          ["Solde physique (compté)", money(totalCounted), true],
          ["Écart de caisse", (variance > 0 ? "+" : "") + money(variance), true],
        ],
        status: variance === 0 ? { label: "CAISSE JUSTE", tone: "ok" } : variance < 0 ? { label: "MANQUANT EN CAISSE", tone: "bad" } : { label: "EXCÉDENT EN CAISSE", tone: "warn" },
        notes: ["Solde théorique = fonds initial + encaissements + ajouts - dépenses - retraits - remboursements."],
      },
      search: [summary.cashier_name, "clôture caisse"],
    });
    audit(ctx, "caisse_fermee", "cash_session", session.id, `Caisse de ${summary.cashier_name} fermée : théorique ${money(summary.totals.theoretical)}, compté ${money(totalCounted)}, écart ${money(variance)}`, { counted });
    notify({
      roles: ["owner", "manager"],
      exceptUserId: ctx.user.id,
      type: "cash_close",
      title: "Fermeture de caisse",
      body: `Caisse de ${summary.cashier_name} fermée : ${money(totalCounted)} compté pour ${money(summary.totals.theoretical)} attendu.`,
      link: `#/recus/${doc_no}`,
    });
    if (variance !== 0)
      notify({
        roles: ["owner", "manager"],
        type: "cash_variance",
        severity: variance < 0 ? "danger" : "warn",
        title: variance < 0 ? "Manquant en caisse" : "Excédent en caisse",
        body: `Caisse de ${summary.cashier_name} : écart de ${money(variance)} (théorique ${money(summary.totals.theoretical)}, compté ${money(totalCounted)}).`,
        link: `#/recus/${doc_no}`,
      });
    signal(["owner", "manager"], "cash");
    return { doc_no, theoretical: summary.totals.theoretical, counted: totalCounted, variance };
  });
}

export function listSessions(ctx, { from, to, status } = {}) {
  const extra = [];
  if (ctx.user.role === "cashier") extra.push(`cs.cashier_id = ${Number(ctx.user.id)}`);
  if (status === "open" || status === "closed") extra.push(`cs.status = '${status}'`);
  const { where, p } = periodWhere("cs.opened_at", from, to, extra);
  return all(`SELECT cs.id FROM cash_sessions cs ${where} ORDER BY cs.opened_at DESC LIMIT 200`, ...p).map((r) => {
    const s = sessionSummary(r.id);
    delete s.methods;
    return s;
  });
}

export function getSession(ctx, id) {
  const s = sessionSummary(id);
  if (ctx.user.role === "cashier" && s.cashier_id !== ctx.user.id) throw forbidden();
  s.payments = all(
    "SELECT p.*, s.doc_no AS sale_doc, s.customer_name FROM payments p JOIN sales s ON s.id = p.sale_id WHERE p.session_id = ? ORDER BY p.at DESC",
    id,
  );
  s.movements = all("SELECT m.*, u.full_name AS user_name FROM cash_movements m JOIN users u ON u.id = m.user_id WHERE session_id = ? ORDER BY at DESC", id).map((m) => ({ ...m, label: MOVEMENT_LABELS[m.kind] }));
  s.expenses = all("SELECT * FROM expenses WHERE session_id = ? ORDER BY at DESC", id);
  s.documents = documentsFor("cash_session", id);
  return s;
}
