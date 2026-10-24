// Où se trouve le visiteur pour installer l'application : téléphone, navigateur, et surtout
// navigateur intégré d'une application (Facebook, TikTok…), où l'installation est impossible.

export type InstallPlatform = "ios" | "android" | "desktop";
export type InstallBrowser = "safari" | "chrome" | "samsung" | "firefox" | "other";

export interface InstallEnv {
  platform: InstallPlatform;
  browser: InstallBrowser;
  /** Nom de l'application dont le navigateur intégré affiche la page (null : vrai navigateur). */
  inApp: string | null;
}

const IN_APP: [RegExp, string][] = [
  [/FBAN|FBAV|FB_IAB|FBIOS|FB4A|Messenger/i, "Facebook"],
  [/Instagram/i, "Instagram"],
  [/musical_ly|TikTok|BytedanceWebview|trill_/i, "TikTok"],
  [/Snapchat/i, "Snapchat"],
  [/Telegram/i, "Telegram"],
  [/\bLine\//, "Line"],
  [/WhatsApp/i, "WhatsApp"],
];

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
      : /CriOS/.test(ua) || (/Chrome\//.test(ua) && !/Edg|OPR|OPiOS|YaBrowser|UCBrowser/.test(ua))
        ? "chrome"
        : ios && !/EdgiOS|OPiOS/.test(ua)
          ? "safari"
          : "other";
  return { platform, browser, inApp };
}

/** Lien qui rouvre la page dans Chrome depuis le navigateur intégré d'une application Android. */
export function chromeIntentUrl(href: string): string {
  const u = new URL(href);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(href)};end`;
}
