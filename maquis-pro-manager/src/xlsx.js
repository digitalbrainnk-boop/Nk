// Export Excel (.xlsx) sans dépendance lourde : classeur Office Open XML compressé avec fflate.
import { zipSync, strToU8 } from "fflate";
import { EXIT_LABELS } from "./stock.js";

const esc = (s) =>
  String(s ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function colName(i) {
  let s = "";
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

// rows : tableaux de valeurs ; une ligne { title } ou { header: [...] } est mise en gras.
function sheetXml(rows, widths = []) {
  let body = "";
  rows.forEach((row, r) => {
    let style = 0;
    let cells = row;
    if (row && !Array.isArray(row)) {
      cells = row.title !== undefined ? [row.title] : row.header;
      style = row.title !== undefined ? 2 : 1;
    }
    body += `<row r="${r + 1}">`;
    (cells || []).forEach((v, c) => {
      const ref = `${colName(c)}${r + 1}`;
      if (typeof v === "number" && Number.isFinite(v)) body += `<c r="${ref}" s="${style || 3}"><v>${v}</v></c>`;
      else if (v !== null && v !== undefined && v !== "") body += `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    });
    body += "</row>";
  });
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${body}</sheetData></worksheet>`;
}

export function buildXlsx(sheets) {
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
      .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
      .join("")}</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map((s, i) => `<sheet name="${esc(s.name.slice(0, 31).replace(/[\\/?*[\]:]/g, " "))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="13"/><color rgb="FF065F46"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF065F46"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
  };
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s.rows, s.widths)));
  const zipped = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])), { level: 6 });
  return Buffer.from(zipped);
}

const KINDS = ["sale", "offered", "staff", "broken", "lost", "expired", "other"];

// Export d'un rapport (hebdomadaire ou quotidien) en plusieurs feuilles.
export function reportToXlsx(r) {
  const d = r.data;
  const sheets = [];
  const head = [{ title: `${d.maquis?.name || ""} — ${r.kind === "daily" ? "Rapport quotidien" : "Bilan hebdomadaire"} ${r.doc_no}` }, [d.period.label], [`Du ${d.period.start_label} au ${d.period.end_label}`], [`Généré le ${d.generated_label}${d.version > 1 ? ` (rectificatif de ${d.rectifies})` : ""}`], []];
  if (r.kind === "weekly") {
    const s = d.summary;
    const c = d.comparison;
    sheets.push({
      name: "Résumé",
      widths: [42, 20, 22, 14],
      rows: [
        ...head,
        { header: ["Indicateur", "Cette semaine", "Semaine précédente", "Variation %"] },
        ["Chiffre d'affaires (FCFA)", s.revenue, c.previous.revenue, c.variation.revenue],
        ["Total encaissé (FCFA)", s.collected, c.previous.collected, c.variation.collected],
        ["Dépenses (FCFA)", s.expenses, c.previous.expenses, c.variation.expenses],
        ["Bouteilles vendues", s.bottles_sold, c.previous.bottles_sold, c.variation.bottles_sold],
        ["Casiers vendus (équivalent)", s.crates_sold],
        ["Bénéfice brut estimé (FCFA)", s.gross_profit, c.previous.gross_profit, c.variation.gross_profit],
        ["Marge brute %", s.margin_pct],
        ["Pertes et casses (bouteilles)", s.losses_qty],
        ["Pertes et casses (FCFA, prix d'achat)", s.losses_cost],
        ["Boissons offertes", s.offered],
        ["Total des sorties (bouteilles)", s.total_exits],
        ["Résultat estimé après dépenses et pertes (FCFA)", s.estimated_result],
        ["Écarts de caisse (FCFA)", s.cash_variance],
        ["Crédits accordés (FCFA)", s.credit_given],
        ["Crédits réglés (FCFA)", s.credit_settled],
        ["Stock restant (bouteilles)", s.stock_bottles],
        ["Valeur du stock (FCFA, prix d'achat)", s.stock_value],
        [],
        { header: ["Observations"] },
        ...d.observations.map((o) => [o]),
      ],
    });
    sheets.push({ name: "Jour par jour", widths: [22, 18, 14, 18], rows: [{ header: ["Journée", "Chiffre d'affaires", "Bouteilles", "Encaissé"] }, ...d.daily.map((x) => [x.label, x.amount, x.bottles, x.collected])] });
  } else {
    sheets.push({
      name: "Résumé",
      widths: [42, 20],
      rows: [
        ...head,
        { header: ["Indicateur", "Valeur"] },
        ["Bouteilles sorties", d.exits.total_bottles],
        ["Casiers sortis (équivalent)", d.exits.crates_equivalent],
        ...KINDS.map((k) => [`Bouteilles — ${EXIT_LABELS[k].toLowerCase()}`, d.exits.by_kind[k]]),
        ["Montant des ventes (FCFA)", d.sales.amount],
        ["Montant encaissé (FCFA)", d.sales.collected],
        ["Ventes à crédit (FCFA)", d.sales.credit_given],
        ["Dépenses (FCFA)", d.cash.expenses_total],
        ["Bénéfice brut estimé (FCFA)", d.sales.gross_profit],
        [],
        { header: ["Observations"] },
        ...d.analysis.observations.map((o) => [o]),
      ],
    });
  }
  sheets.push({
    name: "Sorties par boisson",
    widths: [34, 18, 18, ...KINDS.map(() => 12), 10],
    rows: [{ header: ["Boisson", "Marque", "Catégorie", ...KINDS.map((k) => EXIT_LABELS[k]), "Total"] }, ...d.exits.by_product.map((x) => [x.name, x.brand, x.category, ...KINDS.map((k) => x[k]), x.total])],
  });
  sheets.push({
    name: "Par marque",
    widths: [22, 20, 14, 14, 18],
    rows: [{ header: ["Catégorie", "Marque", "Vendues", "Total sorties", "Montant ventes"] }, ...d.exits.by_brand.map((b) => [b.category, b.brand, b.sold, b.total, b.sale_value])],
  });
  sheets.push({
    name: "Par serveur",
    widths: [26, 10, 12, 16, 16],
    rows: [{ header: ["Serveur", "Ventes", "Bouteilles", "Montant", "Marge estimée"] }, ...d.sales.by_waiter.map((w) => [w.waiter, w.sales, w.bottles, w.amount, w.margin])],
  });
  sheets.push({
    name: "Caisses",
    widths: [22, 10, 12, 14, 12, 12, 14, 14, 12],
    rows: [
      { header: ["Caissier", "Statut", "Fonds", "Encaissé", "Dépenses", "Retraits", "Théorique", "Compté", "Écart"] },
      ...d.cash.sessions.map((s) => [s.cashier, s.status === "open" ? "Ouverte" : "Fermée", s.opening, s.collected, s.expenses, s.withdrawals, s.theoretical, s.counted ?? "", s.variance ?? ""]),
      [],
      { header: ["Dépense", "Catégorie", "Description", "Par", "Montant"] },
      ...d.cash.expenses.map((x) => [x.doc_no, x.category, x.description, x.user_name, x.amount]),
    ],
  });
  sheets.push({
    name: "Stock à la clôture",
    widths: [34, 18, 20, 12, 24, 16],
    rows: [{ header: ["Boisson", "Marque", "Catégorie", "Stock", "En casiers", "Valeur achat"] }, ...d.stock_end.map((s) => [s.name, s.brand, s.category, s.stock, s.label, s.value])],
  });
  return buildXlsx(sheets);
}
