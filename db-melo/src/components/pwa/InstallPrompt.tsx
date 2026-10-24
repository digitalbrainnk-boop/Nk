"use client";

// Installer l'application : l'invite de Chrome (Android, ordinateur) en un toucher — l'application
// s'installe alors toute seule —, annoncée par une notification dès que Chrome la permet ; sinon les
// gestes exacts selon le téléphone et le navigateur, une sortie des navigateurs intégrés (Facebook,
// TikTok…), et en dernier recours le fichier d'installation Android (dbmelo.com/dbmelo.apk).

import { AnimatePresence, motion } from "framer-motion";
import { Check, CircleCheck, Copy, Download, EllipsisVertical, ExternalLink, FileDown, LoaderCircle, Menu, Share, ShieldCheck, SquarePlus, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { isStandalone } from "@/lib/client/download-to-mobile";
import { appFromReferrer, chromeIntentUrl, detectInstallEnv, type InstallEnv, ofApp } from "@/lib/client/install-env";

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

// Taille de l'application Android (null : ce serveur n'en propose pas), demandée une fois par page.
let apkInfo: Promise<number | null> | null = null;
function fetchApkSize(): Promise<number | null> {
  apkInfo ??= fetch("/dbmelo.apk", { method: "HEAD", cache: "no-store" })
    .then((r) => (r.ok ? Number(r.headers.get("content-length")) || 0 : null))
    .catch(() => null);
  return apkInfo;
}

/** undefined : en cours de vérification ; null : pas d'application Android ; sinon sa taille en octets. */
export function useAndroidApk(enabled: boolean) {
  const [size, setSize] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetchApkSize().then((s) => live && setSize(s));
    return () => {
      live = false;
    };
  }, [enabled]);
  return enabled ? size : null;
}

export function useInstall() {
  const prompt = useSyncExternalStore(subscribe, () => deferred, () => null);
  const justInstalled = useSyncExternalStore(subscribe, () => installedNow, () => false);
  const [env, setEnv] = useState<InstallEnv | null>(null);
  const [standalone, setStandalone] = useState(true);
  useEffect(() => {
    const detected = detectInstallEnv(navigator.userAgent, navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    // Le référent de l'application d'origine disparaît à la page suivante : il est gardé pour l'onglet.
    let viaApp = appFromReferrer(document.referrer);
    try {
      if (viaApp) sessionStorage.setItem("dbmelo-via", viaApp);
      else viaApp = sessionStorage.getItem("dbmelo-via");
    } catch {}
    setEnv({ ...detected, viaApp: detected.platform === "android" && !detected.inApp ? viaApp : null });
    // Ouvert depuis l'application Android (adresse de lancement « ?source=android ») : déjà installée.
    let inAndroidApp = false;
    try {
      if (new URLSearchParams(window.location.search).get("source") === "android") sessionStorage.setItem("dbmelo-app", "android");
      inAndroidApp = sessionStorage.getItem("dbmelo-app") === "android";
    } catch {}
    setStandalone(isStandalone() || inAndroidApp);
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

const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1).replace(".", ",")}\u00a0Mo`;

/** Téléchargement de l'application Android et les trois gestes qui suivent. */
export function AndroidDownload({ size }: { size: number }) {
  return (
    <div className="space-y-4 text-sm">
      <a href="/dbmelo.apk" download="DBMelo.apk" className="btn btn-gold w-full text-base">
        <Download className="size-5" /> Télécharger l&apos;application{size > 0 ? ` (${megabytes(size)})` : ""}
      </a>
      <ol className="space-y-3 text-cream/90">
        <Step n={1} icon={<FileDown className="size-4" />}>
          Si Chrome demande une confirmation, touchez <strong>« Télécharger quand même »</strong>. Ouvrez ensuite le fichier <strong>DBMelo.apk</strong> :
          notification en haut de l&apos;écran, ou dossier <strong>Téléchargements</strong>.
        </Step>
        <Step n={2} icon={<ShieldCheck className="size-4" />}>
          Si le téléphone demande une autorisation : touchez <strong>Paramètres</strong>, activez <strong>« Autoriser cette source »</strong>, puis
          revenez en arrière.
        </Step>
        <Step n={3} icon={<CircleCheck className="size-4" />}>
          Touchez <strong>Installer</strong>, puis <strong>Ouvrir</strong>. L&apos;icône DB.Mélo apparaît avec vos autres applications.
        </Step>
      </ol>
      <p className="text-muted">
        Si Google Play Protect affiche un message, touchez <strong>« Plus de détails »</strong> puis <strong>« Installer quand même »</strong> :
        l&apos;application ouvre simplement dbmelo.com.
      </p>
    </div>
  );
}

/** Dernier recours, replié : le fichier d'installation Android, pour les navigateurs qui n'installent pas. */
function ApkFallback({ size }: { size: number | null | undefined }) {
  if (typeof size !== "number") return null;
  return (
    <details className="group rounded-2xl border border-line p-4 text-sm">
      <summary className="cursor-pointer list-none text-muted marker:hidden">
        <span className="flex items-center justify-between gap-3">
          Autre méthode : télécharger le fichier d&apos;installation
          <span className="text-gold transition group-open:rotate-45">+</span>
        </span>
      </summary>
      <div className="mt-4">
        <AndroidDownload size={size} />
      </div>
    </details>
  );
}

/**
 * Installation par Chrome ou Samsung Internet : un toucher, puis « Installer » dans la fenêtre du
 * navigateur, et l'application s'installe toute seule. Le bouton s'allume dès que Chrome le permet
 * (après quelques secondes sur le site) ; seul son libellé change, pour ne rien décaler sous le doigt.
 */
function BrowserInstall({ env, canPrompt, install, apk }: { env: InstallEnv; canPrompt: boolean; install: () => void; apk: number | null | undefined }) {
  return (
    <div className="space-y-4 text-sm">
      {env.browser === "chrome" && env.viaApp && <AppWindowHint app={env.viaApp} />}
      <button type="button" onClick={install} disabled={!canPrompt} className="btn btn-gold w-full text-base disabled:opacity-70">
        {canPrompt ? <Download className="size-5" /> : <LoaderCircle className="size-5 animate-spin" />}
        {canPrompt ? "Installer l'application" : "Préparation de l'installation…"}
      </button>
      <p className="text-cream/90">
        Touchez ensuite <strong>Installer</strong> dans la fenêtre {env.browser === "samsung" ? "de Samsung Internet" : "de Chrome"} : l&apos;application
        s&apos;installe toute seule et son icône apparaît avec vos autres applications.
      </p>
      <p className="text-muted">
        {env.browser === "samsung" ? (
          <>
            Le bouton reste gris ? Touchez le menu <strong>≡</strong> en bas à droite, puis <strong>« Ajouter la page à »</strong> →{" "}
            <strong>« Écran d&apos;accueil »</strong>.
          </>
        ) : (
          <>
            Le bouton reste gris ? Touchez le menu <strong>⋮</strong> en haut à droite de Chrome, puis <strong>« Installer l&apos;application »</strong>{" "}
            (ou « Ajouter à l&apos;écran d&apos;accueil »).
          </>
        )}
      </p>
      {env.browser === "chrome" && !env.viaApp && <AppWindowHint />}
      <ApkFallback size={apk} />
    </div>
  );
}

/** Toutes les solutions pour cet appareil, de la plus simple à la moins simple. */
function InstallOptions({ env, canPrompt, install, apk }: { env: InstallEnv; canPrompt: boolean; install: () => void; apk: number | null | undefined }) {
  if (env.platform === "android" && !env.inApp && (env.browser === "chrome" || env.browser === "samsung")) {
    return <BrowserInstall env={env} canPrompt={canPrompt} install={install} apk={apk} />;
  }
  if (canPrompt && !env.inApp) {
    return (
      <button type="button" onClick={install} className="btn btn-gold w-full text-base">
        <Download className="size-5" /> Installer l&apos;application
      </button>
    );
  }
  return (
    <div className="space-y-4">
      <InstallSteps env={env} />
      {env.platform === "android" && <ApkFallback size={apk} />}
    </div>
  );
}

/** Liens touchés dans Gmail, Telegram, Claude… : la page s'ouvre dans une fenêtre de Chrome sans installation. */
function AppWindowHint({ app }: { app?: string | null }) {
  return (
    <p className="rounded-2xl border border-gold/30 bg-gold/5 p-3 text-gold-soft">
      <strong>Une croix ✕ en haut à gauche de l&apos;écran ?</strong> La page est ouverte dans la fenêtre{" "}
      {app ? ofApp(app) : "de l'application où vous avez touché le lien (Facebook, Gmail, Telegram…)"}, qui ne permet pas
      d&apos;installer. Touchez <strong>⋮</strong> en haut à droite, puis <strong>« Ouvrir dans Chrome »</strong>, et recommencez.
    </p>
  );
}

export function InstallSteps({ env }: { env: InstallEnv }) {
  const browser = env.platform === "ios" ? "Safari" : "Chrome";
  if (env.inApp) {
    return (
      <div className="space-y-4 text-sm">
        <p className="rounded-2xl border border-gold/30 bg-gold/5 p-3 text-gold-soft">
          Vous êtes dans le navigateur <strong>{ofApp(env.inApp)}</strong> : il ne permet pas d&apos;installer l&apos;application. Ouvrez DB.Mélo dans {browser}.
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
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          Sur iPhone, Apple ne permet de télécharger des applications que depuis l&apos;App Store : DB.Mélo s&apos;ajoute à l&apos;écran
          d&apos;accueil en deux gestes, et s&apos;ouvre ensuite comme une application.
        </p>
        <ol className="space-y-3 text-cream/90">
          <Step n={1} icon={<Share className="size-4" />}>
            Touchez le bouton <strong>Partager</strong>{" "}
            {env.browser === "safari" ? "de Safari (en bas sur iPhone, en haut sur iPad)" : "dans la barre d'adresse (en haut à droite dans Chrome)"}.
          </Step>
          <Step n={2} icon={<SquarePlus className="size-4" />}>
            Choisissez <strong>« Sur l&apos;écran d&apos;accueil »</strong> (faites défiler la liste si besoin), puis <strong>Ajouter</strong>.
          </Step>
        </ol>
        {env.browser === "safari" ? (
          <p className="text-muted">
            Pas de « Sur l&apos;écran d&apos;accueil » dans la liste ? La page est ouverte dans la fenêtre d&apos;une autre application : touchez
            l&apos;icône Safari (la boussole) en bas à droite, puis recommencez.
          </p>
        ) : (
          <p className="text-muted">Si l&apos;option n&apos;apparaît pas, ouvrez dbmelo.com dans Safari.</p>
        )}
      </div>
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
    const steps = (
      <ol className="space-y-3 text-cream/90">
        <Step n={1} icon={<EllipsisVertical className="size-4" />}>
          Touchez le menu <strong>⋮</strong> en haut à droite de {env.browser === "chrome" ? "Chrome" : env.browser === "firefox" ? "Firefox" : "votre navigateur"}.
        </Step>
        <Step n={2} icon={<SquarePlus className="size-4" />}>
          Choisissez <strong>« Installer l&apos;application »</strong> ou <strong>« Ajouter à l&apos;écran d&apos;accueil »</strong>, puis{" "}
          <strong>Installer</strong>.
        </Step>
      </ol>
    );
    // Opera, Phoenix, Mi… : Chrome installe mieux, le bouton passe en premier.
    if (env.browser === "other") {
      return (
        <div className="space-y-4 text-sm">
          <a href={typeof window === "undefined" ? "#" : chromeIntentUrl(window.location.href)} className="btn btn-gold w-full">
            <ExternalLink className="size-5" /> Ouvrir dans Chrome
          </a>
          <p className="text-muted">L&apos;installation est plus simple dans Chrome. Pour rester dans ce navigateur :</p>
          {steps}
        </div>
      );
    }
    // Venue d'une application (Gmail, Claude…) : la fenêtre intégrée est le cas le plus probable, il passe en premier.
    return (
      <div className="space-y-4 text-sm">
        {env.browser === "chrome" && env.viaApp && <AppWindowHint app={env.viaApp} />}
        {steps}
        {env.browser === "chrome" && !env.viaApp && <AppWindowHint />}
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
  // Chrome peut proposer l'installation directe quelques secondes après l'ouverture de la fenêtre.
  const { canPrompt, install } = useInstall();
  const apk = useAndroidApk(env.platform === "android");
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
                {env.platform === "ios" ? "Installer DB.Mélo sur iPhone" : "Installer DB.Mélo"}
              </h2>
              <button type="button" onClick={onClose} aria-label="Fermer" className="btn-quiet">
                <X className="size-5" />
              </button>
            </div>
            <InstallOptions env={env} canPrompt={canPrompt} install={async () => (await install()) && onClose()} apk={apk} />
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
  // Sur téléphone, le bouton est toujours là : la fenêtre d'installation de Chrome en un toucher si
  // possible, sinon les gestes à faire.
  if (!env || installed || (env.platform === "desktop" && !canPrompt)) return null;
  const mobile = env.platform !== "desktop";
  const onClick = async () => {
    if (canPrompt && (await install())) return;
    setOpen(true);
  };
  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className="btn btn-ghost min-h-10 rounded-xl px-3 py-2 text-sm"
        aria-label={mobile ? "Télécharger l'application" : "Installer l'application"}
      >
        <Download className="size-4" />
        {mobile ? "Télécharger" : "Installer"}
      </button>
      <InstallSheet env={env} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/* ───────────── Guide complet (page /installer) ───────────── */

const OTHER_DEVICES: { label: string; env: InstallEnv; download?: boolean }[] = [
  { label: "Android avec Chrome", env: { platform: "android", browser: "chrome", inApp: null } },
  { label: "Samsung (Samsung Internet)", env: { platform: "android", browser: "samsung", inApp: null } },
  { label: "iPhone et iPad (Safari)", env: { platform: "ios", browser: "safari", inApp: null } },
  { label: "Depuis Facebook, TikTok ou Instagram (Android)", env: { platform: "android", browser: "chrome", inApp: "Facebook, TikTok ou Instagram" } },
  { label: "Depuis Facebook, TikTok ou Instagram (iPhone)", env: { platform: "ios", browser: "safari", inApp: "Facebook, TikTok ou Instagram" } },
  { label: "Ordinateur", env: { platform: "desktop", browser: "chrome", inApp: null } },
  { label: "Android : fichier d'installation (APK)", env: { platform: "android", browser: "other", inApp: null }, download: true },
];

function PhoneQr() {
  const [url, setUrl] = useState("");
  useEffect(() => setUrl(`${window.location.origin}/installer`), []);
  if (!url) return null;
  return (
    <div className="flex items-center gap-4 border-line border-t pt-4">
      <img src={`/api/qr?text=${encodeURIComponent(url)}`} alt="QR code vers la page de téléchargement" className="size-28 rounded-xl bg-cream p-1" />
      <p className="text-sm text-muted">Sur votre téléphone : scannez ce code avec l&apos;appareil photo pour télécharger DB.Mélo.</p>
    </div>
  );
}

export function InstallGuide() {
  const { env, canPrompt, installed, install } = useInstall();
  const apk = useAndroidApk(true);
  if (!env) return <div className="card h-40 animate-pulse" />;
  return (
    <div className="space-y-6">
      <div className="card space-y-4 p-6">
        {installed ? (
          <p className="flex items-center gap-2 text-success">
            <Check className="size-5" /> DB.Mélo est installée sur cet appareil.
          </p>
        ) : (
          <InstallOptions env={env} canPrompt={canPrompt} install={install} apk={apk} />
        )}
        <p className="text-sm text-muted">{NO_STORE}</p>
        {env.platform === "desktop" && <PhoneQr />}
      </div>
      <div>
        <h2 className="mb-3 font-display text-xl font-bold">Sur un autre téléphone</h2>
        <div className="space-y-3">
          {OTHER_DEVICES.filter((d) => !d.download || typeof apk === "number").map((d) => (
            <details key={d.label} className="card group p-5">
              <summary className="cursor-pointer list-none font-semibold marker:hidden">
                <span className="flex items-center justify-between gap-4">
                  {d.label}
                  <span className="text-gold transition group-open:rotate-45">+</span>
                </span>
              </summary>
              <div className="mt-4">
                {d.download && typeof apk === "number" ? <AndroidDownload size={apk} /> : <InstallSteps env={d.env} />}
              </div>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────────── Notification d'installation ───────────── */

const LATER_KEY = "dbmelo-installer-plus-tard";
const LATER_MS = 3 * 24 * 3600_000;

/**
 * Dès que Chrome permet l'installation (après quelques secondes sur le site), une notification la
 * propose en bas de l'écran : « Installer », puis « Installer » dans la fenêtre de Chrome, et c'est fait.
 */
export function InstallBanner() {
  const { canPrompt, installed, install } = useInstall();
  const pathname = usePathname();
  const [later, setLater] = useState(true);
  useEffect(() => {
    try {
      setLater(Date.now() - Number(localStorage.getItem(LATER_KEY) || 0) < LATER_MS);
    } catch {
      setLater(false);
    }
  }, []);
  const close = () => {
    setLater(true);
    try {
      localStorage.setItem(LATER_KEY, String(Date.now()));
    } catch {}
  };
  // Pas pendant la création d'une chanson : la barre « Continuer » occupe déjà le bas de l'écran.
  const show = canPrompt && !installed && !later && !pathname.startsWith("/studio");
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          role="dialog"
          aria-label="Installer l'application DB.Mélo"
          className="safe-bottom fixed inset-x-0 bottom-0 z-40 p-3 sm:right-4 sm:bottom-4 sm:left-auto sm:w-96"
          initial={{ y: 120, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 120, opacity: 0 }}
        >
          <div className="card flex items-center gap-3 p-3 shadow-2xl shadow-black/60">
            <img src="/icons/192" alt="" className="size-12 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1">
              <p className="font-display font-bold leading-tight">Installer DB.Mélo</p>
              <p className="text-xs text-muted">Gratuit · vos chansons en un geste</p>
            </div>
            <button type="button" onClick={install} className="btn btn-gold min-h-10 shrink-0 px-4 py-2 text-sm">
              Installer
            </button>
            <button type="button" onClick={close} aria-label="Plus tard" className="btn-quiet shrink-0 p-1">
              <X className="size-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ───────────── Bandeau dans les navigateurs intégrés ───────────── */

export function InAppBanner() {
  const { env, installed } = useInstall();
  const [hidden, setHidden] = useState(true);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setHidden(sessionStorage.getItem("dbmelo-inapp") === "1");
    } catch {
      setHidden(false);
    }
  }, []);
  if (!env?.inApp || installed || hidden) return null;
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
