/** Constantes globales de l'application. */
export const APP_NAME = "Winner Pronostic";
export const APP_SHORT_NAME = "Winner";
export const APP_DESCRIPTION =
  "Programme des matchs, scores en direct, statistiques et pronostics football analysés. Outil d'analyse : aucun pari, aucune mise.";

/** Âge minimum légal pour utiliser l'application (jeu responsable). */
export const MIN_AGE = 18;

/** Couleurs reprises dans le manifeste PWA et la balise theme-color. */
export const THEME_COLOR = "#0a0f1a";
export const BACKGROUND_COLOR = "#0a0f1a";

/** Fuseau horaire par défaut (Burkina Faso = UTC+0, sans heure d'été). */
export const DEFAULT_TIMEZONE = "Africa/Ouagadougou";

/** Pages qui exigent une connexion (vérifiées dans src/proxy.ts). */
export const PROTECTED_PATH_PREFIXES = ["/compte", "/admin", "/nouveau-mot-de-passe"] as const;

/** Pages d'authentification (inutile d'y aller quand on est déjà connecté). */
export const AUTH_PATHS = ["/connexion", "/inscription"] as const;
