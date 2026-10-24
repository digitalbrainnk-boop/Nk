"use client";

// Installer l'application : sur Android, l'application à télécharger (dbmelo.com/dbmelo.apk) ;
// sinon l'invite native quand le navigateur la propose (Chrome / Edge), ou les gestes exacts selon le
// téléphone et le navigateur — et une sortie des navigateurs intégrés (Facebook, TikTok, Instagram…).

import { AnimatePresence, motion } from "framer-motion";
import { Check, CircleCheck, Copy, Download, EllipsisVertical, ExternalLink, FileDown, Menu, Share, ShieldCheck, SquarePlus, X } from "lucide-react";
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

/**
 * Sur Android : l'application à télécharger, puis les autres solutions selon le navigateur.
 * `freeze` : dans la fenêtre ancrée en bas, rien ne doit apparaître une fois ouverte, sinon le bouton
 * remonte sous le doigt (Chrome autorise souvent l'installation directe au premier toucher).
 */
function AndroidChoices({
  env,
  size,
  canPrompt,
  install,
  freeze = false,
}: { env: InstallEnv; size: number; canPrompt: boolean; install: () => Promise<boolean>; freeze?: boolean }) {
  const [promptAtOpen] = useState(canPrompt);
  const offerChrome = freeze ? promptAtOpen : canPrompt;
  return (
    <div className="space-y-5">
      <AndroidDownload size={size} />
      {env.inApp ? (
        <div className="space-y-3 border-line border-t pt-4 text-sm">
          <p className="text-muted">Le téléchargement ne démarre pas dans {ofApp(env.inApp)} ? Ouvrez DB.Mélo dans Chrome, puis recommencez :</p>
          <a href={typeof window === "undefined" ? "#" : chromeIntentUrl(window.location.href)} className="btn btn-ghost w-full">
            <ExternalLink className="size-5" /> Ouvrir dans Chrome
          </a>
        </div>
      ) : (
        offerChrome && (
          <div className="space-y-3 border-line border-t pt-4 text-sm">
            <p className="text-muted">Ou sans télécharger de fichier, directement depuis Chrome :</p>
            <button type="button" onClick={install} className="btn btn-ghost w-full">
              <SquarePlus className="size-5" /> Installer depuis Chrome
            </button>
          </div>
        )
      )}
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
const NO_PLAY_STORE = "Pas besoin du Play Store : l'application se télécharge directement depuis dbmelo.com, gratuitement.";

/* ───────────── Fenêtre d'aide ───────────── */

export function InstallSheet({ env, open, onClose }: { env: InstallEnv; open: boolean; onClose: () => void }) {
  // Chrome peut proposer l'installation directe quelques secondes après l'ouverture de la fenêtre.
  const { canPrompt, install } = useInstall();
  const apk = useAndroidApk(env.platform === "android");
  const download = typeof apk === "number";
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
                {download ? "Télécharger DB.Mélo" : env.platform === "ios" ? "Installer DB.Mélo sur iPhone" : "Installer DB.Mélo"}
              </h2>
              <button type="button" onClick={onClose} aria-label="Fermer" className="btn-quiet">
                <X className="size-5" />
              </button>
            </div>
            {download ? (
              <AndroidChoices env={env} size={apk} canPrompt={canPrompt} install={async () => (await install()) && (onClose(), true)} freeze />
            ) : canPrompt && !env.inApp ? (
              <button type="button" onClick={async () => (await install()) && onClose()} className="btn btn-gold w-full text-base">
                <Download className="size-5" /> Installer maintenant
              </button>
            ) : (
              <InstallSteps env={env} />
            )}
            <p className="mt-5 text-xs text-muted">{download ? NO_PLAY_STORE : NO_STORE}</p>
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
  // Vérifiée dès l'affichage : la fenêtre propose l'application Android sans attendre.
  const apk = useAndroidApk(env?.platform === "android" && !installed);
  // Sur téléphone, le bouton est toujours là : application à télécharger sur Android, invite native si
  // possible, sinon les gestes à faire.
  if (!env || installed || (env.platform === "desktop" && !canPrompt)) return null;
  const mobile = env.platform !== "desktop";
  const onClick = async () => {
    if (typeof apk !== "number" && canPrompt && (await install())) return;
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
  { label: "Android : télécharger l'application", env: { platform: "android", browser: "chrome", inApp: null }, download: true },
  { label: "Android avec Chrome, sans téléchargement", env: { platform: "android", browser: "chrome", inApp: null } },
  { label: "Samsung (Samsung Internet)", env: { platform: "android", browser: "samsung", inApp: null } },
  { label: "iPhone et iPad (Safari)", env: { platform: "ios", browser: "safari", inApp: null } },
  { label: "Depuis Facebook, TikTok ou Instagram (Android)", env: { platform: "android", browser: "chrome", inApp: "Facebook, TikTok ou Instagram" } },
  { label: "Depuis Facebook, TikTok ou Instagram (iPhone)", env: { platform: "ios", browser: "safari", inApp: "Facebook, TikTok ou Instagram" } },
  { label: "Ordinateur", env: { platform: "desktop", browser: "chrome", inApp: null } },
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
  const download = env.platform === "android" && typeof apk === "number";
  return (
    <div className="space-y-6">
      <div className="card space-y-4 p-6">
        {installed ? (
          <p className="flex items-center gap-2 text-success">
            <Check className="size-5" /> DB.Mélo est installée sur cet appareil.
          </p>
        ) : download ? (
          <AndroidChoices env={env} size={apk} canPrompt={canPrompt} install={install} />
        ) : canPrompt ? (
          <button type="button" onClick={install} className="btn btn-gold w-full text-base">
            <Download className="size-5" /> Installer l&apos;application
          </button>
        ) : (
          <InstallSteps env={env} />
        )}
        <p className="text-sm text-muted">{download ? NO_PLAY_STORE : NO_STORE}</p>
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
