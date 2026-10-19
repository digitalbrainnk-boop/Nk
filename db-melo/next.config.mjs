// Configuration Next.js (en JavaScript : se charge sans compilateur, y compris sur Android / Termux).
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

/** @type {import("next").NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Paquet autonome (server.js + dépendances utiles) pour o2switch ; activé par NEXT_OUTPUT=standalone.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" } : {}),
  // Le dépôt contient aussi l'agent (package-lock à la racine) : DB.Mélo est autonome dans ce dossier.
  outputFileTracingRoot: root,
  turbopack: { root },
  async headers() {
    return [
      {
        // Protections du navigateur sur tout le site.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self' https:" },
          // Ignoré en http (Termux, essais locaux) ; impose le https une fois le site visité en https.
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
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
