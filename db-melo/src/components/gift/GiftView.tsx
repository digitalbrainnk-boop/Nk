"use client";

import { motion } from "framer-motion";
import { Heart, Loader, Smartphone } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AudioPlayer } from "@/components/player/AudioPlayer";
import { downloadToMobile } from "@/lib/client/download-to-mobile";
import { BRAND } from "@/lib/constants";
import type { AlignedWord, VariantId } from "@/lib/types";

export interface GiftVariant {
  id: VariantId;
  duration?: number;
  alignedWords?: AlignedWord[] | null;
}

interface Props {
  slug: string;
  title: string;
  recipient?: string;
  sender?: string;
  dedication?: string;
  lyrics: string;
  variants: GiftVariant[];
  qrSvg: string;
  ext: "mp3" | "wav";
}

export function GiftView({ slug, title, recipient, sender, dedication, lyrics, variants, qrSvg, ext }: Props) {
  const [variant, setVariant] = useState<VariantId>(variants[0]?.id ?? "A");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const current = variants.find((v) => v.id === variant) ?? variants[0];
  const filename = `${title.replace(/[\\/:*?"<>|]+/g, "")} - ${BRAND.name}.${ext}`;

  const keep = async () => {
    setBusy(true);
    try {
      const r = await downloadToMobile(file ?? `/api/gift/${slug}/audio?variant=${variant}&download=1`, { filename, title, mimeType: ext === "mp3" ? "audio/mpeg" : "audio/wav" });
      if (!r.cancelled) setNote(r.method === "share" ? "Choisissez « Enregistrer dans Fichiers » ou votre app de musique." : "Chanson enregistrée sur votre appareil.");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <motion.img
          src={`/api/gift/${slug}/cover`}
          alt={`Pochette de « ${title} »`}
          className="mx-auto aspect-square w-64 rounded-3xl object-cover shadow-[0_30px_80px_-20px_rgb(229_169_60/0.45)] sm:w-80"
          initial={{ scale: 0.92, rotate: -2 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", bounce: 0.35 }}
        />
        <p className="eyebrow mt-8">{recipient ? `Pour ${recipient}` : "Une chanson pour vous"}</p>
        <h1 className="mt-2 font-display text-3xl font-bold sm:text-4xl">{title}</h1>
        {sender && <p className="mt-2 text-muted">de la part de {sender}</p>}
        {dedication && (
          <blockquote className="mx-auto mt-6 max-w-xl text-lg text-cream/90 italic">
            <Heart className="mx-auto mb-2 size-5 text-gold" fill="currentColor" />« {dedication} »
          </blockquote>
        )}
      </motion.div>

      {variants.length > 1 && (
        <div className="flex justify-center gap-2">
          {variants.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => {
                setVariant(v.id);
                setFile(null);
              }}
              className={`chip min-h-10 ${variant === v.id ? "chip-on" : ""}`}
            >
              {v.id === "A" ? "Version rythmée" : "Version acoustique"}
            </button>
          ))}
        </div>
      )}

      <AudioPlayer
        key={variant}
        src={`/api/gift/${slug}/audio?variant=${variant}&download=1`}
        filename={filename}
        title={title}
        subtitle={BRAND.artist}
        lyrics={lyrics}
        alignedWords={current?.alignedWords}
        trackDuration={current?.duration}
        coverUrl={`/api/gift/${slug}/cover`}
        defaultKaraoke
        onFileReady={setFile}
      />

      <div className="text-center">
        <button type="button" onClick={keep} disabled={busy} className="btn btn-gold w-full max-w-md py-4 text-base">
          {busy ? <Loader className="size-5 animate-spin" /> : <Smartphone className="size-5" />}
          Garder cette chanson sur mon téléphone
        </button>
        {note && <p className="mt-3 text-sm text-muted">{note}</p>}
      </div>

      <div className="card flex flex-col items-center gap-4 p-6 text-center sm:flex-row sm:text-left">
        <div className="size-32 shrink-0 overflow-hidden rounded-2xl" dangerouslySetInnerHTML={{ __html: qrSvg }} aria-label="QR code de cette page" role="img" />
        <div>
          <p className="font-display text-lg font-semibold">Vous aussi, offrez une chanson</p>
          <p className="mt-1 text-sm text-muted">Racontez une histoire, {BRAND.name} la met en musique en quelques minutes.</p>
          <Link href="/studio" className="btn btn-ghost mt-3">
            Créer ma chanson
          </Link>
        </div>
      </div>
    </div>
  );
}
