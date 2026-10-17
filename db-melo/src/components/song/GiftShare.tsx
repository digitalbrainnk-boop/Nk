"use client";

import { Copy, ExternalLink, Gift, Share2 } from "lucide-react";
import { useState } from "react";
import { shareLink, shareOnWhatsApp } from "@/lib/client/download-to-mobile";

/** Page cadeau : lien partageable + QR code (à imprimer sur une carte, à glisser dans un bouquet…). */
export function GiftShare({ url, title, recipient }: { url: string; title: string; recipient?: string }) {
  const [copied, setCopied] = useState(false);
  const text = `🎁 ${recipient ? `${recipient}, une` : "Une"} chanson a été créée rien que pour toi : « ${title} »`;

  const share = async () => {
    const r = await shareLink(url, title, text);
    if (r === "copied") {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <section className="card grid gap-5 p-5 sm:grid-cols-[160px_1fr] sm:p-6" aria-labelledby="gift-title">
      <img src={`/api/qr?text=${encodeURIComponent(url)}`} alt="QR code de la page cadeau" className="mx-auto size-40 rounded-2xl bg-cream p-2" />
      <div className="space-y-3">
        <h2 id="gift-title" className="flex items-center gap-2 font-display text-xl font-bold">
          <Gift className="size-5 text-gold" /> Page cadeau
        </h2>
        <p className="text-sm text-muted">Le destinataire écoute la chanson, suit les paroles et peut la garder sur son téléphone. Le QR code s&apos;imprime sur une carte.</p>
        <p className="truncate rounded-xl border border-line bg-ink/60 px-3 py-2 text-sm text-gold-soft">{url}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={share} className="btn btn-ghost min-h-10 py-2 text-sm">
            {copied ? <Copy className="size-4" /> : <Share2 className="size-4" />} {copied ? "Lien copié !" : "Partager le lien"}
          </button>
          <button type="button" onClick={() => shareOnWhatsApp(text, url)} className="btn btn-ghost min-h-10 py-2 text-sm">
            WhatsApp
          </button>
          <a href={url} target="_blank" rel="noopener" className="btn btn-quiet min-h-10 py-2 text-sm">
            <ExternalLink className="size-4" /> Voir la page
          </a>
        </div>
      </div>
    </section>
  );
}
