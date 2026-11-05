// Journal d'audit : qui, quand, quoi, depuis quel appareil. Chaque ligne contient l'empreinte
// de la précédente (chaîne) : une ligne retouchée directement dans le fichier se détecte.
import crypto from "node:crypto";
import { get, run, all } from "./db.js";
import { now } from "./time.js";

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const GENESIS = "0".repeat(64);

function rowHash(prev, r) {
  return sha([prev, r.at, r.user_id ?? "", r.user_name, r.role, r.action, r.entity, r.entity_id, r.summary, r.details, r.ip, r.device].join("|"));
}

export function audit(ctx, action, entity = "", entityId = "", summary = "", details = {}) {
  const prev = get("SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1")?.hash || GENESIS;
  const r = {
    at: now(),
    user_id: ctx?.user?.id ?? null,
    user_name: ctx?.user?.full_name || ctx?.user?.username || "Système",
    role: ctx?.user?.role || "system",
    action,
    entity,
    entity_id: entityId === null || entityId === undefined ? "" : String(entityId),
    summary,
    details: JSON.stringify(ctx?.offline ? { ...(details ?? {}), hors_connexion: { survenu_le: ctx.at ?? null } } : details ?? {}),
    ip: ctx?.ip || "",
    device: ctx?.device || "",
  };
  const hash = rowHash(prev, r);
  run(
    `INSERT INTO audit_log (at, user_id, user_name, role, action, entity, entity_id, summary, details, ip, device, prev_hash, hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    r.at, r.user_id, r.user_name, r.role, r.action, r.entity, r.entity_id, r.summary, r.details, r.ip, r.device, prev, hash,
  );
}

export function verifyAuditChain() {
  let prev = GENESIS;
  let count = 0;
  for (const r of all("SELECT * FROM audit_log ORDER BY id")) {
    if (r.prev_hash !== prev || rowHash(prev, r) !== r.hash) return { ok: false, count, broken_at: r.id };
    prev = r.hash;
    count++;
  }
  return { ok: true, count };
}
