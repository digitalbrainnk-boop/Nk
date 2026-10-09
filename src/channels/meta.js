// Meta : Messenger (page Facebook), Instagram (messages privés), commentaires
// de la page Facebook et WhatsApp Business Cloud API. Tout arrive par un seul
// webhook : /webhooks/meta
import crypto from "node:crypto";
import express from "express";
import { getSettings } from "../db.js";
import { downloadToMedia } from "../media.js";
import { handleIncoming, handleOwnerMessage, registerAdapter } from "../router.js";

const GRAPH = `https://graph.facebook.com/${process.env.GRAPH_VERSION || "v23.0"}`;
let pageId = null;
let stats = { last_event: null, error: null };

function cfg() {
  const s = getSettings();
  return {
    pageToken: s.facebook_page_token || process.env.FACEBOOK_PAGE_TOKEN,
    appSecret: s.facebook_app_secret || process.env.FACEBOOK_APP_SECRET,
    verifyToken: s.facebook_verify_token || process.env.FACEBOOK_VERIFY_TOKEN,
    waToken: s.wa_cloud_token || process.env.WA_CLOUD_TOKEN,
    waPhoneId: s.wa_cloud_phone_number_id || process.env.WA_CLOUD_PHONE_NUMBER_ID,
    replyComments: s.facebook_reply_comments,
  };
}

async function graph(pathname, { method = "GET", token, body } = {}) {
  const res = await fetch(`${GRAPH}/${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error?.message || `Graph API ${res.status}`);
  return data;
}

async function getPageId() {
  if (pageId) return pageId;
  const { pageToken } = cfg();
  if (!pageToken) return null;
  pageId = (await graph("me?fields=id,name", { token: pageToken })).id;
  return pageId;
}

const names = new Map();
async function profileName(psid) {
  if (names.has(psid)) return names.get(psid);
  try {
    const p = await graph(`${psid}?fields=name,first_name,last_name,username`, { token: cfg().pageToken });
    const n = p.name || [p.first_name, p.last_name].filter(Boolean).join(" ") || p.username;
    names.set(psid, n);
    return n;
  } catch {
    return undefined;
  }
}

// ---------- Messenger / Instagram ----------
async function onMessaging(channel, ev) {
  const m = ev.message;
  if (!m) return;
  if (m.is_echo) {
    // Message envoyé depuis la page (par toi) -> prise de main.
    if (m.app_id && String(m.app_id) === String(process.env.FACEBOOK_APP_ID)) return;
    return handleOwnerMessage({ channel, externalId: ev.recipient.id, text: m.text || "", externalMsgId: m.mid });
  }
  const psid = ev.sender.id;
  const base = { channel, externalId: psid, name: await profileName(psid), externalMsgId: m.mid, createdAt: ev.timestamp };
  const att = m.attachments?.[0];
  if (att?.type === "audio" && att.payload?.url) {
    return handleIncoming({ ...base, kind: "audio", media: await downloadToMedia(att.payload.url) });
  }
  if (att?.type === "image" && att.payload?.url) {
    return handleIncoming({ ...base, kind: "image", text: m.text || "", media: await downloadToMedia(att.payload.url) });
  }
  if (m.text) return handleIncoming({ ...base, text: m.text });
  if (att) return handleIncoming({ ...base, kind: "other" });
}

// ---------- Commentaires de la page ----------
async function onFeedChange(value) {
  if (value.item !== "comment" || value.verb !== "add") return;
  if (!cfg().replyComments) return;
  const myId = await getPageId();
  if (value.from?.id && value.from.id === myId) return; // nos propres commentaires
  await handleIncoming({
    channel: "facebook_comment",
    externalId: value.comment_id,
    name: value.from?.name,
    kind: "comment",
    text: value.message || "",
    externalMsgId: value.comment_id,
    createdAt: (value.created_time || Date.now() / 1000) * 1000,
    meta: { post_id: value.post_id, author_id: value.from?.id },
  });
}

// ---------- WhatsApp Business Cloud API ----------
async function onWhatsAppCloud(value) {
  const contactsInfo = Object.fromEntries((value.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
  for (const m of value.messages || []) {
    const base = {
      channel: "whatsapp_cloud",
      externalId: m.from,
      name: contactsInfo[m.from],
      externalMsgId: m.id,
      createdAt: Number(m.timestamp) * 1000,
      meta: { phone: m.from },
    };
    const mediaObj = m.audio || m.voice || m.image;
    if (mediaObj?.id) {
      const { waToken } = cfg();
      const info = await graph(mediaObj.id, { token: waToken });
      const media = await downloadToMedia(info.url, { Authorization: `Bearer ${waToken}` });
      media.mime = (info.mime_type || media.mime).split(";")[0];
      await handleIncoming({ ...base, kind: m.image ? "image" : "audio", text: m.image?.caption || "", media });
    } else if (m.text?.body) {
      await handleIncoming({ ...base, text: m.text.body });
    } else {
      await handleIncoming({ ...base, kind: "other" });
    }
  }
}

// ---------- Webhook ----------
export const metaRouter = express.Router();

metaRouter.get("/webhooks/meta", (req, res) => {
  const { verifyToken } = cfg();
  if (req.query["hub.mode"] === "subscribe" && verifyToken && req.query["hub.verify_token"] === verifyToken) {
    return res.send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

metaRouter.post("/webhooks/meta", express.raw({ type: "*/*", limit: "5mb" }), async (req, res) => {
  const { appSecret } = cfg();
  if (appSecret) {
    const sig = req.get("x-hub-signature-256") || "";
    const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(req.body).digest("hex");
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return res.sendStatus(401);
    }
  }
  res.sendStatus(200); // Meta veut une réponse rapide
  let body;
  try {
    body = JSON.parse(req.body.toString("utf8"));
  } catch {
    return;
  }
  stats.last_event = Date.now();
  try {
    for (const entry of body.entry || []) {
      if (body.object === "page" || body.object === "instagram") {
        const channel = body.object === "page" ? "messenger" : "instagram";
        for (const ev of entry.messaging || []) await onMessaging(channel, ev);
        for (const ch of entry.changes || []) if (ch.field === "feed") await onFeedChange(ch.value);
      } else if (body.object === "whatsapp_business_account") {
        for (const ch of entry.changes || []) if (ch.field === "messages") await onWhatsAppCloud(ch.value);
      }
    }
    stats.error = null;
  } catch (e) {
    stats.error = e.message;
    console.error("Webhook Meta :", e);
  }
});

export function metaStatus() {
  const c = cfg();
  return {
    facebook: c.pageToken ? "configuré" : "non configuré",
    whatsapp_cloud: c.waToken && c.waPhoneId ? "configuré" : "non configuré",
    verify_token_set: !!c.verifyToken,
    ...stats,
  };
}

export function resetMetaCache() {
  pageId = null;
}

// ---------- Envoi ----------
async function sendPageMessage(contact, text) {
  const { pageToken } = cfg();
  const r = await graph("me/messages", {
    method: "POST",
    token: pageToken,
    body: { recipient: { id: contact.external_id }, messaging_type: "RESPONSE", message: { text } },
  });
  return r.message_id;
}

async function pageTyping(contact) {
  await graph("me/messages", {
    method: "POST",
    token: cfg().pageToken,
    body: { recipient: { id: contact.external_id }, sender_action: "typing_on" },
  });
}

registerAdapter({ channel: "messenger", send: sendPageMessage, typing: pageTyping });
registerAdapter({ channel: "instagram", send: sendPageMessage, typing: pageTyping });

registerAdapter({
  channel: "facebook_comment",
  async send(contact, text) {
    const r = await graph(`${contact.external_id}/comments`, {
      method: "POST",
      token: cfg().pageToken,
      body: { message: text },
    });
    return r.id;
  },
});

registerAdapter({
  channel: "whatsapp_cloud",
  async send(contact, text) {
    const { waToken, waPhoneId } = cfg();
    const r = await graph(`${waPhoneId}/messages`, {
      method: "POST",
      token: waToken,
      body: { messaging_product: "whatsapp", to: contact.external_id, type: "text", text: { body: text } },
    });
    return r.messages?.[0]?.id;
  },
  async markRead(contact, msgs) {
    const { waToken, waPhoneId } = cfg();
    const last = msgs[msgs.length - 1];
    if (!last?.external_id) return;
    await graph(`${waPhoneId}/messages`, {
      method: "POST",
      token: waToken,
      body: { messaging_product: "whatsapp", status: "read", message_id: last.external_id },
    });
  },
});
