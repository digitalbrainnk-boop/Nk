// Où se trouve le visiteur pour installer l'application : téléphone, navigateur, et surtout
// navigateur intégré d'une application (Facebook, TikTok…), où l'installation est impossible.

export type InstallPlatform = "ios" | "android" | "desktop";
export type InstallBrowser = "safari" | "chrome" | "samsung" | "firefox" | "other";

export interface InstallEnv {
  platform: InstallPlatform;
  browser: InstallBrowser;
  /** Nom de l'application dont le navigateur intégré affiche la page (null : vrai navigateur). */
  inApp: string | null;
  /**
   * Application qui a ouvert le lien (Gmail, Telegram, Claude…) : souvent dans sa propre fenêtre Chrome,
   * avec une croix en haut à gauche, d'où l'on ne peut pas installer. Indice seulement : la même page
   * peut aussi s'être ouverte dans Chrome lui-même.
   */
  viaApp?: string | null;
}

const IN_APP: [RegExp, string][] = [
  [/FBAN|FBAV|FB_IAB|FBIOS|FB4A|Messenger/i, "Facebook"],
  [/Instagram/i, "Instagram"],
  [/musical_ly|TikTok|BytedanceWebview|trill_/i, "TikTok"],
  [/Snapchat/i, "Snapchat"],
  [/Telegram/i, "Telegram"],
  [/\bLine\//, "Line"],
  [/WhatsApp/i, "WhatsApp"],
  [/\bGSA\//, "Google"],
  [/PHX\//, "Phoenix"],
];

// Navigateurs Android qui se présentent comme Chrome sans en être (Opera, Mi, HeyTap…) ; « Version/4.0 »
// trahit un navigateur bâti sur le WebView d'Android. Ils n'offrent pas l'installation de Chrome.
const NOT_CHROME = /Edg|OPR|Opera|OPiOS|YaBrowser|UCBrowser|MiuiBrowser|XiaoMi|HeyTapBrowser|OppoBrowser|VivoBrowser|HuaweiBrowser|HONORBrowser|DuckDuckGo|Silk|Version\/\d/;

/** `touchMac` : iPadOS se présente comme un Mac, on le reconnaît à l'écran tactile. */
export function detectInstallEnv(ua: string, touchMac = false): InstallEnv {
  const ios = /iPad|iPhone|iPod/.test(ua) || touchMac;
  const android = !ios && /Android/i.test(ua);
  const platform: InstallPlatform = ios ? "ios" : android ? "android" : "desktop";

  let inApp = IN_APP.find(([re]) => re.test(ua))?.[1] ?? null;
  // Autres navigateurs intégrés : WebView Android (« ; wv) »), ou WebView iOS sans la mention Safari.
  if (!inApp && android && /; wv\)/.test(ua)) inApp = "une application";
  if (!inApp && ios && !/Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) inApp = "une application";

  const browser: InstallBrowser = /SamsungBrowser/i.test(ua)
    ? "samsung"
    : /Firefox\/|FxiOS/i.test(ua)
      ? "firefox"
      : /CriOS/.test(ua) || (/Chrome\//.test(ua) && !NOT_CHROME.test(ua))
        ? "chrome"
        : ios && !/EdgiOS|OPiOS/.test(ua)
          ? "safari"
          : "other";
  return { platform, browser, inApp };
}

const APPS: [RegExp, string][] = [
  [/^com\.anthropic\./, "Claude"],
  [/^com\.google\.android\.gm$/, "Gmail"],
  [/^com\.google\.android\.googlequicksearchbox$/, "Google"],
  [/^com\.facebook\.(orca|mlite)$/, "Messenger"],
  [/^com\.facebook\./, "Facebook"],
  [/^com\.whatsapp/, "WhatsApp"],
  [/telegram|challegram/, "Telegram"],
  [/^com\.(zhiliaoapp\.musically|ss\.android\.ugc\.)/, "TikTok"],
  [/^com\.instagram\./, "Instagram"],
  [/^com\.snapchat\./, "Snapchat"],
  [/^com\.twitter\./, "X"],
  [/^com\.linkedin\./, "LinkedIn"],
];
const BROWSER_APPS = /^(com\.android\.chrome|com\.chrome\.|com\.sec\.android\.app\.sbrowser|org\.mozilla\.|com\.microsoft\.emmx|com\.opera\.|com\.brave\.)/;

/** Application Android qui a ouvert la page, d'après le référent « android-app://paquet » posé par Chrome. */
export function appFromReferrer(referrer: string): string | null {
  const pkg = /^android-app:\/\/([\w.]+)/.exec(referrer)?.[1];
  if (!pkg || BROWSER_APPS.test(pkg)) return null;
  return APPS.find(([re]) => re.test(pkg))?.[1] ?? "une application";
}

/** « de Facebook », « d'Instagram », « d'une application ». */
export function ofApp(app: string): string {
  return /^[aeiouyéh]/i.test(app) ? `d'${app}` : `de ${app}`;
}

/** Lien qui rouvre la page dans Chrome depuis le navigateur intégré d'une application Android. */
export function chromeIntentUrl(href: string): string {
  const u = new URL(href);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(href)};end`;
}
