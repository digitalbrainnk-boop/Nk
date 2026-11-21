// API REST des lignes WhatsApp. Toutes les routes portent l'identifiant de la
// ligne (:id) : une requête ne lit ou n'écrit jamais que les données de SA ligne.
import fs from "node:fs";
import { Router } from "express";
import multer from "multer";
import { AppError, badRequest } from "../../errors.js";
import { hasFfmpeg } from "../../whatsapp/media.js";
import { validateSessionId } from "../../whatsapp/SessionManager.js";

function intParam(value, { min, max, fallback }) {
  if (value === undefined) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < min || n > max) throw badRequest(`Paramètre invalide : ${value}`, "invalid_parameter");
  return n;
}

export function sessionsRouter(manager, { links, config }) {
  const router = Router();
  const body = (req) => (req.body && typeof req.body === "object" ? req.body : {});
  const out = (session, message) => links.decorate(session.id, message);

  // Fichiers envoyés depuis l'app : déposés dans le dossier temporaire de LA ligne concernée.
  const upload = multer({
    storage: multer.diskStorage({
      destination(req, file, cb) {
        try {
          const session = manager.get(req.params.id);
          fs.mkdirSync(session.uploadDir, { recursive: true });
          cb(null, session.uploadDir);
        } catch (err) {
          cb(err);
        }
      },
    }),
    limits: { fileSize: config.maxUploadBytes, files: 1, fields: 10 },
    defParamCharset: "utf8", // noms de fichiers avec accents
  });
  const receiveFile = (req, res, next) =>
    upload.single("file")(req, res, (err) => {
      if (err?.code === "LIMIT_FILE_SIZE") {
        return next(new AppError(413, `Fichier trop lourd (${Math.round(config.maxUploadBytes / 1048576)} Mo maximum).`, "file_too_large"));
      }
      next(err);
    });

  // Ce que le serveur sait faire (vocaux, taille maximale des fichiers).
  router.get("/capabilities", (req, res) => {
    res.json({ voiceNotes: hasFfmpeg(), maxUploadBytes: config.maxUploadBytes });
  });

  // Lister les lignes et leur état.
  router.get("/", (req, res) => {
    res.json({ sessions: manager.list() });
  });

  // Créer une ligne et lancer la connexion (QR, ou code si « phoneNumber » est fourni).
  router.post("/", async (req, res) => {
    const { id, label, phoneNumber } = body(req);
    const session = await manager.create({ id, label, phoneNumber });
    res.status(201).json({ session: session.summary });
  });

  // Initialiser une ligne par son identifiant (ex. « ligne-1 ») : création si besoin,
  // puis connexion (QR, ou code d'appairage si « phoneNumber » est fourni).
  router.post("/:id/init", async (req, res) => {
    const id = validateSessionId(req.params.id);
    const { label, phoneNumber } = body(req);
    let session = manager.find(id);
    if (session) await session.start({ phoneNumber });
    else session = await manager.create({ id, label, phoneNumber });
    res.json({ ok: true, session: session.summary });
  });

  // État d'une ligne (avec le QR code ou le code d'appairage en cours).
  router.get("/:id", (req, res) => {
    res.json({ session: manager.get(req.params.id).summary });
  });

  // Renommer.
  router.patch("/:id", async (req, res) => {
    const session = await manager.rename(req.params.id, body(req).label);
    res.json({ session: session.summary });
  });

  // (Re)connecter : QR code, ou code d'appairage si « phoneNumber » est fourni.
  router.post("/:id/connect", async (req, res) => {
    const session = manager.get(req.params.id);
    await session.start({ phoneNumber: body(req).phoneNumber });
    res.json({ session: session.summary });
  });

  // Mettre en pause (l'appareil reste relié, reprise sans QR).
  router.post("/:id/disconnect", async (req, res) => {
    const session = manager.get(req.params.id);
    await session.stop();
    res.json({ session: session.summary });
  });

  // Délier l'appareil (il faudra refaire un QR / code).
  router.post("/:id/logout", async (req, res) => {
    const session = manager.get(req.params.id);
    const { remoteLogout } = await session.logout();
    res.json({ session: session.summary, remoteLogout });
  });

  // Supprimer la ligne et toutes ses données.
  router.delete("/:id", async (req, res) => {
    await manager.remove(req.params.id);
    res.status(204).end();
  });

  // Discussions de CETTE ligne.
  router.get("/:id/chats", (req, res) => {
    const session = manager.get(req.params.id);
    res.json({ sessionId: session.id, chats: session.store.listChats() });
  });

  // Messages d'une discussion de CETTE ligne (pagination : ?before=<horodatage ms>&limit=50).
  router.get("/:id/chats/:chatId/messages", (req, res) => {
    const session = manager.get(req.params.id);
    const limit = intParam(req.query.limit, { min: 1, max: 200, fallback: 50 });
    const before = intParam(req.query.before, { min: 1, max: Number.MAX_SAFE_INTEGER, fallback: undefined });
    const chat = session.store.getChat(req.params.chatId);
    const { messages, hasMore } = session.store.getMessages(req.params.chatId, { limit, before });
    res.json({ sessionId: session.id, chat, messages: messages.map((m) => out(session, m)), hasMore });
  });

  // Remettre à zéro le compteur « non lus » (côté superviseur seulement :
  // aucun accusé de lecture n'est envoyé à WhatsApp).
  router.post("/:id/chats/:chatId/read", (req, res) => {
    const session = manager.get(req.params.id);
    const chat = session.store.markRead(req.params.chatId);
    session.scheduleSummary();
    res.json({ sessionId: session.id, chat });
  });

  // Réagir à un message : { "emoji": "👍" } (emoji vide = retirer la réaction).
  router.post("/:id/chats/:chatId/messages/:messageId/react", async (req, res) => {
    const session = manager.get(req.params.id);
    const message = await session.react(req.params.chatId, req.params.messageId, body(req).emoji);
    res.json({ sessionId: session.id, message: out(session, message) });
  });

  // Supprimer pour tout le monde un message envoyé par cette ligne.
  router.delete("/:id/chats/:chatId/messages/:messageId", async (req, res) => {
    const session = manager.get(req.params.id);
    const message = await session.deleteForEveryone(req.params.chatId, req.params.messageId);
    res.json({ sessionId: session.id, message });
  });

  // Envoyer un texte depuis CETTE ligne : { "to": "33612345678" | "<jid>", "text": "...", "replyTo"?: "<id du message cité>" }
  router.post("/:id/messages", async (req, res) => {
    const session = manager.get(req.params.id);
    const { to, text, replyTo } = body(req);
    const { chat, message } = await session.sendText(to, text, { replyTo });
    res.status(201).json({ sessionId: session.id, chat, message: out(session, message) });
  });

  // Envoyer un fichier (multipart/form-data) : file, to, caption?, replyTo?, voice? ("1" = note vocale)
  router.post("/:id/messages/media", receiveFile, async (req, res) => {
    const session = manager.get(req.params.id);
    const file = req.file;
    if (!file) throw badRequest("Aucun fichier reçu (champ « file »).", "missing_file");
    try {
      const { to, caption, replyTo, voice } = body(req);
      const { chat, message, notice } = await session.sendMedia({
        to,
        filePath: file.path,
        mimetype: file.mimetype,
        fileName: file.originalname,
        caption,
        voice: voice === "1" || voice === "true",
        replyTo: replyTo || undefined,
      });
      res.status(201).json({ sessionId: session.id, chat, message: out(session, message), notice });
    } finally {
      fs.promises.rm(file.path, { force: true }).catch(() => {});
    }
  });

  return router;
}
