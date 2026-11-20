// Historique d'UNE session (une ligne WhatsApp) : discussions + derniers messages,
// enregistrés dans le dossier de la session (data/sessions/<id>/store.json).
// Chaque session a sa propre instance : aucune donnée n'est partagée entre lignes.
import fs from "node:fs";
import path from "node:path";

const STATUS_RANK = { error: 0, pending: 1, sent: 2, delivered: 3, read: 4 };
const NAME_PRIORITY = { push: 1, verified: 2, contact: 3, group: 3 };

const emptyData = () => ({ version: 1, owner: null, chats: {}, messages: {}, names: {}, lids: {} });

function preview(message) {
  const labels = {
    image: "📷 Photo",
    video: "🎬 Vidéo",
    gif: "🎬 GIF",
    voice: "🎤 Message vocal",
    audio: "🎵 Audio",
    document: "📄 Document",
    sticker: "Autocollant",
    location: "📍 Position",
    contact: "👤 Contact",
    poll: "📊 Sondage",
    event: "📅 Événement",
  };
  if (message.deleted) return "🚫 Message supprimé";
  const label = labels[message.type];
  const text = (message.text || "").replace(/\s+/g, " ").trim();
  if (label && text) return `${label} · ${text}`.slice(0, 120);
  return (text || label || "Message").slice(0, 120);
}

export class MessageStore {
  constructor({ file, maxMessagesPerChat = 200, maxChats = 500, saveDelayMs = 1500, logger }) {
    this.file = file;
    this.maxMessagesPerChat = maxMessagesPerChat;
    this.maxChats = maxChats;
    this.saveDelayMs = saveDelayMs;
    this.log = logger;
    this.data = emptyData();
    this.saveTimer = null;
    this.writing = Promise.resolve();
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      this.data = { ...emptyData(), ...parsed };
    } catch (err) {
      if (err.code !== "ENOENT") this.log?.warn({ err }, "Historique illisible, on repart de zéro");
      this.data = emptyData();
    }
  }

  /**
   * Numéro auquel appartient cet historique. Si une AUTRE personne relie
   * cette ligne, l'ancien historique est effacé : jamais de mélange.
   */
  setOwner(jid) {
    if (this.data.owner && jid && this.data.owner !== jid) {
      this.log?.info({ previous: this.data.owner, next: jid }, "Nouveau numéro sur cette ligne : ancien historique effacé");
      this.clear();
    }
    this.data.owner = jid;
    this.scheduleSave();
  }

  get owner() {
    return this.data.owner;
  }

  // --- Identifiants @lid <-> numéro ---------------------------------------

  rememberLid(lid, pnJid) {
    if (!lid || !pnJid || this.data.lids[lid] === pnJid) return;
    this.data.lids[lid] = pnJid;
    this.scheduleSave();
  }

  pnForLid(lid) {
    return this.data.lids[lid] ?? null;
  }

  // --- Noms -----------------------------------------------------------------

  /** Mémorise un nom ; un nom de source plus fiable (contact enregistré) n'est pas écrasé. */
  setName(jid, name, source = "push") {
    const clean = typeof name === "string" ? name.trim() : "";
    if (!jid || !clean) return false;
    const current = this.data.names[jid];
    const priority = NAME_PRIORITY[source] ?? 1;
    if (current && (current.priority > priority || current.name === clean)) return false;
    this.data.names[jid] = { name: clean, priority };
    const chat = this.data.chats[jid];
    if (chat) chat.name = clean;
    this.scheduleSave();
    return Boolean(chat);
  }

  nameOf(jid) {
    return this.data.names[jid]?.name ?? null;
  }

  // --- Discussions ----------------------------------------------------------

  ensureChat(chatId, { isGroup = false, phone = null } = {}) {
    let chat = this.data.chats[chatId];
    if (!chat) {
      chat = {
        id: chatId,
        name: this.nameOf(chatId),
        phone,
        isGroup,
        unread: 0,
        lastMessageAt: 0,
        lastMessage: null,
      };
      this.data.chats[chatId] = chat;
      this.data.messages[chatId] = [];
      this.enforceChatLimit();
    }
    return chat;
  }

  getChat(chatId) {
    return this.data.chats[chatId] ?? null;
  }

  listChats() {
    return Object.values(this.data.chats).sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  }

  totalUnread() {
    let total = 0;
    for (const chat of Object.values(this.data.chats)) total += chat.unread;
    return total;
  }

  /** Remise à zéro du compteur « non lus » côté superviseur (rien n'est envoyé à WhatsApp). */
  markRead(chatId) {
    const chat = this.data.chats[chatId];
    if (!chat) return null;
    if (chat.unread) {
      chat.unread = 0;
      this.scheduleSave();
    }
    return chat;
  }

  enforceChatLimit() {
    const ids = Object.keys(this.data.chats);
    if (ids.length <= this.maxChats) return;
    const oldest = this.listChats().slice(this.maxChats);
    for (const chat of oldest) {
      delete this.data.chats[chat.id];
      delete this.data.messages[chat.id];
    }
  }

  // --- Messages -------------------------------------------------------------

  /**
   * Ajoute un message (ou ignore un doublon).
   * @returns {{ isNew: boolean, chat: object, message: object }}
   */
  upsertMessage(message, { countUnread = false, isGroup = false, phone = null } = {}) {
    const chat = this.ensureChat(message.chatId, { isGroup, phone });
    const list = this.data.messages[message.chatId];

    const existing = this.findIndex(list, message.id);
    if (existing !== -1) return { isNew: false, chat, message: list[existing] };

    // Insertion triée par date (le cas courant est un ajout en fin de liste).
    let i = list.length;
    while (i > 0 && list[i - 1].timestamp > message.timestamp) i--;
    list.splice(i, 0, message);
    if (list.length > this.maxMessagesPerChat) list.splice(0, list.length - this.maxMessagesPerChat);

    if (message.timestamp >= chat.lastMessageAt) {
      chat.lastMessageAt = message.timestamp;
      chat.lastMessage = this.lastMessageInfo(message);
    }
    if (countUnread && !message.fromMe) chat.unread += 1;
    this.scheduleSave();
    return { isNew: true, chat, message };
  }

  lastMessageInfo(message) {
    return {
      id: message.id,
      fromMe: message.fromMe,
      status: message.status,
      preview: preview(message),
    };
  }

  findIndex(list, id) {
    if (!list) return -1;
    for (let i = list.length - 1; i >= 0; i--) if (list[i].id === id) return i;
    return -1;
  }

  findMessage(chatId, id) {
    const list = this.data.messages[chatId];
    const i = this.findIndex(list, id);
    return i === -1 ? null : list[i];
  }

  /** Applique un changement à un message existant et met à jour l'aperçu de la discussion. */
  patchMessage(chatId, id, patch) {
    const message = this.findMessage(chatId, id);
    if (!message) return null;
    Object.assign(message, patch);
    const chat = this.data.chats[chatId];
    if (chat?.lastMessage?.id === id) chat.lastMessage = this.lastMessageInfo(message);
    this.scheduleSave();
    return message;
  }

  /** Statut d'envoi : il ne fait qu'avancer (envoyé -> distribué -> lu). */
  updateStatus(chatId, id, status) {
    const message = this.findMessage(chatId, id);
    if (!message || !message.fromMe || message.status === status) return null;
    const goesBackwards = status !== "error" && (STATUS_RANK[status] ?? 0) < (STATUS_RANK[message.status] ?? 0);
    if (goesBackwards) return null;
    return this.patchMessage(chatId, id, { status });
  }

  getMessages(chatId, { limit = 50, before } = {}) {
    const list = this.data.messages[chatId] ?? [];
    let end = list.length;
    if (before) {
      while (end > 0 && list[end - 1].timestamp >= before) end--;
    }
    const start = Math.max(0, end - limit);
    return { messages: list.slice(start, end), hasMore: start > 0 };
  }

  // --- Persistance ------------------------------------------------------------

  clear() {
    const { lids } = this.data;
    this.data = { ...emptyData(), lids };
    this.scheduleSave();
  }

  scheduleSave() {
    if (this.saveTimer || this.disposed) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush().catch((err) => this.log?.error({ err }, "Échec de l'enregistrement de l'historique"));
    }, this.saveDelayMs);
    this.saveTimer.unref?.();
  }

  /** Écriture atomique (fichier temporaire puis renommage), une à la fois. */
  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.disposed) return this.writing;
    const json = JSON.stringify(this.data);
    this.writing = this.writing
      .catch(() => {})
      .then(async () => {
        await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        await fs.promises.writeFile(tmp, json);
        await fs.promises.rename(tmp, this.file);
      });
    return this.writing;
  }

  /** Version synchrone pour l'arrêt du serveur. */
  flushSync() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.disposed) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      this.log?.error({ err }, "Échec de l'enregistrement de l'historique");
    }
  }

  /** Arrête les écritures (avant suppression du dossier de la session). */
  async dispose() {
    this.disposed = true;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    await this.writing.catch(() => {});
  }
}
