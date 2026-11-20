// Contrôleur principal de la PWA.
//
// Règle d'isolation côté client : seules les données de la ligne ACTIVE sont en
// mémoire (state.line). Changer de ligne remplace entièrement cet objet, et toute
// réponse ou événement qui ne porte pas l'identifiant de la ligne active est ignoré.
import { createApi } from "./api.js";
import { createRealtime } from "./realtime.js";
import { isNative, loadSettings, saveSettings, serverBase } from "./settings.js";
import { $, avatarColor, confirmDialog, esc, formatPhone, icons, initials, promptDialog, toast } from "./ui.js";
import { renderLines } from "./views/lines.js";
import { chatTitle, renderBanner, renderChatList, renderMessages } from "./views/messages.js";

const DEFAULT_COLOR = "#0f766e";
const settings = loadSettings();
const api = createApi(() => ({ base: serverBase(settings), token: settings.token }));

const emptyLine = (sessionId) => ({
  sessionId,
  chats: new Map(),
  loading: Boolean(sessionId),
  openChatId: null,
  draftChat: null,
  messages: [],
  hasMore: false,
  loadingMessages: false,
});

const state = {
  view: "messages",
  sessions: new Map(),
  activeId: settings.activeId,
  realtime: null,
  filter: "",
  line: emptyLine(null),
};

const el = {
  conn: $("#conn"),
  tabs: $("#line-tabs"),
  banner: $("#line-banner"),
  search: $("#chat-search"),
  chatList: $("#chat-list"),
  conversation: $("#conversation"),
  convEmpty: $("#conversation-empty"),
  convAvatar: $("#conv-avatar"),
  convName: $("#conv-name"),
  convSub: $("#conv-sub"),
  convLine: $("#conv-line"),
  messages: $("#messages"),
  composer: $("#composer"),
  input: $("#composer-input"),
  sendBtn: $("#composer button[type=submit]"),
  lineCards: $("#line-cards"),
  addForm: $("#add-line-form"),
  settingsForm: $("#settings-form"),
  settingsStatus: $("#settings-status"),
  themeColor: document.querySelector('meta[name="theme-color"]'),
};

const sortedSessions = () => [...state.sessions.values()].sort((a, b) => a.createdAt - b.createdAt);
const activeSession = () => state.sessions.get(state.activeId) ?? null;
/** Vrai seulement si l'identifiant correspond à la ligne affichée. */
const isActive = (sessionId) => Boolean(sessionId) && sessionId === state.activeId && sessionId === state.line.sessionId;

// --- Rendu ------------------------------------------------------------------

function renderTabs() {
  const tabs = sortedSessions().map(
    (s) => `<button type="button" role="tab" class="line-tab ${s.id === state.activeId ? "is-active" : ""}"
      data-line="${esc(s.id)}" style="--line:${esc(s.color)}" aria-selected="${s.id === state.activeId}">
      <span class="status-dot" data-status="${esc(s.status)}"></span>
      <span class="line-tab-label">${esc(s.label)}</span>
      ${s.unread ? `<span class="unread">${s.unread > 99 ? "99+" : s.unread}</span>` : ""}
    </button>`,
  );
  tabs.push(`<button type="button" class="line-tab line-tab-add" data-action="add-line" aria-label="Ajouter une ligne">${icons.plus}</button>`);
  el.tabs.innerHTML = tabs.join("");
}

function applyLineTheme() {
  const color = activeSession()?.color ?? DEFAULT_COLOR;
  document.documentElement.style.setProperty("--line", color);
  el.themeColor?.setAttribute("content", color);
}

function updateBadges() {
  const total = sortedSessions().reduce((sum, s) => sum + (s.unread || 0), 0);
  document.title = total ? `(${total}) Multi-Lignes` : "Multi-Lignes";
  if ("setAppBadge" in navigator) {
    (total ? navigator.setAppBadge(total) : navigator.clearAppBadge()).catch(() => {});
  }
}

function renderChats() {
  renderChatList(el.chatList, {
    chats: [...state.line.chats.values()].sort((a, b) => b.lastMessageAt - a.lastMessageAt),
    loading: state.line.loading,
    filter: state.filter,
    openChatId: state.line.openChatId,
    session: activeSession(),
  });
}

function currentChat() {
  const { openChatId, chats, draftChat } = state.line;
  return chats.get(openChatId) ?? (draftChat?.id === openChatId ? draftChat : null);
}

function renderComposer() {
  const session = activeSession();
  const canSend = session?.status === "open";
  el.input.disabled = !canSend;
  el.sendBtn.disabled = !canSend;
  el.input.placeholder = canSend ? `Répondre depuis ${session.label}` : "Ligne non connectée : envoi impossible";
}

function renderConversation({ scroll } = {}) {
  const { openChatId } = state.line;
  document.body.classList.toggle("chat-open", Boolean(openChatId));
  el.conversation.hidden = !openChatId;
  el.convEmpty.hidden = Boolean(openChatId);
  if (!openChatId) return;

  const chat = currentChat() ?? { id: openChatId };
  const session = activeSession();
  const title = chatTitle(chat);
  el.convAvatar.textContent = chat.isGroup ? "👥" : initials(title);
  el.convAvatar.style.background = avatarColor(chat.id);
  el.convName.textContent = title;
  el.convSub.textContent = chat.isGroup ? "Groupe" : formatPhone(chat.phone) || "";
  el.convLine.textContent = session ? `via ${session.label}` : "";
  renderComposer();

  const box = el.messages;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const fromBottom = box.scrollHeight - box.scrollTop;
  renderMessages(box, {
    messages: state.line.messages,
    hasMore: state.line.hasMore,
    loading: state.line.loadingMessages,
    chat,
  });
  if (scroll === "bottom" || (scroll !== "keep" && atBottom)) box.scrollTop = box.scrollHeight;
  else if (scroll === "keep") box.scrollTop = box.scrollHeight - fromBottom;
}

function renderLinesView() {
  if (state.view !== "lines") return;
  renderLines(el.lineCards, { sessions: sortedSessions(), activeId: state.activeId });
}

function renderLineContext() {
  applyLineTheme();
  renderTabs();
  renderBanner(el.banner, activeSession());
  renderComposer();
  updateBadges();
}

function showView(view) {
  state.view = view;
  document.body.dataset.view = view;
  for (const section of document.querySelectorAll(".view")) section.hidden = section.dataset.view !== view;
  for (const btn of document.querySelectorAll("[data-nav]")) {
    const on = btn.dataset.nav === view;
    btn.classList.toggle("is-active", on);
    if (on) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  }
  renderLinesView();
}

function setConn(status) {
  el.conn.dataset.state = status;
  el.conn.querySelector(".conn-label").textContent = { online: "En direct", offline: "Hors ligne", connecting: "Connexion…" }[status];
}

function setSettingsStatus(message, type = "info") {
  el.settingsStatus.textContent = message;
  el.settingsStatus.dataset.type = type;
}

function toastError(err) {
  if (err?.status === 401) return onUnauthorized(err.message);
  toast(err?.message || "Une erreur est survenue.", { type: "error", duration: 6000 });
}

// --- Données de la ligne active ---------------------------------------------------

function upsertChat(chat) {
  if (!chat) return;
  state.line.chats.set(chat.id, { ...state.line.chats.get(chat.id), ...chat });
}

function mergeMessages(...lists) {
  const byId = new Map();
  for (const list of lists) for (const m of list) byId.set(m.id, { ...byId.get(m.id), ...m });
  return [...byId.values()].sort((a, b) => a.timestamp - b.timestamp);
}

/** Change de ligne : les données de l'ancienne ligne sont jetées. */
async function selectLine(id, { force = false } = {}) {
  if (!force && id === state.line.sessionId) return;
  state.activeId = id;
  settings.activeId = id;
  saveSettings(settings);
  state.line = emptyLine(id);
  state.filter = "";
  el.search.value = "";
  el.input.value = "";
  closeConversation();
  renderLineContext();
  renderChats();
  renderLinesView();
  if (!id) return;
  await state.realtime?.select(id);
  await loadChats(id);
}

async function loadChats(id) {
  try {
    const data = await api.chats(id);
    if (!isActive(data.sessionId)) return; // l'utilisateur a changé de ligne entre-temps
    state.line.chats = new Map(data.chats.map((c) => [c.id, c]));
  } catch (err) {
    if (isActive(id)) toastError(err);
  } finally {
    if (isActive(id)) {
      state.line.loading = false;
      renderChats();
    }
  }
}

async function openChat(chatId, { draft } = {}) {
  const line = state.line;
  const sessionId = line.sessionId;
  if (!sessionId) return;
  line.openChatId = chatId;
  line.draftChat = draft ?? null;
  line.messages = [];
  line.hasMore = false;
  line.loadingMessages = true;
  if (!history.state?.chat) history.pushState({ chat: true }, "");
  renderConversation({ scroll: "bottom" });
  renderChats();
  try {
    const data = await api.messages(sessionId, chatId);
    if (!isActive(data.sessionId) || state.line.openChatId !== chatId) return;
    line.messages = mergeMessages(data.messages, line.messages);
    line.hasMore = data.hasMore;
    if (data.chat) upsertChat(data.chat);
  } catch (err) {
    toastError(err);
  } finally {
    if (isActive(sessionId) && state.line.openChatId === chatId) {
      line.loadingMessages = false;
      renderConversation({ scroll: "bottom" });
      markRead(chatId);
    }
  }
  if (!matchMedia("(pointer: coarse)").matches) el.input.focus();
}

async function loadOlder() {
  const line = state.line;
  const { sessionId, openChatId } = line;
  const oldest = line.messages[0];
  if (!oldest) return;
  try {
    const data = await api.messages(sessionId, openChatId, { before: oldest.timestamp });
    if (!isActive(data.sessionId) || state.line.openChatId !== openChatId) return;
    line.messages = mergeMessages(data.messages, line.messages);
    line.hasMore = data.hasMore;
    renderConversation({ scroll: "keep" });
  } catch (err) {
    toastError(err);
  }
}

function closeConversation() {
  state.line.openChatId = null;
  state.line.draftChat = null;
  if (history.state?.chat) history.replaceState(null, "");
  renderConversation();
}

/** Remet le compteur à zéro dans l'app (n'envoie PAS d'accusé de lecture à WhatsApp). */
function markRead(chatId) {
  const sessionId = state.line.sessionId;
  const chat = state.line.chats.get(chatId);
  if (!chat?.unread) return;
  chat.unread = 0;
  renderChats();
  api.markRead(sessionId, chatId).catch(() => {});
}

function addMessage(message) {
  state.line.messages = mergeMessages(state.line.messages, [message]);
  renderConversation();
}

async function sendMessage() {
  const text = el.input.value.trim();
  const { sessionId, openChatId } = state.line;
  if (!text || !sessionId || !openChatId) return;
  el.sendBtn.disabled = true;
  try {
    const data = await api.send(sessionId, openChatId, text);
    if (!isActive(data.sessionId)) return;
    el.input.value = "";
    autosize();
    upsertChat(data.chat);
    // Nouvelle discussion : WhatsApp peut renvoyer un identifiant légèrement différent.
    if (state.line.openChatId === openChatId && data.chat.id !== openChatId) {
      state.line.openChatId = data.chat.id;
      state.line.draftChat = null;
    }
    if (state.line.openChatId === data.chat.id) {
      state.line.messages = mergeMessages(state.line.messages, [data.message]);
      renderConversation({ scroll: "bottom" });
    }
    renderChats();
  } catch (err) {
    toastError(err);
  } finally {
    renderComposer();
    el.input.focus();
  }
}

// --- Temps réel ---------------------------------------------------------------

function applySessionSummary(summary) {
  state.sessions.set(summary.id, summary);
  renderTabs();
  renderLinesView();
  if (summary.id === state.activeId) renderLineContext();
  else updateBadges();
}

function onEvent(name, payload) {
  switch (name) {
    case "sessions:list": {
      state.sessions = new Map(payload.map((s) => [s.id, s]));
      if (!state.sessions.has(state.activeId)) selectLine(sortedSessions()[0]?.id ?? null);
      renderLineContext();
      renderLinesView();
      break;
    }
    case "session:update":
      applySessionSummary(payload);
      break;
    case "session:removed": {
      state.sessions.delete(payload.sessionId);
      if (payload.sessionId === state.activeId) selectLine(sortedSessions()[0]?.id ?? null);
      renderLineContext();
      renderLinesView();
      break;
    }
    // Contenu des conversations : on vérifie TOUJOURS que l'événement concerne la ligne affichée.
    case "message:new": {
      if (!isActive(payload.sessionId)) return;
      upsertChat(payload.chat);
      const open = state.line.openChatId === payload.chat.id;
      if (open) {
        addMessage(payload.message);
        if (!payload.message.fromMe && document.visibilityState === "visible") markRead(payload.chat.id);
      }
      renderChats();
      break;
    }
    case "message:update": {
      if (!isActive(payload.sessionId)) return;
      upsertChat(payload.chat);
      if (state.line.openChatId === payload.chat?.id && state.line.messages.some((m) => m.id === payload.message.id)) {
        addMessage(payload.message);
      }
      renderChats();
      break;
    }
    case "chat:update": {
      if (!isActive(payload.sessionId)) return;
      upsertChat(payload.chat);
      renderChats();
      if (state.line.openChatId === payload.chat.id) renderConversation();
      break;
    }
    case "chats:reset": {
      if (!isActive(payload.sessionId)) return;
      loadChats(payload.sessionId);
      break;
    }
  }
}

/** Après une coupure réseau : on recharge ce qui a pu être manqué. */
async function resync() {
  const id = state.line.sessionId;
  if (!id) return;
  await loadChats(id);
  const chatId = state.line.openChatId;
  if (chatId && isActive(id)) {
    try {
      const data = await api.messages(id, chatId);
      if (isActive(data.sessionId) && state.line.openChatId === chatId) {
        state.line.messages = mergeMessages(state.line.messages, data.messages);
        renderConversation();
      }
    } catch {
      // nouvel essai à la prochaine reconnexion
    }
  }
}

function onUnauthorized(message) {
  state.realtime?.close();
  state.realtime = null;
  setConn("offline");
  showView("settings");
  setSettingsStatus(message || "Jeton refusé par le serveur.", "error");
}

async function connect() {
  state.realtime?.close();
  state.realtime = null;
  setConn("connecting");
  try {
    const sessions = await api.listSessions();
    state.sessions = new Map(sessions.map((s) => [s.id, s]));
  } catch (err) {
    if (err.status === 401 || err.status === 429) return onUnauthorized(err.message);
    toastError(err);
  }
  if (typeof window.io !== "function") {
    toast("Client temps réel introuvable (vendor/socket.io.min.js). Lance « npm install » sur le serveur.", { type: "error", duration: 0 });
  } else {
    state.realtime = createRealtime({
      base: serverBase(settings),
      token: settings.token,
      handlers: { status: setConn, event: onEvent, resync, unauthorized: onUnauthorized },
    });
  }
  const target = state.sessions.has(state.activeId) ? state.activeId : (sortedSessions()[0]?.id ?? null);
  await selectLine(target, { force: true });
  if (!state.sessions.size) showView("lines");
}

// --- Actions ------------------------------------------------------------------

async function onLineAction(action, id) {
  const session = state.sessions.get(id);
  if (!session) return;
  switch (action) {
    case "open-messages":
      await selectLine(id);
      showView("messages");
      break;
    case "connect-qr":
      applySessionSummary(await api.connect(id));
      break;
    case "connect-code": {
      const phone = await promptDialog({
        title: "Connexion par code",
        message: "Numéro du compte WhatsApp Business de cette ligne, avec l'indicatif du pays (sans + ni 0 au début).",
        label: "Numéro",
        placeholder: "33612345678",
        inputMode: "tel",
        confirmLabel: "Recevoir le code",
      });
      if (phone) applySessionSummary(await api.connect(id, phone));
      break;
    }
    case "pause":
      applySessionSummary(await api.disconnect(id));
      break;
    case "logout": {
      const ok = await confirmDialog({
        title: `Délier « ${session.label} » ?`,
        message: "L'appareil sera retiré de WhatsApp : il faudra refaire un QR code (ou un code) pour reconnecter cette ligne. L'historique affiché est conservé.",
        confirmLabel: "Délier",
        danger: true,
      });
      if (!ok) return;
      const result = await api.logout(id);
      applySessionSummary(result.session);
      if (!result.remoteLogout) {
        toast("Pense à retirer l'appareil dans WhatsApp → Appareils connectés, sur le téléphone de la ligne.", { duration: 8000 });
      }
      break;
    }
    case "rename": {
      const label = await promptDialog({ title: "Renommer la ligne", label: "Nom", value: session.label, confirmLabel: "Renommer" });
      if (label) applySessionSummary(await api.renameSession(id, label));
      break;
    }
    case "delete": {
      const ok = await confirmDialog({
        title: `Supprimer « ${session.label} » ?`,
        message: "La ligne est déliée et toutes ses données (connexion et historique) sont effacées du serveur. Action définitive.",
        confirmLabel: "Supprimer",
        danger: true,
      });
      if (!ok) return;
      await api.removeSession(id);
      onEvent("session:removed", { sessionId: id });
      toast("Ligne supprimée.");
      break;
    }
  }
}

async function onAddLine(event) {
  event.preventDefault();
  const form = el.addForm;
  const data = new FormData(form);
  const label = String(data.get("label") || "").trim();
  const byCode = data.get("method") === "code";
  const phoneNumber = byCode ? String(data.get("phone") || "").trim() : undefined;
  if (byCode && !phoneNumber) {
    toast("Indique le numéro de la ligne pour recevoir un code.", { type: "error" });
    return;
  }
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const session = await api.createSession({ label: label || undefined, phoneNumber });
    form.reset();
    togglePhoneField();
    applySessionSummary(session);
    if (!state.activeId) await selectLine(session.id);
    el.lineCards.querySelector(`[data-id="${CSS.escape(session.id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    toastError(err);
  } finally {
    button.disabled = false;
  }
}

function togglePhoneField() {
  const byCode = el.addForm.elements.method.value === "code";
  const field = $("#phone-field");
  field.hidden = !byCode;
  field.querySelector("input").required = byCode;
}

async function startNewChat() {
  if (!state.line.sessionId) return;
  const value = await promptDialog({
    title: "Nouvelle discussion",
    message: `Depuis ${activeSession()?.label ?? "cette ligne"}. Numéro avec l'indicatif du pays.`,
    label: "Numéro",
    placeholder: "33612345678",
    inputMode: "tel",
    confirmLabel: "Ouvrir",
  });
  if (!value) return;
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") || digits.length < 8 || digits.length > 15) {
    toast("Numéro invalide : indicatif du pays + numéro, sans le 0 (ex. 33612345678).", { type: "error" });
    return;
  }
  const chatId = `${digits}@s.whatsapp.net`;
  openChat(chatId, { draft: { id: chatId, phone: digits, name: null, isGroup: false } });
}

async function onSaveSettings(event) {
  event.preventDefault();
  settings.serverUrl = el.settingsForm.elements.serverUrl.value.trim().replace(/\/+$/, "");
  settings.token = el.settingsForm.elements.token.value.trim();
  saveSettings(settings);
  if (!serverBase(settings)) return setSettingsStatus("Indique l'adresse du serveur.", "error");
  setSettingsStatus("Connexion…");
  try {
    await api.listSessions();
    setSettingsStatus("Connecté au serveur ✓", "ok");
    await connect();
    showView(state.sessions.size ? "messages" : "lines");
  } catch (err) {
    setSettingsStatus(err.message, "error");
  }
}

function forgetToken() {
  settings.token = "";
  saveSettings(settings);
  state.realtime?.close();
  state.realtime = null;
  state.sessions.clear();
  state.line = emptyLine(null);
  el.settingsForm.elements.token.value = "";
  setConn("offline");
  renderLineContext();
  renderChats();
  closeConversation();
  setSettingsStatus("Jeton effacé de cet appareil.");
}

function autosize() {
  el.input.style.height = "auto";
  el.input.style.height = `${Math.min(el.input.scrollHeight, 160)}px`;
}

// --- Branchements ---------------------------------------------------------------

function wireEvents() {
  for (const btn of document.querySelectorAll("[data-nav]")) btn.addEventListener("click", () => showView(btn.dataset.nav));

  el.tabs.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-line]");
    if (tab) {
      selectLine(tab.dataset.line);
      if (state.view === "settings") showView("messages");
      return;
    }
    if (event.target.closest('[data-action="add-line"]')) {
      showView("lines");
      el.addForm.elements.label.focus();
    }
  });

  el.banner.addEventListener("click", (event) => {
    if (event.target.closest('[data-action="manage-line"]')) showView("lines");
  });

  el.search.addEventListener("input", () => {
    state.filter = el.search.value;
    renderChats();
  });

  el.chatList.addEventListener("click", (event) => {
    const item = event.target.closest("[data-chat]");
    if (item) openChat(item.dataset.chat);
  });

  $("#btn-new-chat").addEventListener("click", startNewChat);
  $("#btn-back").addEventListener("click", closeConversation);
  window.addEventListener("popstate", () => {
    if (state.line.openChatId) closeConversation();
  });

  el.messages.addEventListener("click", (event) => {
    if (event.target.closest('[data-action="load-more"]')) loadOlder();
  });

  el.composer.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage();
  });
  el.input.addEventListener("input", autosize);
  el.input.addEventListener("keydown", (event) => {
    // Entrée envoie sur ordinateur ; sur téléphone, Entrée fait un retour à la ligne.
    if (event.key === "Enter" && !event.shiftKey && !matchMedia("(pointer: coarse)").matches) {
      event.preventDefault();
      sendMessage();
    }
  });

  el.lineCards.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    const card = event.target.closest("[data-id]");
    if (!button || !card) return;
    button.disabled = true;
    try {
      await onLineAction(button.dataset.action, card.dataset.id);
    } catch (err) {
      toastError(err);
    } finally {
      button.disabled = false;
    }
  });

  el.addForm.addEventListener("submit", onAddLine);
  el.addForm.addEventListener("change", togglePhoneField);
  el.settingsForm.addEventListener("submit", onSaveSettings);
  $("#btn-forget").addEventListener("click", forgetToken);
  $("#btn-toggle-token").addEventListener("click", () => {
    const input = el.settingsForm.elements.token;
    input.type = input.type === "password" ? "text" : "password";
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.line.openChatId) markRead(state.line.openChatId);
  });

  // Compte à rebours des reconnexions dans la vue « Lignes ».
  setInterval(() => {
    if (state.view === "lines" && sortedSessions().some((s) => s.status === "reconnecting")) renderLinesView();
  }, 1000);
}

function setupInstall() {
  let deferred = null;
  const button = $("#btn-install");
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event;
    button.hidden = false;
  });
  button.addEventListener("click", async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => null);
    deferred = null;
    button.hidden = true;
  });
  window.addEventListener("appinstalled", () => toast("Application installée ✓"));
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone) $("#install-ios").hidden = false;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || isNative() || !window.isSecureContext) return;
  let hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) {
      hadController = true;
      return;
    }
    toast("Nouvelle version de l'application disponible.", { duration: 0, action: { label: "Recharger", onClick: () => location.reload() } });
  });
  navigator.serviceWorker.register("./sw.js").catch((err) => console.warn("Service worker non enregistré :", err));
}

function boot() {
  wireEvents();
  setupInstall();
  registerServiceWorker();
  el.settingsForm.elements.serverUrl.value = settings.serverUrl || (isNative() ? "" : window.location.origin);
  el.settingsForm.elements.token.value = settings.token;
  if (isNative()) $("#server-url-hint").textContent = "Adresse publique de ton serveur (HTTPS conseillé), ex. https://lignes.mondomaine.fr";
  setConn("offline");
  renderLineContext();
  renderChats();
  const start = location.hash.replace("#", "");
  if (!settings.token || !serverBase(settings)) {
    showView("settings");
    setSettingsStatus("Colle le jeton d'accès affiché par le serveur au premier démarrage.");
    return;
  }
  showView(["lines", "settings"].includes(start) ? start : "messages");
  connect();
}

boot();
