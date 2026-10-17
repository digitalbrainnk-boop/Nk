// Configuration Next.js (en JavaScript : se charge sans compilateur, y compris sur Android / Termux).
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

/** @type {import("next").NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Le dépôt contient aussi l'agent (package-lock à la racine) : DB.Mélo est autonome dans ce dossier.
  outputFileTracingRoot: root,
  turbopack: { root },
  async headers() {
    return [
      {
        // Le service worker doit pouvoir contrôler tout le site.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
