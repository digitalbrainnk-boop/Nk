// Écrans du gérant (et consultation en lecture seule pour le propriétaire) : stock, produits,
// entrées, sorties, inventaires, fournisseurs, consignes, dépenses, caisses, ventes, commandes.
import {
  S, h, icon, api, GET, POST, toast, fail, modal, confirmBox, field, input, select, formData, pageHead, card, stat, empty, loader, chip, table,
  money, num, datetime, date, dayShort, crates, go, debounce, today, productName, photo, ROLE_LABELS, emit,
} from "./core.js";
import { docActions } from "./views-common.js";
import { resizeImage } from "./views-owner.js";

const isManager = () => S.user.role === "manager";
const products = () => (S.boot.products || []).filter((p) => p.active);
const cats = () => S.boot.categories || [];
const reasonChip = (r, label) => chip(label, ["broken", "lost", "expired"].includes(r) ? "bad" : r === "sale" ? "good" : "warn");

async function refreshBoot() {
  S.boot = await GET("/api/bootstrap");
  emit("boot");
}

// ---------- Stock ----------
export async function viewStock(main) {
  main.replaceChildren(loader());
  const rows = await GET("/api/stock");
  let cat = "";
  const q = input("q", { type: "search", placeholder: "Rechercher une boisson ou une marque" });
  const listBox = h("div");
  const tabs = h("div", { class: "tabs" });
  const render = () => {
    const term = q.value.trim().toLowerCase();
    const shown = rows.filter((r) => (!cat || r.category === cat) && (!term || `${productName(r)} ${r.reference}`.toLowerCase().includes(term)));
    tabs.replaceChildren(...["", ...new Set(rows.map((r) => r.category))].map((c) => h("button", { class: cat === c ? "on" : "", on: { click: () => ((cat = c), render()) } }, c || "Toutes")));
    listBox.replaceChildren(
      table(
        [
          { label: "Boisson", get: (r) => h("div", null, h("b", null, productName(r)), h("div", { class: "small muted" }, `${r.category} · ${r.reference}`)) },
          { label: "Stock", r: true, get: (r) => h("div", null, h("b", { class: r.out ? "bad" : r.low ? "warn" : "" }, num(r.stock)), h("div", { class: "small muted" }, r.label)) },
          { label: "Entrées", r: true, get: (r) => num(r.entries + r.initial) },
          { label: "Vendues", r: true, get: (r) => num(r.sold) },
          { label: "Autres sorties", r: true, get: (r) => num(r.other_exits) },
          { label: "Min.", r: true, get: (r) => num(r.min_stock) },
          { label: "Valeur (achat)", r: true, get: (r) => money(r.value) },
          { label: "", get: (r) => (r.out ? chip("Rupture", "bad") : r.low ? chip("Faible", "warn") : chip("OK", "good")) },
        ],
        shown,
        { onRow: (r) => go(`#/stock/${r.id}`), foot: ["Total", num(shown.reduce((s, r) => s + r.stock, 0)), "", "", "", "", money(shown.reduce((s, r) => s + r.value, 0)), ""] },
      ),
    );
  };
  q.addEventListener("input", render);
  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  main.replaceChildren(
    pageHead("Stock", "STOCK FINAL = STOCK INITIAL + ENTRÉES − SORTIES, calculé automatiquement.", isManager() ? [h("a", { class: "btn primary", href: "#/entrees/nouvelle" }, icon("in"), "Entrée"), h("a", { class: "btn", href: "#/sorties/nouvelle" }, icon("out"), "Sortie"), h("a", { class: "btn", href: "#/inventaires" }, icon("clip"), "Inventaire")] : []),
    h("div", { class: "stats mb" }, stat("Bouteilles en stock", num(rows.reduce((s, r) => s + r.stock, 0))), stat("Valeur (prix d'achat)", money(totalValue)), stat("Valeur (prix de vente)", money(rows.reduce((s, r) => s + r.sale_value, 0))), stat("Alertes", `${rows.filter((r) => r.low).length}`, `${rows.filter((r) => r.out).length} rupture(s)`)),
    card(null, h("div", { class: "search mb" }, icon("search"), q), tabs, listBox),
  );
  render();
}

export async function viewProduct(main, id) {
  main.replaceChildren(loader());
  const d = await GET(`/api/products/${id}/history`);
  const p = d.product;
  main.replaceChildren(
    pageHead(productName(p), `${p.category} · réf. ${p.reference}${p.active ? "" : " · désactivé"}`, isManager() ? [h("button", { class: "btn", on: { click: () => productForm(p, () => viewProduct(main, id)) } }, "Modifier la fiche")] : [], "#/stock"),
    h(
      "div",
      { class: "grid g2" },
      card(
        null,
        h("div", { class: "flex", style: { alignItems: "flex-start" } }, h("div", { style: { width: "96px", height: "96px", borderRadius: "14px", overflow: "hidden", background: "var(--surface-2)", display: "grid", placeItems: "center", fontWeight: 800 } }, photo(p)), h("div", { class: "kv grow" }, h("div", null, h("span", null, "Stock disponible"), h("b", { class: p.stock <= 0 ? "bad" : p.low ? "warn" : "good" }, `${num(p.stock)} btl (${crates(p.stock, p.units_per_crate, p.pack_label)})`)), h("div", null, h("span", null, "Prix d'achat"), h("b", null, money(p.purchase_price))), h("div", null, h("span", null, "Prix de vente"), h("b", null, money(p.sale_price))), h("div", null, h("span", null, `Bouteilles par ${p.pack_label}`), h("b", null, p.units_per_crate)), h("div", null, h("span", null, "Stock minimum"), h("b", null, num(p.min_stock))), h("div", null, h("span", null, "Fournisseur"), h("b", null, p.supplier || "—")), h("div", null, h("span", null, "Valeur du stock"), h("b", null, money(p.stock_value))))),
        isManager() ? h("label", { class: "btn sm mt" }, icon("plus"), "Photo", h("input", { type: "file", accept: "image/*", class: "hidden", on: { change: async (e) => {
          try {
            await POST(`/api/products/${id}/photo`, { image: await resizeImage(e.target.files[0], 480) });
            toast("Photo enregistrée.", "good");
            await refreshBoot();
            viewProduct(main, id);
          } catch (err) {
            fail(err);
          }
        } } })) : null,
      ),
      card("Historique des prix", table([{ label: "Date", get: (x) => datetime(x.at) }, { label: "Achat", r: true, get: (x) => money(x.purchase_price) }, { label: "Vente", r: true, get: (x) => money(x.sale_price) }, { label: "Par", get: (x) => x.user_name || "—" }], d.prices)),
    ),
    card("Historique des mouvements", movementsTable(d.movements)),
  );
}

function movementsTable(rows) {
  return table(
    [
      { label: "Date", get: (m) => h("div", null, datetime(m.at), h("div", { class: "small muted" }, `journée du ${dayShort(m.business_day)}`)) },
      { label: "Boisson", get: (m) => `${productName(m)}` },
      { label: "Nature", get: (m) => h("div", null, m.kind === "entry" || m.kind === "initial" ? chip(m.kind_label, "good") : m.kind === "inventory" ? chip(m.kind_label, "accent") : reasonChip(m.kind, m.kind_label), m.reversal ? chip("annulation", "bad") : null) },
      { label: "Quantité", r: true, get: (m) => h("b", { class: m.qty > 0 ? "good" : "" }, `${m.qty > 0 ? "+" : ""}${num(m.qty)}`) },
      { label: "Responsable", get: (m) => [m.user_name, m.waiter_name ? `serveur ${m.waiter_name}` : ""].filter(Boolean).join(" · ") },
      { label: "Reçu", get: (m) => (m.doc_no ? h("a", { href: `#/recus/${m.doc_no}` }, m.doc_no) : m.note || "") },
    ],
    rows,
  );
}

export async function viewMovements(main) {
  const kind = select("kind", [{ value: "exits", label: "Toutes les sorties (ventes comprises)" }, { value: "", label: "Tous les mouvements" }, { value: "entry", label: "Entrées" }, { value: "sale", label: "Vendues" }, { value: "offered", label: "Offertes" }, { value: "staff", label: "Personnel" }, { value: "broken", label: "Cassées" }, { value: "lost", label: "Perdues" }, { value: "expired", label: "Périmées" }, { value: "other", label: "Autres sorties" }, { value: "inventory", label: "Ajustements d'inventaire" }], "exits");
  const from = input("from", { type: "date", value: today() });
  const to = input("to", { type: "date", value: today() });
  const prod = select("product_id", [{ value: "", label: "Toutes les boissons" }, ...(S.boot.products || []).map((p) => ({ value: p.id, label: productName(p) }))], "");
  const box = h("div", null, loader());
  const load = async () => {
    box.replaceChildren(loader());
    const rows = await GET(`/api/movements?${new URLSearchParams({ kind: kind.value, from: from.value, to: to.value, product_id: prod.value })}`);
    const out = rows.filter((m) => m.qty < 0).reduce((s, m) => s - m.qty, 0);
    box.replaceChildren(h("p", { class: "small muted mb" }, `${rows.length} mouvement(s) · ${num(out)} bouteille(s) sorties sur la sélection`), movementsTable(rows));
  };
  for (const el of [kind, from, to, prod]) el.addEventListener("change", () => load().catch(fail));
  main.replaceChildren(pageHead("Journal des mouvements", "Chaque bouteille qui entre ou sort, avec son responsable."), card(null, h("div", { class: "filters" }, field("Nature", kind), field("Boisson", prod), field("Du", from), field("Au", to)), box));
  load().catch(fail);
}

// ---------- Produits ----------
export function productForm(p, done) {
  const isNew = !p;
  p ||= { units_per_crate: 12, pack_label: "casier", min_stock: 0, active: true };
  const form = h(
    "div",
    { class: "form" },
    h("div", { class: "row" }, field("Nom de la boisson", input("name", { value: p.name || "", required: true, placeholder: "Ex. Brakina 65 cl" })), field("Marque", input("brand", { value: p.brand || "", required: true, placeholder: "Ex. Brakina" }))),
    h("div", { class: "row" }, field("Catégorie", select("category_id", cats().filter((c) => c.active).map((c) => ({ value: c.id, label: c.name })), p.category_id)), field("Référence", input("reference", { value: p.reference || "", placeholder: "automatique si vide" }))),
    h("div", { class: "row" }, field("Prix d'achat (FCFA)", input("purchase_price", { type: "number", inputmode: "numeric", min: 0, value: p.purchase_price ?? "", required: true })), field("Prix de vente (FCFA)", input("sale_price", { type: "number", inputmode: "numeric", min: 0, value: p.sale_price ?? "", required: true }))),
    h("div", { class: "row" }, field("Bouteilles par casier / pack", input("units_per_crate", { type: "number", min: 1, value: p.units_per_crate })), field("Conditionnement", select("pack_label", [{ value: "casier", label: "Casier" }, { value: "pack", label: "Pack" }, { value: "carton", label: "Carton" }], p.pack_label)), field("Stock minimum (alerte)", input("min_stock", { type: "number", min: 0, value: p.min_stock }))),
    field("Fournisseur", select("supplier_id", [{ value: "", label: "Aucun" }, ...(S.boot.suppliers || []).map((s) => ({ value: s.id, label: s.name }))], p.supplier_id ?? "")),
    isNew ? h("div", { class: "row" }, field("Stock initial : casiers", input("initial_crates", { type: "number", min: 0, value: 0 })), field("+ bouteilles", input("initial_units", { type: "number", min: 0, value: 0 }))) : h("label", { class: "check" }, h("input", { type: "checkbox", name: "active", checked: p.active }), "Boisson active (décocher pour la retirer de la vente)"),
    !isNew ? h("p", { class: "small muted" }, "Un changement de prix est enregistré dans l'historique ; il ne modifie pas les ventes déjà faites.") : null,
  );
  return modal(isNew ? "Nouvelle boisson" : `Modifier — ${productName(p)}`, form, [
    { label: "Annuler", class: "ghost" },
    { label: "Enregistrer", class: "primary", submit: true, onClick: async () => {
      const d = formData(form.closest("form"));
      if (d.supplier_id === "") d.supplier_id = null;
      if (isNew) await POST("/api/products", d);
      else await api("PATCH", `/api/products/${p.id}`, d);
      toast("Fiche enregistrée.", "good");
      await refreshBoot();
      done?.();
    } },
  ]);
}

export async function viewProducts(main) {
  main.replaceChildren(loader());
  const rows = await GET("/api/products?all=1");
  main.replaceChildren(
    pageHead("Catalogue des boissons", `${rows.filter((p) => p.active).length} boisson(s) active(s)`, isManager() ? [h("button", { class: "btn primary", on: { click: () => productForm(null, () => viewProducts(main)) } }, icon("plus"), "Nouvelle boisson"), h("button", { class: "btn", on: { click: () => categoryForm(main) } }, "Catégories")] : []),
    card(
      null,
      table(
        [
          { label: "", get: (p) => h("div", { style: { width: "40px", height: "40px", borderRadius: "10px", overflow: "hidden", background: "var(--surface-2)", display: "grid", placeItems: "center", fontSize: "12px", fontWeight: 800 } }, photo(p)) },
          { label: "Boisson", get: (p) => h("div", null, h("b", null, productName(p)), h("div", { class: "small muted" }, `${p.category} · ${p.reference}`)) },
          { label: "Achat", r: true, get: (p) => money(p.purchase_price) },
          { label: "Vente", r: true, get: (p) => money(p.sale_price) },
          { label: "Casier", r: true, get: (p) => `${p.units_per_crate} btl` },
          { label: "Stock", r: true, get: (p) => num(p.stock) },
          { label: "", get: (p) => (p.active ? "" : chip("Désactivée")) },
        ],
        rows,
        { onRow: (p) => (isManager() ? productForm(p, () => viewProducts(main)) : go(`#/stock/${p.id}`)) },
      ),
    ),
  );
}

function categoryForm(main) {
  const name = input("name", { required: true, placeholder: "Ex. Liqueurs" });
  modal("Catégories", h("div", { class: "form" }, h("div", { class: "list" }, cats().map((c) => h("div", { class: "item" }, h("div", { class: "grow t" }, c.name), !c.active ? chip("masquée") : null))), field("Nouvelle catégorie", name)), [
    { label: "Fermer", class: "ghost" },
    { label: "Ajouter", class: "primary", submit: true, onClick: async () => {
      await POST("/api/categories", { name: name.value });
      await refreshBoot();
      toast("Catégorie ajoutée.", "good");
    } },
  ]);
}

// ---------- Lignes « casiers + bouteilles » (entrées et sorties) ----------
function crateLines({ withCost = false, onChange = () => {} } = {}) {
  const lines = [];
  let ready = false;
  const changed = () => ready && onChange();
  const box = h("div", { class: "linegrid" });
  const opts = () => [{ value: "", label: "— Choisir une boisson —" }, ...products().map((p) => ({ value: p.id, label: `${productName(p)}${withCost ? "" : ` (stock ${num(p.stock)})`}` }))];
  const qtyOf = (l) => (Number(l.crates) || 0) * (Number(l.upc) || 1) + (Number(l.extra) || 0);
  const render = () => {
    box.replaceChildren(
      ...lines.map((l, i) => {
        const p = products().find((x) => x.id === Number(l.product_id));
        const calc = h("div", { class: "calc" });
        const upd = () => {
          const q = qtyOf(l);
          calc.textContent = p ? `= ${num(q)} bouteille(s)${withCost ? ` × ${money(Number(l.cost) || 0)} = ${money(q * (Number(l.cost) || 0))}` : ""}` : "";
          changed();
        };
        const sel = select("product_id", opts(), l.product_id, { on: { change: (e) => {
          l.product_id = e.target.value;
          const np = products().find((x) => x.id === Number(l.product_id));
          l.upc = np?.units_per_crate || 12;
          if (withCost) l.cost = np?.purchase_price ?? 0;
          render();
        } } });
        const numIn = (key, label, attrs = {}) => field(label, input(key, { type: "number", inputmode: "numeric", min: 0, value: l[key] ?? 0, ...attrs, on: { input: (e) => ((l[key] = e.target.value), upd()) } }));
        upd();
        return h(
          "div",
          { class: "linebox" },
          h("div", { class: "flex between" }, h("b", null, `Ligne ${i + 1}`), lines.length > 1 ? h("button", { class: "btn sm ghost", type: "button", on: { click: () => (lines.splice(i, 1), render(), changed()) } }, icon("x"), "Retirer") : null),
          field("Boisson", sel),
          p ? h("div", { class: "row" }, numIn("crates", `Nombre de ${p.pack_label}s`), numIn("upc", `Bouteilles par ${p.pack_label}`, { min: 1 }), numIn("extra", "Bouteilles en plus"), withCost ? numIn("cost", "Prix d'achat unitaire") : null) : null,
          calc,
        );
      }),
      h("button", { class: "btn", type: "button", on: { click: () => (lines.push({ product_id: "", crates: 0, extra: 0, upc: 12, cost: 0 }), render()) } }, icon("plus"), "Ajouter une boisson"),
    );
  };
  lines.push({ product_id: "", crates: 0, extra: 0, upc: 12, cost: 0 });
  render();
  ready = true;
  return {
    el: box,
    get: () => lines.filter((l) => l.product_id).map((l) => ({ product_id: Number(l.product_id), crates: Number(l.crates) || 0, units_per_crate: Number(l.upc) || 1, extra_units: Number(l.extra) || 0, ...(withCost ? { unit_cost: Number(l.cost) || 0 } : {}) })),
    qty: () => lines.filter((l) => l.product_id).reduce((s, l) => s + qtyOf(l), 0),
    total: () => lines.filter((l) => l.product_id).reduce((s, l) => s + qtyOf(l) * (Number(l.cost) || 0), 0),
  };
}

// ---------- Entrées ----------
export async function viewEntries(main) {
  const from = input("from", { type: "date" });
  const to = input("to", { type: "date" });
  const box = h("div", null, loader());
  const load = async () => {
    const rows = await GET(`/api/entries?${new URLSearchParams({ from: from.value, to: to.value })}`);
    box.replaceChildren(
      table(
        [
          { label: "Date", get: (e) => datetime(e.at) },
          { label: "Reçu", get: (e) => e.doc_no },
          { label: "Fournisseur", get: (e) => e.supplier || "—" },
          { label: "Bouteilles", r: true, get: (e) => num(e.qty) },
          { label: "Montant", r: true, get: (e) => money(e.total_amount) },
          { label: "Reste à payer", r: true, get: (e) => money(e.total_amount - e.paid_amount) },
          { label: "Par", get: (e) => e.user_name },
          { label: "", get: (e) => (e.status === "cancelled" ? chip("Annulée", "bad") : "") },
        ],
        rows,
        { onRow: (e) => go(`#/entrees/${e.id}`) },
      ),
    );
  };
  for (const el of [from, to]) el.addEventListener("change", () => load().catch(fail));
  main.replaceChildren(pageHead("Entrées de boissons", "Toutes les marchandises reçues au maquis.", isManager() ? [h("a", { class: "btn primary", href: "#/entrees/nouvelle" }, icon("plus"), "Nouvelle entrée")] : []), card(null, h("div", { class: "filters" }, field("Du", from), field("Au", to)), box));
  load().catch(fail);
}

export function viewEntryForm(main) {
  const total = h("b");
  const qtyEl = h("b");
  const lines = crateLines({ withCost: true, onChange: () => upd() });
  const paid = input("paid_amount", { type: "number", min: 0, value: 0, inputmode: "numeric" });
  const rest = h("b");
  const upd = () => {
    qtyEl.textContent = `${num(lines.qty())} bouteilles`;
    total.textContent = money(lines.total());
    rest.textContent = money(Math.max(0, lines.total() - (Number(paid.value) || 0)));
  };
  paid.addEventListener("input", upd);
  const form = h(
    "form",
    { class: "form", on: { submit: async (e) => {
      e.preventDefault();
      const d = formData(form);
      const body = { supplier_id: d.supplier_id || null, invoice_no: d.invoice_no, observation: d.observation, paid_amount: Number(d.paid_amount) || 0, payment_method: d.payment_method, lines: lines.get() };
      if (!body.lines.length) return toast("Ajoutez au moins une boisson.", "bad");
      const btn = form.querySelector("button[type=submit]");
      btn.disabled = true;
      try {
        const r = await POST("/api/entries", body, { offline: `Entrée de ${num(lines.qty())} bouteilles` });
        await refreshBoot().catch(() => {});
        if (r.queued) {
          toast("Pas de connexion : entrée enregistrée sur le téléphone, elle sera envoyée automatiquement.", "good");
          go("#/entrees");
        } else {
          toast(`Entrée ${r.doc_no} validée : stock augmenté de ${num(r.qty)} bouteilles.`, "good");
          go(`#/recus/${r.doc_no}`);
        }
      } catch (err) {
        fail(err);
      } finally {
        btn.disabled = false;
      }
    } } },
    h("div", { class: "row" }, field("Fournisseur", select("supplier_id", [{ value: "", label: "Non précisé" }, ...(S.boot.suppliers || []).map((s) => ({ value: s.id, label: s.name }))], "")), field("Numéro de facture", input("invoice_no"))),
    lines.el,
    h("div", { class: "card" }, h("div", { class: "totals" }, h("div", null, h("span", null, "Quantité totale reçue"), qtyEl), h("div", { class: "b" }, h("span", null, "Montant total"), total))),
    h("div", { class: "row" }, field("Montant payé maintenant", paid), field("Mode de paiement", select("payment_method", S.boot.settings.payment_methods, "Espèces"))),
    h("div", { class: "totals" }, h("div", null, h("span", null, "Reste à payer au fournisseur"), rest)),
    field("Observation", h("textarea", { name: "observation", rows: 2 })),
    h("button", { class: "btn primary lg", type: "submit" }, icon("check"), "Valider l'entrée"),
  );
  main.replaceChildren(pageHead("Nouvelle entrée de boissons", "Le stock augmente dès la validation ; un reçu est créé automatiquement.", [], "#/entrees"), card(null, form));
  upd();
}

export async function viewEntry(main, id) {
  main.replaceChildren(loader());
  const e = await GET(`/api/entries/${id}`);
  main.replaceChildren(
    pageHead(`Entrée ${e.doc_no}`, `${datetime(e.at)} · ${e.user_name}`, [], "#/entrees"),
    e.status === "cancelled" ? h("div", { class: "banner bad" }, icon("alert"), `Annulée le ${datetime(e.cancelled_at)} : ${e.cancel_reason}`) : null,
    card(
      null,
      h("div", { class: "kv" }, h("div", null, h("span", null, "Fournisseur"), h("b", null, e.supplier || "—")), h("div", null, h("span", null, "Facture"), h("b", null, e.invoice_no || "—")), h("div", null, h("span", null, "Montant"), h("b", null, money(e.total_amount))), h("div", null, h("span", null, "Payé"), h("b", null, money(e.paid_amount))), h("div", null, h("span", null, "Observation"), h("b", null, e.observation || "—"))),
      h("div", { class: "mt" }, table([{ label: "Boisson", get: (l) => `${productName(l)}` }, { label: "Casiers", r: true, get: (l) => num(l.crates) }, { label: "Btl/casier", r: true, get: (l) => l.units_per_crate }, { label: "Btl sup.", r: true, get: (l) => num(l.extra_units) }, { label: "Qté", r: true, get: (l) => h("b", null, num(l.qty)) }, { label: "Prix", r: true, get: (l) => money(l.unit_cost) }, { label: "Montant", r: true, get: (l) => money(l.line_total) }], e.lines)),
    ),
    docsCard(e.documents),
    isManager() && e.status === "valid" ? cancelButton(`/api/entries/${id}/cancel`, "Annuler cette entrée", "Le stock sera diminué d'autant et un document rectificatif sera créé. L'entrée d'origine reste visible.", () => viewEntry(main, id)) : null,
  );
}

function docsCard(docs) {
  return docs?.length ? card("Reçus et documents", h("div", { class: "list" }, docs.map((d) => h("a", { class: "item", href: `#/recus/${d.doc_no}` }, h("div", { class: `ic ${d.type === "cancellation" ? "bad" : "brand"}` }, icon("doc")), h("div", { class: "grow" }, h("div", { class: "t" }, d.title), h("div", { class: "d" }, `${d.doc_no} · ${datetime(d.at)}`)), d.amount !== null ? h("div", { class: "amt" }, money(d.amount)) : null)))) : null;
}

function cancelButton(url, label, text, done) {
  return h("div", { class: "mt" }, h("button", { class: "btn danger", on: { click: async () => {
    const reason = await confirmBox(label, text, { danger: true, ok: "Confirmer l'annulation", reason: "Motif de l'annulation (obligatoire)" });
    if (!reason) return;
    try {
      const r = await POST(url, { reason });
      toast(`Annulation enregistrée (${r.doc_no}).`, "good");
      await refreshBoot().catch(() => {});
      done();
    } catch (e) {
      fail(e);
    }
  } } }, icon("x"), label));
}

// ---------- Sorties (hors ventes) ----------
const EXIT_REASONS = [
  ["broken", "Cassée"],
  ["offered", "Offerte"],
  ["staff", "Consommée par le personnel"],
  ["lost", "Perdue"],
  ["expired", "Périmée"],
  ["other", "Autre sortie exceptionnelle"],
];

export async function viewExits(main) {
  const from = input("from", { type: "date" });
  const to = input("to", { type: "date" });
  const box = h("div", null, loader());
  const load = async () => {
    const rows = await GET(`/api/exits?${new URLSearchParams({ from: from.value, to: to.value })}`);
    box.replaceChildren(
      table(
        [
          { label: "Date", get: (x) => datetime(x.at) },
          { label: "Reçu", get: (x) => x.doc_no },
          { label: "Motif", get: (x) => reasonChip(x.reason, x.reason_label) },
          { label: "Bouteilles", r: true, get: (x) => num(x.qty) },
          { label: "Responsable", get: (x) => [x.responsible_name || x.user_name, x.waiter_name].filter(Boolean).join(" · ") },
          { label: "Observation", get: (x) => x.observation },
          { label: "", get: (x) => (x.status === "cancelled" ? chip("Annulée", "bad") : "") },
        ],
        rows,
        { onRow: (x) => go(`#/sorties/${x.id}`) },
      ),
    );
  };
  for (const el of [from, to]) el.addEventListener("change", () => load().catch(fail));
  main.replaceChildren(
    pageHead("Sorties de boissons", "Offertes, personnel, cassées, perdues, périmées… Les ventes sont enregistrées par la caisse et n'apparaissent pas ici en double.", isManager() ? [h("a", { class: "btn primary", href: "#/sorties/nouvelle" }, icon("plus"), "Nouvelle sortie"), h("a", { class: "btn", href: "#/mouvements" }, "Toutes les sorties (ventes comprises)")] : [h("a", { class: "btn", href: "#/mouvements" }, "Toutes les sorties (ventes comprises)")]),
    card(null, h("div", { class: "filters" }, field("Du", from), field("Au", to)), box),
  );
  load().catch(fail);
}

export function viewExitForm(main) {
  let reason = "broken";
  const reasonBox = h("div", { class: "tabs" });
  const renderReasons = () => reasonBox.replaceChildren(...EXIT_REASONS.map(([k, l]) => h("button", { type: "button", class: reason === k ? "on" : "", on: { click: () => ((reason = k), renderReasons()) } }, l)));
  renderReasons();
  const qtyEl = h("b");
  const lines = crateLines({ onChange: () => (qtyEl.textContent = `${num(lines.qty())} bouteilles`) });
  qtyEl.textContent = "0 bouteille";
  const form = h(
    "form",
    { class: "form", on: { submit: async (e) => {
      e.preventDefault();
      const d = formData(form);
      const body = { reason, lines: lines.get(), responsible_name: d.responsible_name, waiter_id: d.waiter_id || null, observation: d.observation };
      if (!body.lines.length) return toast("Ajoutez au moins une boisson.", "bad");
      try {
        const r = await POST("/api/exits", body, { offline: `Sortie (${EXIT_REASONS.find((x) => x[0] === reason)[1]}) de ${num(lines.qty())} bouteilles` });
        await refreshBoot().catch(() => {});
        if (r.queued) {
          toast("Pas de connexion : sortie enregistrée sur le téléphone, elle sera envoyée automatiquement.", "good");
          go("#/sorties");
        } else {
          toast(`Sortie ${r.doc_no} enregistrée.`, "good");
          go(`#/recus/${r.doc_no}`);
        }
      } catch (err) {
        fail(err);
      }
    } } },
    field("Motif de la sortie", reasonBox),
    lines.el,
    h("div", { class: "totals" }, h("div", { class: "b" }, h("span", null, "Quantité totale"), qtyEl)),
    h("div", { class: "row" }, field("Nom du responsable", input("responsible_name", { placeholder: "Qui a cassé, offert, consommé…" })), field("Serveur concerné", select("waiter_id", [{ value: "", label: "Aucun" }, ...(S.boot.waiters || []).map((w) => ({ value: w.id, label: w.full_name }))], ""))),
    field("Observation", h("textarea", { name: "observation", rows: 2 }), "Obligatoire pour une perte ou une autre sortie exceptionnelle."),
    h("button", { class: "btn primary lg", type: "submit" }, icon("check"), "Enregistrer la sortie"),
  );
  main.replaceChildren(pageHead("Nouvelle sortie de boissons", "Pour les ventes, utilisez la caisse : elles diminuent déjà le stock.", [], "#/sorties"), card(null, form));
}

export async function viewExit(main, id) {
  main.replaceChildren(loader());
  const x = await GET(`/api/exits/${id}`);
  main.replaceChildren(
    pageHead(`Sortie ${x.doc_no}`, `${datetime(x.at)} · ${x.user_name}`, [], "#/sorties"),
    x.status === "cancelled" ? h("div", { class: "banner bad" }, icon("alert"), `Annulée le ${datetime(x.cancelled_at)} : ${x.cancel_reason}`) : null,
    card(null, h("div", { class: "kv" }, h("div", null, h("span", null, "Motif"), h("b", null, x.reason_label)), h("div", null, h("span", null, "Responsable"), h("b", null, x.responsible_name || x.user_name)), h("div", null, h("span", null, "Serveur"), h("b", null, x.waiter_name || "—")), h("div", null, h("span", null, "Observation"), h("b", null, x.observation || "—"))), h("div", { class: "mt" }, table([{ label: "Boisson", get: (l) => `${productName(l)}` }, { label: "Casiers", r: true, get: (l) => num(l.crates) }, { label: "Btl", r: true, get: (l) => num(l.extra_units) }, { label: "Qté totale", r: true, get: (l) => h("b", null, num(l.qty)) }], x.lines))),
    docsCard(x.documents),
    isManager() && x.status === "valid" ? cancelButton(`/api/exits/${id}/cancel`, "Annuler cette sortie", "Les bouteilles seront remises en stock et un document rectificatif sera créé.", () => viewExit(main, id)) : null,
  );
}

// ---------- Inventaires ----------
export async function viewInventories(main) {
  main.replaceChildren(loader());
  const rows = await GET("/api/inventories");
  const kinds = { daily: "Quotidien", weekly: "Hebdomadaire", monthly: "Mensuel" };
  const draft = rows.find((r) => r.status === "draft");
  main.replaceChildren(
    pageHead("Inventaires physiques", "Comptez les bouteilles réellement présentes : chaque écart avec le stock informatique doit être justifié.", isManager() && !draft ? Object.entries(kinds).map(([k, l]) => h("button", { class: `btn ${k === "daily" ? "primary" : ""}`, on: { click: async () => {
      try {
        const inv = await POST("/api/inventories", { kind: k });
        go(`#/inventaires/${inv.id}`);
      } catch (e) {
        fail(e);
      }
    } } }, `Inventaire ${l.toLowerCase()}`)) : []),
    draft ? h("a", { class: "banner warn", href: `#/inventaires/${draft.id}` }, icon("clip"), "Un inventaire est en cours : continuez le comptage.") : null,
    card(null, table([{ label: "Date", get: (i) => datetime(i.started_at) }, { label: "Type", get: (i) => kinds[i.kind] }, { label: "Par", get: (i) => i.user_name }, { label: "Statut", get: (i) => chip({ draft: "En cours", validated: "Validé", abandoned: "Abandonné" }[i.status], i.status === "validated" ? "good" : i.status === "draft" ? "warn" : "") }, { label: "Écarts", r: true, get: (i) => (i.status === "validated" ? num(i.gaps) : "—") }, { label: "Rapport", get: (i) => i.doc_no || "" }], rows, { onRow: (i) => go(`#/inventaires/${i.id}`) })),
  );
}

export async function viewInventory(main, id) {
  main.replaceChildren(loader());
  const inv = await GET(`/api/inventories/${id}`);
  const editable = inv.status === "draft" && isManager();
  const state = new Map(inv.lines.map((l) => [l.product_id, { counted: l.counted, justification: l.justification }]));
  const rowsEl = inv.lines.map((l) => {
    const st = state.get(l.product_id);
    const diff = h("b");
    const just = input("j", { value: st.justification || "", placeholder: "Justification de l'écart", on: { input: (e) => (st.justification = e.target.value) } });
    const upd = () => {
      if (st.counted === null || st.counted === "") {
        diff.textContent = "—";
        diff.className = "muted";
      } else {
        const dv = Number(st.counted) - l.theoretical;
        diff.textContent = `${dv > 0 ? "+" : ""}${dv}`;
        diff.className = dv === 0 ? "good" : "bad";
      }
    };
    const cnt = input("c", { type: "number", min: 0, inputmode: "numeric", value: st.counted ?? "", style: { maxWidth: "110px" }, on: { input: (e) => ((st.counted = e.target.value === "" ? null : Number(e.target.value)), upd()) } });
    upd();
    return h("tr", null, h("td", null, h("b", null, `${productName(l)}`), h("div", { class: "small muted" }, l.category)), h("td", { class: "r" }, num(l.theoretical), h("div", { class: "small muted" }, crates(l.theoretical, l.units_per_crate, l.pack_label))), h("td", null, editable ? cnt : num(l.counted ?? 0)), h("td", { class: "r" }, editable ? diff : h("b", { class: l.difference ? "bad" : "good" }, l.difference ?? "—")), h("td", null, editable ? just : l.justification));
  });
  const payload = () => ({ lines: [...state].map(([product_id, s]) => ({ product_id, counted: s.counted, justification: s.justification || "" })) });
  main.replaceChildren(
    pageHead(`Inventaire du ${datetime(inv.started_at)}`, `${{ daily: "Quotidien", weekly: "Hebdomadaire", monthly: "Mensuel" }[inv.kind]} · ${inv.user_name}`, [], "#/inventaires"),
    editable ? h("div", { class: "banner info" }, icon("clip"), "Le stock informatique se met à jour en direct pendant le comptage (ventes en cours). Laissez vide une boisson non comptée.") : null,
    card(null, h("div", { class: "tablewrap" }, h("table", { class: "t" }, h("thead", null, h("tr", null, h("th", null, "Boisson"), h("th", { class: "r" }, "Stock informatique"), h("th", null, "Compté"), h("th", { class: "r" }, "Écart"), h("th", null, "Justification"))), h("tbody", null, rowsEl)))),
    editable
      ? h(
          "div",
          { class: "btnrow mt" },
          h("button", { class: "btn", on: { click: async () => {
            await api("PUT", `/api/inventories/${id}`, payload()).catch(fail);
            toast("Comptage enregistré.", "good");
          } } }, "Enregistrer le comptage"),
          h("button", { class: "btn primary", on: { click: async () => {
            try {
              await api("PUT", `/api/inventories/${id}`, payload());
              if (!(await confirmBox("Valider l'inventaire ?", "Le stock sera ajusté aux quantités comptées. Cette opération est définitive et tracée."))) return;
              const r = await POST(`/api/inventories/${id}/validate`);
              toast(`Inventaire validé : ${r.gaps} écart(s).`, "good");
              await refreshBoot().catch(() => {});
              go(`#/recus/${r.doc_no}`);
            } catch (e) {
              fail(e);
            }
          } } }, icon("check"), "Valider l'inventaire"),
          h("button", { class: "btn danger", on: { click: async () => {
            if (await confirmBox("Abandonner l'inventaire ?", "Aucun ajustement de stock ne sera fait.", { danger: true, ok: "Abandonner" })) {
              await POST(`/api/inventories/${id}/abandon`).catch(fail);
              go("#/inventaires");
            }
          } } }, "Abandonner"),
        )
      : inv.doc_no
        ? h("a", { class: "btn mt", href: `#/recus/${inv.doc_no}` }, icon("doc"), "Rapport d'inventaire")
        : null,
  );
}

// ---------- Fournisseurs et consignes ----------
export async function viewSuppliers(main) {
  main.replaceChildren(loader());
  const rows = await GET("/api/suppliers");
  const create = () => {
    const form = h("div", { class: "form" }, field("Nom", input("name", { required: true })), field("Téléphone", input("phone", { type: "tel" })), field("Adresse", input("address")), field("Notes", h("textarea", { name: "notes", rows: 2 })));
    modal("Nouveau fournisseur", form, [{ label: "Annuler", class: "ghost" }, { label: "Enregistrer", class: "primary", submit: true, onClick: async () => {
      await POST("/api/suppliers", formData(form.closest("form")));
      await refreshBoot();
      viewSuppliers(main);
    } }]);
  };
  main.replaceChildren(
    pageHead("Fournisseurs", `Dettes totales : ${money(rows.reduce((s, r) => s + Math.max(0, r.debt), 0))}`, isManager() ? [h("button", { class: "btn primary", on: { click: create } }, icon("plus"), "Nouveau fournisseur"), h("a", { class: "btn", href: "#/consignes" }, "Consignes")] : [h("a", { class: "btn", href: "#/consignes" }, "Consignes")]),
    card(null, table([{ label: "Fournisseur", get: (s) => h("div", null, h("b", null, s.name), h("div", { class: "small muted" }, s.phone)) }, { label: "Achats", r: true, get: (s) => money(s.purchases) }, { label: "Payé", r: true, get: (s) => money(s.paid) }, { label: "Dette", r: true, get: (s) => h("b", { class: s.debt > 0 ? "bad" : "good" }, money(s.debt)) }], rows, { onRow: (s) => go(`#/fournisseurs/${s.id}`) })),
  );
}

export async function viewSupplier(main, id) {
  main.replaceChildren(loader());
  const s = await GET(`/api/suppliers/${id}`);
  const pay = () => {
    const form = h("div", { class: "form" }, h("p", null, "Dette actuelle : ", h("b", null, money(s.debt))), field("Montant payé", input("amount", { type: "number", min: 1, max: s.debt, required: true, inputmode: "numeric" })), field("Mode de paiement", select("method", S.boot.settings.payment_methods, "Espèces")), field("Note", input("note")));
    modal(`Paiement à ${s.name}`, form, [{ label: "Annuler", class: "ghost" }, { label: "Enregistrer le paiement", class: "primary", submit: true, onClick: async () => {
      const r = await POST(`/api/suppliers/${id}/payments`, formData(form.closest("form")));
      toast(`Paiement ${r.doc_no} enregistré.`, "good");
      viewSupplier(main, id);
    } }]);
  };
  main.replaceChildren(
    pageHead(s.name, [s.phone, s.address].filter(Boolean).join(" · "), isManager() && s.debt > 0 ? [h("button", { class: "btn primary", on: { click: pay } }, icon("cash"), "Enregistrer un paiement")] : [], "#/fournisseurs"),
    h("div", { class: "stats mb" }, stat("Achats", money(s.purchases)), stat("Payé", money(s.paid)), stat("Dette", money(s.debt), null, s.debt > 0 ? "" : ""), stat("Factures", num(s.entries.length))),
    card("Historique des achats", table([{ label: "Date", get: (e) => datetime(e.at) }, { label: "Reçu", get: (e) => h("a", { href: `#/entrees/${e.id}` }, e.doc_no) }, { label: "Facture", get: (e) => e.invoice_no || "—" }, { label: "Montant", r: true, get: (e) => money(e.total_amount) }, { label: "Payé à la livraison", r: true, get: (e) => money(e.paid_amount) }, { label: "", get: (e) => (e.status === "cancelled" ? chip("Annulée", "bad") : "") }], s.entries)),
    card("Paiements", table([{ label: "Date", get: (p) => datetime(p.at) }, { label: "Reçu", get: (p) => h("a", { href: `#/recus/${p.doc_no}` }, p.doc_no) }, { label: "Mode", get: (p) => p.method }, { label: "Montant", r: true, get: (p) => money(p.amount) }, { label: "Par", get: (p) => p.user_name }], s.payments)),
  );
}

export async function viewConsignments(main) {
  main.replaceChildren(loader());
  const d = await GET("/api/consignments");
  const create = () => {
    let party = "supplier";
    const body = h("div", { class: "form" });
    const render = () => {
      body.replaceChildren(
        field("Concerne", select("party", [{ value: "supplier", label: "Un fournisseur" }, { value: "customer", label: "Un client" }], party, { on: { change: (e) => ((party = e.target.value), render()) } })),
        party === "supplier" ? field("Fournisseur", select("supplier_id", (S.boot.suppliers || []).map((s) => ({ value: s.id, label: s.name })), "")) : field("Nom du client", input("customer_name", { required: true })),
        field("Opération", select("kind", party === "supplier" ? [{ value: "paid", label: "Consigne versée au fournisseur" }, { value: "recovered", label: "Consigne récupérée (vides rendus)" }] : [{ value: "paid", label: "Consigne versée par le client" }, { value: "refunded", label: "Consigne remboursée au client" }], "paid")),
        h("div", { class: "row" }, field("Casiers", input("crates", { type: "number", min: 0, value: 0 })), field("Bouteilles", input("bottles", { type: "number", min: 0, value: 0 })), field("Montant (FCFA)", input("amount", { type: "number", min: 0, value: 0 }))),
        field("Note", input("note")),
      );
    };
    render();
    modal("Opération de consigne", body, [{ label: "Annuler", class: "ghost" }, { label: "Enregistrer", class: "primary", submit: true, onClick: async () => {
      const r = await POST("/api/consignments", formData(body.closest("form")));
      toast(`Consigne ${r.doc_no} enregistrée.`, "good");
      viewConsignments(main);
    } }]);
  };
  main.replaceChildren(
    pageHead("Consignes et casiers", "Bouteilles et casiers consignés, versés, récupérés et remboursés.", isManager() ? [h("button", { class: "btn primary", on: { click: create } }, icon("plus"), "Nouvelle opération")] : [], "#/fournisseurs"),
    h(
      "div",
      { class: "grid g2" },
      card("Chez les fournisseurs", table([{ label: "Fournisseur", get: (s) => s.name }, { label: "Casiers", r: true, get: (s) => num(s.crates) }, { label: "Bouteilles", r: true, get: (s) => num(s.bottles) }, { label: "Consigne versée", r: true, get: (s) => money(s.amount) }], d.suppliers)),
      card("Consignes des clients", table([{ label: "Client", get: (s) => s.customer_name }, { label: "Casiers", r: true, get: (s) => num(s.crates) }, { label: "Bouteilles", r: true, get: (s) => num(s.bottles) }, { label: "À rembourser", r: true, get: (s) => money(s.amount) }], d.customers)),
    ),
    card("Historique", table([{ label: "Date", get: (c) => datetime(c.at) }, { label: "Opération", get: (c) => c.label }, { label: "Pour", get: (c) => c.supplier || c.customer_name }, { label: "Casiers", r: true, get: (c) => num(c.crates) }, { label: "Btl", r: true, get: (c) => num(c.bottles) }, { label: "Montant", r: true, get: (c) => money(c.amount) }, { label: "Reçu", get: (c) => h("a", { href: `#/recus/${c.doc_no}` }, c.doc_no) }], d.history)),
  );
}

// ---------- Dépenses ----------
export async function viewExpenses(main) {
  const from = input("from", { type: "date", value: today() });
  const to = input("to", { type: "date", value: today() });
  const box = h("div", null, loader());
  const load = async () => {
    const rows = await GET(`/api/expenses?${new URLSearchParams({ from: from.value, to: to.value })}`);
    const valid = rows.filter((x) => x.status === "valid");
    box.replaceChildren(
      h("p", { class: "mb" }, "Total : ", h("b", null, money(valid.reduce((s, x) => s + x.amount, 0)))),
      table(
        [
          { label: "Date", get: (x) => datetime(x.at) },
          { label: "Catégorie", get: (x) => x.category },
          { label: "Description", get: (x) => x.description },
          { label: "Mode", get: (x) => `${x.method}${x.session_id ? "" : " (hors caisse)"}` },
          { label: "Par", get: (x) => x.user_name },
          { label: "Montant", r: true, get: (x) => money(x.amount) },
          { label: "", get: (x) => (x.status === "cancelled" ? chip("Annulée", "bad") : isManager() ? h("button", { class: "btn sm danger", on: { click: async (e) => {
            e.stopPropagation();
            const reason = await confirmBox("Annuler cette dépense ?", "Un document rectificatif sera créé.", { danger: true, reason: "Motif (obligatoire)" });
            if (reason) {
              await POST(`/api/expenses/${x.id}/cancel`, { reason }).then(() => load()).catch(fail);
            }
          } } }, "Annuler") : "") },
        ],
        rows,
        { onRow: (x) => go(`#/recus/${x.doc_no}`) },
      ),
    );
  };
  for (const el of [from, to]) el.addEventListener("change", () => load().catch(fail));
  main.replaceChildren(pageHead("Dépenses", null, S.user.role !== "owner" ? [h("button", { class: "btn primary", on: { click: () => expenseForm(() => load()) } }, icon("plus"), "Nouvelle dépense")] : []), card(null, h("div", { class: "filters" }, field("Du", from), field("Au", to)), box));
  load().catch(fail);
}

export function expenseForm(done) {
  const sessions = S.boot.open_sessions || [];
  const form = h(
    "div",
    { class: "form" },
    field("Catégorie", select("category", S.boot.settings.expense_categories, S.boot.settings.expense_categories[0])),
    field("Description", input("description", { required: true, minlength: 3, placeholder: "Ex. 2 sacs de glace" })),
    h("div", { class: "row" }, field("Montant (FCFA)", input("amount", { type: "number", min: 1, required: true, inputmode: "numeric" })), field("Mode de paiement", select("method", S.boot.settings.payment_methods, "Espèces"))),
    S.user.role === "manager" ? field("Payée depuis", select("session_id", [{ value: "", label: "Hors caisse (argent du gérant ou du propriétaire)" }, ...sessions.map((s) => ({ value: s.id, label: `Caisse de ${s.cashier}` }))], "")) : h("p", { class: "small muted" }, "La dépense est retirée de votre caisse ouverte."),
  );
  return modal("Nouvelle dépense", form, [{ label: "Annuler", class: "ghost" }, { label: "Enregistrer", class: "primary", submit: true, onClick: async () => {
    const d = formData(form.closest("form"));
    const r = await POST("/api/expenses", { ...d, session_id: d.session_id || null }, { offline: `Dépense de ${money(Number(d.amount) || 0)}` });
    toast(r.queued ? "Dépense enregistrée hors connexion : elle sera envoyée automatiquement." : `Dépense ${r.doc_no} enregistrée.`, "good");
    done?.();
  } }]);
}

// ---------- Caisses ----------
export async function viewCashSessions(main) {
  main.replaceChildren(loader());
  const rows = await GET("/api/cash/sessions");
  main.replaceChildren(
    pageHead("Caisses", "Ouvertures, fermetures, soldes théoriques, montants comptés et écarts."),
    card(
      null,
      table(
        [
          { label: "Caissier", get: (s) => h("div", null, h("b", null, s.cashier_name), h("div", { class: "small muted" }, `journée du ${dayShort(s.business_day)}`)) },
          { label: "Ouverture", get: (s) => datetime(s.opened_at) },
          { label: "Fermeture", get: (s) => (s.closed_at ? datetime(s.closed_at) : chip("Ouverte", "warn")) },
          { label: "Ventes", r: true, get: (s) => money(s.sales.amount) },
          { label: "Encaissé", r: true, get: (s) => money(s.totals.collected) },
          { label: "Théorique", r: true, get: (s) => money(s.totals.theoretical) },
          { label: "Compté", r: true, get: (s) => (s.totals.counted === null ? "—" : money(s.totals.counted)) },
          { label: "Écart", r: true, get: (s) => (s.totals.variance === null ? "—" : h("b", { class: s.totals.variance < 0 ? "bad" : s.totals.variance > 0 ? "warn" : "good" }, money(s.totals.variance))) },
        ],
        rows,
        { onRow: (s) => go(`#/caisses/${s.id}`) },
      ),
    ),
  );
}

export function cashSummaryCard(s) {
  return card(
    "Situation de la caisse",
    table(
      [
        { label: "Mode", get: (m) => h("b", null, m.method) },
        { label: "Fonds", r: true, get: (m) => num(m.opening) },
        { label: "Encaissé", r: true, get: (m) => num(m.collected) },
        { label: "Ajouts", r: true, get: (m) => num(m.deposits) },
        { label: "Dépenses", r: true, get: (m) => num(m.expenses) },
        { label: "Retraits", r: true, get: (m) => num(m.withdrawals) },
        { label: "Rembours.", r: true, get: (m) => num(m.refunds) },
        { label: "Théorique", r: true, get: (m) => h("b", null, num(m.theoretical)) },
        ...(s.status === "closed" ? [{ label: "Compté", r: true, get: (m) => num(m.counted ?? 0) }, { label: "Écart", r: true, get: (m) => h("b", { class: (m.variance || 0) < 0 ? "bad" : (m.variance || 0) > 0 ? "warn" : "good" }, num(m.variance || 0)) }] : []),
      ],
      s.methods.filter((m) => m.theoretical || m.collected || m.expenses || m.deposits || m.withdrawals || m.refunds || m.opening || m.counted),
      { foot: ["Total", num(s.totals.opening), num(s.totals.collected), num(s.totals.deposits), num(s.totals.expenses), num(s.totals.withdrawals), num(s.totals.refunds), num(s.totals.theoretical), ...(s.status === "closed" ? [num(s.totals.counted), num(s.totals.variance)] : [])] },
    ),
    h("p", { class: "small muted mt" }, "Solde théorique = fonds initial + encaissements + ajouts − dépenses − retraits − remboursements. Une vente à crédit n'est comptée qu'une fois payée."),
    h("div", { class: "kv mt" }, h("div", null, h("span", null, "Ventes de la session"), h("b", null, `${num(s.sales.count)} · ${money(s.sales.amount)}`)), h("div", null, h("span", null, "Crédits accordés"), h("b", null, money(s.sales.credit_given))), h("div", null, h("span", null, "Ventes annulées"), h("b", null, num(s.sales.cancelled)))),
  );
}

export async function viewCashSession(main, id) {
  main.replaceChildren(loader());
  const s = await GET(`/api/cash/sessions/${id}`);
  const actions = [];
  if (isManager() && s.status === "open") {
    actions.push(
      h("button", { class: "btn", on: { click: () => movementForm(s.id, () => viewCashSession(main, id)) } }, "Retrait / ajout"),
      h("button", { class: "btn danger", on: { click: () => closeForm(s, () => viewCashSession(main, id)) } }, "Fermer cette caisse"),
    );
  }
  main.replaceChildren(
    pageHead(`Caisse de ${s.cashier_name}`, `Ouverte le ${datetime(s.opened_at)}${s.closed_at ? ` · fermée le ${datetime(s.closed_at)}` : ""}`, actions, "#/caisses"),
    cashSummaryCard(s),
    card("Encaissements", table([{ label: "Heure", get: (p) => datetime(p.at) }, { label: "Vente", get: (p) => h("a", { href: `#/recus/${p.doc_no || p.sale_doc}` }, p.sale_doc) }, { label: "Type", get: (p) => (p.kind === "credit" ? chip("Règlement de crédit", "warn") : "Vente") }, { label: "Mode", get: (p) => p.method }, { label: "Montant", r: true, get: (p) => money(p.amount) }], s.payments)),
    h("div", { class: "grid g2" }, card("Ajouts, retraits, remboursements", table([{ label: "Heure", get: (m) => datetime(m.at) }, { label: "Opération", get: (m) => m.label }, { label: "Motif", get: (m) => m.reason }, { label: "Montant", r: true, get: (m) => money(m.amount) }], s.movements, { onRow: (m) => go(`#/recus/${m.doc_no}`) })), card("Dépenses", table([{ label: "Heure", get: (x) => datetime(x.at) }, { label: "Catégorie", get: (x) => x.category }, { label: "Montant", r: true, get: (x) => money(x.amount) }], s.expenses, { onRow: (x) => go(`#/recus/${x.doc_no}`) }))),
    docsCard(s.documents),
  );
}

export function movementForm(sessionId, done) {
  const form = h(
    "div",
    { class: "form" },
    field("Opération", select("kind", [{ value: "withdrawal", label: "Retrait d'argent" }, { value: "deposit", label: "Ajout d'argent" }, { value: "refund", label: "Remboursement à un client" }], "withdrawal")),
    h("div", { class: "row" }, field("Montant (FCFA)", input("amount", { type: "number", min: 1, required: true, inputmode: "numeric" })), field("Mode", select("method", S.boot.settings.payment_methods, "Espèces"))),
    field("Motif", input("reason", { required: true, minlength: 3, placeholder: "Ex. Remis au gérant" })),
  );
  return modal("Mouvement de caisse", form, [{ label: "Annuler", class: "ghost" }, { label: "Enregistrer", class: "primary", submit: true, onClick: async () => {
    const d = formData(form.closest("form"));
    const r = await POST("/api/cash/movements", { ...d, session_id: sessionId }, { offline: `${d.kind === "deposit" ? "Ajout" : d.kind === "refund" ? "Remboursement" : "Retrait"} de ${money(Number(d.amount) || 0)}` });
    toast(r.queued ? "Enregistré hors connexion : sera envoyé automatiquement." : `Reçu ${r.doc_no} créé.`, "good");
    done?.();
  } }]);
}

export function closeForm(s, done) {
  const methods = s.methods.filter((m) => m.theoretical || m.collected || m.method === "Espèces");
  const form = h(
    "div",
    { class: "form" },
    h("p", { class: "text-2" }, "Comptez l'argent réellement présent pour chaque mode de paiement (espèces dans le tiroir, soldes Orange Money / Moov Money…)."),
    methods.map((m) => field(`${m.method} — théorique ${money(m.theoretical)}`, input(`m_${m.method}`, { type: "number", min: 0, required: true, inputmode: "numeric", "data-method": m.method }))),
    field("Observation", input("note")),
  );
  return modal("Fermer la caisse", form, [{ label: "Annuler", class: "ghost" }, { label: "Fermer la caisse", class: "danger fill", submit: true, onClick: async () => {
    const counted = {};
    for (const el of form.querySelectorAll("[data-method]")) counted[el.dataset.method] = Number(el.value);
    const r = await POST("/api/cash/close", { session_id: s.id, counted, note: form.querySelector("[name=note]").value });
    toast(r.variance === 0 ? "Caisse fermée : caisse juste." : `Caisse fermée : écart de ${money(r.variance)}.`, r.variance === 0 ? "good" : "bad");
    done?.(r);
  } }]);
}

// ---------- Ventes et commandes ----------
export async function viewSales(main) {
  const from = input("from", { type: "date", value: today() });
  const to = input("to", { type: "date", value: today() });
  const status = select("status", [{ value: "", label: "Toutes" }, { value: "paid", label: "Payées" }, { value: "partial", label: "Paiement partiel" }, { value: "credit", label: "À crédit" }, { value: "cancelled", label: "Annulées" }], "");
  const box = h("div", null, loader());
  const load = async () => {
    const rows = await GET(`/api/sales?${new URLSearchParams({ from: from.value, to: to.value, status: status.value })}`);
    const ok = rows.filter((s) => s.status !== "cancelled");
    box.replaceChildren(
      h("p", { class: "mb" }, `${ok.length} vente(s) · `, h("b", null, money(ok.reduce((s, x) => s + x.total, 0))), ` · ${num(ok.reduce((s, x) => s + (x.bottles || 0), 0))} bouteilles`),
      table(
        [
          { label: "Heure", get: (s) => datetime(s.at) },
          { label: "Reçu", get: (s) => s.doc_no },
          { label: "Serveur", get: (s) => s.waiter_name || "Comptoir" },
          { label: "Caissier", get: (s) => s.cashier_name },
          { label: "Btl", r: true, get: (s) => num(s.bottles) },
          { label: "Total", r: true, get: (s) => money(s.total) },
          { label: "Statut", get: (s) => chip(s.status_label, s.status === "paid" ? "good" : s.status === "cancelled" ? "bad" : "warn") },
        ],
        rows,
        { onRow: (s) => go(`#/ventes/${s.id}`) },
      ),
    );
  };
  for (const el of [from, to, status]) el.addEventListener("change", () => load().catch(fail));
  main.replaceChildren(pageHead("Ventes", null), card(null, h("div", { class: "filters" }, field("Du", from), field("Au", to), field("Statut", status)), box));
  load().catch(fail);
}

export async function viewSale(main, id) {
  main.replaceChildren(loader());
  const s = await GET(`/api/sales/${id}`);
  const canCancel = s.status !== "cancelled" && (S.user.role === "manager" || S.user.role === "cashier");
  main.replaceChildren(
    pageHead(`Vente ${s.doc_no}`, `${datetime(s.at)} · ${s.status_label}`, [], S.user.role === "waiter" ? "#/mes-commandes" : "#/ventes"),
    s.status === "cancelled" ? h("div", { class: "banner bad" }, icon("alert"), `Annulée le ${datetime(s.cancelled_at)} : ${s.cancel_reason}`) : null,
    h("div", { class: "btnrow mb" }, docActions(s.doc_no, `${s.doc_no}.pdf`, `${S.boot.settings.maquis_name} — Reçu de vente ${s.doc_no} : ${money(s.total)}`, `Reçu ${s.doc_no}`)),
    card(
      null,
      h("div", { class: "kv" }, h("div", null, h("span", null, "Caissier"), h("b", null, s.cashier_name)), h("div", null, h("span", null, "Serveur"), h("b", null, s.waiter_name || "Comptoir")), h("div", null, h("span", null, "Commande"), h("b", null, s.order_no ? `${s.order_no} ${s.table_label || ""}` : "—")), h("div", null, h("span", null, "Client"), h("b", null, s.customer_name || "—"))),
      h("div", { class: "mt" }, table([{ label: "Boisson", get: (l) => `${productName(l)}` }, { label: "Qté", r: true, get: (l) => num(l.qty) }, { label: "Prix", r: true, get: (l) => money(l.unit_price) }, { label: "Montant", r: true, get: (l) => money(l.line_total) }], s.lines, { foot: ["Total", num(s.lines.reduce((a, l) => a + l.qty, 0)), "", money(s.total)] })),
      h("div", { class: "totals" }, h("div", null, h("span", null, "Payé"), h("b", null, money(s.paid))), h("div", { class: "b" }, h("span", null, "Reste à payer"), h("span", null, money(s.remaining)))),
    ),
    card("Paiements", table([{ label: "Date", get: (p) => datetime(p.at) }, { label: "Mode", get: (p) => p.method }, { label: "Type", get: (p) => (p.kind === "credit" ? "Règlement de crédit" : "À la vente") }, { label: "Montant", r: true, get: (p) => money(p.amount) }, { label: "Reçu", get: (p) => (p.doc_no ? h("a", { href: `#/recus/${p.doc_no}` }, p.doc_no) : "") }], s.payments)),
    docsCard(s.documents),
    canCancel ? cancelButton(`/api/sales/${id}/cancel`, "Annuler cette vente", "Les bouteilles seront remises en stock. Si de l'argent a été encaissé, un remboursement sera enregistré dans une caisse ouverte. Un document rectificatif sera créé.", () => viewSale(main, id)) : null,
  );
}

export async function viewOrdersAll(main) {
  main.replaceChildren(loader());
  const rows = await GET(`/api/orders?day=${today()}`);
  main.replaceChildren(
    pageHead("Commandes des serveurs", "Journée commerciale en cours."),
    card(null, table([{ label: "Heure", get: (o) => datetime(o.at) }, { label: "N°", get: (o) => o.order_no }, { label: "Serveur", get: (o) => o.waiter_name }, { label: "Table", get: (o) => o.table_label || "—" }, { label: "Boissons", get: (o) => o.lines.map((l) => `${l.qty} ${l.brand}`).join(", ") }, { label: "Total", r: true, get: (o) => money(o.total) }, { label: "Statut", get: (o) => chip(o.status_label, o.status === "served" ? "good" : o.status === "pending" ? "warn" : "bad") }], rows, { onRow: (o) => o.sale_id && go(`#/ventes/${o.sale_id}`) })),
  );
}
