// Serveur web et API : chaque route vérifie, côté serveur, le compte et le rôle de l'utilisateur.
import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { openDb, all, get, run, tx, allSettings, setSetting, getDataDir } from "./db.js";
import { now, businessDay, isDay, dayBounds, fmtDateTime } from "./time.js";
import { AppError, bad, forbidden, notFound, str, int, money } from "./util.js";
import * as auth from "./auth.js";
import { audit, verifyAuditChain } from "./audit.js";
import * as catalog from "./catalog.js";
import * as stock from "./stock.js";
import * as sales from "./sales.js";
import * as cash from "./cash.js";
import * as docs from "./documents.js";
import * as reports from "./reports.js";
import * as notif from "./notify.js";
import { dashboard } from "./dashboard.js";
import { renderDocumentPdf, renderReportPdf } from "./pdf.js";
import { reportToXlsx } from "./xlsx.js";
import { backupNow, listBackups, backupPath } from "./backup.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, "..", "public");
const PROD = process.env.NODE_ENV === "production";

// Code d'installation : protège la création du compte propriétaire lors du tout premier démarrage.
export function setupCode() {
  if (get("SELECT 1 FROM users LIMIT 1")) return null;
  const s = allSettings();
  let code = process.env.SETUP_CODE || s.setup_code;
  if (!code) {
    code = crypto.randomInt(10000000, 99999999).toString();
    setSetting("setup_code", code);
  }
  try {
    fs.writeFileSync(path.join(getDataDir(), "CODE-INSTALLATION.txt"), `Code d'installation de MAQUIS PRO MANAGER : ${code}\r\n(Il sert une seule fois, pour créer le compte du propriétaire.)\r\n`);
  } catch {}
  return code;
}

export function createApp() {
  openDb();
  const app = express();
  app.set("trust proxy", Number(process.env.TRUST_PROXY ?? 1));
  app.disable("x-powered-by");

  app.use((req, res, next) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(self), geolocation=(), microphone=()");
    if (PROD) res.setHeader("Strict-Transport-Security", "max-age=31536000");
    next();
  });
  app.use(express.json({ limit: "6mb" }));

  app.get("/health", (req, res) => res.json({ ok: true, time: now(), business_day: businessDay() }));

  const api = express.Router();

  // Anti-falsification de requête : toute écriture doit venir de l'application elle-même.
  api.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD" && req.get("X-Requested-With") !== "MaquisPro") return next(forbidden("Requête refusée."));
    const a = auth.sessionFromRequest(req);
    if (a) {
      req.user = a.user;
      req.session = a.session;
    }
    next();
  });

  const h = (fn) => async (req, res, next) => {
    try {
      const out = await fn(req, res);
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (e) {
      next(e);
    }
  };
  const need = (...roles) => (req, res, next) => {
    if (!req.user) return next(new AppError(401, "Session expirée : reconnectez-vous."));
    if (req.user.must_change_password && !["/me", "/me/password", "/auth/logout", "/bootstrap"].includes(req.path)) return next(forbidden("Changez d'abord votre mot de passe."));
    if (roles.length && !roles.includes(req.user.role)) return next(forbidden());
    next();
  };
  const ctxOf = (req) => {
    const ctx = { user: req.user, ip: req.ip, device: req.session?.device_label || "", offline: false };
    if (req.get("Idempotency-Key") && req.get("X-Offline") === "1") {
      ctx.offline = true;
      const occurred = Number(req.get("X-Occurred-At"));
      if (Number.isFinite(occurred) && occurred > now() - 48 * 3600000 && occurred <= now() + 120000) ctx.at = Math.min(occurred, now());
    }
    return ctx;
  };
  // Écriture avec identifiant d'opération : un renvoi (synchronisation) ne crée jamais de doublon.
  const op = (fn) =>
    h((req) => {
      const key = req.get("Idempotency-Key");
      if (!key) return fn(req, ctxOf(req));
      if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) throw bad("Identifiant d'opération invalide.");
      const prev = get("SELECT * FROM sync_ops WHERE user_id = ? AND op_id = ?", req.user.id, key);
      if (prev) return { ...JSON.parse(prev.response), replayed: true };
      return tx(() => {
        const out = fn(req, ctxOf(req));
        run("INSERT INTO sync_ops (user_id, op_id, at, status, response) VALUES (?,?,?,?,?)", req.user.id, key, now(), 200, JSON.stringify(out ?? { ok: true }));
        return out;
      });
    });
  const id = (req) => int(req.params.id, "Identifiant", { min: 1 });

  // ---------- Installation et connexion ----------
  api.get("/setup", h(() => ({ needs_setup: !get("SELECT 1 FROM users LIMIT 1") })));
  api.post(
    "/setup",
    h(async (req, res) => {
      if (get("SELECT 1 FROM users LIMIT 1")) throw forbidden("L'application est déjà installée.");
      const code = setupCode();
      const given = String(req.body.setup_code || "").trim();
      if (!code || given.length !== code.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(code))) throw bad("Code d'installation incorrect. Il se trouve dans le fichier CODE-INSTALLATION.txt du dossier des données (ou dans le journal du serveur).");
      const name = str(req.body.maquis_name, "Nom du maquis", { required: true, max: 80 });
      const user = await auth.createUser({ user: null }, { role: "owner", username: req.body.username, full_name: req.body.full_name, phone: req.body.phone, password: req.body.password });
      setSetting("maquis_name", name);
      setSetting("installed_day", businessDay(now()));
      setSetting("setup_code", "");
      try {
        fs.rmSync(path.join(getDataDir(), "CODE-INSTALLATION.txt"), { force: true });
      } catch {}
      audit({ user: { id: user.id, full_name: user.full_name, role: "owner" }, ip: req.ip }, "installation", "settings", "", `Installation de MAQUIS PRO MANAGER pour « ${name} »`);
      const { token } = await auth.login({ username: user.username, password: req.body.password, device_id: req.body.device_id, device_label: req.body.device_label }, req);
      setCookie(req, res, token);
      return { ok: true };
    }),
  );

  const setCookie = (req, res, token) =>
    res.setHeader("Set-Cookie", `${auth.COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 86400}${PROD || req.secure ? "; Secure" : ""}`);

  api.post(
    "/auth/login",
    h(async (req, res) => {
      const { token, user } = await auth.login(req.body || {}, req);
      setCookie(req, res, token);
      return { user };
    }),
  );
  api.post(
    "/auth/logout",
    h((req, res) => {
      auth.logout(req);
      res.setHeader("Set-Cookie", `${auth.COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
      return { ok: true };
    }),
  );
  api.get("/me", need(), h((req) => ({ user: auth.publicUser(req.user) })));
  api.post("/me/password", need(), h(async (req) => auth.changeOwnPassword(ctxOf(req), req.body.current, req.body.password, req.session.id)));

  // Tout ce dont l'application a besoin au démarrage (gardé en mémoire pour le mode hors connexion).
  api.get(
    "/bootstrap",
    need(),
    h((req) => {
      const s = allSettings();
      const role = req.user.role;
      return {
        user: auth.publicUser(req.user),
        server_time: now(),
        business_day: businessDay(),
        settings: { maquis_name: s.maquis_name, address: s.address, phone: s.phone, receipt_footer: s.receipt_footer, logo: s.logo ? `/media/logo?v=${encodeURIComponent(s.logo)}` : "", payment_methods: cash.paymentMethods(), expense_categories: s.expense_categories, idle_minutes: s.idle_minutes },
        categories: catalog.listCategories(),
        products: catalog.listProducts(role, { includeInactive: role === "manager" || role === "owner" }),
        waiters: all("SELECT id, full_name FROM users WHERE role = 'waiter' AND active = 1 ORDER BY full_name"),
        suppliers: role === "manager" || role === "owner" ? all("SELECT id, name FROM suppliers WHERE active = 1 ORDER BY name") : [],
        cash_session: role === "cashier" ? (cash.openSessionOf(req.user.id) ? cash.sessionSummary(cash.openSessionOf(req.user.id).id) : null) : null,
        open_sessions: role === "manager" ? all("SELECT cs.id, u.full_name AS cashier FROM cash_sessions cs JOIN users u ON u.id = cs.cashier_id WHERE cs.status = 'open'") : [],
        unread: notif.unreadCount(req.user.id),
        vapid_key: notif.vapidPublicKey(),
        exit_labels: stock.EXIT_LABELS,
        notif_types: notif.NOTIF_TYPES,
      };
    }),
  );

  // ---------- Comptes, appareils, journaux (administration) ----------
  api.get("/users", need("owner", "manager"), h((req) => auth.listUsers(ctxOf(req))));
  api.post("/users", need("owner", "manager"), h((req) => auth.createUser(ctxOf(req), req.body)));
  api.patch("/users/:id", need("owner", "manager"), h((req) => auth.updateUser(ctxOf(req), id(req), req.body)));
  api.post("/users/:id/password", need("owner", "manager"), h((req) => auth.resetPassword(ctxOf(req), id(req), req.body.password)));
  api.get("/devices", need("owner", "manager"), h((req) => auth.listSessions(ctxOf(req)).map((s) => ({ ...s, current: s.id === req.session.id }))));
  api.delete("/devices/:id", need("owner", "manager"), h((req) => auth.revokeSession(ctxOf(req), id(req))));
  api.get(
    "/login-events",
    need("owner"),
    h(() => all("SELECT * FROM login_events ORDER BY id DESC LIMIT 300").map((e) => ({ ...e, device: auth.deviceName(e.user_agent) }))),
  );
  api.get(
    "/audit",
    need("owner"),
    h((req) => {
      const where = [];
      const p = [];
      if (isDay(req.query.from)) {
        where.push("at >= ?");
        p.push(dayBounds(req.query.from).start);
      }
      if (isDay(req.query.to)) {
        where.push("at < ?");
        p.push(dayBounds(req.query.to).end);
      }
      if (req.query.user_id) {
        where.push("user_id = ?");
        p.push(Number(req.query.user_id));
      }
      if (req.query.q) {
        where.push("(summary LIKE ? OR action LIKE ? OR user_name LIKE ?)");
        const q = `%${String(req.query.q).slice(0, 60)}%`;
        p.push(q, q, q);
      }
      return all(`SELECT id, at, user_name, role, action, entity, entity_id, summary, details, ip, device FROM audit_log ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT 400`, ...p);
    }),
  );
  api.get("/audit/verify", need("owner"), h(() => verifyAuditChain()));

  api.get(
    "/settings",
    need("owner", "manager"),
    h(() => {
      const s = allSettings();
      return { maquis_name: s.maquis_name, address: s.address, phone: s.phone, receipt_footer: s.receipt_footer, logo: s.logo ? `/media/logo?v=${encodeURIComponent(s.logo)}` : "", payment_methods: cash.paymentMethods(), expense_categories: s.expense_categories, idle_minutes: s.idle_minutes, installed_day: s.installed_day, last_backup: s.last_backup || null };
    }),
  );
  api.put(
    "/settings",
    need("owner"),
    h((req) => {
      const b = req.body || {};
      const changes = {};
      tx(() => {
        for (const k of ["maquis_name", "address", "phone", "receipt_footer"]) {
          if (b[k] !== undefined) changes[k] = str(b[k], k === "maquis_name" ? "Nom du maquis" : k, { max: k === "receipt_footer" ? 200 : 120, required: k === "maquis_name" });
        }
        if (b.payment_methods !== undefined) {
          const list = [...new Set((Array.isArray(b.payment_methods) ? b.payment_methods : []).map((m) => str(m, "Mode de paiement", { max: 40 })).filter(Boolean))];
          if (!list.includes(cash.CASH)) list.unshift(cash.CASH);
          changes.payment_methods = list.slice(0, 12);
        }
        if (b.expense_categories !== undefined) changes.expense_categories = [...new Set((Array.isArray(b.expense_categories) ? b.expense_categories : []).map((m) => str(m, "Catégorie", { max: 60 })).filter(Boolean))].slice(0, 40);
        if (b.idle_minutes !== undefined) {
          const cur = allSettings().idle_minutes;
          changes.idle_minutes = Object.fromEntries(auth.ROLES.map((r) => [r, int(b.idle_minutes?.[r] ?? cur[r], `Déconnexion automatique (${auth.ROLE_LABELS[r]})`, { min: 5, max: 10080 })]));
        }
        for (const [k, v] of Object.entries(changes)) setSetting(k, v);
        audit(ctxOf(req), "parametres_modifies", "settings", "", "Paramètres généraux modifiés", changes);
      });
      return { ok: true };
    }),
  );
  api.post(
    "/settings/logo",
    need("owner"),
    h((req) => {
      const { buf, ext } = catalog.decodeImage(req.body.image, { allowWebp: false });
      const name = `logo-${crypto.randomBytes(5).toString("hex")}.${ext}`;
      fs.writeFileSync(path.join(getDataDir(), "uploads", name), buf);
      setSetting("logo", name);
      audit(ctxOf(req), "logo_modifie", "settings", "", "Logo du maquis modifié");
      return { logo: `/media/logo?v=${name}` };
    }),
  );
  api.get("/backups", need("owner"), h(() => ({ backups: listBackups(), last: allSettings().last_backup || null })));
  api.post(
    "/backups",
    need("owner"),
    h((req) => {
      const b = backupNow("manuelle");
      audit(ctxOf(req), "sauvegarde", "backup", b.name, `Sauvegarde ${b.name} créée`);
      return b;
    }),
  );
  api.get("/backups/:name", need("owner"), (req, res, next) => {
    try {
      const file = backupPath(req.params.name);
      audit(ctxOf(req), "sauvegarde_telechargee", "backup", req.params.name, `Sauvegarde ${req.params.name} téléchargée`);
      res.download(file);
    } catch (e) {
      next(e);
    }
  });

  // ---------- Catalogue ----------
  api.get("/categories", need(), h(() => catalog.listCategories()));
  api.post("/categories", need("manager"), h((req) => catalog.createCategory(ctxOf(req), req.body)));
  api.patch("/categories/:id", need("manager"), h((req) => catalog.updateCategory(ctxOf(req), id(req), req.body)));
  api.get("/products", need(), h((req) => catalog.listProducts(req.user.role, { includeInactive: req.query.all === "1" && ["owner", "manager"].includes(req.user.role) })));
  api.get("/products/:id", need(), h((req) => catalog.getProduct(id(req), req.user.role)));
  api.post("/products", need("manager"), h((req) => catalog.createProduct(ctxOf(req), req.body)));
  api.patch("/products/:id", need("manager"), h((req) => catalog.updateProduct(ctxOf(req), id(req), req.body)));
  api.post("/products/:id/photo", need("manager"), h((req) => catalog.setProductPhoto(ctxOf(req), id(req), req.body.image)));
  api.get(
    "/products/:id/history",
    need("owner", "manager"),
    h((req) => ({ product: catalog.getProduct(id(req)), movements: stock.movementJournal({ product_id: id(req), from: req.query.from, to: req.query.to, limit: 500 }), prices: catalog.priceHistory(id(req)) })),
  );

  api.get("/suppliers", need("owner", "manager"), h(() => catalog.listSuppliers()));
  api.get("/suppliers/:id", need("owner", "manager"), h((req) => catalog.getSupplier(id(req))));
  api.post("/suppliers", need("manager"), h((req) => catalog.createSupplier(ctxOf(req), req.body)));
  api.patch("/suppliers/:id", need("manager"), h((req) => catalog.updateSupplier(ctxOf(req), id(req), req.body)));
  api.post("/suppliers/:id/payments", need("manager"), op((req, ctx) => stock.createSupplierPayment(ctx, id(req), req.body)));

  // ---------- Stock ----------
  api.get("/stock", need("owner", "manager"), h(() => stock.stockList()));
  api.get("/movements", need("owner", "manager"), h((req) => stock.movementJournal(req.query)));
  api.get("/entries", need("owner", "manager"), h((req) => stock.listEntries(req.query)));
  api.get("/entries/:id", need("owner", "manager"), h((req) => stock.getEntry(id(req))));
  api.post("/entries", need("manager"), op((req, ctx) => stock.createEntry(ctx, req.body)));
  api.post("/entries/:id/cancel", need("manager"), h((req) => stock.cancelEntry(ctxOf(req), id(req), req.body)));
  api.get("/exits", need("owner", "manager"), h((req) => stock.listExits(req.query)));
  api.get("/exits/:id", need("owner", "manager"), h((req) => stock.getExit(id(req))));
  api.post("/exits", need("manager"), op((req, ctx) => stock.createExit(ctx, req.body)));
  api.post("/exits/:id/cancel", need("manager"), h((req) => stock.cancelExit(ctxOf(req), id(req), req.body)));
  api.get("/inventories", need("owner", "manager"), h(() => stock.listInventories()));
  api.get("/inventories/:id", need("owner", "manager"), h((req) => stock.getInventory(id(req))));
  api.post("/inventories", need("manager"), h((req) => stock.createInventory(ctxOf(req), req.body)));
  api.put("/inventories/:id", need("manager"), h((req) => stock.saveInventoryCounts(ctxOf(req), id(req), req.body)));
  api.post("/inventories/:id/validate", need("manager"), h((req) => stock.validateInventory(ctxOf(req), id(req))));
  api.post("/inventories/:id/abandon", need("manager"), h((req) => stock.abandonInventory(ctxOf(req), id(req))));
  api.get("/consignments", need("owner", "manager"), h(() => stock.consignmentSummary()));
  api.post("/consignments", need("manager"), op((req, ctx) => stock.createConsignment(ctx, req.body)));

  // ---------- Commandes, ventes, crédits ----------
  api.get("/orders", need(), h((req) => sales.listOrders(ctxOf(req), req.query)));
  api.get("/orders/:id", need(), h((req) => {
    const o = sales.getOrder(id(req));
    if (req.user.role === "waiter" && o.waiter_id !== req.user.id) throw forbidden();
    return o;
  }));
  api.post("/orders", need("waiter"), op((req, ctx) => sales.createOrder(ctx, req.body)));
  api.post("/orders/:id/cancel", need("waiter", "cashier", "manager"), h((req) => sales.cancelOrder(ctxOf(req), id(req), req.body)));
  api.get("/sales", need(), h((req) => sales.listSales(ctxOf(req), req.query)));
  api.get("/sales/:id", need(), h((req) => sales.getSale(ctxOf(req), id(req))));
  api.post("/sales", need("cashier"), op((req, ctx) => sales.createSale(ctx, req.body)));
  api.post("/sales/:id/payments", need("cashier"), op((req, ctx) => sales.addSalePayment(ctx, id(req), req.body)));
  api.post("/sales/:id/cancel", need("cashier", "manager"), h((req) => sales.cancelSale(ctxOf(req), id(req), req.body)));
  api.get("/credits", need("owner", "manager", "cashier"), h(() => sales.listCredits()));
  api.get(
    "/my-stats",
    need("waiter"),
    h((req) => {
      const day = businessDay();
      const s = get(
        "SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS amount FROM sales WHERE waiter_id = ? AND business_day = ? AND status != 'cancelled'",
        req.user.id, day,
      );
      const bottles = get("SELECT COALESCE(-SUM(qty), 0) AS v FROM stock_movements WHERE kind = 'sale' AND waiter_id = ? AND business_day = ?", req.user.id, day).v;
      const orders = all("SELECT status, COUNT(*) AS n FROM orders WHERE waiter_id = ? AND business_day = ? GROUP BY status", req.user.id, day);
      const byProduct = all(
        "SELECT p.brand, p.name, -SUM(m.qty) AS qty FROM stock_movements m JOIN products p ON p.id = m.product_id WHERE m.kind = 'sale' AND m.waiter_id = ? AND m.business_day = ? GROUP BY m.product_id ORDER BY qty DESC",
        req.user.id, day,
      );
      return { day, sales: s.n, amount: s.amount, bottles, orders: Object.fromEntries(orders.map((o) => [o.status, o.n])), by_product: byProduct };
    }),
  );

  // ---------- Caisse et dépenses ----------
  api.get("/cash/current", need("cashier"), h((req) => {
    const s = cash.openSessionOf(req.user.id);
    return { session: s ? cash.getSession(ctxOf(req), s.id) : null };
  }));
  api.post("/cash/open", need("cashier"), op((req, ctx) => cash.openSession(ctx, req.body)));
  api.post("/cash/close", need("cashier", "manager"), h((req) => cash.closeSession(ctxOf(req), req.body)));
  api.post("/cash/movements", need("cashier", "manager"), op((req, ctx) => cash.addCashMovement(ctx, req.body)));
  api.get("/cash/sessions", need("owner", "manager", "cashier"), h((req) => cash.listSessions(ctxOf(req), req.query)));
  api.get("/cash/sessions/:id", need("owner", "manager", "cashier"), h((req) => cash.getSession(ctxOf(req), id(req))));
  api.get("/expenses", need("owner", "manager", "cashier"), h((req) => cash.listExpenses(ctxOf(req), req.query)));
  api.post("/expenses", need("cashier", "manager"), op((req, ctx) => cash.createExpense(ctx, req.body)));
  api.post("/expenses/:id/cancel", need("manager"), h((req) => cash.cancelExpense(ctxOf(req), id(req), req.body)));

  // ---------- Reçus et documents ----------
  const docFor = (req) => {
    const d = docs.getDocument(req.params.no);
    if (!docs.canSeeDocument(req.user, d)) throw forbidden();
    return d;
  };
  api.get("/documents", need(), h((req) => docs.searchDocuments(req.user, req.query)));
  api.get("/documents/:no", need(), h((req) => {
    const d = docFor(req);
    return { ...d, related: all("SELECT doc_no, title FROM documents WHERE rectifies = ? OR doc_no = ?", d.doc_no, d.rectifies || "") };
  }));
  api.get("/documents/:no/pdf", need(), async (req, res, next) => {
    try {
      const d = docFor(req);
      const pdf = d.type === "daily_report" || d.type === "weekly_report" ? await renderReportPdf(reports.getReport(d.payload.report_id)) : await renderDocumentPdf(d);
      sendFile(res, pdf, "application/pdf", `${d.doc_no}.pdf`, req.query.inline === "1");
    } catch (e) {
      next(e);
    }
  });
  api.get("/documents/:no/print", need(), (req, res, next) => {
    try {
      res.type("html").send(printHtml(docFor(req)));
    } catch (e) {
      next(e);
    }
  });

  // ---------- Rapports ----------
  api.get("/reports", need("owner", "manager"), h((req) => reports.listReports(req.query)));
  api.get("/reports/status", need("owner", "manager"), h(() => reports.reportStatus()));
  api.post("/reports/run", need("owner", "manager"), h(() => ({ generated: reports.runDueReports() })));
  api.get(
    "/reports/preview",
    need("owner", "manager"),
    h((req) => {
      const kind = req.query.kind === "weekly" ? "weekly" : "daily";
      const key = isDay(req.query.key) ? req.query.key : businessDay();
      const data = kind === "daily" ? reports.computeDaily(key) : reports.computeWeekly(key);
      return { kind, period_key: key, preview: true, data: { ...data, generated_label: fmtDateTime(now()), version: 0 } };
    }),
  );
  api.get("/reports/:id", need("owner", "manager"), h((req) => reports.getReport(id(req))));
  api.get("/reports/:id/pdf", need("owner", "manager"), async (req, res, next) => {
    try {
      const r = reports.getReport(id(req));
      sendFile(res, await renderReportPdf(r), "application/pdf", `${r.doc_no}.pdf`, req.query.inline === "1");
    } catch (e) {
      next(e);
    }
  });
  api.get("/reports/:id/xlsx", need("owner", "manager"), (req, res, next) => {
    try {
      const r = reports.getReport(id(req));
      sendFile(res, reportToXlsx(r), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", `${r.doc_no}.xlsx`);
    } catch (e) {
      next(e);
    }
  });

  api.get("/dashboard", need("owner", "manager"), h((req) => dashboard(ctxOf(req), req.query)));

  // ---------- Notifications ----------
  api.get("/notifications", need(), h((req) => notif.listNotifications(req.user.id, { before: req.query.before ? Number(req.query.before) : undefined })));
  api.post("/notifications/read", need(), h((req) => ({ unread: notif.markRead(req.user.id, req.body.all ? "all" : req.body.ids) })));
  api.get("/notifications/prefs", need(), h((req) => ({ prefs: notif.getPrefs(req.user.id), types: notif.NOTIF_TYPES })));
  api.put("/notifications/prefs", need(), h((req) => ({ prefs: notif.setPrefs(req.user.id, req.body.prefs) })));
  api.get("/push/key", need(), h(() => ({ key: notif.vapidPublicKey() })));
  api.post("/push/subscribe", need(), h((req) => ({ ok: notif.saveSubscription(req.user.id, req.body.subscription, String(req.headers["user-agent"] || "")) })));
  api.post("/push/unsubscribe", need(), h((req) => notif.removeSubscription(req.user.id, req.body.endpoint)));
  api.get("/events", need(), (req, res) => {
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    res.write(`event: hello\ndata: {}\n\n`);
    const send = (ev) => {
      if (ev.userId && ev.userId !== req.user.id) return;
      if (ev.roles && !ev.roles.includes(req.user.role)) return;
      res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev.data || {})}\n\n`);
    };
    notif.bus.on("event", send);
    const ping = setInterval(() => res.write(": ping\n\n"), 25000);
    req.on("close", () => {
      notif.bus.off("event", send);
      clearInterval(ping);
    });
  });

  api.use((req, res, next) => next(notFound("Adresse d'API inconnue.")));
  app.use("/api", api);

  // ---------- Images (comptes connectés uniquement) ----------
  const mediaAuth = (req, res, next) => (auth.sessionFromRequest(req) ? next() : res.status(401).end());
  app.get("/media/logo", mediaAuth, (req, res) => {
    const logo = allSettings().logo;
    const file = logo && path.join(getDataDir(), "uploads", path.basename(logo));
    if (!file || !fs.existsSync(file)) return res.status(404).end();
    res.set("Cache-Control", "private, max-age=604800").sendFile(file);
  });
  app.get("/media/products/:name", mediaAuth, (req, res) => {
    if (!/^p\d+-[a-f0-9]{12}\.(png|jpg|webp)$/.test(req.params.name)) return res.status(404).end();
    const file = path.join(getDataDir(), "uploads", "products", req.params.name);
    if (!fs.existsSync(file)) return res.status(404).end();
    res.set("Cache-Control", "private, max-age=2592000, immutable").sendFile(file);
  });

  // ---------- Application (PWA) ----------
  app.use(
    express.static(PUBLIC, {
      index: "index.html",
      setHeaders: (res, file) => {
        if (/(sw\.js|index\.html|manifest\.webmanifest)$/.test(file)) res.setHeader("Cache-Control", "no-cache");
        else res.setHeader("Cache-Control", "public, max-age=300");
      },
    }),
  );

  app.use((err, req, res, next) => {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
    if (err?.type === "entity.too.large") return res.status(413).json({ error: "Fichier trop lourd." });
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Données illisibles." });
    const msg = String(err?.message || "");
    if (/interdite|non modifiables|définitif/.test(msg)) return res.status(409).json({ error: msg });
    if (/UNIQUE constraint failed: cash_sessions/.test(msg)) return res.status(409).json({ error: "Votre caisse est déjà ouverte." });
    console.error("Erreur :", err);
    res.status(500).json({ error: "Erreur interne du serveur. L'opération n'a pas été enregistrée." });
  });

  return app;
}

function sendFile(res, buf, type, name, inline = false) {
  res.set({ "Content-Type": type, "Content-Length": buf.length, "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`, "Cache-Control": "private, no-store" });
  res.end(buf);
}

const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Version imprimable (ticket 80 mm ou A4) d'un reçu, à partir du contenu figé.
function printHtml(d) {
  const p = d.payload;
  const logo = allSettings().logo ? `<img class="logo" src="/media/logo" alt="">` : "";
  const fields = [["Responsable", p.responsible], ...(p.fields || [])].map(([k, v]) => `<div class="f"><span>${escHtml(k)}</span><b>${escHtml(v)}</b></div>`).join("");
  const table =
    p.columns && p.rows
      ? `<table><thead><tr>${p.columns.map((c) => `<th class="${c.align === "right" ? "r" : ""}">${escHtml(c.label)}</th>`).join("")}</tr></thead><tbody>${p.rows
          .map((r) => `<tr>${r.map((c, i) => `<td class="${p.columns[i]?.align === "right" ? "r" : ""}">${escHtml(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`
      : "";
  const totals = (p.totals || []).map(([k, v, b]) => `<div class="t${b ? " b" : ""}"><span>${escHtml(k)}</span><span>${escHtml(v)}</span></div>`).join("");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(p.doc_no)}</title>
<link rel="stylesheet" href="/print.css"></head><body>
<div class="bar noprint"><button id="print">Imprimer</button> <label><input type="checkbox" id="ticket" checked> Ticket 80 mm</label></div>
<main class="ticket">${logo}<h1>${escHtml(p.maquis?.name)}</h1><p class="m">${escHtml([p.maquis?.address, p.maquis?.phone].filter(Boolean).join(" · "))}</p>
<h2>${escHtml(p.title)}</h2><p class="m">N° ${escHtml(p.doc_no)}<br>${escHtml(fmtDateTime(p.at))}</p>
${p.rectifies ? `<p class="warn">Document rectificatif du ${escHtml(p.rectifies)}</p>` : ""}
<div class="fields">${fields}</div>${table}<div class="totals">${totals}</div>
${p.status ? `<p class="status ${escHtml(p.status.tone)}">${escHtml(p.status.label)}</p>` : ""}
${(p.notes || []).map((n) => `<p class="note">${escHtml(n)}</p>`).join("")}
<p class="foot">${escHtml(p.maquis?.footer || "")}</p><p class="m small">Empreinte ${escHtml(String(d.hash).slice(0, 16))}</p></main>
<script src="/print.js"></script></body></html>`;
}
