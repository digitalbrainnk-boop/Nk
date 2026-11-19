// Commandes fournisseurs (réapprovisionnement), fiche de stock et point des serveurs.
import {
  S, h, icon, GET, POST, toast, fail, modal, confirmBox, field, input, select, pageHead, card, stat, empty, loader, chip, table,
  money, num, datetime, dayShort, crates, go, today, productName, downloadUrl, addDays,
} from "./core.js";
import { docActions } from "./views-common.js";

const isManager = () => S.user.role === "manager";
const poChip = (o) => chip(o.status_label, o.status === "received" ? "good" : o.status === "cancelled" ? "bad" : o.status === "partial" ? "accent" : "warn");

// ---------- Commandes fournisseurs ----------
export async function viewPurchaseOrders(main) {
  main.replaceChildren(loader());
  const rows = await GET("/api/purchase-orders");
  const open = rows.filter((o) => o.status === "open" || o.status === "partial");
  main.replaceChildren(
    pageHead("Commandes fournisseurs", "Commandez ce qu'il faut, d'après les ventes réelles, puis réceptionnez la livraison.", isManager() ? [h("a", { class: "btn primary", href: "#/achats/nouvelle" }, icon("plus"), "Nouvelle commande")] : []),
    h("div", { class: "stats mb" }, stat("En attente de livraison", num(open.length), money(open.reduce((s, o) => s + o.total_estimated, 0))), stat("Reçues", num(rows.filter((o) => o.status === "received").length))),
    card(
      null,
      table(
        [
          { label: "Date", get: (o) => datetime(o.at) },
          { label: "N°", get: (o) => o.doc_no },
          { label: "Fournisseur", get: (o) => o.supplier },
          { label: "Livraison", get: (o) => (o.expected_date ? dayShort(o.expected_date) : "—") },
          { label: "Reçu / commandé", r: true, get: (o) => `${num(o.received || 0)} / ${num(o.qty)}` },
          { label: "Montant estimé", r: true, get: (o) => money(o.total_estimated) },
          { label: "Statut", get: poChip },
        ],
        rows,
        { onRow: (o) => go(`#/achats/${o.id}`) },
      ),
    ),
  );
}

export async function viewPurchaseOrderForm(main) {
  main.replaceChildren(loader());
  const suppliers = S.boot.suppliers || [];
  if (!suppliers.length) return main.replaceChildren(pageHead("Nouvelle commande fournisseur", null, [], "#/achats"), card(null, empty("Ajoutez d'abord un fournisseur (menu Fournisseurs).", "truck")));
  const sup = select("supplier_id", suppliers.map((s) => ({ value: s.id, label: s.name })), suppliers[0].id);
  const days = input("coverage_days", { type: "number", min: 1, max: 60, value: 7 });
  const expected = input("expected_date", { type: "date", min: today(), value: addDays(today(), 1) });
  const note = input("note", { placeholder: "Ex. livrer avant 17 h" });
  const box = h("div", null, loader());
  const totalEl = h("b");
  let rows = [];
  const qtyOf = (r) => (Number(r.crates) || 0) * r.units_per_crate + (Number(r.extra) || 0);
  const updTotal = () => {
    const t = rows.reduce((s, r) => s + qtyOf(r) * r.unit_cost, 0);
    const q = rows.reduce((s, r) => s + qtyOf(r), 0);
    totalEl.textContent = `${num(q)} bouteilles · ${money(t)}`;
  };
  const load = async () => {
    box.replaceChildren(loader());
    const sug = await GET(`/api/purchase-orders/suggestions?supplier_id=${sup.value}&coverage_days=${days.value || 7}`);
    rows = sug.rows.map((r) => ({ ...r, crates: r.suggested_crates, extra: r.suggested_extra }));
    box.replaceChildren(
      h(
        "p",
        { class: "small muted mb" },
        sug.history_days
          ? `Calcul : ventes moyennes ${sug.history_days === 1 ? "de la dernière journée" : `des ${sug.history_days} dernières journées`} × ${sug.coverage_days} jours + stock minimum − stock actuel − déjà commandé, arrondi au casier complet. Vous pouvez tout modifier.`
          : "Pas encore de journée de vente complète : seul le stock minimum de chaque boisson est pris en compte. Vous pouvez tout modifier.",
      ),
      h(
        "div",
        { class: "tablewrap" },
        h(
          "table",
          { class: "t" },
          h("thead", null, h("tr", null, h("th", null, "Boisson"), h("th", { class: "r" }, "Stock"), h("th", { class: "r" }, "Ventes / jour"), h("th", { class: "r" }, "Tient encore"), h("th", { class: "r" }, "Déjà commandé"), h("th", null, "Casiers"), h("th", null, "Btl en plus"))),
          h(
            "tbody",
            null,
            rows.map((r) => {
              const casierIn = input("c", { type: "number", min: 0, value: r.crates, style: { maxWidth: "84px" }, on: { input: (e) => ((r.crates = e.target.value), updTotal()) } });
              const extraIn = input("x", { type: "number", min: 0, value: r.extra, style: { maxWidth: "84px" }, on: { input: (e) => ((r.extra = e.target.value), updTotal()) } });
              return h(
                "tr",
                null,
                h("td", null, h("b", null, r.name), h("div", { class: "small muted" }, r.reason)),
                h("td", { class: "r" }, num(r.stock), h("div", { class: "small muted" }, r.stock_label)),
                h("td", { class: "r" }, String(r.avg_daily).replace(".", ",")),
                h("td", { class: "r" }, r.days_left === null ? "—" : h("b", { class: r.days_left <= 2 ? "bad" : r.days_left <= 5 ? "warn" : "" }, `${r.days_left} j`)),
                h("td", { class: "r" }, r.on_order ? num(r.on_order) : "—"),
                h("td", null, r.units_per_crate > 1 ? casierIn : h("span", { class: "muted" }, "—")),
                h("td", null, extraIn),
              );
            }),
          ),
        ),
      ),
    );
    updTotal();
  };
  sup.addEventListener("change", () => load().catch(fail));
  days.addEventListener("change", () => load().catch(fail));
  const send = async () => {
    const lines = rows.filter((r) => qtyOf(r) > 0).map((r) => ({ product_id: r.product_id, crates: Number(r.crates) || 0, units_per_crate: r.units_per_crate, extra_units: Number(r.extra) || 0, unit_cost: r.unit_cost }));
    if (!lines.length) return toast("Aucune quantité à commander.", "bad");
    try {
      const r = await POST("/api/purchase-orders", { supplier_id: Number(sup.value), expected_date: expected.value, note: note.value, lines }, { offline: `Commande fournisseur (${lines.length} boissons)` });
      if (r.queued) return toast("Pas de connexion : commande gardée, envoyée dès le retour du réseau.", "good"), go("#/achats");
      toast(`Bon de commande ${r.doc_no} créé : envoyez-le au fournisseur.`, "good");
      go(`#/achats/${r.id}`);
    } catch (e) {
      fail(e);
    }
  };
  main.replaceChildren(
    pageHead("Nouvelle commande fournisseur", "Les quantités sont calculées à partir des ventes réelles.", [], "#/achats"),
    card(null, h("div", { class: "form" }, h("div", { class: "row" }, field("Fournisseur", sup), field("Couvrir combien de jours de vente ?", days), field("Livraison souhaitée", expected)), field("Note pour le fournisseur", note))),
    card(null, box),
    h("div", { class: "cartbar" }, h("div", { class: "grow" }, h("div", { class: "small", style: { opacity: 0.8 } }, "Total de la commande"), totalEl), h("button", { class: "btn primary", on: { click: send } }, icon("check"), "Créer le bon de commande")),
  );
  load().catch(fail);
}

export async function viewPurchaseOrder(main, id) {
  main.replaceChildren(loader());
  const o = await GET(`/api/purchase-orders/${id}`);
  const canAct = isManager() && (o.status === "open" || o.status === "partial");
  const text = `${S.boot.settings.maquis_name} — Bon de commande ${o.doc_no} pour ${o.supplier} :\n${o.lines.map((l) => `- ${crates(l.qty, l.units_per_crate, l.pack_label)} ${l.product_name}`).join("\n")}\nMontant estimé : ${money(o.total_estimated)}`;
  main.replaceChildren(
    pageHead(`Commande ${o.doc_no}`, `${o.supplier} · ${datetime(o.at)} · ${o.user_name}`, [], "#/achats"),
    h("div", { class: "flex mb" }, poChip(o), o.expected_date ? chip(`Livraison souhaitée : ${dayShort(o.expected_date)}`) : null),
    o.status === "cancelled" ? h("div", { class: "banner bad" }, icon("alert"), `Annulée le ${datetime(o.cancelled_at)} : ${o.cancel_reason}`) : null,
    h("div", { class: "btnrow mb" }, docActions(o.doc_no, `${o.doc_no}.pdf`, text, `Bon de commande ${o.doc_no}`), canAct ? h("a", { class: "btn primary", href: `#/entrees/nouvelle/po/${o.id}` }, icon("in"), "Réceptionner la livraison") : null),
    card(
      "Commandé et reçu",
      table(
        [
          { label: "Boisson", get: (l) => l.product_name },
          { label: "Commandé", r: true, get: (l) => h("div", null, num(l.qty), h("div", { class: "small muted" }, crates(l.qty, l.units_per_crate, l.pack_label))) },
          { label: "Reçu", r: true, get: (l) => num(l.received_qty) },
          { label: "Reste", r: true, get: (l) => h("b", { class: l.remaining ? "warn" : "good" }, num(l.remaining)) },
          { label: "Prix", r: true, get: (l) => money(l.unit_cost) },
          { label: "Montant", r: true, get: (l) => money(l.qty * l.unit_cost) },
        ],
        o.lines,
        { foot: ["Total", num(o.lines.reduce((s, l) => s + l.qty, 0)), num(o.lines.reduce((s, l) => s + l.received_qty, 0)), num(o.lines.reduce((s, l) => s + l.remaining, 0)), "", money(o.total_estimated)] },
      ),
    ),
    o.entries.length ? card("Livraisons reçues", h("div", { class: "list" }, o.entries.map((e) => h("a", { class: "item", href: `#/entrees/${e.id}` }, h("div", { class: "ic brand" }, icon("in")), h("div", { class: "grow" }, h("div", { class: "t" }, e.doc_no), h("div", { class: "d" }, datetime(e.at))), h("div", { class: "amt" }, money(e.total_amount)), e.status === "cancelled" ? chip("Annulée", "bad") : null)))) : null,
    canAct
      ? h("div", { class: "mt" }, h("button", { class: "btn danger", on: { click: async () => {
          const reason = await confirmBox("Annuler le reste de la commande ?", "Les bouteilles déjà reçues restent en stock.", { danger: true, ok: "Annuler la commande", reason: "Motif (obligatoire)" });
          if (!reason) return;
          try {
            await POST(`/api/purchase-orders/${o.id}/cancel`, { reason });
            toast("Commande annulée.", "good");
            viewPurchaseOrder(main, id);
          } catch (e) {
            fail(e);
          }
        } } }, icon("x"), "Annuler la commande"))
      : null,
  );
}

// ---------- Fiche de stock ----------
const SK = [["sale", "Vendues"], ["offered", "Offertes"], ["staff", "Personnel"], ["broken", "Cassées"], ["lost", "Perdues"], ["expired", "Périmées"], ["other", "Autres"]];

export function statementTable(st) {
  const t = st.totals;
  return table(
    [
      { label: "Boisson", get: (r) => h("div", null, h("b", null, r.name), h("div", { class: "small muted" }, r.category)) },
      { label: "Stock début", r: true, get: (r) => num(r.opening) },
      { label: "Entrées", r: true, get: (r) => (r.entries ? h("span", { class: "good" }, `+${num(r.entries)}`) : "") },
      ...SK.map(([k, l]) => ({ label: l, r: true, get: (r) => (r[k] ? num(r[k]) : "") })),
      { label: "Ajust.", r: true, get: (r) => (r.adjust ? `${r.adjust > 0 ? "+" : ""}${num(r.adjust)}` : "") },
      { label: "Stock fin", r: true, get: (r) => h("div", null, h("b", { class: r.closing <= 0 ? "bad" : r.low ? "warn" : "" }, num(r.closing)), h("div", { class: "small muted" }, r.closing_label)) },
      { label: "Valeur", r: true, get: (r) => money(r.value) },
      { label: "", get: (r) => (r.ok ? "" : chip("à vérifier", "bad")) },
    ],
    st.rows,
    { foot: ["Total", num(t.opening), num(t.entries), ...SK.map(([k]) => num(t[k])), t.adjust ? num(t.adjust) : "", num(t.closing), money(t.value), ""] },
  );
}

export async function viewStockStatement(main) {
  const from = input("from", { type: "date", value: today(), max: today() });
  const to = input("to", { type: "date", value: today(), max: today() });
  const box = h("div", null, loader());
  const q = () => `from=${from.value}&to=${to.value}`;
  const load = async () => {
    box.replaceChildren(loader());
    const st = await GET(`/api/stock/statement?${q()}`);
    box.replaceChildren(
      h(
        "div",
        { class: "stats mb" },
        stat("Stock au début", `${num(st.totals.opening)} btl`),
        stat("Entrées", `+${num(st.totals.entries)} btl`),
        stat("Sorties", `${num(st.totals.exits)} btl`, `dont ${num(st.totals.sale)} vendues`),
        stat("Stock à la fin", `${num(st.totals.closing)} btl`, `${money(st.totals.value)} (achat)`, "hero"),
      ),
      h("div", { class: `banner ${st.ok ? "info" : "bad"}` }, icon(st.ok ? "check" : "alert"), st.ok ? "Contrôle juste : stock début + entrées − sorties ± ajustements = stock fin, pour chaque boisson." : "Une ligne ne tombe pas juste : signalez-le."),
      card(null, statementTable(st)),
    );
  };
  for (const el of [from, to]) el.addEventListener("change", () => load().catch(fail));
  main.replaceChildren(
    pageHead("Fiche de stock", "Boisson par boisson : stock début + entrées − sorties = stock fin. Journée commerciale de 03 h 00 à 03 h 00.", [
      h("button", { class: "btn primary", on: { click: () => downloadUrl(`/api/stock/statement/pdf?${q()}`) } }, icon("download"), "PDF"),
      h("button", { class: "btn", on: { click: () => downloadUrl(`/api/stock/statement/xlsx?${q()}`) } }, icon("download"), "Excel"),
    ], "#/stock"),
    h("div", { class: "filters" }, field("Du", from), field("Au", to), h("button", { class: "btn", on: { click: () => ((from.value = to.value = today()), load()) } }, "Aujourd'hui")),
    box,
  );
  load().catch(fail);
}

// ---------- Point des serveurs ----------
export async function viewWaiterSummary(main) {
  const from = input("from", { type: "date", value: today(), max: today() });
  const to = input("to", { type: "date", value: today(), max: today() });
  const box = h("div", null, loader());
  const load = async () => {
    box.replaceChildren(loader());
    const d = await GET(`/api/waiters/summary?from=${from.value}&to=${to.value}`);
    box.replaceChildren(
      d.waiters.length
        ? h(
            "div",
            { class: "grid g2" },
            d.waiters.map((w) => {
              const pending = w.orders.pending;
              return card(
                h("div", { class: "cardhead" }, h("h3", null, w.waiter), chip(money(w.amount), "brand")),
                h("div", { class: "kv" }, h("div", null, h("span", null, "Ventes"), h("b", null, num(w.sales))), h("div", null, h("span", null, "Bouteilles vendues"), h("b", null, num(w.bottles))), h("div", null, h("span", null, "Commandes en attente"), h("b", { class: pending ? "warn" : "" }, pending ? `${pending.count} · ${money(pending.amount)}` : "0")), h("div", null, h("span", null, "Crédits non soldés"), h("b", { class: w.credit_open ? "warn" : "" }, w.credit_open ? money(w.credit_open) : "—")), h("div", null, h("span", null, "Refusées / annulées"), h("b", null, num((w.orders.rejected?.count || 0) + (w.orders.cancelled?.count || 0))))),
                w.exits.length ? h("p", { class: "small mt" }, h("b", null, "Sorties hors ventes : "), w.exits.map((x) => `${x.qty} ${x.label.toLowerCase()}`).join(", ")) : null,
                w.products.length ? h("div", { class: "mt" }, table([{ label: "Boisson", get: (p) => p.name }, { label: "Btl", r: true, get: (p) => num(p.qty) }, { label: "Montant", r: true, get: (p) => money(p.amount) }], w.products)) : h("p", { class: "muted small mt" }, "Aucune vente sur la période."),
              );
            }),
          )
        : card(null, empty("Aucun serveur.", "users")),
    );
  };
  for (const el of [from, to]) el.addEventListener("change", () => load().catch(fail));
  main.replaceChildren(
    pageHead("Point des serveurs", "Ce que chaque serveur a commandé, vendu et laissé à crédit.", [h("button", { class: "btn", on: { click: () => window.print() } }, icon("print"), "Imprimer")]),
    h("div", { class: "filters noprint" }, field("Du", from), field("Au", to)),
    box,
  );
  load().catch(fail);
}

// ---------- Accueil du gérant ----------
// Le travail de la journée : caisse, commandes à encaisser, alertes de stock, entrées et sorties.
// Le propriétaire voit le même écran en lecture seule (sans boutons d'action).
export async function viewManagerHome(main) {
  main.replaceChildren(loader());
  const d = await GET("/api/manager/home");
  const mgr = isManager();
  const exitLabels = S.boot.exit_labels || {};
  const quick = mgr
    ? h(
        "div",
        { class: "grid g3 mb" },
        h("a", { class: "btn lg primary", href: "#/commandes" }, icon("list"), `Encaisser les commandes (${d.pending_orders.count})`),
        h("a", { class: "btn lg", href: "#/vente" }, icon("cart"), "Vente directe"),
        h("a", { class: "btn lg", href: "#/entrees/nouvelle" }, icon("in"), "Nouvelle entrée"),
        h("a", { class: "btn lg", href: "#/sorties/nouvelle" }, icon("out"), "Nouvelle sortie"),
        h("a", { class: "btn lg", href: "#/achats/nouvelle" }, icon("truck"), "Commande fournisseur"),
        h("a", { class: "btn lg", href: d.inventory_draft ? `#/inventaires/${d.inventory_draft}` : "#/inventaires" }, icon("clip"), d.inventory_draft ? "Continuer l'inventaire" : "Inventaire"),
      )
    : null;
  const myCash = mgr
    ? d.cash.mine
      ? h("a", { class: "banner info", href: "#/caisse" }, icon("cash"), h("div", null, h("b", null, `Votre caisse est ouverte : ${money(d.cash.mine.theoretical)} attendus`), h("div", null, `${num(d.cash.mine.sales)} vente(s) · encaissé ${money(d.cash.mine.collected)} — touchez pour la gérer ou la fermer.`)))
      : h("a", { class: "banner warn", href: "#/caisse" }, icon("cash"), h("div", null, h("b", null, "Vous tenez la caisse aujourd'hui ?"), h("div", null, "Ouvrez votre caisse pour encaisser les commandes des serveurs et les ventes au comptoir.")))
    : null;
  main.replaceChildren(
    pageHead(mgr ? `Bonjour ${S.user.full_name.split(" ")[0]}` : "Accueil du gérant", `Journée commerciale du ${dayShort(d.today)} (de 03 h 00 à 03 h 00)`),
    myCash,
    d.approvals?.length
      ? card(
          h("div", { class: "cardhead" }, h("h2", null, "À valider"), chip(`${d.approvals.length} demande(s)`, "warn")),
          h(
            "div",
            { class: "list" },
            d.approvals.map((r) =>
              h(
                "div",
                { class: "item" },
                h("div", { class: "ic warn" }, icon("alert")),
                h("div", { class: "grow" }, h("div", { class: "t" }, `Annuler la vente ${r.doc_no} (${money(r.total)})`), h("div", { class: "d" }, `${r.requested_by_name} · ${datetime(r.at)} — ${r.reason}`)),
                mgr
                  ? h(
                      "div",
                      { class: "btnrow" },
                      h("a", { class: "btn sm", href: `#/ventes/${r.sale_id}` }, "Voir"),
                      h("button", { class: "btn sm primary", on: { click: async () => {
                        // Si la caisse de la vente est fermée et que plusieurs caisses sont ouvertes, le gérant choisit celle qui rembourse.
                        const open = r.paid > 0 ? await GET("/api/cash/sessions?status=open").catch(() => []) : [];
                        const mine = open.find((x) => x.cashier_id === S.user.id);
                        const sel = open.length > 1 ? select("refund_session_id", open.map((x) => ({ value: x.id, label: x.cashier_id === S.user.id ? "Ma caisse" : `Caisse de ${x.cashier_name}` })), (mine || open[0]).id) : null;
                        const body = h(
                          "div",
                          { class: "form" },
                          h("p", { class: "text-2" }, `La vente ${r.doc_no} sera annulée : boissons remises en stock, ${r.paid ? `${money(r.paid)} remboursés depuis une caisse ouverte (celle de la vente si elle est encore ouverte)` : "rien à rembourser"}, document rectificatif créé.`),
                          sel ? field("Caisse qui rembourse, si celle de la vente est fermée", sel) : null,
                        );
                        const ok = await modal("Valider l'annulation ?", body, [
                          { label: "Retour", class: "ghost" },
                          { label: "Valider l'annulation", class: "primary", submit: true, onClick: async () => {
                            await POST(`/api/cancel-requests/${r.id}/approve`, { refund_session_id: sel ? Number(sel.value) : undefined });
                            toast("Annulation validée.", "good");
                            return true;
                          } },
                        ]);
                        if (ok) viewManagerHome(main);
                      } } }, "Valider"),
                      h("button", { class: "btn sm danger", on: { click: async () => {
                        const note = await confirmBox("Refuser la demande ?", "Le caissier sera prévenu.", { danger: true, ok: "Refuser", reason: "Raison du refus" });
                        if (!note) return;
                        await POST(`/api/cancel-requests/${r.id}/refuse`, { note }).catch(fail);
                        viewManagerHome(main);
                      } } }, "Refuser"),
                    )
                  : null,
              ),
            ),
          ),
        )
      : null,
    quick,
    h(
      "div",
      { class: "stats" },
      stat("Ventes du jour", money(d.sales.amount), `${num(d.sales.count)} vente(s) · ${num(d.sales.bottles)} btl`, "hero"),
      stat("Encaissé aujourd'hui", money(d.sales.collected)),
      stat("Commandes en attente", num(d.pending_orders.count), money(d.pending_orders.amount)),
      stat("Crédits clients", money(d.credits.amount), `${num(d.credits.count)} vente(s)`),
    ),
    d.stock.out.length ? h("div", { class: "banner bad mt" }, icon("alert"), h("div", null, h("b", null, "Rupture : "), d.stock.out.map((x) => x.name).join(", "))) : null,
    d.stock.low.length ? h("div", { class: "banner warn mt" }, icon("alert"), h("div", null, h("b", null, "Stock faible : "), d.stock.low.map((x) => `${x.name} (${x.label})`).join(", "), mgr ? h("div", null, h("a", { href: "#/achats/nouvelle" }, "Préparer une commande fournisseur →")) : null)) : null,
    h(
      "div",
      { class: "grid g2 mt" },
      card(
        h("div", { class: "cardhead" }, h("h2", null, "Commandes en attente"), mgr ? h("a", { class: "small", href: "#/commandes" }, "Encaisser") : null),
        d.pending_orders.items.length
          ? h("div", { class: "list" }, d.pending_orders.items.map((o) => h("div", { class: "item" }, h("div", { class: "grow" }, h("div", { class: "t" }, `${o.order_no}${o.table_label ? ` · ${o.table_label}` : ""}`), h("div", { class: "d" }, `${o.waiter} · ${datetime(o.at)}`)), h("div", { class: "amt" }, money(o.total)))))
          : empty("Aucune commande en attente.", "check"),
      ),
      card(
        h("div", { class: "cardhead" }, h("h2", null, "Caisses ouvertes"), h("a", { class: "small", href: "#/caisses" }, "Toutes les caisses")),
        d.cash.open_sessions.length
          ? h("div", { class: "list" }, d.cash.open_sessions.map((c) => h("a", { class: "item", href: `#/caisses/${c.id}` }, h("div", { class: "ic brand" }, icon("cash")), h("div", { class: "grow" }, h("div", { class: "t" }, c.cashier), h("div", { class: "d" }, `Ouverte le ${datetime(c.opened_at)} · ${num(c.sales)} vente(s)`)), h("div", { class: "amt" }, money(c.theoretical)))))
          : empty("Aucune caisse ouverte.", "cash"),
      ),
    ),
    h(
      "div",
      { class: "grid g2" },
      card(
        "Mouvements de la journée",
        h(
          "div",
          { class: "list" },
          h("a", { class: "item", href: "#/entrees" }, h("div", { class: "ic good" }, icon("in")), h("div", { class: "grow" }, h("div", { class: "t" }, "Entrées de marchandises"), h("div", { class: "d" }, `${num(d.entries.count)} livraison(s)`)), h("div", { class: "amt" }, `+${num(d.entries.qty)} btl`)),
          h("a", { class: "item", href: "#/sorties" }, h("div", { class: "ic warn" }, icon("out")), h("div", { class: "grow" }, h("div", { class: "t" }, "Sorties hors ventes"), h("div", { class: "d" }, d.exits.length ? d.exits.map((x) => `${exitLabels[x.kind] || x.kind} : ${num(x.qty)}`).join(" · ") : "aucune")), h("div", { class: "amt" }, `${num(d.exits.reduce((a, x) => a + x.qty, 0))} btl`)),
          h("a", { class: "item", href: "#/depenses" }, h("div", { class: "ic" }, icon("out")), h("div", { class: "grow" }, h("div", { class: "t" }, "Dépenses"), h("div", { class: "d" }, `${num(d.expenses.count)} dépense(s)`)), h("div", { class: "amt" }, money(d.expenses.amount))),
          h("a", { class: "item", href: "#/achats" }, h("div", { class: "ic brand" }, icon("truck")), h("div", { class: "grow" }, h("div", { class: "t" }, "Commandes fournisseurs en attente de livraison")), h("div", { class: "amt" }, num(d.purchase_orders))),
          h("a", { class: "item", href: "#/fiche-stock" }, h("div", { class: "ic brand" }, icon("list")), h("div", { class: "grow" }, h("div", { class: "t" }, "Fiche de stock du jour"), h("div", { class: "d" }, "stock début + entrées − sorties = stock fin"))),
        ),
      ),
      card(
        h("div", { class: "cardhead" }, h("h2", null, "Reçus de la journée"), h("a", { class: "small", href: "#/recus" }, "Tous les reçus")),
        d.latest_documents.length
          ? h("div", { class: "list" }, d.latest_documents.map((x) => h("a", { class: "item", href: `#/recus/${x.doc_no}` }, h("div", { class: "grow" }, h("div", { class: "t" }, x.title), h("div", { class: "d" }, `${x.doc_no} · ${datetime(x.at)} · ${x.user_name}`)), x.amount !== null ? h("div", { class: "amt" }, money(x.amount)) : null)))
          : empty("Aucun reçu aujourd'hui.", "doc"),
      ),
    ),
  );
}
