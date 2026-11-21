// Notifications des nouveaux messages, même quand l'application est fermée (Web Push).
const fromB64Url = (s) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob((s + pad).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
};

export const pushSupported = () =>
  window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

async function registration() {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) throw new Error("Service worker absent : recharge la page puis réessaie.");
  return reg;
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Demande l'autorisation, s'abonne et enregistre l'abonnement sur le serveur. */
export async function enablePush(api, { preview }) {
  if (!pushSupported()) throw new Error("Ce navigateur ne permet pas les notifications ici (il faut HTTPS ou localhost).");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notifications refusées. Autorise-les : Chrome → ⋮ → Paramètres → Paramètres des sites → Notifications.");
  }
  const { publicKey } = await api.pushKey();
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  const key = fromB64Url(publicKey);
  const sameKey = (a) => a && new Uint8Array(a).every((b, i) => b === key[i]) && new Uint8Array(a).length === key.length;
  if (sub && !sameKey(sub.options?.applicationServerKey)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api.pushSubscribe(sub.toJSON(), preview);
  return sub;
}

export async function disablePush(api) {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.pushUnsubscribe(sub.endpoint).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}
