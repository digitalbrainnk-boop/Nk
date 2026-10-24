"use client";

// Installer l'application : invite native quand le navigateur la propose (Chrome / Edge sur Android et
// ordinateur), sinon les gestes exacts selon le téléphone et le navigateur — et une sortie des
// navigateurs intégrés (Facebook, TikTok, Instagram…), où l'installation est impossible.

import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Download, EllipsisVertical, ExternalLink, Menu, Share, SquarePlus, X } from "lucide-react";
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { isStandalone } from "@/lib/client/download-to-mobile";
import { chromeIntentUrl, detectInstallEnv, type InstallEnv } from "@/lib/client/install-env";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// L'invite native n'est émise qu'une fois par page : elle est gardée ici pour tous les boutons.
let deferred: BeforeInstallPromptEvent | null = null;
let installedNow = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    installedNow = true;
    deferred = null;
    notify();
  });
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useInstall() {
  const prompt = useSyncExternalStore(subscribe, () => deferred, () => null);
  const justInstalled = useSyncExternalStore(subscribe, () => installedNow, () => false);
  const [env, setEnv] = useState<InstallEnv | null>(null);
  const [standalone, setStandalone] = useState(true);
  useEffect(() => {
    setEnv(detectInstallEnv(navigator.userAgent, navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
    setStandalone(isStandalone());
  }, []);
  /** Ouvre l'invite native ; renvoie false si le navigateur n'en propose pas. */
  const install = async () => {
    if (!deferred) return false;
    const ev = deferred;
    await ev.prompt();
    if ((await ev.userChoice).outcome === "accepted") installedNow = true;
    deferred = null;
    notify();
    return true;
  };
  return { env, canPrompt: !!prompt && !env?.inApp, installed: justInstalled || standalone, install };
}

/* ───────────── Gestes à faire, selon le téléphone et le navigateur ───────────── */

function Step({ n, icon, children }: { n: number; icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gold font-bold text-ink text-sm">{n}</span>
      <span className="pt-0.5">
        {children} <span className="ml-1 inline-flex translate-y-0.5 text-gold">{icon}</span>
      </span>
    </li>
  );
}

function CopyLink() {
  const [href, setHref] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => setHref(window.location.href), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
    } catch {
      // Certains navigateurs intégrés refusent le presse-papiers : le lien reste affiché et sélectionnable.
      setCopied(false);
    }
  };
  if (!href) return null;
  return (
    <div className="mt-4 flex items-center gap-2 rounded-2xl border border-line bg-ink/60 p-2 pl-4">
      <span className="min-w-0 flex-1 truncate text-sm text-cream/90 select-all">{href.replace(/^https?:\/\//, "")}</span>
      <button type="button" onClick={copy} className="btn btn-ghost min-h-10 shrink-0 px-3 py-2 text-sm">
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? "Copié" : "Copier le lien"}
      </button>
    </div>
  );
}

export function InstallSteps({ env }: { env: InstallEnv }) {
  const browser = env.platform === "ios" ? "Safari" : "Chrome";
  if (env.inApp) {
    return (
      <div className="space-y-4 text-sm">
        <p className="rounded-2xl border border-gold/30 bg-gold/5 p-3 text-gold-soft">
          Vous êtes dans le navigateur de <strong>{env.inApp}</strong> : il ne permet pas d&apos;installer l&apos;application. Ouvrez DB.Mélo dans {browser}.
        </p>
        {env.platform === "android" && (
          <a href={typeof window === "undefined" ? "#" : chromeIntentUrl(window.location.href)} className="btn btn-gold w-full">
            <ExternalLink className="size-5" /> Ouvrir dans Chrome
          </a>
        )}
        <ol className="space-y-3 text-cream/90">
          {env.platform === "android" ? (
            <Step n={1} icon={<EllipsisVertical className="size-4" />}>
              Si rien ne s&apos;ouvre : touchez le menu <strong>⋮</strong> ou <strong>•••</strong> en haut à droite, puis <strong>« Ouvrir dans Chrome »</strong> ou <strong>« Ouvrir dans le navigateur »</strong>.
            </Step>
          ) : (
            <Step n={1} icon={<EllipsisVertical className="size-4" />}>
              Touchez le menu <strong>•••</strong> (en haut ou en bas à droite), puis <strong>« Ouvrir dans Safari »</strong> ou <strong>« Ouvrir dans le navigateur »</strong>.
            </Step>
          )}
          <Step n={2} icon={<Download className="size-4" />}>
            Dans {browser}, touchez <strong>Installer</strong> en haut de la page DB.Mélo.
          </Step>
        </ol>
        <p className="text-muted">Ou copiez le lien et collez-le dans {browser} :</p>
        <CopyLink />
      </div>
    );
  }
  if (env.platform === "ios") {
    return (
      <ol className="space-y-3 text-sm text-cream/90">
        <Step n={1} icon={<Share className="size-4" />}>
          Touchez le bouton <strong>Partager</strong>{" "}
          {env.browser === "safari" ? "de Safari (en bas sur iPhone, en haut sur iPad)" : "dans la barre d'adresse (en haut à droite dans Chrome)"}.
        </Step>
        <Step n={2} icon={<SquarePlus className="size-4" />}>
          Choisissez <strong>« Sur l&apos;écran d&apos;accueil »</strong> (faites défiler la liste si besoin), puis <strong>Ajouter</strong>.
        </Step>
        {env.browser !== "safari" && <p className="text-muted">Si l&apos;option n&apos;apparaît pas, ouvrez dbmelo.com dans Safari.</p>}
      </ol>
    );
  }
  if (env.platform === "android") {
    if (env.browser === "samsung") {
      return (
        <ol className="space-y-3 text-sm text-cream/90">
          <Step n={1} icon={<Menu className="size-4" />}>
            Touchez le menu <strong>≡</strong> en bas à droite (ou l&apos;icône de téléchargement dans la barre d&apos;adresse).
          </Step>
          <Step n={2} icon={<SquarePlus className="size-4" />}>
            Choisissez <strong>« Ajouter la page à »</strong>, puis <strong>« Écran d&apos;accueil »</strong>.
          </Step>
        </ol>
      );
    }
    return (
      <div className="space-y-4 text-sm">
        <ol className="space-y-3 text-cream/90">
          <Step n={1} icon={<EllipsisVertical className="size-4" />}>
            Touchez le menu <strong>⋮</strong> en haut à droite de {env.browser === "chrome" ? "Chrome" : env.browser === "firefox" ? "Firefox" : "votre navigateur"}.
          </Step>
          <Step n={2} icon={<SquarePlus className="size-4" />}>
            Choisissez <strong>« Installer l&apos;application »</strong> ou <strong>« Ajouter à l&apos;écran d&apos;accueil »</strong>, puis confirmez.
          </Step>
        </ol>
        {env.browser === "other" && typeof window !== "undefined" && (
          <a href={chromeIntentUrl(window.location.href)} className="btn btn-ghost w-full">
            <ExternalLink className="size-5" /> Plus simple : ouvrir dans Chrome
          </a>
        )}
      </div>
    );
  }
  return (
    <ol className="space-y-3 text-sm text-cream/90">
      <Step n={1} icon={<Download className="size-4" />}>
        Dans Chrome ou Edge : cliquez l&apos;icône d&apos;installation à droite de la barre d&apos;adresse, ou menu <strong>⋮</strong> → <strong>« Installer DB.Mélo »</strong>.
      </Step>
      <Step n={2} icon={<SquarePlus className="size-4" />}>
        Sur Mac avec Safari : menu <strong>Fichier</strong> → <strong>« Ajouter au Dock »</strong>.
      </Step>
    </ol>
  );
}

const NO_STORE = "Pas besoin du Play Store ni de l'App Store : l'application s'installe depuis le site en quelques secondes, et l'icône DB.Mélo apparaît sur votre écran d'accueil.";

/* ───────────── Fenêtre d'aide ───────────── */

export function InstallSheet({ env, open, onClose }: { env: InstallEnv; open: boolean; onClose: () => void }) {
  // Rendue dans <body> : l'en-tête (flou d'arrière-plan) enfermerait sinon la fenêtre dans sa hauteur.
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-title"
            className="card safe-bottom max-h-[90dvh] w-full max-w-sm overflow-y-auto p-6"
            initial={{ y: 40 }}
            animate={{ y: 0 }}
            exit={{ y: 40 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <h2 id="install-title" className="font-display text-lg font-bold">
                Installer DB.Mélo
              </h2>
              <button type="button" onClick={onClose} aria-label="Fermer" className="btn-quiet">
                <X className="size-5" />
              </button>
            </div>
            <InstallSteps env={env} />
            <p className="mt-5 text-xs text-muted">{NO_STORE}</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ───────────── Bouton de l'en-tête ───────────── */

export function InstallButton() {
  const { env, canPrompt, installed, install } = useInstall();
  const [open, setOpen] = useState(false);
  // Sur téléphone, le bouton est toujours là : invite native si possible, sinon les gestes à faire.
  if (!env || installed || (env.platform === "desktop" && !canPrompt)) return null;
  const onClick = async () => {
    if (canPrompt && (await install())) return;
    setOpen(true);
  };
  return (
    <>
      <button type="button" onClick={onClick} className="btn btn-ghost min-h-10 rounded-xl px-3 py-2 text-sm" aria-label="Installer l'application">
        <Download className="size-4" />
        Installer
      </button>
      <InstallSheet env={env} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/* ───────────── Guide complet (page /installer) ───────────── */

const OTHER_DEVICES: { label: string; env: InstallEnv }[] = [
  { label: "Android avec Chrome", env: { platform: "android", browser: "chrome", inApp: null } },
  { label: "Samsung (Samsung Internet)", env: { platform: "android", browser: "samsung", inApp: null } },
  { label: "iPhone et iPad (Safari)", env: { platform: "ios", browser: "safari", inApp: null } },
  { label: "Depuis Facebook, TikTok ou Instagram (Android)", env: { platform: "android", browser: "chrome", inApp: "Facebook, TikTok ou Instagram" } },
  { label: "Depuis Facebook, TikTok ou Instagram (iPhone)", env: { platform: "ios", browser: "safari", inApp: "Facebook, TikTok ou Instagram" } },
  { label: "Ordinateur", env: { platform: "desktop", browser: "chrome", inApp: null } },
];

export function InstallGuide() {
  const { env, canPrompt, installed, install } = useInstall();
  if (!env) return <div className="card h-40 animate-pulse" />;
  return (
    <div className="space-y-6">
      <div className="card space-y-4 p-6">
        {installed ? (
          <p className="flex items-center gap-2 text-success">
            <Check className="size-5" /> DB.Mélo est installée sur cet appareil.
          </p>
        ) : canPrompt ? (
          <button type="button" onClick={install} className="btn btn-gold w-full text-base">
            <Download className="size-5" /> Installer l&apos;application
          </button>
        ) : (
          <InstallSteps env={env} />
        )}
        <p className="text-sm text-muted">{NO_STORE}</p>
      </div>
      <div>
        <h2 className="mb-3 font-display text-xl font-bold">Sur un autre téléphone</h2>
        <div className="space-y-3">
          {OTHER_DEVICES.map((d) => (
            <details key={d.label} className="card group p-5">
              <summary className="cursor-pointer list-none font-semibold marker:hidden">
                <span className="flex items-center justify-between gap-4">
                  {d.label}
                  <span className="text-gold transition group-open:rotate-45">+</span>
                </span>
              </summary>
              <div className="mt-4">
                <InstallSteps env={d.env} />
              </div>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────────── Bandeau dans les navigateurs intégrés ───────────── */

export function InAppBanner() {
  const { env } = useInstall();
  const [hidden, setHidden] = useState(true);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setHidden(sessionStorage.getItem("dbmelo-inapp") === "1");
    } catch {
      setHidden(false);
    }
  }, []);
  if (!env?.inApp || hidden) return null;
  const close = () => {
    setHidden(true);
    try {
      sessionStorage.setItem("dbmelo-inapp", "1");
    } catch {}
  };
  return (
    <div className="border-b border-gold/30 bg-gold/10">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 text-sm">
        <p className="min-w-0 flex-1 text-gold-soft">
          Pour installer l&apos;app et télécharger vos chansons, ouvrez DB.Mélo dans {env.platform === "ios" ? "Safari" : "Chrome"}.
        </p>
        {env.platform === "android" ? (
          <a href={chromeIntentUrl(window.location.href)} className="btn btn-gold min-h-9 shrink-0 px-3 py-1.5 text-xs">
            Ouvrir
          </a>
        ) : (
          <button type="button" onClick={() => setOpen(true)} className="btn btn-gold min-h-9 shrink-0 px-3 py-1.5 text-xs">
            Comment ?
          </button>
        )}
        <button type="button" onClick={close} aria-label="Fermer" className="btn-quiet shrink-0 p-1">
          <X className="size-4" />
        </button>
      </div>
      <InstallSheet env={env} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
