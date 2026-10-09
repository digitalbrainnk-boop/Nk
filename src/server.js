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
  getContact,
  getMessage,
  getSettings,
  listContacts,
  listKnowledge,
  listMessages,
  saveKnowledge,
  setSettings,
  updateContact,
  updateMessage,
  upsertContact,
} from "./db.js";
import { bus } from "./events.js";
import { approveDraft, handleIncoming, rejectDraft, schedule, sendManual } from "./router.js";
import { buildStyleProfile } from "./agent.js";
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
app.get("/api/contacts", (req, res) => res.json(listContacts()));
app.get("/api/contacts/:id", (req, res) => {
  const c = getContact(Number(req.params.id));
  if (!c) return res.sendStatus(404);
  res.json({ contact: c, messages: listMessages(c.id, 300) });
});
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
  "admin_password",
];
app.get("/api/settings", (req, res) => {
  const s = getSettings();
  for (const k of SECRET_KEYS) s[k] = s[k] ? "••••••" + String(s[k]).slice(-4) : "";
  s.env = {
    anthropic_api_key: !!process.env.ANTHROPIC_API_KEY,
    transcription_api_key: !!process.env.TRANSCRIPTION_API_KEY,
  };
  res.json(s);
});
app.put("/api/settings", wrap(async (req, res) => {
  const patch = { ...req.body };
  delete patch.env;
  delete patch.admin_password;
  for (const k of SECRET_KEYS) if (typeof patch[k] === "string" && patch[k].startsWith("••••••")) delete patch[k];
  setSettings(patch);
  if ("telegram_token" in patch) await startTelegram();
  if ("facebook_page_token" in patch) resetMetaCache();
  res.json({ ok: true });
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
  if (!process.env.ANTHROPIC_API_KEY && !getSettings().anthropic_api_key) {
    console.log("⚠️  Ajoute ta clé ANTHROPIC_API_KEY (fichier .env ou Réglages du tableau de bord).");
  }
  startTelegram();
  maybeAutoStartWhatsApp();
});
