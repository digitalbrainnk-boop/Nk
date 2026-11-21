// Registre des lignes : création, restauration au démarrage, suppression.
// Chaque ligne vit dans data/sessions/<id>/ :
//   meta.json   nom affiché, couleur, numéro relié
//   auth/       clés WhatsApp de CETTE ligne (Baileys multi-file auth state)
//   store.json  discussions et derniers messages de CETTE ligne
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { fetchLatestBaileysVersion } from "baileys";
import { AppError, badRequest, conflict, notFound } from "../errors.js";
import { normalizePhone } from "./jid.js";
import { WhatsAppSession } from "./WhatsAppSession.js";

export const SESSION_ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const PALETTE = ["#16a34a", "#2563eb", "#d97706", "#dc2626", "#7c3aed", "#db2777", "#0d9488", "#ea580c", "#4f46e5", "#65a30d"];
const WA_VERSION_TTL_MS = 6 * 60 * 60 * 1000;

export function validateSessionId(raw) {
  const id = String(raw ?? "").trim().toLowerCase();
  if (!SESSION_ID_RE.test(id)) {
    throw badRequest("Identifiant de ligne invalide : lettres minuscules, chiffres, « - » ou « _ » (40 caractères max).", "invalid_session_id");
  }
  return id;
}

export function cleanLabel(raw) {
  const label = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (label.length > 40) throw badRequest("Nom trop long (40 caractères maximum).", "invalid_label");
  return label;
}

export class SessionManager extends EventEmitter {
  constructor({ config, logger }) {
    super();
    this.config = config;
    this.log = logger.child({ module: "sessions" });
    this.rootLogger = logger;
    this.sessions = new Map();
    this.waVersion = null;
    this.waVersionPromise = null;
  }

  /**
   * Recharge les lignes existantes. Avec resume=false, la reconnexion est faite
   * plus tard par resumeLinked() (une fois le port HTTP obtenu : on évite ainsi
   * qu'une 2e copie du serveur coupe les lignes de la 1re).
   */
  async init({ resume = true } = {}) {
    fs.mkdirSync(this.config.sessionsDir, { recursive: true });
    const entries = fs.readdirSync(this.config.sessionsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !SESSION_ID_RE.test(entry.name)) continue;
      const dir = path.join(this.config.sessionsDir, entry.name);
      let meta;
      try {
        meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
      } catch {
        meta = { label: entry.name, color: this.nextColor(), createdAt: fs.statSync(dir).birthtimeMs || Date.now(), autoStart: true };
      }
      this.instantiate(entry.name, dir, meta);
    }
    this.log.info({ count: this.sessions.size }, "Lignes chargées");
    if (resume) this.resumeLinked();
  }

  /** Reconnecte les lignes déjà reliées, de façon échelonnée. */
  resumeLinked() {
    let delay = 0;
    for (const session of this.sessions.values()) {
      if (!session.linked || session.meta.autoStart === false) continue;
      setTimeout(() => {
        session.resume().catch((err) => this.log.error({ err, session: session.id }, "Reprise impossible"));
      }, delay).unref?.();
      delay += 1500;
    }
  }

  instantiate(id, dir, meta) {
    const session = new WhatsAppSession({
      id,
      dir,
      meta,
      config: this.config,
      logger: this.rootLogger,
      getWaVersion: () => this.getWaVersion(),
    });
    // Chaque événement repart étiqueté avec l'identifiant de SA ligne.
    session.on("update", (summary) => this.emit("session:update", summary));
    session.on("message", ({ chat, message, notify = false }) => this.emit("message:new", { sessionId: id, chat, message, notify }));
    session.on("message-update", ({ chat, message }) => this.emit("message:update", { sessionId: id, chat, message }));
    session.on("chat-update", ({ chat }) => chat && this.emit("chat:update", { sessionId: id, chat }));
    session.on("chats-reset", () => this.emit("chats:reset", { sessionId: id }));
    this.sessions.set(id, session);
    return session;
  }

  list() {
    return [...this.sessions.values()].map((s) => s.summary).sort((a, b) => a.createdAt - b.createdAt);
  }

  find(id) {
    return typeof id === "string" ? (this.sessions.get(id) ?? null) : null;
  }

  get(id) {
    const session = this.find(id);
    if (!session) throw notFound(`Ligne introuvable : ${id}`, "session_not_found");
    return session;
  }

  nextColor() {
    const used = new Set([...this.sessions.values()].map((s) => s.meta.color));
    return PALETTE.find((c) => !used.has(c)) ?? PALETTE[this.sessions.size % PALETTE.length];
  }

  nextId() {
    for (let n = 1; ; n++) {
      const id = `ligne-${n}`;
      if (!this.sessions.has(id) && !fs.existsSync(path.join(this.config.sessionsDir, id))) return { id, n };
    }
  }

  /**
   * Crée une ligne et lance sa connexion.
   * @param {{ id?: string, label?: string, phoneNumber?: string, start?: boolean }} input
   */
  async create({ id, label, phoneNumber, start = true } = {}) {
    if (this.sessions.size >= this.config.maxSessions) {
      throw new AppError(422, `Nombre maximum de lignes atteint (${this.config.maxSessions}).`, "too_many_sessions");
    }
    // On valide tout AVANT de créer quoi que ce soit sur le disque.
    const phone = phoneNumber ? normalizePhone(phoneNumber) : null;
    const auto = this.nextId();
    const sessionId = id ? validateSessionId(id) : auto.id;
    const dir = path.join(this.config.sessionsDir, sessionId);
    if (this.sessions.has(sessionId) || fs.existsSync(dir)) {
      throw conflict(`La ligne « ${sessionId} » existe déjà.`, "session_exists");
    }
    const meta = {
      label: cleanLabel(label) || `Ligne ${id ? this.sessions.size + 1 : auto.n}`,
      color: this.nextColor(),
      createdAt: Date.now(),
      autoStart: true,
      me: null,
    };

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
    const session = this.instantiate(sessionId, dir, meta);
    this.log.info({ session: sessionId, label: meta.label }, "Ligne créée");
    this.emit("session:update", session.summary);

    if (start) await session.start({ phoneNumber: phone });
    return session;
  }

  async rename(id, label) {
    const clean = cleanLabel(label);
    if (!clean) throw badRequest("Le nom ne peut pas être vide.", "invalid_label");
    const session = this.get(id);
    session.setLabel(clean);
    return session;
  }

  /** Supprime une ligne : délie l'appareil puis efface son dossier. */
  async remove(id) {
    const session = this.get(id);
    await session.destroy();
    this.sessions.delete(id);
    fs.rmSync(session.dir, { recursive: true, force: true });
    this.log.info({ session: id }, "Ligne supprimée");
    this.emit("session:removed", { sessionId: id });
  }

  /** Version de WhatsApp Web à annoncer (mise en cache, partagée par toutes les lignes). */
  async getWaVersion() {
    if (this.waVersion && Date.now() - this.waVersion.at < WA_VERSION_TTL_MS) return this.waVersion.version;
    if (!this.waVersionPromise) {
      const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 10000).unref?.());
      this.waVersionPromise = Promise.race([fetchLatestBaileysVersion().catch(() => null), timeout])
        .then((result) => {
          const version = result?.version;
          this.waVersion = { version, at: Date.now() };
          return version; // undefined => Baileys utilise sa version intégrée
        })
        .finally(() => {
          this.waVersionPromise = null;
        });
    }
    return this.waVersionPromise;
  }

  /** Arrêt du serveur : on ferme toutes les connexions sans délier les appareils. */
  shutdown() {
    for (const session of this.sessions.values()) session.shutdown();
  }
}
