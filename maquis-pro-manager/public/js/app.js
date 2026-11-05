// Démarrage de l'application : session, navigation selon le rôle, temps réel, mode hors connexion.
import { S, h, icon, GET, POST, api, on, emit, toast, fail, go, loader, empty, pageHead, card, syncQueue, refreshQueueCount, ROLE_LABELS, ApiError } from "./core.js";
import { viewLogin, viewSetup, viewChangePassword, viewReceipts, viewReceipt, viewReports, viewReport, viewNotifications, viewAccount } from "./views-common.js";
import { viewDashboard, viewUsers, viewDevices, viewLogins, viewAudit, viewSettings, viewBackups } from "./views-owner.js";
import * as M from "./views-manager.js";
import * as T from "./views-staff.js";

const root = document.getElementById("app");

// Thème choisi par l'utilisateur (sinon celui du téléphone).
try {
  const t = localStorage.getItem("mpm_theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch {}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

// ---------- Menus par rôle ----------
const NAV = {
  owner: {
    home: "#/tableau",
    bottom: [["#/tableau", "home", "Tableau"], ["#/stock", "box", "Stock"], ["#/rapports", "chart", "Rapports"], ["#/recus", "doc", "Reçus"], ["#/plus", "more", "Plus"]],
    groups: [
      ["Suivi", [["#/tableau", "home", "Tableau de bord"], ["#/rapports", "chart", "Rapports"], ["#/recus", "doc", "Reçus"], ["#/notifications", "bell", "Notifications"]]],
      ["Activité", [["#/stock", "box", "Stock"], ["#/mouvements", "list", "Mouvements"], ["#/ventes", "cart", "Ventes"], ["#/commandes", "clip", "Commandes"], ["#/caisses", "cash", "Caisses"], ["#/depenses", "out", "Dépenses"], ["#/credits", "credit", "Crédits clients"], ["#/entrees", "in", "Entrées"], ["#/sorties", "out", "Sorties"], ["#/inventaires", "clip", "Inventaires"], ["#/fournisseurs", "truck", "Fournisseurs"], ["#/produits", "bottle", "Catalogue"]]],
      ["Administration", [["#/admin/comptes", "users", "Comptes"], ["#/admin/appareils", "shield", "Appareils connectés"], ["#/admin/connexions", "user", "Connexions"], ["#/admin/audit", "list", "Journal d'audit"], ["#/admin/parametres", "settings", "Paramètres"], ["#/admin/sauvegardes", "download", "Sauvegardes"], ["#/compte", "user", "Mon compte"]]],
    ],
  },
  manager: {
    home: "#/tableau",
    bottom: [["#/tableau", "home", "Accueil"], ["#/stock", "box", "Stock"], ["#/entrees/nouvelle", "in", "Entrée"], ["#/sorties/nouvelle", "out", "Sortie"], ["#/plus", "more", "Plus"]],
    groups: [
      ["Opérations", [["#/tableau", "home", "Tableau de bord"], ["#/stock", "box", "Stock"], ["#/entrees", "in", "Entrées"], ["#/sorties", "out", "Sorties"], ["#/inventaires", "clip", "Inventaires"], ["#/produits", "bottle", "Catalogue des boissons"], ["#/mouvements", "list", "Mouvements"]]],
      ["Ventes et caisse", [["#/commandes", "clip", "Commandes"], ["#/ventes", "cart", "Ventes"], ["#/caisses", "cash", "Caisses"], ["#/depenses", "out", "Dépenses"], ["#/credits", "credit", "Crédits clients"]]],
      ["Partenaires", [["#/fournisseurs", "truck", "Fournisseurs"], ["#/consignes", "box", "Consignes"]]],
      ["Suivi", [["#/rapports", "chart", "Rapports"], ["#/recus", "doc", "Reçus"], ["#/notifications", "bell", "Notifications"], ["#/admin/comptes", "users", "Personnel"], ["#/admin/appareils", "shield", "Appareils"], ["#/compte", "user", "Mon compte"]]],
    ],
  },
  cashier: {
    home: "#/caisse",
    bottom: [["#/caisse", "cash", "Caisse"], ["#/commandes", "list", "Commandes"], ["#/vente", "cart", "Vente"], ["#/credits", "credit", "Crédits"], ["#/plus", "more", "Plus"]],
    groups: [
      ["Caisse", [["#/caisse", "cash", "Ma caisse"], ["#/commandes", "list", "Commandes à encaisser"], ["#/vente", "cart", "Vente directe"], ["#/credits", "credit", "Crédits clients"], ["#/depenses", "out", "Dépenses"], ["#/ventes", "doc", "Mes ventes"], ["#/caisses", "clock", "Mes caisses"]]],
      ["Suivi", [["#/recus", "doc", "Reçus"], ["#/notifications", "bell", "Notifications"], ["#/compte", "user", "Mon compte"]]],
    ],
  },
  waiter: {
    home: "#/commander",
    bottom: [["#/commander", "plus", "Commander"], ["#/mes-commandes", "list", "Commandes"], ["#/mes-ventes", "chart", "Mes ventes"], ["#/recus", "doc", "Reçus"], ["#/plus", "more", "Plus"]],
    groups: [
      ["Service", [["#/commander", "plus", "Nouvelle commande"], ["#/mes-commandes", "list", "Mes commandes"], ["#/mes-ventes", "chart", "Mes ventes"], ["#/recus", "doc", "Reçus"]]],
      ["Compte", [["#/notifications", "bell", "Notifications"], ["#/compte", "user", "Mon compte"]]],
    ],
  },
};

// ---------- Routes (le serveur vérifie de toute façon chaque droit) ----------
const ALL = ["owner", "manager", "cashier", "waiter"];
const OM = ["owner", "manager"];
const ROUTES = {
  tableau: [OM, (m) => viewDashboard(m)],
  stock: [OM, (m, id) => (id ? M.viewProduct(m, id) : M.viewStock(m))],
  produits: [OM, (m) => M.viewProducts(m)],
  mouvements: [OM, (m) => M.viewMovements(m)],
  entrees: [OM, (m, x) => (x === "nouvelle" && S.user.role === "manager" ? M.viewEntryForm(m) : x ? M.viewEntry(m, x) : M.viewEntries(m))],
  sorties: [OM, (m, x) => (x === "nouvelle" && S.user.role === "manager" ? M.viewExitForm(m) : x ? M.viewExit(m, x) : M.viewExits(m))],
  inventaires: [OM, (m, id) => (id ? M.viewInventory(m, id) : M.viewInventories(m))],
  fournisseurs: [OM, (m, id) => (id ? M.viewSupplier(m, id) : M.viewSuppliers(m))],
  consignes: [OM, (m) => M.viewConsignments(m)],
  depenses: [["owner", "manager", "cashier"], (m) => M.viewExpenses(m)],
  caisses: [["owner", "manager", "cashier"], (m, id) => (id ? M.viewCashSession(m, id) : M.viewCashSessions(m))],
  ventes: [ALL, (m, id) => (id ? M.viewSale(m, id) : S.user.role === "waiter" ? go("#/mes-ventes") : M.viewSales(m))],
  commandes: [["owner", "manager", "cashier"], (m) => (S.user.role === "cashier" ? T.viewPending(m) : M.viewOrdersAll(m))],
  caisse: [["cashier"], (m) => T.viewCash(m)],
  vente: [["cashier"], (m) => T.viewDirectSale(m)],
  credits: [["owner", "manager", "cashier"], (m) => T.viewCredits(m)],
  commander: [["waiter"], (m) => T.viewOrder(m)],
  "mes-commandes": [["waiter"], (m) => T.viewMyOrders(m)],
  "mes-ventes": [["waiter"], (m) => T.viewMyStats(m)],
  rapports: [OM, (m, a, b, c) => (a === "apercu" ? viewReport(m, null, { kind: b, key: c }) : a ? viewReport(m, a) : viewReports(m))],
  recus: [ALL, (m, no) => (no ? viewReceipt(m, decodeURIComponent(no)) : viewReceipts(m))],
  notifications: [ALL, (m) => viewNotifications(m)],
  compte: [ALL, (m) => viewAccount(m)],
  "mot-de-passe": [ALL, (m) => viewChangePassword(m)],
  plus: [ALL, (m) => viewMore(m)],
  admin: [
    OM,
    (m, page) =>
      ({
        comptes: () => viewUsers(m),
        appareils: () => viewDevices(m),
        connexions: () => S.user.role === "owner" && viewLogins(m),
        audit: () => S.user.role === "owner" && viewAudit(m),
        parametres: () => S.user.role === "owner" && viewSettings(m),
        sauvegardes: () => S.user.role === "owner" && viewBackups(m),
      })[page]?.() || go(NAV[S.user.role].home),
  ],
};

function viewMore(main) {
  const nav = NAV[S.user.role];
  main.replaceChildren(
    pageHead("Menu", `${S.user.full_name} · ${ROLE_LABELS[S.user.role]}`),
    ...nav.groups.map(([g, items]) => h("section", { class: "card" }, h("h2", null, g), h("div", { class: "list" }, items.map(([href, ic, label]) => h("a", { class: "item", href }, h("div", { class: "ic brand" }, icon(ic)), h("div", { class: "grow t" }, label)))))),
    h("button", { class: "btn danger block mt", on: { click: () => emit("logout") } }, icon("logout"), "Se déconnecter"),
  );
}

// ---------- Mise en page ----------
let main;
let topbar;
let bottom;
let side;
let pendingOrders = 0;

function renderChrome() {
  const s = S.boot.settings;
  const syncPill = !S.online
    ? h("button", { class: "sync-pill off", on: { click: () => go("#/compte") } }, icon("wifi"), S.pending ? `Hors ligne · ${S.pending}` : "Hors ligne")
    : S.pending || S.failed
      ? h("button", { class: "sync-pill", on: { click: () => go("#/compte") } }, icon("sync"), S.failed ? `${S.failed} refusée(s)` : `${S.pending} en attente`)
      : null;
  topbar.replaceChildren(
    h("a", { class: "brand", href: NAV[S.user.role].home }, s.logo ? h("img", { src: s.logo, alt: "" }) : h("div", { class: "mark" }, (s.maquis_name || "MP").slice(0, 2).toUpperCase()), h("div", { class: "t" }, h("b", null, s.maquis_name), h("span", null, `${S.user.full_name} · ${ROLE_LABELS[S.user.role]}`))),
    syncPill,
    h("a", { class: "iconbtn", href: "#/notifications", "aria-label": "Notifications" }, icon("bell"), S.unread ? h("span", { class: "dot-badge" }, S.unread > 99 ? "99+" : S.unread) : null),
  );
  const cur = location.hash || NAV[S.user.role].home;
  const isOn = (href) => cur === href || (href !== "#/plus" && cur.startsWith(href + "/") && !NAV[S.user.role].bottom.some(([x]) => x !== href && cur.startsWith(x)));
  const badge = (href) => (href === "#/commandes" && S.user.role === "cashier" && pendingOrders ? h("span", { class: "dot-badge" }, pendingOrders) : href === "#/notifications" && S.unread ? h("span", { class: "dot-badge" }, S.unread) : null);
  bottom.replaceChildren(...NAV[S.user.role].bottom.map(([href, ic, label]) => h("a", { href, class: isOn(href) ? "on" : "" }, icon(ic), h("span", null, label), badge(href))));
  side.replaceChildren(...NAV[S.user.role].groups.flatMap(([g, items]) => [h("div", { class: "group" }, g), ...items.map(([href, ic, label]) => h("a", { href, class: isOn(href) ? "on" : "" }, icon(ic), label, badge(href)))]));
}

async function route() {
  if (!S.user) return;
  if (S.user.must_change_password) return viewChangePassword(main, { forced: true });
  let hash = location.hash.replace(/^#\/?/, "");
  if (!hash) return go(NAV[S.user.role].home);
  const [name, ...args] = hash.split("/");
  const r = ROUTES[name];
  renderChrome();
  window.scrollTo(0, 0);
  if (!r || !r[0].includes(S.user.role)) return go(NAV[S.user.role].home);
  main.replaceChildren(loader());
  try {
    await r[1](main, ...args);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return;
    main.replaceChildren(card(null, empty(e.message || "Erreur d'affichage.", "alert"), h("div", { class: "center" }, h("button", { class: "btn", on: { click: route } }, icon("refresh"), "Réessayer"))));
  }
}

// ---------- Temps réel ----------
let es;
function connectEvents() {
  es?.close();
  if (!window.EventSource) return;
  es = new EventSource("/api/events");
  es.addEventListener("notification", (e) => {
    const d = JSON.parse(e.data);
    S.unread++;
    renderChrome();
    toast(d.title, d.severity === "danger" ? "bad" : "");
  });
  es.addEventListener("orders", () => {
    emit("orders");
    updatePending();
  });
  es.addEventListener("stock", () => refreshBootSoon());
  es.addEventListener("hello", () => S.online || (S.online = true));
}
let bootTimer;
function refreshBootSoon() {
  clearTimeout(bootTimer);
  bootTimer = setTimeout(async () => {
    try {
      S.boot = await GET("/api/bootstrap");
    } catch {}
  }, 1500);
}
async function updatePending() {
  if (S.user?.role !== "cashier") return;
  try {
    const n = (await GET("/api/orders?status=pending")).length;
    // Si le temps réel est coupé par l'hébergeur, l'interrogation régulière rafraîchit quand même la liste.
    if (n !== pendingOrders) emit("orders");
    pendingOrders = n;
    renderChrome();
  } catch {}
}

on((type) => {
  if (type === "unauthorized") showLogin();
  if (type === "logout") logout();
  if (type === "queue" || type === "online" || type === "unread") S.user && S.boot && renderChrome();
});

async function logout() {
  await POST("/api/auth/logout").catch(() => {});
  es?.close();
  S.user = null;
  S.boot = null;
  location.hash = "";
  showLogin();
}

function showLogin() {
  es?.close();
  S.user = null;
  viewLogin(root, { onDone: start });
}

// ---------- Démarrage ----------
async function start() {
  root.replaceChildren(loader());
  try {
    S.boot = await GET("/api/bootstrap");
  } catch (e) {
    if (e.status === 401) {
      const setup = await GET("/api/setup").catch(() => null);
      return setup?.needs_setup ? viewSetup(root, { onDone: start }) : showLogin();
    }
    return root.replaceChildren(h("div", { class: "auth" }, h("div", { class: "box card center" }, icon("wifi"), h("h2", null, "Serveur injoignable"), h("p", { class: "muted" }, "Vérifiez la connexion internet puis réessayez."), h("button", { class: "btn primary mt", on: { click: start } }, "Réessayer"))));
  }
  S.user = S.boot.user;
  S.unread = S.boot.unread;
  topbar = h("header", { class: "topbar" });
  main = h("main", { id: "main" });
  bottom = h("nav", { class: "bottomnav", "aria-label": "Navigation principale" });
  side = h("nav", { class: "sidenav", "aria-label": "Menu" });
  root.replaceChildren(topbar, h("div", { class: "layout" }, side, main), bottom);
  await refreshQueueCount();
  if (!S.user.must_change_password) {
    connectEvents();
    updatePending();
    syncQueue();
  }
  route();
}

window.addEventListener("hashchange", route);
// Synchronisation régulière de la file hors connexion et rattrapage du temps réel.
setInterval(() => {
  if (!S.user) return;
  syncQueue();
  if (es && es.readyState === 2) connectEvents();
  if (document.visibilityState === "visible") updatePending();
}, 30000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && S.user) {
    syncQueue();
    GET("/api/notifications").then((r) => ((S.unread = r.unread), renderChrome())).catch(() => {});
  }
});
navigator.serviceWorker?.addEventListener("message", (e) => {
  if (e.data?.type === "navigate" && e.data.link) go(e.data.link);
});

start();
