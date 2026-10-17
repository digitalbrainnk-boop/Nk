import type { Metadata } from "next";
import { SongCreator } from "@/components/creator/SongCreator";
import { config } from "@/lib/server/env";

export const metadata: Metadata = { title: "Créer ma chanson" };
// Le parcours (paiement avant ou après la pré-écoute) se lit à l'exécution.
export const dynamic = "force-dynamic";

export default function StudioPage() {
  return (
    <section className="mx-auto max-w-3xl px-4 pt-8 pb-10 sm:pt-12">
      <p className="eyebrow">Studio DB.Mélo</p>
      <h1 className="mt-2 font-display text-3xl font-bold sm:text-4xl">Créons votre chanson</h1>
      <p className="mt-2 mb-8 text-muted">Paroles, voix, style : quatre étapes, et le studio compose deux versions pour vous.</p>
      <SongCreator flowMode={config.flowMode()} />
    </section>
  );
}
