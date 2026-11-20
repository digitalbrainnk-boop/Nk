// Vue « Messages » : discussions et conversation de la ligne ACTIVE uniquement.
import { STATUS_LABELS, avatarColor, esc, formatClock, formatDay, formatListTime, formatPhone, initials } from "../ui.js";

const TYPE_LABELS = {
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

const TICKS = {
  pending: '<span class="tick" title="En attente">🕓</span>',
  sent: '<span class="tick" title="Envoyé">✓</span>',
  delivered: '<span class="tick" title="Distribué">✓✓</span>',
  read: '<span class="tick tick-read" title="Lu">✓✓</span>',
  error: '<span class="tick tick-error" title="Échec">⚠</span>',
};

export const chatTitle = (chat) => chat?.name || formatPhone(chat?.phone) || chat?.id?.split("@")[0] || "Discussion";

export function renderBanner(root, session) {
  if (!session) {
    root.innerHTML = "";
    root.hidden = true;
    return;
  }
  root.hidden = false;
  root.style.setProperty("--line", session.color);
  const who = [formatPhone(session.phone), session.name].filter(Boolean).join(" · ");
  const ok = session.status === "open";
  root.innerHTML = `<span class="line-swatch" aria-hidden="true"></span>
    <div class="line-banner-text">
      <strong>${esc(session.label)}</strong>
      <small>${esc(who || "Aucun numéro relié")}</small>
    </div>
    <span class="status-badge" data-status="${esc(session.status)}">${esc(STATUS_LABELS[session.status] ?? session.status)}</span>
    ${ok ? "" : '<button type="button" class="btn btn-line btn-small" data-action="manage-line">Gérer</button>'}`;
}

export function renderChatList(root, { chats, loading, filter, openChatId, session }) {
  if (!session) {
    root.innerHTML = `<li class="empty-state"><h3>Aucune ligne</h3><p>Ajoute une ligne dans l'onglet « Lignes ».</p></li>`;
    return;
  }
  if (loading) {
    root.innerHTML = `<li class="empty-state"><p>Chargement des discussions…</p></li>`;
    return;
  }
  const q = filter.trim().toLowerCase();
  const list = q
    ? chats.filter((c) => [c.name, c.phone, c.lastMessage?.preview].some((v) => String(v ?? "").toLowerCase().includes(q)))
    : chats;
  if (!list.length) {
    root.innerHTML = `<li class="empty-state"><p>${q ? "Aucune discussion ne correspond." : "Aucune discussion sur cette ligne pour l'instant. Les nouveaux messages apparaîtront ici en direct."}</p></li>`;
    return;
  }
  root.innerHTML = list
    .map((chat) => {
      const title = chatTitle(chat);
      const last = chat.lastMessage;
      const tick = last?.fromMe ? (TICKS[last.status] ?? "") : "";
      return `<li><button type="button" class="chat-item ${chat.id === openChatId ? "is-open" : ""}" data-chat="${esc(chat.id)}">
        <span class="avatar" style="background:${avatarColor(chat.id)}">${esc(chat.isGroup ? "👥" : initials(title))}</span>
        <span class="chat-main">
          <span class="chat-top"><span class="chat-name">${esc(title)}</span><time>${esc(formatListTime(chat.lastMessageAt))}</time></span>
          <span class="chat-bottom"><span class="chat-preview">${tick}${esc(last?.preview ?? "")}</span>${chat.unread ? `<span class="unread">${chat.unread}</span>` : ""}</span>
        </span>
      </button></li>`;
    })
    .join("");
}

function messageBody(m) {
  if (m.deleted) return '<span class="msg-deleted">🚫 Message supprimé</span>';
  const label = TYPE_LABELS[m.type];
  const text = m.text ? `<span class="msg-text">${esc(m.text)}</span>` : "";
  return `${label ? `<span class="msg-media">${esc(label)}</span>` : ""}${text}`;
}

export function renderMessages(root, { messages, hasMore, loading, chat }) {
  const parts = [];
  if (hasMore) parts.push('<div class="load-more"><button type="button" class="btn btn-ghost btn-small" data-action="load-more">Messages précédents</button></div>');
  if (loading && !messages.length) parts.push('<p class="messages-empty">Chargement…</p>');
  if (!loading && !messages.length) parts.push('<p class="messages-empty">Aucun message. Écris le premier ci-dessous.</p>');
  let lastDay = "";
  for (const m of messages) {
    const day = formatDay(m.timestamp);
    if (day !== lastDay) {
      parts.push(`<div class="day-sep"><span>${esc(day)}</span></div>`);
      lastDay = day;
    }
    const author = chat?.isGroup && !m.fromMe && m.authorName ? `<span class="msg-author">${esc(m.authorName)}</span>` : "";
    parts.push(`<div class="msg ${m.fromMe ? "out" : "in"}" data-id="${esc(m.id)}">
      <div class="bubble">${author}${messageBody(m)}
        <span class="msg-meta">${m.edited ? "modifié · " : ""}${esc(formatClock(m.timestamp))}${m.fromMe ? (TICKS[m.status] ?? "") : ""}</span>
      </div>
    </div>`);
  }
  root.innerHTML = parts.join("");
}
