import type { Metadata } from "next";
import { MySongs } from "./MySongs";

export const metadata: Metadata = { title: "Mes chansons" };

export default function MySongsPage() {
  return (
    <section className="mx-auto max-w-3xl px-4 pt-8 pb-10 sm:pt-12">
      <p className="eyebrow">Sur cet appareil</p>
      <h1 className="mt-2 mb-6 font-display text-3xl font-bold">Mes chansons</h1>
      <MySongs />
    </section>
  );
}
