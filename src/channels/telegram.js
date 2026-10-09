// Telegram : un bot (créé avec @BotFather) reçoit les messages par
// "long polling" — pas besoin d'adresse publique.
import { getSettings } from "../db.js";
import { downloadToMedia } from "../media.js";
import { handleIncoming, registerAdapter } from "../router.js";
import { emit } from "../events.js";

let running = false;
let token = null;
let offset = 0;
let state = { status: "déconnecté", bot: null, error: null };

async function api(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || `Telegram ${method} a échoué`);
  return data.result;
}

async function fileToMedia(fileId) {
  const f = await api("getFile", { file_id: fileId });
  return downloadToMedia(`https://api.telegram.org/file/bot${token}/${f.file_path}`);
}

async function onMessage(msg) {
  if (!msg || msg.chat.type !== "private") return;
  const s = getSettings();
  const chatId = String(msg.chat.id);
  // Le propriétaire qui écrit à son propre bot ne doit pas recevoir de réponse IA.
  if (s.owner_telegram_chat_id && chatId === String(s.owner_telegram_chat_id)) return;
  const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || msg.from?.username;
  const base = {
    channel: "telegram",
    externalId: chatId,
    name,
    externalMsgId: String(msg.message_id),
    createdAt: msg.date * 1000,
    meta: { username: msg.from?.username },
  };
  if (msg.voice || msg.audio) {
    const media = await fileToMedia((msg.voice || msg.audio).file_id);
    media.mime = (msg.voice || msg.audio).mime_type || media.mime;
    return handleIncoming({ ...base, kind: "audio", media });
  }
  if (msg.photo?.length) {
    const media = await fileToMedia(msg.photo[msg.photo.length - 1].file_id);
    if (media.mime === "application/octet-stream") media.mime = "image/jpeg";
    return handleIncoming({ ...base, kind: "image", text: msg.caption || "", media });
  }
  if (msg.text) return handleIncoming({ ...base, text: msg.text });
  return handleIncoming({ ...base, kind: "other", text: msg.caption || "" });
}

async function loop() {
  while (running) {
    try {
      const updates = await api("getUpdates", { offset, timeout: 30, allowed_updates: ["message"] });
      for (const u of updates) {
        offset = u.update_id + 1;
        await onMessage(u.message).catch((e) => console.error("Telegram message :", e));
      }
    } catch (e) {
      state = { ...state, status: "erreur", error: e.message };
      emit("channel", { channel: "telegram" });
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

export async function startTelegram() {
  stopTelegram();
  token = getSettings().telegram_token || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    state = { status: "non configuré", bot: null, error: null };
    return;
  }
  try {
    const me = await api("getMe");
    await api("deleteWebhook", {}); // le polling ne marche pas si un webhook est actif
    state = { status: "connecté", bot: `@${me.username}`, error: null };
    running = true;
    loop();
  } catch (e) {
    state = { status: "erreur", bot: null, error: e.message };
  }
  emit("channel", { channel: "telegram" });
}

export function stopTelegram() {
  running = false;
}

export function telegramStatus() {
  return state;
}

registerAdapter({
  channel: "telegram",
  async send(contact, text) {
    const r = await api("sendMessage", { chat_id: contact.external_id, text });
    return String(r.message_id);
  },
  async typing(contact, ms = 4000) {
    // L'indicateur "écrit..." de Telegram dure 5 s : on le renouvelle.
    const until = Date.now() + ms;
    const tick = () =>
      api("sendChatAction", { chat_id: contact.external_id, action: "typing" }).catch(() => {});
    await tick();
    const t = setInterval(() => (Date.now() < until - 1000 ? tick() : clearInterval(t)), 4500);
  },
  async notify(chatId, text) {
    await api("sendMessage", { chat_id: chatId, text });
  },
});
