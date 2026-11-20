// Réglages locaux à cet appareil (adresse du serveur, jeton, dernière ligne affichée).
const KEY = "multi-lignes:settings";
const DEFAULTS = { serverUrl: "", token: "", activeId: null };

/** Vrai quand l'app tourne dans le conteneur natif Capacitor (Android / iOS). */
export const isNative = () => Boolean(window.Capacitor?.isNativePlatform?.());

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // stockage indisponible (navigation privée) : réglages valables pour cette visite seulement
  }
}

/**
 * Adresse du backend. Ouverte depuis le serveur (PWA), l'app utilise la même
 * origine ; dans Capacitor, l'adresse doit être saisie dans les réglages.
 */
export function serverBase(settings) {
  const url = settings.serverUrl || (isNative() ? "" : window.location.origin);
  return url.replace(/\/+$/, "");
}
