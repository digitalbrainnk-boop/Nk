// Documents PDF : reçus (format A5) et rapports quotidiens / hebdomadaires (A4, tableaux et graphiques).
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { getDataDir, allSettings } from "./db.js";
import { fmtDateTime } from "./time.js";
import { money, num, pct, pname } from "./util.js";
import { EXIT_LABELS } from "./stock.js";

const C = { series: "#2A78D6", primary: "#065F46", primarySoft: "#ECFDF5", accent: "#B45309", text: "#111827", muted: "#6B7280", line: "#D1D5DB", zebra: "#F3F4F6", ok: "#047857", warn: "#B45309", bad: "#B91C1C" };

// Les polices PDF standard utilisent l'encodage WinAnsi : on remplace ce qu'il ne sait pas afficher.
const WINANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
function clean(v) {
  return String(v ?? "")
    .replace(/[   ]/g, " ")
    .replace(/→/g, "->")
    .replace(/≈/g, "~")
    .replace(/[^\x20-\x7e\xa0-\xff\n]/g, (c) => (WINANSI_EXTRA.includes(c) ? c : ""));
}

function toBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

function logoPath() {
  const logo = allSettings().logo;
  if (!logo) return null;
  const p = path.join(getDataDir(), "uploads", path.basename(logo));
  return fs.existsSync(p) && /\.(png|jpe?g)$/i.test(p) ? p : null;
}

const W = (doc) => doc.page.width - doc.page.margins.left - doc.page.margins.right;
const X = (doc) => doc.page.margins.left;
const bottom = (doc) => doc.page.height - doc.page.margins.bottom - 18;
function ensure(doc, h) {
  if (doc.y + h > bottom(doc)) doc.addPage();
}

function header(doc, { maquis, title, docNo, at, subtitle }) {
  const x = X(doc);
  const top = doc.page.margins.top;
  const logo = logoPath();
  let tx = x;
  if (logo) {
    try {
      doc.image(logo, x, top, { fit: [46, 46] });
      tx = x + 54;
    } catch {}
  }
  doc.fillColor(C.primary).font("Helvetica-Bold").fontSize(15).text(clean(maquis?.name || "Maquis"), tx, top, { width: W(doc) * 0.55 - (tx - x) });
  doc.font("Helvetica").fontSize(8).fillColor(C.muted);
  const info = [maquis?.address, maquis?.phone ? `Tél. ${maquis.phone}` : ""].filter(Boolean).join("  ·  ");
  if (info) doc.text(clean(info), tx, doc.y + 1, { width: W(doc) * 0.55 - (tx - x) });
  const rx = x + W(doc) * 0.55;
  const rw = W(doc) * 0.45;
  doc.fillColor(C.text).font("Helvetica-Bold").fontSize(11).text(clean(title), rx, top, { width: rw, align: "right" });
  doc.font("Helvetica").fontSize(8.5).fillColor(C.muted);
  if (docNo) doc.text(clean(`N° ${docNo}`), rx, doc.y + 2, { width: rw, align: "right" });
  if (at) doc.text(clean(fmtDateTime(at)), rx, doc.y + 1, { width: rw, align: "right" });
  if (subtitle) doc.text(clean(subtitle), rx, doc.y + 1, { width: rw, align: "right" });
  const y = Math.max(doc.y, top + (logo ? 50 : 30)) + 8;
  doc.moveTo(x, y).lineTo(x + W(doc), y).lineWidth(1.5).strokeColor(C.primary).stroke();
  doc.x = x;
  doc.y = y + 10;
}

function section(doc, title) {
  ensure(doc, 40);
  doc.moveDown(0.4);
  const y = doc.y;
  doc.rect(X(doc), y, 3, 13).fill(C.accent);
  doc.fillColor(C.text).font("Helvetica-Bold").fontSize(11).text(clean(title), X(doc) + 8, y + 1, { width: W(doc) - 8 });
  doc.x = X(doc);
  doc.y = y + 19;
}

function fields(doc, list, cols = 2) {
  const x = X(doc);
  const colW = W(doc) / cols;
  for (let i = 0; i < list.length; i += cols) {
    const row = list.slice(i, i + cols);
    const heights = row.map(([k, v]) => doc.font("Helvetica").fontSize(8.5).heightOfString(clean(v), { width: colW - 10 }) + 11);
    const h = Math.max(...heights);
    ensure(doc, h);
    const y = doc.y;
    row.forEach(([k, v], j) => {
      doc.font("Helvetica").fontSize(7).fillColor(C.muted).text(clean(k).toUpperCase(), x + j * colW, y, { width: colW - 10 });
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C.text).text(clean(v), x + j * colW, y + 9, { width: colW - 10 });
    });
    doc.x = x;
    doc.y = y + h + 2;
  }
}

function table(doc, columns, rows, { fontSize = 8, headFill = C.primary, boldLast = false } = {}) {
  if (!rows.length) {
    doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(C.muted).text("Aucune donnée pour cette période.", X(doc));
    doc.moveDown(0.5);
    return;
  }
  const x0 = X(doc);
  const total = columns.reduce((s, c) => s + (c.w || 1), 0);
  const widths = columns.map((c) => ((c.w || 1) / total) * W(doc));
  const pad = 4;
  const drawHead = () => {
    const h = Math.max(...columns.map((c, i) => doc.font("Helvetica-Bold").fontSize(fontSize - 0.5).heightOfString(clean(c.label), { width: widths[i] - pad * 2 }))) + pad * 2;
    ensure(doc, h + 16);
    const y = doc.y;
    doc.rect(x0, y, W(doc), h).fill(headFill);
    let x = x0;
    columns.forEach((c, i) => {
      doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(fontSize - 0.5).text(clean(c.label), x + pad, y + pad, { width: widths[i] - pad * 2, align: c.align || "left" });
      x += widths[i];
    });
    doc.y = y + h;
  };
  drawHead();
  rows.forEach((row, r) => {
    const bold = boldLast && r === rows.length - 1;
    const font = bold ? "Helvetica-Bold" : "Helvetica";
    const h = Math.max(...row.map((cell, i) => doc.font(font).fontSize(fontSize).heightOfString(clean(cell), { width: widths[i] - pad * 2 }))) + pad * 2;
    if (doc.y + h > bottom(doc)) {
      doc.addPage();
      drawHead();
    }
    const y = doc.y;
    if (r % 2 === 1 || bold) doc.rect(x0, y, W(doc), h).fill(bold ? C.primarySoft : C.zebra);
    let x = x0;
    row.forEach((cell, i) => {
      doc.fillColor(C.text).font(font).fontSize(fontSize).text(clean(cell), x + pad, y + pad, { width: widths[i] - pad * 2, align: columns[i].align || "left" });
      x += widths[i];
    });
    doc.y = y + h;
  });
  doc.moveTo(x0, doc.y).lineTo(x0 + W(doc), doc.y).lineWidth(0.5).strokeColor(C.line).stroke();
  doc.x = x0;
  doc.moveDown(0.6);
}

function totalsBlock(doc, totals) {
  const w = Math.min(260, W(doc));
  const x = X(doc) + W(doc) - w;
  for (const [k, v, strong] of totals) {
    ensure(doc, 16);
    const y = doc.y;
    doc.font(strong ? "Helvetica-Bold" : "Helvetica").fontSize(strong ? 10 : 8.5).fillColor(strong ? C.text : C.muted).text(clean(k), x, y, { width: w * 0.55 });
    doc.fillColor(C.text).text(clean(v), x + w * 0.55, y, { width: w * 0.45, align: "right" });
    doc.y = Math.max(doc.y, y + (strong ? 15 : 13));
  }
  doc.x = X(doc);
  doc.moveDown(0.4);
}

function badge(doc, status) {
  if (!status) return;
  const color = C[status.tone] || C.primary;
  doc.font("Helvetica-Bold").fontSize(10);
  const w = doc.widthOfString(clean(status.label)) + 20;
  ensure(doc, 26);
  const y = doc.y;
  doc.roundedRect(X(doc), y, w, 20, 4).lineWidth(1.5).strokeColor(color).stroke();
  doc.fillColor(color).text(clean(status.label), X(doc) + 10, y + 5.5);
  doc.x = X(doc);
  doc.y = y + 28;
}

function bullets(doc, items) {
  for (const it of items) {
    ensure(doc, 14);
    const y = doc.y;
    doc.circle(X(doc) + 3, y + 4.5, 1.6).fill(C.accent);
    doc.fillColor(C.text).font("Helvetica").fontSize(8.8).text(clean(it), X(doc) + 10, y, { width: W(doc) - 10 });
    doc.moveDown(0.25);
  }
  doc.x = X(doc);
}

function kpis(doc, items) {
  const gap = 6;
  const w = (W(doc) - gap * (items.length - 1)) / items.length;
  ensure(doc, 52);
  const y = doc.y;
  items.forEach(([label, value, sub], i) => {
    const x = X(doc) + i * (w + gap);
    doc.roundedRect(x, y, w, 46, 5).fill(C.primarySoft);
    doc.fillColor(C.muted).font("Helvetica").fontSize(7).text(clean(label).toUpperCase(), x + 7, y + 6, { width: w - 14 });
    doc.fillColor(C.primary).font("Helvetica-Bold").fontSize(12).text(clean(value), x + 7, y + 17, { width: w - 14 });
    if (sub) doc.fillColor(C.muted).font("Helvetica").fontSize(6.8).text(clean(sub), x + 7, y + 33, { width: w - 14 });
  });
  doc.x = X(doc);
  doc.y = y + 54;
}

// Barres horizontales (classements).
function hbars(doc, items, { valueLabel = (v) => num(v), color = C.series } = {}) {
  if (!items.length) return;
  const max = Math.max(...items.map((i) => i.value), 1);
  const labelW = W(doc) * 0.34;
  const barW = W(doc) * 0.5;
  for (const it of items) {
    ensure(doc, 15);
    const y = doc.y;
    doc.fillColor(C.text).font("Helvetica").fontSize(8).text(clean(it.label), X(doc), y + 1, { width: labelW - 6, lineBreak: false, ellipsis: true });
    const w = Math.max(2, (it.value / max) * barW);
    doc.roundedRect(X(doc) + labelW, y + 1, w, 9, 2).fill(color);
    doc.fillColor(C.muted).fontSize(7.5).text(clean(valueLabel(it.value)), X(doc) + labelW + w + 5, y + 2, { width: W(doc) - labelW - w - 5, lineBreak: false });
    doc.y = y + 14;
  }
  doc.x = X(doc);
  doc.moveDown(0.5);
}

// Colonnes verticales (évolution jour par jour).
function vbars(doc, items, { height = 110, valueLabel = (v) => num(v) } = {}) {
  ensure(doc, height + 34);
  const y0 = doc.y;
  const max = Math.max(...items.map((i) => i.value), 1);
  const slot = W(doc) / items.length;
  const bw = Math.min(42, slot * 0.6);
  doc.moveTo(X(doc), y0 + height).lineTo(X(doc) + W(doc), y0 + height).lineWidth(0.5).strokeColor(C.line).stroke();
  items.forEach((it, i) => {
    const h = (it.value / max) * (height - 14);
    const x = X(doc) + i * slot + (slot - bw) / 2;
    if (h > 0) doc.roundedRect(x, y0 + height - h, bw, h, 2).fill(C.series);
    doc.fillColor(C.muted).font("Helvetica").fontSize(6.5).text(clean(valueLabel(it.value)), X(doc) + i * slot, y0 + height - h - 9, { width: slot, align: "center", lineBreak: false });
    doc.fillColor(C.text).fontSize(7).text(clean(it.label), X(doc) + i * slot, y0 + height + 4, { width: slot, align: "center", lineBreak: false });
  });
  doc.x = X(doc);
  doc.y = y0 + height + 20;
}

function footer(doc, text) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const mb = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - mb + 6;
    doc.font("Helvetica").fontSize(6.8).fillColor(C.muted);
    doc.text(clean(text), X(doc), y, { width: W(doc) * 0.8, lineBreak: false });
    doc.text(`Page ${i + 1}/${range.count}`, X(doc) + W(doc) * 0.8, y, { width: W(doc) * 0.2, align: "right", lineBreak: false });
    doc.page.margins.bottom = mb;
  }
}

// ---------- Reçus ----------
export function renderDocumentPdf(d) {
  const p = d.payload;
  const doc = new PDFDocument({ size: "A5", margins: { top: 28, bottom: 30, left: 28, right: 28 }, bufferPages: true, info: { Title: clean(`${p.title} ${p.doc_no}`), Author: "MAQUIS PRO MANAGER" } });
  header(doc, { maquis: p.maquis, title: p.title, docNo: p.doc_no, at: p.at });
  if (p.rectifies) {
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C.bad).text(clean(`Document rectificatif du ${p.rectifies}`));
    doc.moveDown(0.4);
  }
  fields(doc, [["Responsable", p.responsible], ...(p.fields || [])]);
  doc.moveDown(0.3);
  if (p.columns && p.rows) table(doc, p.columns, p.rows, { fontSize: 7.8 });
  if (p.totals?.length) totalsBlock(doc, p.totals);
  badge(doc, p.status);
  if (p.notes?.length) {
    doc.font("Helvetica-Oblique").fontSize(7.5).fillColor(C.muted);
    for (const n of p.notes) doc.text(clean(n), { width: W(doc) });
    doc.moveDown(0.4);
  }
  if (p.maquis?.footer) {
    ensure(doc, 20);
    doc.font("Helvetica").fontSize(8.5).fillColor(C.primary).text(clean(p.maquis.footer), { width: W(doc), align: "center" });
  }
  footer(doc, `${p.doc_no} · empreinte ${String(d.hash || "").slice(0, 16)} · MAQUIS PRO MANAGER`);
  return toBuffer(doc);
}

// ---------- Rapports ----------
const KIND_COLS = ["sale", "offered", "staff", "broken", "lost", "expired", "other"];
const KIND_SHORT = { sale: "Vendues", offered: "Offertes", staff: "Personnel", broken: "Cassées", lost: "Perdues", expired: "Périmées", other: "Autres" };
const v = (x) => (x === null || x === undefined ? "—" : `${x >= 0 ? "+" : ""}${x} %`);

function reportHeader(doc, r, title) {
  const d = r.data;
  header(doc, { maquis: { ...(d.maquis || {}), ...pickMaquis() }, title, docNo: r.doc_no, at: r.generated_at, subtitle: d.trigger === "reprise" ? "Produit à la reprise du serveur" : d.trigger === "rectification" ? "Bilan rectificatif" : "Généré automatiquement" });
  doc.font("Helvetica-Bold").fontSize(13).fillColor(C.text).text(clean(d.period.label));
  doc.font("Helvetica").fontSize(8.5).fillColor(C.muted).text(clean(`Période : du ${d.period.start_label} au ${d.period.end_label} (heure du Burkina Faso)`));
  if (d.version > 1) doc.font("Helvetica-Bold").fillColor(C.bad).text(clean(`Version ${d.version} — rectifie le ${d.rectifies} (des opérations ont été enregistrées ou annulées après la clôture). L'original reste consultable.`));
  doc.moveDown(0.6);
}
function pickMaquis() {
  const s = allSettings();
  return { name: s.maquis_name, address: s.address, phone: s.phone };
}

function exitsTable(doc, byProduct) {
  const rows = byProduct.map((x) => [`${pname(x)}`, ...KIND_COLS.map((k) => (x[k] ? num(x[k]) : "")), num(x.total), x.label]);
  if (rows.length) {
    const t = Object.fromEntries(KIND_COLS.map((k) => [k, byProduct.reduce((s, x) => s + x[k], 0)]));
    rows.push(["TOTAL", ...KIND_COLS.map((k) => num(t[k])), num(byProduct.reduce((s, x) => s + x.total, 0)), ""]);
  }
  table(
    doc,
    [{ label: "Boisson", w: 3 }, ...KIND_COLS.map((k) => ({ label: KIND_SHORT[k], align: "right", w: 1 })), { label: "Total", align: "right", w: 1 }, { label: "En casiers", w: 2 }],
    rows,
    { fontSize: 7.2, boldLast: true },
  );
}

function brandBlocks(doc, byCategory) {
  if (!byCategory.length) return table(doc, [{ label: "" }], []);
  for (const c of byCategory) {
    ensure(doc, 30);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(C.primary).text(clean(`${c.category.toUpperCase()} — ${num(c.total)} bouteille(s) sortie(s)`));
    doc.font("Helvetica").fontSize(8.5).fillColor(C.text);
    for (const b of c.brands) {
      ensure(doc, 12);
      doc.text(clean(`   • ${b.brand} : ${num(b.total)} bouteille(s) sortie(s)${b.sold !== b.total ? ` dont ${num(b.sold)} vendue(s)` : ""}`));
    }
    doc.moveDown(0.3);
  }
}

function cashTable(doc, sessions) {
  table(
    doc,
    [{ label: "Caissier", w: 2 }, { label: "Statut", w: 1.1 }, { label: "Fonds", align: "right", w: 1.2 }, { label: "Encaissé", align: "right", w: 1.4 }, { label: "Dépenses", align: "right", w: 1.3 }, { label: "Retraits", align: "right", w: 1.2 }, { label: "Théorique", align: "right", w: 1.4 }, { label: "Compté", align: "right", w: 1.4 }, { label: "Écart", align: "right", w: 1.2 }],
    sessions.map((s) => [s.cashier, s.status === "open" ? "Ouverte" : "Fermée", num(s.opening), num(s.collected), num(s.expenses), num(s.withdrawals + s.refunds), num(s.theoretical), s.counted === null ? "—" : num(s.counted), s.variance === null ? "—" : num(s.variance)]),
    { fontSize: 7.2 },
  );
}

function stockTable(doc, stock) {
  table(
    doc,
    [{ label: "Boisson", w: 3 }, { label: "Catégorie", w: 1.8 }, { label: "Stock (btl)", align: "right", w: 1.1 }, { label: "En casiers", w: 2 }, { label: "Valeur achat", align: "right", w: 1.5 }, { label: "Alerte", w: 1 }],
    stock.map((s) => [`${pname(s)}`, s.category, num(s.stock), s.label, num(s.value), s.stock <= 0 ? "Rupture" : s.low && s.min_stock ? "Faible" : ""]),
    { fontSize: 7.2 },
  );
}

export function renderReportPdf(r) {
  const d = r.data;
  const doc = new PDFDocument({ size: "A4", margins: { top: 34, bottom: 36, left: 34, right: 34 }, bufferPages: true, info: { Title: clean(`${r.doc_no} ${d.period.label}`), Author: "MAQUIS PRO MANAGER" } });
  if (r.kind === "daily") renderDaily(doc, r);
  else renderWeekly(doc, r);
  footer(doc, `${r.doc_no} · Bilan produit automatiquement par le serveur à partir des seules opérations enregistrées · MAQUIS PRO MANAGER`);
  return toBuffer(doc);
}

function renderDaily(doc, r) {
  const d = r.data;
  reportHeader(doc, r, "RAPPORT QUOTIDIEN DES SORTIES");
  const e = d.exits;
  kpis(doc, [
    ["Bouteilles sorties", num(e.total_bottles), `${num(e.by_kind.sale)} vendues`],
    ["Casiers sortis (équiv.)", String(e.crates_equivalent).replace(".", ","), `${num(e.full_crates)} casier(s) complet(s)`],
    ["Montant des ventes", money(d.sales.amount), `${num(d.sales.count)} vente(s)`],
    ["Montant encaissé", money(d.sales.collected), d.sales.credit_given ? `crédit : ${money(d.sales.credit_given)}` : "aucun crédit"],
  ]);

  section(doc, "Sorties par nature");
  table(doc, [...KIND_COLS.map((k) => ({ label: EXIT_LABELS[k], align: "right" })), { label: "TOTAL", align: "right" }], [[...KIND_COLS.map((k) => num(e.by_kind[k])), num(e.total_bottles)]], { fontSize: 7.5 });

  section(doc, "Quantités sorties par marque");
  brandBlocks(doc, e.by_category);

  section(doc, "Boissons les plus vendues");
  hbars(doc, d.analysis.top.map((t) => ({ label: t.name, value: t.qty })), { valueLabel: (x) => `${num(x)} btl` });

  section(doc, "Tableau des boissons sorties");
  exitsTable(doc, e.by_product);

  section(doc, "Quantités par catégorie");
  table(
    doc,
    [{ label: "Catégorie", w: 2.5 }, { label: "Vendues", align: "right" }, { label: "Autres sorties", align: "right" }, { label: "Total", align: "right" }, { label: "Montant des ventes", align: "right", w: 1.6 }],
    e.by_category.map((c) => [c.category, num(c.sold), num(c.total - c.sold), num(c.total), money(c.sale_value)]),
  );

  section(doc, "Détail des ventes");
  table(
    doc,
    [{ label: "Serveur", w: 2.4 }, { label: "Ventes", align: "right" }, { label: "Bouteilles", align: "right" }, { label: "Montant", align: "right", w: 1.5 }],
    d.sales.by_waiter.map((w) => [w.waiter, num(w.sales), num(w.bottles), money(w.amount)]),
  );
  if (e.by_waiter.length) {
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C.text).text("Quantités sorties par serveur (toutes natures)");
    doc.moveDown(0.2);
    table(doc, [{ label: "Serveur", w: 2 }, ...KIND_COLS.map((k) => ({ label: KIND_SHORT[k], align: "right" })), { label: "Total", align: "right" }], e.by_waiter.map((w) => [w.waiter, ...KIND_COLS.map((k) => num(w[k])), num(w.total)]), { fontSize: 7.2 });
  }
  if (d.sales.credit_customers.length) {
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C.text).text("Ventes à crédit (reste dû au moment de la vente)");
    doc.moveDown(0.2);
    table(doc, [{ label: "Reçu", w: 1.6 }, { label: "Client", w: 2.4 }, { label: "Total", align: "right" }, { label: "Crédit", align: "right" }], d.sales.credit_customers.map((c) => [c.doc_no, c.customer_name || "—", money(c.total), money(c.credit)]));
  }

  section(doc, "Détail des pertes, casses et boissons offertes");
  table(
    doc,
    [{ label: "Reçu", w: 1.6 }, { label: "Nature", w: 1.6 }, { label: "Boisson", w: 2.6 }, { label: "Qté", align: "right", w: 0.7 }, { label: "Valeur achat", align: "right", w: 1.3 }, { label: "Responsable / observation", w: 2.8 }],
    d.losses.map((l) => [l.doc_no, l.reason_label, `${pname(l)}`, num(l.qty), num(l.cost), [l.responsible_name || l.user_name, l.waiter_name, l.observation].filter(Boolean).join(" — ")]),
    { fontSize: 7.2 },
  );

  section(doc, "Résumé financier");
  totalsBlock(doc, [
    ["Montant total des ventes", money(d.sales.amount), true],
    ...d.sales.collected_by_method.map((m) => [`Encaissé — ${m.method}`, money(m.amount)]),
    ["Total encaissé", money(d.sales.collected), true],
    ["dont règlements de crédits antérieurs", money(d.sales.credit_settled)],
    ["Ventes à crédit (non encaissées)", money(d.sales.credit_given)],
    ["Remboursements", money(d.sales.refunds)],
    ["Dépenses", money(d.cash.expenses_total)],
    ["Coût d'achat des boissons vendues", money(d.sales.cogs)],
    ["Bénéfice brut estimé", money(d.sales.gross_profit), true],
    ["Pertes (prix d'achat)", money(d.analysis.loss_cost)],
  ]);

  section(doc, "Résumé de caisse");
  cashTable(doc, d.cash.sessions);
  if (d.cash.expenses.length)
    table(doc, [{ label: "Dépense", w: 1.5 }, { label: "Catégorie", w: 1.5 }, { label: "Description", w: 3 }, { label: "Par", w: 1.6 }, { label: "Montant", align: "right", w: 1.3 }], d.cash.expenses.map((x) => [x.doc_no, x.category, x.description, x.user_name, money(x.amount)]), { fontSize: 7.2 });

  section(doc, "Analyse automatique et observations");
  const a = d.analysis;
  const lines = [
    a.best_seller ? `Boisson la plus vendue : ${a.best_seller.name} (${num(a.best_seller.qty)} bouteilles, ${money(a.best_seller.amount)}).` : "Aucune boisson vendue.",
    a.least_seller ? `Boisson la moins vendue (parmi les vendues) : ${a.least_seller.name} (${num(a.least_seller.qty)}).` : null,
    a.top_brands.length ? `Marques les plus demandées : ${a.top_brands.map((b) => `${b.brand} (${num(b.qty)})`).join(", ")}.` : null,
    a.top_categories.length ? `Catégories les plus vendues : ${a.top_categories.map((c) => `${c.category} (${num(c.qty)})`).join(", ")}.` : null,
    `Comparaison avec la veille : ${money(a.comparison.previous_day.amount)} (${v(a.comparison.previous_day.variation)}).`,
    a.comparison.average_7d ? `Moyenne des ${a.comparison.average_7d.days} journée(s) précédente(s) : ${money(a.comparison.average_7d.amount)} (${v(a.comparison.average_7d.variation)}).` : "Pas encore assez d'historique pour une moyenne sur 7 jours.",
    a.unsold.length ? `Boissons en stock non vendues : ${a.unsold.slice(0, 12).join(", ")}${a.unsold.length > 12 ? "…" : ""}.` : null,
    ...a.observations,
  ].filter(Boolean);
  bullets(doc, [...new Set(lines)]);

  section(doc, "Responsables des opérations");
  table(doc, [{ label: "Nom", w: 3 }, { label: "Rôle", w: 1.5 }, { label: "Opérations enregistrées", align: "right", w: 1.6 }], d.responsibles.map((x) => [x.user_name, { owner: "Propriétaire", manager: "Gérant", cashier: "Caissier", waiter: "Serveur" }[x.role] || x.role, num(x.operations)]));

  section(doc, "Stock restant à la clôture");
  stockTable(doc, d.stock_end);
}

function renderWeekly(doc, r) {
  const d = r.data;
  const s = d.summary;
  reportHeader(doc, r, "BILAN HEBDOMADAIRE DES VENTES");
  kpis(doc, [
    ["Chiffre d'affaires", money(s.revenue), `${num(s.sales_count)} vente(s)`],
    ["Total encaissé", money(s.collected), `net des remboursements : ${money(s.net_collected)}`],
    ["Dépenses", money(s.expenses), ""],
    ["Bénéfice brut estimé", money(s.gross_profit), `marge ${String(s.margin_pct).replace(".", ",")} %`],
  ]);
  kpis(doc, [
    ["Bouteilles vendues", num(s.bottles_sold), `${String(s.crates_sold).replace(".", ",")} casier(s) équiv.`],
    ["Total des sorties", num(s.total_exits), "toutes natures"],
    ["Pertes et casses", num(s.losses_qty), money(s.losses_cost)],
    ["Écarts de caisse", money(s.cash_variance), ""],
  ]);

  section(doc, "Comparaison avec la semaine précédente");
  const c = d.comparison;
  table(
    doc,
    [{ label: "Indicateur", w: 2.4 }, { label: "Cette semaine", align: "right", w: 1.6 }, { label: "Semaine précédente", align: "right", w: 1.6 }, { label: "Variation", align: "right" }],
    [
      ["Chiffre d'affaires", money(s.revenue), money(c.previous.revenue), v(c.variation.revenue)],
      ["Total encaissé", money(s.collected), money(c.previous.collected), v(c.variation.collected)],
      ["Bouteilles vendues", num(s.bottles_sold), num(c.previous.bottles_sold), v(c.variation.bottles_sold)],
      ["Bénéfice brut estimé", money(s.gross_profit), money(c.previous.gross_profit), v(c.variation.gross_profit)],
      ["Dépenses", money(s.expenses), money(c.previous.expenses), v(c.variation.expenses)],
    ],
  );

  section(doc, "Chiffre d'affaires jour par jour");
  vbars(doc, d.daily.map((x) => ({ label: x.label, value: x.amount })), { valueLabel: (x) => (x ? num(x) : "0") });

  section(doc, "Ventes par catégorie");
  table(doc, [{ label: "Catégorie", w: 2.4 }, { label: "Bouteilles vendues", align: "right", w: 1.4 }, { label: "Montant", align: "right", w: 1.5 }, { label: "Part du CA", align: "right" }], d.exits.by_category.filter((x) => x.sold).map((x) => [x.category, num(x.sold), money(x.sale_value), `${pct(x.sale_value, s.revenue)} %`]));
  hbars(doc, d.exits.by_category.filter((x) => x.sale_value > 0).map((x) => ({ label: x.category, value: x.sale_value })), { valueLabel: money });

  section(doc, "Ventes par marque");
  table(doc, [{ label: "Catégorie", w: 1.8 }, { label: "Marque", w: 2 }, { label: "Bouteilles vendues", align: "right", w: 1.4 }, { label: "Montant", align: "right", w: 1.5 }], [...d.exits.by_brand].filter((b) => b.sold).sort((a, b) => b.sale_value - a.sale_value).map((b) => [b.category, b.brand, num(b.sold), money(b.sale_value)]));

  section(doc, "Ventes par serveur");
  table(doc, [{ label: "Serveur", w: 2.4 }, { label: "Ventes", align: "right" }, { label: "Bouteilles", align: "right" }, { label: "Montant", align: "right", w: 1.5 }, { label: "Marge estimée", align: "right", w: 1.5 }], d.sales.by_waiter.map((w) => [w.waiter, num(w.sales), num(w.bottles), money(w.amount), money(w.margin)]));

  section(doc, "Boissons les plus vendues");
  hbars(doc, d.ranking.top.map((t) => ({ label: t.name, value: t.qty })), { valueLabel: (x) => `${num(x)} btl` });
  section(doc, "Boissons les moins vendues");
  table(doc, [{ label: "Boisson", w: 3 }, { label: "Bouteilles", align: "right" }, { label: "Montant", align: "right", w: 1.4 }], d.ranking.flop.map((t) => [t.name, num(t.qty), money(t.amount)]));

  section(doc, "Sorties de la semaine (pertes, casses, offertes…)");
  table(doc, [...KIND_COLS.map((k) => ({ label: EXIT_LABELS[k], align: "right" })), { label: "TOTAL", align: "right" }], [[...KIND_COLS.map((k) => num(d.exits.by_kind[k])), num(s.total_exits)]], { fontSize: 7.5 });
  exitsTable(doc, d.exits.by_product);

  section(doc, "Dépenses par catégorie");
  table(doc, [{ label: "Catégorie", w: 3 }, { label: "Montant", align: "right", w: 1.5 }], d.cash.expenses_by_category.map((x) => [x.category, money(x.amount)]));

  section(doc, "Caisses et écarts");
  cashTable(doc, d.cash.sessions);

  section(doc, "Résumé financier");
  totalsBlock(doc, [
    ["Chiffre d'affaires", money(s.revenue), true],
    ["Coût d'achat des boissons vendues", money(s.cogs)],
    ["Bénéfice brut estimé", money(s.gross_profit), true],
    ["Dépenses", money(s.expenses)],
    ["Pertes et casses (prix d'achat)", money(s.losses_cost)],
    ["Résultat estimé après dépenses et pertes", money(s.estimated_result), true],
    ["Crédits accordés / réglés", `${money(s.credit_given)} / ${money(s.credit_settled)}`],
    ["Achats de marchandises (entrées)", `${money(s.purchases)} (${s.purchases_count})`],
  ]);

  section(doc, "Observations");
  bullets(doc, d.observations.length ? d.observations : ["Aucune observation particulière."]);

  section(doc, `Stock restant à la clôture — ${num(s.stock_bottles)} bouteilles, ${money(s.stock_value)} au prix d'achat`);
  stockTable(doc, d.stock_end);
}
