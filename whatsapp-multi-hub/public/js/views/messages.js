// Vue « Messages » : discussions et conversation de la ligne ACTIVE uniquement.
import { STATUS_LABELS, avatarColor, esc, formatBytes, formatClock, formatDay, formatDuration, formatListTime, formatPhone, initials } from "../ui.js";

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

/** Texte avec liens cliquables (http/https uniquement), tout le reste échappé. */
function linkify(text) {
  const parts = String(text).split(/(\bhttps?:\/\/[^\s<]+)/g);
  return parts
    .map((part, i) => (i % 2 ? `<a href="${esc(part)}" target="_blank" rel="noopener noreferrer">${esc(part)}</a>` : esc(part)))
    .join("");
}

function mediaBlock(m, mediaUrl) {
  const media = m.media ?? {};
  const src = mediaUrl(media.url);
  const label = TYPE_LABELS[m.type] ?? "Fichier";
  if (!src) return `<span class="msg-media">${esc(label)}</span>`;
  const ratio = media.width && media.height ? `aspect-ratio:${media.width}/${media.height};` : "";
  const thumb = media.thumb ? `background-image:url('${esc(media.thumb)}');` : "";
  switch (m.type) {
    case "image":
      return `<button type="button" class="media-img" data-action="view" data-src="${esc(src)}" style="${ratio}${thumb}" aria-label="Agrandir la photo">
        <img src="${esc(src)}" alt="Photo" loading="lazy" decoding="async"></button>`;
    case "sticker":
      return `<img class="media-sticker" src="${esc(src)}" alt="Autocollant" loading="lazy">`;
    case "video":
    case "gif":
      return `<video class="media-video" src="${esc(src)}" style="${ratio}" ${media.thumb ? `poster="${esc(media.thumb)}"` : ""} controls playsinline preload="none" ${m.type === "gif" ? "loop muted" : ""}></video>`;
    case "voice":
    case "audio":
      return `<div class="media-audio"><span class="media-audio-icon" aria-hidden="true">${m.type === "voice" ? "🎤" : "🎵"}</span>
        <audio src="${esc(src)}" controls preload="none"></audio>
        ${media.seconds ? `<small>${esc(formatDuration(media.seconds))}</small>` : ""}</div>`;
    default: {
      const ext = (media.fileName?.split(".").pop() || media.mimetype?.split("/").pop() || "").toUpperCase().slice(0, 5);
      return `<a class="media-doc" href="${esc(src)}" target="_blank" rel="noopener" download="${esc(media.fileName || "fichier")}">
        <span class="media-doc-icon" aria-hidden="true">📄</span>
        <span class="media-doc-info"><strong>${esc(media.fileName || "Document")}</strong><small>${esc([ext, formatBytes(media.size)].filter(Boolean).join(" · "))}</small></span>
        <span class="media-doc-dl" aria-hidden="true">⬇</span></a>`;
    }
  }
}

function messageBody(m, mediaUrl) {
  if (m.deleted) return '<span class="msg-deleted">🚫 Message supprimé</span>';
  const parts = [];
  if (m.media) parts.push(mediaBlock(m, mediaUrl));
  else if (m.type === "location" && m.location) {
    parts.push(`<a class="media-loc" href="https://www.google.com/maps?q=${encodeURIComponent(`${m.location.lat},${m.location.lng}`)}" target="_blank" rel="noopener noreferrer">📍 Voir la position</a>`);
  } else if (TYPE_LABELS[m.type] && m.type !== "image") parts.push(`<span class="msg-media">${esc(TYPE_LABELS[m.type])}</span>`);
  if (m.text) parts.push(`<span class="msg-text">${linkify(m.text)}</span>`);
  return parts.join("");
}

function quoteBlock(m, chat) {
  if (!m.quoted || m.deleted) return "";
  const who = m.quoted.fromMe ? "Vous" : chat?.isGroup ? formatPhone(m.quoted.author?.split("@")[0]) || "Participant" : chatTitle(chat);
  return `<button type="button" class="quote" data-action="goto" data-target="${esc(m.quoted.id)}">
    <strong>${esc(who)}</strong><span>${esc(m.quoted.text || "Message")}</span></button>`;
}

function reactionsBlock(m) {
  const list = Object.entries(m.reactions ?? {});
  if (!list.length) return "";
  const counts = new Map();
  for (const [, emoji] of list) counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
  const mine = m.reactions?.me;
  return `<div class="reactions">${[...counts]
    .map(([emoji, n]) => `<span class="${emoji === mine ? "is-mine" : ""}">${esc(emoji)}${n > 1 ? ` ${n}` : ""}</span>`)
    .join("")}</div>`;
}

export function renderMessages(root, { messages, hasMore, loading, chat, pending = [], mediaUrl = (u) => u }) {
  const parts = [];
  if (hasMore) parts.push('<div class="load-more"><button type="button" class="btn btn-ghost btn-small" data-action="load-more">Messages précédents</button></div>');
  if (loading && !messages.length) parts.push('<p class="messages-empty">Chargement…</p>');
  if (!loading && !messages.length && !pending.length) parts.push('<p class="messages-empty">Aucun message. Écris le premier ci-dessous.</p>');
  let lastDay = "";
  for (const m of messages) {
    const day = formatDay(m.timestamp);
    if (day !== lastDay) {
      parts.push(`<div class="day-sep"><span>${esc(day)}</span></div>`);
      lastDay = day;
    }
    const author = chat?.isGroup && !m.fromMe && m.authorName ? `<span class="msg-author">${esc(m.authorName)}</span>` : "";
    const isMedia = m.media && !m.deleted && ["image", "video", "gif", "sticker"].includes(m.type);
    parts.push(`<div class="msg ${m.fromMe ? "out" : "in"} ${m.reactions ? "has-reactions" : ""}" data-id="${esc(m.id)}">
      <div class="bubble ${isMedia ? "bubble-media" : ""} ${m.type === "sticker" ? "bubble-sticker" : ""}">
        <button type="button" class="msg-menu" data-action="menu" aria-label="Actions sur le message">⌄</button>
        ${author}${quoteBlock(m, chat)}${messageBody(m, mediaUrl)}
        <span class="msg-meta">${m.edited ? "modifié · " : ""}${esc(formatClock(m.timestamp))}${m.fromMe ? (TICKS[m.status] ?? "") : ""}</span>
      </div>
      ${reactionsBlock(m)}
    </div>`);
  }
  for (const p of pending) {
    const pct = Math.round((p.progress ?? 0) * 100);
    parts.push(`<div class="msg out pending" data-pending="${esc(p.tempId)}">
      <div class="bubble"><span class="msg-media">${esc(p.voice ? "🎤 Message vocal" : `📤 ${p.name}`)}</span>
        <span class="progress" aria-hidden="true"><span style="width:${pct}%"></span></span>
        <span class="msg-meta">Envoi… ${pct} %</span></div>
    </div>`);
  }
  root.innerHTML = parts.join("");
}
