import type { Metadata } from "next";
import { InstallGuide } from "@/components/pwa/InstallPrompt";

export const metadata: Metadata = {
  title: "Installer l'application",
  description: "Installez DB.Mélo sur votre téléphone en quelques secondes, sans Play Store : Android, iPhone, Samsung, et depuis Facebook ou TikTok.",
};

export default function InstallerPage() {
  return (
    <section className="mx-auto max-w-2xl px-4 pt-8 pb-10 sm:pt-12">
      <p className="eyebrow">Application DB.Mélo</p>
      <h1 className="mt-2 font-display text-3xl font-bold sm:text-4xl">Installez DB.Mélo sur votre téléphone</h1>
      <p className="mt-2 mb-8 text-muted">Vos chansons à portée de main, en plein écran comme une application, en deux gestes.</p>
      <InstallGuide />
    </section>
  );
}
