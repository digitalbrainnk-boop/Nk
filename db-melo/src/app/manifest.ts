import type { MetadataRoute } from "next";

// Application installable : Android, iPhone, iPad et ordinateur (Chrome, Edge, Safari).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "DB.Mélo — Chansons personnalisées",
    short_name: "DB.Mélo",
    description: "Créez et offrez des chansons personnalisées de qualité studio, composées avec l'IA.",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0B0B0F",
    theme_color: "#0B0B0F",
    lang: "fr",
    dir: "ltr",
    categories: ["music", "entertainment", "lifestyle"],
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    // Captures montrées par Android dans la fenêtre d'installation, comme dans un store.
    screenshots: [
      { src: "/screenshots/accueil.jpg", sizes: "780x1688", type: "image/jpeg", form_factor: "narrow", label: "Offrez une chanson unique" },
      { src: "/screenshots/paroles.jpg", sizes: "780x1688", type: "image/jpeg", form_factor: "narrow", label: "Le parolier écrit vos couplets" },
      { src: "/screenshots/ecoute.jpg", sizes: "780x1688", type: "image/jpeg", form_factor: "narrow", label: "Deux versions, paroles en karaoké" },
      { src: "/screenshots/cadeau.jpg", sizes: "780x1688", type: "image/jpeg", form_factor: "narrow", label: "Une page cadeau à offrir" },
    ],
    shortcuts: [
      { name: "Créer une chanson", short_name: "Créer", url: "/studio", icons: [{ src: "/icons/192", sizes: "192x192" }] },
      { name: "Mes chansons", url: "/mes-chansons", icons: [{ src: "/icons/192", sizes: "192x192" }] },
    ],
  };
}
