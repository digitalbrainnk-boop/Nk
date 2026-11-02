import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { WifiOffIcon } from "@/components/ui/icons";

export const metadata: Metadata = { title: "Hors ligne", robots: { index: false } };

/** Page affichée par le service worker quand il n'y a pas de connexion. */
export default function OfflinePage() {
  return (
    <div className="py-16 text-center">
      <WifiOffIcon className="mx-auto size-12 text-warning" />
      <h1 className="mt-4 text-lg font-bold">Pas de connexion internet</h1>
      <p className="mx-auto mt-1 max-w-xs text-sm text-muted">
        Vérifiez vos données mobiles ou votre Wi-Fi. Les pages déjà consultées restent disponibles.
      </p>
      <ButtonLink href="/" className="mt-6">
        Réessayer
      </ButtonLink>
    </div>
  );
}
