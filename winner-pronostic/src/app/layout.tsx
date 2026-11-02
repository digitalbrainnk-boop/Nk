import type { Metadata, Viewport } from "next";
import { AppFooterBar } from "@/components/layout/app-footer-bar";
import { AppHeader } from "@/components/layout/app-header";
import { OfflineBanner } from "@/components/pwa/offline-banner";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { APP_DESCRIPTION, APP_NAME, THEME_COLOR } from "@/lib/constants";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: `${APP_NAME} — Pronostics football`, template: `%s · ${APP_NAME}` },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  appleWebApp: { capable: true, title: "Winner", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  icons: { apple: "/icons/apple-touch-icon.png" },
  openGraph: { type: "website", locale: "fr_FR", siteName: APP_NAME, title: APP_NAME, description: APP_DESCRIPTION },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: THEME_COLOR,
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr">
      <body className="min-h-dvh">
        <a
          href="#contenu"
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-brand focus:px-3 focus:py-2 focus:text-brand-ink"
        >
          Aller au contenu
        </a>
        <OfflineBanner />
        <AppHeader />
        <main id="contenu" className="mx-auto w-full max-w-xl px-4 pt-4 pb-safe-nav">
          {children}
        </main>
        <AppFooterBar />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
