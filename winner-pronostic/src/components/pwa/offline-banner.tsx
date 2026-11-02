"use client";

import { useSyncExternalStore } from "react";
import { WifiOffIcon } from "@/components/ui/icons";

function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

/** Prévient l'utilisateur quand la connexion internet est coupée. */
export function OfflineBanner() {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  if (online) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-warning/15 px-3 py-1.5 text-xs font-medium text-warning">
      <WifiOffIcon className="size-4" />
      Pas de connexion : les informations affichées peuvent ne pas être à jour.
    </div>
  );
}
