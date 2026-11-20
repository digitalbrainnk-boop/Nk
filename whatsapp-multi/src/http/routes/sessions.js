// API REST des lignes WhatsApp. Toutes les routes portent l'identifiant de la
// ligne (:id) : une requête ne lit ou n'écrit jamais que les données de SA ligne.
import { Router } from "express";
import { badRequest } from "../../errors.js";

function intParam(value, { min, max, fallback }) {
  if (value === undefined) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < min || n > max) throw badRequest(`Paramètre invalide : ${value}`, "invalid_parameter");
  return n;
}

export function sessionsRouter(manager) {
  const router = Router();
  const body = (req) => (req.body && typeof req.body === "object" ? req.body : {});

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
    res.json({ sessionId: session.id, chat, messages, hasMore });
  });

  // Remettre à zéro le compteur « non lus » (côté superviseur seulement :
  // aucun accusé de lecture n'est envoyé à WhatsApp).
  router.post("/:id/chats/:chatId/read", (req, res) => {
    const session = manager.get(req.params.id);
    const chat = session.store.markRead(req.params.chatId);
    session.scheduleSummary();
    res.json({ sessionId: session.id, chat });
  });

  // Envoyer un message texte depuis CETTE ligne : { "to": "33612345678" | "<jid>", "text": "..." }
  router.post("/:id/messages", async (req, res) => {
    const session = manager.get(req.params.id);
    const { to, text } = body(req);
    const { chat, message } = await session.sendText(to, text);
    res.status(201).json({ sessionId: session.id, chat, message });
  });

  return router;
}
