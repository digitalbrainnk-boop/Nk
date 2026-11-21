// Réglages des notifications Android (Termux:API).
import { Router } from "express";

export function notificationsRouter({ notifier, push }) {
  const router = Router();
  router.get("/", async (req, res) => {
    if (notifier.installed && notifier.working === null) await notifier.check();
    res.json(notifier.status);
  });
  router.put("/", async (req, res) => {
    notifier.updateSettings(req.body ?? {});
    if (req.body?.enabled === true) await notifier.check({ force: true });
    res.json(notifier.status);
  });
  router.post("/check", async (req, res) => {
    await notifier.check({ force: true });
    res.json(notifier.status);
  });
  // Test : notification Android si possible, sinon notification Chrome.
  router.post("/test", async (req, res) => {
    // Termux:API muette au dernier essai : on revérifie d'abord (sans attendre deux fois).
    if (notifier.installed && notifier.working === false) await notifier.check({ force: true });
    if (notifier.installed && notifier.settings.enabled && notifier.working !== false && (await notifier.test())) {
      return res.json({ ok: true, via: "android", status: notifier.status });
    }
    const delivered = await push.test();
    res.json({ ok: delivered > 0, via: "chrome", delivered, status: notifier.status });
  });
  // Notification fermée d'un geste (appelé par scripts/notification-action.js).
  router.post("/dismissed", (req, res) => {
    const { sessionId, chatId } = req.body ?? {};
    if (typeof sessionId === "string" && typeof chatId === "string") notifier.dismissed(sessionId, chatId);
    res.json({ ok: true });
  });
  return router;
}
