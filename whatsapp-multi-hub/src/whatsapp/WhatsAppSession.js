// UNE ligne WhatsApp = une instance de cette classe : son propre socket Baileys,
// son propre dossier d'authentification, son propre historique et ses propres
// événements. Rien n'est partagé avec les autres lignes.
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { pipeline } from "node:stream/promises";
import QRCode from "qrcode";
import {
  Browsers,
  DisconnectReason,
  WAMessageStubType,
  downloadMediaMessage,
  makeCacheableSignalKeyStore,
  makeWASocket,
  useMultiFileAuthState,
} from "baileys";
import { AppError, badRequest, conflict, notFound } from "../errors.js";
import { MessageStore } from "./MessageStore.js";
import { buildMediaContent, convertToVoiceNote, extFor, hasFfmpeg, removeQuietly, safeFileId } from "./media.js";
import { mediaRef, parseContent, parseMessage, parseReaction, previewOf, readMediaRef, statusFromAck } from "./messageParser.js";
import {
  isGroupJid,
  isIgnoredJid,
  isLidUser,
  isPnUser,
  jidNormalizedUser,
  jidToPhone,
  normalizePhone,
  resolveRecipient,
} from "./jid.js";

export const STATUS = Object.freeze({
  IDLE: "idle", // arrêtée (jamais connectée, mise en pause, QR expiré…)
  CONNECTING: "connecting",
  QR: "qr", // QR code à scanner
  PAIRING: "pairing", // code d'appairage à saisir sur le téléphone
  OPEN: "open", // connectée
  RECONNECTING: "reconnecting",
  LOGGED_OUT: "logged_out", // appareil délié : il faut refaire l'appairage
  ERROR: "error", // erreur qui demande une action (pas de nouvel essai automatique)
});

// Raisons de fermeture renvoyées par WhatsApp, expliquées simplement.
const CLOSE_REASONS = {
  401: "Appareil délié depuis le téléphone (WhatsApp → Appareils connectés).",
  403: "WhatsApp refuse ce compte pour le moment (compte restreint).",
  405: "WhatsApp a refusé la connexion : trop d'essais d'affilée ou déjà 4 appareils connectés. Attends 15 à 30 minutes.",
  408: "Pas de réponse de WhatsApp (connexion internet lente ou coupée).",
  411: "Appareil incompatible : délie puis relie la ligne.",
  428: "Connexion fermée par WhatsApp.",
  440: "Cette ligne a été ouverte ailleurs (autre serveur ou autre outil) : une seule connexion à la fois.",
  500: "Session abîmée : délie puis relie la ligne.",
  503: "WhatsApp est momentanément indisponible.",
  515: "Redémarrage demandé par WhatsApp.",
};

export function explainClose(code, message) {
  const network = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH/.exec(message ?? "");
  if (network) return `Impossible de joindre WhatsApp (${network[0]}) : vérifie la connexion internet du serveur.`;
  return CLOSE_REASONS[code] ?? `Connexion coupée (${code ?? "réseau"}${message ? ` : ${message}` : ""}).`;
}

// Échecs de connexion tolérés avant d'abandonner une ligne pas encore reliée.
const MAX_UNLINKED_RETRIES = 3;

// Réessayer après ces erreurs ne sert à rien, voire aggrave la situation
// (ex. 440 : deux serveurs qui se volent la connexion en boucle).
const FATAL_CODES = new Set([
  DisconnectReason.forbidden,
  DisconnectReason.connectionReplaced,
  DisconnectReason.badSession,
  DisconnectReason.multideviceMismatch,
  405,
]);

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} : délai dépassé`)), ms).unref?.()),
  ]);

export class WhatsAppSession extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.id identifiant de la session (nom du dossier)
   * @param {string} opts.dir dossier de la session (data/sessions/<id>)
   * @param {object} opts.meta { label, color, createdAt, autoStart, me }
   * @param {() => Promise<number[]|undefined>} opts.getWaVersion version WhatsApp Web à annoncer
   */
  constructor({ id, dir, meta, config, logger, getWaVersion }) {
    super();
    this.id = id;
    this.dir = dir;
    this.authDir = path.join(dir, "auth");
    this.metaFile = path.join(dir, "meta.json");
    this.meta = meta;
    this.config = config;
    this.getWaVersion = getWaVersion;
    this.log = logger.child({ session: id });
    this.baileysLogger = logger.child({ session: id, module: "baileys" }, { level: config.baileysLogLevel });
    // Fichiers (photos, vidéos, vocaux, documents) de CETTE ligne uniquement.
    this.mediaDir = path.join(dir, "media");
    this.uploadDir = path.join(dir, "tmp");
    this.downloads = new Map(); // téléchargements en cours (un seul par média)
    this.store = new MessageStore({
      file: path.join(dir, "store.json"),
      maxMessagesPerChat: config.maxMessagesPerChat,
      maxChats: config.maxChatsPerSession,
      logger: this.log,
      onEvict: (messages) => {
        for (const m of messages) if (m.media?.file) removeQuietly(path.join(this.mediaDir, m.media.file));
      },
    });

    this.sock = null;
    this.creds = null;
    this.generation = 0; // chaque nouvelle connexion invalide les événements de l'ancienne
    this.attempts = 0;
    this.reconnectTimer = null;
    this.summaryTimer = null;
    this.manualStop = true; // vrai tant que personne n'a demandé la connexion
    this.destroyed = false;
    this.pairingPhone = null;
    this.pairingRequested = false;
    this.awaitingUser = false; // un QR / code est affiché et attend l'utilisateur
    this.groupLookups = new Set();
    this.linked = this.readLinkedFromDisk();
    this.me = meta.me ?? null;
    this.state = {
      status: STATUS.IDLE,
      qr: null,
      pairingCode: null,
      lastError: null,
      connectedAt: null,
      nextRetryAt: null,
    };
  }

  // --- État ---------------------------------------------------------------

  /** Résumé public de la ligne (aucun contenu de message). */
  get summary() {
    return {
      id: this.id,
      label: this.meta.label,
      color: this.meta.color,
      createdAt: this.meta.createdAt,
      status: this.state.status,
      linked: this.linked,
      qr: this.state.qr,
      pairingCode: this.state.pairingCode,
      lastError: this.state.lastError,
      connectedAt: this.state.connectedAt,
      nextRetryAt: this.state.nextRetryAt,
      phone: this.me?.phone ?? null,
      name: this.me?.name ?? null,
      unread: this.store.totalUnread(),
    };
  }

  get isOpen() {
    return this.state.status === STATUS.OPEN && Boolean(this.sock);
  }

  setState(patch) {
    Object.assign(this.state, patch);
    clearTimeout(this.summaryTimer);
    this.summaryTimer = null;
    this.emit("update", this.summary);
  }

  /** Mise à jour groupée (compteurs de non-lus) pour ne pas inonder les clients. */
  scheduleSummary() {
    if (this.summaryTimer) return;
    this.summaryTimer = setTimeout(() => {
      this.summaryTimer = null;
      this.emit("update", this.summary);
    }, 400);
    this.summaryTimer.unref?.();
  }

  updateMeta(patch) {
    Object.assign(this.meta, patch);
    if (this.destroyed) return;
    try {
      fs.writeFileSync(this.metaFile, JSON.stringify(this.meta, null, 2));
    } catch (err) {
      this.log.error({ err }, "Impossible d'enregistrer meta.json");
    }
  }

  setLabel(label) {
    this.updateMeta({ label });
    this.emit("update", this.summary);
  }

  /** Une ligne est « reliée » quand l'appairage a abouti (compte signé par WhatsApp). */
  readLinkedFromDisk() {
    try {
      const creds = JSON.parse(fs.readFileSync(path.join(this.authDir, "creds.json"), "utf8"));
      return Boolean(creds.account);
    } catch {
      return false;
    }
  }

  wipeAuth() {
    fs.rmSync(this.authDir, { recursive: true, force: true });
    this.linked = false;
    this.creds = null;
  }

  // --- Cycle de vie -------------------------------------------------------

  /**
   * Connexion demandée par l'utilisateur.
   * - sans numéro : QR code à scanner ;
   * - avec numéro : code d'appairage à 8 caractères (quand on ne peut pas scanner).
   */
  async start({ phoneNumber } = {}) {
    const phone = phoneNumber ? normalizePhone(phoneNumber) : null;
    if (this.linked) {
      if (phone) {
        throw conflict("Cette ligne est déjà reliée à un numéro. Délie-la avant d'en associer un autre.", "already_linked");
      }
      if (this.sock && [STATUS.OPEN, STATUS.CONNECTING].includes(this.state.status)) return;
    } else {
      // Un QR ou un code précédent non abouti bloquerait l'essai suivant : on repart de zéro.
      this.generation++;
      this.closeSocket();
      this.wipeAuth();
    }
    this.pairingPhone = phone;
    this.pairingRequested = false;
    this.manualStop = false;
    this.attempts = 0;
    this.updateMeta({ autoStart: true });
    await this.connect();
  }

  /** Reprise automatique au démarrage du serveur (ligne déjà reliée). */
  async resume() {
    if (!this.linked) return;
    this.manualStop = false;
    this.attempts = 0;
    await this.connect();
  }

  /** Coupe la connexion sans délier l'appareil (reprise possible sans QR). */
  async stop() {
    this.halt();
    this.updateMeta({ autoStart: false });
    this.setState({ status: STATUS.IDLE, qr: null, pairingCode: null, connectedAt: null, nextRetryAt: null, lastError: null });
    await this.store.flush();
  }

  /** Délie l'appareil : il faudra refaire un QR / code pour reconnecter cette ligne. */
  async logout() {
    const sock = this.sock;
    const wasOpen = this.isOpen;
    this.halt({ keepSocket: true });
    let remoteLogout = false;
    if (sock && wasOpen) {
      try {
        await withTimeout(sock.logout(), 8000, "Déliaison");
        remoteLogout = true;
      } catch (err) {
        this.log.warn({ err }, "Déliaison côté WhatsApp impossible ; données locales effacées quand même");
      }
    }
    try {
      sock?.end(undefined);
    } catch {
      // déjà fermé
    }
    this.wipeAuth();
    this.updateMeta({ autoStart: false });
    this.setState({ status: STATUS.LOGGED_OUT, qr: null, pairingCode: null, connectedAt: null, nextRetryAt: null, lastError: null });
    return { remoteLogout };
  }

  /** Avant suppression du dossier : on délie si possible et on arrête toute écriture. */
  async destroy() {
    if (this.linked) await this.logout();
    else this.halt();
    this.destroyed = true;
    clearTimeout(this.summaryTimer);
    await this.store.dispose();
    this.removeAllListeners();
  }

  /** Arrêt du serveur : on ferme sans délier, la ligne reprendra au prochain démarrage. */
  shutdown() {
    this.halt();
    this.store.flushSync();
  }

  /** Stoppe la connexion en cours et toute reconnexion programmée. */
  halt({ keepSocket = false } = {}) {
    this.manualStop = true;
    this.generation++;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (keepSocket) this.sock = null;
    else this.closeSocket();
  }

  closeSocket() {
    const sock = this.sock;
    this.sock = null;
    if (!sock) return;
    try {
      sock.end(undefined);
    } catch {
      // déjà fermé
    }
  }

  async connect() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const gen = ++this.generation;
    this.closeSocket();
    this.awaitingUser = false;
    this.setState({
      status: this.attempts > 0 ? STATUS.RECONNECTING : STATUS.CONNECTING,
      qr: null,
      pairingCode: null,
      nextRetryAt: null,
    });

    try {
      fs.mkdirSync(this.authDir, { recursive: true });
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
      const version = await this.getWaVersion();
      if (gen !== this.generation) return; // une autre demande est passée entre-temps

      const sock = makeWASocket({
        version,
        logger: this.baileysLogger,
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, this.baileysLogger) },
        // Navigateur reconnu par WhatsApp (obligatoire pour le code d'appairage).
        browser: Browsers.macOS("Chrome"),
        // Le téléphone garde ses notifications : le superviseur reste discret.
        markOnlineOnConnect: false,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        getMessage: async () => undefined,
      });
      this.sock = sock;
      this.creds = state.creds;
      this.bindEvents(sock, gen, saveCreds);
    } catch (err) {
      if (gen !== this.generation) return;
      this.log.error({ err }, "Impossible de démarrer la connexion WhatsApp");
      this.scheduleRetry(`Démarrage impossible : ${err.message}`);
    }
  }

  bindEvents(sock, gen, saveCreds) {
    const live = () => gen === this.generation && !this.destroyed;
    const on = (event, handler) =>
      sock.ev.on(event, async (payload) => {
        if (!live()) return; // événement d'un ancien socket : ignoré
        try {
          await handler(payload);
        } catch (err) {
          this.log.error({ err, event }, "Erreur pendant le traitement d'un événement WhatsApp");
        }
      });

    on("creds.update", async () => {
      await saveCreds();
      this.linked = Boolean(this.creds?.account);
    });
    on("connection.update", (update) => this.onConnectionUpdate(update, sock, gen));
    on("messages.upsert", ({ messages, type }) => this.handleMessages(messages, type));
    on("messages.update", (updates) => this.onMessagesUpdate(updates));
    on("contacts.upsert", (contacts) => this.onContacts(contacts));
    on("contacts.update", (contacts) => this.onContacts(contacts));
    on("lid-mapping.update", (mapping) => this.onLidMapping(mapping));
    if (this.config.historySync) on("messaging-history.set", (history) => this.onHistory(history));
  }

  async onConnectionUpdate({ connection, lastDisconnect, qr }, sock, gen) {
    if (qr) await this.onQr(qr, sock, gen);
    if (connection === "open") this.onOpen(sock);
    else if (connection === "close") this.onClose(lastDisconnect?.error);
  }

  async onQr(qr, sock, gen) {
    if (this.pairingPhone) {
      // WhatsApp est prêt : on demande un code à saisir sur le téléphone au lieu du QR.
      if (this.pairingRequested) return;
      this.pairingRequested = true;
      try {
        const raw = await sock.requestPairingCode(this.pairingPhone);
        if (gen !== this.generation) return;
        const code = raw.match(/.{1,4}/g).join("-");
        this.awaitingUser = true;
        this.log.info({ code }, "Code d'appairage généré");
        this.setState({ status: STATUS.PAIRING, pairingCode: code, qr: null, lastError: null });
      } catch (err) {
        if (gen !== this.generation) return;
        this.halt();
        this.setState({ status: STATUS.ERROR, pairingCode: null, lastError: `WhatsApp n'a pas fourni de code d'appairage : ${err.message}` });
      }
      return;
    }
    const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320, errorCorrectionLevel: "M" });
    if (gen !== this.generation) return;
    this.awaitingUser = true;
    this.attempts = 0;
    this.setState({ status: STATUS.QR, qr: dataUrl, pairingCode: null, lastError: null, nextRetryAt: null });
  }

  onOpen(sock) {
    const user = sock.user ?? {};
    const id = jidNormalizedUser(user.id);
    this.me = {
      id,
      lid: user.lid ? jidNormalizedUser(user.lid) : null,
      phone: jidToPhone(id),
      name: user.name || user.verifiedName || user.notify || null,
    };
    // Si un AUTRE numéro est relié à cette ligne, l'ancien historique est effacé.
    const previousOwner = this.store.owner;
    this.store.setOwner(id);
    if (previousOwner && previousOwner !== id) this.emit("chats-reset");

    this.attempts = 0;
    this.linked = true;
    this.pairingPhone = null;
    this.pairingRequested = false;
    this.updateMeta({ me: this.me, autoStart: true });
    this.setState({ status: STATUS.OPEN, qr: null, pairingCode: null, lastError: null, nextRetryAt: null, connectedAt: Date.now() });
    this.log.info({ phone: this.me.phone }, "Ligne connectée");
  }

  onClose(error) {
    this.sock = null;
    if (this.manualStop) return;
    const code = error?.output?.statusCode;
    const reason = explainClose(code, error?.message);

    if (code === DisconnectReason.loggedOut) {
      this.log.warn("Appareil délié depuis le téléphone");
      this.halt();
      this.wipeAuth();
      this.updateMeta({ autoStart: false });
      this.setState({ status: STATUS.LOGGED_OUT, qr: null, pairingCode: null, connectedAt: null, nextRetryAt: null, lastError: reason });
      return;
    }

    if (code === DisconnectReason.restartRequired) {
      // Normal juste après un QR scanné / un code saisi : on rouvre tout de suite.
      this.log.info("Appairage accepté, réouverture de la connexion");
      this.reconnectTimer = setTimeout(() => void this.connect(), 300);
      return;
    }

    if (!this.linked) {
      // WhatsApp injoignable avant même l'affichage du QR : quelques nouveaux essais.
      if (!this.awaitingUser && !FATAL_CODES.has(code) && this.attempts < MAX_UNLINKED_RETRIES) {
        this.scheduleRetry(reason);
        return;
      }
      // QR expiré, code non saisi ou refusé : on n'insiste pas (risque de blocage côté WhatsApp).
      this.halt();
      const expired = this.awaitingUser && code === DisconnectReason.timedOut;
      this.setState({
        status: STATUS.IDLE,
        qr: null,
        pairingCode: null,
        nextRetryAt: null,
        lastError: expired ? "Le QR code ou le code n'a pas été validé à temps : relance la connexion." : reason,
      });
      return;
    }

    if (FATAL_CODES.has(code)) {
      this.log.error({ code }, `Connexion arrêtée : ${reason}`);
      this.halt();
      this.setState({ status: STATUS.ERROR, connectedAt: null, nextRetryAt: null, lastError: reason });
      return;
    }

    this.scheduleRetry(reason);
  }

  /** Reconnexion avec délai exponentiel (2 s, 4 s, 8 s… plafonné) et un peu d'aléatoire. */
  scheduleRetry(reason) {
    const { baseDelayMs, maxDelayMs, maxAttempts } = this.config.reconnect;
    this.attempts += 1;
    if (maxAttempts && this.attempts > maxAttempts) {
      this.halt();
      this.setState({ status: STATUS.ERROR, nextRetryAt: null, connectedAt: null, lastError: `${reason} Abandon après ${maxAttempts} tentatives.` });
      return;
    }
    const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (this.attempts - 1));
    const delay = Math.round(exp * (0.8 + Math.random() * 0.4));
    this.log.warn({ attempt: this.attempts, delayMs: delay }, `Reconnexion programmée : ${reason}`);
    this.setState({ status: STATUS.RECONNECTING, qr: null, pairingCode: null, connectedAt: null, nextRetryAt: Date.now() + delay, lastError: reason });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.manualStop) void this.connect();
    }, delay);
  }

  // --- Messages -------------------------------------------------------------

  /**
   * Identifiant de discussion stable : WhatsApp désigne parfois un contact par
   * un identifiant « @lid » au lieu de son numéro ; on revient au numéro quand
   * on le connaît pour ne pas couper une conversation en deux.
   */
  async chatIdFor(key) {
    const jid = jidNormalizedUser(key.remoteJid) || key.remoteJid;
    if (!isLidUser(jid)) return jid;
    const alt = key.remoteJidAlt ? jidNormalizedUser(key.remoteJidAlt) : null;
    if (alt && isPnUser(alt)) {
      this.store.rememberLid(jid, alt);
      return alt;
    }
    const known = this.store.pnForLid(jid);
    if (known) return known;
    const pn = await this.sock?.signalRepository?.lidMapping?.getPNForLID(jid).catch(() => null);
    if (pn) {
      const normalized = jidNormalizedUser(pn);
      this.store.rememberLid(jid, normalized);
      return normalized;
    }
    return jid;
  }

  /**
   * Messages reçus ou envoyés (depuis ce serveur ou depuis le téléphone de la ligne).
   * @param {string} type "notify" = nouveau message en direct ; "append" = rattrapage
   */
  async handleMessages(messages = [], type = "notify", { silent = false } = {}) {
    let changed = false;
    const live = type === "notify" || type === "append";
    for (const raw of messages) {
      try {
        if (isIgnoredJid(raw?.key?.remoteJid)) continue;
        const reaction = parseReaction(raw);
        if (reaction) {
          await this.applyReaction(raw, reaction);
          continue;
        }
        const parsed = parseMessage(raw);
        if (!parsed) continue;
        const chatId = await this.chatIdFor(raw.key);
        const isGroup = isGroupJid(chatId);
        if (!parsed.fromMe && raw.pushName && !isGroup) this.store.setName(chatId, raw.pushName, "push");
        // Identifiant d'origine (@lid) gardé pour répondre / réagir avec la bonne clé.
        if (raw.key.remoteJid && raw.key.remoteJid !== chatId) parsed.rawJid = raw.key.remoteJid;
        if (parsed.quoted) parsed.quoted.fromMe = this.isMe(parsed.quoted.author);

        const { isNew, chat, message } = this.store.upsertMessage(
          { ...parsed, chatId },
          { countUnread: type === "notify", isGroup, phone: jidToPhone(chatId) },
        );
        if (!isNew) continue;
        changed = true;
        if (message.media && this.store.findMessage(chatId, message.id)) {
          this.store.setMediaRef(message.id, mediaRef(raw));
          // Les petits fichiers reçus en direct sont téléchargés tout de suite ;
          // les autres (et l'historique) seulement quand on les ouvre.
          const small = !message.media.size || message.media.size <= this.config.mediaAutoDownloadBytes;
          if (live && small) this.ensureMedia(chatId, message.id).catch(() => {});
        }
        if (isGroup) this.ensureGroupName(chatId);
        if (!silent) this.emit("message", { chat, message, notify: type === "notify" });
      } catch (err) {
        this.log.warn({ err, id: raw?.key?.id }, "Message ignoré (format inattendu)");
      }
    }
    if (changed) this.scheduleSummary();
  }

  isMe(jid) {
    const normalized = jid ? jidNormalizedUser(jid) : null;
    return Boolean(normalized) && (normalized === this.me?.id || normalized === this.me?.lid);
  }

  /** Réaction (emoji) d'un participant sur un message. */
  async applyReaction(raw, { targetId, emoji }) {
    const chatId = await this.chatIdFor(raw.key);
    const sender = raw.key.fromMe ? "me" : isGroupJid(chatId) ? jidNormalizedUser(raw.key.participant || "") || "?" : chatId;
    const message = this.store.setReaction(chatId, targetId, sender, emoji);
    if (message) this.emit("message-update", { chat: this.store.getChat(chatId), message });
  }

  /** Message supprimé pour tout le monde : on efface aussi son fichier. */
  markDeleted(chatId, messageId) {
    const message = this.store.findMessage(chatId, messageId);
    if (!message) return null;
    if (message.media?.file) removeQuietly(path.join(this.mediaDir, message.media.file));
    return this.store.patchMessage(chatId, messageId, { deleted: true, text: "", media: undefined, quoted: undefined });
  }

  /** Accusés (envoyé / distribué / lu), suppressions et modifications. */
  async onMessagesUpdate(updates = []) {
    for (const { key, update } of updates) {
      if (!key?.id || !update || isIgnoredJid(key.remoteJid)) continue;
      const chatId = await this.chatIdFor(key);
      let message = null;

      if (update.messageStubType === WAMessageStubType.REVOKE) {
        message = this.markDeleted(chatId, key.id);
      } else if (update.message?.editedMessage?.message) {
        const content = parseContent(update.message.editedMessage.message);
        if (content) message = this.store.patchMessage(chatId, key.id, { text: content.text, edited: true });
      }
      if (update.status !== undefined && update.status !== null) {
        const status = statusFromAck(update.status);
        if (status) message = this.store.updateStatus(chatId, key.id, status) ?? message;
      }
      if (message) this.emit("message-update", { chat: this.store.getChat(chatId), message });
    }
  }

  onContacts(contacts = []) {
    for (const contact of contacts) {
      if (!contact?.id) continue;
      const id = jidNormalizedUser(contact.id);
      if (isLidUser(id) && contact.phoneNumber) this.store.rememberLid(id, jidNormalizedUser(contact.phoneNumber));
      if (isPnUser(id) && contact.lid) this.store.rememberLid(jidNormalizedUser(contact.lid), id);
      const target = isLidUser(id) ? (this.store.pnForLid(id) ?? id) : id;

      let changed = false;
      if (contact.name) changed = this.store.setName(target, contact.name, "contact");
      else if (contact.verifiedName) changed = this.store.setName(target, contact.verifiedName, "verified");
      else if (contact.notify) changed = this.store.setName(target, contact.notify, "push");
      if (changed) this.emit("chat-update", { chat: this.store.getChat(target) });
    }
  }

  onLidMapping(mappings) {
    for (const { lid, pn } of [].concat(mappings ?? [])) {
      if (lid && pn) this.store.rememberLid(jidNormalizedUser(lid), jidNormalizedUser(pn));
    }
  }

  /** Historique récent envoyé par WhatsApp juste après l'appairage. */
  async onHistory({ chats = [], contacts = [], messages = [] } = {}) {
    this.onContacts(contacts);
    for (const chat of chats) {
      if (!chat?.id || !chat.name || isIgnoredJid(chat.id)) continue;
      const id = await this.chatIdFor({ remoteJid: chat.id });
      this.store.setName(id, chat.name, isGroupJid(id) ? "group" : "contact");
    }
    await this.handleMessages(messages, "history", { silent: true });
    this.log.info({ chats: chats.length, messages: messages.length }, "Historique synchronisé");
    this.emit("chats-reset");
  }

  ensureGroupName(chatId) {
    const sock = this.sock;
    if (!sock || this.store.getChat(chatId)?.name || this.groupLookups.has(chatId)) return;
    this.groupLookups.add(chatId);
    sock
      .groupMetadata(chatId)
      .then((meta) => {
        if (meta?.subject && this.store.setName(chatId, meta.subject, "group")) {
          this.emit("chat-update", { chat: this.store.getChat(chatId) });
        }
      })
      .catch((err) => this.log.debug({ err, chatId }, "Nom du groupe indisponible"));
  }

  // --- Envoi et actions ------------------------------------------------------

  requireOpen() {
    if (!this.sock || !this.isOpen) throw conflict("Cette ligne n'est pas connectée à WhatsApp.", "session_not_connected");
    return this.sock;
  }

  /** Destinataire (numéro ou identifiant) ; un nouveau numéro est vérifié auprès de WhatsApp. */
  async resolveTarget(sock, to) {
    const { jid, fromPhone } = resolveRecipient(to);
    if (fromPhone && !this.store.getChat(jid)) {
      const result = await withTimeout(sock.onWhatsApp(jid), 10000, "Vérification du numéro").catch(() => null);
      if (Array.isArray(result) && !result.some((r) => r.exists)) {
        throw notFound("Ce numéro n'utilise pas WhatsApp.", "not_on_whatsapp");
      }
    }
    return jid;
  }

  /** Clé WhatsApp d'un message enregistré (pour répondre, réagir, supprimer). */
  keyFor(message) {
    return {
      remoteJid: message.rawJid || message.chatId,
      id: message.id,
      fromMe: message.fromMe,
      ...(message.author ? { participant: message.author } : {}),
    };
  }

  /** Message cité minimal (Baileys n'a besoin que de la clé et d'un aperçu). */
  quotedFor(chatId, messageId) {
    if (!messageId) return undefined;
    const message = this.store.findMessage(chatId, messageId);
    if (!message) throw notFound("Le message auquel tu réponds est introuvable.", "quoted_not_found");
    return { key: this.keyFor(message), message: { conversation: message.text || previewOf(message) } };
  }

  /** Enregistre un message qu'on vient d'envoyer et le diffuse tout de suite. */
  async recordSent(sent, fallback) {
    // L'écho envoyé ensuite par WhatsApp aura le même id : il sera ignoré.
    const parsed = parseMessage(sent) ?? { id: sent.key.id, fromMe: true, timestamp: Date.now(), ...fallback };
    const chatId = await this.chatIdFor(sent.key);
    if (sent.key.remoteJid && sent.key.remoteJid !== chatId) parsed.rawJid = sent.key.remoteJid;
    if (parsed.quoted) parsed.quoted.fromMe = this.isMe(parsed.quoted.author);
    if (fallback.media) parsed.media = { ...parsed.media, ...fallback.media };
    const { isNew, chat, message } = this.store.upsertMessage(
      { ...parsed, chatId, status: parsed.status ?? "pending" },
      { isGroup: isGroupJid(chatId), phone: jidToPhone(chatId) },
    );
    if (isNew) this.emit("message", { chat, message });
    return { chat, message };
  }

  async send(sock, jid, content, quoted) {
    let sent;
    try {
      sent = await sock.sendMessage(jid, content, quoted ? { quoted } : undefined);
    } catch (err) {
      this.log.error({ err }, "Échec de l'envoi");
      throw new AppError(502, `WhatsApp a refusé l'envoi : ${err.message}`, "send_failed");
    }
    if (!sent?.key?.id) throw new AppError(502, "WhatsApp n'a pas confirmé l'envoi.", "send_failed");
    return sent;
  }

  /** Envoie un message texte depuis CETTE ligne uniquement (en réponse à un message si replyTo). */
  async sendText(to, text, { replyTo } = {}) {
    const body = typeof text === "string" ? text.trim() : "";
    if (!body) throw badRequest("Message vide.", "empty_message");
    if (body.length > 4096) throw badRequest("Message trop long (4096 caractères maximum).", "message_too_long");
    const sock = this.requireOpen();
    const jid = await this.resolveTarget(sock, to);
    const quoted = this.quotedFor(jid, replyTo);
    const sent = await this.send(sock, jid, { text: body }, quoted);
    return this.recordSent(sent, { type: "text", text: body });
  }

  /**
   * Envoie un fichier (photo, vidéo, document, audio) ou une note vocale.
   * Le fichier reste disponible dans l'app (copie dans le dossier de la ligne).
   */
  async sendMedia({ to, filePath, mimetype, fileName, caption, voice = false, replyTo }) {
    const sock = this.requireOpen();
    const jid = await this.resolveTarget(sock, to);
    const quoted = this.quotedFor(jid, replyTo);
    const text = typeof caption === "string" ? caption.trim().slice(0, 1024) : "";

    // Les vocaux enregistrés dans l'app sont convertis au format WhatsApp (OGG/Opus).
    let sendPath = filePath;
    let sendMime = mimetype;
    let sendName = fileName;
    let asVoice = false;
    let notice = null;
    if (voice) {
      if (hasFfmpeg()) {
        sendPath = `${filePath}.ogg`;
        try {
          await convertToVoiceNote(filePath, sendPath);
          sendMime = "audio/ogg; codecs=opus";
          asVoice = true;
        } catch (err) {
          this.log.warn({ err }, "Conversion du vocal impossible : envoi comme fichier");
          removeQuietly(sendPath);
          sendPath = filePath;
        }
      }
      if (!asVoice) {
        sendName = `vocal${extFor(mimetype)}`;
        notice = "ffmpeg n'est pas installé sur le serveur : le vocal a été envoyé comme fichier audio.";
      }
    }

    try {
      const { kind, content } = buildMediaContent({ filePath: sendPath, mimetype: sendMime, fileName: sendName, caption: text, voice: asVoice });
      const sent = await this.send(sock, jid, content, quoted);
      // Copie locale pour l'affichage (pas besoin de la retélécharger).
      fs.mkdirSync(this.mediaDir, { recursive: true });
      const name = `${safeFileId(sent.key.id)}${extFor(sendMime, sendName)}`;
      await fs.promises.copyFile(sendPath, path.join(this.mediaDir, name));
      const result = await this.recordSent(sent, { type: kind, text, media: { file: name, mimetype: sendMime, fileName: sendName } });
      this.store.setMediaRef(sent.key.id, mediaRef(sent));
      return { ...result, notice };
    } finally {
      if (sendPath !== filePath) removeQuietly(sendPath);
    }
  }

  /** Réagit (emoji) à un message ; emoji vide = retirer sa réaction. */
  async react(chatId, messageId, emoji) {
    const sock = this.requireOpen();
    const message = this.store.findMessage(chatId, messageId);
    if (!message) throw notFound("Message introuvable.", "message_not_found");
    const text = typeof emoji === "string" ? [...emoji].slice(0, 4).join("") : "";
    await this.send(sock, chatId, { react: { text, key: this.keyFor(message) } });
    const updated = this.store.setReaction(chatId, messageId, "me", text);
    if (updated) this.emit("message-update", { chat: this.store.getChat(chatId), message: updated });
    return updated ?? message;
  }

  /** Supprime pour tout le monde un message envoyé par cette ligne. */
  async deleteForEveryone(chatId, messageId) {
    const sock = this.requireOpen();
    const message = this.store.findMessage(chatId, messageId);
    if (!message) throw notFound("Message introuvable.", "message_not_found");
    if (!message.fromMe) throw new AppError(403, "Seuls les messages envoyés par cette ligne peuvent être supprimés pour tout le monde.", "not_own_message");
    await this.send(sock, chatId, { delete: this.keyFor(message) });
    const updated = this.markDeleted(chatId, messageId);
    if (updated) this.emit("message-update", { chat: this.store.getChat(chatId), message: updated });
    return updated;
  }

  // --- Médias reçus -------------------------------------------------------------

  /** Chemin du fichier d'un média ; téléchargé depuis WhatsApp au premier accès. */
  async ensureMedia(chatId, messageId) {
    const message = this.store.findMessage(chatId, messageId);
    if (!message?.media) throw notFound("Média introuvable.", "media_not_found");
    if (message.media.file) {
      const existing = path.join(this.mediaDir, message.media.file);
      if (fs.existsSync(existing)) return { file: existing, message };
    }
    if (!this.downloads.has(messageId)) {
      const job = this.downloadMedia(chatId, message).finally(() => this.downloads.delete(messageId));
      this.downloads.set(messageId, job);
    }
    const file = await this.downloads.get(messageId);
    return { file, message: this.store.findMessage(chatId, messageId) ?? message };
  }

  async downloadMedia(chatId, message) {
    const ref = this.store.getMediaRef(message.id);
    if (!ref) throw new AppError(410, "Ce média n'est plus disponible.", "media_gone");
    fs.mkdirSync(this.mediaDir, { recursive: true });
    const name = `${safeFileId(message.id)}${extFor(message.media.mimetype, message.media.fileName)}`;
    const target = path.join(this.mediaDir, name);
    const partial = `${target}.part`;
    try {
      const stream = await downloadMediaMessage(readMediaRef(ref), "stream", {}, {
        logger: this.baileysLogger,
        reuploadRequest: this.sock?.updateMediaMessage,
      });
      await pipeline(stream, fs.createWriteStream(partial));
      await fs.promises.rename(partial, target);
    } catch (err) {
      removeQuietly(partial);
      this.log.warn({ err: err.message, id: message.id }, "Téléchargement du média impossible");
      throw new AppError(410, "Ce média n'est plus disponible sur WhatsApp.", "media_gone");
    }
    if (this.destroyed) return target;
    this.store.patchMessage(chatId, message.id, { media: { ...message.media, file: name } });
    return target;
  }
}

