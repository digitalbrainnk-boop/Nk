// Écrans communs : connexion, installation, reçus, rapports, notifications, compte.
import {
  S, h, icon, api, GET, POST, toast, fail, modal, confirmBox, field, input, select, formData, pageHead, card, stat, empty, loader, chip, table,
  money, num, datetime, date, dayShort, dayLabel, columnChart, barList, downloadUrl, shareFile, whatsappText, emailText, go, debounce, today, queue,
  refreshQueueCount, syncQueue, emit, ROLE_LABELS, addDays, productName
} from "./core.js";

const deviceId = () => {
  let id = "";
  try {
    id = localStorage.getItem("mpm_device") || "";
    if (!id) localStorage.setItem("mpm_device", (id = crypto.getRandomValues(new Uint32Array(4)).join("-")));
  } catch {}
  return id;
};

// ---------- Connexion et installation ----------
export function viewLogin(root, { onDone }) {
  const err = h("div", { class: "banner bad hidden" });
  const form = h(
    "form",
    { class: "card form", on: { submit: async (e) => {
      e.preventDefault();
      const b = form.querySelector("button");
      b.disabled = true;
      err.classList.add("hidden");
      try {
        const d = formData(form);
        await POST("/api/auth/login", { ...d, device_id: deviceId() });
        onDone();
      } catch (e2) {
        err.textContent = e2.message;
        err.classList.remove("hidden");
      } finally {
        b.disabled = false;
      }
    } } },
    err,
    field("Identifiant", input("username", { autocomplete: "username", autocapitalize: "none", required: true })),
    field("Mot de passe", input("password", { type: "password", autocomplete: "current-password", required: true })),
    h("button", { class: "btn primary lg block", type: "submit" }, "Se connecter"),
    h("p", { class: "small muted center" }, "Chaque membre du personnel a son propre identifiant. Ne partagez jamais le vôtre."),
  );
  root.replaceChildren(h("div", { class: "auth" }, h("div", { class: "box" }, h("div", { class: "logo" }, "MP"), h("h1", null, "MAQUIS PRO MANAGER"), h("p", { class: "tag" }, "Stocks, ventes, caisse et bilans de votre maquis"), form)));
}

export function viewSetup(root, { onDone }) {
  const err = h("div", { class: "banner bad hidden" });
  const form = h(
    "form",
    { class: "card form", on: { submit: async (e) => {
      e.preventDefault();
      const d = formData(form);
      if (d.password !== d.password2) {
        err.textContent = "Les deux mots de passe ne sont pas identiques.";
        return err.classList.remove("hidden");
      }
      try {
        await POST("/api/setup", { ...d, device_id: deviceId() });
        onDone();
      } catch (e2) {
        err.textContent = e2.message;
        err.classList.remove("hidden");
      }
    } } },
    h("div", { class: "banner info" }, icon("shield"), h("div", null, "Première installation : créez le compte du propriétaire. Le code d'installation est affiché par le serveur (fichier CODE-INSTALLATION.txt dans le dossier des données).")),
    err,
    field("Code d'installation", input("setup_code", { required: true, inputmode: "numeric", autocomplete: "one-time-code" })),
    field("Nom du maquis", input("maquis_name", { required: true, placeholder: "Ex. Maquis Le Baobab" })),
    field("Votre nom complet", input("full_name", { required: true })),
    field("Téléphone", input("phone", { type: "tel" })),
    field("Identifiant de connexion", input("username", { required: true, autocapitalize: "none", pattern: "[a-zA-Z0-9._\\-]{3,40}", placeholder: "ex. patron" }), "Lettres sans accent, chiffres, point ou tiret."),
    field("Mot de passe", input("password", { type: "password", required: true, minlength: 8, autocomplete: "new-password" }), "8 caractères au minimum. Ne le donnez à personne."),
    field("Confirmer le mot de passe", input("password2", { type: "password", required: true, minlength: 8, autocomplete: "new-password" })),
    h("button", { class: "btn primary lg block", type: "submit" }, "Créer le compte propriétaire"),
  );
  root.replaceChildren(h("div", { class: "auth" }, h("div", { class: "box" }, h("div", { class: "logo" }, "MP"), h("h1", null, "Bienvenue"), h("p", { class: "tag" }, "Installation de MAQUIS PRO MANAGER"), form)));
}

export function viewChangePassword(main, { forced = false } = {}) {
  const form = h(
    "form",
    { class: "form", on: { submit: async (e) => {
      e.preventDefault();
      const d = formData(form);
      if (d.password !== d.password2) return toast("Les deux nouveaux mots de passe sont différents.", "bad");
      try {
        await POST("/api/me/password", { current: d.current, password: d.password });
        toast("Mot de passe changé.", "good");
        location.reload();
      } catch (e2) {
        fail(e2);
      }
    } } },
    field("Mot de passe actuel", input("current", { type: "password", required: true, autocomplete: "current-password" })),
    field("Nouveau mot de passe", input("password", { type: "password", required: true, minlength: 6, autocomplete: "new-password" })),
    field("Confirmer", input("password2", { type: "password", required: true, minlength: 6, autocomplete: "new-password" })),
    h("button", { class: "btn primary", type: "submit" }, "Changer le mot de passe"),
  );
  main.replaceChildren(
    pageHead("Mot de passe", forced ? "Pour votre sécurité, choisissez votre propre mot de passe avant de continuer." : ""),
    card(null, forced ? h("div", { class: "banner warn" }, icon("shield"), "Votre mot de passe a été créé par un responsable : remplacez-le maintenant.") : null, form),
  );
}

// ---------- Reçus ----------
const DOC_TYPES = {
  "": "Tous les documents",
  sale: "Ventes",
  payment: "Paiements de crédit",
  entry: "Entrées de boissons",
  exit: "Sorties de boissons",
  expense: "Dépenses",
  refund: "Remboursements",
  withdrawal: "Retraits de caisse",
  deposit: "Ajouts en caisse",
  cash_close: "Fermetures de caisse",
  inventory: "Inventaires",
  supplier_payment: "Paiements fournisseurs",
  consignment: "Consignes",
  cancellation: "Rectificatifs (annulations)",
  daily_report: "Rapports quotidiens",
  weekly_report: "Rapports hebdomadaires",
};

export async function viewReceipts(main) {
  const q = input("q", { type: "search", placeholder: "N° de reçu, boisson, marque, responsable…" });
  const type = select("type", Object.entries(DOC_TYPES).map(([value, label]) => ({ value, label })), "");
  const from = input("from", { type: "date" });
  const to = input("to", { type: "date" });
  const list = h("div", null, loader());
  const load = async () => {
    list.replaceChildren(loader());
    try {
      const p = new URLSearchParams({ q: q.value.trim(), type: type.value, from: from.value, to: to.value });
      const rows = await GET(`/api/documents?${p}`);
      list.replaceChildren(
        rows.length
          ? h("div", { class: "list" }, rows.map((d) => h("a", { class: "item", href: `#/recus/${d.doc_no}` }, h("div", { class: `ic ${d.type === "cancellation" ? "bad" : "brand"}` }, icon(d.type.includes("report") ? "chart" : "doc")), h("div", { class: "grow" }, h("div", { class: "t" }, d.title), h("div", { class: "d" }, `${d.doc_no} · ${datetime(d.at)} · ${d.user_name}`)), d.amount !== null ? h("div", { class: "amt" }, money(d.amount)) : null)))
          : empty("Aucun reçu ne correspond à la recherche.", "doc"),
      );
    } catch (e) {
      list.replaceChildren(empty(e.message, "alert"));
    }
  };
  const deb = debounce(load, 350);
  q.addEventListener("input", deb);
  for (const el of [type, from, to]) el.addEventListener("change", load);
  main.replaceChildren(pageHead("Historique des reçus", "Tous les justificatifs, conservés sans modification possible."), card(null, h("div", { class: "filters" }, h("div", { class: "search", style: { flex: "2 1 220px" } }, icon("search"), q), type, field("Du", from), field("Au", to)), list));
  load();
}

function receiptBody(d) {
  const p = d.payload;
  return h(
    "div",
    { class: "receipt" },
    h(
      "div",
      { class: "rh" },
      h("div", null, h("b", null, p.maquis?.name || ""), h("div", { class: "small muted" }, [p.maquis?.address, p.maquis?.phone].filter(Boolean).join(" · "))),
      h("div", { class: "right" }, h("b", null, p.title), h("div", { class: "small muted" }, `N° ${p.doc_no}`), h("div", { class: "small muted" }, datetime(p.at))),
    ),
    p.rectifies ? h("div", { class: "banner bad" }, icon("alert"), `Document rectificatif du ${p.rectifies}`) : null,
    h("div", { class: "kv" }, [["Responsable", p.responsible], ...(p.fields || [])].map(([k, v]) => h("div", null, h("span", null, k), h("b", null, v)))),
    p.columns && p.rows ? h("div", { class: "mt" }, table(p.columns.map((c, i) => ({ label: c.label, r: c.align === "right", get: (r) => r[i] })), p.rows)) : null,
    p.totals?.length ? h("div", { class: "totals" }, p.totals.map(([k, v, b]) => h("div", { class: b ? "b" : "" }, h("span", null, k), h("span", { class: "num" }, v)))) : null,
    p.status ? h("div", { class: `status ${p.status.tone}` }, p.status.label) : null,
    (p.notes || []).map((n) => h("p", { class: "small muted" }, n)),
    p.maquis?.footer ? h("p", { class: "center text-2 mt" }, p.maquis.footer) : null,
  );
}

export function shareText(d) {
  const p = d.payload;
  const tot = (p.totals || []).filter((t) => t[2]).map((t) => `${t[0]} : ${t[1]}`);
  return [`${p.maquis?.name} — ${p.title}`, `N° ${p.doc_no} du ${datetime(p.at)}`, ...(p.fields || []).slice(0, 4).map(([k, v]) => `${k} : ${v}`), ...tot, p.status ? `Statut : ${p.status.label}` : ""].filter(Boolean).join("\n");
}

export function docActions(no, filename, text, subject) {
  const pdf = `/api/documents/${encodeURIComponent(no)}/pdf`;
  return [
    h("button", { class: "btn primary", on: { click: () => downloadUrl(pdf) } }, icon("download"), "Télécharger le reçu"),
    h("button", { class: "btn", on: { click: () => window.open(`/api/documents/${encodeURIComponent(no)}/print`, "_blank") } }, icon("print"), "Imprimer"),
    h("button", { class: "btn", on: { click: async () => {
      if (!(await shareFile(pdf, filename, text))) whatsappText(text);
    } } }, icon("share"), "WhatsApp"),
    h("button", { class: "btn", on: { click: async () => {
      if (!(await shareFile(pdf, filename, text))) emailText(subject, text);
    } } }, "E-mail"),
  ];
}

export async function viewReceipt(main, no) {
  main.replaceChildren(loader());
  const d = await GET(`/api/documents/${encodeURIComponent(no)}`);
  if (d.type === "daily_report" || d.type === "weekly_report") return go(`#/rapports/${d.payload.report_id}`);
  const text = shareText(d);
  main.replaceChildren(
    pageHead(d.title, `${d.doc_no} · ${datetime(d.at)}`, [], "#/recus"),
    h("div", { class: "btnrow mb" }, docActions(d.doc_no, `${d.doc_no}.pdf`, text, `${d.payload.maquis?.name} — ${d.title} ${d.doc_no}`)),
    card(null, receiptBody(d)),
    d.related?.filter((r) => r.doc_no !== d.doc_no).length
      ? card("Documents liés", h("div", { class: "list" }, d.related.filter((r) => r.doc_no !== d.doc_no).map((r) => h("a", { class: "item", href: `#/recus/${r.doc_no}` }, h("div", { class: "grow" }, h("div", { class: "t" }, r.title), h("div", { class: "d" }, r.doc_no))))))
      : null,
    h("p", { class: "small muted mt" }, `Empreinte de contrôle : ${d.hash.slice(0, 24)}… — un reçu enregistré ne peut plus être modifié ; une correction produit un document rectificatif.`),
  );
}

// ---------- Rapports ----------
export async function viewReports(main) {
  let kind = "daily";
  const box = h("div", null, loader());
  const status = h("div");
  const tabs = h("div", { class: "tabs" });
  const render = async () => {
    tabs.replaceChildren(
      ...[["daily", "Bilans quotidiens"], ["weekly", "Bilans hebdomadaires"]].map(([k, l]) => h("button", { class: kind === k ? "on" : "", on: { click: () => ((kind = k), render()) } }, l)),
    );
    box.replaceChildren(loader());
    const rows = await GET(`/api/reports?kind=${kind}`);
    box.replaceChildren(
      rows.length
        ? h("div", { class: "list" }, rows.map((r) => h("a", { class: "item", href: `#/rapports/${r.id}` }, h("div", { class: `ic ${r.version > 1 ? "warn" : "brand"}` }, icon("chart")), h("div", { class: "grow" }, h("div", { class: "t" }, r.label, r.version > 1 ? chip(`rectificatif v${r.version}`, "warn") : null, !r.current ? chip("version remplacée") : null), h("div", { class: "d" }, `${r.doc_no} · produit le ${datetime(r.generated_at)} · ${num(r.bottles)} bouteilles`)), h("div", { class: "amt" }, money(r.revenue)))))
        : empty(kind === "daily" ? "Le premier bilan quotidien sera produit à 03 h 00, à la fin de la journée commerciale en cours." : "Le premier bilan hebdomadaire sera produit le lundi à 03 h 00.", "chart"),
    );
  };
  main.replaceChildren(pageHead("Rapports", "Produits automatiquement par le serveur, même si tous les téléphones sont éteints."), status, tabs, card(null, box));
  try {
    const st = await GET("/api/reports/status");
    status.replaceChildren(
      h(
        "div",
        { class: "grid g2 mb" },
        h("div", { class: "card" }, h("div", { class: "flex between" }, h("div", null, h("h3", null, "Bilan quotidien"), h("p", { class: "small muted" }, "Tous les jours à 03 h 00 (heure du Burkina Faso)")), chip("Automatique", "good")), h("p", null, "Prochain : ", h("b", null, datetime(st.next_daily))), h("div", { class: "btnrow" }, h("a", { class: "btn sm", href: `#/rapports/apercu/daily/${st.business_day}` }, "Voir la journée en cours"))),
        h("div", { class: "card" }, h("div", { class: "flex between" }, h("div", null, h("h3", null, "Bilan hebdomadaire"), h("p", { class: "small muted" }, "Chaque lundi à 03 h 00 (heure du Burkina Faso)")), chip("Automatique", "good")), h("p", null, "Prochain : ", h("b", null, datetime(st.next_weekly)))),
      ),
      st.pending_rectifications ? h("div", { class: "banner warn" }, icon("alert"), `${st.pending_rectifications} bilan(s) rectificatif(s) en cours de préparation (opérations arrivées après la clôture).`) : null,
    );
  } catch {}
  render().catch((e) => box.replaceChildren(empty(e.message, "alert")));
}

const KIND_LABELS = { sale: "Vendues", offered: "Offertes", staff: "Personnel", broken: "Cassées", lost: "Perdues", expired: "Périmées", other: "Autres" };
const KINDS = Object.keys(KIND_LABELS);
const variation = (v) => (v === null || v === undefined ? h("span", { class: "muted" }, "—") : h("span", { class: `delta ${v >= 0 ? "good" : "bad"}` }, `${v >= 0 ? "▲ +" : "▼ "}${String(v).replace(".", ",")} %`));

export async function viewReport(main, id, preview = null) {
  main.replaceChildren(loader());
  const r = preview ? await GET(`/api/reports/preview?kind=${preview.kind}&key=${preview.key}`) : await GET(`/api/reports/${id}`);
  const d = r.data;
  const actions = preview
    ? []
    : [
        h("button", { class: "btn primary", on: { click: () => downloadUrl(`/api/reports/${r.id}/pdf`) } }, icon("download"), "PDF"),
        h("button", { class: "btn", on: { click: () => downloadUrl(`/api/reports/${r.id}/xlsx`) } }, icon("download"), "Excel"),
        h("button", { class: "btn", on: { click: async () => {
          if (!(await shareFile(`/api/reports/${r.id}/pdf`, `${r.doc_no}.pdf`, `${d.maquis?.name} — ${d.period.label}`))) whatsappText(`${d.maquis?.name} — ${r.kind === "daily" ? "Bilan du" : "Bilan"} ${d.period.label}`);
        } } }, icon("share"), "Partager"),
      ];
  const title = r.kind === "daily" ? "Bilan quotidien des sorties" : "Bilan hebdomadaire des ventes";
  const head = pageHead(title, d.period.label, actions, "#/rapports");
  const info = h(
    "div",
    { class: `banner ${preview ? "warn" : d.version > 1 ? "warn" : "info"}` },
    icon(preview ? "clock" : "check"),
    h(
      "div",
      null,
      preview
        ? `Aperçu en direct de la période en cours (${d.period.start_label} → maintenant). Le bilan définitif sera produit automatiquement à la clôture.`
        : `${r.doc_no} — produit le ${datetime(r.generated_at)} (${{ automatique: "automatiquement à l'heure prévue", reprise: "à la reprise du serveur", rectification: "bilan rectificatif" }[r.trigger] || r.trigger}). Période : ${d.period.start_label} → ${d.period.end_label}.`,
      !preview && d.version > 1 ? h("div", null, `Rectifie ${d.rectifies} : des opérations ont été enregistrées ou annulées après la clôture. L'original reste consultable ci-dessous.`) : null,
    ),
  );
  const versions = !preview && r.versions?.length > 1 ? card("Versions de ce bilan", h("div", { class: "list" }, r.versions.map((v) => h("a", { class: "item", href: `#/rapports/${v.id}` }, h("div", { class: "grow" }, h("div", { class: "t" }, `Version ${v.version}${v.id === r.id ? " (affichée)" : ""}`), h("div", { class: "d" }, `${v.doc_no} · ${datetime(v.generated_at)}`)))))) : null;
  main.replaceChildren(head, info, ...(r.kind === "daily" ? dailyBody(d) : weeklyBody(d)), versions);
}

function exitsTable(byProduct) {
  const tot = Object.fromEntries(KINDS.map((k) => [k, byProduct.reduce((s, x) => s + x[k], 0)]));
  return table(
    [{ label: "Boisson", get: (x) => `${productName(x)}` }, ...KINDS.map((k) => ({ label: KIND_LABELS[k], r: true, get: (x) => (x[k] ? num(x[k]) : "") })), { label: "Total", r: true, get: (x) => h("b", null, num(x.total)) }, { label: "En casiers", get: (x) => x.label }],
    byProduct,
    { foot: byProduct.length ? ["Total", ...KINDS.map((k) => num(tot[k])), num(byProduct.reduce((s, x) => s + x.total, 0)), ""] : null },
  );
}

function brandBlocks(byCategory) {
  if (!byCategory.length) return empty("Aucune sortie enregistrée.", "bottle");
  return h(
    "div",
    { class: "grid g3" },
    byCategory.map((c) => h("div", { class: "card" }, h("div", { class: "flex between" }, h("h3", null, c.category.toUpperCase()), chip(`${num(c.total)} btl`, "brand")), h("div", { class: "list" }, c.brands.map((b) => h("div", { class: "item" }, h("div", { class: "grow t" }, b.brand), h("div", { class: "amt" }, `${num(b.total)} sortie${b.total > 1 ? "s" : ""}`, b.sold !== b.total ? h("div", { class: "small muted" }, `dont ${num(b.sold)} vendue(s)`) : null)))))),
  );
}

function cashTable(sessions) {
  return table(
    [
      { label: "Caissier", get: (s) => s.cashier },
      { label: "Statut", get: (s) => chip(s.status === "open" ? "Ouverte" : "Fermée", s.status === "open" ? "warn" : "") },
      { label: "Fonds", r: true, get: (s) => num(s.opening) },
      { label: "Encaissé", r: true, get: (s) => num(s.collected) },
      { label: "Dépenses", r: true, get: (s) => num(s.expenses) },
      { label: "Retraits", r: true, get: (s) => num(s.withdrawals) },
      { label: "Théorique", r: true, get: (s) => num(s.theoretical) },
      { label: "Compté", r: true, get: (s) => (s.counted === null ? "—" : num(s.counted)) },
      { label: "Écart", r: true, get: (s) => (s.variance === null ? "—" : h("b", { class: s.variance < 0 ? "bad" : s.variance > 0 ? "warn" : "good" }, num(s.variance))) },
    ],
    sessions,
  );
}

function dailyBody(d) {
  const e = d.exits;
  const a = d.analysis;
  return [
    h(
      "div",
      { class: "stats" },
      stat("Bouteilles sorties", num(e.total_bottles), `${num(e.by_kind.sale)} vendues`, "hero"),
      stat("Casiers sortis", String(e.crates_equivalent).replace(".", ","), `${num(e.full_crates)} casier(s) complet(s)`),
      stat("Ventes", money(d.sales.amount), `${num(d.sales.count)} vente(s)`),
      stat("Encaissé", money(d.sales.collected), d.sales.credit_given ? `crédit : ${money(d.sales.credit_given)}` : "aucun crédit"),
    ),
    card("Sorties par nature", h("div", { class: "stats" }, KINDS.map((k) => stat(KIND_LABELS[k], num(e.by_kind[k]), null, ["broken", "lost", "expired"].includes(k) && e.by_kind[k] ? "" : "")))),
    h("h2", { class: "mt mb" }, "Quantités sorties par marque"),
    brandBlocks(e.by_category),
    card("Boissons les plus vendues", barList(a.top.map((t) => ({ label: t.name, value: t.qty })), { valueFmt: (v) => `${num(v)} btl` })),
    card("Tableau des boissons sorties", exitsTable(e.by_product)),
    h(
      "div",
      { class: "grid g2" },
      card("Ventes par serveur", table([{ label: "Serveur", get: (w) => w.waiter }, { label: "Ventes", r: true, get: (w) => num(w.sales) }, { label: "Bouteilles", r: true, get: (w) => num(w.bottles) }, { label: "Montant", r: true, get: (w) => money(w.amount) }], d.sales.by_waiter)),
      card(
        "Résumé financier",
        h(
          "div",
          { class: "totals" },
          [
            ["Montant total des ventes", money(d.sales.amount), true],
            ...d.sales.collected_by_method.map((m) => [`Encaissé — ${m.method}`, money(m.amount)]),
            ["Total encaissé", money(d.sales.collected), true],
            ["dont règlements de crédits", money(d.sales.credit_settled)],
            ["Ventes à crédit non encaissées", money(d.sales.credit_given)],
            ["Remboursements", money(d.sales.refunds)],
            ["Dépenses", money(d.cash.expenses_total)],
            ["Bénéfice brut estimé", money(d.sales.gross_profit), true],
          ].map(([k, v, b]) => h("div", { class: b ? "b" : "" }, h("span", null, k), h("span", { class: "num" }, v))),
        ),
      ),
    ),
    d.sales.credit_customers.length ? card("Ventes à crédit", table([{ label: "Reçu", get: (c) => h("a", { href: `#/recus/${c.doc_no}` }, c.doc_no) }, { label: "Client", get: (c) => c.customer_name || "—" }, { label: "Total", r: true, get: (c) => money(c.total) }, { label: "Crédit", r: true, get: (c) => money(c.credit) }], d.sales.credit_customers)) : null,
    card(
      "Pertes, casses et boissons offertes",
      table(
        [
          { label: "Reçu", get: (l) => h("a", { href: `#/recus/${l.doc_no}` }, l.doc_no) },
          { label: "Nature", get: (l) => chip(l.reason_label, ["broken", "lost", "expired"].includes(l.reason) ? "bad" : "warn") },
          { label: "Boisson", get: (l) => `${productName(l)}` },
          { label: "Qté", r: true, get: (l) => num(l.qty) },
          { label: "Valeur achat", r: true, get: (l) => money(l.cost) },
          { label: "Responsable / observation", get: (l) => [l.responsible_name || l.user_name, l.waiter_name, l.observation].filter(Boolean).join(" — ") },
        ],
        d.losses,
      ),
    ),
    card("Résumé de caisse", cashTable(d.cash.sessions)),
    card(
      "Analyse automatique",
      h(
        "ul",
        { class: "bullets" },
        [
          a.best_seller ? `Boisson la plus vendue : ${a.best_seller.name} (${num(a.best_seller.qty)} bouteilles).` : "Aucune boisson vendue.",
          a.least_seller ? `Boisson la moins vendue (parmi les vendues) : ${a.least_seller.name} (${num(a.least_seller.qty)}).` : null,
          a.top_brands.length ? `Marques les plus demandées : ${a.top_brands.map((b) => `${b.brand} (${num(b.qty)})`).join(", ")}.` : null,
          a.top_categories.length ? `Catégories les plus vendues : ${a.top_categories.map((c) => `${c.category} (${num(c.qty)})`).join(", ")}.` : null,
          ...a.observations,
        ]
          .filter(Boolean)
          .map((t) => h("li", null, t)),
      ),
      h("div", { class: "flex mt small" }, h("span", null, "Veille : ", h("b", null, money(a.comparison.previous_day.amount)), " "), variation(a.comparison.previous_day.variation), a.comparison.average_7d ? h("span", null, " · Moyenne précédente : ", h("b", null, money(a.comparison.average_7d.amount)), " ", variation(a.comparison.average_7d.variation)) : null),
    ),
    card("Responsables des opérations", table([{ label: "Nom", get: (x) => x.user_name }, { label: "Rôle", get: (x) => ROLE_LABELS[x.role] || x.role }, { label: "Opérations", r: true, get: (x) => num(x.operations) }], d.responsibles)),
    card("Stock restant à la clôture", stockEnd(d.stock_end)),
  ];
}

function stockEnd(stock) {
  return table(
    [{ label: "Boisson", get: (s) => `${productName(s)}` }, { label: "Stock", r: true, get: (s) => num(s.stock) }, { label: "En casiers", get: (s) => s.label }, { label: "Valeur achat", r: true, get: (s) => money(s.value) }, { label: "", get: (s) => (s.stock <= 0 ? chip("Rupture", "bad") : s.low && s.min_stock ? chip("Faible", "warn") : "") }],
    stock,
  );
}

function weeklyBody(d) {
  const s = d.summary;
  const c = d.comparison;
  return [
    h("div", { class: "stats" }, stat("Chiffre d'affaires", money(s.revenue), `${num(s.sales_count)} vente(s)`, "hero"), stat("Total encaissé", money(s.collected)), stat("Dépenses", money(s.expenses)), stat("Bénéfice brut estimé", money(s.gross_profit), `marge ${String(s.margin_pct).replace(".", ",")} %`)),
    h("div", { class: "stats mt" }, stat("Bouteilles vendues", num(s.bottles_sold), `${String(s.crates_sold).replace(".", ",")} casier(s) équiv.`), stat("Total des sorties", num(s.total_exits)), stat("Pertes et casses", num(s.losses_qty), money(s.losses_cost)), stat("Écarts de caisse", money(s.cash_variance))),
    card("Chiffre d'affaires jour par jour", columnChart(d.daily.map((x) => ({ label: x.label.split(" ")[0].slice(0, 3), full: x.label, value: x.amount })), { valueFmt: money, label: "Chiffre d'affaires par jour" }), h("details", { class: "mt small" }, h("summary", null, "Voir en tableau"), table([{ label: "Jour", get: (x) => x.label }, { label: "CA", r: true, get: (x) => money(x.amount) }, { label: "Bouteilles", r: true, get: (x) => num(x.bottles) }, { label: "Encaissé", r: true, get: (x) => money(x.collected) }], d.daily))),
    card(
      "Comparaison avec la semaine précédente",
      table(
        [{ label: "Indicateur", get: (x) => x[0] }, { label: "Cette semaine", r: true, get: (x) => x[1] }, { label: "Précédente", r: true, get: (x) => x[2] }, { label: "Variation", r: true, get: (x) => variation(x[3]) }],
        [
          ["Chiffre d'affaires", money(s.revenue), money(c.previous.revenue), c.variation.revenue],
          ["Encaissé", money(s.collected), money(c.previous.collected), c.variation.collected],
          ["Bouteilles vendues", num(s.bottles_sold), num(c.previous.bottles_sold), c.variation.bottles_sold],
          ["Bénéfice brut estimé", money(s.gross_profit), money(c.previous.gross_profit), c.variation.gross_profit],
          ["Dépenses", money(s.expenses), money(c.previous.expenses), c.variation.expenses],
        ],
      ),
    ),
    h(
      "div",
      { class: "grid g2" },
      card("Ventes par catégorie", barList(d.exits.by_category.filter((x) => x.sale_value > 0).map((x) => ({ label: x.category, value: x.sale_value })), { valueFmt: money })),
      card("Ventes par serveur", table([{ label: "Serveur", get: (w) => w.waiter }, { label: "Btl", r: true, get: (w) => num(w.bottles) }, { label: "Montant", r: true, get: (w) => money(w.amount) }], d.sales.by_waiter)),
    ),
    card("Ventes par marque", table([{ label: "Catégorie", get: (b) => b.category }, { label: "Marque", get: (b) => b.brand }, { label: "Bouteilles", r: true, get: (b) => num(b.sold) }, { label: "Montant", r: true, get: (b) => money(b.sale_value) }], [...d.exits.by_brand].filter((b) => b.sold).sort((a, b) => b.sale_value - a.sale_value))),
    h(
      "div",
      { class: "grid g2" },
      card("Boissons les plus vendues", barList(d.ranking.top.map((t) => ({ label: t.name, value: t.qty })), { valueFmt: (v) => `${num(v)} btl` })),
      card("Boissons les moins vendues", table([{ label: "Boisson", get: (t) => t.name }, { label: "Btl", r: true, get: (t) => num(t.qty) }, { label: "Montant", r: true, get: (t) => money(t.amount) }], d.ranking.flop)),
    ),
    card("Sorties de la semaine", h("div", { class: "stats mb" }, KINDS.map((k) => stat(KIND_LABELS[k], num(d.exits.by_kind[k])))), exitsTable(d.exits.by_product)),
    h("div", { class: "grid g2" }, card("Dépenses par catégorie", table([{ label: "Catégorie", get: (x) => x.category }, { label: "Montant", r: true, get: (x) => money(x.amount) }], d.cash.expenses_by_category)), card("Résultat", h("div", { class: "totals" }, [["Chiffre d'affaires", money(s.revenue), true], ["Coût d'achat des boissons vendues", money(s.cogs)], ["Bénéfice brut estimé", money(s.gross_profit), true], ["Dépenses", money(s.expenses)], ["Pertes (prix d'achat)", money(s.losses_cost)], ["Résultat estimé", money(s.estimated_result), true], ["Achats de marchandises", money(s.purchases)]].map(([k, v, b]) => h("div", { class: b ? "b" : "" }, h("span", null, k), h("span", { class: "num" }, v)))))),
    card("Caisses et écarts", cashTable(d.cash.sessions)),
    card("Observations", h("ul", { class: "bullets" }, (d.observations.length ? d.observations : ["Aucune observation particulière."]).map((t) => h("li", null, t)))),
    card(`Stock restant à la clôture — ${num(s.stock_bottles)} bouteilles (${money(s.stock_value)})`, stockEnd(d.stock_end)),
  ];
}

// ---------- Notifications ----------
export async function viewNotifications(main) {
  main.replaceChildren(loader());
  const { items } = await GET("/api/notifications");
  const sevIcon = { danger: ["alert", "bad"], warn: ["alert", "warn"], info: ["bell", "brand"] };
  main.replaceChildren(
    pageHead("Notifications", null, [
      h("button", { class: "btn sm", on: { click: async () => {
        const r = await POST("/api/notifications/read", { all: true });
        S.unread = r.unread;
        emit("unread");
        viewNotifications(main);
      } } }, icon("check"), "Tout marquer comme lu"),
      h("a", { class: "btn sm", href: "#/compte" }, icon("settings"), "Réglages"),
    ]),
    card(
      null,
      items.length
        ? h("div", { class: "list" }, items.map((n) => {
            const [ic, cls] = sevIcon[n.severity] || sevIcon.info;
            return h("a", { class: "item", href: n.link || "#/notifications", style: { opacity: n.read_at ? 0.62 : 1 }, on: { click: () => !n.read_at && POST("/api/notifications/read", { ids: [n.id] }).then((r) => ((S.unread = r.unread), emit("unread"))) } }, h("div", { class: `ic ${cls}` }, icon(ic)), h("div", { class: "grow" }, h("div", { class: "t" }, n.title), h("div", { class: "d" }, n.body), h("div", { class: "d" }, datetime(n.at))), !n.read_at ? chip("Nouveau", "brand") : null);
          }))
        : empty("Aucune notification pour le moment.", "bell"),
    ),
  );
}

// ---------- Mon compte : sécurité, notifications, thème, synchronisation ----------
async function enablePush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return toast(/iPhone|iPad/.test(navigator.userAgent) ? "Sur iPhone : ajoutez d'abord l'application à l'écran d'accueil (bouton Partager → Sur l'écran d'accueil), puis ouvrez-la depuis l'icône." : "Ce navigateur ne permet pas les notifications push.", "bad");
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return toast("Notifications refusées dans les réglages du téléphone.", "bad");
  const reg = await navigator.serviceWorker.ready;
  const key = S.boot.vapid_key;
  const raw = atob(key.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((key.length + 3) % 4));
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)) });
  await POST("/api/push/subscribe", { subscription: sub.toJSON() });
  toast("Notifications activées sur cet appareil.", "good");
}

export async function viewAccount(main) {
  const u = S.user;
  const prefs = await GET("/api/notifications/prefs").catch(() => null);
  const ops = (await queue.all().catch(() => [])).filter((o) => o.user_id === u.id);
  const theme = (() => {
    try {
      return localStorage.getItem("mpm_theme") || "auto";
    } catch {
      return "auto";
    }
  })();
  const themeSel = select("theme", [{ value: "auto", label: "Automatique (selon le téléphone)" }, { value: "light", label: "Clair" }, { value: "dark", label: "Sombre" }], theme, { on: { change: (e) => {
    try {
      localStorage.setItem("mpm_theme", e.target.value);
    } catch {}
    if (e.target.value === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.dataset.theme = e.target.value;
  } } });
  const prefBox = prefs
    ? h(
        "div",
        { class: "list" },
        Object.entries(prefs.types).map(([k, label]) =>
          h("div", { class: "item" }, h("div", { class: "grow t" }, label), select(k, [{ value: "push", label: "Push + application" }, { value: "app", label: "Application seulement" }, { value: "off", label: "Désactivée" }], prefs.prefs[k], { style: { width: "auto", minWidth: "180px" }, on: { change: async (e) => {
            prefs.prefs[k] = e.target.value;
            await api("PUT", "/api/notifications/prefs", { prefs: prefs.prefs }).catch(fail);
          } } })),
        ),
      )
    : null;
  main.replaceChildren(
    pageHead("Mon compte", `${u.full_name} · ${ROLE_LABELS[u.role]}`),
    h(
      "div",
      { class: "grid g2" },
      card("Sécurité", h("div", { class: "kv" }, h("div", null, h("span", null, "Identifiant"), h("b", null, u.username)), h("div", null, h("span", null, "Rôle"), h("b", null, ROLE_LABELS[u.role]))), h("div", { class: "btnrow mt" }, h("a", { class: "btn", href: "#/mot-de-passe" }, icon("shield"), "Changer mon mot de passe"), h("button", { class: "btn danger", on: { click: () => emit("logout") } }, icon("logout"), "Se déconnecter"))),
      card("Affichage", field("Thème", themeSel), h("p", { class: "small muted mt" }, "Pour installer l'application : Android (Chrome) → menu ⋮ → « Installer l'application » ; iPhone (Safari) → Partager → « Sur l'écran d'accueil »."), h("p", { class: "small muted" }, `Version ${S.boot?.version || "1.0"}`)),
    ),
    card(
      "Synchronisation hors connexion",
      h("p", { class: "text-2" }, ops.length ? `${ops.length} opération(s) enregistrée(s) sur cet appareil en attente d'envoi.` : "Toutes les opérations de cet appareil sont envoyées au serveur."),
      ops.length
        ? h("div", { class: "list" }, ops.map((o) => h("div", { class: "item" }, h("div", { class: `ic ${o.error ? "bad" : "warn"}` }, icon(o.error ? "alert" : "sync")), h("div", { class: "grow" }, h("div", { class: "t" }, o.label), h("div", { class: "d" }, `${datetime(o.created)}${o.error ? ` — refusée : ${o.error}` : " — en attente"}`)), o.error ? h("button", { class: "btn sm danger", on: { click: async () => {
            if (await confirmBox("Abandonner cette opération ?", "Elle a été refusée par le serveur et ne sera pas enregistrée.", { danger: true, ok: "Abandonner" })) {
              await queue.remove(o.key);
              await refreshQueueCount();
              viewAccount(main);
            }
          } } }, "Abandonner") : null)))
        : null,
      ops.length ? h("button", { class: "btn mt", on: { click: async () => {
        await syncQueue();
        viewAccount(main);
      } } }, icon("sync"), "Synchroniser maintenant") : null,
    ),
    card("Notifications", h("div", { class: "btnrow mb" }, h("button", { class: "btn primary", on: { click: () => enablePush().catch(fail) } }, icon("bell"), "Activer les notifications sur cet appareil")), prefBox),
  );
}
