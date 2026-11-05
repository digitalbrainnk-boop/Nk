// Tableau de bord (propriétaire et gérant) et administration (comptes, appareils, journaux, paramètres).
import {
  S, h, icon, api, GET, POST, toast, fail, modal, confirmBox, field, input, select, formData, pageHead, card, stat, empty, loader, chip, table,
  money, num, datetime, date, dayLabel, dayShort, columnChart, barList, downloadUrl, go, today, addDays, ROLE_LABELS, timeOf, debounce,
} from "./core.js";

// ---------- Tableau de bord ----------
let period = null;
export async function viewDashboard(main) {
  const t = today();
  const presets = [
    ["Aujourd'hui", t, t],
    ["Hier", addDays(t, -1), addDays(t, -1)],
    ["7 jours", addDays(t, -6), t],
    ["30 jours", addDays(t, -29), t],
  ];
  period ||= { from: t, to: t, label: "Aujourd'hui" };
  const from = input("from", { type: "date", value: period.from, max: t });
  const to = input("to", { type: "date", value: period.to, max: t });
  const tabs = h(
    "div",
    { class: "tabs" },
    presets.map(([l, f, tt]) => h("button", { class: period.label === l ? "on" : "", on: { click: () => ((period = { from: f, to: tt, label: l }), viewDashboard(main)) } }, l)),
  );
  const custom = h("div", { class: "filters" }, field("Du", from), field("Au", to), h("button", { class: "btn", on: { click: () => ((period = { from: from.value, to: to.value, label: "" }), viewDashboard(main)) } }, "Afficher"));
  const body = h("div", null, loader());
  main.replaceChildren(pageHead("Tableau de bord", "Situation réelle du maquis, calculée uniquement à partir des opérations enregistrées."), tabs, custom, body);
  let d;
  try {
    d = await GET(`/api/dashboard?from=${period.from}&to=${period.to}`);
  } catch (e) {
    return body.replaceChildren(empty(e.message, "alert"));
  }
  const p = d.period;
  const alerts = [];
  if (d.stock.out.length) alerts.push(h("div", { class: "banner bad" }, icon("alert"), h("div", null, h("b", null, "Rupture de stock : "), d.stock.out.map((x) => x.name).join(", "))));
  if (d.stock.low.length) alerts.push(h("div", { class: "banner warn" }, icon("alert"), h("div", null, h("b", null, "Stock faible : "), d.stock.low.map((x) => `${x.name} (${x.label})`).join(", "))));
  if (d.pending_orders.count) alerts.push(h("div", { class: "banner info" }, icon("clock"), `${d.pending_orders.count} commande(s) de serveurs en attente d'encaissement (${money(d.pending_orders.amount)}).`));

  body.replaceChildren(
    ...alerts,
    h("p", { class: "muted small mb" }, `Période affichée : ${p.label}`),
    h(
      "div",
      { class: "stats" },
      stat("Ventes", money(p.sales.amount), `${num(p.sales.count)} vente(s) · ${num(p.sales.bottles)} btl`, "hero"),
      stat("Encaissé", money(p.sales.collected), p.sales.credit_given ? `crédit accordé : ${money(p.sales.credit_given)}` : "aucun crédit"),
      stat("Dépenses", money(p.expenses)),
      stat("Bénéfice estimé", money(p.estimated_profit), "après coût d'achat, dépenses et pertes"),
    ),
    h(
      "div",
      { class: "stats mt" },
      stat("Total des sorties", `${num(p.exits.total)} btl`, `dont ${num(p.exits.by_kind.sale)} vendues`),
      stat("Pertes et casses", `${num(p.losses.qty)} btl`, money(p.losses.cost)),
      stat("Stock restant", `${num(d.stock.bottles)} btl`, `${money(d.stock.value)} (achat)`),
      stat("Solde des caisses ouvertes", money(d.cash.balance), `${d.cash.open_sessions.length} caisse(s) ouverte(s)`),
    ),
    h(
      "div",
      { class: "grid g2 mt" },
      card(
        h("div", { class: "cardhead" }, h("h2", null, "Ventes des 14 derniers jours"), chip(`Semaine : ${money(d.week.amount)}`, "brand")),
        columnChart(d.series.map((x) => ({ label: x.label.slice(0, 2), full: dayShort(x.day), value: x.amount })), { valueFmt: money, label: "Ventes par jour" }),
        h("details", { class: "small mt" }, h("summary", null, "Voir en tableau"), table([{ label: "Jour", get: (x) => dayShort(x.day) }, { label: "Ventes", r: true, get: (x) => money(x.amount) }, { label: "Bouteilles", r: true, get: (x) => num(x.bottles) }, { label: "Encaissé", r: true, get: (x) => money(x.collected) }], [...d.series].reverse())),
      ),
      card("Boissons les plus vendues", barList(p.top.map((x) => ({ label: x.name, value: x.qty })), { valueFmt: (v) => `${num(v)} btl` })),
    ),
    h(
      "div",
      { class: "grid g2" },
      card("Ventes par catégorie", barList(p.exits.by_category.filter((c) => c.sale_value > 0).map((c) => ({ label: c.category, value: c.sale_value })), { valueFmt: money })),
      card(
        "Sorties par nature",
        table(
          [{ label: "Nature", get: (x) => x[0] }, { label: "Bouteilles", r: true, get: (x) => num(x[1]) }],
          [["Vendues", p.exits.by_kind.sale], ["Offertes", p.exits.by_kind.offered], ["Consommées par le personnel", p.exits.by_kind.staff], ["Cassées", p.exits.by_kind.broken], ["Perdues", p.exits.by_kind.lost], ["Périmées", p.exits.by_kind.expired], ["Autres", p.exits.by_kind.other]],
          { foot: ["Total", num(p.exits.total)] },
        ),
      ),
    ),
    h(
      "div",
      { class: "grid g2" },
      card(
        "Activité du personnel",
        table(
          [
            { label: "Nom", get: (u) => h("div", null, h("b", null, u.full_name), h("div", { class: "small muted" }, ROLE_LABELS[u.role])) },
            { label: "Ventes", r: true, get: (u) => (u.sales ? `${num(u.sales)} · ${money(u.sales_amount)}` : "—") },
            { label: "Commandes", r: true, get: (u) => (u.role === "waiter" ? num(u.orders) : "—") },
            { label: "Vu", r: true, get: (u) => (u.last_seen ? datetime(u.last_seen) : "jamais") },
          ],
          d.staff,
        ),
      ),
      card(
        "Caisses ouvertes",
        d.cash.open_sessions.length
          ? h("div", { class: "list" }, d.cash.open_sessions.map((s) => h("a", { class: "item", href: `#/caisses/${s.id}` }, h("div", { class: "ic brand" }, icon("cash")), h("div", { class: "grow" }, h("div", { class: "t" }, s.cashier), h("div", { class: "d" }, `Ouverte le ${datetime(s.opened_at)} · encaissé ${money(s.collected)}`)), h("div", { class: "amt" }, money(s.theoretical)))))
          : empty("Aucune caisse ouverte.", "cash"),
        d.credits.count ? h("p", { class: "mt small" }, h("b", null, `Crédits clients en cours : ${money(d.credits.amount)}`), ` (${d.credits.count} vente(s))`) : null,
      ),
    ),
    h(
      "div",
      { class: "grid g2" },
      card(
        h("div", { class: "cardhead" }, h("h2", null, "Derniers reçus"), h("a", { href: "#/recus", class: "small" }, "Tout voir")),
        d.latest_documents.length ? h("div", { class: "list" }, d.latest_documents.map((x) => h("a", { class: "item", href: `#/recus/${x.doc_no}` }, h("div", { class: "grow" }, h("div", { class: "t" }, x.title), h("div", { class: "d" }, `${x.doc_no} · ${datetime(x.at)} · ${x.user_name}`)), x.amount !== null ? h("div", { class: "amt" }, money(x.amount)) : null))) : empty("Aucun reçu.", "doc"),
      ),
      card(
        h("div", { class: "cardhead" }, h("h2", null, "Rapports automatiques"), h("a", { href: "#/rapports", class: "small" }, "Tous les rapports")),
        h(
          "div",
          { class: "list" },
          h("a", { class: "item", href: d.reports.last_daily ? `#/rapports/${d.reports.last_daily.id}` : "#/rapports" }, h("div", { class: "ic brand" }, icon("chart")), h("div", { class: "grow" }, h("div", { class: "t" }, "Dernier bilan quotidien"), h("div", { class: "d" }, d.reports.last_daily ? `${dayLabel(d.reports.last_daily.period_key)} · ${d.reports.last_daily.doc_no}` : "Aucun pour l'instant"), h("div", { class: "d" }, `Prochain : ${datetime(d.reports.next_daily)}`))),
          h("a", { class: "item", href: d.reports.last_weekly ? `#/rapports/${d.reports.last_weekly.id}` : "#/rapports" }, h("div", { class: "ic brand" }, icon("chart")), h("div", { class: "grow" }, h("div", { class: "t" }, "Dernier bilan hebdomadaire"), h("div", { class: "d" }, d.reports.last_weekly ? `Semaine du ${dayShort(d.reports.last_weekly.period_key)} · ${d.reports.last_weekly.doc_no}` : "Aucun pour l'instant"), h("div", { class: "d" }, `Prochain : ${datetime(d.reports.next_weekly)}`))),
          h("a", { class: "item", href: `#/rapports/apercu/daily/${d.today}` }, h("div", { class: "ic" }, icon("clock")), h("div", { class: "grow" }, h("div", { class: "t" }, "Journée en cours (aperçu en direct)"), h("div", { class: "d" }, dayLabel(d.today)))),
        ),
      ),
    ),
  );
}

// ---------- Comptes du personnel ----------
export async function viewUsers(main) {
  main.replaceChildren(loader());
  const users = await GET("/api/users");
  const isOwner = S.user.role === "owner";
  const roles = isOwner ? ["manager", "cashier", "waiter", "owner"] : ["cashier", "waiter"];
  const create = () => {
    const form = h(
      "div",
      { class: "form" },
      field("Rôle", select("role", roles.map((r) => ({ value: r, label: ROLE_LABELS[r] })), roles.includes("waiter") ? "waiter" : roles[0])),
      field("Nom complet", input("full_name", { required: true })),
      field("Téléphone", input("phone", { type: "tel" })),
      field("Identifiant de connexion", input("username", { required: true, autocapitalize: "none", pattern: "[a-zA-Z0-9._\\-]{3,40}" }), "Lettres sans accent, chiffres, point ou tiret."),
      field("Mot de passe provisoire", input("password", { required: true, minlength: 6, autocomplete: "new-password" }), "La personne devra le changer à sa première connexion."),
    );
    modal("Nouveau compte", form, [
      { label: "Annuler", class: "ghost" },
      { label: "Créer le compte", class: "primary", submit: true, onClick: async () => {
        const d = formData(form.closest("form"));
        await POST("/api/users", d);
        toast("Compte créé.", "good");
        viewUsers(main);
      } },
    ]);
  };
  const edit = (u) => {
    const form = h(
      "div",
      { class: "form" },
      field("Nom complet", input("full_name", { value: u.full_name, required: true })),
      field("Téléphone", input("phone", { value: u.phone || "", type: "tel" })),
      isOwner && u.id !== S.user.id ? field("Rôle", select("role", ["owner", "manager", "cashier", "waiter"].map((r) => ({ value: r, label: ROLE_LABELS[r] })), u.role)) : null,
      u.id !== S.user.id ? h("label", { class: "check" }, h("input", { type: "checkbox", name: "active", checked: u.active }), "Compte actif (décocher pour bloquer l'accès)") : null,
    );
    modal(`Modifier — ${u.full_name}`, form, [
      { label: "Annuler", class: "ghost" },
      u.id !== S.user.id ? { label: "Nouveau mot de passe", onClick: () => resetPw(u) } : null,
      { label: "Enregistrer", class: "primary", submit: true, onClick: async () => {
        await api("PATCH", `/api/users/${u.id}`, formData(form.closest("form")));
        toast("Compte mis à jour.", "good");
        viewUsers(main);
      } },
    ].filter(Boolean));
  };
  const resetPw = (u) => {
    const pw = input("password", { required: true, minlength: u.role === "owner" || u.role === "manager" ? 8 : 6, autocomplete: "new-password" });
    modal(`Mot de passe de ${u.full_name}`, h("div", { class: "form" }, field("Nouveau mot de passe provisoire", pw, "Toutes ses sessions seront déconnectées.")), [
      { label: "Annuler", class: "ghost" },
      { label: "Réinitialiser", class: "primary", submit: true, onClick: async () => {
        await POST(`/api/users/${u.id}/password`, { password: pw.value });
        toast("Mot de passe réinitialisé.", "good");
      } },
    ]);
  };
  main.replaceChildren(
    pageHead("Comptes", isOwner ? "Chaque personne a son propre compte. Ne partagez jamais les identifiants du propriétaire." : "Comptes des caissiers et des serveurs.", [h("button", { class: "btn primary", on: { click: create } }, icon("plus"), "Nouveau compte")]),
    card(
      null,
      h(
        "div",
        { class: "list" },
        users.map((u) =>
          h("button", { class: "item", style: { background: "none", border: 0, borderBottom: "1px solid var(--border)", textAlign: "left", font: "inherit", color: "inherit", cursor: "pointer", width: "100%" }, on: { click: () => edit(u) } }, h("div", { class: `ic ${u.active ? "brand" : ""}` }, icon("user")), h("div", { class: "grow" }, h("div", { class: "t" }, u.full_name, u.id === S.user.id ? " (vous)" : ""), h("div", { class: "d" }, `${u.username} · ${u.phone || "sans téléphone"}`)), chip(ROLE_LABELS[u.role], u.role === "owner" ? "accent" : "brand"), !u.active ? chip("Bloqué", "bad") : u.must_change_password ? chip("Mot de passe provisoire", "warn") : null),
        ),
      ),
    ),
  );
}

export async function viewDevices(main) {
  main.replaceChildren(loader());
  const rows = await GET("/api/devices");
  main.replaceChildren(
    pageHead("Appareils connectés", "Déconnectez à distance un téléphone perdu ou un ancien employé."),
    card(
      null,
      rows.length
        ? h("div", { class: "list" }, rows.map((s) => h("div", { class: "item" }, h("div", { class: "ic brand" }, icon("user")), h("div", { class: "grow" }, h("div", { class: "t" }, `${s.full_name} · ${s.device_label}`, s.current ? chip("cet appareil", "good") : null), h("div", { class: "d" }, `${s.role_label} · adresse ${s.ip} · connecté le ${datetime(s.created_at)} · dernière activité ${datetime(s.last_seen_at)}`)), !s.current ? h("button", { class: "btn sm danger", on: { click: async () => {
            if (await confirmBox("Déconnecter cet appareil ?", `${s.full_name} devra se reconnecter sur ${s.device_label}.`, { danger: true, ok: "Déconnecter" })) {
              await api("DELETE", `/api/devices/${s.id}`).catch(fail);
              viewDevices(main);
            }
          } } }, "Déconnecter") : null)))
        : empty("Aucun appareil connecté.", "user"),
    ),
  );
}

export async function viewLogins(main) {
  main.replaceChildren(loader());
  const rows = await GET("/api/login-events");
  main.replaceChildren(
    pageHead("Historique des connexions", "Toutes les tentatives, réussies ou non."),
    card(null, table([{ label: "Date", get: (e) => datetime(e.at) }, { label: "Identifiant", get: (e) => e.username }, { label: "Résultat", get: (e) => (e.success ? chip(e.reason || "Réussie", e.reason ? "warn" : "good") : chip(e.reason, "bad")) }, { label: "Appareil", get: (e) => e.device }, { label: "Adresse", get: (e) => e.ip }], rows)),
  );
}

export async function viewAudit(main) {
  const q = input("q", { type: "search", placeholder: "Rechercher (vente, annulation, nom…)" });
  const from = input("from", { type: "date" });
  const to = input("to", { type: "date" });
  const list = h("div", null, loader());
  const verify = h("div");
  const load = async () => {
    list.replaceChildren(loader());
    const rows = await GET(`/api/audit?${new URLSearchParams({ q: q.value, from: from.value, to: to.value })}`);
    list.replaceChildren(
      rows.length
        ? h("div", { class: "list" }, rows.map((a) => h("div", { class: "item" }, h("div", { class: "grow" }, h("div", { class: "t" }, a.summary || a.action), h("div", { class: "d" }, `${datetime(a.at)} · ${a.user_name} (${ROLE_LABELS[a.role] || "système"})${a.device ? ` · ${a.device}` : ""}${a.ip ? ` · ${a.ip}` : ""}`), a.details && a.details !== "{}" ? h("details", { class: "d" }, h("summary", null, "Détails"), h("pre", { style: { whiteSpace: "pre-wrap", fontSize: "0.78rem" } }, JSON.stringify(JSON.parse(a.details), null, 1))) : null), chip(a.action))))
        : empty("Aucune opération.", "list"),
    );
  };
  q.addEventListener("input", debounce(load));
  from.addEventListener("change", load);
  to.addEventListener("change", load);
  main.replaceChildren(
    pageHead("Journal d'audit", "Chaque opération : qui, quand, quoi, depuis quel appareil. Impossible à modifier.", [
      h("button", { class: "btn", on: { click: async () => {
        const v = await GET("/api/audit/verify");
        verify.replaceChildren(h("div", { class: `banner ${v.ok ? "info" : "bad"}` }, icon(v.ok ? "check" : "alert"), v.ok ? `Journal intact : ${num(v.count)} opérations vérifiées, aucune modification détectée.` : `Alerte : le journal a été altéré à la ligne ${v.broken_at}.`));
      } } }, icon("shield"), "Vérifier l'intégrité"),
    ]),
    verify,
    card(null, h("div", { class: "filters" }, h("div", { class: "search", style: { flex: "2 1 220px" } }, icon("search"), q), field("Du", from), field("Au", to)), list),
  );
  load().catch(fail);
}

// ---------- Paramètres généraux (propriétaire) ----------
export async function viewSettings(main) {
  main.replaceChildren(loader());
  const s = await GET("/api/settings");
  const logoPrev = h("div", { class: "flex" }, s.logo ? h("img", { src: s.logo, alt: "Logo", style: { width: "64px", height: "64px", borderRadius: "12px", objectFit: "cover" } }) : h("span", { class: "muted" }, "Aucun logo"));
  const logoInput = h("input", { type: "file", accept: "image/png,image/jpeg", on: { change: async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = await resizeImage(f, 512, "image/png");
      await POST("/api/settings/logo", { image: data });
      toast("Logo enregistré.", "good");
      viewSettings(main);
    } catch (err) {
      fail(err);
    }
  } } });
  const form = h(
    "form",
    { class: "form", on: { submit: async (e) => {
      e.preventDefault();
      const d = formData(form);
      try {
        await api("PUT", "/api/settings", {
          maquis_name: d.maquis_name,
          address: d.address,
          phone: d.phone,
          receipt_footer: d.receipt_footer,
          payment_methods: d.payment_methods.split("\n").map((x) => x.trim()).filter(Boolean),
          expense_categories: d.expense_categories.split("\n").map((x) => x.trim()).filter(Boolean),
          idle_minutes: { owner: +d.idle_owner, manager: +d.idle_manager, cashier: +d.idle_cashier, waiter: +d.idle_waiter },
        });
        toast("Paramètres enregistrés.", "good");
      } catch (err) {
        fail(err);
      }
    } } },
    h("div", { class: "row" }, field("Nom du maquis", input("maquis_name", { value: s.maquis_name, required: true })), field("Téléphone", input("phone", { value: s.phone }))),
    field("Adresse", input("address", { value: s.address })),
    field("Message en bas des reçus", input("receipt_footer", { value: s.receipt_footer })),
    h("div", { class: "row" }, field("Modes de paiement (un par ligne)", h("textarea", { name: "payment_methods", rows: 5 }, s.payment_methods.join("\n")), "« Espèces » est toujours présent."), field("Catégories de dépenses (une par ligne)", h("textarea", { name: "expense_categories", rows: 5 }, s.expense_categories.join("\n")))),
    h("h3", null, "Déconnexion automatique après inactivité (minutes)"),
    h("div", { class: "row" }, ["owner", "manager", "cashier", "waiter"].map((r) => field(ROLE_LABELS[r], input(`idle_${r}`, { type: "number", min: 5, max: 10080, value: s.idle_minutes[r] })))),
    h("div", null, h("button", { class: "btn primary", type: "submit" }, "Enregistrer")),
  );
  main.replaceChildren(
    pageHead("Paramètres généraux", "Ces réglages ne permettent pas de modifier les opérations enregistrées."),
    card("Logo du maquis", h("div", { class: "flex" }, logoPrev, field("Choisir une image (PNG ou JPEG)", logoInput)), h("p", { class: "small muted" }, "Le logo apparaît sur les reçus et les rapports PDF.")),
    card("Informations et réglages", form),
    card("Installation", h("div", { class: "kv" }, h("div", null, h("span", null, "Fuseau horaire"), h("b", null, "Africa/Ouagadougou")), h("div", null, h("span", null, "Devise"), h("b", null, "FCFA")), h("div", null, h("span", null, "Journée commerciale"), h("b", null, "03 h 00 → 02 h 59 min 59 s")), h("div", null, h("span", null, "En service depuis"), h("b", null, s.installed_day ? dayShort(s.installed_day) : "—")))),
  );
}

export function resizeImage(file, max = 512, type = "image/jpeg") {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL(type, 0.85));
    };
    img.onerror = () => reject(new Error("Image illisible."));
    img.src = URL.createObjectURL(file);
  });
}

export async function viewBackups(main) {
  main.replaceChildren(loader());
  const { backups, last } = await GET("/api/backups");
  main.replaceChildren(
    pageHead("Sauvegardes", "Une sauvegarde complète est faite automatiquement chaque jour après le bilan de 03 h 00 (30 dernières conservées).", [
      h("button", { class: "btn primary", on: { click: async (e) => {
        e.target.disabled = true;
        try {
          await POST("/api/backups");
          toast("Sauvegarde créée et vérifiée.", "good");
          viewBackups(main);
        } catch (err) {
          fail(err);
          e.target.disabled = false;
        }
      } } }, icon("download"), "Sauvegarder maintenant"),
    ]),
    last ? h("div", { class: "banner info" }, icon("check"), `Dernière sauvegarde : ${datetime(last.at)} (${last.reason}).`) : h("div", { class: "banner warn" }, icon("alert"), "Aucune sauvegarde pour le moment."),
    card(
      null,
      backups.length
        ? h("div", { class: "list" }, backups.map((b) => h("div", { class: "item" }, h("div", { class: "ic brand" }, icon("shield")), h("div", { class: "grow" }, h("div", { class: "t" }, b.name), h("div", { class: "d" }, `${datetime(b.at)} · ${(b.size / 1024).toFixed(0)} Ko`)), h("button", { class: "btn sm", on: { click: () => downloadUrl(`/api/backups/${b.name}`) } }, icon("download"), "Télécharger"))))
        : empty("Aucune sauvegarde.", "shield"),
      h("p", { class: "small muted mt" }, "Conservez de temps en temps une copie sur votre téléphone ou votre ordinateur. Pour restaurer une sauvegarde, voir le guide (commande « npm run restaurer »)."),
    ),
  );
}
