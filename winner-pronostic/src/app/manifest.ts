import type { MetadataRoute } from "next";
import { APP_DESCRIPTION, APP_NAME, APP_SHORT_NAME, BACKGROUND_COLOR, THEME_COLOR } from "@/lib/constants";

/** Manifeste PWA : rend l'application installable sur Android (« Ajouter à l'écran d'accueil »). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: APP_NAME,
    short_name: APP_SHORT_NAME,
    description: APP_DESCRIPTION,
    lang: "fr",
    dir: "ltr",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: BACKGROUND_COLOR,
    theme_color: THEME_COLOR,
    categories: ["sports", "news"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Matchs en direct", short_name: "Direct", url: "/direct" },
      { name: "Pronostics du jour", short_name: "Pronos", url: "/pronostics" },
      { name: "Générer un coupon", short_name: "Coupon", url: "/coupons" },
    ],
  };
}
