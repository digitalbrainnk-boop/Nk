// Détection du contexte d'installation à partir d'agents utilisateurs réels.
import { describe, expect, it } from "vitest";
import { appFromReferrer, chromeIntentUrl, detectInstallEnv, ofApp } from "@/lib/client/install-env";

const UA = {
  chromeAndroid: "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
  firefoxAndroid: "Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0",
  facebookAndroid:
    "Mozilla/5.0 (Linux; Android 13; SM-A135F Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/118.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/439.0.0.29.119;]",
  facebookIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.0;FBSS/3;FBID/phone;FBLC/fr_FR;FBOP/5]",
  tiktokAndroid:
    "Mozilla/5.0 (Linux; Android 12; TECNO KG5m Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.163 Mobile Safari/537.36 trill_310503 BytedanceWebview/d8a21c6",
  tiktokIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_30.8.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/fr Region/BF",
  instagram:
    "Mozilla/5.0 (Linux; Android 13; Infinix X6833B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.43 Mobile Safari/537.36 Instagram 309.1.0.41.113 Android",
  telegramAndroid:
    "Mozilla/5.0 (Linux; Android 11; itel A571W Build/RP1A.201005.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/117.0.0.0 Mobile Safari/537.36",
  safariIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  chromeIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.88 Mobile/15E148 Safari/604.1",
  ipadOs: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  desktopChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  phoenix:
    "Mozilla/5.0 (Linux; Android 12; TECNO CK7n Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/112.0.5615.136 Mobile Safari/537.36 PHX/12.5",
  googleApp:
    "Mozilla/5.0 (Linux; Android 13; SM-A135F Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.163 Mobile Safari/537.36 GSA/14.47.25.29.arm64",
  opera: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 OPR/79.1.4195.76963",
  miBrowser:
    "Mozilla/5.0 (Linux; U; Android 13; fr-fr; Redmi Note 12 Build/TKQ1.221114.001) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/112.0.5615.136 Mobile Safari/537.36 XiaoMi/MiuiBrowser/14.5.10-gn",
};

describe("contexte d'installation", () => {
  it("vrais navigateurs Android", () => {
    expect(detectInstallEnv(UA.chromeAndroid)).toEqual({ platform: "android", browser: "chrome", inApp: null });
    expect(detectInstallEnv(UA.samsung)).toEqual({ platform: "android", browser: "samsung", inApp: null });
    expect(detectInstallEnv(UA.firefoxAndroid)).toEqual({ platform: "android", browser: "firefox", inApp: null });
  });

  it("navigateurs intégrés de Facebook, TikTok, Instagram et autres applications", () => {
    expect(detectInstallEnv(UA.facebookAndroid)).toMatchObject({ platform: "android", inApp: "Facebook" });
    expect(detectInstallEnv(UA.facebookIos)).toMatchObject({ platform: "ios", inApp: "Facebook" });
    expect(detectInstallEnv(UA.tiktokAndroid)).toMatchObject({ platform: "android", inApp: "TikTok" });
    expect(detectInstallEnv(UA.tiktokIos)).toMatchObject({ platform: "ios", inApp: "TikTok" });
    expect(detectInstallEnv(UA.instagram)).toMatchObject({ platform: "android", inApp: "Instagram" });
    expect(detectInstallEnv(UA.telegramAndroid)).toMatchObject({ platform: "android", inApp: "une application" });
    expect(detectInstallEnv(UA.googleApp)).toMatchObject({ platform: "android", inApp: "Google" });
    expect(detectInstallEnv(UA.phoenix)).toMatchObject({ platform: "android", inApp: "Phoenix" });
  });

  it("navigateurs qui se présentent comme Chrome sans en être", () => {
    expect(detectInstallEnv(UA.opera)).toEqual({ platform: "android", browser: "other", inApp: null });
    expect(detectInstallEnv(UA.miBrowser)).toEqual({ platform: "android", browser: "other", inApp: null });
  });

  it("application qui a ouvert le lien (fenêtre intégrée de Chrome)", () => {
    expect(appFromReferrer("android-app://com.anthropic.claude/")).toBe("Claude");
    expect(appFromReferrer("android-app://com.google.android.gm/")).toBe("Gmail");
    expect(appFromReferrer("android-app://com.facebook.orca/")).toBe("Messenger");
    expect(appFromReferrer("android-app://org.telegram.messenger/")).toBe("Telegram");
    expect(appFromReferrer("android-app://com.exemple.inconnue/")).toBe("une application");
    expect(appFromReferrer("android-app://com.android.chrome/")).toBeNull();
    expect(appFromReferrer("https://www.google.com/")).toBeNull();
    expect(appFromReferrer("")).toBeNull();
    expect([ofApp("Gmail"), ofApp("Instagram"), ofApp("une application")]).toEqual(["de Gmail", "d'Instagram", "d'une application"]);
  });

  it("iPhone et iPad", () => {
    expect(detectInstallEnv(UA.safariIos)).toEqual({ platform: "ios", browser: "safari", inApp: null });
    expect(detectInstallEnv(UA.chromeIos)).toEqual({ platform: "ios", browser: "chrome", inApp: null });
    expect(detectInstallEnv(UA.ipadOs, true)).toEqual({ platform: "ios", browser: "safari", inApp: null });
  });

  it("ordinateur", () => {
    expect(detectInstallEnv(UA.desktopChrome)).toEqual({ platform: "desktop", browser: "chrome", inApp: null });
    expect(detectInstallEnv(UA.ipadOs)).toMatchObject({ platform: "desktop" });
  });

  it("lien d'ouverture dans Chrome, avec repli sur la page", () => {
    const url = chromeIntentUrl("https://dbmelo.com/installer?source=tiktok");
    expect(url).toBe(
      "intent://dbmelo.com/installer?source=tiktok#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=https%3A%2F%2Fdbmelo.com%2Finstaller%3Fsource%3Dtiktok;end",
    );
  });
});
