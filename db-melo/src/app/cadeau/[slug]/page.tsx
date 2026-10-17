import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { GiftView } from "@/components/gift/GiftView";
import { config } from "@/lib/server/env";
import { songBySlug } from "@/lib/server/songs";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const song = await songBySlug(slug);
  if (!song || song.payment.status !== "paid") return { title: "Cadeau", robots: { index: false } };
  const c = song.config;
  const title = c.recipientName ? `${c.title} — pour ${c.recipientName}` : c.title;
  return {
    title,
    description: "Une chanson personnalisée créée avec DB.Mélo. Écoutez-la et gardez-la sur votre téléphone.",
    robots: { index: false, follow: false },
    openGraph: { title, images: [{ url: `/api/gift/${slug}/cover`, width: 800, height: 800 }], type: "music.song" },
  };
}

export default async function GiftPage({ params }: Props) {
  const { slug } = await params;
  const song = await songBySlug(slug);
  if (!song) notFound();
  if (song.payment.status !== "paid" || song.generation.status !== "ready") {
    return (
      <section className="mx-auto max-w-md px-4 py-24 text-center">
        <p className="eyebrow">Surprise en préparation</p>
        <h1 className="mt-3 font-display text-3xl font-bold">Ce cadeau sera bientôt prêt</h1>
        <p className="mt-4 text-muted">Revenez un peu plus tard : la chanson est encore au studio.</p>
        <Link href="/" className="btn btn-ghost mt-8">
          Découvrir DB.Mélo
        </Link>
      </section>
    );
  }

  const h = await headers();
  const base = config.publicBaseUrl() || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const qrSvg = await QRCode.toString(`${base}/cadeau/${slug}`, { type: "svg", margin: 1, color: { dark: "#0B0B0F", light: "#F5F3EE" } });
  const c = song.config;
  const variants = (["A", "B"] as const)
    .filter((v) => song.variants[v].status === "SUCCESS")
    .map((v) => ({ id: v, duration: song.variants[v].tracks[0]?.duration, alignedWords: song.variants[v].alignedWords }));

  return (
    <section className="mx-auto max-w-2xl px-4 pt-10 pb-10">
      <GiftView
        slug={slug}
        title={c.title}
        recipient={c.recipientName}
        sender={c.brief?.senderName}
        dedication={c.dedication}
        lyrics={c.lyrics}
        variants={variants}
        qrSvg={qrSvg}
        ext={song.demo ? "wav" : "mp3"}
      />
    </section>
  );
}
