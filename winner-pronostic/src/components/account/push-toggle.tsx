"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { removePushSubscription, savePushSubscription } from "@/lib/notifications/actions";

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type Status = "loading" | "unsupported" | "not_configured" | "denied" | "off" | "on";

/** Active / désactive les notifications push sur CET appareil. */
export function PushToggle() {
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next: Status;
      if (!PUBLIC_KEY) next = "not_configured";
      else if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) next = "unsupported";
      else if (Notification.permission === "denied") next = "denied";
      else {
        const registration = await navigator.serviceWorker.getRegistration();
        next = (await registration?.pushManager.getSubscription()) ? "on" : "off";
      }
      if (!cancelled) setStatus(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = () =>
    startTransition(async () => {
      setMessage(null);
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setStatus("denied");
          return;
        }
        const registration = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
        await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(PUBLIC_KEY!) });
        const res = await savePushSubscription(subscription.toJSON(), navigator.userAgent);
        if (res.ok) setStatus("on");
        else setMessage(res.message ?? "Erreur");
      } catch {
        setMessage("Activation impossible sur ce navigateur.");
      }
    });

  const disable = () =>
    startTransition(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await removePushSubscription(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setStatus("off");
    });

  const text: Record<Status, string> = {
    loading: "Vérification…",
    unsupported: "Votre navigateur ne gère pas les notifications. Installez l'application (Chrome → « Ajouter à l'écran d'accueil »).",
    not_configured: "Les notifications seront bientôt disponibles.",
    denied: "Notifications bloquées : autorisez-les dans les réglages du navigateur pour ce site.",
    off: "Notifications désactivées sur cet appareil.",
    on: "🔔 Notifications activées sur cet appareil.",
  };

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">{text[status]}</p>
      {status === "off" ? (
        <Button size="sm" onClick={enable} disabled={pending}>
          🔔 Activer les notifications
        </Button>
      ) : null}
      {status === "on" ? (
        <Button size="sm" variant="secondary" onClick={disable} disabled={pending}>
          Désactiver sur cet appareil
        </Button>
      ) : null}
      {message ? <p className="text-xs text-danger">{message}</p> : null}
    </div>
  );
}
