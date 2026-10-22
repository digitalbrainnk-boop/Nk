// Serveur web : tableau de bord + API + webhooks.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import { unzipSync, strFromU8 } from "fflate";
import {
  addExamples,
  clearExamples,
  deleteContact,
  deleteKnowledge,
  exampleStats,
  activeOrder,
  contactKey,
  creditStats,
  deleteOrder,
  getContact,
  isIgnored,
  isMuted,
  getOrder,
  getMessage,
  getSettings,
  listOrders,
  salesStats,
  saveOrder,
  listContacts,
  listKnowledge,
  listMessages,
  saveKnowledge,
  setSettings,
  updateContact,
  updateMessage,
  upsertContact,
  listIncidents,
  listSocialPosts,
  exampleKinds,
  DATA_DIR,
} from "./db.js";
import { bus } from "./events.js";
import {
  approveDraft,
  confirmPayment,
  lyricsMessage,
  createSong,
  handleIncoming,
  proposeLyrics,
  rejectDraft,
  runFollowups,
  messageOwner,
  runLyricsQueue,
  runReminders,
  flushOutbox,
  schedule,
  sendManual,
  startComposition,
} from "./router.js";
import { TTS_VOICES } from "./tts.js";
import { dailyReport, runExampleSort, runWatchdog } from "./watchdog.js";
import { draftPost, publishNow, runSocial } from "./social.js";
import { HOOK_EVENTS, deliveryLog, emitHook, runAction, testHook } from "./integrations.js";
import { buildStyleProfile, friendlyError, songBrief } from "./agent.js";
import { chatText, probeKie } from "./openai-compat.js";
import { buildPairs, parseWhatsAppExport, participants } from "./learning.js";
import { startTelegram, telegramStatus } from "./channels/telegram.js";
import { maybeAutoStartWhatsApp, startWhatsApp, stopWhatsApp, whatsappStatus } from "./channels/whatsapp.js";
import { metaRouter, metaStatus, resetMetaCache } from "./channels/meta.js";
import { whenLeader } from "./leader.js";
import { backupDatabase, scheduleRestore } from "./db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// Un seul relais (Apache/Passenger chez l'hébergeur) : l'adresse du visiteur ne peut pas être inventée.
app.set("trust proxy", 1);
app.disable("x-powered-by");
const PROD = process.env.NODE_ENV === "production";

// ---------- En-têtes de sécurité ----------
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; " +
      "media-src 'self' blob: https:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; " +
      "form-action 'self'; frame-ancestors 'none'",
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)");
  if (PROD) res.setHeader("Strict-Transport-Security", "max-age=31536000");
  next();
});

// ---------- Authentification du tableau de bord ----------
let password = (process.env.ADMIN_PASSWORD || getSettings().admin_password || "").trim();
if (!password) {
  // 12 caractères aléatoires : impossible à deviner (tu le retrouves dans MOT-DE-PASSE.txt).
  password = crypto.randomBytes(9).toString("base64url");
  setSettings({ admin_password: password });
}
// Sur le téléphone, le mot de passe est aussi écrit dans un fichier bien visible du dossier
// du projet (jamais chez l'hébergeur : là-bas, « nk motdepasse » l'affiche).
if (!PROD) {
  try {
    fs.writeFileSync(
      path.join(here, "..", "MOT-DE-PASSE.txt"),
      `Mot de passe du tableau de bord : ${password}\r\n\r\nAdresse : http://localhost:${process.env.PORT || 3000}\r\n` +
        `Pour le changer : ouvre le fichier .env et écris ADMIN_PASSWORD=ton_mot_de_passe\r\n`,
    );
  } catch {}
}

// Sessions : un jeton aléatoire par connexion (30 jours), gardé côté serveur sous forme d'empreinte.
const SESSION_DAYS = 30;
const hashToken = (t) => crypto.createHash("sha256").update(t).digest("hex");
function sessions() {
  const now = Date.now();
  return Object.fromEntries(Object.entries(getSettings().sessions || {}).filter(([, exp]) => exp > now));
}
function readCookie(req) {
  const c = (req.headers.cookie || "").split(";").map((x) => x.trim()).find((x) => x.startsWith("nk_session="));
  return c?.slice("nk_session=".length) || "";
}
function isAuthed(req) {
  const t = readCookie(req);
  return t.length >= 32 && !!sessions()[hashToken(t)];
}
const cookieFlags = (req) => `HttpOnly; SameSite=Strict; Path=/${PROD || req.secure ? "; Secure" : ""}`;

// Anti-devinette : 5 erreurs par adresse puis attente qui double (jusqu'à 1 h), et au plus
// 30 erreurs par heure au total (même si l'attaquant change d'adresse).
const failures = new Map();
let globalFails = [];
function loginBlocked(ip) {
  const now = Date.now();
  globalFails = globalFails.filter((t) => now - t < 3600_000);
  if (globalFails.length >= 30) return Math.ceil((globalFails[0] + 3600_000 - now) / 1000);
  const f = failures.get(ip);
  return f && f.until > now ? Math.ceil((f.until - now) / 1000) : 0;
}
function loginFailed(ip) {
  const f = failures.get(ip) || { n: 0, until: 0 };
  f.n++;
  if (f.n >= 5) f.until = Date.now() + Math.min(3600_000, 30_000 * 2 ** (f.n - 5));
  failures.set(ip, f);
  globalFails.push(Date.now());
  if (failures.size > 5000) failures.clear();
}

// Webhooks publics (Meta) avant le JSON/auth.
app.use(metaRouter);
// Page publique de bon fonctionnement (l'hébergeur la consulte pour garder l'agent éveillé).
app.get("/health", (req, res) => res.json({ ok: true }));
app.use(express.json({ limit: "2mb" }));

// Les demandes qui modifient quelque chose doivent venir du tableau de bord lui-même
// (protection contre les sites piégés, même sur un autre sous-domaine).
app.use("/api", (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const site = req.get("sec-fetch-site");
  if (site && !["same-origin", "none"].includes(site)) return res.status(403).json({ error: "Requête refusée" });
  const origin = req.get("origin");
  if (origin && origin !== "null") {
    try {
      if (new URL(origin).host !== req.get("host")) return res.status(403).json({ error: "Requête refusée" });
    } catch {
      return res.status(403).json({ error: "Requête refusée" });
    }
  }
  next();
});

app.post("/api/login", (req, res) => {
  const ip = req.ip || "?";
  const wait = loginBlocked(ip);
  if (wait) return res.status(429).json({ error: `Trop d'essais : réessaie dans ${Math.ceil(wait / 60)} minute(s).` });
  const given = String(req.body?.password || "").trim();
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(password).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    loginFailed(ip);
    return res.status(401).json({ error: "Mot de passe incorrect" });
  }
  failures.delete(ip);
  const token = crypto.randomBytes(32).toString("hex");
  const all = sessions();
  all[hashToken(token)] = Date.now() + SESSION_DAYS * 86400_000;
  // On garde les 20 connexions les plus récentes.
  const kept = Object.fromEntries(Object.entries(all).sort((x, y) => y[1] - x[1]).slice(0, 20));
  setSettings({ sessions: kept });
  res.setHeader("Set-Cookie", `nk_session=${token}; ${cookieFlags(req)}; Max-Age=${SESSION_DAYS * 86400}`);
  res.json({ ok: true });
});
app.post("/api/logout", (req, res) => {
  const all = sessions();
  delete all[hashToken(readCookie(req))];
  if (req.body?.everywhere && isAuthed(req)) for (const k of Object.keys(all)) delete all[k];
  setSettings({ sessions: all });
  res.setHeader("Set-Cookie", `nk_session=; ${cookieFlags(req)}; Max-Age=0`);
  res.json({ ok: true });
});

app.use("/api", (req, res, next) => (isAuthed(req) ? next() : res.status(401).json({ error: "Non connecté" })));

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error(e);
    res.status(500).json({ error: e.message });
  });

// ---------- Temps réel ----------
app.get("/api/events", (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const send = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  bus.on("event", send);
  const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
  req.on("close", () => {
    bus.off("event", send);
    clearInterval(ping);
  });
});

// ---------- Conversations ----------
app.get("/api/contacts", (req, res) => {
  const list = getSettings().ignored_contacts;
  const s = getSettings();
  res.json(
    listContacts().map((c) => {
      const full = { ...c, meta: JSON.parse(c.meta || "{}") };
      return { ...c, ignored: isIgnored(full, list), allowed: isIgnored(full, s.allowed_contacts), muted: isMuted(full, s) };
    }),
  );
});
app.get("/api/contacts/:id", (req, res) => {
  const c = getContact(Number(req.params.id));
  if (!c) return res.sendStatus(404);
  const s = getSettings();
  res.json({
    contact: { ...c, ignored: isIgnored(c), allowed: isIgnored(c, s.allowed_contacts), muted: isMuted(c, s), policy: s.reply_policy },
    messages: listMessages(c.id, 300),
  });
});
// Mode « seulement les contacts autorisés » : autorise / retire l'autorisation.
app.post("/api/contacts/:id/allow", (req, res) => {
  const c = getContact(Number(req.params.id));
  if (!c) return res.sendStatus(404);
  let list = [...(getSettings().allowed_contacts || [])];
  if (req.body?.allow) {
    if (!isIgnored(c, list)) list.push(contactKey(c));
  } else {
    list = list.filter((entry) => !isIgnored(c, [entry]));
  }
  setSettings({ allowed_contacts: list });
  // Autorisé : l'agent répond aux messages qui attendaient.
  if (req.body?.allow) schedule(c.id, 2);
  res.json({ allowed: isIgnored(c, list), list });
});
// Ajoute / retire le contact de la liste « ne jamais répondre ».
app.post("/api/contacts/:id/ignore", (req, res) => {
  const c = getContact(Number(req.params.id));
  if (!c) return res.sendStatus(404);
  let list = [...(getSettings().ignored_contacts || [])];
  if (req.body?.ignore) {
    if (!isIgnored(c, list)) list.push(contactKey(c));
  } else {
    list = list.filter((entry) => !isIgnored(c, [entry]));
  }
  setSettings({ ignored_contacts: list });
  res.json({ ignored: isIgnored(c, list), list });
});
app.get("/api/credits", wrap(async (req, res) => {
  const { getBalance, USD_PER_CREDIT } = await import("./credits.js");
  res.json({ balance: await getBalance(), usd_per_credit: USD_PER_CREDIT, ...creditStats() });
}));
app.patch("/api/contacts/:id", (req, res) => {
  const id = Number(req.params.id);
  const { memory, paused, needs_human, unread, name } = req.body;
  const patch = {};
  if (memory !== undefined) patch.memory = memory;
  if (name !== undefined) patch.name = name;
  if (paused !== undefined) patch.paused_until = paused ? Date.now() + 10 * 365 * 86400_000 : 0;
  if (needs_human !== undefined) patch.needs_human = needs_human ? 1 : 0;
  if (unread !== undefined) patch.unread = unread;
  updateContact(id, patch);
  if (paused === false) schedule(id, 1);
  res.json(getContact(id));
});
app.delete("/api/contacts/:id", (req, res) => {
  deleteContact(Number(req.params.id));
  res.json({ ok: true });
});
app.post("/api/contacts/:id/send", wrap(async (req, res) => {
  res.json(await sendManual(Number(req.params.id), String(req.body.text || "")));
}));
app.post("/api/contacts/:id/regenerate", (req, res) => {
  const id = Number(req.params.id);
  const msgs = listMessages(id, 50);
  const lastClient = [...msgs].reverse().find((m) => m.author === "client");
  if (lastClient) {
    // On marque le dernier message client comme "non répondu" pour relancer l'agent.
    updateMessage(lastClient.id, { answered: 0 });
    updateContact(id, { paused_until: 0 });
    schedule(id, 0);
  }
  res.json({ ok: true });
});
app.get("/api/media/:id", (req, res) => {
  const m = getMessage(Number(req.params.id));
  const file = m?.media_path ? path.resolve(m.media_path) : "";
  if (!file || !file.startsWith(path.resolve(DATA_DIR, "media") + path.sep) || !fs.existsSync(file)) return res.sendStatus(404);
  // Seuls les images et sons s'affichent ; tout le reste est proposé en téléchargement.
  const type = String(m.media_type || "").split(";")[0].trim().toLowerCase();
  const safe = /^(image\/(jpeg|png|webp|gif)|audio\/[a-z0-9.+-]+|video\/mp4)$/.test(type);
  res.type(safe ? type : "application/octet-stream");
  if (!safe) res.setHeader("Content-Disposition", "attachment");
  res.sendFile(file);
});
// ---------- Commandes & ventes ----------
app.get("/api/orders", (req, res) => res.json(listOrders({ contactId: Number(req.query.contact) || undefined })));
app.post("/api/orders", wrap(async (req, res) => {
  const o = req.body || {};
  if (!o.id && !o.contact_id) throw new Error("Client manquant");
  const before = o.id ? getOrder(Number(o.id)) : null;
  const saved = saveOrder(o);
  const c = getContact(saved.contact_id);
  const contact = { id: c.id, name: c.name, channel: c.channel, phone: c.meta?.phone || null };
  emitHook("order.updated", { contact, order: saved });
  if (saved.paid > (before?.paid || 0)) {
    emitHook("order.paid", { contact, order: saved, amount: saved.paid - (before?.paid || 0) });
    // Texte déjà validé, on attendait le paiement : la composition démarre.
    if (saved.lyrics_status === "validated" && getSettings().compose_requires_payment) {
      saveOrder({ id: saved.id, payment_confirmed_at: saved.payment_confirmed_at || Date.now() });
      startComposition(saved.contact_id).catch((e) => console.error("Composition :", e.message));
    }
  }
  res.json(saved);
}));
app.delete("/api/orders/:id", (req, res) => {
  deleteOrder(Number(req.params.id));
  res.json({ ok: true });
});
app.get("/api/sales", (req, res) => res.json({ ...salesStats(), currency: getSettings().currency }));
// Bilan du jour et problèmes repérés par la surveillance.
app.get("/api/report", (req, res) => {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.day || "")) ? String(req.query.day) : undefined;
  res.json(dailyReport(day));
});
app.post("/api/report/send", wrap(async (req, res) => {
  const ok = await messageOwner(dailyReport().text);
  if (!ok) throw new Error("Impossible d'envoyer : connecte WhatsApp (onglet Canaux) ou Telegram.");
  res.json({ ok: true });
}));
app.get("/api/incidents", (req, res) => res.json(listIncidents({ since: Date.now() - 7 * 24 * 3600_000 })));
app.post("/api/watchdog/run", wrap(async (req, res) => res.json({ found: (await runWatchdog()).length })));
// Publications automatiques (page Facebook / Instagram).
app.get("/api/social/posts", (req, res) => res.json(listSocialPosts(20)));
app.post("/api/social/preview", wrap(async (req, res) => {
  try {
    res.json(await draftPost());
  } catch (e) {
    res.status(400).json({ error: friendlyError(e) });
  }
}));
app.post("/api/social/publish", wrap(async (req, res) => {
  try {
    res.json(await publishNow());
  } catch (e) {
    res.status(400).json({ error: friendlyError(e) });
  }
}));
app.post("/api/followups/run", wrap(async (req, res) => res.json({ sent: await runFollowups() })));
// ---------- Applications connectées ----------
app.get("/api/integrations", (req, res) => {
  const s = getSettings();
  // Les en-têtes (clés) des actions ne sont jamais renvoyés en clair.
  const actions = (s.agent_actions || []).map((a) => ({
    ...a,
    headers: Object.fromEntries(Object.keys(a.headers || {}).map((k) => [k, "••••••"])),
  }));
  res.json({ webhooks: s.webhooks || [], actions, events: HOOK_EVENTS, log: deliveryLog() });
});
app.put("/api/integrations", wrap(async (req, res) => {
  const s = getSettings();
  const { webhooks, actions } = req.body || {};
  const patch = {};
  const isUrl = (u) => /^https?:\/\//i.test(u || "");
  if (Array.isArray(webhooks)) {
    patch.webhooks = webhooks.map((h) => {
      if (h.url && !isUrl(h.url)) throw new Error(`Adresse invalide : ${h.url}`);
      return {
        id: h.id || crypto.randomUUID(),
        name: String(h.name || "Application").slice(0, 60),
        url: String(h.url || "").trim(),
        events: (h.events || []).filter((e) => e in HOOK_EVENTS),
        secret: h.secret || crypto.randomBytes(16).toString("hex"),
        enabled: h.enabled !== false,
      };
    });
  }
  if (Array.isArray(actions)) {
    const old = Object.fromEntries((s.agent_actions || []).map((a) => [a.id, a]));
    patch.agent_actions = actions.map((a) => {
      if (a.url && !isUrl(a.url)) throw new Error(`Adresse invalide : ${a.url}`);
      const id = a.id || crypto.randomUUID();
      // "••••••" = clé inchangée : on garde l'ancienne valeur.
      const headers = {};
      for (const [k, v] of Object.entries(a.headers || {})) {
        if (!k.trim()) continue;
        headers[k.trim()] = v === "••••••" ? old[id]?.headers?.[k.trim()] ?? "" : String(v);
      }
      return {
        id,
        name: String(a.name || "Action").slice(0, 60),
        description: String(a.description || "").slice(0, 500),
        url: String(a.url || "").trim(),
        method: a.method === "GET" ? "GET" : "POST",
        headers,
        enabled: a.enabled !== false,
      };
    });
  }
  setSettings(patch);
  res.json({ ok: true });
}));
app.post("/api/integrations/webhooks/:id/test", wrap(async (req, res) => {
  const hook = (getSettings().webhooks || []).find((h) => h.id === req.params.id);
  if (!hook) throw new Error("Webhook introuvable (enregistre d'abord)");
  res.json(await testHook(hook));
}));
app.post("/api/integrations/actions/:id/test", wrap(async (req, res) => {
  const a = (getSettings().agent_actions || []).find((x) => x.id === req.params.id);
  if (!a) throw new Error("Action introuvable (enregistre d'abord)");
  res.json(await runAction({ name: a.name, input: String(req.body?.input || "test") }, { name: "Test", channel: "test" }));
}));

app.get("/api/tts/voices", (req, res) => res.json(TTS_VOICES));
app.post("/api/tts/preview", wrap(async (req, res) => {
  const { textToSpeech } = await import("./tts.js");
  const name = getSettings().owner_name || "moi";
  const audio = await textToSpeech(`Bonjour ! C'est ${name}. Merci pour ton message, je te prépare ta chanson avec plaisir.`);
  res.json({ url: `/api/voice/file/${path.basename(audio.path)}` });
}));
// Écoute d'un vocal créé par l'agent (dossier data/media).
app.get("/api/voice/file/:name", (req, res) => {
  const file = path.join(DATA_DIR, "media", path.basename(req.params.name));
  if (!fs.existsSync(file)) return res.sendStatus(404);
  res.sendFile(file);
});

// Processus chanson : écrire / corriger le texte et l'envoyer, ou composer tout de suite.
app.post("/api/contacts/:id/lyrics", wrap(async (req, res) => {
  try {
    res.json(await proposeLyrics(Number(req.params.id), { revise: !!req.body?.revise, notes: String(req.body?.notes || "") }));
  } catch (e) {
    res.status(400).json({ error: friendlyError(e) });
  }
}));
app.post("/api/contacts/:id/lyrics/send", wrap(async (req, res) => {
  // Envoie au client le texte tel que tu l'as corrigé dans le panneau Commande.
  const id = Number(req.params.id);
  const order = activeOrder(id);
  if (!order?.lyrics) throw new Error("Aucun texte à envoyer.");
  saveOrder({ id: order.id, lyrics_status: "proposed" });
  await sendManual(id, lyricsMessage(order));
  res.json({ ok: true });
}));
// TU as vérifié le paiement (même effet que ta réaction emoji sur WhatsApp).
app.post("/api/contacts/:id/confirm-payment", wrap(async (req, res) => {
  res.json(await confirmPayment(Number(req.params.id), { by: "tableau de bord" }));
}));
app.post("/api/contacts/:id/compose", wrap(async (req, res) => {
  res.json(await startComposition(Number(req.params.id)));
}));
app.post("/api/contacts/:id/song/brief", wrap(async (req, res) => {
  try {
    res.json(await songBrief(getContact(Number(req.params.id))));
  } catch (e) {
    res.status(400).json({ error: friendlyError(e) });
  }
}));
app.post("/api/contacts/:id/song", wrap(async (req, res) => {
  const { title, style, lyrics, instrumental } = req.body || {};
  if (!title?.trim() || (!instrumental && !lyrics?.trim())) throw new Error("Il faut au moins un titre et des paroles.");
  res.json(await createSong(Number(req.params.id), { title, style, lyrics, instrumental: !!instrumental }));
}));
app.post("/api/messages/:id/approve", wrap(async (req, res) => {
  await approveDraft(Number(req.params.id), req.body.text);
  res.json({ ok: true });
}));
app.post("/api/messages/:id/reject", (req, res) => {
  rejectDraft(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- Bac à sable ----------
app.post("/api/test/message", wrap(async (req, res) => {
  const name = String(req.body.name || "Client test");
  await handleIncoming({ channel: "test", externalId: name, name, text: String(req.body.text || "") });
  res.json({ contact: upsertContact("test", name, name) });
}));

// ---------- Réglages ----------
const SECRET_KEYS = [
  "anthropic_api_key",
  "telegram_token",
  "facebook_page_token",
  "facebook_app_secret",
  "wa_cloud_token",
  "transcription_api_key",
  "llm_api_key",
  "kie_api_key",
  "elevenlabs_api_key",
  "admin_password",
];
app.get("/api/settings", (req, res) => {
  const s = getSettings();
  for (const k of SECRET_KEYS) s[k] = s[k] ? "••••••" + String(s[k]).slice(-4) : "";
  // Applications connectées : gérées par /api/integrations (elles contiennent des clés).
  delete s.webhooks;
  delete s.agent_actions;
  delete s.sessions;
  delete s.owner_notes;
  s.env = {
    kie_api_key: !!process.env.KIE_API_KEY,
    anthropic_api_key: !!process.env.ANTHROPIC_API_KEY,
    transcription_api_key: !!process.env.TRANSCRIPTION_API_KEY,
  };
  res.json(s);
});
app.put("/api/settings", wrap(async (req, res) => {
  const patch = { ...req.body };
  delete patch.env;
  delete patch.admin_password;
  delete patch.webhooks;
  delete patch.agent_actions;
  delete patch.sessions;
  delete patch.owner_notes;
  for (const k of SECRET_KEYS) if (typeof patch[k] === "string" && patch[k].startsWith("••••••")) delete patch[k];
  // Une clé collée dans la case Claude qui n'est pas une clé Claude (sk-ant-…)
  // est très probablement une clé Kie.ai : on la range au bon endroit.
  let moved = false;
  const ak = typeof patch.anthropic_api_key === "string" ? patch.anthropic_api_key.trim() : "";
  if (ak && !ak.startsWith("sk-ant-")) {
    patch.kie_api_key = ak;
    patch.anthropic_api_key = "";
    patch.brain = "kie";
    moved = true;
  }
  setSettings(patch);
  if ("telegram_token" in patch) await startTelegram();
  if ("facebook_page_token" in patch) resetMetaCache();
  res.json({ ok: true, moved });
}));

app.post("/api/llm/test", wrap(async (req, res) => {
  try {
    if (getSettings().brain === "kie") {
      const r = await probeKie();
      setSettings({ kie_chat_model: r.model, kie_chat_url: r.url });
      return res.json({ ok: true, text: r.text, model: r.model });
    }
    const text = await chatText({
      system: "Tu es un assistant. Réponds en français, en une phrase courte.",
      turns: [{ role: "user", content: [{ type: "text", text: "Dis bonjour et confirme que tu fonctionnes." }] }],
    });
    res.json({ ok: true, text });
  } catch (e) {
    res.json({ ok: false, error: friendlyError(e) });
  }
}));

// ---------- Connaissances ----------
app.get("/api/knowledge", (req, res) => res.json(listKnowledge()));
app.post("/api/knowledge", (req, res) => res.json({ id: saveKnowledge(req.body) }));
app.delete("/api/knowledge/:id", (req, res) => {
  deleteKnowledge(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- Apprentissage ----------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 10 } });
function readExport(file) {
  if (/\.zip$/i.test(file.originalname) || file.buffer.subarray(0, 2).toString() === "PK") {
    const files = unzipSync(new Uint8Array(file.buffer));
    const txt = Object.keys(files).find((n) => n.toLowerCase().endsWith(".txt"));
    if (!txt) throw new Error("Pas de fichier .txt dans le zip");
    return strFromU8(files[txt]);
  }
  return file.buffer.toString("utf8");
}
// Sauvegarde complète (clients, conversations, réglages, clés) et restauration.
app.get("/api/backup", wrap(async (req, res) => {
  const file = backupDatabase();
  const day = new Date().toISOString().slice(0, 10);
  res.download(file, `sauvegarde-agent-${day}.db`, () => fs.rmSync(file, { force: true }));
}));
app.post("/api/restore", upload.single("file"), wrap(async (req, res) => {
  if (!req.file) throw new Error("Choisis le fichier de sauvegarde (.db).");
  scheduleRestore(req.file.buffer);
  res.json({ ok: true });
  // Redémarrage pour charger la sauvegarde (l'hébergeur ou la commande « agent » relance l'agent).
  setTimeout(() => process.kill(process.pid, "SIGTERM"), 800);
}));
// Ma voix : tes enregistrements -> ta voix clonée chez ElevenLabs.
app.post("/api/voice/clone", upload.array("files", 5), wrap(async (req, res) => {
  const { saveMedia } = await import("./media.js");
  const { cloneVoice } = await import("./elevenlabs.js");
  const files = (req.files || []).map((f) => saveMedia(f.buffer, f.mimetype || "audio/webm"));
  const voiceId = await cloneVoice(files, `Voix de ${getSettings().owner_name || "moi"}`);
  setSettings({ elevenlabs_voice_id: voiceId, voice_provider: "elevenlabs" });
  res.json({ ok: true, voice_id: voiceId });
}));
app.post("/api/learn/preview", upload.array("files"), wrap(async (req, res) => {
  const all = [];
  for (const f of req.files || []) all.push(...parseWhatsAppExport(readExport(f)));
  res.json({ messages: all.length, participants: participants(all) });
}));
app.post("/api/learn/import", upload.array("files"), wrap(async (req, res) => {
  const owner = String(req.body.owner || "");
  if (!owner) throw new Error("Indique ton nom tel qu'il apparaît dans l'export");
  let added = 0;
  let pairs = 0;
  for (const f of req.files || []) {
    const p = buildPairs(parseWhatsAppExport(readExport(f)), owner);
    pairs += p.length;
    added += addExamples(p, "export");
  }
  if (!getSettings().owner_name) setSettings({ owner_name: owner });
  res.json({ pairs, added });
}));
app.get("/api/learn/stats", (req, res) => res.json(exampleStats()));
app.get("/api/learn/kinds", (req, res) => res.json(exampleKinds()));
app.post("/api/learn/sort", wrap(async (req, res) => {
  try {
    res.json({ sorted: await runExampleSort(2000), kinds: exampleKinds() });
  } catch (e) {
    res.status(502).json({ error: friendlyError(e) });
  }
}));
app.delete("/api/learn/examples", (req, res) => {
  clearExamples(req.query.source);
  res.json({ ok: true });
});
app.post("/api/learn/profile", wrap(async (req, res) => {
  const s = getSettings();
  try {
    const result = await buildStyleProfile(s.owner_name || "le propriétaire");
    setSettings({ style_profile: result.style_profile });
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: friendlyError(e) });
  }
}));

// ---------- Canaux ----------
app.get("/api/channels", (req, res) => {
  const base = `${req.protocol}://${req.get("host")}`;
  res.json({
    whatsapp: whatsappStatus(),
    telegram: telegramStatus(),
    meta: { ...metaStatus(), webhook_url: `${base}/webhooks/meta` },
  });
});
app.post("/api/channels/whatsapp/start", wrap(async (req, res) => {
  await startWhatsApp(req.body?.phone ? { phone: req.body.phone } : { phone: null });
  res.json({ ok: true });
}));
app.post("/api/channels/whatsapp/stop", wrap(async (req, res) => {
  await stopWhatsApp({ logout: !!req.body.logout });
  res.json({ ok: true });
}));
app.post("/api/channels/telegram/restart", wrap(async (req, res) => {
  await startTelegram();
  res.json(telegramStatus());
}));

// ---------- Tableau de bord ----------
app.use(express.static(path.join(here, "..", "public")));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`\n✅ Agent démarré : http://localhost:${port}`);
  // Le mot de passe n'est jamais écrit dans le journal du serveur (chez l'hébergeur : « nk motdepasse »).
  if (!PROD) {
    console.log(`\n🔑 MOT DE PASSE : ${password}`);
    console.log(`   (il est aussi écrit dans le fichier MOT-DE-PASSE.txt du dossier du projet)\n`);
  }
  const st = getSettings();
  if (!process.env.ANTHROPIC_API_KEY && !st.anthropic_api_key && !process.env.KIE_API_KEY && !st.kie_api_key) {
    console.log("⚠️  Ajoute ta clé Kie.ai (Réglages du tableau de bord).");
  }
});

// WhatsApp, Telegram et tâches automatiques : une seule copie de l'agent s'en occupe.
whenLeader(() => {
  startTelegram();
  maybeAutoStartWhatsApp();
  // Relances automatiques : vérification toutes les 15 minutes.
  setInterval(() => runFollowups().catch((e) => console.error("Relances :", e.message)), 15 * 60_000);
  // Relances prévues (« je reviendrai pour une autre chanson ») : toutes les 5 minutes.
  setInterval(() => runReminders().catch((e) => console.error("Relances prévues :", e.message)), 5 * 60_000);
  // Textes de chansons à envoyer (délai « humain », 12 minutes max) : toutes les 30 secondes.
  setInterval(() => runLyricsQueue().catch((e) => console.error("Textes :", e.message)), 30_000);
  // File d'envoi : ce qui n'a pas pu partir repart tel quel dès que possible (toutes les minutes).
  setInterval(() => flushOutbox().catch((e) => console.error("File d'envoi :", e.message)), 60_000);
  // Surveillance : chaque minute, on relance ce qui est bloqué et on te prévient ; bilan du soir.
  setInterval(() => runWatchdog().catch((e) => console.error("Surveillance :", e.message)), 60_000);
  // Publication automatique sur ta page (si tu l'as activée) : vérifiée chaque minute.
  setInterval(() => runSocial().catch((e) => console.error("Publication :", e.message)), 60_000);
});
