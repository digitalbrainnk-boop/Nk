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
  DATA_DIR,
} from "./db.js";
import { bus } from "./events.js";
import {
  approveDraft,
  confirmPayment,
  createSong,
  handleIncoming,
  proposeLyrics,
  rejectDraft,
  runFollowups,
  messageOwner,
  runLyricsQueue,
  schedule,
  sendManual,
  startComposition,
} from "./router.js";
import { TTS_VOICES } from "./tts.js";
import { dailyReport, runWatchdog } from "./watchdog.js";
import { draftPost, publishNow, runSocial } from "./social.js";
import { HOOK_EVENTS, deliveryLog, emitHook, runAction, testHook } from "./integrations.js";
import { buildStyleProfile, friendlyError, songBrief } from "./agent.js";
import { chatText, probeKie } from "./openai-compat.js";
import { buildPairs, parseWhatsAppExport, participants } from "./learning.js";
import { startTelegram, telegramStatus } from "./channels/telegram.js";
import { maybeAutoStartWhatsApp, startWhatsApp, stopWhatsApp, whatsappStatus } from "./channels/whatsapp.js";
import { metaRouter, metaStatus, resetMetaCache } from "./channels/meta.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set("trust proxy", true);

// ---------- Authentification du tableau de bord ----------
let password = (process.env.ADMIN_PASSWORD || getSettings().admin_password || "").trim();
if (!password) {
  password = String(crypto.randomInt(100000, 1000000)); // 6 chiffres, facile à taper
  setSettings({ admin_password: password });
}
// Le mot de passe est aussi écrit dans un fichier bien visible du dossier du projet.
const passwordFile = path.join(here, "..", "MOT-DE-PASSE.txt");
try {
  fs.writeFileSync(
    passwordFile,
    `Mot de passe du tableau de bord : ${password}\r\n\r\nAdresse : http://localhost:${process.env.PORT || 3000}\r\n` +
      `Pour le changer : ouvre le fichier .env et écris ADMIN_PASSWORD=ton_mot_de_passe\r\n`,
  );
} catch {}
const secret = process.env.SESSION_SECRET || crypto.createHash("sha256").update("nk:" + password).digest("hex");
const sessionToken = crypto.createHmac("sha256", secret).update("admin").digest("hex");

function isAuthed(req) {
  const cookie = (req.headers.cookie || "").split(";").map((c) => c.trim()).find((c) => c.startsWith("nk_session="));
  const val = cookie?.slice("nk_session=".length) || "";
  return val.length === sessionToken.length && crypto.timingSafeEqual(Buffer.from(val), Buffer.from(sessionToken));
}

// Webhooks publics (Meta) avant le JSON/auth.
app.use(metaRouter);
app.use(express.json({ limit: "2mb" }));

app.post("/api/login", (req, res) => {
  const given = String(req.body?.password || "").trim();
  const ok =
    given.length === password.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(password));
  if (!ok) return res.status(401).json({ error: "Mot de passe incorrect" });
  const secure = req.secure ? "; Secure" : "";
  res.setHeader("Set-Cookie", `nk_session=${sessionToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}`);
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
  res.json(listContacts().map((c) => ({ ...c, ignored: isIgnored({ ...c, meta: JSON.parse(c.meta || "{}") }, list) })));
});
app.get("/api/contacts/:id", (req, res) => {
  const c = getContact(Number(req.params.id));
  if (!c) return res.sendStatus(404);
  res.json({ contact: { ...c, ignored: isIgnored(c) }, messages: listMessages(c.id, 300) });
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
  if (!m?.media_path) return res.sendStatus(404);
  res.type(m.media_type || "application/octet-stream").sendFile(m.media_path);
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
  await sendManual(id, `🎵 ${order.song_title || order.title || "Ta chanson"}\n\n${order.lyrics}\n\nDis-moi si ce texte te plaît, ou ce que tu veux changer 😊`);
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
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
function readExport(file) {
  if (/\.zip$/i.test(file.originalname) || file.buffer.subarray(0, 2).toString() === "PK") {
    const files = unzipSync(new Uint8Array(file.buffer));
    const txt = Object.keys(files).find((n) => n.toLowerCase().endsWith(".txt"));
    if (!txt) throw new Error("Pas de fichier .txt dans le zip");
    return strFromU8(files[txt]);
  }
  return file.buffer.toString("utf8");
}
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
app.delete("/api/learn/examples", (req, res) => {
  clearExamples(req.query.source);
  res.json({ ok: true });
});
app.post("/api/learn/profile", wrap(async (req, res) => {
  const s = getSettings();
  const result = await buildStyleProfile(s.owner_name || "le propriétaire");
  setSettings({ style_profile: result.style_profile });
  res.json(result);
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
  console.log(`\n🔑 MOT DE PASSE : ${password}`);
  console.log(`   (il est aussi écrit dans le fichier MOT-DE-PASSE.txt du dossier du projet)\n`);
  const st = getSettings();
  if (!process.env.ANTHROPIC_API_KEY && !st.anthropic_api_key && !process.env.KIE_API_KEY && !st.kie_api_key) {
    console.log("⚠️  Ajoute ta clé Kie.ai (Réglages du tableau de bord).");
  }
  startTelegram();
  maybeAutoStartWhatsApp();
  // Relances automatiques : vérification toutes les 15 minutes.
  setInterval(() => runFollowups().catch((e) => console.error("Relances :", e.message)), 15 * 60_000);
  // Textes de chansons à envoyer (délai « humain », 12 minutes max) : toutes les 30 secondes.
  setInterval(() => runLyricsQueue().catch((e) => console.error("Textes :", e.message)), 30_000);
  // Surveillance : chaque minute, on relance ce qui est bloqué et on te prévient ; bilan du soir.
  setInterval(() => runWatchdog().catch((e) => console.error("Surveillance :", e.message)), 60_000);
  // Publication automatique sur ta page (si tu l'as activée) : vérifiée chaque minute.
  setInterval(() => runSocial().catch((e) => console.error("Publication :", e.message)), 60_000);
});
