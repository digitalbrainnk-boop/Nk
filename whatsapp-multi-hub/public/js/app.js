// Contrôleur principal de la PWA.
//
// Règle d'isolation côté client : seules les données de la ligne ACTIVE sont en
// mémoire (state.line). Changer de ligne remplace entièrement cet objet, et toute
// réponse ou événement qui ne porte pas l'identifiant de la ligne active est ignoré.
import { createApi } from "./api.js";
import { clearVault, forgetKey, hasVault, lockSupported, lockoutRemaining, openVault, pinLength, resealToken, sealToken } from "./lock.js";
import { currentSubscription, disablePush, enablePush, pushSupported } from "./notifications.js";
import { createRealtime } from "./realtime.js";
import { isNative, loadSettings, saveSettings, serverBase } from "./settings.js";
import {
  $,
  actionSheet,
  avatarColor,
  confirmDialog,
  esc,
  filePreviewDialog,
  formatDuration,
  formatPhone,
  icons,
  initials,
  promptDialog,
  toast,
} from "./ui.js";
import { renderLines } from "./views/lines.js";
import { chatTitle, renderBanner, renderChatList, renderMessages } from "./views/messages.js";

const DEFAULT_COLOR = "#0f766e";
const settings = loadSettings();
// Le jeton vit en mémoire ; sur l'appareil, il est soit en clair (sans code), soit chiffré par le code.
const memory = { token: hasVault() ? "" : settings.token || "" };
if (hasVault() && settings.token) {
  settings.token = "";
  saveSettings(settings);
}
settings.lockDelay ??= 60000;
const api = createApi(() => ({ base: serverBase(settings), token: memory.token }));

/** Enregistre le jeton : chiffré si le code de verrouillage est actif, sinon tel quel. */
async function setToken(token) {
  memory.token = token;
  if (hasVault()) {
    await resealToken(token);
    settings.token = "";
  } else {
    settings.token = token;
  }
  saveSettings(settings);
}

const emptyLine = (sessionId) => ({
  sessionId,
  chats: new Map(),
  loading: Boolean(sessionId),
  openChatId: null,
  draftChat: null,
  messages: [],
  hasMore: false,
  loadingMessages: false,
  replyTo: null, // message auquel on répond
  pending: [], // fichiers en cours d'envoi
});

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

const state = {
  view: "messages",
  sessions: new Map(),
  activeId: settings.activeId,
  realtime: null,
  filter: "",
  line: emptyLine(null),
  caps: { voiceNotes: false, maxUploadBytes: 64 * 1024 * 1024 },
  native: null, // état des notifications Android (Termux:API), fourni par le serveur
  recording: null,
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
  sendBtn: $("#btn-send"),
  micBtn: $("#btn-mic"),
  attachBtn: $("#btn-attach"),
  replyBar: $("#reply-bar"),
  replyAuthor: $("#reply-author"),
  replyText: $("#reply-text"),
  recorder: $("#recorder"),
  recTime: $("#rec-time"),
  viewer: $("#viewer"),
  viewerImg: $("#viewer-img"),
  viewerDownload: $("#viewer-download"),
  offlineBanner: $("#offline-banner"),
  installBanner: $("#install-banner"),
  lock: $("#lock"),
  lockMsg: $("#lock-msg"),
  pinDots: $("#pin-dots"),
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

const canRecord = () => Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder && window.isSecureContext);

function renderComposer() {
  const session = activeSession();
  const canSend = session?.status === "open";
  el.input.disabled = !canSend;
  el.sendBtn.disabled = !canSend;
  el.attachBtn.disabled = !canSend;
  el.micBtn.disabled = !canSend;
  el.input.placeholder = canSend ? "Message" : "Ligne non connectée";
  // Comme WhatsApp : micro quand le champ est vide, flèche d'envoi sinon.
  const hasText = el.input.value.trim().length > 0;
  el.micBtn.hidden = hasText || !canRecord();
  el.sendBtn.hidden = !el.micBtn.hidden;

  const reply = state.line.replyTo;
  el.replyBar.hidden = !reply;
  if (reply) {
    el.replyAuthor.textContent = reply.author;
    el.replyText.textContent = reply.text;
  }
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
    pending: state.line.pending.filter((p) => p.chatId === openChatId),
    mediaUrl: api.mediaUrl,
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
  if (view === "settings" && state.view !== "settings" && memory.token) renderNotifications().catch(() => {});
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

let offlineTimer = null;
function setConn(status) {
  el.conn.dataset.state = status;
  el.conn.querySelector(".conn-label").textContent = { online: "En direct", offline: "Hors ligne", connecting: "Connexion…" }[status];
  // Bandeau seulement si la coupure dure plus de 4 s (évite les clignotements).
  // Les tentatives de reconnexion successives ne relancent pas le compte à rebours.
  if (status === "online" || !memory.token) {
    clearTimeout(offlineTimer);
    offlineTimer = null;
    el.offlineBanner.hidden = true;
  } else if (!offlineTimer && el.offlineBanner.hidden) {
    offlineTimer = setTimeout(() => {
      offlineTimer = null;
      el.offlineBanner.hidden = !memory.token;
    }, 4000);
  }
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
  stopRecording(false);
  state.line.openChatId = null;
  state.line.draftChat = null;
  state.line.replyTo = null;
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
  const { sessionId, openChatId, replyTo } = state.line;
  if (!text || !sessionId || !openChatId) return;
  el.sendBtn.disabled = true;
  try {
    const data = await api.send(sessionId, openChatId, text, replyTo?.id);
    if (!isActive(data.sessionId)) return;
    el.input.value = "";
    state.line.replyTo = null;
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

// --- Fichiers, vocaux, réponses, réactions -----------------------------------------

/** Message reçu de l'envoi : on l'ajoute à la conversation ouverte (même ligne, même discussion). */
function acceptSent(data, chatIdAtStart) {
  if (!isActive(data.sessionId)) return;
  upsertChat(data.chat);
  if (state.line.openChatId === chatIdAtStart && data.chat.id !== chatIdAtStart) {
    state.line.openChatId = data.chat.id;
    state.line.draftChat = null;
  }
  if (state.line.openChatId === data.chat.id) {
    state.line.messages = mergeMessages(state.line.messages, [data.message]);
  }
  renderConversation({ scroll: "bottom" });
  renderChats();
  if (data.notice) toast(data.notice, { duration: 7000 });
}

/** Envoie des fichiers un par un, avec une bulle de progression pour chacun. */
async function uploadFiles(files, { caption = "", voice = false } = {}) {
  const { sessionId, openChatId } = state.line;
  if (!sessionId || !openChatId) return;
  const replyTo = state.line.replyTo?.id;
  state.line.replyTo = null;
  renderComposer();
  for (const [index, file] of files.entries()) {
    if (file.size > state.caps.maxUploadBytes) {
      toast(`« ${file.name} » est trop lourd (${Math.round(state.caps.maxUploadBytes / 1048576)} Mo maximum).`, { type: "error", duration: 6000 });
      continue;
    }
    const item = { tempId: `up-${Date.now()}-${index}`, chatId: openChatId, name: file.name, voice, progress: 0 };
    if (!isActive(sessionId)) return;
    state.line.pending.push(item);
    renderConversation({ scroll: "bottom" });
    try {
      const data = await api.sendMedia(
        sessionId,
        { to: openChatId, file, caption: index === 0 ? caption : "", replyTo: index === 0 ? replyTo : undefined, voice },
        (progress) => {
          item.progress = progress;
          const bar = el.messages.querySelector(`[data-pending="${CSS.escape(item.tempId)}"]`);
          if (bar) {
            bar.querySelector(".progress span").style.width = `${Math.round(progress * 100)}%`;
            bar.querySelector(".msg-meta").textContent = `Envoi… ${Math.round(progress * 100)} %`;
          }
        },
      );
      if (isActive(sessionId)) state.line.pending = state.line.pending.filter((p) => p !== item);
      acceptSent(data, openChatId);
    } catch (err) {
      if (isActive(sessionId)) {
        state.line.pending = state.line.pending.filter((p) => p !== item);
        renderConversation();
      }
      toastError(err);
    }
  }
}

async function chooseFiles(input) {
  const files = [...input.files];
  input.value = "";
  if (!files.length) return;
  const caption = await filePreviewDialog(files, { lineLabel: activeSession()?.label ?? "cette ligne" });
  if (caption === null) return;
  await uploadFiles(files, { caption });
}

async function openAttachMenu() {
  const choice = await actionSheet({
    title: "Joindre",
    actions: [
      { id: "media", label: "Photos et vidéos", icon: icons.image },
      { id: "camera", label: "Appareil photo", icon: icons.camera },
      { id: "doc", label: "Document", icon: icons.file },
    ],
  });
  const input = { media: "#file-media", camera: "#file-camera", doc: "#file-doc" }[choice?.action];
  if (input) $(input).click();
}

// Vocaux : enregistrés dans le navigateur, convertis au format WhatsApp par le serveur.
async function startRecording() {
  if (state.recording) return;
  if (!canRecord()) return toast("L'enregistrement vocal demande HTTPS (ou localhost) et un navigateur récent.", { type: "error" });
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return toast("Micro refusé : autorise le micro pour cette application dans les réglages du navigateur.", { type: "error", duration: 6000 });
  }
  const mimeType = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.start(250);
  const startedAt = Date.now();
  const timer = setInterval(() => {
    const seconds = (Date.now() - startedAt) / 1000;
    el.recTime.textContent = formatDuration(seconds);
    if (seconds > 15 * 60) stopRecording(true); // 15 minutes maximum
  }, 250);
  state.recording = { recorder, stream, chunks, timer };
  el.recTime.textContent = "0:00";
  el.recorder.hidden = false;
  el.composer.hidden = true;
}

function stopRecording(send) {
  const rec = state.recording;
  if (!rec) return;
  state.recording = null;
  clearInterval(rec.timer);
  el.recorder.hidden = true;
  el.composer.hidden = false;
  rec.recorder.onstop = () => {
    rec.stream.getTracks().forEach((t) => t.stop());
    if (!send || !rec.chunks.length) return;
    const type = rec.recorder.mimeType || "audio/webm";
    const ext = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : "webm";
    uploadFiles([new File(rec.chunks, `vocal.${ext}`, { type })], { voice: true });
  };
  rec.recorder.stop();
}

function findMessage(id) {
  return state.line.messages.find((m) => m.id === id) ?? null;
}

function authorLabel(message) {
  if (message.fromMe) return "Vous";
  const chat = currentChat();
  return chat?.isGroup ? message.authorName || "Participant" : chatTitle(chat);
}

/** Menu d'un message : réactions rapides, répondre, copier, télécharger, supprimer. */
async function openMessageMenu(id) {
  const message = findMessage(id);
  if (!message || message.deleted) return;
  const { sessionId, openChatId } = state.line;
  const open = activeSession()?.status === "open";
  const actions = [];
  if (open) actions.push({ id: "reply", label: "Répondre", icon: icons.reply });
  if (message.text) actions.push({ id: "copy", label: "Copier le texte", icon: icons.copy });
  if (message.media?.url) actions.push({ id: "download", label: "Télécharger", icon: icons.download });
  if (open && message.fromMe) actions.push({ id: "delete", label: "Supprimer pour tout le monde", icon: icons.trash, danger: true });
  const choice = await actionSheet({ emojis: open ? { list: QUICK_REACTIONS, current: message.reactions?.me } : null, actions });
  if (!choice || !isActive(sessionId) || state.line.openChatId !== openChatId) return;
  try {
    if (choice.emoji !== undefined) {
      const data = await api.react(sessionId, openChatId, id, choice.emoji);
      if (isActive(data.sessionId)) addMessage(data.message);
    } else if (choice.action === "reply") {
      const preview = message.text || { image: "📷 Photo", video: "🎬 Vidéo", voice: "🎤 Message vocal", audio: "🎵 Audio", document: `📄 ${message.media?.fileName ?? "Document"}`, sticker: "Autocollant" }[message.type] || "Message";
      state.line.replyTo = { id, author: authorLabel(message), text: preview };
      renderComposer();
      el.input.focus();
    } else if (choice.action === "copy") {
      await navigator.clipboard.writeText(message.text);
      toast("Texte copié.");
    } else if (choice.action === "download") {
      const a = document.createElement("a");
      a.href = api.mediaUrl(message.media.url);
      a.download = message.media.fileName || "";
      a.target = "_blank";
      a.rel = "noopener";
      a.click();
    } else if (choice.action === "delete") {
      const ok = await confirmDialog({
        title: "Supprimer pour tout le monde ?",
        message: "Le message sera remplacé par « Message supprimé » chez le destinataire aussi.",
        confirmLabel: "Supprimer",
        danger: true,
      });
      if (!ok) return;
      const data = await api.deleteMessage(sessionId, openChatId, id);
      if (isActive(data.sessionId)) addMessage(data.message);
    }
  } catch (err) {
    toastError(err);
  }
}

function openViewer(src) {
  el.viewerImg.src = src;
  el.viewerDownload.href = src;
  el.viewer.hidden = false;
  history.pushState({ chat: true, viewer: true }, "");
}

let ignoreNextPop = false;
function closeViewer({ fromHistory = false } = {}) {
  if (el.viewer.hidden) return false;
  el.viewer.hidden = true;
  el.viewerImg.removeAttribute("src");
  if (!fromHistory && history.state?.viewer) {
    ignoreNextPop = true; // ce retour arrière ne doit pas fermer la conversation
    history.back();
  }
  return true;
}

function gotoMessage(id) {
  const target = el.messages.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (!target) return toast("Message trop ancien : charge les messages précédents pour le voir.");
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.add("is-flash");
  setTimeout(() => target.classList.remove("is-flash"), 1200);
}

/** Appui long (téléphone) ou clic droit (ordinateur) sur une bulle -> menu du message. */
function wireMessageGestures() {
  let timer = null;
  let startX = 0;
  let startY = 0;
  let suppressClick = false;
  let lastMenuAt = 0;
  const openMenu = (bubble) => {
    if (Date.now() - lastMenuAt < 600) return;
    lastMenuAt = Date.now();
    const id = bubble.closest("[data-id]")?.dataset.id;
    if (id) openMessageMenu(id);
  };
  el.messages.addEventListener("pointerdown", (event) => {
    // Nouveau geste : le clic d'un appui long précédent ne doit plus rien bloquer.
    suppressClick = false;
    const bubble = event.target.closest(".msg[data-id] .bubble");
    if (!bubble || event.target.closest("audio, video, a") || event.button > 0) return;
    startX = event.clientX;
    startY = event.clientY;
    timer = setTimeout(() => {
      timer = null;
      suppressClick = true;
      openMenu(bubble);
    }, 480);
  });
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  el.messages.addEventListener("pointerup", cancel);
  el.messages.addEventListener("pointercancel", cancel);
  el.messages.addEventListener("pointermove", (event) => {
    if (timer && Math.hypot(event.clientX - startX, event.clientY - startY) > 10) cancel();
  });
  el.messages.addEventListener("contextmenu", (event) => {
    const bubble = event.target.closest(".msg[data-id] .bubble");
    if (!bubble || event.target.closest("audio, video")) return;
    event.preventDefault();
    cancel();
    openMenu(bubble);
  });
  el.messages.addEventListener(
    "click",
    (event) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
}

// --- Temps réel ---------------------------------------------------------------

const lastLineToast = new Map();
function applySessionSummary(summary) {
  const previous = state.sessions.get(summary.id);
  state.sessions.set(summary.id, summary);
  renderTabs();
  renderLinesView();
  if (summary.id === state.activeId) renderLineContext();
  else updateBadges();
  // Nouveau message sur une AUTRE ligne : on prévient sans rien en montrer.
  if (previous && summary.id !== state.activeId && summary.unread > (previous.unread || 0)) {
    const last = lastLineToast.get(summary.id) ?? 0;
    if (Date.now() - last > 5000) {
      lastLineToast.set(summary.id, Date.now());
      navigator.vibrate?.(40);
      toast(`Nouveau message sur ${summary.label}`, {
        action: {
          label: "Voir",
          onClick: () => {
            showView("messages");
            selectLine(summary.id);
          },
        },
      });
    }
  }
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
  el.offlineBanner.hidden = true;
  showView("settings");
  setSettingsStatus(
    message && !/invalide/i.test(message)
      ? message
      : "Accès refusé : le jeton a peut-être été changé. Dans Termux, tape « lignes » pour obtenir un nouveau lien de connexion.",
    "error",
  );
}

async function connect({ keepView = false } = {}) {
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
  api
    .capabilities()
    .then((caps) => Object.assign(state.caps, caps))
    .catch(() => {});
  if (typeof window.io !== "function") {
    toast("Client temps réel introuvable (vendor/socket.io.min.js). Lance « npm install » sur le serveur.", { type: "error", duration: 0 });
  } else {
    state.realtime = createRealtime({
      base: serverBase(settings),
      token: memory.token,
      handlers: { status: setConn, event: onEvent, resync, unauthorized: onUnauthorized },
    });
  }
  const target = state.sessions.has(state.activeId) ? state.activeId : (sortedSessions()[0]?.id ?? null);
  await selectLine(target, { force: true });
  if (!state.sessions.size && !keepView) showView("lines");
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
      const digits = phone && cleanPhone(phone);
      if (digits) applySessionSummary(await api.connect(id, digits));
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
  const phoneNumber = byCode ? cleanPhone(data.get("phone")) : undefined;
  if (byCode && !phoneNumber) return;
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

/** Numéro international (indicatif + numéro) ou null avec un message d'aide. */
function cleanPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") || digits.length < 8 || digits.length > 15) {
    toast("Numéro invalide : indicatif du pays + numéro, sans le 0 du début (ex. 33612345678, 22670123456).", { type: "error", duration: 6000 });
    return null;
  }
  return digits;
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
  const digits = value && cleanPhone(value);
  if (!digits) return;
  const chatId = `${digits}@s.whatsapp.net`;
  openChat(chatId, { draft: { id: chatId, phone: digits, name: null, isGroup: false } });
}

async function onSaveSettings(event) {
  event.preventDefault();
  settings.serverUrl = el.settingsForm.elements.serverUrl.value.trim().replace(/\/+$/, "");
  const typed = el.settingsForm.elements.token.value.trim();
  saveSettings(settings);
  if (!serverBase(settings)) return setSettingsStatus("Indique l'adresse du serveur.", "error");
  if (typed) await setToken(typed);
  if (!memory.token) return setSettingsStatus("Ouvre le lien de connexion affiché dans Termux (commande « lignes »).", "error");
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
  disablePush(api).catch(() => {});
  clearVault();
  memory.token = "";
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
  renderSecurity();
  renderNotifications();
  setSettingsStatus("Cet appareil est déconnecté. Pour revenir : dans Termux, tape « lignes ».");
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
    if (event.target.closest('[data-action="go-lines"]')) {
      showView("lines");
      el.addForm.elements.label.focus();
      return;
    }
    const item = event.target.closest("[data-chat]");
    if (item) openChat(item.dataset.chat);
  });

  $("#btn-new-chat").addEventListener("click", startNewChat);
  $("#btn-back").addEventListener("click", closeConversation);
  window.addEventListener("popstate", () => {
    if (ignoreNextPop) {
      ignoreNextPop = false;
      return;
    }
    if (closeViewer({ fromHistory: true })) return;
    if (state.line.openChatId) closeConversation();
  });

  el.messages.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]");
    if (!action) return;
    const name = action.dataset.action;
    if (name === "load-more") loadOlder();
    else if (name === "view") openViewer(action.dataset.src);
    else if (name === "goto") gotoMessage(action.dataset.target);
    else if (name === "menu") openMessageMenu(action.closest("[data-id]")?.dataset.id);
  });
  wireMessageGestures();

  el.attachBtn.addEventListener("click", openAttachMenu);
  for (const id of ["#file-media", "#file-camera", "#file-doc"]) $(id).addEventListener("change", (e) => chooseFiles(e.target));
  el.micBtn.addEventListener("click", startRecording);
  $("#rec-cancel").addEventListener("click", () => stopRecording(false));
  $("#rec-send").addEventListener("click", () => stopRecording(true));
  $("#reply-cancel").addEventListener("click", () => {
    state.line.replyTo = null;
    renderComposer();
  });
  $("#viewer-close").addEventListener("click", () => closeViewer());
  el.viewer.addEventListener("click", (event) => {
    if (event.target === el.viewer || event.target === el.viewerImg) closeViewer();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeViewer();
  });

  el.composer.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage();
  });
  el.input.addEventListener("input", () => {
    autosize();
    renderComposer();
  });
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
  $("#btn-forget").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Déconnecter ce téléphone ?",
      message: "L'accès est effacé de cet appareil (et le code de verrouillage avec). Les lignes WhatsApp, elles, restent reliées.",
      confirmLabel: "Déconnecter",
      danger: true,
    });
    if (ok) forgetToken();
  });

  // Sécurité
  const safely = (fn) => () => Promise.resolve(fn()).catch(toastError);
  $("#btn-lock-toggle").addEventListener("click", safely(toggleLock));
  $("#btn-lock-change").addEventListener("click", safely(changePin));
  $("#btn-lock-now").addEventListener("click", () => lockNow());
  $("#btn-lock-top").addEventListener("click", () => lockNow());
  $("#btn-rotate").addEventListener("click", safely(rotateToken));
  $("#lock-delay").addEventListener("change", (e) => {
    settings.lockDelay = Number(e.target.value);
    saveSettings(settings);
  });
  $("#keypad").addEventListener("click", (e) => {
    const key = e.target.closest("[data-key]")?.dataset.key;
    if (key) pressLockKey(key);
  });
  document.addEventListener("keydown", (e) => {
    if (!lockState) return;
    if (/^\d$/.test(e.key)) pressLockKey(e.key);
    else if (e.key === "Backspace") pressLockKey("back");
  });
  $("#lock-forgot").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Code oublié ?",
      message: "Pour ta sécurité, l'accès sera effacé de ce téléphone. Tu pourras te reconnecter tout de suite : dans Termux, tape « lignes ». Tes lignes WhatsApp restent reliées.",
      confirmLabel: "Effacer et me reconnecter",
      danger: true,
    });
    if (!ok || !lockState) return;
    endLock(null);
    forgetToken();
    showView("settings");
  });

  // Notifications
  $("#btn-notif-toggle").addEventListener("click", safely(toggleNotifications));
  $("#btn-native-toggle").addEventListener("click", safely(toggleNativeNotifications));
  $("#btn-native-check").addEventListener("click", safely(checkNativeNotifications));
  $("#btn-notif-test").addEventListener("click", safely(testNotifications));
  $("#notif-preview").addEventListener("change", safely(async (e) => {
    settings.notifyPreview = e.target.checked;
    saveSettings(settings);
    if (state.native?.termux) state.native = await api.notificationsUpdate({ preview: e.target.checked });
    if (await currentSubscription()) await enablePush(api, { preview: settings.notifyPreview });
  }));
  // Notification touchée alors que l'application est déjà ouverte dans Chrome.
  window.addEventListener("hashchange", () => {
    const link = takeLinkFromUrl();
    if (link.open) openFromNotification(link.open).catch(() => {});
    else if (link.code && !lockState) {
      // Nouveau lien « lignes » ouvert dans l'onglet déjà ouvert.
      api
        .exchangeLoginCode(link.code)
        .then(setToken)
        .then(() => connect())
        .then(() => toast("Téléphone connecté ✓"))
        .catch(toastError);
    }
  });
  navigator.serviceWorker?.addEventListener("message", (event) => {
    if (event.data?.type === "open-chat") openFromNotification(event.data).catch(() => {});
  });
  $("#btn-toggle-token").addEventListener("click", () => {
    const input = el.settingsForm.elements.token;
    input.type = input.type === "password" ? "text" : "password";
  });

  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      // « Dès que je quitte » : verrouillé avant même l'aperçu des applis récentes.
      if (hasVault() && settings.lockDelay === 0) lockNow();
      return;
    }
    if (hasVault() && !lockState && Date.now() - hiddenAt >= settings.lockDelay) lockNow();
    state.realtime?.ensureConnected();
    if (state.line.openChatId) markRead(state.line.openChatId);
  });

  // Compte à rebours des reconnexions dans la vue « Lignes ».
  setInterval(() => {
    if (state.view === "lines" && sortedSessions().some((s) => s.status === "reconnecting")) renderLinesView();
  }, 1000);
}

function setupInstall() {
  let deferred = null;
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const button = $("#btn-install");
  const showBanner = () => {
    el.installBanner.hidden = !(deferred && !standalone && !settings.installDismissed);
  };
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event;
    button.hidden = false;
    $("#install-help").hidden = true;
    showBanner();
  });
  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => null);
    deferred = null;
    button.hidden = true;
    el.installBanner.hidden = true;
  };
  button.addEventListener("click", install);
  $("#install-banner-btn").addEventListener("click", install);
  $("#install-banner-close").addEventListener("click", () => {
    settings.installDismissed = true;
    saveSettings(settings);
    el.installBanner.hidden = true;
  });
  window.addEventListener("appinstalled", () => {
    el.installBanner.hidden = true;
    toast("Multi-Lignes est installée sur ton écran d'accueil ✓");
  });
  if (standalone) $("#install-help").textContent = "L'application est installée sur cet appareil ✓";
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

/**
 * Lien de connexion affiché par le serveur (…/#token=XXXX) : le jeton est
 * enregistré sur l'appareil puis retiré de la barre d'adresse.
 */
/**
 * Liens spéciaux : …/#login=CODE (connexion à usage unique), …/#token=JETON
 * (ancien format), …/#open=LIGNE|DISCUSSION (clic sur une notification).
 * Ils sont retirés de la barre d'adresse aussitôt lus.
 */
function takeLinkFromUrl() {
  const hash = location.hash;
  const out = {};
  let m;
  if ((m = /^#login=([A-Za-z0-9_-]{10,64})$/.exec(hash))) out.code = m[1];
  else if ((m = /^#token=([^&]+)$/.exec(hash))) out.token = decodeURIComponent(m[1]);
  else if ((m = /^#open=([^|]*)\|(.*)$/.exec(hash))) out.open = { sessionId: decodeURIComponent(m[1]), chatId: decodeURIComponent(m[2]) };
  else if (["#lines", "#settings", "#messages"].includes(hash)) out.view = hash.slice(1);
  if (out.code || out.token || out.open) history.replaceState(null, "", location.pathname + location.search);
  if ((out.code || out.token) && !isNative()) {
    settings.serverUrl = "";
    saveSettings(settings);
  }
  return out;
}

// --- Verrouillage -----------------------------------------------------------------

let lockState = null;

function renderPin(message) {
  if (!lockState) return;
  const len = pinLength();
  el.pinDots.innerHTML = Array.from({ length: len }, (_, i) => `<span class="${i < lockState.pin.length ? "is-on" : ""}"></span>`).join("");
  if (message) el.lockMsg.textContent = message;
}

/** Affiche l'écran de verrouillage ; résout avec le jeton (ou null si le jeton a été effacé). */
function showLock() {
  if (lockState) return lockState.promise;
  forgetKey();
  closeViewer();
  document.body.classList.add("locked");
  el.lock.hidden = false;
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  lockState = { resolve, promise, pin: "", busy: false };
  renderPin("Entre ton code pour ouvrir l'application");
  return promise;
}

function endLock(token) {
  document.body.classList.remove("locked");
  el.lock.hidden = true;
  const { resolve } = lockState;
  lockState = null;
  resolve(token);
}

async function pressLockKey(key) {
  if (!lockState || lockState.busy) return;
  const wait = lockoutRemaining();
  if (wait) return renderPin(`Trop d'essais : patiente ${Math.ceil(wait / 1000)} s`);
  if (key === "back") lockState.pin = lockState.pin.slice(0, -1);
  else if (/^\d$/.test(key) && lockState.pin.length < pinLength()) lockState.pin += key;
  renderPin();
  if (lockState.pin.length < pinLength()) return;
  lockState.busy = true;
  renderPin("Vérification…");
  const result = await openVault(lockState.pin);
  lockState.busy = false;
  lockState.pin = "";
  if (result.token) {
    memory.token = result.token;
    navigator.vibrate?.(20);
    return endLock(result.token);
  }
  if (result.wiped) {
    endLock(null);
    forgetToken();
    showView("settings");
    return setSettingsStatus("10 codes faux : par sécurité, l'accès a été effacé de cet appareil. Dans Termux, tape « lignes » pour te reconnecter.", "error");
  }
  navigator.vibrate?.([60, 40, 60]);
  el.pinDots.classList.remove("shake");
  void el.pinDots.offsetWidth;
  el.pinDots.classList.add("shake");
  renderPin(`Code incorrect — encore ${result.left} essai${result.left > 1 ? "s" : ""}`);
}

async function lockNow() {
  if (!hasVault() || lockState) return;
  await showLock();
}

async function askNewPin() {
  const first = await promptDialog({
    title: "Choisis ton code",
    message: "4 à 8 chiffres. Il sera demandé à chaque ouverture de l'application.",
    label: "Nouveau code",
    type: "password",
    inputMode: "numeric",
    pattern: "[0-9]{4,8}",
    confirmLabel: "Continuer",
  });
  if (!first) return null;
  if (!/^\d{4,8}$/.test(first)) {
    toast("Le code doit contenir 4 à 8 chiffres.", { type: "error" });
    return null;
  }
  const again = await promptDialog({ title: "Confirme ton code", label: "Retape le code", type: "password", inputMode: "numeric", pattern: "[0-9]{4,8}", confirmLabel: "Activer" });
  if (again !== first) {
    if (again !== null) toast("Les deux codes ne correspondent pas.", { type: "error" });
    return null;
  }
  return first;
}

async function checkCurrentPin(title) {
  const pin = await promptDialog({ title, label: "Code actuel", type: "password", inputMode: "numeric", confirmLabel: "Valider" });
  if (!pin) return null;
  const result = await openVault(pin);
  if (result.token) return result.token;
  if (result.wiped) forgetToken();
  toast(result.wiped ? "Trop de codes faux : accès effacé de cet appareil." : `Code incorrect (encore ${result.left} essais).`, { type: "error" });
  return null;
}

async function toggleLock() {
  if (hasVault()) {
    const token = await checkCurrentPin("Désactiver le verrouillage");
    if (!token) return;
    clearVault();
    await setToken(token);
    toast("Verrouillage désactivé.");
  } else {
    if (!memory.token) return toast("Connecte d'abord l'application à ton serveur.", { type: "error" });
    const pin = await askNewPin();
    if (!pin) return;
    await sealToken(pin, memory.token);
    settings.token = "";
    saveSettings(settings);
    toast("Code activé 🔒 Ton accès est maintenant chiffré sur ce téléphone.");
  }
  renderSecurity();
}

async function changePin() {
  const token = await checkCurrentPin("Changer le code");
  if (!token) return;
  const pin = await askNewPin();
  if (!pin) return;
  await sealToken(pin, token);
  toast("Nouveau code enregistré 🔒");
}

async function rotateToken() {
  const ok = await confirmDialog({
    title: "Déconnecter les autres appareils ?",
    message: "Un nouveau jeton d'accès est créé. Ce téléphone reste connecté ; tout autre appareil devra se reconnecter avec un nouveau lien (« lignes » dans Termux).",
    confirmLabel: "Changer le jeton",
    danger: true,
  });
  if (!ok) return;
  const token = await api.rotateToken();
  await setToken(token);
  await connect({ keepView: true });
  toast("Jeton changé ✓ Les autres appareils sont déconnectés.");
}

function renderSecurity() {
  const on = hasVault();
  const toggle = $("#btn-lock-toggle");
  toggle.textContent = on ? "Désactiver" : "Activer";
  toggle.disabled = !lockSupported();
  $("#lock-state").textContent = !lockSupported()
    ? "Indisponible ici (il faut HTTPS ou localhost)."
    : on
      ? "Activé : ton accès est chiffré sur ce téléphone et l'application se verrouille toute seule."
      : "Désactivé : n'importe qui tenant ton téléphone déverrouillé peut ouvrir l'application.";
  $("#lock-options").hidden = !on;
  $("#btn-lock-top").hidden = !on;
  $("#lock-delay").value = String(settings.lockDelay);
  const tokenField = el.settingsForm.elements.token;
  tokenField.placeholder = on ? "Protégé par ton code de verrouillage" : "Ou ouvre le lien affiché dans Termux";
  if (on) tokenField.value = "";
}

// --- Notifications ------------------------------------------------------------------

async function renderNotifications() {
  await renderNativeNotifications();
  await renderWebNotifications();
}

/** Notifications Android natives (serveur dans Termux, application Termux:API). */
async function renderNativeNotifications() {
  if (memory.token) {
    try {
      state.native = await api.notificationsStatus();
    } catch {
      // serveur injoignable : on garde le dernier état connu
    }
  }
  const status = state.native;
  const inTermux = Boolean(status?.termux);
  $("#notif-native").hidden = !inTermux;
  // Hors Termux (ordinateur, serveur en ligne) : seule la méthode Chrome existe.
  $("#notif-web").open = !inTermux;
  $("#notif-web-hint").textContent = inTermux ? "(autre méthode, inutile si celles du téléphone marchent)" : "";
  if (!inTermux) {
    $("#notif-preview").checked = settings.notifyPreview !== false;
    return;
  }
  const ready = status.installed && status.working !== false;
  const toggle = $("#btn-native-toggle");
  toggle.hidden = !ready;
  toggle.textContent = status.enabled ? "Désactiver" : "Activer";
  $("#native-help").hidden = ready;
  $("#btn-native-check").hidden = ready;
  $("#notif-preview").checked = status.preview;
  $("#native-state").textContent = !status.installed
    ? "Il manque l'outil « termux-api » : suis les étapes ci-dessous."
    : status.working === false
      ? "L'application Termux:API ne répond pas : suis les étapes ci-dessous."
      : !status.enabled
        ? "Désactivées."
        : "✅ Actives : chaque nouveau message s'affiche en notification, même application fermée. Réponds directement depuis la notification.";
}

/** Notifications par Chrome (Web Push) : méthode de secours, ou seule méthode hors Termux. */
async function renderWebNotifications() {
  const button = $("#btn-notif-toggle");
  const stateText = $("#notif-state");
  if (!pushSupported()) {
    button.disabled = true;
    stateText.textContent = "Indisponible ici (il faut Chrome, et HTTPS ou localhost).";
    return;
  }
  const sub = await currentSubscription().catch(() => null);
  const on = Boolean(sub) && Notification.permission === "granted";
  button.textContent = on ? "Désactiver" : "Activer";
  stateText.textContent = on
    ? "Activées sur ce téléphone."
    : Notification.permission === "denied"
      ? "Bloquées par Chrome : ⋮ → Paramètres → Paramètres des sites → Notifications → autoriser localhost."
      : "Notification par Chrome pour chaque nouveau message.";
}

async function toggleNativeNotifications() {
  state.native = await api.notificationsUpdate({ enabled: !state.native?.enabled });
  await renderNotifications();
  toast(state.native.enabled ? (state.native.working === false ? "Activées, mais Termux:API ne répond pas encore." : "Notifications du téléphone activées 🔔") : "Notifications du téléphone désactivées.");
}

async function checkNativeNotifications() {
  state.native = await api.notificationsCheck();
  await renderNotifications();
  toast(state.native.working ? "Notifications du téléphone prêtes ✅ Envoie-toi un test." : "Termux:API ne répond toujours pas : vérifie les étapes.", {
    type: state.native.working ? "info" : "error",
    duration: 6000,
  });
}

async function testNotifications() {
  const pending = toast("Envoi du test…", { duration: 0 });
  const result = await api.notificationsTest().finally(() => pending.remove());
  if (result.status) state.native = result.status;
  await renderNotifications();
  if (result.via === "android") toast("Notification envoyée ✓ Regarde en haut de ton écran.");
  else if (result.delivered) toast("Notification Chrome envoyée ✓");
  else toast("Aucune notification n'a pu partir : suis les étapes ci-dessus.", { type: "error", duration: 7000 });
}

async function toggleNotifications() {
  const sub = await currentSubscription().catch(() => null);
  if (sub) {
    await disablePush(api);
    toast("Notifications désactivées sur ce téléphone.");
  } else {
    await enablePush(api, { preview: settings.notifyPreview !== false });
    toast("Notifications activées 🔔");
  }
  await renderNotifications();
}

async function openFromNotification({ sessionId, chatId }) {
  if (lockState) await lockState.promise;
  if (!state.sessions.has(sessionId)) return;
  showView("messages");
  await selectLine(sessionId);
  if (chatId) await openChat(chatId);
}

/** Après la première connexion : proposer (une seule fois) les notifications. */
function suggestNotifications() {
  if (settings.notifSuggested) return;
  const native = state.native;
  if (native?.termux && native.installed && native.working && native.enabled) return; // déjà en place
  settings.notifSuggested = true;
  saveSettings(settings);
  if (native?.termux) {
    toast("Pour recevoir les messages en notification, il reste une étape (Termux:API).", {
      duration: 12000,
      action: { label: "Voir", onClick: () => showView("settings") },
    });
    return;
  }
  if (!pushSupported() || Notification.permission !== "default") return;
  toast("Être prévenu des nouveaux messages, même application fermée ?", {
    duration: 12000,
    action: { label: "Activer", onClick: () => toggleNotifications().catch(toastError) },
  });
}

async function boot() {
  const link = takeLinkFromUrl();
  wireEvents();
  setupInstall();
  registerServiceWorker();
  el.settingsForm.elements.serverUrl.value = settings.serverUrl || (isNative() ? "" : window.location.origin);
  el.settingsForm.elements.token.value = hasVault() ? "" : memory.token;
  if (isNative()) $("#server-url-hint").textContent = "Adresse publique de ton serveur (HTTPS conseillé), ex. https://lignes.mondomaine.fr";
  setConn("offline");
  renderLineContext();
  renderChats();
  renderSecurity();
  renderNotifications();

  // 1. Code de verrouillage
  if (hasVault() && !(await showLock())) return;

  // 2. Lien de connexion à usage unique
  if (link.code) {
    try {
      await setToken(await api.exchangeLoginCode(link.code));
      toast("Téléphone connecté ✓");
    } catch (err) {
      if (!memory.token) {
        showView("settings");
        return setSettingsStatus(err.message, "error");
      }
      toast(err.message, { type: "error", duration: 7000 });
    }
  } else if (link.token) {
    await setToken(link.token);
  }

  if (!memory.token || !serverBase(settings)) {
    showView("settings");
    return setSettingsStatus("Pour connecter ce téléphone : ouvre Termux et tape « lignes ». Le lien de connexion s'ouvrira tout seul.");
  }
  showView(link.view ?? "messages");
  await connect();
  if (link.open) await openFromNotification(link.open);
  setTimeout(suggestNotifications, 2500);
}

boot().catch((err) => {
  console.error(err);
  toast("Démarrage impossible : recharge la page.", { type: "error", duration: 0, action: { label: "Recharger", onClick: () => location.reload() } });
});
