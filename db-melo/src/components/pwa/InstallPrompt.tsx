"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Download, Share, SquarePlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { isIOS, isStandalone } from "@/lib/client/download-to-mobile";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Installer l'application : invite native sur Android / Chrome / Edge (ordinateur),
 * instructions « Partager → Sur l'écran d'accueil » sur iPhone et iPad.
 */
export function InstallButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [installed, setInstalled] = useState(true);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    setInstalled(isStandalone());
    setIos(isIOS());
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || (!deferred && !ios)) return null;

  const install = async () => {
    if (deferred) {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
      setDeferred(null);
    } else {
      setHelp(true);
    }
  };

  return (
    <>
      <button type="button" onClick={install} className="btn btn-ghost min-h-10 rounded-xl px-3 py-2 text-sm" aria-label="Installer l'application">
        <Download className="size-4" />
        <span className="hidden sm:inline">Installer l&apos;app</span>
      </button>
      <AnimatePresence>
        {help && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setHelp(false)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="install-title"
              className="card safe-bottom w-full max-w-sm p-6"
              initial={{ y: 40 }}
              animate={{ y: 0 }}
              exit={{ y: 40 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-start justify-between">
                <h2 id="install-title" className="font-display text-lg font-bold">
                  Installer DB.Mélo
                </h2>
                <button type="button" onClick={() => setHelp(false)} aria-label="Fermer" className="btn-quiet">
                  <X className="size-5" />
                </button>
              </div>
              <ol className="space-y-4 text-sm text-cream/90">
                <li className="flex items-center gap-3">
                  <Share className="size-5 shrink-0 text-gold" />
                  Touchez le bouton <strong>Partager</strong> de Safari (en bas sur iPhone, en haut sur iPad).
                </li>
                <li className="flex items-center gap-3">
                  <SquarePlus className="size-5 shrink-0 text-gold" />
                  Choisissez <strong>« Sur l&apos;écran d&apos;accueil »</strong>, puis <strong>Ajouter</strong>.
                </li>
              </ol>
              <p className="mt-4 text-xs text-muted">L&apos;icône DB.Mélo s&apos;ouvre ensuite en plein écran, comme une application.</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
