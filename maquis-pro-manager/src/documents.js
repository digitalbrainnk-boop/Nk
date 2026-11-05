// Reçus et documents justificatifs : numéro unique, contenu figé au moment de l'opération
// (nom du maquis, responsable, boissons, quantités, prix, montants, motif, statut de paiement).
// Une correction produit un nouveau document « rectificatif » ; l'original reste intact.
import crypto from "node:crypto";
import { all, get, run, nextNumber, allSettings } from "./db.js";
import { businessDay, localParts, isDay, dayBounds } from "./time.js";
import { notFound } from "./util.js";
import { ROLE_LABELS } from "./auth.js";

export const DOC_TYPES = {
  entry: { prefix: "ENT", label: "Reçu d'entrée de boissons" },
  exit: { prefix: "SOR", label: "Reçu de sortie de boissons" },
  sale: { prefix: "VTE", label: "Reçu de vente" },
  payment: { prefix: "PAI", label: "Reçu de paiement (crédit)" },
  expense: { prefix: "DEP", label: "Reçu de dépense" },
  refund: { prefix: "RMB", label: "Reçu de remboursement" },
  withdrawal: { prefix: "RET", label: "Reçu de retrait de caisse" },
  deposit: { prefix: "AJT", label: "Reçu d'ajout d'argent en caisse" },
  cash_close: { prefix: "CLO", label: "Reçu de fermeture de caisse" },
  inventory: { prefix: "INV", label: "Rapport d'inventaire" },
  supplier_payment: { prefix: "FRN", label: "Reçu de paiement fournisseur" },
  consignment: { prefix: "CSG", label: "Reçu de consigne" },
  cancellation: { prefix: "ANN", label: "Document rectificatif (annulation)" },
  daily_report: { prefix: "BJ", label: "Rapport quotidien" },
  weekly_report: { prefix: "BH", label: "Rapport hebdomadaire" },
};

export const responsibleLabel = (user) => (user ? `${user.full_name} (${ROLE_LABELS[user.role] || user.role})` : "Système automatique");

export function newDocNumber(type, at) {
  return nextNumber(DOC_TYPES[type].prefix, localParts(at).y);
}

// payload : { fields: [[libellé, valeur]], columns: [{label, align, w}], rows: [[...]], totals: [[libellé, valeur, gras]], status: {label, tone}, notes: [] }
export function createDocument({ type, docNo, refType = "", refId = null, at, user, title, amount = null, payload, search = [], rectifies = null }) {
  const s = allSettings();
  const doc_no = docNo || newDocNumber(type, at);
  const full = {
    ...payload,
    doc_type: type,
    title: title || DOC_TYPES[type].label,
    doc_no,
    at,
    business_day: businessDay(at),
    responsible: responsibleLabel(user),
    maquis: { name: s.maquis_name, address: s.address, phone: s.phone, footer: s.receipt_footer },
    rectifies,
  };
  const json = JSON.stringify(full);
  const hash = crypto.createHash("sha256").update(json).digest("hex");
  const searchText = [doc_no, full.title, user?.full_name || "", ...search].join(" ").toLowerCase();
  run(
    `INSERT INTO documents (doc_no, type, ref_type, ref_id, at, business_day, user_id, user_name, title, amount, payload, search_text, rectifies, hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    doc_no, type, refType, refId, at, full.business_day, user?.id ?? null, user?.full_name || "Système", full.title, amount, json, searchText, rectifies, hash,
  );
  return doc_no;
}

export function getDocument(docNo) {
  const d = get("SELECT * FROM documents WHERE doc_no = ?", String(docNo));
  if (!d) throw notFound("Reçu introuvable.");
  return { ...d, payload: JSON.parse(d.payload) };
}

// Qui voit quoi : propriétaire et gérant voient tout ; caissier ses documents de caisse ;
// serveur les reçus des ventes de ses commandes.
export function canSeeDocument(user, d) {
  if (user.role === "owner" || user.role === "manager") return true;
  if (user.role === "cashier") return d.user_id === user.id || ["sale", "payment", "refund", "withdrawal", "deposit", "expense", "cash_close"].includes(d.type);
  if (user.role === "waiter") {
    if (d.ref_type !== "sale") return false;
    return !!get("SELECT 1 FROM sales WHERE id = ? AND waiter_id = ?", d.ref_id, user.id);
  }
  return false;
}

export function searchDocuments(user, { q = "", type = "", from = "", to = "", user_id = "", limit = 100, offset = 0 } = {}) {
  const where = [];
  const p = [];
  if (q) {
    for (const word of String(q).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)) {
      where.push("search_text LIKE ? ESCAPE '\\'");
      p.push(`%${word.replace(/[\\%_]/g, (c) => "\\" + c)}%`);
    }
  }
  if (type && DOC_TYPES[type]) {
    where.push("type = ?");
    p.push(type);
  }
  if (isDay(from)) {
    where.push("at >= ?");
    p.push(dayBounds(from).start);
  }
  if (isDay(to)) {
    where.push("at < ?");
    p.push(dayBounds(to).end);
  }
  if (user_id) {
    where.push("user_id = ?");
    p.push(Number(user_id));
  }
  if (user.role === "cashier") {
    where.push(`(user_id = ? OR type IN ('sale','payment','refund','withdrawal','deposit','expense','cash_close'))`);
    p.push(user.id);
  } else if (user.role === "waiter") {
    where.push("ref_type = 'sale' AND ref_id IN (SELECT id FROM sales WHERE waiter_id = ?)");
    p.push(user.id);
  }
  const sql = `SELECT id, doc_no, type, ref_type, ref_id, at, business_day, user_id, user_name, title, amount, rectifies FROM documents
    ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`;
  return all(sql, ...p, Math.min(Number(limit) || 100, 500), Math.max(Number(offset) || 0, 0));
}

export function documentsFor(refType, refId) {
  return all("SELECT doc_no, type, title, at, amount FROM documents WHERE ref_type = ? AND ref_id = ? ORDER BY id", refType, refId);
}
