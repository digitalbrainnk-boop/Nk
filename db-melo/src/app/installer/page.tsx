import type { Metadata } from "next";
import { InstallGuide } from "@/components/pwa/InstallPrompt";

export const metadata: Metadata = {
  title: "Télécharger l'application",
  description: "Téléchargez l'application DB.Mélo sur Android, sans Play Store, ou ajoutez-la à l'écran d'accueil de votre iPhone en deux gestes.",
};

export default function InstallerPage() {
  return (
    <section className="mx-auto max-w-2xl px-4 pt-8 pb-10 sm:pt-12">
      <p className="eyebrow">Application DB.Mélo</p>
      <h1 className="mt-2 font-display text-3xl font-bold sm:text-4xl">Téléchargez DB.Mélo sur votre téléphone</h1>
      <p className="mt-2 mb-8 text-muted">Vos chansons à portée de main, dans une vraie application, sur Android comme sur iPhone.</p>
      <InstallGuide />
    </section>
  );
}
