// Notifications sur le téléphone, même application fermée (Web Push).
// Le contenu est chiffré de bout en bout entre ce serveur et le navigateur :
// le service de notification (Google, Mozilla, Apple) ne peut pas le lire.
import fs from "node:fs";
import path from "node:path";
import * as webpush from "web-push";
import { badRequest } from "./errors.js";

const PREVIEW_LABELS = {
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
};

export function messagePreview(message) {
  const label = PREVIEW_LABELS[message.type];
  const text = (message.text || message.media?.fileName || "").replace(/\s+/g, " ").trim();
  return (label && text ? `${label} · ${text}` : text || label || "Nouveau message").slice(0, 140);
}

export class PushService {
  constructor({ dataDir, contact, logger, send = webpush.sendNotification }) {
    this.file = path.join(dataDir, "push.json");
    this.log = logger.child({ module: "push" });
    this.send = send;
    this.lastByChat = new Map();
    let data = null;
    try {
      data = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      // première utilisation
    }
    if (!data?.publicKey || !data?.privateKey) {
      const keys = webpush.generateVAPIDKeys();
      data = { publicKey: keys.publicKey, privateKey: keys.privateKey, subscriptions: [] };
    }
    this.data = { subscriptions: [], ...data };
    this.vapid = { subject: contact, publicKey: this.data.publicKey, privateKey: this.data.privateKey };
    this.save();
  }

  get publicKey() {
    return this.data.publicKey;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }

  /** Enregistre (ou met à jour) l'abonnement d'un appareil. */
  subscribe(subscription, { preview = true } = {}) {
    const endpoint = subscription?.endpoint;
    const keys = subscription?.keys;
    let url;
    try {
      url = new URL(endpoint);
    } catch {
      throw badRequest("Abonnement aux notifications invalide.", "invalid_subscription");
    }
    if (url.protocol !== "https:" || typeof keys?.p256dh !== "string" || typeof keys?.auth !== "string") {
      throw badRequest("Abonnement aux notifications invalide.", "invalid_subscription");
    }
    const entry = { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, preview: Boolean(preview), createdAt: Date.now() };
    this.data.subscriptions = [...this.data.subscriptions.filter((s) => s.endpoint !== endpoint), entry].slice(-20);
    this.save();
    return entry;
  }

  unsubscribe(endpoint) {
    const before = this.data.subscriptions.length;
    this.data.subscriptions = this.data.subscriptions.filter((s) => s.endpoint !== endpoint);
    if (this.data.subscriptions.length !== before) this.save();
  }

  /** Envoie à tous les appareils abonnés ; les abonnements expirés sont oubliés. */
  async broadcast(build) {
    const results = await Promise.allSettled(
      this.data.subscriptions.map(async (sub) => {
        try {
          await this.send(sub, JSON.stringify(build(sub)), { TTL: 3600, urgency: "high", vapidDetails: this.vapid });
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) this.unsubscribe(sub.endpoint);
          else this.log.warn({ status: err.statusCode, err: err.message }, "Notification non envoyée");
          throw err;
        }
      }),
    );
    return results.filter((r) => r.status === "fulfilled").length;
  }

  /** Nouveau message reçu sur une ligne. */
  async notifyMessage({ session, chat, message }) {
    if (!this.data.subscriptions.length) return 0;
    // Une seule notification toutes les 5 s par discussion (rafales, rattrapage après coupure).
    const key = `${session.id}|${chat.id}`;
    const now = Date.now();
    if (now - (this.lastByChat.get(key) ?? 0) < 5000) return 0;
    this.lastByChat.set(key, now);
    if (this.lastByChat.size > 2000) this.lastByChat.clear();

    const who = chat.name || (chat.phone ? `+${chat.phone}` : "Nouveau message");
    return this.broadcast((sub) => ({
      title: sub.preview ? `${who} · ${session.meta.label}` : `Multi-Lignes · ${session.meta.label}`,
      body: sub.preview ? messagePreview(message) : "Nouveau message",
      tag: key,
      sessionId: session.id,
      chatId: chat.id,
      color: session.meta.color,
    }));
  }

  test() {
    return this.broadcast(() => ({ title: "Multi-Lignes", body: "Les notifications fonctionnent ✅", tag: "test" }));
  }
}
