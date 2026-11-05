// Écrans des serveurs (commandes) et des caissiers (caisse, encaissements, crédits).
import {
  S, h, icon, api, GET, POST, toast, fail, modal, confirmBox, field, input, select, formData, pageHead, card, stat, empty, loader, chip, table,
  money, num, datetime, timeOf, go, today, productName, photo, stepper, on,
} from "./core.js";
import { cashSummaryCard, closeForm, movementForm, expenseForm } from "./views-manager.js";

// ---------- Sélection des boissons (grille avec photos) ----------
export function productPicker({ onChange = () => {}, showStock = true } = {}) {
  const cart = new Map();
  let cat = "";
  const q = input("q", { type: "search", placeholder: "Rechercher une boisson" });
  const tabs = h("div", { class: "tabs" });
  const grid = h("div", { class: "pgrid" });
  const list = (S.boot.products || []).filter((p) => p.active);
  const render = () => {
    const term = q.value.trim().toLowerCase();
    const catsInUse = [...new Set(list.map((p) => p.category))];
    tabs.replaceChildren(...["", ...catsInUse].map((c) => h("button", { type: "button", class: cat === c ? "on" : "", on: { click: () => ((cat = c), render()) } }, c || "Toutes")));
    grid.replaceChildren(
      ...list
        .filter((p) => (!cat || p.category === cat) && (!term || `${productName(p)}`.toLowerCase().includes(term)))
        .map((p) => {
          const qty = cart.get(p.id) || 0;
          return h(
            "button",
            { type: "button", class: `ptile ${qty ? "sel" : ""} ${p.stock <= 0 ? "out" : ""}`, on: { click: () => {
              if (p.stock <= qty && S.online) return toast(`Plus de ${p.brand} en stock.`, "bad");
              cart.set(p.id, qty + 1);
              render();
              onChange();
            } } },
            h("div", { class: "ph" }, photo(p)),
            h("div", { class: "pb" }, h("div", { class: "pn" }, `${productName(p)}`), h("div", { class: "pp" }, money(p.sale_price)), showStock ? h("div", { class: "ps" }, p.stock <= 0 ? "Rupture" : `Stock : ${num(p.stock)}`) : null),
            qty ? h("span", { class: "qbadge" }, qty) : null,
          );
        }),
    );
    if (!grid.children.length) grid.append(empty("Aucune boisson.", "bottle"));
  };
  q.addEventListener("input", render);
  render();
  const lines = () => [...cart].filter(([, q2]) => q2 > 0).map(([product_id, qty]) => ({ product_id, qty }));
  const total = () => lines().reduce((s, l) => s + l.qty * (list.find((p) => p.id === l.product_id)?.sale_price || 0), 0);
  const summary = () =>
    lines().length
      ? h(
          "div",
          { class: "list" },
          lines().map((l) => {
            const p = list.find((x) => x.id === l.product_id);
            return h("div", { class: "item" }, h("div", { class: "grow" }, h("div", { class: "t" }, productName(p)), h("div", { class: "d" }, `${money(p.sale_price)} × ${l.qty} = ${money(p.sale_price * l.qty)}`)), stepper(l.qty, (v) => {
              if (v <= 0) cart.delete(p.id);
              else cart.set(p.id, v);
              render();
              onChange();
            }));
          }),
        )
      : h("p", { class: "muted" }, "Touchez les boissons pour les ajouter.");
  return {
    el: h("div", null, h("div", { class: "search mb" }, icon("search"), q), tabs, grid),
    lines,
    total,
    count: () => lines().reduce((s, l) => s + l.qty, 0),
    summary,
    clear: () => (cart.clear(), render(), onChange()),
  };
}

// ---------- Serveur : nouvelle commande ----------
export function viewOrder(main) {
  const sumBox = h("div");
  const bar = h("div", { class: "cartbar hidden" });
  const update = () => {
    sumBox.replaceChildren(picker.summary());
    const n = picker.count();
    bar.classList.toggle("hidden", !n);
    bar.replaceChildren(h("div", { class: "grow" }, h("div", { class: "small", style: { opacity: 0.8 } }, `${n} bouteille(s)`), h("b", null, money(picker.total()))), h("button", { class: "btn primary", on: { click: send } }, icon("check"), "Envoyer au caissier"));
  };
  const picker = productPicker({ onChange: update });
  const table_label = input("table_label", { placeholder: "Ex. Table 4, Terrasse…" });
  const customer = input("customer_name", { placeholder: "Facultatif" });
  const note = input("note", { placeholder: "Ex. bien fraîche" });
  async function send() {
    const lines = picker.lines();
    if (!lines.length) return;
    try {
      const r = await POST("/api/orders", { lines, table_label: table_label.value, customer_name: customer.value, note: note.value }, { offline: `Commande ${table_label.value || ""} (${picker.count()} bouteilles)` });
      toast(r.queued ? "Pas de connexion : commande gardée sur le téléphone, envoyée dès le retour du réseau." : `Commande ${r.order_no} envoyée au caissier.`, "good");
      picker.clear();
      table_label.value = customer.value = note.value = "";
    } catch (e) {
      fail(e);
    }
  }
  main.replaceChildren(
    pageHead("Nouvelle commande", "Choisissez les boissons, puis envoyez la commande au caissier."),
    card(null, h("div", { class: "form" }, h("div", { class: "row" }, field("Table", table_label), field("Client", customer), field("Note", note)))),
    card(null, picker.el),
    card("Commande", sumBox),
    bar,
  );
  update();
}

export async function viewMyOrders(main) {
  main.replaceChildren(loader());
  const rows = await GET(`/api/orders?day=${today()}`);
  const off = on((t) => t === "orders" && location.hash.startsWith("#/mes-commandes") && viewMyOrders(main));
  setTimeout(() => window.addEventListener("hashchange", off, { once: true }));
  main.replaceChildren(
    pageHead("Mes commandes", "Journée en cours", [h("a", { class: "btn primary", href: "#/commander" }, icon("plus"), "Nouvelle commande")]),
    rows.length
      ? h("div", { class: "grid g2" }, rows.map((o) => card(h("div", { class: "cardhead" }, h("h3", null, `${o.order_no}${o.table_label ? ` · ${o.table_label}` : ""}`), chip(o.status_label, o.status === "served" ? "good" : o.status === "pending" ? "warn" : "bad")), h("p", { class: "small muted" }, timeOf(o.at)), h("div", { class: "list" }, o.lines.map((l) => h("div", { class: "item" }, h("div", { class: "grow" }, `${l.qty} × ${productName(l)}`), h("div", { class: "amt" }, money(l.qty * l.unit_price))))), h("div", { class: "totals" }, h("div", { class: "b" }, h("span", null, "Total"), h("span", null, money(o.total)))), o.status_reason ? h("p", { class: "small bad" }, o.status_reason) : null, h("div", { class: "btnrow mt" }, o.status === "pending" ? h("button", { class: "btn sm danger", on: { click: async () => {
          if (await confirmBox("Annuler la commande ?", "Elle n'a pas encore été encaissée.", { danger: true, ok: "Annuler la commande" })) {
            await POST(`/api/orders/${o.id}/cancel`, {}).catch(fail);
            viewMyOrders(main);
          }
        } } }, "Annuler") : null, o.sale_id ? h("a", { class: "btn sm", href: `#/ventes/${o.sale_id}` }, icon("doc"), "Reçu") : null))))
      : card(null, empty("Aucune commande aujourd'hui.", "cart")),
  );
}

export async function viewMyStats(main) {
  main.replaceChildren(loader());
  const d = await GET("/api/my-stats");
  main.replaceChildren(
    pageHead("Mes ventes", "Journée commerciale en cours (depuis 03 h 00)"),
    h("div", { class: "stats" }, stat("Montant vendu", money(d.amount), null, "hero"), stat("Bouteilles", num(d.bottles)), stat("Ventes encaissées", num(d.sales)), stat("Commandes en attente", num(d.orders.pending || 0))),
    card("Par boisson", table([{ label: "Boisson", get: (x) => `${productName(x)}` }, { label: "Bouteilles", r: true, get: (x) => num(x.qty) }], d.by_product)),
  );
}

// ---------- Caissier : paiement ----------
// Retourne { payments, customer_name, customer_phone } ou null.
export function paymentDialog(total, { customer = "" } = {}) {
  const methods = S.boot.settings.payment_methods;
  const rows = [{ method: "Espèces", amount: total }];
  const body = h("div", { class: "form" });
  const received = input("received", { type: "number", min: 0, inputmode: "numeric", placeholder: "Montant donné par le client" });
  const changeEl = h("b");
  const custName = input("customer_name", { value: customer, placeholder: "Obligatoire si tout n'est pas payé" });
  const custPhone = input("customer_phone", { type: "tel" });
  const paidSum = () => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const statusEl = h("div", { class: "totals" });
  const update = () => {
    const paid = paidSum();
    const rest = total - paid;
    statusEl.replaceChildren(h("div", { class: "b" }, h("span", null, "Total à payer"), h("span", null, money(total))), h("div", null, h("span", null, "Encaissé maintenant"), h("b", null, money(paid))), h("div", { class: rest > 0 ? "b" : "" }, h("span", null, rest > 0 ? "Reste (crédit)" : rest < 0 ? "Trop saisi" : "Reste"), h("b", { class: rest > 0 ? "warn" : rest < 0 ? "bad" : "good" }, money(rest))));
    const cash = rows.filter((r) => r.method === "Espèces").reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const rec = Number(received.value) || 0;
    changeEl.textContent = rec ? (rec >= cash ? `Monnaie à rendre : ${money(rec - cash)}` : `Il manque ${money(cash - rec)}`) : "";
  };
  const render = () => {
    body.replaceChildren(
      h("div", { class: "tabs" }, h("button", { type: "button", on: { click: () => ((rows.length = 0), rows.push({ method: "Espèces", amount: total }), render()) } }, "Tout en espèces"), ...methods.filter((m) => m !== "Espèces").map((m) => h("button", { type: "button", on: { click: () => ((rows.length = 0), rows.push({ method: m, amount: total }), render()) } }, `Tout en ${m}`)), h("button", { type: "button", on: { click: () => ((rows.length = 0), render()) } }, "Crédit (rien payé)")),
      ...rows.map((r, i) => h("div", { class: "row", style: { display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "8px", alignItems: "end" } }, field("Mode", select("m", methods, r.method, { on: { change: (e) => ((r.method = e.target.value), update()) } })), field("Montant", input("a", { type: "number", min: 0, inputmode: "numeric", value: r.amount, on: { input: (e) => ((r.amount = e.target.value), update()) } })), h("button", { type: "button", class: "btn ghost", "aria-label": "Retirer", on: { click: () => (rows.splice(i, 1), render()) } }, icon("x")))),
      h("button", { type: "button", class: "btn sm", on: { click: () => (rows.push({ method: methods.find((m) => !rows.some((r) => r.method === m)) || "Espèces", amount: Math.max(0, total - paidSum()) }), render()) } }, icon("plus"), "Autre mode de paiement (paiement mixte)"),
      field("Espèces reçues (pour calculer la monnaie)", received),
      changeEl,
      statusEl,
      h("div", { class: "row" }, field("Nom du client", custName), field("Téléphone du client", custPhone)),
    );
    update();
  };
  received.addEventListener("input", update);
  render();
  return modal(`Encaisser ${money(total)}`, body, [
    { label: "Annuler", class: "ghost" },
    { label: "Valider la vente", class: "primary", submit: true, onClick: () => {
      const paid = paidSum();
      if (paid > total) return toast("Le montant saisi dépasse le total : saisissez le montant exact et rendez la monnaie.", "bad"), false;
      if (paid < total && !custName.value.trim()) return toast("Indiquez le nom du client pour une vente à crédit ou un paiement partiel.", "bad"), false;
      return { payments: rows.filter((r) => Number(r.amount) > 0).map((r) => ({ method: r.method, amount: Number(r.amount) })), customer_name: custName.value.trim(), customer_phone: custPhone.value.trim() };
    } },
  ]);
}

async function saleDone(r) {
  if (r.queued) return toast("Pas de connexion : vente gardée sur le téléphone, elle sera envoyée automatiquement (reçu disponible ensuite).", "good");
  await modal("Vente enregistrée", h("div", null, h("p", null, `Reçu ${r.doc_no} — ${money(r.total)}`), r.remaining ? h("p", { class: "warn" }, `Reste à payer : ${money(r.remaining)}`) : h("p", { class: "good" }, "Payée intégralement.")), [
    { label: "Fermer", class: "ghost" },
    { label: "Imprimer", onClick: () => window.open(`/api/documents/${r.doc_no}/print`, "_blank") },
    { label: "Voir le reçu", class: "primary", onClick: () => go(`#/recus/${r.doc_no}`) },
  ]);
}

async function refreshSession() {
  S.boot = await GET("/api/bootstrap");
}

// ---------- Caissier : ma caisse ----------
export async function viewCash(main) {
  main.replaceChildren(loader());
  const { session } = await GET("/api/cash/current");
  if (!session) {
    const float = input("opening_float", { type: "number", min: 0, inputmode: "numeric", value: 0, required: true });
    const form = h(
      "form",
      { class: "form", on: { submit: async (e) => {
        e.preventDefault();
        try {
          await POST("/api/cash/open", { opening_float: Number(float.value) || 0 });
          toast("Caisse ouverte.", "good");
          await refreshSession();
          viewCash(main);
        } catch (err) {
          fail(err);
        }
      } } },
      field("Fonds de caisse initial (espèces dans le tiroir)", float, "Comptez la monnaie présente avant le premier client."),
      h("button", { class: "btn primary lg", type: "submit" }, icon("cash"), "Ouvrir ma caisse"),
    );
    return main.replaceChildren(pageHead("Ma caisse", "Votre caisse est fermée."), card(null, form));
  }
  const pending = await GET("/api/orders?status=pending").catch(() => []);
  main.replaceChildren(
    pageHead("Ma caisse", `Ouverte le ${datetime(session.opened_at)}`, [h("a", { class: "btn", href: `#/caisses/${session.id}` }, icon("doc"), "Rapport de caisse")]),
    h("div", { class: "stats" }, stat("Solde théorique", money(session.totals.theoretical), "toutes méthodes", "hero"), stat("Espèces attendues", money(session.methods.find((m) => m.method === "Espèces")?.theoretical || 0)), stat("Ventes", money(session.sales.amount), `${num(session.sales.count)} vente(s)`), stat("Crédits accordés", money(session.sales.credit_given))),
    h(
      "div",
      { class: "grid g3 mt" },
      h("a", { class: "btn lg primary", href: "#/commandes" }, icon("list"), `Commandes en attente (${pending.length})`),
      h("a", { class: "btn lg", href: "#/vente" }, icon("cart"), "Vente directe"),
      h("a", { class: "btn lg", href: "#/credits" }, icon("credit"), "Crédits clients"),
      h("button", { class: "btn lg", on: { click: () => expenseForm(() => viewCash(main)) } }, icon("out"), "Dépense"),
      h("button", { class: "btn lg", on: { click: () => movementForm(null, () => viewCash(main)) } }, icon("cash"), "Ajout / retrait / remboursement"),
      h("button", { class: "btn lg danger", on: { click: () => closeForm(session, async (r) => {
        await refreshSession();
        go(`#/recus/${r.doc_no}`);
      }) } }, icon("logout"), "Fermer ma caisse"),
    ),
    h("div", { class: "mt" }, cashSummaryCard(session)),
  );
}

export async function viewPending(main) {
  main.replaceChildren(loader());
  const rows = await GET("/api/orders?status=pending");
  const off = on((t) => t === "orders" && location.hash === "#/commandes" && viewPending(main));
  setTimeout(() => window.addEventListener("hashchange", off, { once: true }));
  main.replaceChildren(
    pageHead("Commandes à encaisser", "Envoyées par les serveurs. Encaisser une commande sort les boissons du stock.", [h("a", { class: "btn", href: "#/vente" }, icon("cart"), "Vente directe")]),
    rows.length
      ? h(
          "div",
          { class: "grid g2" },
          rows.map((o) =>
            card(
              h("div", { class: "cardhead" }, h("h3", null, `${o.order_no}${o.table_label ? ` · ${o.table_label}` : ""}`), chip(`${o.waiter_name} · ${timeOf(o.at)}`, "brand")),
              h("div", { class: "list" }, o.lines.map((l) => h("div", { class: "item" }, h("div", { class: "grow" }, `${l.qty} × ${productName(l)}`), h("div", { class: "amt" }, money(l.qty * l.unit_price))))),
              o.note ? h("p", { class: "small muted" }, o.note) : null,
              h("div", { class: "totals" }, h("div", { class: "b" }, h("span", null, "Total"), h("span", null, money(o.total)))),
              h(
                "div",
                { class: "btnrow mt" },
                h("button", { class: "btn primary", on: { click: async () => {
                  const pay = await paymentDialog(o.total, { customer: o.customer_name });
                  if (!pay) return;
                  try {
                    const r = await POST("/api/sales", { order_id: o.id, ...pay }, { offline: `Encaissement ${o.order_no} (${money(o.total)})` });
                    await refreshSession().catch(() => {});
                    await saleDone(r);
                    viewPending(main);
                  } catch (e) {
                    fail(e);
                  }
                } } }, icon("cash"), "Encaisser"),
                h("button", { class: "btn danger", on: { click: async () => {
                  const reason = await confirmBox("Refuser la commande ?", "Le serveur sera prévenu.", { danger: true, ok: "Refuser", reason: "Motif (ex. rupture de stock)" });
                  if (reason) await POST(`/api/orders/${o.id}/cancel`, { reason }).then(() => viewPending(main)).catch(fail);
                } } }, "Refuser"),
              ),
            ),
          ),
        )
      : card(null, empty("Aucune commande en attente.", "check")),
  );
}

export function viewDirectSale(main) {
  const sumBox = h("div");
  const bar = h("div", { class: "cartbar hidden" });
  const update = () => {
    sumBox.replaceChildren(picker.summary());
    const n = picker.count();
    bar.classList.toggle("hidden", !n);
    bar.replaceChildren(h("div", { class: "grow" }, h("div", { class: "small", style: { opacity: 0.8 } }, `${n} bouteille(s)`), h("b", null, money(picker.total()))), h("button", { class: "btn primary", on: { click: sell } }, icon("cash"), "Encaisser"));
  };
  const picker = productPicker({ onChange: update });
  const waiter = select("waiter_id", [{ value: "", label: "Vente au comptoir (sans serveur)" }, ...(S.boot.waiters || []).map((w) => ({ value: w.id, label: w.full_name }))], "");
  async function sell() {
    const total = picker.total();
    const pay = await paymentDialog(total);
    if (!pay) return;
    try {
      const r = await POST("/api/sales", { lines: picker.lines(), waiter_id: waiter.value || null, ...pay }, { offline: `Vente directe (${money(total)})` });
      picker.clear();
      await refreshSession().catch(() => {});
      await saleDone(r);
    } catch (e) {
      fail(e);
    }
  }
  main.replaceChildren(pageHead("Vente directe", "Pour une vente sans commande de serveur."), card(null, field("Serveur", waiter)), card(null, picker.el), card("Vente en cours", sumBox), bar);
  update();
}

export async function viewCredits(main) {
  main.replaceChildren(loader());
  const rows = await GET("/api/credits");
  const canCash = S.user.role === "cashier";
  main.replaceChildren(
    pageHead("Crédits clients", `Total dû : ${money(rows.reduce((s, r) => s + r.remaining, 0))}`),
    card(
      null,
      table(
        [
          { label: "Date", get: (s) => datetime(s.at) },
          { label: "Client", get: (s) => h("div", null, h("b", null, s.customer_name || "—"), h("div", { class: "small muted" }, s.customer_phone || "")) },
          { label: "Vente", get: (s) => h("a", { href: `#/recus/${s.doc_no}` }, s.doc_no) },
          { label: "Total", r: true, get: (s) => money(s.total) },
          { label: "Payé", r: true, get: (s) => money(s.paid) },
          { label: "Reste", r: true, get: (s) => h("b", { class: "warn" }, money(s.remaining)) },
          { label: "", get: (s) => (canCash ? h("button", { class: "btn sm primary", on: { click: () => creditPayment(s, () => viewCredits(main)) } }, "Encaisser") : "") },
        ],
        rows,
      ),
    ),
  );
}

function creditPayment(s, done) {
  const form = h("div", { class: "form" }, h("p", null, `${s.customer_name} doit `, h("b", null, money(s.remaining)), ` sur la vente ${s.doc_no}.`), h("div", { class: "row" }, field("Montant reçu", input("amount", { type: "number", min: 1, max: s.remaining, value: s.remaining, required: true, inputmode: "numeric" })), field("Mode", select("method", S.boot.settings.payment_methods, "Espèces"))));
  modal("Paiement d'un crédit", form, [{ label: "Annuler", class: "ghost" }, { label: "Encaisser", class: "primary", submit: true, onClick: async () => {
    const d = formData(form.closest("form"));
    const r = await POST(`/api/sales/${s.id}/payments`, { amount: Number(d.amount), method: d.method }, { offline: `Paiement de crédit ${s.customer_name} (${money(Number(d.amount))})` });
    toast(r.queued ? "Enregistré hors connexion : sera envoyé automatiquement." : r.remaining ? `Paiement ${r.doc_no} : reste ${money(r.remaining)}.` : `Crédit soldé (${r.doc_no}).`, "good");
    done();
  } }]);
}
