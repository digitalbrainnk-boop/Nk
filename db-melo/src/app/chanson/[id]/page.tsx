import type { Metadata } from "next";
import { SongWorkspace } from "@/components/song/SongWorkspace";

export const metadata: Metadata = { title: "Ma chanson", robots: { index: false, follow: false } };

export default async function SongPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ start?: string; paiement?: string }>;
}) {
  const { id } = await params;
  const q = await searchParams;
  return (
    <section className="mx-auto max-w-4xl px-4 pt-8 pb-10 sm:pt-12">
      <SongWorkspace id={id} autoStart={q.start === "1"} paymentRef={q.paiement} />
    </section>
  );
}
