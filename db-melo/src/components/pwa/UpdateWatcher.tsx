"use client";

// Mise à jour automatique : dès qu'une nouvelle version du site est installée sur le serveur, les
// pages ouvertes (navigateur ou application installée) se rechargent d'elles-mêmes quand on revient
// dessus. Pendant la création d'une chanson, rien n'est interrompu : une notification propose
// « Mettre à jour ».

import { AnimatePresence, motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const CHECK_EVERY_MS = 15 * 60_000;
const MIN_GAP_MS = 60_000;

export function UpdateWatcher() {
  const pathname = usePathname();
  const path = useRef(pathname);
  path.current = pathname;
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    let loaded: string | null = null;
    let last = 0;
    const check = async () => {
      if (document.visibilityState !== "visible" || !navigator.onLine || Date.now() - last < MIN_GAP_MS) return;
      last = Date.now();
      try {
        const { site } = (await (await fetch("/api/version", { cache: "no-store" })).json()) as { site: string };
        if (!loaded) {
          loaded = site;
          return;
        }
        if (site === loaded) return;
        navigator.serviceWorker
          ?.getRegistration()
          .then((r) => r?.update())
          .catch(() => {});
        if (path.current.startsWith("/studio")) setWaiting(true);
        else window.location.reload();
      } catch {
        // Hors connexion ou serveur en cours de redémarrage : nouvel essai au prochain retour.
      }
    };
    check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => {
      // Au retour sur l'application, vérifier tout de suite.
      if (document.visibilityState === "visible") {
        last = 0;
        check();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, []);

  return (
    <AnimatePresence>
      {waiting && (
        <motion.div
          role="status"
          className="fixed inset-x-0 top-3 z-50 flex justify-center px-3"
          initial={{ y: -80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -80, opacity: 0 }}
        >
          <div className="card flex items-center gap-3 p-3 pl-4 text-sm shadow-2xl shadow-black/60">
            <span>Nouvelle version de DB.Mélo</span>
            <button type="button" onClick={() => window.location.reload()} className="btn btn-gold min-h-9 px-3 py-1.5 text-xs">
              <RefreshCw className="size-4" /> Mettre à jour
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
