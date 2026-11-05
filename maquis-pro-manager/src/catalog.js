// Catalogue : catégories, produits (fiche complète) et fournisseurs.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { all, get, run, tx, getDataDir } from "./db.js";
import { now, businessDay } from "./time.js";
import { audit } from "./audit.js";
import { bad, notFound, str, int, pname } from "./util.js";

// ---------- Catégories ----------
export const listCategories = () => all("SELECT * FROM categories ORDER BY sort, name");

export function createCategory(ctx, body) {
  const name = str(body.name, "Nom de la catégorie", { required: true, max: 60 });
  if (get("SELECT 1 FROM categories WHERE name = ?", name)) throw bad("Cette catégorie existe déjà.");
  return tx(() => {
    const id = Number(run("INSERT INTO categories (name, sort) VALUES (?, ?)", name, int(body.sort, "Ordre", { required: false, def: 100 })).lastInsertRowid);
    audit(ctx, "categorie_creee", "category", id, `Catégorie « ${name} » créée`);
    return get("SELECT * FROM categories WHERE id = ?", id);
  });
}

export function updateCategory(ctx, id, body) {
  const c = get("SELECT * FROM categories WHERE id = ?", id);
  if (!c) throw notFound("Catégorie introuvable.");
  const name = body.name !== undefined ? str(body.name, "Nom", { required: true, max: 60 }) : c.name;
  const active = body.active !== undefined ? (body.active ? 1 : 0) : c.active;
  return tx(() => {
    run("UPDATE categories SET name = ?, active = ? WHERE id = ?", name, active, id);
    audit(ctx, "categorie_modifiee", "category", id, `Catégorie « ${name} » modifiée`);
    return get("SELECT * FROM categories WHERE id = ?", id);
  });
}

// ---------- Produits ----------
const PRODUCT_SELECT = `
  SELECT p.*, c.name AS category, s.name AS supplier,
    COALESCE((SELECT SUM(qty) FROM stock_movements m WHERE m.product_id = p.id), 0) AS stock
  FROM products p JOIN categories c ON c.id = p.category_id LEFT JOIN suppliers s ON s.id = p.supplier_id`;

// Les serveurs et caissiers ne voient pas les prix d'achat.
export function shapeProduct(p, role) {
  const out = { ...p, stock_value: p.stock * p.purchase_price, stock_sale_value: p.stock * p.sale_price, low: p.stock <= p.min_stock };
  if (role === "waiter" || role === "cashier") {
    delete out.purchase_price;
    delete out.stock_value;
  }
  return out;
}

export function listProducts(role, { includeInactive = false } = {}) {
  return all(`${PRODUCT_SELECT} ${includeInactive ? "" : "WHERE p.active = 1"} ORDER BY c.sort, p.brand, p.name`).map((p) => shapeProduct(p, role));
}
export function getProduct(id, role = "manager") {
  const p = get(`${PRODUCT_SELECT} WHERE p.id = ?`, id);
  if (!p) throw notFound("Produit introuvable.");
  return shapeProduct(p, role);
}
export const productRow = (id) => get("SELECT * FROM products WHERE id = ?", id);

function productFields(body, current = {}) {
  const pick = (k, fn) => (body[k] !== undefined ? fn(body[k]) : current[k]);
  const f = {
    name: pick("name", (v) => str(v, "Nom de la boisson", { required: true, max: 80 })),
    brand: pick("brand", (v) => str(v, "Marque", { required: true, max: 60 })),
    category_id: pick("category_id", (v) => int(v, "Catégorie", { min: 1 })),
    reference: pick("reference", (v) => str(v, "Référence", { max: 40 })),
    purchase_price: pick("purchase_price", (v) => int(v, "Prix d'achat", { min: 0, max: 10_000_000 })),
    sale_price: pick("sale_price", (v) => int(v, "Prix de vente", { min: 0, max: 10_000_000 })),
    units_per_crate: pick("units_per_crate", (v) => int(v, "Bouteilles par casier", { min: 1, max: 500 })),
    pack_label: pick("pack_label", (v) => (["casier", "pack", "carton"].includes(v) ? v : "casier")),
    min_stock: pick("min_stock", (v) => int(v, "Stock minimum", { min: 0, max: 1_000_000 })),
    supplier_id: pick("supplier_id", (v) => (v === null || v === "" ? null : int(v, "Fournisseur", { min: 1 }))),
  };
  for (const k of ["name", "brand", "category_id", "purchase_price", "sale_price"]) if (f[k] === undefined || f[k] === null || f[k] === "") throw bad(`Champ manquant : ${k}`);
  if (!get("SELECT 1 FROM categories WHERE id = ?", f.category_id)) throw bad("Catégorie inconnue.");
  if (f.supplier_id && !get("SELECT 1 FROM suppliers WHERE id = ?", f.supplier_id)) throw bad("Fournisseur inconnu.");
  f.supplier_id ??= null;
  f.reference ??= "";
  f.units_per_crate ??= 12;
  f.pack_label ??= "casier";
  f.min_stock ??= 0;
  return f;
}

export function createProduct(ctx, body) {
  const f = productFields(body);
  const initialCrates = int(body.initial_crates, "Stock initial (casiers)", { required: false, def: 0, min: 0, max: 100000 });
  const initialUnits = int(body.initial_units, "Stock initial (bouteilles)", { required: false, def: 0, min: 0, max: 1000000 });
  const initial = initialCrates * f.units_per_crate + initialUnits;
  return tx(() => {
    const t = ctx.at || now();
    const ref = f.reference || `TMP-${crypto.randomBytes(4).toString("hex")}`;
    if (get("SELECT 1 FROM products WHERE reference = ?", ref)) throw bad("Cette référence est déjà utilisée.");
    const id = Number(
      run(
        `INSERT INTO products (name, brand, category_id, reference, purchase_price, sale_price, units_per_crate, pack_label, min_stock, supplier_id, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        f.name, f.brand, f.category_id, ref, f.purchase_price, f.sale_price, f.units_per_crate, f.pack_label, f.min_stock, f.supplier_id, t, t,
      ).lastInsertRowid,
    );
    if (!f.reference) run("UPDATE products SET reference = ? WHERE id = ?", `P${String(id).padStart(4, "0")}`, id);
    run("INSERT INTO price_history (product_id, purchase_price, sale_price, at, user_id) VALUES (?,?,?,?,?)", id, f.purchase_price, f.sale_price, t, ctx.user.id);
    if (initial > 0) {
      run(
        `INSERT INTO stock_movements (at, business_day, product_id, qty, kind, unit_cost, unit_price, ref_type, ref_id, user_id, note, created_at)
         VALUES (?,?,?,?,'initial',?,?,'product',?,?,?,?)`,
        t, businessDay(t), id, initial, f.purchase_price, f.sale_price, id, ctx.user.id, "Stock initial", now(),
      );
    }
    audit(ctx, "produit_cree", "product", id, `Produit créé : ${pname(f)} (stock initial ${initial})`, { ...f, stock_initial: initial });
    return getProduct(id);
  });
}

export function updateProduct(ctx, id, body) {
  const cur = productRow(id);
  if (!cur) throw notFound("Produit introuvable.");
  const f = productFields(body, cur);
  if (!f.reference) f.reference = cur.reference;
  if (f.reference !== cur.reference && get("SELECT 1 FROM products WHERE reference = ? AND id != ?", f.reference, id)) throw bad("Cette référence est déjà utilisée.");
  const active = body.active !== undefined ? (body.active ? 1 : 0) : cur.active;
  return tx(() => {
    const t = now();
    run(
      `UPDATE products SET name=?, brand=?, category_id=?, reference=?, purchase_price=?, sale_price=?, units_per_crate=?, pack_label=?, min_stock=?, supplier_id=?, active=?, updated_at=? WHERE id=?`,
      f.name, f.brand, f.category_id, f.reference, f.purchase_price, f.sale_price, f.units_per_crate, f.pack_label, f.min_stock, f.supplier_id, active, t, id,
    );
    if (f.purchase_price !== cur.purchase_price || f.sale_price !== cur.sale_price)
      run("INSERT INTO price_history (product_id, purchase_price, sale_price, at, user_id) VALUES (?,?,?,?,?)", id, f.purchase_price, f.sale_price, t, ctx.user.id);
    const changes = {};
    for (const k of Object.keys(f)) if (f[k] !== cur[k]) changes[k] = { avant: cur[k], apres: f[k] };
    if (active !== cur.active) changes.active = { avant: !!cur.active, apres: !!active };
    audit(ctx, "produit_modifie", "product", id, `Produit modifié : ${pname(f)}`, changes);
    return getProduct(id);
  });
}

export const priceHistory = (id) =>
  all("SELECT h.*, u.full_name AS user_name FROM price_history h LEFT JOIN users u ON u.id = h.user_id WHERE product_id = ? ORDER BY h.id DESC LIMIT 100", id);

// Photos et logo : uniquement PNG, JPEG ou WebP (vérifiés sur le contenu réel), 3 Mo max.
export function decodeImage(dataUrl, { allowWebp = true } = {}) {
  const m = /^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) throw bad("Image invalide (PNG ou JPEG attendu).");
  const buf = Buffer.from(m[3], "base64");
  if (buf.length > 3 * 1024 * 1024) throw bad("Image trop lourde (3 Mo maximum).");
  const isPng = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isWebp = buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP";
  if (!(isPng || isJpg || (allowWebp && isWebp))) throw bad("Format d'image non reconnu.");
  return { buf, ext: isPng ? "png" : isJpg ? "jpg" : "webp" };
}

export function setProductPhoto(ctx, id, dataUrl) {
  const cur = productRow(id);
  if (!cur) throw notFound("Produit introuvable.");
  const { buf, ext } = decodeImage(dataUrl);
  const name = `p${id}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
  fs.writeFileSync(path.join(getDataDir(), "uploads", "products", name), buf);
  tx(() => {
    run("UPDATE products SET photo = ?, updated_at = ? WHERE id = ?", name, now(), id);
    audit(ctx, "produit_photo", "product", id, `Photo de ${pname(cur)} mise à jour`);
  });
  return getProduct(id);
}

// ---------- Fournisseurs ----------
export function listSuppliers() {
  return all(
    `SELECT s.*,
      COALESCE((SELECT SUM(total_amount) FROM entries e WHERE e.supplier_id = s.id AND e.status = 'valid'), 0) AS purchases,
      COALESCE((SELECT SUM(paid_amount) FROM entries e WHERE e.supplier_id = s.id AND e.status = 'valid'), 0)
        + COALESCE((SELECT SUM(amount) FROM supplier_payments sp WHERE sp.supplier_id = s.id), 0) AS paid
     FROM suppliers s ORDER BY s.active DESC, s.name`,
  ).map((s) => ({ ...s, debt: s.purchases - s.paid }));
}

export function getSupplier(id) {
  const s = listSuppliers().find((x) => x.id === Number(id));
  if (!s) throw notFound("Fournisseur introuvable.");
  return {
    ...s,
    entries: all(
      "SELECT e.id, e.doc_no, e.at, e.invoice_no, e.total_amount, e.paid_amount, e.status, u.full_name AS user_name FROM entries e JOIN users u ON u.id = e.user_id WHERE supplier_id = ? ORDER BY at DESC LIMIT 200",
      id,
    ),
    payments: all("SELECT p.*, u.full_name AS user_name FROM supplier_payments p JOIN users u ON u.id = p.user_id WHERE supplier_id = ? ORDER BY at DESC LIMIT 200", id),
    consignments: all("SELECT * FROM consignments WHERE supplier_id = ? ORDER BY at DESC LIMIT 200", id),
  };
}

export function createSupplier(ctx, body) {
  const name = str(body.name, "Nom du fournisseur", { required: true, max: 80 });
  return tx(() => {
    const id = Number(
      run(
        "INSERT INTO suppliers (name, phone, address, notes, created_at) VALUES (?,?,?,?,?)",
        name, str(body.phone, "Téléphone", { max: 40 }), str(body.address, "Adresse", { max: 200 }), str(body.notes, "Notes", { max: 500 }), now(),
      ).lastInsertRowid,
    );
    audit(ctx, "fournisseur_cree", "supplier", id, `Fournisseur créé : ${name}`);
    return get("SELECT * FROM suppliers WHERE id = ?", id);
  });
}

export function updateSupplier(ctx, id, body) {
  const s = get("SELECT * FROM suppliers WHERE id = ?", id);
  if (!s) throw notFound("Fournisseur introuvable.");
  const f = {
    name: body.name !== undefined ? str(body.name, "Nom", { required: true, max: 80 }) : s.name,
    phone: body.phone !== undefined ? str(body.phone, "Téléphone", { max: 40 }) : s.phone,
    address: body.address !== undefined ? str(body.address, "Adresse", { max: 200 }) : s.address,
    notes: body.notes !== undefined ? str(body.notes, "Notes", { max: 500 }) : s.notes,
    active: body.active !== undefined ? (body.active ? 1 : 0) : s.active,
  };
  return tx(() => {
    run("UPDATE suppliers SET name=?, phone=?, address=?, notes=?, active=? WHERE id=?", f.name, f.phone, f.address, f.notes, f.active, id);
    audit(ctx, "fournisseur_modifie", "supplier", id, `Fournisseur modifié : ${f.name}`);
    return get("SELECT * FROM suppliers WHERE id = ?", id);
  });
}
