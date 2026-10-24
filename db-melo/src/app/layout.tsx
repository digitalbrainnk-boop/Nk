import type { Metadata, Viewport } from "next";
import { Manrope, Sora } from "next/font/google";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { InAppBanner, InstallBanner } from "@/components/pwa/InstallPrompt";
import { ServiceWorkerRegister } from "@/components/pwa/ServiceWorkerRegister";
import { BRAND } from "@/lib/constants";
import "./globals.css";

const sora = Sora({ subsets: ["latin"], variable: "--font-sora", display: "swap" });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

const description =
  "Offrez une chanson unique, écrite et composée pour une personne : paroles personnalisées, voix studio, afro-pop, zouk, coupé-décalé, gospel… Téléchargement HD sur téléphone.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_BASE_URL || "http://localhost:3000"),
  title: { default: `${BRAND.name} — Chansons personnalisées en qualité studio`, template: `%s · ${BRAND.name}` },
  description,
  applicationName: BRAND.name,
  appleWebApp: { capable: true, title: BRAND.name, statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  openGraph: { type: "website", siteName: BRAND.name, title: `${BRAND.name} — Votre histoire, chantée`, description, locale: "fr_FR" },
};

export const viewport: Viewport = {
  themeColor: "#0B0B0F",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${sora.variable} ${manrope.variable}`}>
      <body className="studio-glow min-h-dvh antialiased">
        <Header />
        <InAppBanner />
        <main>{children}</main>
        <Footer />
        <InstallBanner />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
