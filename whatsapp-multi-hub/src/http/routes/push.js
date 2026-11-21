// Abonnement des appareils aux notifications.
import { Router } from "express";

export function pushRouter(push) {
  const router = Router();
  router.get("/key", (req, res) => res.json({ publicKey: push.publicKey }));
  router.post("/subscribe", (req, res) => {
    push.subscribe(req.body?.subscription, { preview: req.body?.preview !== false });
    res.status(201).json({ ok: true });
  });
  router.post("/unsubscribe", (req, res) => {
    if (typeof req.body?.endpoint === "string") push.unsubscribe(req.body.endpoint);
    res.json({ ok: true });
  });
  router.post("/test", async (req, res) => {
    const delivered = await push.test();
    res.json({ ok: true, delivered });
  });
  return router;
}
